import type { CheckJob, Env, QueuePayload } from './env';
import { INTERVAL_SECONDS, nowSeconds } from './env';
import { probe, type ProbeResult } from './probe';

export async function reserveCheck(env: Env, monitorId: string, timestamp = nowSeconds()) {
  const slot = Math.floor(timestamp / INTERVAL_SECONDS) * INTERVAL_SECONDS;
  const result = await env.DB.batch([
    env.DB.prepare(`UPDATE monitors SET next_check_at=MAX(next_check_at,(SELECT MAX(w.ends_at) FROM maintenance_windows w
      WHERE w.monitor_id=monitors.id AND w.cancelled_at IS NULL AND w.starts_at<=? AND w.ends_at>?)),
      failures=CASE WHEN status='down' THEN failures ELSE 0 END,status=CASE WHEN status='degraded' THEN 'pending' ELSE status END
      WHERE id=? AND paused=0 AND next_check_at<=? AND EXISTS(SELECT 1 FROM maintenance_windows w WHERE w.monitor_id=monitors.id
      AND w.cancelled_at IS NULL AND w.starts_at<=? AND w.ends_at>?)`).bind(timestamp,timestamp,monitorId,timestamp,timestamp,timestamp),
    env.DB.prepare(`INSERT OR IGNORE INTO check_jobs(id,monitor_id,slot,created_at)
      SELECT id || ':' || CAST(? AS INTEGER),id,?,? FROM monitors WHERE id=? AND paused=0 AND next_check_at<=? AND last_slot<?`)
      .bind(slot, slot, timestamp, monitorId, timestamp, slot),
    env.DB.prepare(`UPDATE monitors SET next_check_at=?+(SELECT p.interval_seconds FROM plan_limits p JOIN users u ON u.plan_id=p.id WHERE u.id=monitors.user_id) WHERE id=? AND paused=0 AND next_check_at<=?
      AND EXISTS(SELECT 1 FROM check_jobs WHERE id=monitors.id || ':' || CAST(? AS INTEGER))`)
      .bind(timestamp, monitorId, timestamp, slot),
  ]);
  return result[1].meta.changes > 0;
}

export async function dispatchPending(env: Env, timestamp = nowSeconds()) {
  // Re-dispatch after 15 min if delivery exhausted its retries. Result writes are idempotent.
  const rows = await env.DB.prepare('SELECT id,monitor_id AS monitorId,slot FROM check_jobs WHERE dispatched_at IS NULL OR dispatched_at<? ORDER BY created_at LIMIT 10')
    .bind(timestamp - 900).all<CheckJob & { id: string }>();
  for (let i = 0; i < rows.results.length; i += 2) {
    const group = rows.results.slice(i, i + 2);
    await env.CHECK_QUEUE.send({ jobs: group.map(({ monitorId, slot }) => ({ monitorId, slot })) });
    await env.DB.batch(group.map(job => env.DB.prepare('UPDATE check_jobs SET dispatched_at=? WHERE id=?').bind(timestamp, job.id)));
  }
}

export async function schedule(env: Env, timestamp = nowSeconds()) {
  const due = await env.DB.prepare('SELECT id FROM monitors WHERE paused=0 AND next_check_at<=? ORDER BY next_check_at LIMIT 10').bind(timestamp).all<{ id: string }>();
  for (const row of due.results) await reserveCheck(env, row.id, timestamp);
  await dispatchPending(env, timestamp);
}

