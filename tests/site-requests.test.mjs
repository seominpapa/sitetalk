import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { siteRoutes, selectedSite } from '../apps/worker/src/sites.ts';
import { verifyPassword } from '../apps/worker/src/crypto.ts';

const admin={id:'admin',role:'admin'},member={id:'member',role:'member'};
function setup(t) {
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  for(const file of ['0001_initial.sql','0002_sites_and_settings.sql']) db.exec(readFileSync(new URL(`../database/migrations/${file}`,import.meta.url),'utf8'));
  for(const user of [admin,member]) db.prepare('INSERT INTO users(id,name,email,role,created_at) VALUES(?,?,?,?,1)').run(user.id,user.id,`${user.id}@example.invalid`,user.role);
  db.exec("INSERT INTO rooms(id,title,purpose,created_by,created_at) VALUES('legacy','기존 대화','보존','admin',1)");
  db.exec(readFileSync(new URL('../database/migrations/0003_site_creation_requests.sql',import.meta.url),'utf8'));
  const DB={prepare(sql){const statement=db.prepare(sql);return{bind(...args){return{
    async first(){return statement.get(...args)||null;},async all(){return{results:statement.all(...args)};},async run(){return{meta:{changes:statement.run(...args).changes}};},
    execute(){return{results:statement.all(...args)};},
  };}};},async batch(statements){db.exec('BEGIN');try{const results=statements.map(statement=>statement.execute());db.exec('COMMIT');return results;}catch(error){db.exec('ROLLBACK');throw error;}}};
  return{db,env:{DB}};
}
const request=(path,body,method=body?'POST':'GET')=>new Request(`https://site.example/api${path}`,body?{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);
const data=async response=>(await response.json()).data;
const managerBody=(email='new-manager@example.invalid')=>({name:'새 담당자',email,password:'abcdef1!',password_confirmation:'abcdef1!',registration_type:'manager',site_name:'  신설 현장  ',company:'건설',department:'공사'});
async function signup(env,body=managerBody()){return siteRoutes(request('/auth/register',body),env,null);}
async function pending(env,db,email='new-manager@example.invalid'){
  assert.equal((await signup(env,managerBody(email))).status,201);
  return db.prepare('SELECT * FROM site_creation_requests WHERE user_id=(SELECT id FROM users WHERE email=?)').get(email);
}
const decide=(env,id,status='approved',actor=admin)=>siteRoutes(request(`/admin/site-requests/${id}`,{status},'PUT'),env,actor);

test('manager signup with no existing site creates a private pending request, not a site or privileged membership',async t=>{
  const{db,env}=setup(t),body={...managerBody(),role:'admin',status:'approved',site_id:'ignored',site_role:'manager'};
  const response=await signup(env,body);assert.equal(response.status,201);
  assert.deepEqual(await data(response),{status:'pending'});
  const user=db.prepare('SELECT * FROM users WHERE email=?').get(body.email);
  assert.equal(user.role,'member');assert(await verifyPassword(body.password,user.password_hash));
  const row=db.prepare('SELECT * FROM site_creation_requests WHERE user_id=?').get(user.id);
  assert.equal(row.status,'pending');assert.equal(row.site_name,'신설 현장');assert.equal(row.site_id,null);assert.equal(row.reviewed_by,null);
  assert.equal(db.prepare('SELECT count(*) n FROM sites').get().n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM site_memberships').get().n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM membership_events').get().n,0);
  await assert.rejects(selectedSite(env,{id:user.id,role:'member'},undefined),error=>error.status===400);
  const own=await data(await siteRoutes(request('/me/site-requests'),env,{id:user.id,role:'member'}));
  assert.equal(own.length,1);assert.equal(own[0].id,row.id);assert.equal(own[0].status,'pending');assert(!JSON.stringify(own).includes('password'));
  assert.deepEqual(await data(await siteRoutes(request('/me/site-requests'),env,member)),[]);
  assert.equal(await siteRoutes(request('/me/site-requests'),env,null),null);
  await assert.rejects(signup(env,body),error=>error.status===409);
});

