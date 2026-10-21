import type { Env } from './env';
import type { ConversationSummary, Room, User } from '../../../packages/shared/types';
import { HttpError, ok, text } from './http.ts';
import { messages } from './data.ts';
import { USER_FIELDS } from './auth.ts';

type StoredSummary = Omit<ConversationSummary,'decisions'|'actions'|'keywords'> & {decisions:string;actions:string;keywords:string};
const fields='sr.*,r.id room_id,r.site_id,r.title,r.project,r.closed_at,s.name site_name';
const access="r.site_id IS NOT NULL AND r.status='closed' AND aj.status='done' AND (?='admin' OR EXISTS(SELECT 1 FROM site_memberships sm WHERE sm.site_id=r.site_id AND sm.user_id=? AND sm.status='approved'))";
const tables='summary_records sr JOIN rooms r ON r.id=sr.room_id JOIN sites s ON s.id=r.site_id JOIN archive_jobs aj ON aj.room_id=r.id';
function publicSummary(row: StoredSummary): ConversationSummary {
  return {...row,decisions:JSON.parse(row.decisions),actions:JSON.parse(row.actions),keywords:JSON.parse(row.keywords)};
}
export async function summaryAccess(env: Env, user: User, roomId: string): Promise<StoredSummary> {
  const row=await env.DB.prepare(`SELECT ${fields} FROM ${tables} WHERE r.id=? AND ${access}`).bind(roomId,user.role,user.id).first<StoredSummary>();
  if (!row) throw new HttpError(404,'SUMMARY_NOT_FOUND','요약을 찾을 수 없거나 현장 열람 권한이 없습니다.');
  return row;
}
export async function summaryRoutes(request: Request, env: Env, user: User): Promise<Response | null> {
  if (request.method!=='GET') return null;
  const {pathname:p,searchParams}=new URL(request.url);
  if (p==='/api/summaries') {
    const q=text(searchParams.get('q'),'검색어',100,false).trim();
    const pattern=`%${q.replace(/[\\%_]/g,'\\$&')}%`,site=searchParams.get('site_id')||'';
    const rows=await env.DB.prepare(`SELECT ${fields} FROM ${tables} WHERE ${access} AND (?='' OR r.site_id=?)
      AND (?='' OR r.title LIKE ? ESCAPE '\\' OR r.project LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\' OR sr.summary LIKE ? ESCAPE '\\' OR sr.decisions LIKE ? ESCAPE '\\' OR sr.actions LIKE ? ESCAPE '\\' OR sr.keywords LIKE ? ESCAPE '\\') ORDER BY r.closed_at DESC,r.id LIMIT 100`)
      .bind(user.role,user.id,site,site,q,pattern,pattern,pattern,pattern,pattern,pattern,pattern).all<StoredSummary>();
    return ok(rows.results.map(publicSummary));
  }
  const match=p.match(/^\/api\/summaries\/([^/]+)(?:\/(transcript|archive))?$/);
  if (!match) return null;
  const [,roomId,action]=match,row=await summaryAccess(env,user,roomId);
  if (!action) return ok(publicSummary(row));
  if (action==='archive') {
    const job=await env.DB.prepare("SELECT r2_key FROM archive_jobs WHERE room_id=? AND status='done'").bind(roomId).first<{r2_key:string}>();
    const object=job?.r2_key ? await env.FILES.get(job.r2_key) : null;
    if (!object) throw new HttpError(404,'ARCHIVE_NOT_FOUND','보관 파일을 찾을 수 없습니다.');
    return new Response(object.body,{headers:{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="${encodeURIComponent(roomId)}.md"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }
  const before=Number(searchParams.get('before')||Number.MAX_SAFE_INTEGER);
  if (!Number.isSafeInteger(before)||before<1) throw new HttpError(400,'INVALID_CURSOR','페이지 번호가 올바르지 않습니다.');
  const room=await env.DB.prepare('SELECT * FROM rooms WHERE id=?').bind(roomId).first<Room>();
  const members=await env.DB.prepare(`SELECT ${USER_FIELDS.split(',').map(field=>`u.${field}`).join(',')} FROM users u JOIN room_members rm ON rm.user_id=u.id WHERE rm.room_id=? ORDER BY u.name`).bind(roomId).all<User>();
  const history=await messages(env,roomId,before);
  const older=history.length ? await env.DB.prepare('SELECT id FROM messages WHERE room_id=? AND seq<? LIMIT 1').bind(roomId,history[0].seq).first() : null;
  return ok({room,members:members.results,messages:history,has_more:!!older});
}
