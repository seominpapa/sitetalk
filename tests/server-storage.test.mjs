import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, cpSync, appendFileSync, symlinkSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, createFileStore } from '../apps/server/storage.mjs';

function directory(t) {
  const path=mkdtempSync(join(tmpdir(),'site-talk-storage-'));
  t.after(()=>rm(path,{recursive:true,force:true}));
  return path;
}
test('server database applies checked migrations once and persists constraints and values', async t=>{
  const path=directory(t), db=openDatabase(path);
  await db.prepare('INSERT INTO users(id,name,email,role,created_at) VALUES(?,?,?,?,?)').bind('a','관리자','owner@example.invalid','admin',1).run();
  assert.equal((await db.prepare('SELECT role FROM users WHERE id=?').bind('a').first()).role,'admin');
  assert.equal((statSync(join(path,'site-talk.sqlite')).mode&0o777),0o600);
  db.close();
  const reopened=openDatabase(path); t.after(()=>reopened.close());
  assert.equal((await reopened.prepare('SELECT count(*) n FROM users').first()).n,1);
  await assert.rejects(reopened.prepare("INSERT INTO users(id,name,email,role,created_at) VALUES('b','bad','b@example.invalid','root',1)").run(),/constraint/i);
  const migrations=join(path,'migrations');cpSync(new URL('../database/migrations/',import.meta.url),migrations,{recursive:true});
  appendFileSync(join(migrations,'0001_initial.sql'),'\n-- changed\n');
  assert.throws(()=>openDatabase(path,{migrationsDir:migrations}),/migration.*changed/i);
});
test('server DB statements are immutable and batch is atomic with RETURNING and metadata', async t=>{
  const db=openDatabase(directory(t));t.after(()=>db.close());
  const statement=db.prepare('SELECT ? value');
  const first=statement.bind('one'), second=statement.bind('two');
  assert.equal((await first.first()).value,'one');assert.equal((await second.first()).value,'two');
  await assert.rejects(db.prepare('SELECT ?').bind({unsafe:true}).first(),/SQL parameter/i);
  const statements=[
    db.prepare("INSERT INTO users(id,name,email,created_at) VALUES('one','one','one@example.invalid',1) RETURNING id"),
    db.prepare("INSERT INTO users(id,name,email,created_at) VALUES('two','two','two@example.invalid',1)"),
  ];
  const results=await db.batch(statements);
  assert.equal(results[0].results[0].id,'one');assert.equal(results[0].meta.changes,1);assert.equal(results[1].meta.changes,1);
  assert.equal((await db.prepare('UPDATE users SET company=? WHERE id=? RETURNING company').bind('현장','one').first()).company,'현장');
  await assert.rejects(db.batch([
    db.prepare("INSERT INTO users(id,name,email,created_at) VALUES('rollback','rollback','rollback@example.invalid',1)"),
    db.prepare("INSERT INTO room_members(room_id,user_id,joined_at) VALUES('missing','one',1)"),
  ]),/constraint/i);
  assert.equal(await db.prepare("SELECT id FROM users WHERE id='rollback'").first(),null);
});
test('filesystem objects persist privately and never resolve user keys as paths',async t=>{
  const path=directory(t),files=createFileStore(path);
  const payload=new Uint8Array([0,1,2,255]);
  await files.put('attachments/room/object',payload.buffer);
  const object=await createFileStore(path).get('attachments/room/object');
  assert.equal(object.size,payload.length);assert.deepEqual(new Uint8Array(await new Response(object.body).arrayBuffer()),payload);
  await files.put('archives/room.md','한글 요약');
  assert.equal(await new Response((await files.get('archives/room.md')).body).text(),'한글 요약');
  await files.delete('attachments/room/object');assert.equal(await files.get('attachments/room/object'),null);
  await files.delete('missing');
  for(const key of ['../outside','/absolute','a/../outside','a\\..\\outside','a\0b']) {
    await assert.rejects(files.put(key,'no'),/object key/i);
    await assert.rejects(files.get(key),/object key/i);
  }
});
test('storage refuses symlink data directories and files',async t=>{
  const path=directory(t),outside=directory(t),linked=join(path,'linked');
  symlinkSync(outside,linked);
  assert.throws(()=>openDatabase(linked),/symlink/i);
  assert.throws(()=>createFileStore(linked),/symlink/i);
  const dbpath=join(path,'database');
  symlinkSync(outside,dbpath);
  assert.throws(()=>openDatabase(dbpath),/symlink/i);
});
