import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { aiSettings, configuredAiEnv } from '../apps/worker/src/ai-settings.ts';

const admin = { id: 'admin', role: 'admin' };
const key = 'sk-test-only-not-a-real-credential';
function setup(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  for (const file of ['0001_initial.sql', '0002_sites_and_settings.sql']) db.exec(readFileSync(new URL(`../database/migrations/${file}`, import.meta.url), 'utf8'));
  db.exec("INSERT INTO users(id,name,email,role,created_at) VALUES ('admin','Admin','admin@example.com','admin',1)");
  const DB = { prepare(sql) { const statement = db.prepare(sql); const withArgs = (args) => ({ bind(...values) { return withArgs(values); }, async first() { return statement.get(...args) || null; }, async run() { const result = statement.run(...args); return { meta: { changes: result.changes } }; } }); return withArgs([]); } };
  return { db, env: { DB, AI_SETTINGS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), OPENAI_API_KEY: 'environment-only-test-key' } };
}
function request(body, method = 'PUT') {
  return new Request('https://example.com/api/admin/ai-settings', { method, headers: { 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) });
}
async function data(response) { return (await response.json()).data; }

test('admin stores encrypted global key, never returns key, and persisted settings override environment', async t => {
  const { db, env } = setup(t);
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No upstream calls during settings save'); });
  const saved = await aiSettings(request({ api_key: key, model: 'gpt-4.1-mini' }), env, admin);
  assert.deepEqual(await data(saved), { configured: true, source: 'database', storage_ready: true, model: 'gpt-4.1-mini', updated_at: db.prepare('SELECT updated_at FROM ai_settings').get().updated_at, last_archive: null });
  const row = db.prepare('SELECT * FROM ai_settings').get();
  assert.equal(JSON.stringify(row).includes(key), false);
  assert.equal(row.updated_by, 'admin');
  const settings = await aiSettings(request(null, 'GET'), env, admin);
  assert.equal((await settings.text()).includes(key), false);
  assert.equal((await configuredAiEnv(env)).OPENAI_API_KEY, key);
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(JSON.stringify(warnings).includes(key), false);
});

test('nonadmins are rejected before storage or request parsing', async () => {
  const env = { DB: { prepare() { throw new Error('Storage must not be accessed'); } } };
  for (const method of ['GET', 'PUT']) await assert.rejects(aiSettings(request({}, method), env, { id: 'member', role: 'member' }), error => error.status === 403);
});

test('no database key uses environment default; no configured key is reported without inventing one', async t => {
  const { env } = setup(t);
  assert.equal((await configuredAiEnv(env)).OPENAI_API_KEY, env.OPENAI_API_KEY);
  assert.deepEqual(await data(await aiSettings(request(null, 'GET'), { ...env, OPENAI_API_KEY: undefined, AI_SETTINGS_ENCRYPTION_KEY: undefined }, admin)), { configured: false, source: 'none', storage_ready: false, model: 'gpt-4.1-mini', updated_at: null, last_archive: null });
});

test('blank replacement preserves the key but updates validated model', async t => {
  const { env } = setup(t);
  await aiSettings(request({ api_key: key, model: 'gpt-4.1-mini' }), env, admin);
  await aiSettings(request({ api_key: '   ', model: 'gpt-4.1' }), env, admin);
  const effective = await configuredAiEnv(env);
  assert.equal(effective.OPENAI_API_KEY, key);
  assert.equal(effective.OPENAI_MODEL, 'gpt-4.1');
});

