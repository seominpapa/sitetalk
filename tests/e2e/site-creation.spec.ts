import { test, expect, type APIResponse } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('real local signup, administrator site approval and rejection preserve role boundaries', async ({ browser }) => {
  test.skip(!!process.env.E2E_BASE_URL, 'Local fixtures only: do not create remote accounts or sites.');
  const users = JSON.parse(readFileSync('.wrangler/test-users.json', 'utf8'));
  const context = () => browser.newContext({ extraHTTPHeaders: { 'CF-Connecting-IP': `198.18.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}` } });
  const admin = await context(), applicant = await context(), rejected = await context();
  async function data(response: APIResponse, status = 200) {
    expect(response.status()).toBe(status); const body = await response.json(); expect(body.success).toBe(true); return body.data;
  }
  const suffix = crypto.randomUUID(), name = `신규담당자-${suffix}`, siteName = `생성신청-${suffix}`;
  const email = `site-request-${suffix}@example.invalid`, password = 'abcdef1!';
  try {
    await data(await admin.request.post('/api/auth/login', { data: { email: users[0].email, password: users[0].password } }));
    const before = await data(await admin.request.get('/api/sites'));
    const page = await applicant.newPage(); await page.goto('/');
    await page.getByRole('button', { name: '가입 신청', exact: true }).click();
    await page.getByLabel('가입 유형').selectOption('manager');
    await page.getByLabel('이름', { exact: true }).fill(name);
    await page.getByLabel('이메일', { exact: true }).fill(email);
    await page.getByLabel('비밀번호', { exact: true }).fill(password);
    await page.getByLabel('비밀번호 확인', { exact: true }).fill(password);
    await page.getByLabel('요청할 현장 이름').fill(siteName);
    const registered = page.waitForResponse(response => response.url().endsWith('/api/auth/register'));
    await page.getByRole('button', { name: '가입 승인 요청', exact: true }).click();
    expect((await registered).status()).toBe(201);
    await expect(page.getByRole('status')).toContainText('현장 생성 요청');
    expect((await data(await admin.request.get('/api/sites'))).length).toBe(before.length);
    await page.getByLabel('이메일', { exact: true }).fill(email);
    await page.getByLabel('비밀번호', { exact: true }).fill(password);
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await expect(page.getByText(`${siteName} · 현장 생성 요청의 관리자 승인을 기다리고 있습니다.`, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '새 대화 만들기', exact: true })).toBeDisabled();
    const [own] = await data(await applicant.request.get('/api/me/site-requests'));
    expect((await applicant.request.put(`/api/admin/site-requests/${own.id}`, { data: { status: 'approved' } })).status()).toBe(403);
    expect((await applicant.request.get('/api/admin/site-requests')).status()).toBe(403);
    const adminPage = await admin.newPage(); await adminPage.goto('/');
    await adminPage.getByRole('button', { name: '설정', exact: true }).click();
    await adminPage.getByRole('tab', { name: '승인 설정', exact: true }).click();
    const approved = adminPage.waitForResponse(response => response.url().endsWith(`/api/admin/site-requests/${own.id}`));
    await adminPage.getByRole('button', { name: `${name} 현장 생성 승인`, exact: true }).click();
    expect((await approved).status()).toBe(200);
    await expect(adminPage.getByRole('status')).toContainText('현장을 생성');
    const sites = await data(await admin.request.get('/api/sites'));
    expect(sites.filter((site: { name: string }) => site.name === siteName)).toHaveLength(1);
    expect((await data(await applicant.request.get('/api/me/memberships')))[0]).toMatchObject({ role: 'manager', status: 'approved' });
    expect((await data(await applicant.request.get('/api/auth/me'))).role).toBe('member');
    expect((await admin.request.put(`/api/admin/site-requests/${own.id}`, { data: { status: 'approved' } })).status()).toBe(409);
    await page.reload(); await expect(page.getByRole('button', { name: '새 대화 만들기', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '설정', exact: true }).click();
    await page.getByRole('tab', { name: '승인 설정', exact: true }).click();
    await expect(page.getByRole('heading', { name: '현장 생성 요청', exact: true })).toHaveCount(0);

    const rejectedName = `반려담당자-${suffix}`, rejectedEmail = `rejected-${suffix}@example.invalid`;
    await data(await rejected.request.post('/api/auth/register', { data: { name: rejectedName, email: rejectedEmail, password, password_confirmation:password, registration_type: 'manager', site_name: `반려현장-${suffix}` } }), 201);
    await data(await rejected.request.post('/api/auth/login', { data: { email: rejectedEmail, password } }));
    const [pending] = await data(await rejected.request.get('/api/me/site-requests'));
    expect((await data(await applicant.request.get('/api/me/site-requests'))).some((request: { id: string }) => request.id === pending.id)).toBe(false);
    await adminPage.reload(); await adminPage.getByRole('button', { name: '설정', exact: true }).click();
    await adminPage.getByRole('tab', { name: '승인 설정', exact: true }).click();
    const declined = adminPage.waitForResponse(response => response.url().endsWith(`/api/admin/site-requests/${pending.id}`));
    await adminPage.getByRole('button', { name: `${rejectedName} 현장 생성 반려`, exact: true }).click();
    expect((await declined).status()).toBe(200);
    expect(await data(await rejected.request.get('/api/me/memberships'))).toEqual([]);
    expect((await data(await admin.request.get('/api/sites'))).length).toBe(before.length + 1);
    const rejectedPage = await rejected.newPage(); await rejectedPage.goto('/');
    await expect(rejectedPage.getByText(/현장 생성 요청이 반려되었습니다/)).toBeVisible();
    await expect(rejectedPage.getByRole('button', { name: '새 대화 만들기', exact: true })).toBeDisabled();
  } finally {
    await Promise.all([admin, applicant, rejected].map(async context => {
      try { await context.request.post('/api/auth/logout'); } finally { await context.close(); }
    }));
  }
});
