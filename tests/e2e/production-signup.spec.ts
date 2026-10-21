import { test, expect, type APIResponse, type BrowserContext, type Page, type Response } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';

type Applicant = { id: string; email: string; name: string; site_name: string };
type SiteRequest = { id: string; user_id: string; site_name: string; status: string; site_id: string | null };

// Production writes require opt-in; never capture login credentials in traces or screenshots.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test('production signup: password confirmation, manager site requests, approval and rejection', async ({ browser, baseURL }) => {
  test.skip(process.env.E2E_PRODUCTION_SIGNUP !== '1', 'Production writes require explicit opt-in.');
  test.setTimeout(180_000);
  expect(baseURL, 'A production base URL is required.').toBeTruthy();
  expect(new URL(baseURL!).hostname).not.toMatch(/^(localhost|127\.0\.0\.1)$/);
  const accounts = JSON.parse(readFileSync(process.env.E2E_CREDENTIALS_FILE || '.wrangler/remote-test-users.json', 'utf8'));
  const administrator = accounts.find((account: { role: string }) => account.role === 'admin');
  expect(Boolean(administrator), 'Administrator credentials are required.').toBe(true);
  const journalPath = '.wrangler/prod-signup-created.json';
  expect(existsSync(journalPath), 'Clean up the previous signup journal before another run.').toBe(false);
  const runId = randomUUID(), password = `${randomBytes(24).toString('base64url')}1!`;
  const applicant = (kind: string): Applicant => ({ id: '', email: `signup-${kind}-${runId}@example.invalid`, name: `운영검증-${kind}-${runId.slice(0, 8)}`, site_name: `[운영검증-${kind}] ${runId}` });
  const approved = applicant('approve'), rejected = applicant('reject'), staff = applicant('staff');
  const invalidPolicy = applicant('policy'), invalidConfirmation = applicant('confirmation');
  const journal = {
    run_id: runId, created_at: Date.now(), administrator_id: administrator.id,
    attempted_emails: [approved, rejected, staff, invalidPolicy, invalidConfirmation].map(value => value.email),
    users: [] as { id: string; email: string }[], requests: [] as SiteRequest[],
    sites: [] as { id: string; name: string }[],
    checks: {} as Record<string, boolean>, completed: false,
  };
  mkdirSync('.wrangler', { recursive: true });
  const saveJournal = () => writeFileSync(journalPath, JSON.stringify(journal, null, 2), { mode: 0o600 });
  saveJournal();
  const contexts: BrowserContext[] = [];
  async function context() { const value = await browser.newContext({ baseURL }); contexts.push(value); return value; }
  async function data(response: APIResponse | Response, status = 200) {
    expect(response.status(), 'Unexpected response status.').toBe(status);
    const payload = await response.json(); expect(payload.success).toBe(true); return payload.data;
  }
  const adminContext = await context(), approvedContext = await context(), rejectedContext = await context();
  const staffContext = await context(), publicContext = await context();
  async function captureCreated() {
    const stats = await data(await adminContext.request.get('/api/admin/stats'));
    journal.users = stats.users.filter((user: { id: string; email: string }) => journal.attempted_emails.includes(user.email)).map((user: { id: string; email: string }) => ({ id: user.id, email: user.email }));
    saveJournal();
    for (const value of [approved, rejected, staff]) value.id = journal.users.find(user => user.email === value.email)?.id || '';
    const requests: SiteRequest[] = await data(await adminContext.request.get('/api/admin/site-requests'));
    journal.requests = requests.filter(request => journal.users.some(user => user.id === request.user_id)).map(({ id, user_id, site_name, status, site_id }) => ({ id, user_id, site_name, status, site_id }));
    journal.sites = journal.requests.filter(request => request.site_id).map(request => ({ id: request.site_id!, name: request.site_name }));
    saveJournal();
  }
  async function login(page: Page, user: { email: string; password: string }) {
    await page.goto('/');
    await page.getByLabel('이메일', { exact: true }).fill(user.email);
    await page.getByLabel('비밀번호', { exact: true }).fill(user.password);
    const response = page.waitForResponse(value => value.url().endsWith('/api/auth/login') && value.request().method() === 'POST');
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await data(await response);
    await expect(page.getByRole('button', { name: '설정', exact: true })).toBeVisible();
  }
  async function settings(page: Page) {
    await page.getByRole('button', { name: '설정', exact: true }).click();
    await page.getByRole('tab', { name: '승인 설정', exact: true }).click();
  }
  async function registration(page: Page, user: Applicant, siteId?: string) {
    await page.goto('/');
    await page.getByRole('button', { name: '가입 신청', exact: true }).click();
    await page.getByLabel('가입 유형').selectOption(siteId ? 'member' : 'manager');
    await page.getByLabel('이름', { exact: true }).fill(user.name);
    await page.getByLabel('이메일', { exact: true }).fill(user.email);
    await page.getByLabel('비밀번호', { exact: true }).fill(password);
    await page.getByLabel('비밀번호 확인', { exact: true }).fill(password);
    if (siteId) await page.getByLabel('가입할 현장').selectOption(siteId);
    else await page.getByLabel('요청할 현장 이름', { exact: true }).fill(user.site_name);
  }
  async function submitRegistration(page: Page) {
    const response = page.waitForResponse(value => value.url().endsWith('/api/auth/register') && value.request().method() === 'POST');
    await page.getByRole('button', { name: '가입 승인 요청', exact: true }).click();
    const result = await response; await captureCreated(); await data(result, 201);
    await expect(page.getByRole('status')).toContainText('접수했습니다');
  }
  try {
    const adminPage = await adminContext.newPage(); await login(adminPage, administrator);
    const policyPage = await publicContext.newPage(); await registration(policyPage, invalidPolicy);
    const confirmation = policyPage.getByLabel('비밀번호 확인', { exact: true });
    await expect(confirmation).toHaveAttribute('type', 'password');
    await expect(confirmation).toHaveAttribute('autocomplete', 'new-password');
    await expect(confirmation).toHaveAttribute('required', '');
    await expect(confirmation).toHaveAttribute('minlength', '8');
    let registrationRequests = 0;
    policyPage.on('request', request => { if (new URL(request.url()).pathname === '/api/auth/register') registrationRequests++; });
    await confirmation.fill('');
    await policyPage.getByRole('button', { name: '가입 승인 요청', exact: true }).click();
    expect(await confirmation.evaluate(input => (input as HTMLInputElement).checkValidity())).toBe(false);
    for (const invalid of ['Abc1!xy', 'abcdefg!', 'abcd1234']) {
      await policyPage.getByLabel('비밀번호', { exact: true }).fill(invalid); await confirmation.fill(invalid);
      await policyPage.getByRole('button', { name: '가입 승인 요청', exact: true }).click();
      if (invalid.length >= 8) await expect(policyPage.getByRole('alert')).toContainText('숫자와 특수문자');
      else expect(await policyPage.getByLabel('비밀번호', { exact: true }).evaluate(input => (input as HTMLInputElement).checkValidity())).toBe(false);
    }
    await policyPage.getByLabel('비밀번호', { exact: true }).fill(password); await confirmation.fill('different1!');
    await policyPage.getByRole('button', { name: '가입 승인 요청', exact: true }).click();
    await expect(policyPage.getByRole('alert')).toContainText('일치');
    expect(registrationRequests).toBe(0);
    journal.checks.client_password_policy_and_confirmation = true; saveJournal();

    const approvedPage = await approvedContext.newPage(); await registration(approvedPage, approved); await submitRegistration(approvedPage);
    expect(Boolean(approved.id)).toBe(true);
    await login(approvedPage, { email: approved.email, password });
    await expect(approvedPage.getByText(`${approved.site_name} · 현장 생성 요청의 관리자 승인을 기다리고 있습니다.`, { exact: true })).toBeVisible();
    await expect(approvedPage.getByRole('button', { name: '새 대화 만들기', exact: true })).toBeDisabled();
    expect((await approvedContext.request.post('/api/sites', { data: { name: approved.site_name } })).status()).toBe(403);
    expect((await approvedContext.request.get('/api/admin/site-requests')).status()).toBe(403);
    const pending = (await data(await approvedContext.request.get('/api/me/site-requests')) as SiteRequest[]).find(request => request.user_id === approved.id);
    expect(pending?.status).toBe('pending'); expect(pending?.site_id).toBeNull();
    await settings(adminPage);
    const approvalResponse = adminPage.waitForResponse(response => response.url().endsWith(`/api/admin/site-requests/${pending!.id}`) && response.request().method() === 'PUT');
    await adminPage.getByRole('button', { name: `${approved.name} 현장 생성 승인`, exact: true }).click();
    const approval = await approvalResponse; await captureCreated();
    const siteId = (await data(approval)).site_id;
    expect(journal.sites.some(site => site.id === siteId)).toBe(true);
    const ownMemberships = await data(await approvedContext.request.get('/api/me/memberships'));
    expect(ownMemberships.some((row: { site_id: string; status: string; role: string }) => row.site_id === siteId && row.status === 'approved' && row.role === 'manager')).toBe(true);
    expect((await data(await approvedContext.request.get('/api/auth/me'))).role).toBe('member');
    await approvedPage.reload(); await expect(approvedPage.getByRole('button', { name: '새 대화 만들기', exact: true })).toBeEnabled();
    journal.checks.manager_request_and_admin_approval = true; saveJournal();

    const rejectedPage = await rejectedContext.newPage(); await registration(rejectedPage, rejected); await submitRegistration(rejectedPage);
    await login(rejectedPage, { email: rejected.email, password });
    const rejectedRequest = journal.requests.find(request => request.user_id === rejected.id)!;
    expect(Boolean(rejectedRequest)).toBe(true);
    expect((await rejectedContext.request.post('/api/rooms', { data: { site_id: siteId, title: '승인 전 차단 검증', purpose: '차단 검증', member_ids: [approved.id] } })).status()).toBe(403);
    expect((await rejectedContext.request.put(`/api/admin/site-requests/${rejectedRequest.id}`, { data: { status: 'approved' } })).status()).toBe(403);
    await adminPage.getByRole('button', { name: '닫기', exact: true }).click(); await settings(adminPage);
    const rejectionResponse = adminPage.waitForResponse(response => response.url().endsWith(`/api/admin/site-requests/${rejectedRequest.id}`) && response.request().method() === 'PUT');
    await adminPage.getByRole('button', { name: `${rejected.name} 현장 생성 반려`, exact: true }).click();
    const rejection = await rejectionResponse; await captureCreated(); await data(rejection);
    const rejectedOwn = (await data(await rejectedContext.request.get('/api/me/site-requests')) as SiteRequest[]).find(request => request.id === rejectedRequest.id);
    expect(rejectedOwn?.status).toBe('rejected'); expect(rejectedOwn?.site_id).toBeNull();
    expect((await data(await rejectedContext.request.get('/api/me/memberships'))).length).toBe(0);
    const allSites = await data(await adminContext.request.get('/api/sites'));
    expect(allSites.some((site: { name: string }) => site.name === rejected.site_name)).toBe(false);
    await rejectedPage.reload(); await expect(rejectedPage.getByText(`${rejected.site_name} · 현장 생성 요청이 반려되었습니다. 관리자에게 문의해 주세요.`, { exact: true })).toBeVisible();
    await expect(rejectedPage.getByRole('button', { name: '새 대화 만들기', exact: true })).toBeDisabled();
    journal.checks.admin_rejection_without_site_or_access = true; saveJournal();

    const staffPage = await staffContext.newPage(); await registration(staffPage, staff, siteId); await submitRegistration(staffPage);
    await login(staffPage, { email: staff.email, password });
    await expect(staffPage.getByRole('button', { name: '새 대화 만들기', exact: true })).toBeDisabled();
    await settings(approvedPage);
    const staffApprovalResponse = approvedPage.waitForResponse(response => response.url().endsWith(`/sites/${siteId}/members/${staff.id}`) && response.request().method() === 'PUT');
    await approvedPage.getByRole('button', { name: `${staff.name} 팀원으로 승인`, exact: true }).click(); await data(await staffApprovalResponse);
    const staffMemberships = await data(await staffContext.request.get('/api/me/memberships'));
    expect(staffMemberships.some((row: { site_id: string; role: string; status: string }) => row.site_id === siteId && row.role === 'member' && row.status === 'approved')).toBe(true);
    await staffPage.reload(); await expect(staffPage.getByRole('button', { name: '새 대화 만들기', exact: true })).toBeEnabled();
    journal.checks.team_signup_confirmation_and_manager_approval = true; saveJournal();

    // Three successful registrations plus two rejected API attempts stay within 5/IP/minute.
    const invalidBase = { registration_type: 'manager', company: '', department: '' };
    const invalidPasswordResponse = await publicContext.request.post('/api/auth/register', { data: { ...invalidBase, name: invalidPolicy.name, email: invalidPolicy.email, site_name: invalidPolicy.site_name, password: 'abcd1234', password_confirmation: 'abcd1234' } });
    await captureCreated(); expect(invalidPasswordResponse.status()).toBe(400);
    const invalidConfirmationResponse = await publicContext.request.post('/api/auth/register', { data: { ...invalidBase, name: invalidConfirmation.name, email: invalidConfirmation.email, site_name: invalidConfirmation.site_name, password, password_confirmation: 'different1!' } });
    await captureCreated(); expect(invalidConfirmationResponse.status()).toBe(400);
    expect(journal.users.some(user => [invalidPolicy.email, invalidConfirmation.email].includes(user.email))).toBe(false);
    expect(journal.users.length).toBe(3); expect(journal.requests.length).toBe(2); expect(journal.sites.length).toBe(1);
    journal.checks.server_password_policy_and_confirmation = true;
    journal.completed = true; saveJournal();
  } finally {
    await Promise.all(contexts.map(async value => {
      try { await value.request.post('/api/auth/logout'); } catch { /* Close every context even if logout is unavailable. */ }
      finally { await value.close(); }
    }));
  }
});
