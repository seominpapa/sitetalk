import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createECDH } from 'node:crypto';
import { runArchives } from '../apps/worker/src/archive.ts';
import { sendRoomPush } from '../apps/worker/src/push.ts';
import { aiSettings } from '../apps/worker/src/ai-settings.ts';

function setup() {
  const db = new DatabaseSync(':memory:');
  for (const migration of ['0001_initial.sql', '0002_sites_and_settings.sql']) db.exec(readFileSync(new URL(`../database/migrations/${migration}`, import.meta.url), 'utf8'));
  for (const id of ['sender', 'visible', 'hidden', 'disabled']) db.prepare('INSERT INTO users(id,name,email,notification_enabled,created_at) VALUES (?,?,?,?,1)').run(id, id, `${id}@example.com`, id === 'disabled' ? 0 : 1);
  db.exec("INSERT INTO rooms(id,title,purpose,created_by,created_at) VALUES ('room','발파 협의','시간 변경','sender',1)");
  for (const id of ['sender', 'visible', 'hidden', 'disabled']) db.prepare("INSERT INTO room_members VALUES ('room',?,1)").run(id);
  db.exec("INSERT INTO messages(id,room_id,user_id,type,content,seq,created_at) VALUES ('message','room','sender','text','발파시간 16:30으로 변경',1,2)");
  const DB = {
    prepare(sql) { const statement = db.prepare(sql); const withArgs = args => ({ bind(...values) { return withArgs(values); }, async first() { return statement.get(...args) || null; }, async all() { return { results: statement.all(...args) }; }, async run() { const result = statement.run(...args); return { meta: { changes: Number(result.changes) } }; } }); return withArgs([]); },
    async batch(statements) { db.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.run()); db.exec('COMMIT'); return results; } catch (error) { db.exec('ROLLBACK'); throw error; } },
  };
  const files = new Map();
  return { db, files, env: { DB, FILES: { async put(key, content) { files.set(key, content); } }, OPENAI_API_KEY: 'fake-test-key' } };
}
function closeRoom(db) {
  db.exec("UPDATE rooms SET status='closed',closed_at=3 WHERE id='room'");
  db.exec("INSERT INTO room_closures(room_id,conclusion,closed_by,closed_at) VALUES ('room','변경 합의','sender',3)");
}
const response = () => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ summary: '시간 변경', decisions: ['16:30 발파'], actions: [], keywords: ['발파'] }) }] }] });

test('archive claims once across concurrent cron calls, stores raw original, then never repeats done jobs', async t => {
  const { db, env, files } = setup();
  t.after(() => db.close());
  closeRoom(db);
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests++;
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const request = JSON.parse(init.body);
    assert.equal(request.store, false);
    assert.equal(request.truncation, 'disabled');
    assert.equal(request.text.format.strict, true);
    assert.ok(request.input.includes('발파시간 16:30으로 변경'));
    return response();
  });
  const results = await Promise.all([runArchives(env), runArchives(env)]);
  assert.equal(results.reduce((sum, result) => sum + result.processed, 0), 1);
  assert.equal(requests, 1);
  assert.equal(files.size, 1);
  assert.ok([...files.values()][0].includes('발파시간 16:30으로 변경'));
  assert.equal(db.prepare('SELECT status,attempts FROM archive_jobs').get().status, 'done');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM summary_records').get().n, 1);
  await runArchives(env);
  assert.equal(requests, 1);
});

