CREATE TABLE maintenance_windows (
 id TEXT PRIMARY KEY,
 monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
 starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 140),
 created_at INTEGER NOT NULL, cancelled_at INTEGER,
 CHECK(ends_at-starts_at BETWEEN 300 AND 86400)
);
CREATE INDEX maintenance_monitor_time ON maintenance_windows(monitor_id,starts_at,ends_at);
CREATE INDEX maintenance_end ON maintenance_windows(ends_at);
CREATE TRIGGER maintenance_overlap BEFORE INSERT ON maintenance_windows BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM maintenance_windows w WHERE w.monitor_id=NEW.monitor_id
   AND w.cancelled_at IS NULL AND NEW.starts_at<w.ends_at AND NEW.ends_at>w.starts_at)
   THEN RAISE(ABORT, 'MAINTENANCE_OVERLAP') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM maintenance_windows w WHERE w.monitor_id=NEW.monitor_id
   AND w.cancelled_at IS NULL AND w.ends_at>unixepoch())>=5
   THEN RAISE(ABORT, 'MAINTENANCE_CAPACITY') END;
END;
