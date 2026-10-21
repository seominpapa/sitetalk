import type { Env } from './env';
import type { User, Room } from '../../../packages/shared/types';
import { ROOM_TYPES } from '../../../packages/shared/types';
import { authenticate, login, logout, updateProfile, sameOrigin, rateLimit, USER_FIELDS } from './auth';
import { ok, fail, HttpError, json, text, ids, limitedBody } from './http';
import { memberRoom, messages } from './data';
import { validatePushSubscription } from './push';
import { runArchives } from './archive';
import { selectedSite, siteRoutes } from './sites';
import { summaryAccess, summaryRoutes } from './summaries';
import { aiSettings } from './ai-settings';
export { ChatRoom } from './room';

async function listRooms(env: Env, user: User, q = ''): Promise<Response> {
  const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const rows = await env.DB.prepare(`SELECT r.*, (SELECT count(*) FROM messages m WHERE m.room_id=r.id AND m.user_id<>? AND m.seq>coalesce(rr.last_read_seq,0)) unread_count
    FROM rooms r JOIN room_members rm ON rm.room_id=r.id AND rm.user_id=? LEFT JOIN room_reads rr ON rr.room_id=r.id AND rr.user_id=?
    WHERE (r.site_id IS NULL OR ?='admin' OR EXISTS(SELECT 1 FROM site_memberships sm WHERE sm.site_id=r.site_id AND sm.user_id=? AND sm.status='approved')) AND (?='' OR r.title LIKE ? ESCAPE '\\' OR r.purpose LIKE ? ESCAPE '\\' OR r.project LIKE ? ESCAPE '\\' OR r.work_category LIKE ? ESCAPE '\\' OR r.location LIKE ? ESCAPE '\\'
    OR EXISTS(SELECT 1 FROM messages m WHERE m.room_id=r.id AND m.content LIKE ? ESCAPE '\\')
    OR EXISTS(SELECT 1 FROM room_members rmm JOIN users u ON u.id=rmm.user_id WHERE rmm.room_id=r.id AND u.name LIKE ? ESCAPE '\\'))
    ORDER BY r.created_at DESC LIMIT 500`).bind(user.id,user.id,user.id,user.role,user.id,q,pattern,pattern,pattern,pattern,pattern,pattern,pattern).all();
  return ok(rows.results);
}
async function createRoom(request: Request, env: Env, user: User): Promise<Response> {
  const b = await json(request); const memberIds = [...new Set([user.id,...ids(b.member_ids)])];
  const siteId=await selectedSite(env,user,b.site_id);
  if (memberIds.length>50) throw new HttpError(400,'TOO_MANY_MEMBERS','참여자는 최대 50명입니다.');
  const valid = await env.DB.prepare(`SELECT id FROM users u WHERE id IN (${memberIds.map(()=>'?').join(',')}) AND (EXISTS(SELECT 1 FROM site_memberships sm WHERE sm.site_id=? AND sm.user_id=u.id AND sm.status='approved') OR (u.id=? AND u.role='admin'))`).bind(...memberIds,siteId,user.id).all();
  if (valid.results.length !== memberIds.length) throw new HttpError(400,'INVALID_MEMBERS','등록된 참여자를 선택해 주세요.');
  const type = b.type ?? '일반업무';
  if (!ROOM_TYPES.includes(type as typeof ROOM_TYPES[number])) throw new HttpError(400,'INVALID_TYPE','대화 유형을 확인해 주세요.');
  const keywords = b.keywords ?? [];
  if (!Array.isArray(keywords) || keywords.length>20 || keywords.some(k=> typeof k!=='string'||k.length>80)) throw new HttpError(400,'INVALID_KEYWORDS','키워드는 최대 20개입니다.');
  const id=crypto.randomUUID(); const now=Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO rooms(id,site_id,title,purpose,type,project,work_category,location,keywords,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(id,siteId,text(b.title,'제목'),text(b.purpose,'목적',4000),type,text(b.project,'프로젝트',200,false),text(b.work_category,'공종',200,false),text(b.location,'위치',200,false),JSON.stringify(keywords),user.id,now),
    ...memberIds.map(uid=>env.DB.prepare('INSERT INTO room_members(room_id,user_id,joined_at) VALUES(?,?,?)').bind(id,uid,now)),
  ]);
  return ok(await env.DB.prepare('SELECT * FROM rooms WHERE id=?').bind(id).first(),201);
}
async function roomDetail(env: Env, user: User, id: string): Promise<Response> {
  const room = await memberRoom(env,id,user.id);
  const [members,closure,archive] = await Promise.all([
    env.DB.prepare(`SELECT ${USER_FIELDS.split(',').map(f=>`u.${f}`).join(',')} FROM users u JOIN room_members rm ON rm.user_id=u.id WHERE rm.room_id=?`).bind(id).all(),
    env.DB.prepare('SELECT * FROM room_closures WHERE room_id=?').bind(id).first(),
    env.DB.prepare('SELECT status,error FROM archive_jobs WHERE room_id=?').bind(id).first(),
  ]);
  return ok({room,members:members.results,closure,archive});
}
async function markRead(request: Request, env: Env, user: User, roomId: string): Promise<Response> {
  await memberRoom(env,roomId,user.id); const b=await json(request);
  const message = await env.DB.prepare('SELECT id,seq FROM messages WHERE id=? AND room_id=?').bind(text(b.last_read_message_id,'메시지 ID',100),roomId).first<{id:string;seq:number}>();
  if (!message) throw new HttpError(400,'INVALID_READ','해당 대화방의 메시지가 아닙니다.');
  await env.DB.prepare(`INSERT INTO room_reads(room_id,user_id,last_read_seq,last_read_message_id,last_read_at) VALUES(?,?,?,?,?)
    ON CONFLICT(room_id,user_id) DO UPDATE SET last_read_seq=excluded.last_read_seq,last_read_message_id=excluded.last_read_message_id,last_read_at=excluded.last_read_at WHERE excluded.last_read_seq>room_reads.last_read_seq`).bind(roomId,user.id,message.seq,message.id,Date.now()).run();
  return ok(null);
}
async function download(request: Request, env: Env, user: User, id: string, sharedRoom?: string): Promise<Response> {
  const file = await env.DB.prepare('SELECT * FROM attachments WHERE id=?').bind(id).first<{room_id:string;r2_key:string;mime_type:string;filename:string}>();
  if (!file) throw new HttpError(404,'FILE_NOT_FOUND','파일을 찾을 수 없습니다.');
  if (sharedRoom) {
    if (file.room_id!==sharedRoom) throw new HttpError(404,'FILE_NOT_FOUND','파일을 찾을 수 없습니다.');
    await summaryAccess(env,user,sharedRoom);
  } else await memberRoom(env,file.room_id,user.id);
  const object = await env.FILES.get(file.r2_key);
  if (!object) throw new HttpError(404,'FILE_NOT_FOUND','파일을 찾을 수 없습니다.');
  const inline = new URL(request.url).searchParams.get('download') !== '1' && /^(image\/(png|jpeg|webp|gif)|application\/pdf)$/.test(file.mime_type);
  return new Response(object.body,{headers:{'Content-Type':file.mime_type,'Content-Length':String(object.size),'Content-Disposition':`${inline?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"}});
}
async function pushSubscription(request: Request, env: Env, user: User): Promise<Response> {
  const b=await json(request);
  if (request.method==='DELETE') { await env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?').bind(user.id,text(b.endpoint,'알림 주소',2048)).run(); return ok(null); }
  let subscription;
  try { subscription=validatePushSubscription(b); } catch { throw new HttpError(400,'INVALID_PUSH','지원하는 브라우저의 알림 구독을 확인해 주세요.'); }
  await env.DB.prepare(`INSERT INTO push_subscriptions(id,user_id,endpoint,p256dh,auth,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth,created_at=excluded.created_at`).bind(crypto.randomUUID(),user.id,subscription.endpoint,subscription.p256dh,subscription.auth,Date.now()).run();
  return ok(null,201);
}
async function route(request: Request, env: Env): Promise<Response> {
  const url=new URL(request.url); const p=url.pathname; const method=request.method;
  if (!p.startsWith('/api/')) return env.ASSETS.fetch(request);
  sameOrigin(request);
  if (p==='/api/health' && method==='GET') return ok({service:'Site Talk'});
  if (p==='/api/auth/login' && method==='POST') return login(request,env);
  if ((p==='/api/sites' && method==='GET') || (p==='/api/auth/register' && method==='POST')) {
    await rateLimit(env,`public:${request.headers.get('CF-Connecting-IP')||'local'}`,60);
    return (await siteRoutes(request,env,null))!;
  }
  const user=await authenticate(request,env);
  await rateLimit(env,`api:${user.id}`,240);
  const siteResponse=await siteRoutes(request,env,user);
  if (siteResponse) return siteResponse;
  if (p==='/api/admin/ai-settings' && ['GET','PUT'].includes(method)) return aiSettings(request,env,user);
  const summaryResponse=await summaryRoutes(request,env,user);
  if (summaryResponse) return summaryResponse;
  const sharedAttachment=p.match(/^\/api\/summaries\/([^/]+)\/attachments\/([^/]+)$/);
  if (sharedAttachment && method==='GET') return download(request,env,user,sharedAttachment[2],sharedAttachment[1]);
  if (p==='/api/auth/logout' && method==='POST') return logout(request,env);
  if (p==='/api/auth/me' && method==='GET') return ok(user);
  if (p==='/api/auth/me' && method==='PATCH') return updateProfile(request,env,user);
  if (p==='/api/rooms' && method==='GET') return listRooms(env,user);
  if (p==='/api/rooms' && method==='POST') return createRoom(request,env,user);
  if (p==='/api/search' && method==='GET') return listRooms(env,user,text(url.searchParams.get('q'),'검색어',100,false));
  if (p==='/api/settings' && method==='GET') return ok({vapid_public_key:env.VAPID_PUBLIC_KEY || null});
  if (p==='/api/push/subscriptions' && ['POST','DELETE'].includes(method)) return pushSubscription(request,env,user);
  if (p==='/api/admin/stats' && method==='GET') {
    if (user.role!=='admin') throw new HttpError(403,'FORBIDDEN','관리자만 접근할 수 있습니다.');
    const [users,rooms,storage,archive] = await Promise.all([env.DB.prepare(`SELECT ${USER_FIELDS} FROM users ORDER BY name`).all(),env.DB.prepare('SELECT * FROM rooms ORDER BY created_at DESC').all(),env.DB.prepare('SELECT coalesce(sum(file_size),0) n FROM attachments').first<{n:number}>(),env.DB.prepare("SELECT count(*) n FROM archive_jobs WHERE status='done'").first<{n:number}>()]);
    return ok({users:users.results,rooms:rooms.results,storage_bytes:storage?.n||0,archive_count:archive?.n||0});
  }
  const attachment=p.match(/^\/api\/attachments\/([^/]+)$/);
  if (attachment && method==='GET') return download(request,env,user,attachment[1]);
  const match=p.match(/^\/api\/rooms\/([^/]+)(?:\/(messages|attachments|read|close|members|ws|archive))?$/);
  if (match) {
    const [,id,action]=match;
    if (!action && method==='GET') return roomDetail(env,user,id);
    await memberRoom(env,id,user.id);
    if ((action==='ws' && method==='GET') || (['messages','attachments','close','members'].includes(action) && method==='POST')) {
      // Finish the incoming JSON stream before a DO can reject without reading its body.
      const forwarded = method==='POST' && action!=='attachments' ? new Request(request,{body:await limitedBody(request,32_768)}) : request;
      return env.ROOMS.get(env.ROOMS.idFromName(id)).fetch(forwarded);
    }
    if (action==='messages' && method==='GET') {
      const before=Number(url.searchParams.get('before')||Number.MAX_SAFE_INTEGER);
      if (!Number.isSafeInteger(before)||before<1) throw new HttpError(400,'INVALID_CURSOR','페이지 번호가 올바르지 않습니다.');
      return ok(await messages(env,id,before));
    }
    if (action==='read' && method==='POST') return markRead(request,env,user,id);
    if (action==='archive' && method==='GET') {
      const job=await env.DB.prepare("SELECT r2_key FROM archive_jobs WHERE room_id=? AND status='done'").bind(id).first<{r2_key:string}>();
      const object=job?await env.FILES.get(job.r2_key):null;
      if (!object) throw new HttpError(404,'ARCHIVE_PENDING','아카이브가 아직 생성되지 않았습니다.');
      return new Response(object.body,{headers:{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="${id}.md"`,'Cache-Control':'private, no-store'}});
    }
  }
  throw new HttpError(404,'NOT_FOUND','경로를 찾을 수 없습니다.');
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try { return await route(request,env); } catch(e) { return fail(e); }
  },
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(Date.now()),env.DB.prepare('DELETE FROM rate_limits WHERE reset_at<?').bind(Date.now()-3600000)]);
    await runArchives(env);
  },
} satisfies ExportedHandler<Env>;
