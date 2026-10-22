PRAGMA foreign_keys = ON;
CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
CREATE TABLE credentials (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, public_key TEXT NOT NULL, counter INTEGER NOT NULL DEFAULT 0, transports TEXT NOT NULL);
CREATE INDEX credentials_user ON credentials(user_id);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE challenges (id TEXT PRIMARY KEY, kind TEXT NOT NULL, challenge TEXT NOT NULL, user_id TEXT, username TEXT, expires_at INTEGER NOT NULL);
CREATE INDEX challenges_expiry ON challenges(expires_at);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 1, expires_at INTEGER NOT NULL);
CREATE INDEX rate_limits_expiry ON rate_limits(expires_at);
CREATE TABLE monitors (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL, url TEXT NOT NULL, paused INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','up','degraded','down')),
 failures INTEGER NOT NULL DEFAULT 0, last_checked_at INTEGER, last_status_code INTEGER,
 last_response_ms REAL, last_error TEXT, next_check_at INTEGER NOT NULL,
 last_slot INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX monitors_user ON monitors(user_id);
CREATE INDEX monitors_due ON monitors(paused, next_check_at);
CREATE TRIGGER monitor_capacity BEFORE INSERT ON monitors BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM monitors) >= 10 THEN RAISE(ABORT, 'GLOBAL_CAPACITY') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM monitors WHERE user_id=NEW.user_id) >= 3 THEN RAISE(ABORT, 'USER_CAPACITY') END;
END;
CREATE TRIGGER account_capacity BEFORE INSERT ON users BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM users) >= 100 THEN RAISE(ABORT, 'ACCOUNT_CAPACITY') END;
END;
CREATE TABLE checks (
 id TEXT PRIMARY KEY, monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
 checked_at INTEGER NOT NULL, ok INTEGER NOT NULL, status_code INTEGER, response_ms REAL NOT NULL, error TEXT
);
CREATE INDEX checks_monitor_time ON checks(monitor_id, checked_at);
CREATE INDEX checks_time ON checks(checked_at);
CREATE TABLE hourly_stats (
 monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE, hour INTEGER NOT NULL,
 total INTEGER NOT NULL, successful INTEGER NOT NULL, total_ms REAL NOT NULL,
 PRIMARY KEY(monitor_id, hour)
);
CREATE INDEX hourly_time ON hourly_stats(hour);
CREATE TABLE incidents (
 id TEXT PRIMARY KEY, monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
 opened_at INTEGER NOT NULL, resolved_at INTEGER, reason TEXT NOT NULL
);
CREATE UNIQUE INDEX incidents_open ON incidents(monitor_id) WHERE resolved_at IS NULL;
CREATE INDEX incidents_time ON incidents(opened_at);
CREATE TABLE notifications (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
 kind TEXT NOT NULL, message TEXT NOT NULL, created_at INTEGER NOT NULL, read_at INTEGER
);
CREATE INDEX notifications_user_time ON notifications(user_id, created_at);
CREATE TABLE check_jobs (
 id TEXT PRIMARY KEY, monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
 slot INTEGER NOT NULL, created_at INTEGER NOT NULL, dispatched_at INTEGER
);
CREATE INDEX jobs_dispatch ON check_jobs(dispatched_at, created_at);
