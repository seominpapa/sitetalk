import { test, expect, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const users=JSON.parse(readFileSync(process.env.E2E_CREDENTIALS_FILE || '.wrangler/test-users.json','utf8'));
const quote=(value:unknown)=>`'${String(value).replaceAll("'","''")}'`;
async function result(response:Awaited<ReturnType<APIRequestContext['get']>>) {
  expect(response.ok(),`API ${new URL(response.url()).pathname}: ${response.status()}`).toBe(true);
  const payload=await response.json(); expect(payload.success).toBe(true);return payload.data;
}
test('real local API: site approvals, promotion, global settings, shared summary/original ACL',async({browser})=>{
  test.skip(!!process.env.E2E_BASE_URL,'Local fixtures only: never mutate remote data.');
  // Isolate local IP-based signup/login budgets across repeat runs; never sent to a remote Worker.
  const context=()=>browser.newContext({extraHTTPHeaders:{'CF-Connecting-IP':`198.18.${Math.floor(Math.random()*250)}.${Math.floor(Math.random()*250)+1}`}});
  const admin=await context(),manager=await context(),pending=await context(),outsider=await context();
  try {
    await result(await admin.request.post('/api/auth/login',{data:{email:users[0].email,password:users[0].password}}));
    const suffix=crypto.randomUUID();
    const a=await result(await admin.request.post('/api/sites',{data:{name:`승인 현장 ${suffix}`}}));
    const b=await result(await admin.request.post('/api/sites',{data:{name:`별도 현장 ${suffix}`}}));
    const login=[];
    for(const [index,context] of [manager,pending,outsider].entries()) {
      const email=`approval-${suffix}-${index}@example.invalid`,password=`local-test-${crypto.randomUUID()}1!`;
      await result(await context.request.post('/api/auth/register',{data:{name:`가입검증${index}`,email,password,password_confirmation:password,site_id:index===2?b.id:a.id,role:'admin',status:'approved'}}));
      await result(await context.request.post('/api/auth/login',{data:{email,password}}));
      login.push(await result(await context.request.get('/api/auth/me')));
    }
    const memberPath=(site:string,id:string)=>`/api/sites/${site}/members/${id}`;
    await result(await admin.request.put(memberPath(a.id,users[0].id),{data:{status:'approved',role:'member'}}));
    expect((await manager.request.get('/api/approvals')).status()).toBe(403);
    expect((await pending.request.post('/api/rooms',{data:{site_id:a.id,title:'차단',purpose:'승인 전',member_ids:[users[0].id]}})).status()).toBe(403);
    expect((await pending.request.get('/api/admin/ai-settings')).status()).toBe(403);
    await result(await admin.request.put(memberPath(a.id,login[0].id),{data:{status:'approved',role:'manager'}}));
    expect((await manager.request.put(memberPath(b.id,login[2].id),{data:{status:'approved',role:'member'}})).status()).toBe(403);
    expect((await manager.request.put(memberPath(a.id,login[1].id),{data:{status:'approved',role:'manager'}})).status()).toBe(403);
    const decisions=await Promise.all(['approved','rejected'].map(status=>manager.request.put(memberPath(a.id,login[1].id),{data:{status,role:'member'}})));
    expect(decisions.map(response=>response.status()).sort()).toEqual([200,409]);
    await result(await admin.request.put(memberPath(a.id,login[1].id),{data:{status:'approved',role:'manager'}}));
    expect((await result(await pending.request.get('/api/auth/me'))).role).toBe('member');
    expect((await result(await pending.request.get('/api/me/memberships')))[0].role).toBe('manager');
    const fakeKey='sk-local-e2e-not-a-real-credential';
    expect((await manager.request.put('/api/admin/ai-settings',{data:{api_key:fakeKey,model:'gpt-4.1-mini'}})).status()).toBe(403);
    const settings=await result(await admin.request.put('/api/admin/ai-settings',{data:{api_key:fakeKey,model:'gpt-4.1-mini'}}));
    expect(settings.source).toBe('database');expect(settings.storage_ready).toBe(true);
    expect(JSON.stringify(settings)).not.toContain(fakeKey);
    const adminPage=await admin.newPage();
    await adminPage.goto('/');
    await adminPage.getByRole('button',{name:'설정',exact:true}).click();
    await adminPage.getByRole('tab',{name:'AI 요약 설정'}).click();
    await expect(adminPage.getByLabel('OpenAI API 키')).toHaveValue('');
    await adminPage.getByLabel('요약 모델').selectOption('gpt-4.1');
    await adminPage.getByRole('button',{name:'AI 설정 저장',exact:true}).click();
    await expect(adminPage.getByRole('status')).toContainText('저장했습니다');
    expect((await result(await admin.request.get('/api/admin/ai-settings'))).model).toBe('gpt-4.1');
    const room=await result(await manager.request.post('/api/rooms',{data:{site_id:a.id,title:`원문 공개 ${suffix}`,purpose:'같은 현장 원문 열람',member_ids:[users[0].id]}}));
    await result(await manager.request.post(`/api/rooms/${room.id}/messages`,{data:{content:'현장 원문 그대로',client_id:crypto.randomUUID()}}));
    const file=await result(await manager.request.post(`/api/rooms/${room.id}/attachments`,{multipart:{client_id:crypto.randomUUID(),file:{name:'record.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 local-record')}}}));
    await result(await manager.request.post(`/api/rooms/${room.id}/close`,{data:{conclusion:'승인된 직원에게 공유',owner_id:login[0].id}}));
    // Synthetic summary fixture only: real API integration is mocked in worker tests, never billed here.
    const sql=`INSERT INTO summary_records(room_id,summary,decisions,actions,keywords,updated_at) VALUES(${quote(room.id)},'원문보존 요약','["통제"]','["점검"]','["현장지식"]',${Date.now()}); UPDATE archive_jobs SET status='done' WHERE room_id=${quote(room.id)};`;
    execFileSync('npx',['wrangler','d1','execute','site-talk','--local','--command',sql],{stdio:'pipe'});
    const records=await result(await pending.request.get(`/api/summaries?q=${encodeURIComponent('현장지식')}`));
    expect(records.some((record:any)=>record.room_id===room.id)).toBe(true);
    expect((await result(await pending.request.get(`/api/summaries/${room.id}/transcript`))).messages[0].content).toBe('현장 원문 그대로');
    expect((await pending.request.get(`/api/summaries/${room.id}/attachments/${file.attachment.id}`)).status()).toBe(200);
    for(const action of ['messages','ws']) expect((await pending.request.get(`/api/rooms/${room.id}/${action}`)).status()).toBe(404);
    expect((await pending.request.post(`/api/rooms/${room.id}/messages`,{data:{content:'쓰기 금지',client_id:crypto.randomUUID()}})).status()).toBe(404);
    expect((await outsider.request.get(`/api/summaries/${room.id}/transcript`)).status()).toBe(404);
    expect((await outsider.request.get(`/api/summaries/${room.id}/attachments/${file.attachment.id}`)).status()).toBe(404);
    expect((await pending.request.get(`/api/summaries/${room.id}/attachments/not-same-room`)).status()).toBe(404);
    const otherRoom=await result(await manager.request.post('/api/rooms',{data:{site_id:a.id,title:'파일 경계 검증',purpose:'다른 방 파일 접근 차단',member_ids:[users[0].id]}}));
    const otherFile=await result(await manager.request.post(`/api/rooms/${otherRoom.id}/attachments`,{multipart:{client_id:crypto.randomUUID(),file:{name:'other.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 separate')}}}));
    expect((await pending.request.get(`/api/summaries/${room.id}/attachments/${otherFile.attachment.id}`)).status()).toBe(404);
    await result(await admin.request.put(memberPath(a.id,login[1].id),{data:{status:'rejected',role:'member'}}));
    expect((await pending.request.get(`/api/summaries/${room.id}/transcript`)).status()).toBe(404);
    expect((await pending.request.get(`/api/summaries/${room.id}/attachments/${file.attachment.id}`)).status()).toBe(404);
    const page=await manager.newPage();
    await page.addInitScript(()=>{
      const Native=window.WebSocket;(window as any).revokedSocketClosed=false;
      window.WebSocket=class extends Native {constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);this.addEventListener('close',()=>{(window as any).revokedSocketClosed=true;});}};
    });
    await page.goto(`/rooms/${otherRoom.id}`);
    await expect(page.getByText('실시간 연결됨',{exact:false})).toBeVisible();
    await result(await admin.request.post(`/api/rooms/${otherRoom.id}/messages`,{data:{content:'승인 중 수신 가능',client_id:crypto.randomUUID()}}));
    await expect(page.getByText('승인 중 수신 가능',{exact:true})).toBeVisible();
    await result(await admin.request.put(memberPath(a.id,login[0].id),{data:{status:'rejected',role:'member'}}));
    await result(await admin.request.post(`/api/rooms/${otherRoom.id}/messages`,{data:{content:'승인 취소 후 수신 금지',client_id:crypto.randomUUID()}}));
    await page.waitForFunction(()=>(window as any).revokedSocketClosed);
    await expect(page.getByText('승인 취소 후 수신 금지',{exact:true})).toHaveCount(0);
    expect((await manager.request.get(`/api/rooms/${otherRoom.id}/messages`)).status()).toBe(404);
  } finally {await Promise.all([admin.close(),manager.close(),pending.close(),outsider.close()]);}
});
