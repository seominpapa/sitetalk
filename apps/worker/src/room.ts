import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';
import type { User, Room, Message } from '../../../packages/shared/types';
import { authenticate, USER_FIELDS } from './auth';
import { HttpError, ok, fail, json, text, ids, date, limitedBody, previewMime } from './http';
import { memberRoom, messageById } from './data';
import { sendRoomPush } from './push';
type Connection = { userId: string; token: string; roomId: string; visible: boolean; seen: number };
export class ChatRoom extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    try {
      const user = await authenticate(request, this.env);
      const path = new URL(request.url).pathname.split('/');
      const roomId = path[3];
      const room = await memberRoom(this.env, roomId, user.id);
      if (path[4] === 'ws') return this.connectClient(request,user,room);
      // Serialize room state changes across D1 awaits; slow file transfer happens outside the lock.
      if (path[4] === 'attachments') return await this.upload(request,user,room);
      return await this.locked(async () => {
        const fresh = await memberRoom(this.env,roomId,user.id);
        if (path[4] === 'messages') {
          const b = await json(request);
          const message = await this.save(user, fresh, text(b.content,'메시지',10000),text(b.client_id,'메시지 ID',100), 'text');
          return ok(message,201);
        }
        if (fresh.status !== 'active') throw new HttpError(409,'ROOM_CLOSED','종료된 대화방에는 작성할 수 없습니다.');
        if (path[4] === 'close') return this.closeRoom(request,user,fresh);
        if (path[4] === 'members') return this.invite(request,user,fresh);
        throw new HttpError(404,'NOT_FOUND','경로를 찾을 수 없습니다.');
      });
    } catch (e) { return fail(e); }
  }
  private locked(action: () => Promise<Response>): Promise<Response> {
    // Handle validation inside the gate: uncaught errors reset the Durable Object and its sockets.
    return this.ctx.blockConcurrencyWhile(async () => { try { return await action(); } catch (error) { return fail(error); } });
  }
  private connectClient(request: Request, user: User, room: Room): Response {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') throw new HttpError(426,'WEBSOCKET','WebSocket 연결이 필요합니다.');
    if (this.ctx.getWebSockets(user.id).length >= 5) throw new HttpError(429,'TOO_MANY_TABS','대화방 탭을 일부 닫아 주세요.');
    const [client,server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server,[user.id]);
    server.serializeAttachment({ userId:user.id, token:request.headers.get('Cookie') || '', roomId:room.id, visible:false,seen:Date.now() } satisfies Connection);
    return new Response(null,{status:101,webSocket:client});
  }
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    try {
      if (typeof raw !== 'string' || raw.length > 200) { ws.close(1008,'Invalid frame'); return; }
      const c = ws.deserializeAttachment() as Connection;
      await authenticate(new Request('https://session.local',{headers:{Cookie:c.token}}),this.env);
      await memberRoom(this.env,c.roomId,c.userId);
      const b = JSON.parse(raw);
      if (b.type === 'presence' && typeof b.visible === 'boolean') ws.serializeAttachment({...c,visible:b.visible,seen:Date.now()});
      ws.send(JSON.stringify({type:'pong'}));
    } catch { ws.close(1008,'Session expired'); }
  }
  webSocketClose(ws: WebSocket): void { ws.close(); }
  webSocketError(ws: WebSocket): void { ws.close(1011,'Connection error'); }
  private async broadcast(event: unknown): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const c = ws.deserializeAttachment() as Connection;
        await authenticate(new Request('https://session.local',{headers:{Cookie:c.token}}),this.env);
        await memberRoom(this.env,c.roomId,c.userId);
        ws.send(JSON.stringify(event));
      } catch { ws.close(1008,'Session expired'); }
    }
  }
  private async save(user: User, room: Room, content: string, clientId: string, type: Message['type'], file?: {id:string; key:string; name:string; mime:string; size:number}): Promise<Message> {
    const existing = await this.env.DB.prepare('SELECT id FROM messages WHERE room_id=? AND user_id=? AND client_id=?').bind(room.id,user.id,clientId).first<{id:string}>();
    if (existing) return messageById(this.env,existing.id);
    if (room.status !== 'active') throw new HttpError(409,'ROOM_CLOSED','종료된 대화방에는 작성할 수 없습니다.');
    const id = crypto.randomUUID(); const now = Date.now();
    const statements = [
      this.env.DB.prepare("UPDATE rooms SET seq=seq+1 WHERE id=? AND status='active'").bind(room.id),
      this.env.DB.prepare('INSERT INTO messages(id,room_id,user_id,type,content,seq,client_id,created_at) SELECT ?,id,?,?,?,seq,?,? FROM rooms WHERE id=?').bind(id,user.id,type,content,clientId,now,room.id),
    ];
    if (file) statements.push(this.env.DB.prepare('INSERT INTO attachments(id,message_id,room_id,uploader_id,filename,mime_type,file_size,r2_key,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(file.id,id,room.id,user.id,file.name,file.mime,file.size,file.key,now));
    await this.env.DB.batch(statements);
    const message = await messageById(this.env,id);
    await this.broadcast({type:'message',message});
    const visible = this.ctx.getWebSockets().map(ws => ws.deserializeAttachment() as Connection).filter(c => c.visible && Date.now()-c.seen < 60_000).map(c=>c.userId);
    this.ctx.waitUntil(sendRoomPush(this.env,room.id,user.id,message,visible).catch(() => console.error('push_failed')));
    return message;
  }
  private async upload(request: Request, user: User, room: Room): Promise<Response> {
    const body = await limitedBody(request,21*1024*1024);
    let form: FormData;
    try { form = await new Response(body,{headers:{'Content-Type':request.headers.get('Content-Type') || ''}}).formData(); }
    catch { throw new HttpError(400,'INVALID_FILE','첨부파일 요청을 확인해 주세요.'); }
    const file = form.get('file'); const clientId = text(form.get('client_id'),'메시지 ID',100);
    if (!(file instanceof File) || file.size === 0 || file.size > 20*1024*1024) throw new HttpError(400,'INVALID_FILE','1바이트 이상, 20MB 이하 파일을 선택해 주세요.');
    const name = text(file.name,'파일 이름',240).replace(/[\x00-\x1f/\\]/g,'_');
    const id = crypto.randomUUID(); const key = `attachments/${room.id}/${id}`;
    const contents = await file.arrayBuffer();
    const mime = previewMime(new Uint8Array(contents,0,Math.min(contents.byteLength,12)));
    const duplicate = await this.env.DB.prepare('SELECT id FROM messages WHERE room_id=? AND user_id=? AND client_id=?').bind(room.id,user.id,clientId).first<{id:string}>();
    if (duplicate) return ok(await messageById(this.env,duplicate.id));
    if (room.status !== 'active') throw new HttpError(409,'ROOM_CLOSED','종료된 대화방에는 첨부할 수 없습니다.');
    // R2 stream completion can need input events: never await a stream while the DO input gate is locked.
    await this.env.FILES.put(key,contents,{httpMetadata:{contentType:mime}});
    const response = await this.locked(async () => {
      const fresh = await memberRoom(this.env,room.id,user.id);
      const existing = await this.env.DB.prepare('SELECT id FROM messages WHERE room_id=? AND user_id=? AND client_id=?').bind(room.id,user.id,clientId).first<{id:string}>();
      if (existing) return ok(await messageById(this.env,existing.id));
      if (fresh.status !== 'active') throw new HttpError(409,'ROOM_CLOSED','종료된 대화방에는 첨부할 수 없습니다.');
      return ok(await this.save(user,fresh,name,clientId,mime.startsWith('image/') ? 'image':'file',{id,key,name,mime,size:file.size}),201);
    });
    // A concurrent duplicate/close may win after upload; only remove this uncommitted object.
    const committed = await this.env.DB.prepare('SELECT id FROM attachments WHERE id=?').bind(id).first();
    if (!committed) await this.env.FILES.delete(key);
    return response;
  }
  private async closeRoom(request: Request, user: User, room: Room): Promise<Response> {
    const b = await json(request); const owner = text(b.owner_id,'담당자',100);
    const member = await this.env.DB.prepare('SELECT user_id FROM room_members WHERE room_id=? AND user_id=?').bind(room.id,owner).first();
    if (!member) throw new HttpError(400,'INVALID_OWNER','참여자 중 담당자를 선택해 주세요.');
    const now = Date.now();
    await this.env.DB.batch([
      this.env.DB.prepare("UPDATE rooms SET status='closed',closed_at=? WHERE id=? AND status='active'").bind(now,room.id),
      this.env.DB.prepare('INSERT INTO room_closures(room_id,conclusion,owner_id,due_date,note,closed_by,closed_at) VALUES(?,?,?,?,?,?,?)').bind(room.id,text(b.conclusion,'결론',10000),owner,date(b.due_date),text(b.note,'메모',10000,false),user.id,now),
      this.env.DB.prepare('INSERT INTO archive_jobs(room_id,created_at,updated_at) VALUES(?,?,?)').bind(room.id,now,now),
    ]);
    await this.broadcast({type:'room_closed'}); return ok(null);
  }
  private async invite(request: Request, user: User, room: Room): Promise<Response> {
    if (user.id !== room.created_by && user.role !== 'admin') throw new HttpError(403,'FORBIDDEN','대화방 생성자 또는 관리자만 초대할 수 있습니다.');
    const memberIds = ids((await json(request)).user_ids);
    if (!memberIds.length) throw new HttpError(400,'NO_MEMBERS','참여자를 선택해 주세요.');
    const existing = await this.env.DB.prepare('SELECT count(*) n FROM room_members WHERE room_id=?').bind(room.id).first<{n:number}>();
    if ((existing?.n || 0)+memberIds.length>50) throw new HttpError(400,'TOO_MANY_MEMBERS','대화방 참여자는 최대 50명입니다.');
    const valid = await this.env.DB.prepare(`SELECT id FROM users u WHERE id IN (${memberIds.map(()=>'?').join(',')}) AND (? IS NULL OR EXISTS(SELECT 1 FROM site_memberships sm WHERE sm.site_id=? AND sm.user_id=u.id AND sm.status='approved'))`).bind(...memberIds,room.site_id,room.site_id).all();
    if (valid.results.length !== memberIds.length) throw new HttpError(400,'INVALID_MEMBERS','등록된 사용자만 초대할 수 있습니다.');
    await this.env.DB.batch(memberIds.map(id=>this.env.DB.prepare('INSERT OR IGNORE INTO room_members(room_id,user_id,joined_at) VALUES(?,?,?)').bind(room.id,id,Date.now())));
    await this.broadcast({type:'members_changed'}); return ok(null);
  }
}
