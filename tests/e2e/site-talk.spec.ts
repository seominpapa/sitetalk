import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
const users = JSON.parse(readFileSync(process.env.E2E_CREDENTIALS_FILE || '.wrangler/test-users.json','utf8'));
async function login(page: Page, index: number) {
  await page.goto('/');
  await page.getByLabel('이메일', { exact:true }).fill(users[index].email);
  await page.getByLabel('비밀번호', { exact:true }).fill(users[index].password);
  await page.getByRole('button',{name:'로그인',exact:true}).click();
  await expect(page.getByRole('button',{name:'새 대화 만들기'})).toBeVisible();
  const later = page.getByRole('button',{name:'나중에'});
  if (await later.isVisible()) await later.click();
}
async function data(response: Awaited<ReturnType<APIRequestContext['get']>>) {
  const result=await response.json(); expect(result, JSON.stringify(result)).toHaveProperty('success',true); return result.data;
}
test('two users: room, realtime, paste image, PDF download, search, close, access control', async ({browser}) => {
  const a=await browser.newContext(), b=await browser.newContext(), c=await browser.newContext();
  const pa=await a.newPage(), pb=await b.newPage(), pc=await c.newPage();
  await pb.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    (window as any).__siteTalkSockets = [];
    window.WebSocket = class extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        (window as any).__siteTalkSockets.push(this);
      }
    };
  });
  await login(pa,0); await login(pb,1); await login(pc,2);
  await pa.getByRole('button',{name:'새 대화 만들기'}).click();
  await pa.getByLabel('대화 제목').fill('발파계획 변경 협의');
  await pa.getByLabel('대화 목적').fill('발파 시간을 변경하고 안전 통제 범위를 확정합니다.');
  await pa.getByRole('checkbox',{name:new RegExp(users[1].name)}).check();
  await pa.getByRole('button',{name:'대화 시작하기',exact:true}).click();
  await expect(pa.getByRole('heading',{name:'발파계획 변경 협의',exact:true}).first()).toBeVisible();
  const roomId=new URL(pa.url()).pathname.split('/').at(-1)!;
  await pb.goto(`/rooms/${roomId}`);
  await expect(pb.getByText('실시간 연결됨',{exact:false})).toBeVisible();
  await pa.getByRole('textbox',{name:'메시지 입력'}).fill('발파시간이 16:30으로 변경됐습니다.');
  await pa.getByRole('textbox',{name:'메시지 입력'}).press('Enter');
  await expect(pb.getByText('발파시간이 16:30으로 변경됐습니다.',{exact:true})).toBeVisible();
  await pb.getByRole('textbox',{name:'메시지 입력'}).fill('통제 범위 확인했습니다.');
  await pb.getByRole('button',{name:'전송',exact:true}).click();
  await expect(pa.getByText('통제 범위 확인했습니다.',{exact:true})).toBeVisible();
  const composer=pb.getByRole('textbox',{name:'메시지 입력'});
  await composer.fill('ShiftEnter 첫 줄'); await composer.press('Shift+Enter'); await composer.pressSequentially('ShiftEnter 둘째 줄');
  await expect(composer).toHaveValue('ShiftEnter 첫 줄\nShiftEnter 둘째 줄');
  await expect(pa.getByText('ShiftEnter 첫 줄',{exact:true})).toHaveCount(0);
  await composer.press('Enter');
  await expect(pa.locator('.message-content').filter({hasText:'ShiftEnter 첫 줄'})).toHaveText('ShiftEnter 첫 줄\nShiftEnter 둘째 줄');
  const png=readFileSync('apps/web/public/icon-192.png');
  await pa.getByRole('textbox',{name:'메시지 입력'}).evaluate((element,bytes) => {
    const clipboard=new DataTransfer(); clipboard.items.add(new File([new Uint8Array(bytes)],'현장사진.png',{type:'image/png'}));
    element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:clipboard,bubbles:true,cancelable:true}));
  },Array.from(png));
  await expect(pb.getByRole('img',{name:'현장사진.png'})).toBeVisible();
  await pb.getByRole('button',{name:'현장사진.png 크게 보기'}).click();
  await expect(pb.getByRole('dialog').getByRole('img',{name:'현장사진.png'})).toBeVisible();
  await pb.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).click();
  await expect(pa.getByRole('button',{name:'파일',exact:true})).toBeEnabled();
  await pa.locator('.chat-panel').evaluate((element) => {
    const drop=new DataTransfer(); drop.items.add(new File(['현장 끌어놓기 검증'],'현장메모.txt',{type:'text/plain'}));
    element.dispatchEvent(new DragEvent('drop',{dataTransfer:drop,bubbles:true,cancelable:true}));
  });
  await expect(pb.getByRole('link',{name:'현장메모.txt 다운로드'})).toBeVisible();
  await expect(pa.getByRole('button',{name:'파일',exact:true})).toBeEnabled();
  const pdf=Buffer.from('%PDF-1.4\nSite Talk test PDF\n%%EOF');
  await pa.getByLabel('첨부파일 선택').setInputFiles({name:'발파계획서.pdf',mimeType:'application/pdf',buffer:pdf});
  const downloadLink=pb.getByRole('link',{name:'발파계획서.pdf 다운로드'});
  await expect(downloadLink).toBeVisible();
  const href=(await downloadLink.getAttribute('href'))!;
  const downloaded=await b.request.get(href);
  expect(downloaded.status()).toBe(200); expect(await downloaded.body()).toEqual(pdf);
  const spoof=await data(await a.request.post(`/api/rooms/${roomId}/attachments`,{multipart:{client_id:crypto.randomUUID(),file:{name:'fake.pdf',mimeType:'application/pdf',buffer:Buffer.from('<html><script>alert(1)</script></html>')}}}));
  const spoofDownload=await b.request.get(`/api/attachments/${spoof.attachment.id}`);
  expect(spoofDownload.headers()['content-type']).toBe('application/octet-stream');
  expect(spoofDownload.headers()['content-disposition']).toMatch(/^attachment;/);
  expect((await c.request.get(href)).status()).toBe(404);
  expect((await c.request.get(`/api/rooms/${roomId}/messages`)).status()).toBe(404);
  const unauthorizedSearch=await data(await c.request.get('/api/search?q=발파계획'));
  expect(unauthorizedSearch.some((r:any)=>r.id===roomId)).toBe(false);
  await pb.reload(); await expect(pb.getByText('통제 범위 확인했습니다.',{exact:true})).toBeVisible();
  await expect(pb.getByText('실시간 연결됨',{exact:false})).toBeVisible();
  await b.setOffline(true);
  await pb.evaluate(() => { for (const socket of (window as any).__siteTalkSockets as WebSocket[]) socket.close(); });
  await expect(pb.getByText('다시 연결 중',{exact:false})).toBeVisible();
  // A leaves the room while posting the backlog so visible-client read receipts do not exhaust API limits.
  await pa.goto('/');
  const missed=Array.from({length:55},(_,index)=>`연결 복구 검증 ${String(index+1).padStart(2,'0')}`);
  for (const content of missed) await data(await a.request.post(`/api/rooms/${roomId}/messages`,{data:{content,client_id:crypto.randomUUID()}}));
  await expect(pb.locator('.message-content').filter({hasText:'연결 복구 검증'})).toHaveCount(0);
  await b.setOffline(false);
  await expect(pb.locator('.message-content').filter({hasText:'연결 복구 검증'})).toHaveCount(55,{timeout:25000});
  expect(await pb.locator('.message-content').filter({hasText:'연결 복구 검증'}).allTextContents()).toEqual(missed);
  await pa.goto(`/rooms/${roomId}`);
  await expect(pa.getByRole('button',{name:'대화 종료',exact:true})).toBeVisible();
  await pb.getByRole('textbox',{name:'대화 검색'}).fill('16:30');
  await expect(pb.getByRole('button').filter({hasText:'발파계획 변경 협의'}).first()).toBeVisible();
  await pa.getByRole('button',{name:'대화 종료',exact:true}).click();
  await pa.getByLabel('결론').fill('16:30 발파 및 통제 범위 확대 확정');
  await pa.getByLabel('담당자').selectOption(users[1].id);
  await pa.getByLabel('기한').fill('2026-09-15');
  await pa.getByRole('button',{name:'대화 종료 및 기록'}).click();
  await expect(pb.getByText('종료된 대화입니다.',{exact:false})).toBeVisible();
  const closed=await data(await a.request.get(`/api/rooms/${roomId}`));
  expect(closed.closure.conclusion).toBe('16:30 발파 및 통제 범위 확대 확정');
  expect(closed.closure.owner_id).toBe(users[1].id); expect(closed.closure.due_date).toBe('2026-09-15'); expect(closed.archive.status).toBe('pending');
  expect((await b.request.post(`/api/rooms/${roomId}/messages`,{data:{content:'금지 메시지',client_id:crypto.randomUUID()}})).status()).toBe(409);
  expect((await b.request.post(`/api/rooms/${roomId}/attachments`,{multipart:{client_id:crypto.randomUUID(),file:{name:'closed.pdf',mimeType:'application/pdf',buffer:pdf}}})).status()).toBe(409);
  expect(await (await b.request.get(href)).body()).toEqual(pdf);
  await pa.screenshot({path:'test-results/site-talk-desktop.png',fullPage:true});
  await pb.setViewportSize({width:390,height:844}); await pb.screenshot({path:'test-results/site-talk-mobile.png',fullPage:true});
  expect(await pb.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await a.close(); await b.close(); await c.close();
});

