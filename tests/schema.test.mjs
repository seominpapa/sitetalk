import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

const migration = readFileSync(new URL('../database/migrations/0001_initial.sql', import.meta.url), 'utf8');

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(migration);
  db.prepare('INSERT INTO users (id, name, email, created_at) VALUES (?, ?, ?, ?)').run('alice', 'Alice', 'alice@example.com', 1000);
  db.prepare('INSERT INTO users (id, name, email, created_at) VALUES (?, ?, ?, ?)').run('bob', 'Bob', 'bob@example.com', 1000);
  db.prepare('INSERT INTO rooms (id, title, purpose, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run('room', '협의', '일정 결정', 'alice', 1000);
  db.exec("INSERT INTO room_members VALUES ('room', 'alice', 1000), ('room', 'bob', 1000)");
  return db;
}

function message(db, id = 'message', seq = 1, clientId = 'client') {
  db.prepare('INSERT INTO messages (id, room_id, user_id, type, content, seq, client_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, 'room', 'alice', 'text', '변경 협의합니다.', seq, clientId, 2000);
}

test('migration supplies defaults, foreign keys and unique room message identities', () => {
  const db = database();
  try {
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.deepEqual({ ...db.prepare('SELECT role, notification_enabled, password_hash FROM users LIMIT 1').get() }, { role: 'member', notification_enabled: 1, password_hash: null });
    assert.deepEqual({ ...db.prepare('SELECT status, seq, keywords FROM rooms').get() }, { status: 'active', seq: 0, keywords: '[]' });
    message(db);
    assert.throws(() => message(db, 'second', 1, 'other'), /UNIQUE constraint/);
    assert.throws(() => message(db, 'second', 2, 'client'), /UNIQUE constraint/);
    assert.throws(() => db.exec("INSERT INTO room_members VALUES ('missing', 'alice', 1)"), /FOREIGN KEY/);
    assert.throws(() => db.exec("UPDATE users SET role = 'owner'"), /CHECK constraint/);
    assert.throws(() => db.exec("UPDATE rooms SET keywords = 'invalid json'"), /CHECK constraint/);
    assert.throws(() => db.exec("INSERT INTO users (id,name,email,created_at) VALUES ('dup','Dup','ALICE@example.com',1)"), /UNIQUE constraint/);
  } finally { db.close(); }
});

test('closed rooms reject new messages and retain the original history', () => {
  const db = database();
  try {
    message(db);
    db.exec("UPDATE rooms SET status = 'closed', closed_at = 3000 WHERE id = 'room'");
    assert.throws(() => message(db, 'late', 2, 'late'), /room is closed/);
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM messages').get().total, 1);
  } finally { db.close(); }
});

test('attachment metadata cannot reference another room or an absent message', () => {
  const db = database();
  try {
    message(db);
    db.exec("INSERT INTO rooms (id,title,purpose,created_by,created_at) VALUES ('other','Other','Other','alice',1000)");
    const insert = db.prepare('INSERT INTO attachments (id,message_id,room_id,uploader_id,filename,mime_type,file_size,r2_key,created_at) VALUES (?,?,?,?,?,?,?,?,?)');
    assert.throws(() => insert.run('bad', 'message', 'other', 'alice', 'plan.pdf', 'application/pdf', 10, 'bad', 2000), /FOREIGN KEY/);
    insert.run('file', 'message', 'room', 'alice', 'plan.pdf', 'application/pdf', 10, 'private/file', 2000);
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM attachments').get().total, 1);
  } finally { db.close(); }
});

test('failed transactional close rolls back room state, closure and archive queue', () => {
  const db = database();
  try {
    db.exec('BEGIN');
    assert.throws(() => db.exec(`
      UPDATE rooms SET status = 'closed', closed_at = 3000 WHERE id = 'room';
      INSERT INTO room_closures (room_id, conclusion, closed_by, closed_at) VALUES ('room', '합의', 'alice', 3000);
      INSERT INTO archive_jobs (room_id, created_at, updated_at) VALUES ('room', 3000, 3000);
      INSERT INTO room_closures (room_id, conclusion, closed_by, closed_at) VALUES ('room', '중복', 'alice', 3000);
    `), /UNIQUE constraint/);
    db.exec('ROLLBACK');
    assert.equal(db.prepare('SELECT status FROM rooms').get().status, 'active');
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM room_closures').get().total, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM archive_jobs').get().total, 0);
    message(db);
  } finally { db.close(); }
});

test('read position belongs to a member and archive state is constrained', () => {
  const db = database();
  try {
    message(db);
    db.exec("INSERT INTO room_reads (room_id,user_id,last_read_seq,last_read_message_id,last_read_at) VALUES ('room','bob',1,'message',3000)");
    assert.throws(() => db.exec("INSERT INTO archive_jobs (room_id,status,created_at,updated_at) VALUES ('room','lost',3000,3000)"), /CHECK constraint/);
    db.exec("INSERT INTO archive_jobs (room_id,created_at,updated_at) VALUES ('room',3000,3000)");
    assert.equal(db.prepare('SELECT status FROM archive_jobs').get().status, 'pending');
    assert.throws(() => db.exec("INSERT INTO room_reads (room_id,user_id,last_read_at) VALUES ('room','missing',3000)"), /FOREIGN KEY/);
  } finally { db.close(); }
});

test('rate limit upsert increments atomically and resets expired windows', () => {
  const db = database();
  try {
    const increment = db.prepare(`INSERT INTO rate_limits (key,hits,reset_at) VALUES (?,1,?)
      ON CONFLICT(key) DO UPDATE SET
        hits = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.hits + 1 END,
        reset_at = CASE WHEN rate_limits.reset_at <= ? THEN excluded.reset_at ELSE rate_limits.reset_at END
      RETURNING hits,reset_at`);
    assert.deepEqual({ ...increment.get('login:ip', 61000, 1000, 1000) }, { hits: 1, reset_at: 61000 });
    assert.deepEqual({ ...increment.get('login:ip', 62000, 2000, 2000) }, { hits: 2, reset_at: 61000 });
    assert.deepEqual({ ...increment.get('login:ip', 121000, 61000, 61000) }, { hits: 1, reset_at: 121000 });
  } finally { db.close(); }
});
