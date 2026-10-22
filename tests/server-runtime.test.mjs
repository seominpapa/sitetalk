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
  const password='test-only-signup-3!';
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