test('AI failure preserves messages and failed job; subsequent success retries; expired leases recover', async t => {
  const { db, env, files } = setup();
  t.after(() => db.close());
  closeRoom(db);
  let fail = true;
  t.mock.method(globalThis, 'fetch', async () => fail ? new Response('private upstream body', { status: 429 }) : response());
  t.mock.method(console, 'warn', () => {});
  assert.equal((await runArchives(env)).failed, 1);
  assert.equal(files.size, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM summary_records').get().n, 0);
  assert.equal(db.prepare('SELECT content FROM messages').get().content, '발파시간 16:30으로 변경');
  assert.equal(db.prepare('SELECT status,error FROM archive_jobs').get().error, 'OpenAI HTTP 429');
  db.exec("UPDATE archive_jobs SET status='processing',lease_until=1");
  fail = false;
  assert.equal((await runArchives(env)).processed, 1);
  assert.equal(db.prepare('SELECT attempts FROM archive_jobs').get().attempts, 2);
});

test('long room intermediate chunk failure never writes archive or marks done, retry completes all originals', async t => {
  const { db, env, files } = setup();
  t.after(() => db.close());
  const messages = Array.from({ length: 65 }, (_, index) => ({ id: `long-${index}`, content: `${index}:` + '가'.repeat(9500) }));
  for (const [index, message] of messages.entries()) db.prepare("INSERT INTO messages(id,room_id,user_id,type,content,seq,created_at) VALUES (?,'room','sender','text',?,?,2)").run(message.id, message.content, index + 2);
  closeRoom(db);
  let requests = 0;
  let fail = true;
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async (_, init) => {
    assert.ok(init.body.length <= 250_000);
    assert.ok(JSON.parse(init.body).input.length <= 250_000);
    requests++;
    return fail && requests === 2 ? new Response('', { status: 503 }) : response();
  });
  assert.equal((await runArchives(env)).failed, 1);
  assert.equal(files.size, 0);
  assert.equal(db.prepare('SELECT status FROM archive_jobs').get().status, 'failed');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM messages').get().n, 66);
  fail = false;
  assert.equal((await runArchives(env)).processed, 1);
  const markdown = [...files.values()][0];
  for (const message of messages) assert.ok(markdown.includes(message.content));
  assert.equal(db.prepare('SELECT status FROM archive_jobs').get().status, 'done');
});

test('lost lease between chunks stops further AI calls and does not overwrite a newer attempt', async t => {
  const { db, env, files } = setup();
  t.after(() => db.close());
  for (let index = 0; index < 40; index++) db.prepare("INSERT INTO messages(id,room_id,user_id,type,content,seq,created_at) VALUES (?,'room','sender','text',?,?,2)").run(`m${index}`, '가'.repeat(9500), index + 2);
  closeRoom(db);
  t.mock.method(console, 'warn', () => {});
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    db.exec('UPDATE archive_jobs SET attempts=attempts+1');
    return response();
  });
  assert.equal((await runArchives(env)).failed, 1);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(files.size, 0);
  const job = db.prepare('SELECT status,attempts FROM archive_jobs').get();
  assert.equal(job.status, 'processing');
  assert.equal(job.attempts, 2);
});

