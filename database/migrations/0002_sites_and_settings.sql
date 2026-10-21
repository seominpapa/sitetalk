CREATE TABLE sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE TABLE site_memberships (
  site_id TEXT NOT NULL REFERENCES sites(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('manager', 'member')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (site_id, user_id)
);
CREATE INDEX site_memberships_user ON site_memberships(user_id, status);
CREATE TABLE membership_events (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  role TEXT NOT NULL CHECK (role IN ('manager', 'member')),
  created_at INTEGER NOT NULL
);
-- Existing rooms stay private to their original participants; no implicit site sharing.
ALTER TABLE rooms ADD COLUMN site_id TEXT REFERENCES sites(id);
CREATE INDEX rooms_site ON rooms(site_id, status, closed_at);
CREATE TRIGGER messages_site_approval BEFORE INSERT ON messages
WHEN EXISTS(SELECT 1 FROM rooms WHERE id=NEW.room_id AND site_id IS NOT NULL)
  AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND role='admin')
  AND NOT EXISTS(SELECT 1 FROM site_memberships sm JOIN rooms r ON r.site_id=sm.site_id WHERE r.id=NEW.room_id AND sm.user_id=NEW.user_id AND sm.status='approved')
BEGIN
  SELECT RAISE(ABORT, 'site approval required');
END;
CREATE TABLE ai_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  encrypted_key TEXT NOT NULL,
  model TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at INTEGER NOT NULL
);
CREATE TABLE summary_records (
  room_id TEXT PRIMARY KEY REFERENCES rooms(id),
  summary TEXT NOT NULL,
  decisions TEXT NOT NULL,
  actions TEXT NOT NULL,
  keywords TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