test('invalid manager mode, name and password cannot create accounts or requests',async t=>{
  for(const [index,invalid] of [
    {registration_type:'admin'},{registration_type:''},{registration_type:42},
    {site_name:''},{site_name:'   '},{site_name:'x'.repeat(121)},{site_name:null},{site_name:42},
    {password:'abcdef1'},{password:'12345678'},{password:'abcdefg!'},{password:'abcdefgh1'},
    {password_confirmation:undefined},{password_confirmation:'abcdef2!'},{password_confirmation:'abcdef1! '},
    {email:'not-an-email'},{name:' '},
  ].entries()) await t.test(`invalid case ${index+1}`,async t=>{
    const{db,env}=setup(t);
    await assert.rejects(signup(env,{...managerBody(),...invalid}),error=>error.status===400);
    assert.equal(db.prepare('SELECT count(*) n FROM users').get().n,2);
    assert.equal(db.prepare('SELECT count(*) n FROM site_creation_requests').get().n,0);
  });
});

test('default and explicit member signup still require an existing site and never create site requests',async t=>{
  const{db,env}=setup(t);
  await assert.rejects(signup(env,{...managerBody(),registration_type:'member'}),error=>error.status===400);
  await assert.rejects(signup(env,{...managerBody(),registration_type:'member',site_id:'missing'}),error=>error.status===404);
  db.exec("INSERT INTO sites(id,name,created_by,created_at) VALUES('existing','기존 현장','admin',1)");
  for(const [index,registration_type] of [undefined,'member'].entries()) {
    const body={...managerBody(`staff-${index}@example.invalid`),registration_type,site_id:'existing'};
    assert.equal((await signup(env,body)).status,201);
    const membership=db.prepare('SELECT sm.role,sm.status FROM site_memberships sm JOIN users u ON sm.user_id=u.id WHERE u.email=?').get(body.email);
    assert.equal(membership.role,'member');assert.equal(membership.status,'pending');
  }
  assert.equal(db.prepare('SELECT count(*) n FROM site_creation_requests').get().n,0);
});

test('only administrators list and decide site-creation requests; all lists omit credential fields',async t=>{
  const{db,env}=setup(t),row=await pending(env,db);
  for(const path of ['/admin/site-requests',`/admin/site-requests/${row.id}`]) {
    await assert.rejects(siteRoutes(request(path,path.endsWith(row.id)?{status:'approved'}:undefined,path.endsWith(row.id)?'PUT':'GET'),env,member),error=>error.status===403);
    assert.equal(await siteRoutes(request(path),env,null),null);
  }
  const rows=await data(await siteRoutes(request('/admin/site-requests'),env,admin));
  assert.equal(rows.length,1);
  for(const field of ['id','user_id','site_name','name','email','company','department','status','created_at','updated_at','site_id']) assert(field in rows[0],field);
  assert(!JSON.stringify(rows).includes('password'));assert.equal(rows[0].company,'건설');
  await assert.rejects(decide(env,'missing'),error=>error.status===404);
  for(const status of ['pending','admin',null,{},'']) await assert.rejects(decide(env,row.id,status),error=>error.status===400);
  assert.equal(db.prepare('SELECT status FROM site_creation_requests').get().status,'pending');
});

test('approval creates exactly one site and approved manager membership without global role escalation',async t=>{
  const{db,env}=setup(t),row=await pending(env,db);
  const result=await data(await decide(env,row.id));
  assert.equal(result.status,'approved');assert.equal(typeof result.site_id,'string');
  const site=db.prepare('SELECT * FROM sites WHERE id=?').get(result.site_id);
  assert.equal(site.name,'신설 현장');assert.equal(site.created_by,'admin');
  const membership=db.prepare('SELECT * FROM site_memberships WHERE site_id=? AND user_id=?').get(site.id,row.user_id);
  assert.equal(membership.role,'manager');assert.equal(membership.status,'approved');assert.equal(membership.reviewed_by,'admin');
  const event=db.prepare('SELECT * FROM membership_events WHERE site_id=?').get(site.id);
  assert.equal(event.user_id,row.user_id);assert.equal(event.actor_id,'admin');assert.equal(event.role,'manager');assert.equal(event.status,'approved');
  const decided=db.prepare('SELECT * FROM site_creation_requests WHERE id=?').get(row.id);
  assert.equal(decided.status,'approved');assert.equal(decided.site_id,site.id);assert.equal(decided.reviewed_by,'admin');
  assert.equal(db.prepare('SELECT role FROM users WHERE id=?').get(row.user_id).role,'member');
  assert.equal(await selectedSite(env,{id:row.user_id,role:'member'},undefined),site.id);
  await assert.rejects(decide(env,row.id),error=>error.status===409);
  await assert.rejects(decide(env,row.id,'rejected'),error=>error.status===409);
  assert.equal(db.prepare('SELECT count(*) n FROM sites').get().n,1);
  assert.equal(db.prepare('SELECT count(*) n FROM membership_events').get().n,1);
  assert.equal(db.prepare("SELECT title FROM rooms WHERE id='legacy'").get().title,'기존 대화');
});

