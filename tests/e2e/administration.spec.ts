import { test, expect, type Page } from '@playwright/test';

const admin = { id: 'admin-ui', name: '관리자', email: 'admin@example.test', company: '현장', department: '', role: 'admin', notification_enabled: 0 };
const member = { ...admin, id: 'member-ui', name: '현장직원', role: 'member' };
const site = { id: 'site-ui', name: '승인 테스트 현장' };
const membership = { ...site, site_id: site.id, site_name: site.name, user_id: member.id, name: member.name, email: member.email, company: '', department: '', role: 'member', status: 'pending' };
async function mock(page: Page, user: typeof admin | null, memberships: unknown[] = []) {
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let value: unknown = [];
    if (path === '/api/auth/me') {
      if (!user) return route.fulfill({ status: 401, json: { success: false, error: { message: '로그인 필요' } } });
      value = user;
    } else if (path === '/api/sites') value = [site];
    else if (path === '/api/me/memberships') value = memberships;
    else if (path === '/api/approvals') value = [membership];
    else if (path === '/api/admin/stats') value = { users: [admin, member], rooms: [], archive_count: 0, storage_bytes: 0 };
    else if (path === '/api/admin/ai-settings') value = { configured: false, source: 'none', storage_ready: true, model: 'gpt-4.1-mini', updated_at: null };
    await route.fulfill({ json: { success: true, data: value } });
  });
}

test('admin settings expose global API registration and site approvals without storing key in browser', async ({ page }) => {
  const testApiKey = 'sk-test-browser-only-not-a-real-key';
  await mock(page, admin);
  await page.goto('/');
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.getByRole('tab', { name: 'AI 요약 설정' }).click();
  await expect(page.getByLabel('OpenAI API 키')).toBeVisible();
  await page.screenshot({ path: 'test-results/admin-ai-settings.png', fullPage: true });
  await expect(page.getByText('모든 현장의 대화 요약에 공통으로 사용합니다.')).toBeVisible();
  await page.getByLabel('OpenAI API 키').fill(testApiKey);
  const saved = page.waitForRequest(request => request.url().endsWith('/api/admin/ai-settings') && request.method() === 'PUT');
  await page.getByRole('button', { name: 'AI 설정 저장' }).click();
  expect((await saved).postDataJSON()).toEqual({ api_key: testApiKey, model: 'gpt-4.1-mini' });
  await expect(page.getByLabel('OpenAI API 키')).toHaveValue('');
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain('sk-test');
  await page.getByRole('tab', { name: '승인 설정' }).click();
  await expect(page.getByRole('heading', { name: '가입 승인 및 담당자 지정' })).toBeVisible();
  const approval = page.waitForRequest(request => request.url().endsWith(`/sites/${site.id}/members/${member.id}`) && request.method() === 'PUT');
  await page.getByRole('button', { name: `${member.name} 현장담당자로 승인` }).click();
  expect((await approval).postDataJSON()).toEqual({ status: 'approved', role: 'manager' });
});

