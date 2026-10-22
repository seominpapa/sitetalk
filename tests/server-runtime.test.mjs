import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import WebSocket from 'ws';
import {startServer} from '../apps/server/main.mjs';
import {createAdministrator} from '../apps/server/admin.mjs';

async function fixture(t) {
  const dataDir=await mkdtemp(path.join(tmpdir(),'sitetalk-runtime-'));
  t.after(()=>rm(dataDir,{recursive:true,force:true}));
  const receipt=await createAdministrator({dataDir,email:'owner@example.invalid',name:'설치 관리자'});
  const account=JSON.parse(await readFile(receipt,'utf8'));
  const application=await startServer({dataDir,publicOrigin:'http://localhost',port:0,host:'127.0.0.1',encryptionKey:randomBytes(32).toString('base64'),schedule:false});
  t.after(()=>application.close());
  const base=`http://127.0.0.1:${application.server.address().port}`;
  async function request(route,body,cookie,method=body?'POST':'GET',extra={}) {
    const response=await fetch(base+'/api'+route,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,headers:response.headers,data:(await response.json()).data};
  }
  const login=await request('/auth/login',{email:account.email,password:account.password});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  return {dataDir,application,base,request,account,cookie};
}

test('fresh server admin login, global encrypted API settings and unprivileged signup',async t=>{
  const {request,cookie,dataDir,application}=await fixture(t);
  assert.equal((await request('/health')).status,200);
  const stats=await request('/admin/stats',undefined,cookie); assert.equal(stats.data.users.length,1);
  assert.equal((await request('/admin/ai-settings',undefined,cookie)).data.storage_ready,true);
  const testKey='sk-test-portable-server-not-a-real-key';
  const saved=await request('/admin/ai-settings',{model:'gpt-4.1-mini',api_key:testKey},cookie,'PUT');
  assert.equal(saved.status,200); assert.equal(saved.data.source,'database'); assert(!JSON.stringify(saved).includes(testKey));
  const row=await application.env.DB.prepare('SELECT encrypted_key FROM ai_settings').first();
  assert(!row.encrypted_key.includes(testKey));
  await assert.rejects(createAdministrator({dataDir,email:'owner@example.invalid',name:'중복'}));
  const password=randomBytes(18).toString('base64url')+'1!';
  assert.equal((await request('/auth/register',{email:'manager@example.invalid',name:'현장담당자',password,password_confirmation:password,registration_type:'manager',site_name:'Docker 검증 현장',role:'admin'})).status,201);
  const login=await request('/auth/login',{email:'manager@example.invalid',password});
  assert.equal(login.data.role,'member');
  const memberCookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/admin/ai-settings',undefined,memberCookie)).status,403);
  assert.equal((await request('/summary-schedules',undefined,memberCookie)).status,403);
  assert.equal((await request('/sites',{name:'공격'},cookie,'POST',{Origin:'https://attacker.invalid'})).status,403);
});

test('room mutations preserve idempotency, websocket delivery, attachments and logout revocation',async t=>{
  const {request,cookie,account,base}=await fixture(t);
  const site=(await request('/sites',{name:'실시간 현장'},cookie)).data;
  const room=(await request('/rooms',{site_id:site.id,title:'휴대형 대화',purpose:'Docker 검증',member_ids:[]},cookie)).data;
  const ws=new WebSocket(base.replace('http:','ws:')+`/api/rooms/${room.id}/ws`,{headers:{Cookie:cookie,Origin:'http://localhost'}});
  t.after(()=>ws.terminate());
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  const event=new Promise(resolve=>ws.once('message',value=>resolve(JSON.parse(String(value)))));
  const body={content:'컨테이너 실시간 메시지',client_id:crypto.randomUUID()};
  const [a,b]=await Promise.all([request(`/rooms/${room.id}/messages`,body,cookie),request(`/rooms/${room.id}/messages`,body,cookie)]);
  assert.equal(a.status,201);assert.equal(a.data.id,b.data.id);assert.equal(a.data.seq,1);
  assert.equal((await event).message.content,body.content);
  const form=new FormData();form.set('client_id',crypto.randomUUID());form.set('file',new File(['%PDF-1.4\nportable'],'검증.pdf',{type:'application/pdf'}));
  const uploaded=await fetch(base+`/api/rooms/${room.id}/attachments`,{method:'POST',headers:{Cookie:cookie},body:form});
  assert.equal(uploaded.status,201);const message=(await uploaded.json()).data;
  const file=await fetch(base+`/api/attachments/${message.attachment.id}`,{headers:{Cookie:cookie}});
  assert.equal(file.status,200);assert.equal(await file.text(),'%PDF-1.4\nportable');
  assert.equal((await request(`/rooms/${room.id}/close`,{conclusion:'검증 완료',owner_id:account.id},cookie)).status,200);
  assert.equal((await request(`/rooms/${room.id}/messages`,{content:'금지',client_id:crypto.randomUUID()},cookie)).status,409);
  const closed=new Promise(resolve=>ws.once('close',code=>resolve(code)));
  assert.equal((await request('/auth/logout',{},cookie)).status,200);
  ws.send(JSON.stringify({type:'presence',visible:true}));
  assert.equal(await closed,1008);
  assert.equal((await request('/auth/me',undefined,cookie)).status,401);
});

