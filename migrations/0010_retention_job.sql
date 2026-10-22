CREATE TABLE maintenance_jobs (
 id TEXT PRIMARY KEY, run_day TEXT NOT NULL, started_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL, completed_at INTEGER, pending INTEGER NOT NULL DEFAULT 1,
 deleted_json TEXT NOT NULL DEFAULT '{}',lease_until INTEGER NOT NULL DEFAULT 0,lease_token TEXT
);
