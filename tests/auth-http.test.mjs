import assert from 'node:assert/strict';
import test from 'node:test';
import { authenticate, cookie, login, sameOrigin } from '../apps/worker/src/auth.ts';
import { passwordHash, verifyPassword, hash } from '../apps/worker/src/crypto.ts';
import { date, HttpError, json, limitedBody, fail, ok, previewMime } from '../apps/worker/src/http.ts';

const request = (body, headers = {}) => new Request('https://site.example/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const knownHash = 'pbkdf2:100000:AAAAAAAAAAAAAAAAAAAAAA:QsMEKvnkUw65ucNL_jq2QUV3nwnUObUvIRh64ltzGyc';
test('inline file MIME comes from a signature, not a claimed filename or content type', () => {
  for (const [bytes,mime] of [
    [[137,80,78,71,13,10,26,10],'image/png'], [[255,216,255],'image/jpeg'],
    [Buffer.from('GIF87a'),'image/gif'], [Buffer.from('GIF89a'),'image/gif'],
    [Buffer.from('RIFF1234WEBP'),'image/webp'], [Buffer.from('%PDF-1.4'),'application/pdf'],
    [Buffer.from('<html>fake.pdf</html>'),'application/octet-stream'],
    [[137,80,78],'application/octet-stream'], [Buffer.from('GIF00a'),'application/octet-stream'],
    [Buffer.from('RIFF1234WAVE'),'application/octet-stream'], [[], 'application/octet-stream'],
  ]) assert.equal(previewMime(new Uint8Array(bytes)),mime);
});
function loginEnvironment(user) {
  const sessions = [];
  return { sessions, DB: { prepare(sql) { return { bind(...args) { return {
    async first() { return sql.startsWith('INSERT INTO rate_limits') ? { hits: 1 } : user; },
    async run() { sessions.push({ sql, args }); },
  }; } }; } } };
}

test('calendar dates reject invalid values with 400 and accept leap days', () => {
  assert.equal(date('2024-02-29'), '2024-02-29');
  for (const value of ['', null, undefined]) assert.equal(date(value), null);
  for (const value of ['2026-99-01', '2026-02-29', '2026-02-30', '2026-00-01', '2026-01-00', 'not-a-date', 0, false]) {
    assert.throws(() => date(value), error => error instanceof HttpError && error.status === 400);
  }
});

test('cookie parser matches exact session cookie and authentication hashes it', async () => {
  const token = 'abc_-0123';
  const input = new Request('https://site.example/api/auth/me', { headers: { Cookie: `other=value; sitetalk_session=${token}; final=anything` } });
  assert.equal(cookie(input), token);
  for (const value of ['', 'sitetalk_session=', 'not_sitetalk_session=abc']) assert.equal(cookie(new Request('https://site.example', { headers: { Cookie: value } })), null);
  let bound;
  const env = { DB: { prepare(sql) { assert.match(sql, /expires_at>\?/); return { bind(...args) { bound = args; return { async first() { return { id: 'user' }; } }; } }; } } };
  assert.equal((await authenticate(input, env)).id, 'user');
  assert.equal(bound[0], await hash(token));
  await assert.rejects(authenticate(new Request('https://site.example'), env), error => error.status === 401);
});

test('failed login performs exactly one password derivation for known and unknown accounts', async t => {
  const original = crypto.subtle.deriveBits.bind(crypto.subtle);
  const derive = t.mock.method(crypto.subtle, 'deriveBits', (...args) => original(...args));
  for (const user of [{ id: 'user', password_hash: knownHash }, null, { id: 'google-user', password_hash: null }]) {
    const count = derive.mock.callCount();
    await assert.rejects(login(request({ email: 'worker@example.com', password: 'wrong' }), loginEnvironment(user)), error => error.status === 401 && error.code === 'LOGIN_FAILED');
    assert.equal(derive.mock.callCount() - count, 1);
  }
});

test('successful login stores hashed token and returns secure private session cookie', async () => {
  const password = crypto.randomUUID();
  const env = loginEnvironment({ id: 'user', email: 'worker@example.com', password_hash: await passwordHash(password) });
  const response = await login(request({ email: 'worker@example.com', password }), env);
  const sessionCookie = response.headers.get('set-cookie');
  assert.match(sessionCookie, /HttpOnly/);
  assert.match(sessionCookie, /SameSite=Strict/);
  assert.match(sessionCookie, /Secure/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const token = sessionCookie.split(';')[0].split('=')[1];
  assert.equal(env.sessions[0].args[0], await hash(token));
  assert.notEqual(env.sessions[0].args[0], token);
  assert.equal('password_hash' in (await response.json()).data, false);
});

test('JSON accepts its actual media type and rejects malformed or excessive bodies', async () => {
  assert.deepEqual(await json(request({ message: 'hello' }, { 'Content-Type': 'Application/JSON; charset=utf-8' })), { message: 'hello' });
  await assert.rejects(json(request({}, { 'Content-Type': 'text/application/json' })), error => error.status === 415);
  for (const value of [[], null, 'text']) await assert.rejects(json(request(value)), error => error.status === 400);
  await assert.rejects(json(request({ text: 'x'.repeat(33_000) })), error => error.status === 413);
  await assert.rejects(limitedBody(new Request('https://site.example', { method: 'POST', body: '12345' }), 4), error => error.status === 413);
});

test('origin checks prevent cross-site browser access and API errors remain uncached', async () => {
  sameOrigin(new Request('https://site.example/api', { headers: { Origin: 'https://site.example' } }));
  assert.throws(() => sameOrigin(new Request('https://site.example/api', { headers: { Origin: 'https://other.example' } })), error => error.status === 403);
  assert.throws(() => sameOrigin(new Request('https://site.example/api', { headers: { 'Sec-Fetch-Site': 'cross-site' } })), error => error.status === 403);
  for (const response of [ok({}), fail(new HttpError(401, 'UNAUTHENTICATED', '로그인 필요'))]) {
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
});

test('password verification accepts correct passwords and safely rejects malformed hashes', async () => {
  const stored = await passwordHash('correct password');
  assert.equal(await verifyPassword('correct password', stored), true);
  assert.equal(await verifyPassword('wrong password', stored), false);
  for (const malformed of ['invalid', 'pbkdf2:1:salt:hash', 'pbkdf2:100000:***:hash']) assert.equal(await verifyPassword('password', malformed), false);
});