export async function recordResult(env: Env, job: CheckJob, result: ProbeResult, timestamp = nowSeconds()) {
  const id = `${job.monitorId}:${job.slot}`;
  const hour = Math.floor(timestamp / 3600) * 3600;
  const outsideMaintenance = `AND NOT EXISTS(SELECT 1 FROM maintenance_windows w WHERE w.monitor_id=monitors.id
    AND ((w.starts_at<=? AND MIN(w.ends_at,COALESCE(w.cancelled_at,w.ends_at))>?)
    OR (w.starts_at<=? AND MIN(w.ends_at,COALESCE(w.cancelled_at,w.ends_at))>?)))`;
  const maintenanceTimes = [job.slot,job.slot,timestamp,timestamp] as const;
  // A single D1 transaction: the monitor's last_slot changes LAST, guarding every statement.
  // Queue consumers are serialized; the slot guard additionally makes replay harmless.
  await env.DB.batch([
    // A planned gap breaks consecutive failures; an already-open incident remains open.
    env.DB.prepare(`UPDATE monitors SET failures=CASE WHEN status='down' THEN failures ELSE 0 END,
      status=CASE WHEN status='degraded' THEN 'pending' ELSE status END WHERE id=? AND last_slot<? AND paused=0
      AND EXISTS(SELECT 1 FROM maintenance_windows w WHERE w.monitor_id=monitors.id AND w.starts_at<=?
      AND MIN(w.ends_at,COALESCE(w.cancelled_at,w.ends_at))>COALESCE(last_checked_at,created_at)
      AND MIN(w.ends_at,COALESCE(w.cancelled_at,w.ends_at))>w.starts_at)`).bind(job.monitorId,job.slot,timestamp),
    env.DB.prepare(`INSERT OR IGNORE INTO checks(id,monitor_id,checked_at,ok,status_code,response_ms,error)
      SELECT ?,id,?,?,?,?,? FROM monitors WHERE id=? AND last_slot<? AND paused=0 ${outsideMaintenance}`)
      .bind(id, timestamp, result.ok ? 1 : 0, result.statusCode, result.responseMs, result.error, job.monitorId, job.slot,...maintenanceTimes),
    env.DB.prepare(`INSERT INTO hourly_stats(monitor_id,hour,total,successful,total_ms)
      SELECT id,?,1,?,? FROM monitors WHERE id=? AND last_slot<? AND paused=0 ${outsideMaintenance}
      ON CONFLICT(monitor_id,hour) DO UPDATE SET total=total+1,successful=successful+excluded.successful,total_ms=total_ms+excluded.total_ms`)
      .bind(hour, result.ok ? 1 : 0, result.responseMs, job.monitorId, job.slot,...maintenanceTimes),
    env.DB.prepare(`INSERT OR IGNORE INTO incidents(id,monitor_id,opened_at,reason)
      SELECT ?,id,?,? FROM monitors WHERE id=? AND last_slot<? AND paused=0 AND failures>=1 AND status!='down' AND ?=0 ${outsideMaintenance}`)
      .bind(id, timestamp, result.error ?? 'Error HTTP', job.monitorId, job.slot, result.ok ? 1 : 0,...maintenanceTimes),
    env.DB.prepare(`INSERT OR IGNORE INTO notifications(id,user_id,monitor_id,kind,message,created_at)
      SELECT ? || ':down',user_id,id,'down',name || ' no responde. Dos fallos consecutivos confirmados.',?
      FROM monitors WHERE id=? AND last_slot<? AND paused=0 AND failures>=1 AND status!='down' AND ?=0 ${outsideMaintenance}`)
      .bind(id, timestamp, job.monitorId, job.slot, result.ok ? 1 : 0,...maintenanceTimes),
    env.DB.prepare(`INSERT OR IGNORE INTO notifications(id,user_id,monitor_id,kind,message,created_at)
      SELECT ? || ':up',user_id,id,'up',name || ' vuelve a estar disponible.',?
      FROM monitors WHERE id=? AND last_slot<? AND paused=0 AND status='down' AND ?=1 ${outsideMaintenance}`)
      .bind(id, timestamp, job.monitorId, job.slot, result.ok ? 1 : 0,...maintenanceTimes),
    env.DB.prepare(`UPDATE incidents SET resolved_at=? WHERE monitor_id=? AND resolved_at IS NULL AND ?=1
      AND EXISTS(SELECT 1 FROM monitors WHERE id=? AND last_slot<? AND paused=0 ${outsideMaintenance})`)
      .bind(timestamp, job.monitorId, result.ok ? 1 : 0, job.monitorId, job.slot,...maintenanceTimes),
    env.DB.prepare(`UPDATE monitors SET status=CASE WHEN ?=1 THEN 'up' WHEN failures>=1 THEN 'down' ELSE 'degraded' END,
      failures=CASE WHEN ?=1 THEN 0 ELSE failures+1 END,last_checked_at=?,last_status_code=?,last_response_ms=?,last_error=?,last_slot=?
      WHERE id=? AND last_slot<? AND paused=0 ${outsideMaintenance}`)
      .bind(result.ok ? 1 : 0, result.ok ? 1 : 0, timestamp, result.statusCode, result.responseMs, result.error, job.slot, job.monitorId, job.slot,...maintenanceTimes),
    env.DB.prepare('DELETE FROM check_jobs WHERE id=?').bind(id),
  ]);
}