test('production requires stable encryption key and an explicit safe public origin',async()=>{
  await assert.rejects(startServer({publicOrigin:'https://app.example.invalid',dataDir:'/unused',schedule:false}),/encryption/i);
  await assert.rejects(startServer({publicOrigin:'http://public.example.invalid',encryptionKey:randomBytes(32).toString('base64'),dataDir:'/unused',schedule:false}),/HTTPS|origin/i);
});

test('rejected websocket upgrades cancel unused response streams',async t=>{
  const {application,base}=await fixture(t);let cancelled=0;
  t.mock.method(application.env.ASSETS,'fetch',async()=>new Response(new ReadableStream({cancel(){cancelled++;}})));
  const status=await new Promise((resolve,reject)=>{
    const socket=new WebSocket(base.replace('http:','ws:')+'/unused-download');
    socket.once('unexpected-response',(_request,response)=>{response.resume();resolve(response.statusCode);socket.terminate();});
    socket.once('error',error=>{if(!cancelled)reject(error);});
  });
  assert.equal(status,200);assert.equal(cancelled,1);
});

test('one stored API key produces searchable summaries and private originals on the server',async t=>{
  const {request,cookie,account,application,base}=await fixture(t);
  const testKey='sk-test-server-summary-not-a-real-key';
  await request('/admin/ai-settings',{model:'gpt-4.1-mini',api_key:testKey},cookie,'PUT');
  const site=(await request('/sites',{name:'요약 현장'},cookie)).data;
  const password=randomBytes(18).toString('base64url')+'1!';
  await request('/auth/register',{email:'staff@example.invalid',name:'요약 직원',password,password_confirmation:password,site_id:site.id});
  const staffLogin=await request('/auth/login',{email:'staff@example.invalid',password});
  const staffCookie=staffLogin.headers.get('set-cookie').split(';')[0];
  const staff=staffLogin.data;
  assert.equal((await request(`/sites/${site.id}/members/${staff.id}`,{status:'approved',role:'member'},cookie,'PUT')).status,200);
  const room=(await request('/rooms',{site_id:site.id,title:'Docker 요약 검증',purpose:'안전 통제 합의',member_ids:[staff.id]},cookie)).data;
  await request(`/rooms/${room.id}/messages`,{content:'16시 작업 전 안전통제 점검합니다.',client_id:crypto.randomUUID()},cookie);
  await request(`/rooms/${room.id}/close`,{conclusion:'안전통제 확정',owner_id:account.id},cookie);
  const original=globalThis.fetch;let calls=0;
  t.mock.method(globalThis,'fetch',async(input,options)=>{
    if(String(input)==='https://api.openai.com/v1/responses') {
      calls++;assert.equal(options.headers.Authorization,`Bearer ${testKey}`);
      return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({summary:'16시 안전통제 확정',decisions:['점검'],actions:['통제'],keywords:['안전통제']})}]}]});
    }
    return original(input,options);
  });
  assert.equal(await application.tick(new Date('2026-10-22T14:50:00Z')),true);
  assert.equal(calls,1);
  const summaries=await request('/summaries?q=안전통제',undefined,staffCookie);
  assert.equal(summaries.status,200);assert.equal(summaries.data[0].room_id,room.id);
  const transcript=await request(`/summaries/${room.id}/transcript`,undefined,staffCookie);
  assert.equal(transcript.status,200);assert.equal(transcript.data.messages[0].content,'16시 작업 전 안전통제 점검합니다.');
  const archive=await fetch(base+`/api/summaries/${room.id}/archive`,{headers:{Cookie:staffCookie}});
  assert.equal(archive.status,200);assert.match(await archive.text(),/16시 작업 전 안전통제 점검합니다/);
});