test('GPT-6 catalog models save and load without replacing the encrypted key or calling OpenAI', async t => {
  const { db, env } = setup(t);
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No upstream calls during model changes'); });
  await aiSettings(request({ api_key: key, model: 'gpt-4.1-mini' }), env, admin);
  const ciphertext = db.prepare('SELECT encrypted_key FROM ai_settings').get().encrypted_key;
  for (const model of ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra']) {
    const saved = await data(await aiSettings(request({ model }), env, admin));
    assert.equal(saved.model, model);
    assert.equal(saved.configured, true);
    assert.equal(JSON.stringify(saved).includes(key), false);
    assert.equal(db.prepare('SELECT encrypted_key FROM ai_settings').get().encrypted_key, ciphertext);
    const effective = await configuredAiEnv(env);
    assert.equal(effective.OPENAI_MODEL, model);
    assert.equal(effective.OPENAI_API_KEY, key);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('first save requires a key; unknown models and malformed keys are rejected', async t => {
  const { env } = setup(t);
  for (const body of [{ model: 'gpt-4.1-mini' }, { api_key: key, model: 'https://attacker.example' }, { api_key: 'short', model: 'gpt-4.1-mini' }, { api_key: key + '\nInjected', model: 'gpt-4.1-mini' }, { api_key: 42, model: 'gpt-4.1-mini' }]) {
    await assert.rejects(aiSettings(request(body), env, admin), error => error.status === 400);
  }
});

test('missing, malformed, wrong encryption keys and tampered ciphertext fail closed without fallback or raw errors', async t => {
  const { db, env } = setup(t);
  for (const invalid of [undefined, 'invalid', Buffer.alloc(16).toString('base64')]) {
    await assert.rejects(aiSettings(request({ api_key: key, model: 'gpt-4.1-mini' }), { ...env, AI_SETTINGS_ENCRYPTION_KEY: invalid }, admin), error => error.status === 503 && !error.message.includes(key));
  }
  await aiSettings(request({ api_key: key, model: 'gpt-4.1-mini' }), env, admin);
  for (const invalid of [undefined, Buffer.alloc(32, 9).toString('base64')]) {
    await assert.rejects(configuredAiEnv({ ...env, AI_SETTINGS_ENCRYPTION_KEY: invalid }), error => error.status === 503 && !error.message.includes(key));
  }
  db.prepare('UPDATE ai_settings SET encrypted_key=?').run('v1:not-valid:not-valid');
  await assert.rejects(configuredAiEnv(env), error => error.status === 503 && !error.message.includes('not-valid'));
  await assert.rejects(aiSettings(request(null, 'GET'), env, admin), error => error.status === 503);
});

test('unsupported methods are rejected', async t => {
  const { env } = setup(t);
  await assert.rejects(aiSettings(request({}, 'DELETE'), env, admin), error => error.status === 405);
});

test('admin sees latest real archive status without upstream error content or fake connectivity claims', async t => {
  const { db, env } = setup(t);
  for (const id of ['older', 'newer']) db.prepare("INSERT INTO rooms(id,title,purpose,created_by,created_at) VALUES (?,?,'요약','admin',1)").run(id, `${id} 대화`);
  db.exec("INSERT INTO archive_jobs(room_id,status,attempts,error,created_at,updated_at) VALUES ('older','done',1,NULL,1,10),('newer','failed',1,'OpenAI HTTP 429',1,20)");
  const latest = (await data(await aiSettings(request(null, 'GET'), env, admin))).last_archive;
  assert.deepEqual(latest, { room_id: 'newer', title: 'newer 대화', status: 'failed', error: 'OpenAI HTTP 429', updated_at: 20 });
  db.prepare("UPDATE archive_jobs SET error=? WHERE room_id='newer'").run(`upstream private ${key}`);
  const safe = await data(await aiSettings(request(null, 'GET'), env, admin));
  assert.equal(JSON.stringify(safe).includes(key), false);
  assert.equal(safe.last_archive.error, '요약 처리에 실패했습니다. 설정과 서비스 상태를 확인해 주세요.');
  db.exec("UPDATE archive_jobs SET status='done',error=NULL,updated_at=30 WHERE room_id='newer'");
  const saved = await data(await aiSettings(request({ api_key: key, model: 'gpt-4.1-mini' }), env, admin));
  assert.equal(saved.last_archive.status, 'done');
  assert.equal(saved.last_archive.error, null);
  assert.equal(saved.last_archive.updated_at, 30);
});