test('admin can select GPT-6 catalog models and save without re-entering the stored API key', async ({ page }) => {
  await mock(page, admin);
  await page.route('**/api/admin/ai-settings', route => {
    const model = route.request().method() === 'PUT' ? route.request().postDataJSON().model : 'gpt-4.1-mini';
    return route.fulfill({ json: { success: true, data: { configured: true, source: 'database', storage_ready: true, model, updated_at: 1 } } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.getByRole('tab', { name: 'AI 요약 설정' }).click();
  const models = page.getByRole('combobox', { name: '요약 모델', exact: true });
  await expect(models).toHaveValue('gpt-4.1-mini');
  for (const model of ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra']) {
    await models.selectOption(model);
    const saved = page.waitForResponse(response => response.url().endsWith('/api/admin/ai-settings') && response.request().method() === 'PUT');
    await page.getByRole('button', { name: 'AI 설정 저장', exact: true }).click();
    expect((await saved).request().postDataJSON()).toEqual({ model });
    await expect(page.getByRole('status')).toContainText('저장했습니다');
    await expect(models).toHaveValue(model);
    await expect(page.getByLabel('OpenAI API 키')).toHaveValue('');
  }
});

test('public registration shows approval-pending confirmation', async ({ page }) => {
  await mock(page, null);
  await page.goto('/');
  await page.getByRole('button', { name: '가입 신청', exact: true }).click();
  await page.getByLabel('이름', { exact: true }).fill('신규 팀원');
  await page.getByLabel('이메일', { exact: true }).fill('new@example.test');
  await page.getByLabel('비밀번호', { exact: true }).fill('abcdef1!');
  await page.getByLabel('비밀번호 확인', { exact: true }).fill('abcdef1!');
  await page.getByLabel('가입할 현장').selectOption(site.id);
  const register = page.waitForRequest(request => request.url().endsWith('/api/auth/register'));
  await page.getByRole('button', { name: '가입 승인 요청' }).click();
  expect((await register).postDataJSON().site_id).toBe(site.id);
  await expect(page.getByRole('status')).toContainText('승인');
});

test('registration explains and blocks invalid passwords without restricting administrator login', async ({ page }) => {
  await mock(page,null);
  const registrations: string[]=[];
  page.on('request',request=>{if(new URL(request.url()).pathname==='/api/auth/register')registrations.push(request.url());});
  await page.goto('/');
  await page.getByRole('button',{name:'가입 신청',exact:true}).click();
  await expect(page.getByText('비밀번호는 8자 이상이며 숫자와 특수문자를 반드시 포함해야 합니다.',{exact:true})).toBeVisible();
  await page.getByLabel('이름',{exact:true}).fill('신규 팀원');
  await page.getByLabel('이메일',{exact:true}).fill('policy@example.test');
  await page.getByLabel('가입할 현장').selectOption(site.id);
  const password=page.getByLabel('비밀번호',{exact:true});
  await expect(password).toHaveAttribute('minlength','8');
  for(const invalid of ['abcdefg!','abcd1234','abcd123 ','가나다라마바12']) {
    await password.fill(invalid);
    await page.getByLabel('비밀번호 확인',{exact:true}).fill(invalid);
    await page.getByRole('button',{name:'가입 승인 요청',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('숫자와 특수문자');
  }
  expect(registrations).toHaveLength(0);
  await password.fill('Abc1!xy');
  expect(await password.evaluate(input=>(input as HTMLInputElement).checkValidity())).toBe(false);
  await page.getByRole('button',{name:'로그인으로 돌아가기',exact:true}).click();
  await expect(page.getByLabel('비밀번호',{exact:true})).not.toHaveAttribute('minlength');
  await expect(page.getByLabel('비밀번호 확인',{exact:true})).toHaveCount(0);
  await page.getByLabel('이메일',{exact:true}).fill(admin.email);
  await page.getByLabel('비밀번호',{exact:true}).fill('1234');
  await page.route('**/api/auth/login',route=>route.fulfill({json:{success:true,data:admin}}));
  await page.route('**/api/auth/me',route=>route.fulfill({json:{success:true,data:admin}}));
  const login=page.waitForRequest(request=>request.url().endsWith('/api/auth/login'));
  await page.getByRole('button',{name:'로그인',exact:true}).click();
  expect((await login).postDataJSON().password).toBe('1234');
  await expect(page.getByRole('button',{name:'설정',exact:true})).toBeVisible();
});

test('manager signup requests a new site even before any site exists', async ({ page }) => {
  await mock(page,null);
  await page.route('**/api/sites',route=>route.fulfill({json:{success:true,data:[]}}));
  await page.goto('/');
  await page.getByRole('button',{name:'가입 신청',exact:true}).click();
  await page.getByLabel('가입 유형').selectOption('manager');
  await expect(page.getByText('관리자가 승인하면 현장이 생성되고 현장담당자로 배정됩니다.',{exact:true})).toBeVisible();
  await expect(page.getByLabel('가입할 현장')).toHaveCount(0);
  await page.getByLabel('이름',{exact:true}).fill('신규 담당자');
  await page.getByLabel('이메일',{exact:true}).fill('manager-request@example.test');
  await page.getByLabel('비밀번호',{exact:true}).fill('abcdef1!');
  await page.getByLabel('비밀번호 확인',{exact:true}).fill('abcdef1!');
  await page.getByLabel('요청할 현장 이름',{exact:true}).fill('신규 건설현장');
  await expect(page.getByRole('button',{name:'가입 승인 요청',exact:true})).toBeEnabled();
  const register=page.waitForRequest(request=>request.url().endsWith('/api/auth/register'));
  await page.getByRole('button',{name:'가입 승인 요청',exact:true}).click();
  const body=(await register).postDataJSON();
  expect(body).toMatchObject({registration_type:'manager',site_name:'신규 건설현장'});
  expect(body).not.toHaveProperty('site_id');
  await expect(page.getByRole('status')).toContainText('현장 생성 요청');
});

test('signup requires two matching passwords and never sends mismatched input',async({page})=>{
  test.setTimeout(15_000);
  await mock(page,null);
  const registrations:string[]=[];
  page.on('request',request=>{if(new URL(request.url()).pathname==='/api/auth/register')registrations.push(request.url());});
  await page.goto('/');await page.getByRole('button',{name:'가입 신청',exact:true}).click();
  await page.getByLabel('이름',{exact:true}).fill('확인 검증');
  await page.getByLabel('이메일',{exact:true}).fill('confirmation@example.test');
  await page.getByLabel('가입할 현장').selectOption(site.id);
  await page.getByLabel('비밀번호',{exact:true}).fill('abcdef1!');
  const confirmation=page.getByLabel('비밀번호 확인',{exact:true});
  await expect(confirmation).toHaveAttribute('type','password');
  await expect(confirmation).toHaveAttribute('autocomplete','new-password');
  await expect(confirmation).toHaveAttribute('required','');
  await page.getByRole('button',{name:'가입 승인 요청',exact:true}).click();
  expect(registrations).toHaveLength(0);
  await confirmation.fill('abcdef2!');
  await page.getByRole('button',{name:'가입 승인 요청',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('비밀번호 확인이 일치하지 않습니다');
  expect(registrations).toHaveLength(0);
  await confirmation.fill('abcdef1!');
  const registered=page.waitForRequest(request=>request.url().endsWith('/api/auth/register'));
  await page.getByRole('button',{name:'가입 승인 요청',exact:true}).click();
  expect((await registered).postDataJSON().password_confirmation).toBe('abcdef1!');
  await expect(page.getByRole('status')).toContainText('접수');
});

test('only administrator settings display site-creation requests and approve or reject them', async ({ page }) => {
  await mock(page,admin);
  const request={id:'request-ui',user_id:'applicant-ui',name:'신규 담당자',email:'manager-request@example.test',company:'신청회사',department:'공사팀',site_name:'신청 현장',status:'pending',site_id:null,created_at:1,updated_at:1};
  await page.route('**/api/admin/site-requests',route=>route.fulfill({json:{success:true,data:[request]}}));
  await page.goto('/');
  await page.getByRole('button',{name:'설정',exact:true}).click();
  await page.getByRole('tab',{name:'승인 설정',exact:true}).click();
  await expect(page.getByRole('heading',{name:'현장 생성 요청',exact:true})).toBeVisible();
  await expect(page.getByText('신청 현장',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'신규 담당자 현장 생성 반려',exact:true})).toBeVisible();
  const approval=page.waitForRequest(value=>value.url().endsWith('/api/admin/site-requests/request-ui')&&value.method()==='PUT');
  await page.getByRole('button',{name:'신규 담당자 현장 생성 승인',exact:true}).click();
  expect((await approval).postDataJSON()).toEqual({status:'approved'});
});

test('applicant sees a pending site-creation request without manager access', async ({ page }) => {
  await mock(page,member);
  await page.route('**/api/me/site-requests',route=>route.fulfill({json:{success:true,data:[{id:'request-own',site_name:'승인 전 현장',status:'pending'}]}}));
  await page.goto('/');
  await expect(page.getByText('승인 전 현장 · 현장 생성 요청의 관리자 승인을 기다리고 있습니다.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'새 대화 만들기',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'설정',exact:true}).click();
  await expect(page.getByRole('tab',{name:'승인 설정',exact:true})).toHaveCount(0);
});

test('pending staff cannot start a conversation and normal staff cannot see admin AI settings', async ({ page }) => {
  await mock(page, member, [membership]);
  await page.goto('/');
  await expect(page.getByRole('button', { name: '새 대화 만들기' })).toBeDisabled();
  await expect(page.getByText('현장 가입 승인 대기 중입니다.')).toBeVisible();
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'AI 요약 설정' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '승인 설정' })).toHaveCount(0);
});

test('approved nonparticipant searches site summary and opens paginated read-only original', async ({ page }) => {
  await mock(page, member, [{ ...membership, status: 'approved' }]);
  const summary = { room_id: 'summary-ui', site_id: site.id, site_name: site.name, title: '발파 협의', project: 'A구간', closed_at: 1, updated_at: 1, summary: '<script>literal text</script> 안전 통제 요약', decisions: ['16시 발파'], actions: ['출입 통제'], keywords: ['안전'] };
  await page.route('**/api/summaries**', route => route.fulfill({ json: { success: true, data: [summary] } }));
  await page.route('**/api/summaries/summary-ui/transcript*', route => {
    const older = new URL(route.request().url()).searchParams.has('before');
    return route.fulfill({ json: { success: true, data: { room: { ...summary, id: 'summary-ui', status: 'closed' }, members: [], messages: [{ id: older ? 'm1' : 'm2', seq: older ? 1 : 2, user_name: member.name, type: 'text', content: older ? '원문 첫 메시지' : '원문 마지막 메시지', created_at: 2 }], has_more: !older } } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '현장 대화 요약', exact: true }).click();
  await page.getByLabel('요약 검색').fill('안전');
  await expect(page.getByRole('heading', { name: '발파 협의' })).toBeVisible();
  await expect(page.getByText(summary.summary, { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '대화 원문 열람' }).click();
  await expect(page.getByText('원문 마지막 메시지')).toBeVisible();
  await expect(page.getByRole('textbox', { name: '메시지 입력' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '이전 원문 더 보기' })).toBeVisible();
  await page.getByRole('button', { name: '이전 원문 더 보기' }).click();
  await expect(page.getByText('원문 첫 메시지')).toBeVisible();
  await expect(page.getByText('원문 마지막 메시지')).toBeVisible();
  await expect(page.getByRole('button', { name: '이전 원문 더 보기' })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/site-summary-original-mobile.png', fullPage: true });
});

test('site manager can approve pending staff but cannot assign sites, promote, or configure API', async ({ page }) => {
  await mock(page, member, [{ ...membership, role: 'manager', status: 'approved' }]);
  await page.goto('/');
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.getByRole('tab', { name: '승인 설정' }).click();
  await expect(page.getByRole('button', { name: `${member.name} 팀원으로 승인` })).toBeVisible();
  await expect(page.getByRole('button', { name: /현장담당자로/ })).toHaveCount(0);
  await expect(page.getByLabel('배정 현장')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'현장 생성 요청',exact:true})).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'AI 요약 설정' })).toHaveCount(0);
  const request = page.waitForRequest(request => request.url().endsWith(`/sites/${site.id}/members/${member.id}`) && request.method() === 'PUT');
  await page.getByRole('button', { name: `${member.name} 팀원으로 승인` }).click();
  expect((await request).postDataJSON()).toEqual({ status: 'approved', role: 'member' });
});

test('registered API key stays masked and blank save preserves it; missing encryption prevents save', async ({ page }) => {
  await mock(page, admin);
  await page.route('**/api/admin/ai-settings', route => route.fulfill({ json: { success: true, data: { configured: true, source: 'database', storage_ready: true, model: 'gpt-4.1-mini', updated_at: 1, last_archive: { title: '보관 테스트', status: 'failed', error: '요약 실패', updated_at: 1 } } } }));
  await page.goto('/');
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.getByRole('tab', { name: 'AI 요약 설정' }).click();
  await expect(page.getByLabel('OpenAI API 키')).toHaveValue('');
  await expect(page.getByText('요약 실패', { exact: true })).toBeVisible();
  const saved = page.waitForRequest(request => request.url().endsWith('/api/admin/ai-settings') && request.method() === 'PUT');
  await page.getByRole('button', { name: 'AI 설정 저장' }).click();
  expect((await saved).postDataJSON()).toEqual({ model: 'gpt-4.1-mini' });
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.route('**/api/admin/ai-settings', route => route.fulfill({ json: { success: true, data: { configured: false, source: 'none', storage_ready: false, model: 'gpt-4.1-mini', updated_at: null } } }));
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.getByRole('tab', { name: 'AI 요약 설정' }).click();
  await page.getByLabel('OpenAI API 키').fill('sk-test-browser-only-not-a-real-key');
  await expect(page.getByRole('alert')).toContainText('암호화');
  await expect(page.getByRole('button', { name: 'AI 설정 저장' })).toBeDisabled();
});

test('new conversation selects a site and only approved site members before submission', async ({ page }) => {
  await mock(page, admin);
  await page.route('**/api/users?site_id=*', route => route.fulfill({ json: { success: true, data: [admin, member] } }));
  await page.route('**/api/rooms', route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { success: true, data: [] } });
    return route.fulfill({ json: { success: false, error: { message: '검증용 생성 중단' } } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '새 대화 만들기' }).click();
  await expect(page.getByLabel('대화 현장')).toHaveValue(site.id);
  await page.getByLabel('대화 제목').fill('현장별 대화');
  await page.getByLabel('대화 목적').fill('승인된 직원만 참여');
  await page.getByRole('checkbox', { name: new RegExp(member.name) }).check();
  const request = page.waitForRequest(request => request.url().endsWith('/api/rooms') && request.method() === 'POST');
  await page.getByRole('button', { name: '대화 시작하기', exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({ site_id: site.id, member_ids: [member.id] });
  await expect(page.getByRole('alert')).toContainText('검증용 생성 중단');
});
