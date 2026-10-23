SET search_path TO vyrsea, pg_catalog;
-- One network statement per result. Locks, eligibility checks, aggregates and
-- notifications stay atomic inside PostgreSQL; no elevated execution privileges.
CREATE FUNCTION record_monitor_result(p_monitor TEXT,p_slot BIGINT,p_time BIGINT,p_ok BIGINT,p_status BIGINT,p_ms DOUBLE PRECISION,p_error TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = vyrsea, pg_catalog AS $$
DECLARE account users%ROWTYPE; monitor monitors%ROWTYPE; job TEXT:=p_monitor||':'||p_slot::text;
BEGIN
 SELECT u.* INTO account FROM users u WHERE u.id=(SELECT m.user_id FROM monitors m WHERE m.id=p_monitor) FOR SHARE;
 SELECT * INTO monitor FROM monitors WHERE id=p_monitor FOR UPDATE;
 IF monitor.id IS NULL OR account.id IS NULL OR monitor.paused<>0 OR monitor.last_slot>=p_slot
    OR account.account_status<>'active' OR account.monitoring_since>p_slot
    OR (account.is_owner=0 AND account.plan_id='free' AND account.last_active_at<p_time-1213200)
    OR EXISTS(SELECT 1 FROM maintenance_windows w WHERE w.monitor_id=p_monitor AND
      ((w.starts_at<=p_slot AND LEAST(w.ends_at,COALESCE(w.cancelled_at,w.ends_at))>p_slot)
       OR (w.starts_at<=p_time AND LEAST(w.ends_at,COALESCE(w.cancelled_at,w.ends_at))>p_time))) THEN
   DELETE FROM check_jobs WHERE id=job; RETURN FALSE;
 END IF;
 IF p_ok=0 AND EXISTS(SELECT 1 FROM maintenance_windows w WHERE w.monitor_id=p_monitor AND w.starts_at<=p_time
   AND LEAST(w.ends_at,COALESCE(w.cancelled_at,w.ends_at))>COALESCE(monitor.last_checked_at,monitor.created_at)
   AND LEAST(w.ends_at,COALESCE(w.cancelled_at,w.ends_at))>w.starts_at) THEN
   IF monitor.status<>'down' THEN monitor.failures:=0; END IF;
   IF monitor.status='degraded' THEN monitor.status:='pending'; END IF;
 END IF;
 INSERT INTO checks(id,monitor_id,checked_at,ok,status_code,response_ms,error) VALUES(job,p_monitor,p_time,p_ok,p_status,p_ms,p_error) ON CONFLICT DO NOTHING;
 INSERT INTO hourly_stats(monitor_id,hour,total,successful,total_ms) VALUES(p_monitor,(p_time/3600)*3600,1,p_ok,p_ms)
 ON CONFLICT(monitor_id,hour) DO UPDATE SET total=hourly_stats.total+1,successful=hourly_stats.successful+excluded.successful,total_ms=hourly_stats.total_ms+excluded.total_ms;
 IF p_ok=0 AND monitor.failures>=1 AND monitor.status<>'down' THEN
   INSERT INTO incidents(id,monitor_id,opened_at,reason) VALUES(job,p_monitor,p_time,COALESCE(p_error,'Error HTTP')) ON CONFLICT DO NOTHING;
   INSERT INTO notifications(id,user_id,monitor_id,kind,message,created_at) VALUES(job||':down',monitor.user_id,p_monitor,'down',monitor.name||' no responde. Dos fallos consecutivos confirmados.',p_time) ON CONFLICT DO NOTHING;
 ELSIF p_ok=1 AND monitor.status='down' THEN
   INSERT INTO notifications(id,user_id,monitor_id,kind,message,created_at) VALUES(job||':up',monitor.user_id,p_monitor,'up',monitor.name||' vuelve a estar disponible.',p_time) ON CONFLICT DO NOTHING;
 END IF;
 IF p_ok=1 THEN UPDATE incidents SET resolved_at=p_time WHERE monitor_id=p_monitor AND resolved_at IS NULL; END IF;
 UPDATE monitors SET status=CASE WHEN p_ok=1 THEN 'up' WHEN monitor.failures>=1 THEN 'down' ELSE 'degraded' END,
   failures=CASE WHEN p_ok=1 THEN 0 ELSE monitor.failures+1 END,last_checked_at=p_time,last_status_code=p_status,
   last_response_ms=p_ms,last_error=p_error,last_slot=p_slot WHERE id=p_monitor;
 DELETE FROM check_jobs WHERE id=job;
 RETURN TRUE;
END $$;
REVOKE ALL ON FUNCTION record_monitor_result(TEXT,BIGINT,BIGINT,BIGINT,BIGINT,DOUBLE PRECISION,TEXT) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='vyrsea_app') THEN
  GRANT EXECUTE ON FUNCTION record_monitor_result(TEXT,BIGINT,BIGINT,BIGINT,BIGINT,DOUBLE PRECISION,TEXT) TO vyrsea_app;
 END IF;
END $$;