test('archive missing credentials does not consume retry budget; max attempts blocks repeated calls', async t => {
  const { db, env } = setup();
  t.after(() => db.close());
  closeRoom(db);
  t.mock.method(console, 'warn', () => {});
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected network'); });
  const missing = await runArchives({ ...env, OPENAI_API_KEY: undefined });
  assert.equal(missing.configurationMissing, true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM archive_jobs').get().n, 0);
  db.exec("INSERT INTO archive_jobs(room_id,status,attempts,created_at,updated_at) VALUES ('room','failed',5,1,1)");
  assert.equal((await runArchives(env)).processed, 0);
  assert.equal(fetch.mock.callCount(), 0);
});

test('one saved global API key is used by every archive and searchable summary records commit with done jobs', async t => {
  const { db, env } = setup();
  t.after(() => db.close());
  db.exec("UPDATE users SET role='admin' WHERE id='sender'");
  closeRoom(db);
  db.exec("INSERT INTO rooms(id,title,purpose,created_by,created_at,status,closed_at) VALUES ('room-2','안전 협의','작업 안전','sender',1,'closed',3)");
  db.exec("INSERT INTO room_closures(room_id,conclusion,closed_by,closed_at) VALUES ('room-2','합의','sender',3)");
  const configured = { ...env, AI_SETTINGS_ENCRYPTION_KEY: Buffer.alloc(32, 6).toString('base64') };
  const fakeKey = 'sk-global-test-only-not-real';
  await aiSettings(new Request('https://example.com/api/admin/ai-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: fakeKey, model: 'gpt-4.1' }) }), configured, { id: 'sender', role: 'admin' });
  const prepare = configured.DB.prepare;
  let settingsReads = 0;
  t.mock.method(configured.DB, 'prepare', function (sql) { if (sql.includes('FROM ai_settings')) settingsReads++; return prepare.call(this, sql); });
  const fetch = t.mock.method(globalThis, 'fetch', async (_, init) => {
    assert.equal(init.headers.Authorization, `Bearer ${fakeKey}`);
    assert.equal(JSON.parse(init.body).model, 'gpt-4.1');
    return response();
  });
  assert.equal((await runArchives(configured)).processed, 2);
  assert.equal(fetch.mock.callCount(), 2);
  assert.equal(settingsReads, 1);
  const records = db.prepare('SELECT s.*,j.status FROM summary_records s JOIN archive_jobs j ON j.room_id=s.room_id ORDER BY s.room_id').all();
  assert.equal(records.length, 2);
  for (const record of records) {
    assert.equal(record.status, 'done');
    assert.equal(record.summary, '시간 변경');
    assert.deepEqual(JSON.parse(record.decisions), ['16:30 발파']);
    assert.deepEqual(JSON.parse(record.keywords), ['발파']);
  }
});

test('unreadable saved global API key never falls back or consumes job retry budget', async t => {
  const { db, env } = setup();
  t.after(() => db.close());
  closeRoom(db);
  db.exec("INSERT INTO ai_settings(id,encrypted_key,model,updated_by,updated_at) VALUES (1,'v1.invalid.invalid','gpt-4.1-mini','sender',1)");
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not fall back'); });
  assert.equal((await runArchives(env)).configurationMissing, true);
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM archive_jobs').get().n, 0);
  assert.equal(JSON.stringify(warnings).includes('invalid'), false);
});

test('summary persistence failure rolls back done status so job can be retried', async t => {
  const { db, env } = setup();
  t.after(() => db.close());
  closeRoom(db);
  db.exec("CREATE TRIGGER summary_write_failure BEFORE INSERT ON summary_records BEGIN SELECT RAISE(ABORT, 'storage failure'); END");
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async () => response());
  assert.equal((await runArchives(env)).failed, 1);
  assert.equal(db.prepare('SELECT status FROM archive_jobs').get().status, 'failed');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM summary_records').get().n, 0);
  db.exec('DROP TRIGGER summary_write_failure');
  assert.equal((await runArchives(env)).processed, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM summary_records').get().n, 1);
});

test('push targets only hidden enabled members, uses encryption, forbids redirects, removes expired endpoint', async t => {
  const { db, env } = setup();
  t.after(() => db.close());
  const receiver = createECDH('prime256v1'); receiver.generateKeys();
  for (const id of ['sender', 'visible', 'hidden', 'disabled']) db.prepare('INSERT INTO push_subscriptions VALUES (?,?,?,?,?,1)').run(id, id, `https://fcm.googleapis.com/fcm/send/${id}`, receiver.getPublicKey().toString('base64url'), Buffer.alloc(16, 42).toString('base64url'));
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const configured = { ...env, VAPID_PUBLIC_KEY: Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url'), VAPID_PRIVATE_KEY: jwk.d, VAPID_SUBJECT: 'mailto:admin@example.com' };
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push(url);
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers['Content-Encoding'], 'aes128gcm');
    assert.ok(init.headers.Authorization.startsWith('vapid t='));
    assert.ok(init.body instanceof Uint8Array);
    return new Response(null, { status: 410 });
  });
  await sendRoomPush(configured, 'room', 'sender', { content: '변경', user_name: 'sender' }, ['visible']);
  assert.deepEqual(requests, ['https://fcm.googleapis.com/fcm/send/hidden']);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM push_subscriptions WHERE id='hidden'").get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM push_subscriptions').get().n, 3);
});

test('push transient failures keep subscription, redact errors, and missing credentials skip requests', async t => {
  const { db, env } = setup();
  t.after(() => db.close());
  const receiver = createECDH('prime256v1'); receiver.generateKeys();
  const endpoint = 'https://fcm.googleapis.com/fcm/send/PRIVATE_ENDPOINT_TOKEN';
  db.prepare('INSERT INTO push_subscriptions VALUES (?,?,?,?,?,1)').run('sub', 'hidden', endpoint, receiver.getPublicKey().toString('base64url'), Buffer.alloc(16, 42).toString('base64url'));
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const configured = { ...env, VAPID_PUBLIC_KEY: Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url'), VAPID_PRIVATE_KEY: jwk.d, VAPID_SUBJECT: 'mailto:admin@example.com' };
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  let shouldThrow = false;
  const fetch = t.mock.method(globalThis, 'fetch', async () => { if (shouldThrow) throw new Error(endpoint); return new Response('upstream private body', { status: 503 }); });
  const message = { content: 'PRIVATE_CONTENT', user_name: 'sender' };
  await sendRoomPush(env, 'room', 'sender', message, []);
  assert.equal(fetch.mock.callCount(), 0);
  await sendRoomPush(configured, 'room', 'sender', message, []);
  shouldThrow = true;
  await sendRoomPush(configured, 'room', 'sender', message, []);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM push_subscriptions').get().n, 1);
  assert.equal(warnings.length, 2);
  assert.equal(JSON.stringify(warnings).includes('PRIVATE'), false);
  await sendRoomPush(configured, 'missing', 'sender', message, []);
  assert.equal(fetch.mock.callCount(), 2);
});
