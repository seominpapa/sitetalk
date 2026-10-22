import { test, expect, type APIResponse, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

const admin = JSON.parse(readFileSync(process.env.DOCKER_E2E_CREDENTIALS_FILE!, 'utf8'));
const password = `${admin.password}1!`;
const manager = { name: '도커 현장담당자', email: 'manager@example.invalid', password };
const member = { name: '도커 팀원', email: 'member@example.invalid', password };
const testApiKey = 'sk-docker-only-not-a-real-api-key';
const pdf = Buffer.from('%PDF-1.4\nSite Talk Docker test\n%%EOF');

async function data(response: Pick<APIResponse, 'ok' | 'url' | 'status' | 'json'>) {
  expect(response.ok(), `API ${response.url()} returned ${response.status()}`).toBe(true);
  const result = await response.json();
  expect(result.success).toBe(true);
  return result.data;
}
async function login(page: Page, account: { email: string; password: string }) {
  await page.goto('/');
  await page.getByLabel('이메일', { exact: true }).fill(account.email);
  await page.getByLabel('비밀번호', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.getByRole('button', { name: '설정', exact: true })).toBeVisible();
  const later = page.getByRole('button', { name: '나중에', exact: true });
  if (await later.isVisible()) await later.click();
}

test('fresh Docker installation: admin API settings, approvals, WebSocket chat and persistent attachment', async ({ browser }) => {
  const administrator = await browser.newContext({ baseURL: process.env.DOCKER_E2E_BASE_URL });
  const managerContext = await browser.newContext({ baseURL: process.env.DOCKER_E2E_BASE_URL });
  const memberContext = await browser.newContext({ baseURL: process.env.DOCKER_E2E_BASE_URL });
  const pa = await administrator.newPage(), pm = await managerContext.newPage(), pt = await memberContext.newPage();
  const errors: string[] = [];
  for (const page of [pa, pm, pt]) page.on('pageerror', error => errors.push(error.name));
  try {
    await login(pa, admin);
    await pa.getByRole('button', { name: '설정', exact: true }).click();
    await pa.getByRole('tab', { name: 'AI 요약 설정', exact: true }).click();
    await pa.getByLabel('OpenAI API 키', { exact: true }).fill(testApiKey);
    await pa.getByRole('button', { name: 'AI 설정 저장', exact: true }).click();
    await expect(pa.getByRole('status').filter({hasText:'AI 요약 설정을 저장했습니다'})).toBeVisible();
    await expect(pa.getByLabel('OpenAI API 키', { exact: true })).toHaveValue('');
    const settings = await data(await administrator.request.get('/api/admin/ai-settings'));
    expect(settings).toMatchObject({ configured: true, source: 'database', storage_ready: true });
    expect(JSON.stringify(settings)).not.toContain(testApiKey);
    expect(await pa.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(testApiKey);

    await data(await administrator.request.post('/api/sites', { data: { name: '직접 등록 Docker 현장' } }));
    await data(await managerContext.request.post('/api/auth/register', { data: { ...manager, password_confirmation: password, registration_type: 'manager', site_name: '도커 실시간 검증 현장' } }));
    await login(pm, manager);
    await expect(pm.getByRole('button', { name: '새 대화 만들기', exact: true })).toBeDisabled();
    expect((await managerContext.request.get('/api/admin/ai-settings')).status()).toBe(403);
    await pa.getByRole('tab', { name: '승인 설정', exact: true }).click();
    const approvedSite = pa.waitForResponse(response => /\/api\/admin\/site-requests\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === 'PUT');
    await pa.getByRole('button', { name: `${manager.name} 현장 생성 승인`, exact: true }).click();
    const siteId = (await data(await approvedSite)).site_id;
    expect(siteId).toBeTruthy();
    await data(await administrator.request.put(`/api/sites/${siteId}/summary-schedule`, { data: { enabled: false } }));

    await data(await memberContext.request.post('/api/auth/register', { data: { ...member, password_confirmation: password, registration_type: 'member', site_id: siteId } }));
    await login(pt, member);
    await expect(pt.getByRole('button', { name: '새 대화 만들기', exact: true })).toBeDisabled();
    await pm.reload();
    await pm.getByRole('button', { name: '설정', exact: true }).click();
    await expect(pm.getByRole('tab', { name: 'AI 요약 설정', exact: true })).toHaveCount(0);
    await pm.getByRole('tab', { name: '승인 설정', exact: true }).click();
    await pm.getByRole('button', { name: `${member.name} 팀원으로 승인`, exact: true }).click();
    await expect(pm.getByRole('status').filter({hasText:'권한을 변경했습니다'})).toBeVisible();
    await pt.reload();
    expect((await memberContext.request.get('/api/admin/ai-settings')).status()).toBe(403);
    expect((await memberContext.request.get('/api/admin/stats')).status()).toBe(403);

    const stats = await data(await administrator.request.get('/api/admin/stats'));
    const participantIds = stats.users.filter((user: { email: string }) => [manager.email, member.email].includes(user.email)).map((user: { id: string }) => user.id);
    expect(participantIds).toHaveLength(2);
    const room = await data(await administrator.request.post('/api/rooms', { data: { site_id: siteId, title: 'Docker 현장 실시간 대화', purpose: '독립 서버 통신과 첨부 영속성 확인', member_ids: participantIds } }));
    await pm.goto(`/rooms/${room.id}`);
    await pt.goto(`/rooms/${room.id}`);
    await expect(pm.getByText('실시간 연결됨', { exact: false })).toBeVisible();
    await expect(pt.getByText('실시간 연결됨', { exact: false })).toBeVisible();
    await pm.getByRole('textbox', { name: '메시지 입력' }).fill('Docker에서 안전 작업 계획을 공유합니다.');
    await pm.getByRole('textbox', { name: '메시지 입력' }).press('Enter');
    await expect(pt.getByText('Docker에서 안전 작업 계획을 공유합니다.', { exact: true })).toBeVisible();
    await pt.getByRole('textbox', { name: '메시지 입력' }).fill('현장팀원이 실시간으로 확인했습니다.');
    await pt.getByRole('textbox', { name: '메시지 입력' }).press('Enter');
    await expect(pm.getByText('현장팀원이 실시간으로 확인했습니다.', { exact: true })).toBeVisible();
    await pm.getByLabel('첨부파일 선택').setInputFiles({ name: 'Docker안전계획.pdf', mimeType: 'application/pdf', buffer: pdf });
    const link = pt.getByRole('link', { name: 'Docker안전계획.pdf 다운로드', exact: true });
    await expect(link).toBeVisible();
    const attachmentPath = (await link.getAttribute('href'))!;
    const download = await memberContext.request.get(attachmentPath);
    expect(download.status()).toBe(200);
    expect(await download.body()).toEqual(pdf);
    await pt.reload();
    await expect(pt.getByText('Docker에서 안전 작업 계획을 공유합니다.', { exact: true })).toBeVisible();
    await pm.getByRole('button', { name: '대화 종료', exact: true }).click();
    await pm.getByLabel('결론', { exact: false }).fill('Docker의 실시간 대화와 첨부파일 검증 완료');
    await pm.getByRole('combobox', { name: '담당자', exact: true }).selectOption({ label: member.name });
    await pm.getByRole('button', { name: '대화 종료 및 기록', exact: true }).click();
    await expect(pt.getByText('종료된 대화입니다.', { exact: false })).toBeVisible();
    expect((await memberContext.request.post(`/api/rooms/${room.id}/messages`, { data: { content: '종료 후 쓰기는 금지', client_id: crypto.randomUUID() } })).status()).toBe(409);
    expect(errors).toEqual([]);
    writeFileSync(process.env.DOCKER_E2E_STATE_FILE!, JSON.stringify({ roomId: room.id, siteId, attachmentPath, pdf: pdf.toString('base64') }), { mode: 0o600, flag: 'wx' });
  } finally {
    await Promise.all([administrator.close(), managerContext.close(), memberContext.close()]);
  }
});
