import type { AiSettings, User } from '../../../packages/shared/types';
import { SUMMARY_MODELS } from '../../../packages/shared/ai-models.ts';
import type { Env } from './env';
import { base64url, unbase64url } from './crypto.ts';
import { HttpError, json, ok } from './http.ts';

const DEFAULT_MODEL = 'gpt-4.1-mini';
const associatedData = new TextEncoder().encode('site-talk:ai-settings:v1');
interface StoredSettings { encrypted_key: string; model: string; updated_at: number }
const unavailable = () => new HttpError(503, 'AI_SETTINGS_UNAVAILABLE', 'AI 설정 암호화 구성을 확인해 주세요. 저장된 키는 자동 대체되지 않습니다.');

function encryptionBytes(value: string | undefined): Uint8Array<ArrayBuffer> | null {
  if (!value || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return null;
  try { const bytes = unbase64url(value); return bytes.length === 32 ? bytes : null; } catch { return null; }
}
async function encryptionKey(env: Env) {
  const bytes = encryptionBytes(env.AI_SETTINGS_ENCRYPTION_KEY);
  if (!bytes) throw unavailable();
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(env: Env, value: string) {
  const key = await encryptionKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: associatedData }, key, new TextEncoder().encode(value));
  return `v1.${base64url(iv)}.${base64url(new Uint8Array(encrypted))}`;
}
async function unseal(env: Env, value: string) {
  try {
    const [version, nonce, ciphertext, extra] = value.split('.');
    if (version !== 'v1' || extra || !/^[A-Za-z0-9_-]{16}$/.test(nonce) || !/^[A-Za-z0-9_-]+$/.test(ciphertext)) throw unavailable();
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64url(nonce), additionalData: associatedData }, await encryptionKey(env), unbase64url(ciphertext));
    const key = new TextDecoder('utf-8', { fatal: true }).decode(plain);
    if (!validApiKey(key)) throw unavailable();
    return key;
  } catch { throw unavailable(); }
}
const validApiKey = (value: string) => /^sk-[A-Za-z0-9_-]{16,500}$/.test(value);
function model(value: unknown) {
  if (typeof value !== 'string' || !SUMMARY_MODELS.includes(value)) throw new HttpError(400, 'INVALID_MODEL', '지원하는 요약 모델을 선택해 주세요.');
  return value;
}
const storedSettings = (env: Env) => env.DB.prepare('SELECT encrypted_key,model,updated_at FROM ai_settings WHERE id=1').bind().first<StoredSettings>();

export async function configuredAiEnv(env: Env): Promise<Env> {
  const stored = await storedSettings(env);
  if (!stored) return env;
  if (!SUMMARY_MODELS.includes(stored.model)) throw unavailable();
  return { ...env, OPENAI_API_KEY: await unseal(env, stored.encrypted_key), OPENAI_MODEL: stored.model };
}

async function status(env: Env) {
  const stored = await storedSettings(env);
  if (stored) {
    if (!SUMMARY_MODELS.includes(stored.model)) throw unavailable();
    await unseal(env, stored.encrypted_key);
  }
  const latest = await env.DB.prepare(`SELECT j.room_id,r.title,j.status,j.error,j.updated_at FROM archive_jobs j
    JOIN rooms r ON r.id=j.room_id ORDER BY j.updated_at DESC,j.room_id LIMIT 1`).bind().first<NonNullable<AiSettings['last_archive']>>();
  const lastArchive = latest ? { ...latest, error: archiveError(latest.error) } : null;
  return { configured: Boolean(stored || env.OPENAI_API_KEY), source: stored ? 'database' : env.OPENAI_API_KEY ? 'environment' : 'none', storage_ready: Boolean(encryptionBytes(env.AI_SETTINGS_ENCRYPTION_KEY)), model: stored?.model || env.OPENAI_MODEL || DEFAULT_MODEL, updated_at: stored?.updated_at ?? null, last_archive: lastArchive };
}

function archiveError(error: string | null) {
  if (!error) return null;
  const known = ['AI output incomplete', 'AI output refused', 'AI output invalid JSON', 'AI output invalid schema', 'Archive context too large', 'Archive record too large', 'Archive request too large', 'Archive processing time budget exceeded', 'Archive lease lost', 'Closed room or closure missing', 'Archive failed; check configuration, service availability and retry'];
  return /^OpenAI HTTP \d{3}$/.test(error) || known.includes(error) ? error : '요약 처리에 실패했습니다. 설정과 서비스 상태를 확인해 주세요.';
}

export async function aiSettings(request: Request, env: Env, user: Pick<User, 'id' | 'role'>) {
  if (user.role !== 'admin') throw new HttpError(403, 'FORBIDDEN', '관리자만 AI 요약 설정을 변경할 수 있습니다.');
  if (request.method === 'GET') return ok(await status(env));
  if (request.method !== 'PUT') throw new HttpError(405, 'METHOD_NOT_ALLOWED', '지원하지 않는 요청입니다.');
  const body = await json(request);
  const selectedModel = model(body.model);
  if (body.api_key !== undefined && typeof body.api_key !== 'string') throw new HttpError(400, 'INVALID_API_KEY', 'API 키 형식을 확인해 주세요.');
  const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : '';
  if (apiKey && !validApiKey(apiKey)) throw new HttpError(400, 'INVALID_API_KEY', 'API 키 형식을 확인해 주세요.');
  await encryptionKey(env);
  const now = Date.now();
  if (apiKey) {
    const encrypted = await seal(env, apiKey);
    await env.DB.prepare(`INSERT INTO ai_settings(id,encrypted_key,model,updated_by,updated_at) VALUES (1,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET encrypted_key=excluded.encrypted_key,model=excluded.model,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
      .bind(encrypted, selectedModel, user.id, now).run();
  } else {
    const stored = await storedSettings(env);
    if (!stored) throw new HttpError(400, 'API_KEY_REQUIRED', '처음 등록할 때는 API 키가 필요합니다.');
    await unseal(env, stored.encrypted_key);
    await env.DB.prepare('UPDATE ai_settings SET model=?,updated_by=?,updated_at=? WHERE id=1').bind(selectedModel, user.id, now).run();
  }
  return ok(await status(env));
}
