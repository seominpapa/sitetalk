import type { Env } from './env';
import type { User } from '../../../packages/shared/types';
import { HttpError, json, ok } from './http.ts';

const fields='r.id,r.user_id,r.site_name,r.status,r.site_id,r.created_at,r.updated_at,u.name,u.email,u.company,u.department';

async function decide(request: Request, env: Env, user: User, id: string): Promise<Response> {
  const {status}=await json(request);
  if (status!=='approved' && status!=='rejected') throw new HttpError(400,'INVALID_APPROVAL','승인 또는 반려를 선택해 주세요.');
  const current=await env.DB.prepare('SELECT status FROM site_creation_requests WHERE id=?').bind(id).first<{status:string}>();
  if (!current) throw new HttpError(404,'SITE_REQUEST_NOT_FOUND','현장 생성 신청을 찾을 수 없습니다.');
  if (current.status!=='pending') throw new HttpError(409,'APPROVAL_CHANGED','이미 처리된 현장 생성 신청입니다.');
  const now=Date.now(),siteId=status==='approved'?crypto.randomUUID():null;
  const update=env.DB.prepare("UPDATE site_creation_requests SET status=?,site_id=?,reviewed_by=?,updated_at=? WHERE id=? AND status='pending' RETURNING id").bind(status,siteId,user.id,now,id);
  const results=status==='approved'?await env.DB.batch([
    env.DB.prepare("INSERT INTO sites(id,name,created_by,created_at) SELECT ?,site_name,?,? FROM site_creation_requests WHERE id=? AND status='pending'").bind(siteId,user.id,now,id),
    env.DB.prepare("INSERT INTO site_memberships(site_id,user_id,role,status,reviewed_by,created_at,updated_at) SELECT ?,user_id,'manager','approved',?,?,? FROM site_creation_requests WHERE id=? AND status='pending' AND EXISTS(SELECT 1 FROM sites WHERE id=?)").bind(siteId,user.id,now,now,id,siteId),
    env.DB.prepare("INSERT INTO membership_events(id,site_id,user_id,actor_id,status,role,created_at) SELECT ?,site_id,user_id,?,'approved','manager',? FROM site_memberships WHERE site_id=?").bind(crypto.randomUUID(),user.id,now,siteId),
    update,
  ]):await env.DB.batch([update]);
  if (!results[results.length-1].results.length) throw new HttpError(409,'APPROVAL_CHANGED','이미 처리된 현장 생성 신청입니다.');
  return ok({status,site_id:siteId});
}

export async function siteRequestRoutes(request: Request, env: Env, user: User): Promise<Response | null> {
  const path=new URL(request.url).pathname;
  if (path==='/api/me/site-requests' && request.method==='GET') return ok((await env.DB.prepare(`SELECT ${fields} FROM site_creation_requests r JOIN users u ON u.id=r.user_id WHERE r.user_id=? ORDER BY r.created_at DESC`).bind(user.id).all()).results);
  const decision=path.match(/^\/api\/admin\/site-requests\/([^/]+)$/);
  if (!(path==='/api/admin/site-requests' && request.method==='GET') && !(decision && request.method==='PUT')) return null;
  if (user.role!=='admin') throw new HttpError(403,'FORBIDDEN','관리자만 현장 생성 신청을 검토할 수 있습니다.');
  if (decision) return decide(request,env,user,decision[1]);
  return ok((await env.DB.prepare(`SELECT ${fields} FROM site_creation_requests r JOIN users u ON u.id=r.user_id ORDER BY r.status,r.created_at DESC`).bind().all()).results);
}
