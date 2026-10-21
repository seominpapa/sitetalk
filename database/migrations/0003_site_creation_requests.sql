CREATE TABLE site_creation_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  site_name TEXT NOT NULL CHECK (length(trim(site_name)) BETWEEN 1 AND 120),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by TEXT REFERENCES users(id),
  site_id TEXT UNIQUE REFERENCES sites(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((status = 'approved' AND site_id IS NOT NULL) OR (status != 'approved' AND site_id IS NULL))
);
CREATE INDEX site_creation_requests_status ON site_creation_requests(status, created_at);