test('API atomic close, idempotency, validation and unread watermarks',async({browser})=>{
  const context=await browser.newContext(); const page=await context.newPage(); await login(page,0);
  const req=context.request;
  const room=await data(await req.post('/api/rooms',{data:{title:'원자적 종료 검증',purpose:'경합·중복 검증',member_ids:[users[1].id]}}));
  const send={content:'한 번만 저장',client_id:crypto.randomUUID()};
  const [one,two]=await Promise.all([req.post(`/api/rooms/${room.id}/messages`,{data:send}).then(data),req.post(`/api/rooms/${room.id}/messages`,{data:send}).then(data)]);
  expect(one.id).toBe(two.id); expect(one.seq).toBe(1);
  expect((await req.post(`/api/rooms/${room.id}/close`,{data:{conclusion:'날짜 오류',owner_id:users[1].id,due_date:'2026-99-01'}})).status()).toBe(400);
  const message2=await data(await req.post(`/api/rooms/${room.id}/messages`,{data:{content:'두 번째',client_id:crypto.randomUUID()}}));
  await req.post(`/api/rooms/${room.id}/read`,{data:{last_read_message_id:message2.id}});
  await req.post(`/api/rooms/${room.id}/read`,{data:{last_read_message_id:one.id}});
  expect((await req.post('/api/rooms',{data:{title:'bad',purpose:'bad',member_ids:['nonexistent']}})).status()).toBe(400);
  expect((await req.post(`/api/rooms/${room.id}/messages`,{headers:{Origin:'https://attacker.invalid'},data:send})).status()).toBe(403);
  const close=req.post(`/api/rooms/${room.id}/close`,{data:{conclusion:'완료',owner_id:users[1].id,due_date:'2026-09-15'}});
  const racing=req.post(`/api/rooms/${room.id}/messages`,{data:{content:'종료와 경합',client_id:crypto.randomUUID()}});
  expect((await close).status()).toBe(200); expect([201,409]).toContain((await racing).status());
  const retry=await req.post(`/api/rooms/${room.id}/messages`,{data:send}); expect(retry.status()).toBe(201); expect((await data(retry)).id).toBe(one.id);
  const history=await data(await req.get(`/api/rooms/${room.id}/messages`)); expect(history.filter((m:any)=>m.content===send.content)).toHaveLength(1);
  await context.close();
});

