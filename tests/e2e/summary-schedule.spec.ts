import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const user={id:'schedule-user',name:'현장담당자',email:'schedule@example.test',role:'member',company:'시연',department:'',notification_enabled:0};
const sites=[{site_id:'alpha',site_name:'A현장',enabled:true},{site_id:'beta',site_name:'B현장',enabled:false}];
async function mock(page:Page,role='manager',status='approved') {
  await page.route('**/api/**',route=>{
    const path=new URL(route.request().url()).pathname;
    const value=path==='/api/auth/me'?{...user,role:role==='admin'?'admin':'member'}
      :path==='/api/sites'?sites.map(site=>({id:site.site_id,name:site.site_name}))
      :path==='/api/me/memberships'?[{site_id:'alpha',site_name:'A현장',user_id:user.id,role:role==='admin'?'member':role,status}]
      :path==='/api/summary-schedules'?sites:[];
    return route.fulfill({json:{success:true,data:value}});
  });
}
test('approved manager toggles a site schedule, persistence reloads and saving never calls OpenAI',async({page})=>{
  await mock(page);
  let enabled=false,paidCalls=0;
  await page.route('**/api/summary-schedules',route=>route.fulfill({json:{success:true,data:[{...sites[0],enabled}]}}));
  await page.route('**/api/sites/alpha/summary-schedule',route=>{
    enabled=route.request().postDataJSON().enabled;
    return route.fulfill({json:{success:true,data:{site_id:'alpha',enabled}}});
  });
  await page.route('https://api.openai.com/**',route=>{paidCalls++;return route.abort();});
  await page.goto('/'); await page.getByRole('button',{name:'설정',exact:true}).click();
  await page.getByRole('tab',{name:'자동요약 예약',exact:true}).click();
  await expect(page.getByText('매일 23:50 (한국시간)',{exact:false})).toBeVisible();
  await expect(page.getByText('종료된 대화만 요약합니다.',{exact:false})).toBeVisible();
  const toggle=page.getByRole('switch',{name:'A현장 자동요약 예약',exact:true});
  await expect(toggle).toHaveAttribute('aria-checked','false');
  const saved=page.waitForRequest(request=>request.url().endsWith('/api/sites/alpha/summary-schedule')&&request.method()==='PUT');
  await toggle.click(); expect((await saved).postDataJSON()).toEqual({enabled:true});
  await expect(toggle).toHaveAttribute('aria-checked','true'); await expect(page.getByRole('status')).toContainText('켰습니다');
  await page.getByRole('button',{name:'닫기',exact:true}).click();
  await page.getByRole('button',{name:'설정',exact:true}).click(); await page.getByRole('tab',{name:'자동요약 예약',exact:true}).click();
  await expect(page.getByRole('switch',{name:'A현장 자동요약 예약',exact:true})).toHaveAttribute('aria-checked','true');
  expect(paidCalls).toBe(0);
});
test('administrator sees all returned sites and failed save keeps the persisted toggle',async({page})=>{
  await mock(page,'admin');
  await page.route('**/api/sites/alpha/summary-schedule',route=>route.fulfill({status:403,json:{success:false,error:{code:'FORBIDDEN',message:'변경 권한이 없습니다.'}}}));
  await page.goto('/'); await page.getByRole('button',{name:'설정',exact:true}).click(); await page.getByRole('tab',{name:'자동요약 예약',exact:true}).click();
  const toggle=page.getByRole('switch',{name:'A현장 자동요약 예약',exact:true});
  await expect(toggle).toHaveAttribute('aria-checked','true'); await expect(page.getByRole('switch',{name:'B현장 자동요약 예약',exact:true})).toHaveAttribute('aria-checked','false');
  await toggle.click(); await expect(page.getByRole('alert')).toContainText('변경 권한'); await expect(toggle).toHaveAttribute('aria-checked','true');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
for(const [role,status] of [['member','approved'],['manager','pending'],['manager','rejected']]) {
  test(`${status} ${role} has no schedule controls`,async({page})=>{
    await mock(page,role,status); await page.goto('/'); await page.getByRole('button',{name:'설정',exact:true}).click();
    await expect(page.getByRole('tab',{name:'자동요약 예약',exact:true})).toHaveCount(0);
  });
}
test('real local API persists manager toggles while denying team and other-site access',async({browser})=>{
  test.skip(!!process.env.E2E_BASE_URL,'Local fixtures only; no production writes.');
  const credentials=JSON.parse(readFileSync('.wrangler/test-users.json','utf8'));
  const contexts=[];
  async function login(index:number) {
    const context=await browser.newContext({extraHTTPHeaders:{'CF-Connecting-IP':`198.18.${Math.floor(Math.random()*250)}.${Math.floor(Math.random()*250)+1}`}}); contexts.push(context);
    const response=await context.request.post('/api/auth/login',{data:{email:credentials[index].email,password:credentials[index].password}}); expect(response.status()).toBe(200); return context;
  }
  try {
    const admin=await login(0),manager=await login(1),team=await login(2);
    const site=(await (await admin.request.post('/api/sites',{data:{name:`예약 검증 ${crypto.randomUUID()}`}})).json()).data;
    const other=(await (await admin.request.post('/api/sites',{data:{name:`별도 예약 ${crypto.randomUUID()}`}})).json()).data;
    expect((await admin.request.put(`/api/sites/${site.id}/members/${credentials[1].id}`,{data:{status:'approved',role:'manager'}})).status()).toBe(200);
    expect((await admin.request.put(`/api/sites/${site.id}/members/${credentials[2].id}`,{data:{status:'approved',role:'member'}})).status()).toBe(200);
    expect((await team.request.get('/api/summary-schedules')).status()).toBe(403);
    expect((await team.request.put(`/api/sites/${site.id}/summary-schedule`,{data:{enabled:false}})).status()).toBe(403);
    expect((await manager.request.put(`/api/sites/${other.id}/summary-schedule`,{data:{enabled:false}})).status()).toBe(403);
    const page=await manager.newPage(); await page.goto('/'); await page.getByRole('button',{name:'설정',exact:true}).click(); await page.getByRole('tab',{name:'자동요약 예약',exact:true}).click();
    const toggle=page.getByRole('switch',{name:`${site.name} 자동요약 예약`,exact:true});
    await expect(toggle).toHaveAttribute('aria-checked','true'); await toggle.click(); await expect(toggle).toHaveAttribute('aria-checked','false');
    const schedules=(await (await manager.request.get('/api/summary-schedules')).json()).data;
    expect(schedules.find(value=>value.site_id===site.id).enabled).toBe(false); expect(schedules.some(value=>value.site_id===other.id)).toBe(false);
    await page.reload(); await page.getByRole('button',{name:'설정',exact:true}).click(); await page.getByRole('tab',{name:'자동요약 예약',exact:true}).click();
    const restored=page.getByRole('switch',{name:`${site.name} 자동요약 예약`,exact:true}); await expect(restored).toHaveAttribute('aria-checked','false'); await restored.click(); await expect(restored).toHaveAttribute('aria-checked','true');
    expect((await admin.request.put(`/api/sites/${site.id}/members/${credentials[1].id}`,{data:{status:'rejected',role:'member'}})).status()).toBe(200);
    expect((await manager.request.put(`/api/sites/${site.id}/summary-schedule`,{data:{enabled:false}})).status()).toBe(403);
  } finally { await Promise.all(contexts.map(context=>context.close())); }
});