export async function consume(payload: QueuePayload, env: Env) {
  if (!payload || !Array.isArray(payload.jobs) || payload.jobs.length > 2) throw new Error('Invalid queue payload');
  // Sequential execution keeps simultaneous connections and subrequests bounded.
  for (const job of payload.jobs) {
    const timestamp=nowSeconds();
    const monitor = await env.DB.prepare(`SELECT url,paused,last_slot,EXISTS(SELECT 1 FROM maintenance_windows w WHERE w.monitor_id=monitors.id
      AND ((w.starts_at<=? AND MIN(w.ends_at,COALESCE(w.cancelled_at,w.ends_at))>?) OR
      (w.starts_at<=? AND MIN(w.ends_at,COALESCE(w.cancelled_at,w.ends_at))>?))) AS maintenance FROM monitors WHERE id=?`)
      .bind(timestamp,timestamp,job.slot,job.slot,job.monitorId).first<{ url: string; paused: number; last_slot: number; maintenance:number }>();
    if (!monitor || monitor.paused || monitor.maintenance || monitor.last_slot >= job.slot) {
      await env.DB.prepare('DELETE FROM check_jobs WHERE id=?').bind(`${job.monitorId}:${job.slot}`).run();
      continue;
    }
    const result = await probe(monitor.url);
    await recordResult(env, job, result);
  }
}

export async function cleanup(env: Env, timestamp = nowSeconds()) {
  // Retention follows each account; bounded deletes limit work after long outages.
  const historyDays = `CASE WHEN u.plan_id='business' THEN u.history_days_limit ELSE p.history_days END`;
  for (const [table, field, limit] of [['checks','checked_at',3500], ['hourly_stats','hour',1000], ['incidents','resolved_at',500]] as const) {
    await env.DB.prepare(`DELETE FROM ${table} WHERE rowid IN (
      SELECT x.rowid FROM ${table} x JOIN monitors m ON m.id=x.monitor_id
      JOIN users u ON u.id=m.user_id JOIN plan_limits p ON p.id=u.plan_id
      WHERE x.${field} < ? - (${historyDays}) * 86400 LIMIT ${limit})`).bind(timestamp).run();
  }
  await env.DB.prepare(`DELETE FROM notifications WHERE rowid IN (
    SELECT n.rowid FROM notifications n JOIN users u ON u.id=n.user_id JOIN plan_limits p ON p.id=u.plan_id
    WHERE n.created_at < ? - (${historyDays}) * 86400 LIMIT 500)`).bind(timestamp).run();
  await env.DB.prepare(`DELETE FROM maintenance_windows WHERE rowid IN (
    SELECT w.rowid FROM maintenance_windows w JOIN monitors m ON m.id=w.monitor_id JOIN users u ON u.id=m.user_id JOIN plan_limits p ON p.id=u.plan_id
    WHERE MIN(w.ends_at,COALESCE(w.cancelled_at,w.ends_at)) < ? - (${historyDays}) * 86400 LIMIT 500)`).bind(timestamp).run();
  const statements = [
    ['sessions', 'expires_at', timestamp, 500],
    ['challenges', 'expires_at', timestamp, 1000],
    ['rate_limits', 'expires_at', timestamp, 3500],
  ] as const;
  await env.DB.batch(statements.map(([table, field, cutoff, limit]) => env.DB.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE ${field}<? LIMIT ${limit})`).bind(cutoff)));
}