test('unread counts, monotonic reads, invitation permissions and logout',async({browser})=>{
  const a=await browser.newContext(), b=await browser.newContext();
  await login(await a.newPage(),0); await login(await b.newPage(),1);
  const room=await data(await a.request.post('/api/rooms',{data:{title:'읽음 및 초대 검증',purpose:'미열람 개수와 권한 검증',member_ids:[users[1].id],type:'안전',project:'가덕도',work_category:'발파',location:'A구간',keywords:['통제']}}));
  const path=`/api/rooms/${room.id}`;
  const unread=async()=> (await data(await b.request.get('/api/rooms'))).find((r:any)=>r.id===room.id).unread_count;
  expect(await unread()).toBe(0);
  const first=await data(await a.request.post(`${path}/messages`,{data:{content:'첫 현장 공지',client_id:crypto.randomUUID()}}));
  const second=await data(await a.request.post(`${path}/messages`,{data:{content:'두 번째 현장 공지',client_id:crypto.randomUUID()}}));
  expect(await unread()).toBe(2);
  await data(await b.request.post(`${path}/messages`,{data:{content:'자신의 메시지는 unread에서 제외',client_id:crypto.randomUUID()}}));
  expect(await unread()).toBe(2);
  await data(await b.request.post(`${path}/read`,{data:{last_read_message_id:second.id}}));
  expect(await unread()).toBe(0);
  await data(await b.request.post(`${path}/read`,{data:{last_read_message_id:first.id}}));
  expect(await unread()).toBe(0);
  await data(await a.request.post(`${path}/messages`,{data:{content:'새 공지',client_id:crypto.randomUUID()}}));
  expect(await unread()).toBe(1);
  expect((await b.request.post(`${path}/read`,{data:{last_read_message_id:'unknown'}})).status()).toBe(400);
  expect((await b.request.post(`${path}/members`,{data:{user_ids:[users[2].id]}})).status()).toBe(403);
  await data(await a.request.post(`${path}/members`,{data:{user_ids:[users[2].id]}}));
  const detail=await data(await b.request.get(path));
  expect(detail.members.map((u:any)=>u.id)).toContain(users[2].id);
  expect(detail.room).toMatchObject({type:'안전',project:'가덕도',work_category:'발파',location:'A구간',keywords:'["통제"]'});
  for (const q of ['읽음 및 초대','미열람 개수','첫 현장 공지',users[2].name,'가덕도','발파','A구간']) {
    expect((await data(await b.request.get(`/api/search?q=${encodeURIComponent(q)}`))).some((r:any)=>r.id===room.id)).toBe(true);
  }
  expect((await b.request.get('/api/admin/stats')).status()).toBe(403);
  await data(await b.request.post('/api/auth/logout'));
  expect((await b.request.get('/api/auth/me')).status()).toBe(401);
  expect((await b.request.get(path)).status()).toBe(401);
  await a.close(); await b.close();
});

test('UI logout invalidates the session when browser push cleanup fails',async({page})=>{
  await login(page,1);
  await page.evaluate(()=>{
    Object.defineProperty(navigator.serviceWorker,'getRegistration',{value:async()=>({pushManager:{getSubscription:async()=>({endpoint:'https://fcm.googleapis.com/fcm/send/test-logout',unsubscribe:async()=>{throw new Error('Browser push cleanup failed');}})}})});
  });
  await page.getByRole('button',{name:'설정',exact:true}).click();
  await page.getByRole('button',{name:'로그아웃',exact:true}).click();
  await expect(page.getByRole('button',{name:'로그인',exact:true})).toBeVisible();
  expect((await page.request.get('/api/auth/me')).status()).toBe(401);
});
