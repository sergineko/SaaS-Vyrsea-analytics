DROP INDEX jobs_dispatch;
CREATE INDEX jobs_dispatch ON check_jobs(created_at);
ALTER TABLE monitors ADD COLUMN probe_mask INTEGER NOT NULL DEFAULT 7 CHECK(probe_mask BETWEEN 1 AND 7);
CREATE TABLE status_pages (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', accent TEXT NOT NULL DEFAULT '#187356',
 theme TEXT NOT NULL DEFAULT 'light', monitor_ids TEXT NOT NULL DEFAULT '[]', published INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX status_pages_user ON status_pages(user_id);
CREATE TABLE business_contracts (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 company TEXT NOT NULL DEFAULT '', contact_email TEXT NOT NULL DEFAULT '',
 price_cents INTEGER NOT NULL DEFAULT 0, billing_cycle TEXT NOT NULL DEFAULT 'monthly',
 notes TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL
);
CREATE TABLE account_invitations (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, claimed_at INTEGER
);