test('rejection creates no site or membership and cannot be approved again',async t=>{
  const{db,env}=setup(t),row=await pending(env,db);
  assert.deepEqual(await data(await decide(env,row.id,'rejected')),{status:'rejected',site_id:null});
  assert.equal(db.prepare('SELECT reviewed_by FROM site_creation_requests').get().reviewed_by,'admin');
  for(const table of ['sites','site_memberships','membership_events']) assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
  await assert.rejects(decide(env,row.id),error=>error.status===409);
});

test('racing decisions have one winner, return a conflict to the loser and leave no duplicates',async t=>{
  for(const statuses of [['approved','approved'],['approved','rejected'],['rejected','approved']]) await t.test(statuses.join(' vs '),async t=>{
    const{db,env}=setup(t),row=await pending(env,db);
    const results=await Promise.allSettled(statuses.map(status=>decide(env,row.id,status)));
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
    assert.equal(results.find(result=>result.status==='rejected').reason.status,409);
    const stored=db.prepare('SELECT status,site_id FROM site_creation_requests').get(),count=stored.status==='approved'?1:0;
    for(const table of ['sites','site_memberships','membership_events']) assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n,count);
    assert.equal(stored.site_id===null,count===0);
  });
});

test('approval transaction failure rolls back the request, new site, membership and audit together',async t=>{
  const{db,env}=setup(t),row=await pending(env,db);
  db.exec("CREATE TRIGGER fail_request_event BEFORE INSERT ON membership_events BEGIN SELECT RAISE(ABORT,'test audit failure');END");
  await assert.rejects(decide(env,row.id),/test audit failure/);
  const unchanged=db.prepare('SELECT * FROM site_creation_requests').get();
  assert.equal(unchanged.status,'pending');assert.equal(unchanged.site_id,null);assert.equal(unchanged.reviewed_by,null);
  for(const table of ['sites','site_memberships','membership_events']) assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM users').get().n,3);
  assert.equal(db.prepare('SELECT count(*) n FROM rooms').get().n,1);
  db.exec('DROP TRIGGER fail_request_event');assert.equal((await decide(env,row.id)).status,200);
});

test('manager registration transaction failure does not leave an orphan account',async t=>{
  const{db,env}=setup(t);
  db.exec("CREATE TRIGGER fail_new_request BEFORE INSERT ON site_creation_requests BEGIN SELECT RAISE(ABORT,'test request failure');END");
  await assert.rejects(signup(env),/test request failure/);
  assert.equal(db.prepare('SELECT count(*) n FROM users').get().n,2);
  assert.equal(db.prepare('SELECT count(*) n FROM site_creation_requests').get().n,0);
});

test('additive migration preserves existing rows and enforces request state constraints and foreign keys',t=>{
  const{db}=setup(t);
  assert.equal(db.prepare('SELECT count(*) n FROM users').get().n,2);
  assert.equal(db.prepare('SELECT count(*) n FROM rooms').get().n,1);
  const insert=db.prepare('INSERT INTO site_creation_requests(id,user_id,site_name,status,created_at,updated_at) VALUES(?,?,?,?,1,1)');
  for(const [name,status] of [['','pending'],['   ','pending'],['x'.repeat(121),'pending'],['현장','invalid'],['현장','approved']]) assert.throws(()=>insert.run('invalid','member',name,status));
  assert.throws(()=>insert.run('missing','missing','현장','pending'),/FOREIGN KEY/);
  insert.run('request','member','현장','pending');
  assert.throws(()=>insert.run('duplicate','member','현장','pending'),/UNIQUE/);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
