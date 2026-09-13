import type { User } from '../../../packages/shared/types';
import type { Env } from './env';
import { base64url, hash, verifyPassword } from './crypto.ts';
import { HttpError, json, ok, text } from './http.ts';
export const USER_FIELDS = 'id,name,email,profile_image,company,department,role,notification_enabled';
// Public, non-account placeholder: failed logins perform one derivation in either case.
const DUMMY_PASSWORD_HASH = 'pbkdf2:100000:AAAAAAAAAAAAAAAAAAAAAA:QsMEKvnkUw65ucNL_jq2QUV3nwnUObUvIRh64ltzGyc';
export function cookie(request: Request): string | null { return request.headers.get('Cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith('sitetalk_session='))?.slice(17) || null; }
export async function authenticate(request: Request, env: Env): Promise<User> {
  const token = cookie(request);
  const user = token ? await env.DB.prepare(`SELECT ${USER_FIELDS.split(',').map(f => `u.${f}`).join(',')} FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?`).bind(await hash(token), Date.now()).first<User>() : null;
  if (!user) throw new HttpError(401, 'UNAUTHENTICATED', '로그인이 필요합니다.');
  return user;
}
export function sameOrigin(request: Request): void {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, 'ORIGIN', '허용되지 않은 출처입니다.');
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') throw new HttpError(403, 'ORIGIN', '허용되지 않은 출처입니다.');
}
export async function rateLimit(env: Env, key: string, limit: number): Promise<void> {
  const now = Date.now();
  const row = await env.DB.prepare(`INSERT INTO rate_limits(key,hits,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN reset_at<=? THEN 1 ELSE hits+1 END,reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END RETURNING hits`).bind(key, now + 60_000, now, now).first<{hits:number}>();
  if (!row || row.hits > limit) throw new HttpError(429, 'RATE_LIMIT', '요청이 많습니다. 1분 후 다시 시도해 주세요.');
}
export async function login(request: Request, env: Env): Promise<Response> {
  await rateLimit(env, `login:${request.headers.get('CF-Connecting-IP') || 'local'}`, 10);
  const body = await json(request);
  const email = text(body.email, '이메일', 254).trim().toLowerCase();
  const password = text(body.password, '비밀번호', 256);
  const user = await env.DB.prepare(`SELECT ${USER_FIELDS},password_hash FROM users WHERE email=?`).bind(email).first<User & {password_hash:string|null}>();
  const stored = user?.password_hash || DUMMY_PASSWORD_HASH;
  const valid = await verifyPassword(password, stored);
  if (!user || !user.password_hash || !valid) throw new HttpError(401, 'LOGIN_FAILED', '이메일 또는 비밀번호가 올바르지 않습니다.');
  const token = base64url(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').bind(await hash(token), user.id, Date.now()+7*86400_000, Date.now()).run();
  const { password_hash: _, ...safe } = user;
  const response = ok(safe);
  response.headers.set('Set-Cookie', sessionCookie(token, request, 604800));
  return response;
}
function sessionCookie(token: string, request: Request, seconds: number): string { return `sitetalk_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`; }
export async function logout(request: Request, env: Env): Promise<Response> {
  const token = cookie(request);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(token)).run();
  const response = ok(null); response.headers.set('Set-Cookie', sessionCookie('', request, 0)); return response;
}
export async function updateProfile(request: Request, env: Env, user: User): Promise<Response> {
  const b = await json(request);
  const notification = b.notification_enabled === undefined ? user.notification_enabled : typeof b.notification_enabled === 'boolean' ? Number(b.notification_enabled) : b.notification_enabled;
  if (notification !== 0 && notification !== 1) throw new HttpError(400, 'INVALID_INPUT', '알림 설정을 확인해 주세요.');
  await env.DB.prepare('UPDATE users SET name=?,company=?,department=?,notification_enabled=? WHERE id=?').bind(text(b.name ?? user.name,'이름',80),text(b.company ?? user.company,'회사',100,false),text(b.department ?? user.department,'부서',100,false),notification,user.id).run();
  return ok(await env.DB.prepare(`SELECT ${USER_FIELDS} FROM users WHERE id=?`).bind(user.id).first());
}
