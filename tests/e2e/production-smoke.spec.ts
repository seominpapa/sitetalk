import { test, expect, type APIResponse, type Page, type Response } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';

// Explicit opt-in only: this test creates isolated production fixtures, never saves an API key.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test('production smoke: signup approval, manager promotion and administrator API settings', async ({ browser, baseURL }) => {
  test.skip(process.env.E2E_PRODUCTION_SMOKE !== '1', 'Production writes require explicit opt-in.');
  test.setTimeout(180_000);
  const users = JSON.parse(readFileSync(process.env.E2E_CREDENTIALS_FILE || '.wrangler/remote-test-users.json', 'utf8'));
  const administrator = users.find((user: { role: string }) => user.role === 'admin');
  const manager = users.find((user: { role: string }) => user.role === 'member');
  expect(Boolean(administrator && manager && baseURL)).toBe(true);
  const journalPath = '.wrangler/prod-smoke-created.json';
  expect(existsSync(journalPath), 'Clean up the previous production smoke journal before another run.').toBe(false);
  const runId = randomUUID(), siteName = `[운영 검증] ${runId}`, staffName = `검증팀원-${runId.slice(0, 8)}`;
  const email = `prod-smoke-${runId}@example.invalid`, password = `${randomBytes(32).toString('base64url')}1!`;
  const journal = { run_id: runId, created_at: Date.now(), site_name: siteName, site_id: '', new_user_id: '', new_user_email: email, manager_user_id: manager.id };
  const saveJournal = () => writeFileSync(journalPath, JSON.stringify(journal, null, 2), { mode: 0o600 });
  mkdirSync('.wrangler', { recursive: true });
  saveJournal();
  const adminContext = await browser.newContext({ baseURL }), managerContext = await browser.newContext({ baseURL });
  const staffContext = await browser.newContext({ baseURL });
  const contexts = [adminContext, managerContext, staffContext];
  async function data(response: APIResponse | Response, status = 200) {
    expect(response.status()).toBe(status);
    const payload = await response.json(); expect(payload.success).toBe(true); return payload.data;
  }
  async function login(page: Page, user: { email: string; password: string }) {
    await page.goto('/');
    await page.getByLabel('이메일', { exact: true }).fill(user.email);
    await page.getByLabel('비밀번호', { exact: true }).fill(user.password);
    const response = page.waitForResponse(response => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await data(await response); await expect(page.getByRole('button', { name: '설정', exact: true })).toBeVisible();
  }
  async function settings(page: Page, tab: string) {
    await page.getByRole('button', { name: '설정', exact: true }).click();
    await page.getByRole('tab', { name: tab, exact: true }).click();
  }
  try {
    const adminPage = await adminContext.newPage(); await login(adminPage, administrator);
    const before = await data(await adminContext.request.get('/api/admin/ai-settings'));
    expect(before.storage_ready).toBe(true); expect(before.configured).toBe(before.source !== 'none');
    await settings(adminPage, 'AI 요약 설정');
    await expect(adminPage.getByLabel('OpenAI API 키')).toHaveValue('');
    await expect(adminPage.getByLabel('OpenAI API 키')).toHaveAttribute('type', 'password');
    await expect(adminPage.getByText(`키 등록: ${before.configured ? '등록됨' : '미등록'}`)).toBeVisible();
    await expect(adminPage.getByLabel('요약 모델')).toHaveValue(before.model);
    await adminPage.screenshot({ path: 'test-results/production-ai-settings.png', mask: [adminPage.getByLabel('OpenAI API 키')] });
    // Invalid syntax is rejected before encryption/storage; no fake usable key and no paid call.
    const invalidApiKey = 'invalid-key-format';
    await adminPage.getByLabel('OpenAI API 키').fill(invalidApiKey);
    const invalid = adminPage.waitForResponse(response => response.url().endsWith('/api/admin/ai-settings') && response.request().method() === 'PUT');
    await adminPage.getByRole('button', { name: 'AI 설정 저장', exact: true }).click();
    expect((await invalid).status()).toBe(400);
    await expect(adminPage.getByRole('alert')).toContainText('API 키 형식');
    await adminPage.getByLabel('OpenAI API 키').fill('');
    expect(await adminPage.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toMatch(/invalid-key-format|sk-/);
    expect(await data(await adminContext.request.get('/api/admin/ai-settings'))).toMatchObject({ configured: before.configured, source: before.source, storage_ready: before.storage_ready, model: before.model, updated_at: before.updated_at });
    await adminPage.getByRole('tab', { name: '승인 설정', exact: true }).click();
    await adminPage.getByLabel('새 현장 이름').fill(siteName);
    const createdSite = adminPage.waitForResponse(response => response.url().endsWith('/api/sites') && response.request().method() === 'POST');
    await adminPage.getByRole('button', { name: '현장 등록', exact: true }).click();
    journal.site_id = (await data(await createdSite, 201)).id; saveJournal();
    await adminPage.getByLabel('배정 현장').selectOption(journal.site_id);
    await adminPage.getByLabel('배정할 사용자').selectOption(manager.id);
    await adminPage.getByLabel('현장 역할').selectOption('manager');
    const assigned = adminPage.waitForResponse(response => response.url().endsWith(`/sites/${journal.site_id}/members/${manager.id}`) && response.request().method() === 'PUT');
    await adminPage.getByRole('button', { name: '배정 및 승인', exact: true }).click(); await data(await assigned);

    const staffPage = await staffContext.newPage(); await staffPage.goto('/');
    await staffPage.getByRole('button', { name: '가입 신청', exact: true }).click();
    await staffPage.getByLabel('이름', { exact: true }).fill(staffName);
    await staffPage.getByLabel('이메일', { exact: true }).fill(email);
    await staffPage.getByLabel('비밀번호', { exact: true }).fill(password);
    await staffPage.getByLabel('비밀번호 확인', { exact: true }).fill(password);
    await staffPage.getByLabel('가입할 현장').selectOption(journal.site_id);
    const registered = staffPage.waitForResponse(response => response.url().endsWith('/api/auth/register') && response.request().method() === 'POST');
    await staffPage.getByRole('button', { name: '가입 승인 요청', exact: true }).click(); await data(await registered, 201);
    const stats = await data(await adminContext.request.get('/api/admin/stats'));
    journal.new_user_id = stats.users.find((user: { email: string }) => user.email === email)?.id || ''; saveJournal();
    expect(Boolean(journal.new_user_id)).toBe(true);
    await expect(staffPage.getByRole('status')).toContainText('가입 신청을 접수했습니다');
    await login(staffPage, { email, password });
    await expect(staffPage.getByText('현장 가입 승인 대기 중입니다.', { exact: true })).toBeVisible();
    await expect(staffPage.getByRole('button', { name: '새 대화 만들기', exact: true })).toBeDisabled();
    expect((await staffContext.request.post('/api/rooms', { data: { site_id: journal.site_id, title: '차단 검증', purpose: '승인 전 차단', member_ids: [manager.id] } })).status()).toBe(403);
    expect((await staffContext.request.get('/api/admin/ai-settings')).status()).toBe(403);

    const managerPage = await managerContext.newPage(); await login(managerPage, manager);
    await settings(managerPage, '승인 설정');
    await expect(managerPage.getByLabel('배정 현장')).toHaveCount(0);
    await expect(managerPage.getByRole('tab', { name: 'AI 요약 설정', exact: true })).toHaveCount(0);
    const approved = managerPage.waitForResponse(response => response.url().endsWith(`/sites/${journal.site_id}/members/${journal.new_user_id}`) && response.request().method() === 'PUT');
    await managerPage.getByRole('button', { name: `${staffName} 팀원으로 승인`, exact: true }).click(); await data(await approved);
    const membership = () => staffContext.request.get('/api/me/memberships').then(response => data(response)).then(rows => rows.find((row: { site_id: string }) => row.site_id === journal.site_id));
    expect(await membership()).toMatchObject({ role: 'member', status: 'approved' });
    await staffPage.reload(); await expect(staffPage.getByRole('button', { name: '새 대화 만들기', exact: true })).toBeEnabled();
    await staffPage.getByRole('button', { name: '설정', exact: true }).click();
    await expect(staffPage.getByRole('tab', { name: 'AI 요약 설정', exact: true })).toHaveCount(0);

    await adminPage.getByRole('button', { name: '닫기', exact: true }).click(); await settings(adminPage, '승인 설정');
    const promoted = adminPage.waitForResponse(response => response.url().endsWith(`/sites/${journal.site_id}/members/${journal.new_user_id}`) && response.request().method() === 'PUT');
    await adminPage.getByRole('button', { name: `${staffName} 현장담당자로 승격`, exact: true }).click(); await data(await promoted);
    expect(await membership()).toMatchObject({ role: 'manager', status: 'approved' });
    expect((await data(await staffContext.request.get('/api/auth/me'))).role).toBe('member');
    await adminPage.screenshot({ path: 'test-results/production-approvals.png' });
    expect((await staffContext.request.get('/api/admin/ai-settings')).status()).toBe(403);
    expect((await staffContext.request.put('/api/admin/ai-settings', { data: { api_key: invalidApiKey, model: before.model } })).status()).toBe(403);
    expect(await data(await adminContext.request.get('/api/admin/ai-settings'))).toMatchObject({ configured: before.configured, source: before.source, storage_ready: before.storage_ready, model: before.model, updated_at: before.updated_at });
  } finally {
    // Revoke the test sessions even after a failed assertion; root cleans only journaled fixtures.
    await Promise.all(contexts.map(async context => {
      try { await context.request.post('/api/auth/logout'); } catch { /* Context closure still required. */ }
      finally { await context.close(); }
    }));
  }
});
