import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('local DO early denial consumes forwarded request without a stream error', async ({ playwright, baseURL }) => {
  test.skip(!!process.env.E2E_BASE_URL, 'Local stream regression never writes to production.');
  const users = JSON.parse(readFileSync('.wrangler/test-users.json', 'utf8'));
  const contexts = await Promise.all([0, 1].map(() => playwright.request.newContext({ baseURL, extraHTTPHeaders: { 'CF-Connecting-IP': `198.18.${Math.floor(Math.random()*250)}.${Math.floor(Math.random()*250)+1}` } })));
  try {
    for (const [index, context] of contexts.entries()) {
      expect((await context.post('/api/auth/login', { data: { email: users[index].email, password: users[index].password } })).status()).toBe(200);
    }
    const [owner, member] = contexts;
    const created = await owner.post('/api/rooms', { data: { site_id: users[0].site_id, title: '요청 스트림 회귀', purpose: '조기 거부 확인', member_ids: [users[1].id] } });
    expect(created.status()).toBe(201);
    const room = (await created.json()).data;
    const denied = await member.post(`/api/rooms/${room.id}/members`, { data: { user_ids: [users[2].id] } });
    expect(denied.status()).toBe(403);
    expect((await denied.json()).error.code).toBe('FORBIDDEN');
    const path = `/api/rooms/${room.id}`;
    // Keep authorization-first responses even when the forwarded body is malformed.
    expect((await member.post(`${path}/members`, { data: '{', headers: { 'Content-Type': 'application/json' } })).status()).toBe(403);
    expect((await owner.post(`${path}/members`, { data: '{', headers: { 'Content-Type': 'application/json' } })).status()).toBe(400);
    expect((await owner.post(`${path}/members`, { data: 'not-json', headers: { 'Content-Type': 'text/plain' } })).status()).toBe(415);
    const empty = JSON.stringify({ user_ids: [], padding: '' });
    const maximum = JSON.stringify({ user_ids: [], padding: 'x'.repeat(32_768 - empty.length) });
    expect((await member.post(`${path}/members`, { data: maximum, headers: { 'Content-Type': 'application/json' } })).status()).toBe(403);
    expect((await member.post(`${path}/members`, { data: maximum + ' ', headers: { 'Content-Type': 'application/json' } })).status()).toBe(413);
    expect((await owner.post(`${path}/members`, { data: { user_ids: [users[2].id] } })).status()).toBe(200);
    expect((await owner.post(`${path}/close`, { data: { conclusion: '정상 종료', owner_id: users[0].id } })).status()).toBe(200);
    expect((await member.post(`${path}/members`, { data: { user_ids: [users[2].id] } })).status()).toBe(409);
    expect((await member.post(`${path}/messages`, { data: { content: '종료 후 차단', client_id: crypto.randomUUID() } })).status()).toBe(409);
  } finally {
    await Promise.all(contexts.map(context => context.dispose()));
  }
});
