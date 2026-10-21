import type { Env } from './env';
import type { User } from '../../../packages/shared/types';
import { validRegistrationPassword, REGISTRATION_PASSWORD_MESSAGE, REGISTRATION_PASSWORD_CONFIRMATION_MESSAGE } from '../../../packages/shared/password-policy.ts';
import { USER_FIELDS, rateLimit } from './auth.ts';
import { passwordHash } from './crypto.ts';
import { HttpError, json, ok, text } from './http.ts';
import { siteRequestRoutes } from './site-requests.ts';
import { summaryScheduleRoutes } from './summary-schedule.ts';

const membershipFields = 'sm.*,s.name site_name,u.name,u.email,u.company,u.department';
export async function approvedSite(env: Env, siteId: string, userId: string): Promise<void> {
  const membership = await env.DB.prepare("SELECT user_id FROM site_memberships WHERE site_id=? AND user_id=? AND status='approved'").bind(siteId,userId).first();
  if (!membership) throw new HttpError(403,'SITE_APPROVAL_REQUIRED','해당 현장의 가입 승인이 필요합니다.');
}
async function manageSite(env: Env, user: User, siteId: string): Promise<void> {
  if (user.role === 'admin') return;
  const manager = await env.DB.prepare("SELECT user_id FROM site_memberships WHERE site_id=? AND user_id=? AND role='manager' AND status='approved'").bind(siteId,user.id).first();
  if (!manager) throw new HttpError(403,'FORBIDDEN','담당 현장의 가입 신청만 승인할 수 있습니다.');
}
export async function selectedSite(env: Env, user: User, value: unknown): Promise<string> {
  const own = value == null ? await env.DB.prepare("SELECT site_id FROM site_memberships WHERE user_id=? AND status='approved'").bind(user.id).all<{site_id:string}>() : null;
  const siteId = text(value ?? (own?.results.length === 1 ? own.results[0].site_id : ''),'현장',100);
  if (!await env.DB.prepare('SELECT id FROM sites WHERE id=?').bind(siteId).first()) throw new HttpError(404,'SITE_NOT_FOUND','현장을 찾을 수 없습니다.');
  if (user.role !== 'admin') await approvedSite(env,siteId,user.id);
  return siteId;
}
async function register(request: Request, env: Env): Promise<Response> {
  await rateLimit(env,`register:${request.headers.get('CF-Connecting-IP') || 'local'}`,5);
  const b=await json(request);
  const email=text(b.email,'이메일',254).trim().toLowerCase();
  const password=text(b.password,'비밀번호',256);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400,'INVALID_REGISTRATION','올바른 이메일을 입력해 주세요.');
  if (!validRegistrationPassword(password)) throw new HttpError(400,'INVALID_REGISTRATION',REGISTRATION_PASSWORD_MESSAGE);
  if (password!==text(b.password_confirmation,'비밀번호 확인',256)) throw new HttpError(400,'PASSWORD_MISMATCH',REGISTRATION_PASSWORD_CONFIRMATION_MESSAGE);
  const registrationType=b.registration_type===undefined?'member':b.registration_type;
  if (registrationType!=='member' && registrationType!=='manager') throw new HttpError(400,'INVALID_REGISTRATION','가입 유형을 확인해 주세요.');
  const siteName=registrationType==='manager'?text(typeof b.site_name==='string'?b.site_name.trim():b.site_name,'현장명',120):'';
  const siteId=registrationType==='member'?text(b.site_id,'현장',100):'';
  if (registrationType==='member' && !await env.DB.prepare('SELECT id FROM sites WHERE id=?').bind(siteId).first()) throw new HttpError(404,'SITE_NOT_FOUND','현장을 찾을 수 없습니다.');
  if (await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first()) throw new HttpError(409,'ACCOUNT_EXISTS','이미 등록된 계정입니다. 로그인하거나 관리자에게 현장 배정을 요청해 주세요.');
  const name=text(b.name,'이름',80).trim();
  const company=text(b.company,'회사',100,false),department=text(b.department,'부서',100,false);
  const id=crypto.randomUUID(),now=Date.now(),encoded=await passwordHash(password);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users(id,name,email,password_hash,company,department,role,created_at) VALUES(?,?,?,?,?,?,'member',?)").bind(id,name,email,encoded,company,department,now),
    registrationType==='manager'
      ? env.DB.prepare("INSERT INTO site_creation_requests(id,user_id,site_name,status,created_at,updated_at) VALUES(?,?,?,'pending',?,?)").bind(crypto.randomUUID(),id,siteName,now,now)
      : env.DB.prepare("INSERT INTO site_memberships(site_id,user_id,role,status,created_at,updated_at) VALUES(?,?,'member','pending',?,?)").bind(siteId,id,now,now),
  ]);
  return ok({status:'pending'},201);
}
async function decide(request: Request, env: Env, user: User, siteId: string, targetId: string): Promise<Response> {
  await manageSite(env,user,siteId);
  const b=await json(request),status=b.status,role=b.role ?? 'member';
  if (!['approved','rejected'].includes(String(status)) || !['member','manager'].includes(String(role))) throw new HttpError(400,'INVALID_APPROVAL','승인 상태와 현장 역할을 확인해 주세요.');
  if (user.role!=='admin' && role!=='member') throw new HttpError(403,'FORBIDDEN','관리자만 현장담당자를 지정할 수 있습니다.');
  if (!await env.DB.prepare('SELECT id FROM sites WHERE id=?').bind(siteId).first() || !await env.DB.prepare('SELECT id FROM users WHERE id=?').bind(targetId).first()) throw new HttpError(404,'NOT_FOUND','현장 또는 사용자를 찾을 수 없습니다.');
  const now=Date.now();
  const update=user.role==='admin'
    ? env.DB.prepare(`INSERT INTO site_memberships(site_id,user_id,role,status,reviewed_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(site_id,user_id) DO UPDATE SET role=excluded.role,status=excluded.status,reviewed_by=excluded.reviewed_by,updated_at=excluded.updated_at RETURNING user_id`).bind(siteId,targetId,role,status,user.id,now,now)
    : env.DB.prepare(`UPDATE site_memberships SET role='member',status=?,reviewed_by=?,updated_at=? WHERE site_id=? AND user_id=? AND status='pending'
        AND EXISTS(SELECT 1 FROM site_memberships actor WHERE actor.site_id=? AND actor.user_id=? AND actor.role='manager' AND actor.status='approved') RETURNING user_id`).bind(status,user.id,now,siteId,targetId,siteId,user.id);
  const [result]=await env.DB.batch([
    update,
    env.DB.prepare('INSERT INTO membership_events(id,site_id,user_id,actor_id,status,role,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()=1').bind(crypto.randomUUID(),siteId,targetId,user.id,status,role,now),
  ]);
  if (!result.results.length) throw new HttpError(409,'APPROVAL_CHANGED','이미 처리됐거나 승인 권한이 변경된 신청입니다.');
  return ok({status,role});
}
async function requestMembership(request: Request, env: Env, user: User): Promise<Response> {
  const b=await json(request),siteId=text(b.site_id,'현장',100),now=Date.now();
  if (!await env.DB.prepare('SELECT id FROM sites WHERE id=?').bind(siteId).first()) throw new HttpError(404,'SITE_NOT_FOUND','현장을 찾을 수 없습니다.');
  await env.DB.prepare("INSERT INTO site_memberships(site_id,user_id,role,status,created_at,updated_at) VALUES(?,?,'member','pending',?,?) ON CONFLICT(site_id,user_id) DO NOTHING").bind(siteId,user.id,now,now).run();
  return ok({requested:true});
}
export async function siteRoutes(request: Request, env: Env, user: User | null): Promise<Response | null> {
  const {pathname:p,searchParams}=new URL(request.url),method=request.method;
  if (p==='/api/auth/register' && method==='POST' && !user) return register(request,env);
  if (p==='/api/sites' && method==='GET') return ok((await env.DB.prepare('SELECT id,name FROM sites ORDER BY name').bind().all()).results);
  if (!user) return null;
  const scheduleResponse=await summaryScheduleRoutes(request,env,user);
  if (scheduleResponse) return scheduleResponse;
  const siteRequest=await siteRequestRoutes(request,env,user);
  if (siteRequest) return siteRequest;
  if (p==='/api/me/memberships' && method==='GET') return ok((await env.DB.prepare(`SELECT ${membershipFields} FROM site_memberships sm JOIN sites s ON s.id=sm.site_id JOIN users u ON u.id=sm.user_id WHERE sm.user_id=? ORDER BY s.name`).bind(user.id).all()).results);
  if (p==='/api/me/memberships' && method==='POST') return requestMembership(request,env,user);
  if (p==='/api/approvals' && method==='GET') {
    if (user.role!=='admin' && !await env.DB.prepare("SELECT user_id FROM site_memberships WHERE user_id=? AND role='manager' AND status='approved'").bind(user.id).first()) throw new HttpError(403,'FORBIDDEN','현장담당자 또는 관리자만 조회할 수 있습니다.');
    return ok((await env.DB.prepare(`SELECT ${membershipFields} FROM site_memberships sm JOIN sites s ON s.id=sm.site_id JOIN users u ON u.id=sm.user_id WHERE ?='admin' OR EXISTS(SELECT 1 FROM site_memberships actor WHERE actor.site_id=sm.site_id AND actor.user_id=? AND actor.role='manager' AND actor.status='approved') ORDER BY sm.status,s.name,u.name`).bind(user.role,user.id).all()).results);
  }
  if (p==='/api/sites' && method==='POST') {
    if (user.role!=='admin') throw new HttpError(403,'FORBIDDEN','관리자만 현장을 만들 수 있습니다.');
    const name=text((await json(request)).name,'현장명',120).trim(),id=crypto.randomUUID();
    await env.DB.prepare('INSERT INTO sites(id,name,created_by,created_at) VALUES(?,?,?,?)').bind(id,name,user.id,Date.now()).run();
    return ok({id,name},201);
  }
  const match=p.match(/^\/api\/sites\/([^/]+)\/members\/([^/]+)$/);
  if (match && method==='PUT') return decide(request,env,user,match[1],match[2]);
  if (p==='/api/users' && method==='GET') {
    const siteId=searchParams.get('site_id');
    if (siteId) {
      if (user.role!=='admin') await approvedSite(env,siteId,user.id);
      return ok((await env.DB.prepare(`SELECT ${USER_FIELDS.split(',').map(f=>`u.${f}`).join(',')} FROM users u JOIN site_memberships sm ON sm.user_id=u.id WHERE sm.site_id=? AND sm.status='approved' ORDER BY u.name LIMIT 1000`).bind(siteId).all()).results);
    }
    return ok((await env.DB.prepare(`SELECT DISTINCT ${USER_FIELDS.split(',').map(f=>`u.${f}`).join(',')} FROM users u JOIN site_memberships sm ON sm.user_id=u.id WHERE sm.status='approved' AND EXISTS(SELECT 1 FROM site_memberships own WHERE own.site_id=sm.site_id AND own.user_id=? AND own.status='approved') ORDER BY u.name LIMIT 1000`).bind(user.id).all()).results);
  }
  return null;
}
