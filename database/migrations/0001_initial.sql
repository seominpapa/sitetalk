PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  profile_image TEXT,
  company TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  password_hash TEXT,
  notification_enabled INTEGER NOT NULL DEFAULT 1 CHECK (notification_enabled IN (0, 1)),
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL CHECK (hits >= 0),
  reset_at INTEGER NOT NULL
);
CREATE INDEX rate_limits_expiry ON rate_limits(reset_at);

CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  purpose TEXT NOT NULL CHECK (length(trim(purpose)) > 0),
  type TEXT NOT NULL DEFAULT '일반업무',
  project TEXT NOT NULL DEFAULT '',
  work_category TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  keywords TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(keywords) AND json_type(keywords) = 'array'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  closed_at INTEGER,
  seq INTEGER NOT NULL DEFAULT 0 CHECK (seq >= 0)
);
CREATE INDEX rooms_status_closed ON rooms(status, closed_at);

CREATE TABLE room_members (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX room_members_user ON room_members(user_id, room_id);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('text', 'image', 'file', 'system')),
  content TEXT NOT NULL DEFAULT '',
  seq INTEGER NOT NULL CHECK (seq > 0),
  client_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (room_id, seq),
  UNIQUE (room_id, user_id, client_id),
  UNIQUE (id, room_id),
  FOREIGN KEY (room_id, user_id) REFERENCES room_members(room_id, user_id)
);

CREATE TRIGGER messages_active_room
BEFORE INSERT ON messages
WHEN EXISTS (SELECT 1 FROM rooms WHERE id = NEW.room_id AND status = 'closed')
BEGIN
  SELECT RAISE(ABORT, 'room is closed');
END;

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  uploader_id TEXT NOT NULL REFERENCES users(id),
  filename TEXT NOT NULL CHECK (length(filename) > 0),
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size >= 0),
  r2_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (message_id, room_id) REFERENCES messages(id, room_id) ON DELETE CASCADE
);
CREATE INDEX attachments_room ON attachments(room_id);
CREATE INDEX attachments_message ON attachments(message_id);

CREATE TABLE room_closures (
  room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  conclusion TEXT NOT NULL CHECK (length(trim(conclusion)) > 0),
  owner_id TEXT REFERENCES users(id),
  due_date TEXT,
  note TEXT NOT NULL DEFAULT '',
  closed_by TEXT NOT NULL REFERENCES users(id),
  closed_at INTEGER NOT NULL
);

CREATE TABLE room_reads (
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_read_seq INTEGER NOT NULL DEFAULT 0 CHECK (last_read_seq >= 0),
  last_read_message_id TEXT,
  last_read_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id),
  FOREIGN KEY (room_id, user_id) REFERENCES room_members(room_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (last_read_message_id, room_id) REFERENCES messages(id, room_id)
);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX push_subscriptions_user ON push_subscriptions(user_id);

CREATE TABLE archive_jobs (
  room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  lease_until INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  r2_key TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX archive_jobs_status_lease ON archive_jobs(status, lease_until);
