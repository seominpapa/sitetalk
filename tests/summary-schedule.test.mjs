import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { siteRoutes } from '../apps/worker/src/sites.ts';

const admin = { id: 'admin', role: 'admin' };
const manager = { id: 'manager', role: 'member' };
const staff = { id: 'staff', role: 'member' };
function setup(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  for (const file of ['0001_initial.sql', '0002_sites_and_settings.sql']) db.exec(readFileSync(new URL(`../database/migrations/${file}`, import.meta.url), 'utf8'));
  for (const user of [admin, manager, staff]) db.prepare('INSERT INTO users(id,name,email,role,created_at) VALUES(?,?,?,?,1)').run(user.id,user.id,`${user.id}@example.invalid`,user.role);
  db.exec("INSERT INTO sites(id,name,created_by,created_at) VALUES('alpha','A현장','admin',1),('beta','B현장','admin',1)");
  db.exec("INSERT INTO site_memberships(site_id,user_id,role,status,created_at,updated_at) VALUES('alpha','manager','manager','approved',1,1),('alpha','staff','member','approved',1,1)");
  db.exec(readFileSync(new URL('../database/migrations/0004_summary_schedule.sql', import.meta.url), 'utf8'));
  const DB = { prepare(sql) { const statement=db.prepare(sql); return { bind(...args) { return {
    async first() { return statement.get(...args)||null; }, async all() { return {results:statement.all(...args)}; },
  }; } }; } };
  return {db,env:{DB}};
}
const request=(path,body)=>new Request(`https://site.example/api${path}`,body===undefined?undefined:{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const data=async response=>(await response.json()).data;

test('schedule migration preserves existing sites and default-on behavior; constrains future values', t => {
  const {db}=setup(t);
  assert.deepEqual(db.prepare('SELECT auto_summary_enabled FROM sites ORDER BY id').all().map(row=>row.auto_summary_enabled),[1,1]);
  db.exec("INSERT INTO sites(id,name,created_by,created_at) VALUES('gamma','C현장','admin',2)");
  assert.equal(db.prepare("SELECT auto_summary_enabled FROM sites WHERE id='gamma'").get().auto_summary_enabled,1);
  for (const value of ['2','-1','NULL',"'true'"]) assert.throws(()=>db.exec(`UPDATE sites SET auto_summary_enabled=${value}`),/constraint/i);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
});

test('admin lists all schedules, approved manager lists own only, regular/pending/revoked cannot manage', async t => {
  const {db,env}=setup(t);
  assert.deepEqual(await data(await siteRoutes(request('/summary-schedules'),env,admin)),[
    {site_id:'alpha',site_name:'A현장',enabled:true},{site_id:'beta',site_name:'B현장',enabled:true},
  ]);
  assert.deepEqual(await data(await siteRoutes(request('/summary-schedules'),env,manager)),[{site_id:'alpha',site_name:'A현장',enabled:true}]);
  await assert.rejects(siteRoutes(request('/summary-schedules'),env,staff),error=>error.status===403);
  for(const status of ['pending','rejected']) {
    db.prepare("UPDATE site_memberships SET status=? WHERE user_id='manager'").run(status);
    await assert.rejects(siteRoutes(request('/summary-schedules'),env,manager),error=>error.status===403);
    await assert.rejects(siteRoutes(request('/sites/alpha/summary-schedule',{enabled:false}),env,manager),error=>error.status===403);
  }
  assert.equal(await siteRoutes(request('/summary-schedules'),env,null),null);
});

test('only authorized strict boolean updates persist and saving never calls paid API', async t => {
  const {db,env}=setup(t);
  const fetch=t.mock.method(globalThis,'fetch',async()=>{throw new Error('No paid call when saving');});
  await assert.rejects(siteRoutes(request('/sites/alpha/summary-schedule',{enabled:false}),env,staff),error=>error.status===403);
  await assert.rejects(siteRoutes(request('/sites/beta/summary-schedule',{enabled:false}),env,manager),error=>error.status===403);
  for (const body of [{},{enabled:0},{enabled:1},{enabled:'true'},{enabled:null},{enabled:false,time:'00:00'}]) {
    await assert.rejects(siteRoutes(request('/sites/alpha/summary-schedule',body),env,manager),error=>error.status===400);
  }
  assert.equal(db.prepare("SELECT auto_summary_enabled FROM sites WHERE id='alpha'").get().auto_summary_enabled,1);
  assert.deepEqual(await data(await siteRoutes(request('/sites/alpha/summary-schedule',{enabled:false}),env,manager)),{site_id:'alpha',enabled:false});
  assert.deepEqual(await data(await siteRoutes(request('/summary-schedules'),env,manager)),[{site_id:'alpha',site_name:'A현장',enabled:false}]);
  assert.deepEqual(await data(await siteRoutes(request('/sites/alpha/summary-schedule',{enabled:false}),env,manager)),{site_id:'alpha',enabled:false});
  assert.deepEqual(await data(await siteRoutes(request('/sites/beta/summary-schedule',{enabled:false}),env,admin)),{site_id:'beta',enabled:false});
  await siteRoutes(request('/sites/alpha/summary-schedule',{enabled:true}),env,manager);
  assert.equal(db.prepare("SELECT auto_summary_enabled FROM sites WHERE id='alpha'").get().auto_summary_enabled,1);
  await assert.rejects(siteRoutes(request('/sites/missing/summary-schedule',{enabled:true}),env,admin),error=>error.status===404);
  assert.equal(fetch.mock.callCount(),0);
});

test('revocation while JSON is being parsed cannot win an earlier authorization check', async t => {
  const {db,env}=setup(t);
  const encoded=new TextEncoder().encode('{"enabled":false}');
  const body=new ReadableStream({pull(controller){db.exec("UPDATE site_memberships SET status='rejected' WHERE user_id='manager'");controller.enqueue(encoded);controller.close();}});
  const req=new Request('https://site.example/api/sites/alpha/summary-schedule',{method:'PUT',headers:{'Content-Type':'application/json'},body,duplex:'half'});
  await assert.rejects(siteRoutes(req,env,manager),error=>error.status===403);
  assert.equal(db.prepare("SELECT auto_summary_enabled FROM sites WHERE id='alpha'").get().auto_summary_enabled,1);
});
