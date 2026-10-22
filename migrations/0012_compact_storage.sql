CREATE TABLE checks_compact (
 id TEXT PRIMARY KEY, monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
 checked_at INTEGER NOT NULL, ok INTEGER NOT NULL, status_code INTEGER, response_ms REAL NOT NULL, error TEXT
) WITHOUT ROWID;
INSERT INTO checks_compact SELECT * FROM checks;
DROP TABLE checks;
ALTER TABLE checks_compact RENAME TO checks;
CREATE INDEX checks_monitor_time ON checks(monitor_id,checked_at);
CREATE TABLE hourly_compact (
 monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE, hour INTEGER NOT NULL,
 total INTEGER NOT NULL, successful INTEGER NOT NULL, total_ms REAL NOT NULL,
 PRIMARY KEY(monitor_id,hour)
) WITHOUT ROWID;
INSERT INTO hourly_compact SELECT * FROM hourly_stats;
DROP TABLE hourly_stats;
ALTER TABLE hourly_compact RENAME TO hourly_stats;
CREATE TABLE jobs_compact (
 id TEXT PRIMARY KEY, monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
 slot INTEGER NOT NULL, created_at INTEGER NOT NULL, dispatched_at INTEGER
) WITHOUT ROWID;
INSERT INTO jobs_compact SELECT * FROM check_jobs;
DROP TABLE check_jobs;
ALTER TABLE jobs_compact RENAME TO check_jobs;
CREATE INDEX jobs_dispatch ON check_jobs(created_at);
