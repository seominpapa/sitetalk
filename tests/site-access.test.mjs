import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { siteRoutes, approvedSite, selectedSite } from '../apps/worker/src/sites.ts';
import { summaryRoutes } from '../apps/worker/src/summaries.ts';
import { memberRoom } from '../apps/worker/src/data.ts';
import { verifyPassword } from '../apps/worker/src/crypto.ts';

const admin = { id: 'admin', role: 'admin' };
const manager = { id: 'manager', role: 'member' };
const staff = { id: 'staff', role: 'member' };
const outsider = { id: 'outsider', role: 'member' };
function setup(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  for (const file of ['0001_initial.sql', '0002_sites_and_settings.sql']) db.exec(readFileSync(new URL(`../database/migrations/${file}`, import.meta.url), 'utf8'));
  for (const user of [admin, manager, staff, outsider]) db.prepare('INSERT INTO users(id,name,email,role,created_at) VALUES(?,?,?,?,1)').run(user.id,user.id,`${user.id}@example.invalid`,user.role);
  db.exec("INSERT INTO sites(id,name,created_by,created_at) VALUES('alpha','A현장','admin',1),('beta','B현장','admin',1)");
  db.exec("INSERT INTO site_memberships(site_id,user_id,role,status,created_at,updated_at) VALUES('alpha','manager','manager','approved',1,1),('alpha','staff','member','pending',1,1),('beta','outsider','manager','approved',1,1)");
  const DB = { prepare(sql) { const statement=db.prepare(sql); return { bind(...args) { return {
    async first() { return statement.get(...args)||null; }, async all() { return {results:statement.all(...args)}; }, async run() { return {meta:{changes:statement.run(...args).changes}}; },
  }; } }; }, async batch(statements) { db.exec('BEGIN'); try { const results=[]; for(const statement of statements) results.push(await statement.all()); db.exec('COMMIT'); return results; } catch(error) {db.exec('ROLLBACK');throw error;} } };
  return {db, env:{DB,FILES:{async get(){return null;}}}};
}
const request=(path,body,method=body?'POST':'GET')=>new Request(`https://site.example/api${path}`,body?{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);
const data=async response=>(await response.json()).data;
async function decide(env,actor,site,user,status='approved',role='member') {
  return siteRoutes(request(`/sites/${site}/members/${user}`,{status,role},'PUT'),env,actor);
}
test('manager approves only own pending team, admin appoints and promotes; no global role escalation',async t=>{
  const {db,env}=setup(t);
  assert.equal((await data(await siteRoutes(request('/approvals'),env,manager))).length,2);
  await assert.rejects(decide(env,outsider,'alpha','staff'),error=>error.status===403);
  await assert.rejects(decide(env,manager,'alpha','staff','approved','manager'),error=>error.status===403);
  await decide(env,manager,'alpha','staff');
  assert.equal(db.prepare("SELECT status FROM site_memberships WHERE user_id='staff'").get().status,'approved');
  await assert.rejects(decide(env,manager,'alpha','staff','rejected'),error=>[403,409].includes(error.status));
  await decide(env,admin,'alpha','staff','approved','manager');
  assert.equal(db.prepare("SELECT role FROM site_memberships WHERE user_id='staff'").get().role,'manager');
  assert.equal(db.prepare("SELECT role FROM users WHERE id='staff'").get().role,'member');
  assert.equal(db.prepare('SELECT count(*) n FROM membership_events').get().n,2);
  await decide(env,admin,'alpha','outsider','approved','member');
  await assert.rejects(decide(env,admin,'alpha','staff','approved','admin'),error=>error.status===400);
  assert.equal((await siteRoutes(request('/sites',{name:'새 현장'}),env,admin)).status,201);
  await assert.rejects(siteRoutes(request('/sites',{name:'금지'}),env,manager),error=>error.status===403);
});
test('signup is pending and unprivileged, passwords hashed; invalid and duplicate requests are rejected',async t=>{
  const {db,env}=setup(t);
  const signupPassword='test-only-long-password-1!';
  const body={name:'신규 팀원',email:'NEW@example.invalid',password:signupPassword,password_confirmation:signupPassword,site_id:'alpha',role:'admin',status:'approved'};
  const result=await siteRoutes(request('/auth/register',body),env,null);
  assert.equal(result.status,201);
  const user=db.prepare("SELECT * FROM users WHERE email='new@example.invalid'").get();
  assert.equal(user.role,'member');assert.notEqual(user.password_hash,body.password);
  assert.equal(db.prepare('SELECT status FROM site_memberships WHERE user_id=?').get(user.id).status,'pending');
  assert.ok(!JSON.stringify(await result.json()).includes('password'));
  await assert.rejects(approvedSite(env,'alpha',user.id),error=>error.status===403);
  await assert.rejects(siteRoutes(request('/auth/register',body),env,null),error=>error.status===409);
  for(const invalid of [{password:'short'},{email:'not-an-email'},{site_id:'missing'}]) await assert.rejects(siteRoutes(request('/auth/register',{...body,email:'another@example.invalid',...invalid}),env,null),error=>[400,404].includes(error.status));
  assert.equal(db.prepare("SELECT count(*) n FROM users WHERE email='another@example.invalid'").get().n,0);
});
test('signup enforces password rules even when a request claims administrator privileges',async t=>{
  for (const [index,password] of ['Abc1!xy','12345678','abcdefg!','abcd1234','abcd123 ','가나다라마바12'].entries()) {
    await t.test(`rejects invalid password case ${index+1}`,async t=>{
      const {db,env}=setup(t);
      await assert.rejects(siteRoutes(request('/auth/register',{name:'가입 검증',email:'policy@example.invalid',password,password_confirmation:password,site_id:'alpha',role:'admin'}),env,null),error=>error.status===400 && error.code==='INVALID_REGISTRATION' && error.message.includes('8자') && error.message.includes('특수문자') && error.message.includes('숫자'));
      assert.equal(db.prepare("SELECT count(*) n FROM users WHERE email='policy@example.invalid'").get().n,0);
      assert.equal(db.prepare("SELECT count(*) n FROM site_memberships WHERE user_id NOT IN ('manager','staff','outsider')").get().n,0);
    });
  }
  for (const password of ['abcdef1!','1234567!','가나다라마바1!']) {
    await t.test(`accepts valid eight-character signup ${password.startsWith('a')?'letters':password.startsWith('1')?'digits':'Korean'}`,async t=>{
      const {db,env}=setup(t);
      assert.equal((await siteRoutes(request('/auth/register',{name:'가입 검증',email:'policy@example.invalid',password,password_confirmation:password,site_id:'alpha',role:'admin'}),env,null)).status,201);
      const user=db.prepare("SELECT id,role,password_hash FROM users WHERE email='policy@example.invalid'").get();
      assert.equal(user.role,'member');assert(await verifyPassword(password,user.password_hash));
      assert.equal(db.prepare('SELECT status FROM site_memberships WHERE user_id=?').get(user.id).status,'pending');
    });
  }
});
test('signup requires exact password confirmation and stores no account for missing or mismatched input',async t=>{
  for(const [index,password_confirmation] of [undefined,null,42,'','abcdef2!','abcdef1! '].entries()) {
    await t.test(`invalid confirmation ${index+1}`,async t=>{
      const {db,env}=setup(t);
      await assert.rejects(siteRoutes(request('/auth/register',{name:'확인 검증',email:'confirmation@example.invalid',password:'abcdef1!',password_confirmation,site_id:'alpha'}),env,null),error=>error.status===400 && ['INVALID_INPUT','PASSWORD_MISMATCH'].includes(error.code));
      assert.equal(db.prepare("SELECT count(*) n FROM users WHERE email='confirmation@example.invalid'").get().n,0);
    });
  }
});
function seedSummary(db) {
  db.exec("UPDATE site_memberships SET status='approved' WHERE user_id='staff'");
  db.exec("INSERT INTO rooms(id,site_id,title,purpose,project,created_by,created_at,status,closed_at) VALUES('closed','alpha','발파 협의','협의','A프로젝트','manager',1,'closed',2),('legacy',NULL,'과거 비공개','비공개','','manager',1,'closed',2)");
  db.exec("INSERT INTO room_members(room_id,user_id,joined_at) VALUES('closed','manager',1),('legacy','manager',1)");
  db.exec("INSERT INTO summary_records(room_id,summary,decisions,actions,keywords,updated_at) VALUES('closed','16시 발파로 변경','[\"안전통제\"]','[\"점검\"]','[\"가시설\"]',3),('legacy','노출금지','[]','[]','[]',3)");
  db.exec("INSERT INTO archive_jobs(room_id,status,created_at,updated_at) VALUES('closed','done',1,3),('legacy','done',1,3)");
}
test('all approved same-site staff search summaries and read originals, without room membership/write access',async t=>{
  const {db,env}=setup(t);seedSummary(db);
  for(const q of ['발파','가시설','안전통제','점검','A프로젝트']) {
    const rows=await data(await summaryRoutes(request(`/summaries?q=${encodeURIComponent(q)}`),env,staff));
    assert.equal(rows.length,1);assert.equal(rows[0].room_id,'closed');
  }
  assert.equal((await data(await summaryRoutes(request('/summaries'),env,outsider))).length,0);
  await assert.rejects(summaryRoutes(request('/summaries/closed'),env,outsider),error=>error.status===404);
  await assert.rejects(summaryRoutes(request('/summaries/legacy'),env,staff),error=>error.status===404);
  const transcript=await data(await summaryRoutes(request('/summaries/closed/transcript'),env,staff));
  assert.equal(transcript.room.id,'closed'); assert.deepEqual(transcript.messages,[]);
  await assert.rejects(memberRoom(env,'closed','staff'),error=>error.status===404);
  db.exec("UPDATE site_memberships SET status='rejected' WHERE user_id='staff'");
  await assert.rejects(summaryRoutes(request('/summaries/closed/transcript'),env,staff),error=>error.status===404);
  assert.equal((await data(await summaryRoutes(request('/summaries'),env,staff))).length,0);
});
test('revocation blocks existing chat members but legacy access is preserved, not widened',async t=>{
  const {db,env}=setup(t);seedSummary(db);
  assert.equal((await memberRoom(env,'closed','manager')).id,'closed');
  db.exec("UPDATE site_memberships SET status='rejected' WHERE user_id='manager'");
  await assert.rejects(memberRoom(env,'closed','manager'),error=>error.status===404);
  assert.equal((await memberRoom(env,'legacy','manager')).id,'legacy');
  assert.equal(await summaryRoutes(request('/summaries/closed',{message:'forbidden'}),env,staff),null);
});
test('site selection, scoped directories, membership requests and approval listing never expose another site',async t=>{
  const {db,env}=setup(t);
  assert.equal(await selectedSite(env,manager,undefined),'alpha');
  await assert.rejects(selectedSite(env,staff,'alpha'),error=>error.status===403);
  await assert.rejects(selectedSite(env,manager,'missing'),error=>error.status===404);
  await assert.rejects(selectedSite(env,staff,undefined),error=>error.status===400);
  assert.equal((await data(await siteRoutes(request('/sites'),env,null))).length,2);
  assert.equal((await data(await siteRoutes(request('/me/memberships'),env,staff)))[0].status,'pending');
  await assert.rejects(siteRoutes(request('/approvals'),env,staff),error=>error.status===403);
  assert.equal((await data(await siteRoutes(request('/approvals'),env,admin))).length,3);
  for(const path of ['/users','/users?site_id=alpha']) {
    assert.deepEqual((await data(await siteRoutes(request(path),env,manager))).map(user=>user.id),['manager']);
  }
  await assert.rejects(siteRoutes(request('/users?site_id=alpha'),env,outsider),error=>error.status===403);
  assert.equal((await data(await siteRoutes(request('/users?site_id=beta'),env,admin))).length,1);
  await siteRoutes(request('/me/memberships',{site_id:'alpha'}),env,outsider);
  assert.equal(db.prepare("SELECT status FROM site_memberships WHERE site_id='alpha' AND user_id='outsider'").get().status,'pending');
  await siteRoutes(request('/me/memberships',{site_id:'alpha'}),env,outsider);
  assert.equal(db.prepare("SELECT count(*) n FROM site_memberships WHERE user_id='outsider'").get().n,2);
  await assert.rejects(siteRoutes(request('/me/memberships',{site_id:'missing'}),env,staff),error=>error.status===404);
  await decide(env,admin,'alpha','outsider');
  await assert.rejects(selectedSite(env,outsider,undefined),error=>error.status===400);
  await assert.rejects(decide(env,admin,'missing','staff'),error=>error.status===404);
  await assert.rejects(decide(env,admin,'alpha','missing'),error=>error.status===404);
  await assert.rejects(decide(env,admin,'alpha','staff','invalid'),error=>error.status===400);
  assert.equal(await siteRoutes(request('/unknown'),env,admin),null);
  assert.equal(await siteRoutes(request('/unknown'),env,null),null);
});
test('shared transcript pages preserve every message and attachment; archive downloads require active approval',async t=>{
  const {db,env}=setup(t);seedSummary(db);
  db.exec("UPDATE rooms SET status='active' WHERE id='closed'");
  for(let seq=1;seq<=65;seq++) db.prepare("INSERT INTO messages(id,room_id,user_id,type,content,seq,created_at) VALUES(?,'closed','manager','text',?,?,1)").run(`message-${seq}`,`원문 ${seq}`,seq);
  db.exec("INSERT INTO attachments(id,message_id,room_id,uploader_id,filename,mime_type,file_size,r2_key,created_at) VALUES('file','message-65','closed','manager','safe.pdf','application/pdf',4,'file-key',1)");
  db.exec("UPDATE rooms SET status='closed' WHERE id='closed'");
  const last=await data(await summaryRoutes(request('/summaries/closed/transcript'),env,staff));
  assert.equal(last.messages.length,50);assert.equal(last.messages[0].seq,16);assert.equal(last.has_more,true);
  assert.equal(last.messages.at(-1).attachment.id,'file');
  const first=await data(await summaryRoutes(request('/summaries/closed/transcript?before=16'),env,staff));
  assert.equal(first.messages.length,15);assert.equal(first.has_more,false);
  await assert.rejects(summaryRoutes(request('/summaries/closed/transcript?before=-1'),env,staff),error=>error.status===400);
  assert.equal((await data(await summaryRoutes(request('/summaries/closed'),env,staff))).title,'발파 협의');
  assert.equal((await data(await summaryRoutes(request('/summaries?site_id=beta'),env,staff))).length,0);
  assert.equal((await data(await summaryRoutes(request('/summaries?q=%25'),env,staff))).length,0);
  await assert.rejects(summaryRoutes(request('/summaries/closed/archive'),env,staff),error=>error.status===404);
  db.exec("UPDATE archive_jobs SET r2_key='archive.md' WHERE room_id='closed'");
  const withFile={...env,FILES:{async get(key){assert.equal(key,'archive.md');return {body:'원문을 보존한 기록'};}}};
  const download=await summaryRoutes(request('/summaries/closed/archive'),withFile,staff);
  assert.equal(await download.text(),'원문을 보존한 기록');assert.match(download.headers.get('cache-control'),/no-store/);
  db.exec("UPDATE site_memberships SET status='rejected' WHERE user_id='staff'");
  await assert.rejects(summaryRoutes(request('/summaries/closed/archive'),withFile,staff),error=>error.status===404);
  assert.equal(await summaryRoutes(request('/not-summary'),env,staff),null);
});
