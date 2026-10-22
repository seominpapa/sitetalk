import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { configuration } from '../apps/server/config.mjs';
import { staticAssets } from '../apps/server/assets.mjs';
import { dailyScheduler } from '../apps/server/scheduler.mjs';
import { openDatabase } from '../apps/server/storage.mjs';
import handler from '../apps/worker/src/handler.ts';

const key=randomBytes(32).toString('base64');
function directory(t) {const path=mkdtempSync(join(tmpdir(),'site-talk-platform-'));t.after(()=>rm(path,{recursive:true,force:true}));return path;}
const base={AI_SETTINGS_ENCRYPTION_KEY:key,PUBLIC_ORIGIN:'https://talk.example.invalid'};
test('server configuration accepts explicit secure origins and loopback development only',()=>{
  const configured=configuration({environment:{...base,UNRELATED_SECRET:'do not copy'}});
  assert.equal(configured.publicOrigin,base.PUBLIC_ORIGIN);assert.equal(configured.port,3000);assert.equal(configured.host,'127.0.0.1');
  assert.deepEqual(configured.secrets,{AI_SETTINGS_ENCRYPTION_KEY:key});assert.equal(configured.dataDir,resolve('data'));
  for(const origin of ['http://localhost:3000','http://127.0.0.1:3000','http://[::1]:3000','https://talk.example.invalid:444']) assert.equal(configuration({environment:{...base,PUBLIC_ORIGIN:origin}}).publicOrigin,origin);
  for(const origin of [undefined,'not-url','http://talk.example.invalid','https://talk.example.invalid/','https://talk.example.invalid/path','https://user:pass@talk.example.invalid','https://talk.example.invalid?secret=1']) assert.throws(()=>configuration({environment:{...base,PUBLIC_ORIGIN:origin}}),/PUBLIC_ORIGIN/);
  for(const encryptionKey of ['',undefined,'short',randomBytes(16).toString('base64'),'!'.repeat(44)]) assert.throws(()=>configuration({environment:{...base,AI_SETTINGS_ENCRYPTION_KEY:encryptionKey}}),/encryption key/);
  for(const port of ['abc','-1','65536','1.5']) assert.throws(()=>configuration({environment:{...base,PORT:port}}),/PORT/);
  assert.equal(configuration({environment:base,port:0,host:'0.0.0.0',dataDir:'custom-data',assetsDir:'custom-assets'}).port,0);
});
test('server secrets read mounted files without leaking unrelated environment variables',t=>{
  const path=directory(t),keyFile=join(path,'key'),apiFile=join(path,'api');
  writeFileSync(keyFile,`${key}\n`,{mode:0o600});writeFileSync(apiFile,' test-only-api-key\n',{mode:0o600});
  const configured=configuration({environment:{PUBLIC_ORIGIN:base.PUBLIC_ORIGIN,AI_SETTINGS_ENCRYPTION_KEY_FILE:keyFile,OPENAI_API_KEY_FILE:apiFile,OPENAI_MODEL:'gpt-4.1-mini'}});
  assert.deepEqual(configured.secrets,{AI_SETTINGS_ENCRYPTION_KEY:key,OPENAI_API_KEY:'test-only-api-key',OPENAI_MODEL:'gpt-4.1-mini'});
  assert.throws(()=>configuration({environment:{...base,AI_SETTINGS_ENCRYPTION_KEY_FILE:keyFile}}),/either/);
  assert.throws(()=>configuration({environment:{...base,OPENAI_API_KEY:'direct',OPENAI_API_KEY_FILE:apiFile}}),/either/);
  assert.throws(()=>configuration({environment:{PUBLIC_ORIGIN:base.PUBLIC_ORIGIN,AI_SETTINGS_ENCRYPTION_KEY_FILE:join(path,'missing')}}),/ENOENT/);
});
test('static assets serve the root and SPA routes, secure MIME and HEAD without a body',async t=>{
  const path=directory(t);mkdirSync(join(path,'assets'));mkdirSync(join(path,'directory'));
  writeFileSync(join(path,'index.html'),'<main>Site Talk</main>');writeFileSync(join(path,'assets','app.js'),'console.log("ok")');
  const assets=staticAssets(path),request=(url,method='GET')=>assets.fetch(new Request(`https://talk.example.invalid${url}`,{method}));
  for(const url of ['/','/rooms/example','/directory']) {const response=await request(url);assert.equal(response.status,200,url);assert.equal(await response.text(),'<main>Site Talk</main>');}
  const js=await request('/assets/app.js');assert.equal(js.headers.get('Content-Type'),'text/javascript; charset=utf-8');assert.match(js.headers.get('Cache-Control'),/immutable/);await js.text();
  const head=await request('/assets/app.js','HEAD');assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(head.headers.get('Content-Length'),'17');
  assert.equal((await request('/','POST')).status,405);
  for(const url of ['/missing.png','/.env','/%00secret','/%zz','/%2eenv']) assert.equal((await request(url)).status,404,url);
});
test('static files cannot follow a symlink outside the assets directory',async t=>{
  const path=directory(t),outside=directory(t);writeFileSync(join(path,'index.html'),'safe');writeFileSync(join(outside,'private.txt'),'secret');
  symlinkSync(join(outside,'private.txt'),join(path,'linked.txt'));
  const response=await staticAssets(path).fetch(new Request('https://talk.example.invalid/linked.txt'));
  assert.equal(response.status,404);assert.ok(!(await response.text()).includes('secret'));
});
test('scheduler runs at 23:50 KST once per day and retains completion across restart',async t=>{
  const db=openDatabase(directory(t));t.after(()=>db.close());
  const scheduled=t.mock.method(handler,'scheduled',async()=>{}),env={DB:db},tick=dailyScheduler(env);
  assert.equal(await tick(new Date('2026-10-22T14:49:59Z')),false);assert.equal(scheduled.mock.callCount(),0);
  assert.equal(await tick(new Date('2026-10-22T14:50:00Z')),true);assert.equal(await tick(new Date('2026-10-22T23:59:59Z')),false);
  const restarted=dailyScheduler(env);assert.equal(await restarted(new Date('2026-10-22T15:00:00Z')),false);
  assert.equal(await restarted(new Date('2026-10-23T14:50:00Z')),true);assert.equal(scheduled.mock.callCount(),2);
});
test('scheduler prevents concurrent ticks and retries a failed daily run',async t=>{
  const db=openDatabase(directory(t));t.after(()=>db.close());
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const scheduled=t.mock.method(handler,'scheduled',async()=>gate),tick=dailyScheduler({DB:db}),now=new Date('2026-10-22T14:50:00Z');
  const first=tick(now),second=tick(now);await setImmediate();
  const calls=scheduled.mock.callCount();release();
  const results=await Promise.all([first,second]);assert.equal(calls,1);assert.deepEqual(results,[true,false]);
  scheduled.mock.mockImplementation(async()=>{throw new Error('test-only schedule failure');});
  await assert.rejects(tick(new Date('2026-10-23T14:50:00Z')),/schedule failure/);
  scheduled.mock.mockImplementation(async()=>{});
  assert.equal(await tick(new Date('2026-10-23T14:50:01Z')),true);
});
test('private data cannot overlap the public static asset tree',()=>{
  const encryptionKey=Buffer.alloc(32,7).toString('base64');
  for(const [dataDir,assetsDir] of [['/tmp/sitetalk-public','/tmp/sitetalk-public'],['/tmp/sitetalk-public/data','/tmp/sitetalk-public'],['/tmp/sitetalk-private','/tmp/sitetalk-private/dist']]) {
    assert.throws(()=>configuration({dataDir,assetsDir,publicOrigin:'http://localhost',encryptionKey}),/overlap|separate/i);
  }
});
