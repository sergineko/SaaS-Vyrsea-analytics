DROP INDEX IF EXISTS checks_time;
DROP INDEX IF EXISTS hourly_time;
CREATE INDEX incidents_monitor_resolved ON incidents(monitor_id, resolved_at);
