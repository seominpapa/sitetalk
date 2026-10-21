import type { Env } from './env';
import type { Room, Message, Attachment } from '../../../packages/shared/types';
import { HttpError } from './http.ts';
export async function memberRoom(env: Env, roomId: string, userId: string): Promise<Room> {
  const room = await env.DB.prepare(`SELECT r.* FROM rooms r JOIN room_members rm ON rm.room_id=r.id WHERE r.id=? AND rm.user_id=?
    AND (r.site_id IS NULL OR EXISTS(SELECT 1 FROM users WHERE id=? AND role='admin') OR EXISTS(SELECT 1 FROM site_memberships sm WHERE sm.site_id=r.site_id AND sm.user_id=? AND sm.status='approved'))`).bind(roomId,userId,userId,userId).first<Room>();
  if (!room) throw new HttpError(404, 'ROOM_NOT_FOUND', '대화방을 찾을 수 없거나 참여 권한이 없습니다.');
  return room;
}
export async function messageById(env: Env, id: string): Promise<Message> {
  const message = await env.DB.prepare('SELECT m.*,u.name user_name FROM messages m JOIN users u ON u.id=m.user_id WHERE m.id=?').bind(id).first<Message>();
  if (!message) throw new HttpError(404,'MESSAGE_NOT_FOUND','메시지를 찾을 수 없습니다.');
  const attachment = await env.DB.prepare('SELECT id,message_id,room_id,filename,mime_type,file_size FROM attachments WHERE message_id=?').bind(id).first<Attachment>();
  return attachment ? { ...message, attachment } : message;
}
export async function messages(env: Env, roomId: string, before: number): Promise<Message[]> {
  const rows = await env.DB.prepare('SELECT m.*,u.name user_name FROM messages m JOIN users u ON u.id=m.user_id WHERE m.room_id=? AND m.seq<? ORDER BY m.seq DESC LIMIT 50').bind(roomId,before).all<Message>();
  const list = rows.results.reverse();
  if (!list.length) return [];
  const files = await env.DB.prepare('SELECT id,message_id,room_id,filename,mime_type,file_size FROM attachments WHERE room_id=? AND message_id IN (SELECT id FROM messages WHERE room_id=? AND seq>=? AND seq<=?)').bind(roomId,roomId,list[0].seq,list[list.length-1].seq).all<Attachment>();
  return list.map(m => ({ ...m, attachment: files.results.find(a => a.message_id === m.id) }));
}
