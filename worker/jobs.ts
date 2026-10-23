import type { CheckJob, Env, QueuePayload } from './env';
import { INTERVAL_SECONDS, nowSeconds } from './env';
import { probe, type ProbeResult } from './probe';
import { accountEligible, expireInactiveAccounts, slotEligible } from './account-policy';
import { JOBS_PER_MESSAGE, SCHEDULER_BATCH_SIZE } from '../shared/capacity';
import { retentionCandidatesSQL } from './retention';
import {monitorBatch} from './database';

export { JOBS_PER_MESSAGE };

export async function reserveCheck(env: Env, monitorId: string, timestamp = nowSeconds()) {
  return (await reserveChecks(env, [monitorId], timestamp))[0];
}
async function reserveChecks(env: Env, monitorIds: string[], timestamp: number, cadenceBase = timestamp) {
  if (!monitorIds.length) return [];
  const slot = Math.floor(timestamp / INTERVAL_SECONDS) * INTERVAL_SECONDS;
  const ids = JSON.stringify(monitorIds);
  // Three set-based statements, regardless of the number of due monitors.
  // Keep the reservation, maintenance guard and cadence update in one transaction.
  const result = await monitorBatch<{monitorId:string}>(env.DB,[
    env.DB.prepare(`UPDATE monitors SET next_check_at=MAX(next_check_at,(SELECT MAX(w.ends_at) FROM maintenance_windows w
      WHERE w.monitor_id=monitors.id AND w.cancelled_at IS NULL AND w.starts_at<=? AND w.ends_at>?)),
      failures=CASE WHEN status='down' THEN failures ELSE 0 END,status=CASE WHEN status='degraded' THEN 'pending' ELSE status END
      WHERE id IN (SELECT value FROM json_each(?)) AND paused=0 AND next_check_at<=? AND ${accountEligible(timestamp)} AND EXISTS(SELECT 1 FROM maintenance_windows w WHERE w.monitor_id=monitors.id
      AND w.cancelled_at IS NULL AND w.starts_at<=? AND w.ends_at>?)`).bind(timestamp,timestamp,ids,timestamp,timestamp,timestamp),
    env.DB.prepare(`INSERT OR IGNORE INTO check_jobs(id,monitor_id,slot,created_at)
      SELECT id || ':' || CAST(? AS INTEGER),id,?,? FROM monitors WHERE id IN (SELECT value FROM json_each(?)) AND paused=0 AND next_check_at<=? AND last_slot<?
      AND ${accountEligible(timestamp)} AND ${slotEligible(slot)} RETURNING monitor_id AS monitorId`)
      .bind(slot, slot, timestamp, ids, timestamp, slot),
    env.DB.prepare(`UPDATE monitors SET next_check_at=?+(SELECT p.interval_seconds FROM plan_limits p JOIN users u ON u.plan_id=p.id WHERE u.id=monitors.user_id) WHERE id IN (SELECT value FROM json_each(?)) AND paused=0 AND next_check_at<=?
      AND EXISTS(SELECT 1 FROM check_jobs WHERE id=monitors.id || ':' || CAST(? AS INTEGER))`)
      .bind(cadenceBase, ids, timestamp, slot),
  ],monitorIds);
  const reserved = new Set(result[1].results.map(row => row.monitorId));
  return monitorIds.map(id => reserved.has(id));
}

export async function dispatchPending(env: Env, timestamp = nowSeconds()) {
  // Re-dispatch after 15 min if delivery exhausted its retries. Result writes are idempotent.
  await env.DB.prepare(`DELETE FROM check_jobs WHERE id IN (SELECT j.id FROM check_jobs j JOIN monitors ON monitors.id=j.monitor_id
    WHERE NOT ${accountEligible(timestamp)} OR NOT ${slotEligibleColumn()} LIMIT 100)`).run();
  const rows = await env.DB.prepare('SELECT id,monitor_id AS monitorId,slot FROM check_jobs WHERE dispatched_at IS NULL OR dispatched_at<? ORDER BY created_at LIMIT 10')
    .bind(timestamp - 900).all<CheckJob & { id: string }>();
  if (!rows.results.length) return;
  const messages: MessageSendRequest<QueuePayload>[] = [];
  for (let i = 0; i < rows.results.length; i += JOBS_PER_MESSAGE) {
    const group = rows.results.slice(i, i + JOBS_PER_MESSAGE);
    messages.push({ body: { jobs: group.map(({ monitorId, slot }) => ({ monitorId, slot })) } });
  }
  // Mark only after a successful send; replay after a partial outage is idempotent.
  await env.CHECK_QUEUE.sendBatch(messages);
  await env.DB.prepare(`UPDATE check_jobs SET dispatched_at=? WHERE id IN (${rows.results.map(() => '?').join(',')})`)
    .bind(timestamp, ...rows.results.map(job => job.id)).run();
}
function slotEligibleColumn() { return 'EXISTS(SELECT 1 FROM users u WHERE u.id=monitors.user_id AND u.monitoring_since<=j.slot)'; }

export async function schedule(env: Env, timestamp = nowSeconds()) {
  // Cron arrival jitter must not move every subsequent deadline. Anchor automatic
  // cadence to the current minute; manual checks keep their exact cooldown.
  const tick=Math.floor(timestamp/INTERVAL_SECONDS)*INTERVAL_SECONDS;
  const due = await env.DB.prepare(`SELECT id FROM monitors WHERE paused=0 AND next_check_at<=? AND ${accountEligible(timestamp)} ORDER BY next_check_at LIMIT ${SCHEDULER_BATCH_SIZE}`).bind(timestamp).all<{ id: string }>();
  await reserveChecks(env, due.results.map(row => row.id), timestamp, tick);
  await dispatchPending(env, timestamp);
}

export async function recordResult(env: Env, job: CheckJob, result: ProbeResult, timestamp = nowSeconds()) {
  if(env.DB.recordCheckResult){await env.DB.recordCheckResult(job.monitorId,job.slot,timestamp,result);return;}
  const id = `${job.monitorId}:${job.slot}`;
  const hour = Math.floor(timestamp / 3600) * 3600;
  const outsideMaintenance = `AND ${accountEligible(timestamp)} AND ${slotEligible(job.slot)} AND NOT EXISTS(SELECT 1 FROM maintenance_windows w WHERE w.monitor_id=monitors.id
    AND ((w.starts_at<=? AND MIN(w.ends_at,COALESCE(w.cancelled_at,w.ends_at))>?)
    OR (w.starts_at<=? AND MIN(w.ends_at,COALESCE(w.cancelled_at,w.ends_at))>?)))`;
  const maintenanceTimes = [job.slot,job.slot,timestamp,timestamp] as const;
  // A single atomic transaction: the monitor's last_slot changes LAST, guarding
  // every statement. PostgreSQL locks the account/monitor before this batch.
  await monitorBatch(env.DB,[
    // A planned gap breaks consecutive failures. A success resets them in the
    // final monitor update already; an open incident still recovers below.
    ...(!result.ok ? [env.DB.prepare(`UPDATE monitors SET failures=CASE WHEN status='down' THEN failures ELSE 0 END,
      status=CASE WHEN status='degraded' THEN 'pending' ELSE status END WHERE id=? AND last_slot<? AND paused=0
      AND ${accountEligible(timestamp)} AND ${slotEligible(job.slot)}
      AND EXISTS(SELECT 1 FROM maintenance_windows w WHERE w.monitor_id=monitors.id AND w.starts_at<=?
      AND MIN(w.ends_at,COALESCE(w.cancelled_at,w.ends_at))>COALESCE(last_checked_at,created_at)
      AND MIN(w.ends_at,COALESCE(w.cancelled_at,w.ends_at))>w.starts_at)`).bind(job.monitorId,job.slot,timestamp)] : []),
    env.DB.prepare(`INSERT OR IGNORE INTO checks(id,monitor_id,checked_at,ok,status_code,response_ms,error)
      SELECT ?,id,?,?,?,?,? FROM monitors WHERE id=? AND last_slot<? AND paused=0 ${outsideMaintenance}`)
      .bind(id, timestamp, result.ok ? 1 : 0, result.statusCode, result.responseMs, result.error, job.monitorId, job.slot,...maintenanceTimes),
    env.DB.prepare(`INSERT INTO hourly_stats(monitor_id,hour,total,successful,total_ms)
      SELECT id,?,1,?,? FROM monitors WHERE id=? AND last_slot<? AND paused=0 ${outsideMaintenance}
      ON CONFLICT(monitor_id,hour) DO UPDATE SET total=hourly_stats.total+1,successful=hourly_stats.successful+excluded.successful,total_ms=hourly_stats.total_ms+excluded.total_ms`)
      .bind(hour, result.ok ? 1 : 0, result.responseMs, job.monitorId, job.slot,...maintenanceTimes),
    // Branch only on the immutable probe result. Monitor state must still be
    // checked inside this transaction, including concurrent/out-of-order results.
    ...(!result.ok ? [env.DB.prepare(`INSERT OR IGNORE INTO incidents(id,monitor_id,opened_at,reason)
      SELECT ?,id,?,? FROM monitors WHERE id=? AND last_slot<? AND paused=0 AND failures>=1 AND status!='down' AND ?=0 ${outsideMaintenance}`)
      .bind(id, timestamp, result.error ?? 'Error HTTP', job.monitorId, job.slot, result.ok ? 1 : 0,...maintenanceTimes),
    env.DB.prepare(`INSERT OR IGNORE INTO notifications(id,user_id,monitor_id,kind,message,created_at)
      SELECT ? || ':down',user_id,id,'down',name || ' no responde. Dos fallos consecutivos confirmados.',?
      FROM monitors WHERE id=? AND last_slot<? AND paused=0 AND failures>=1 AND status!='down' AND ?=0 ${outsideMaintenance}`)
      .bind(id, timestamp, job.monitorId, job.slot, result.ok ? 1 : 0,...maintenanceTimes)] : []),
    ...(result.ok ? [env.DB.prepare(`INSERT OR IGNORE INTO notifications(id,user_id,monitor_id,kind,message,created_at)
      SELECT ? || ':up',user_id,id,'up',name || ' vuelve a estar disponible.',?
      FROM monitors WHERE id=? AND last_slot<? AND paused=0 AND status='down' AND ?=1 ${outsideMaintenance}`)
      .bind(id, timestamp, job.monitorId, job.slot, result.ok ? 1 : 0,...maintenanceTimes),
    env.DB.prepare(`UPDATE incidents SET resolved_at=? WHERE monitor_id=? AND resolved_at IS NULL AND ?=1
      AND EXISTS(SELECT 1 FROM monitors WHERE id=? AND last_slot<? AND paused=0 ${outsideMaintenance})`)
      .bind(timestamp, job.monitorId, result.ok ? 1 : 0, job.monitorId, job.slot,...maintenanceTimes)] : []),
    env.DB.prepare(`UPDATE monitors SET status=CASE WHEN ?=1 THEN 'up' WHEN failures>=1 THEN 'down' ELSE 'degraded' END,
      failures=CASE WHEN ?=1 THEN 0 ELSE failures+1 END,last_checked_at=?,last_status_code=?,last_response_ms=?,last_error=?,last_slot=?
      WHERE id=? AND last_slot<? AND paused=0 ${outsideMaintenance}`)
      .bind(result.ok ? 1 : 0, result.ok ? 1 : 0, timestamp, result.statusCode, result.responseMs, result.error, job.slot, job.monitorId, job.slot,...maintenanceTimes),
    env.DB.prepare('DELETE FROM check_jobs WHERE id=?').bind(id),
  ],[job.monitorId]);
}

export async function consume(payload: QueuePayload, env: Env) {
  if (!payload || !Array.isArray(payload.jobs) || !payload.jobs.length || payload.jobs.length > JOBS_PER_MESSAGE ||
    payload.jobs.some(job => !job || typeof job.monitorId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(job.monitorId) || !Number.isSafeInteger(job.slot) || job.slot < 0) ||
    new Set(payload.jobs.map(job => `${job.monitorId}:${job.slot}`)).size !== payload.jobs.length) throw new Error('Invalid queue payload');
  // Two lanes avoid placing healthy targets behind a slow one. Each lane uses
  // at most two DNS connections, below the shared six-connection limit.
  async function run(job: CheckJob) {
    const timestamp=nowSeconds();
    const monitor = await env.DB.prepare(`SELECT url,paused,last_slot,${accountEligible(timestamp)} AS eligible,${slotEligible(job.slot)} AS validSlot,
      EXISTS(SELECT 1 FROM maintenance_windows w WHERE w.monitor_id=monitors.id
      AND ((w.starts_at<=? AND MIN(w.ends_at,COALESCE(w.cancelled_at,w.ends_at))>?) OR
      (w.starts_at<=? AND MIN(w.ends_at,COALESCE(w.cancelled_at,w.ends_at))>?))) AS maintenance FROM monitors WHERE id=?`)
      .bind(timestamp,timestamp,job.slot,job.slot,job.monitorId).first<{ url: string; paused: number; last_slot: number; maintenance:number; eligible:number; validSlot:number }>();
    if (!monitor || !monitor.eligible || !monitor.validSlot || monitor.paused || monitor.maintenance || monitor.last_slot >= job.slot) {
      await env.DB.prepare('DELETE FROM check_jobs WHERE id=?').bind(`${job.monitorId}:${job.slot}`).run();
      return;
    }
    const result = await probe(monitor.url);
    await recordResult(env, job, result);
  }
  // Wait for both lanes before retrying; no work remains running after a failure.
  for(let index=0;index<payload.jobs.length;index+=2){
    const results=await Promise.allSettled(payload.jobs.slice(index,index+2).map(run));
    const failed=results.find(result=>result.status==='rejected');
    if(failed?.status==='rejected')throw failed.reason;
  }
}

export async function cleanup(env: Env, timestamp = nowSeconds()) {
  await expireInactiveAccounts(env, timestamp);
  const dayBoundary=Math.floor(timestamp/86400)*86400;
  const deleted:Record<string,number>={};let pending=false;
  // Retention follows each account; bounded deletes limit work after long outages.
  const historyDays = `CASE WHEN u.plan_id='business' THEN u.history_days_limit ELSE p.history_days END`;
  for (const [table, field, limit] of [['checks','checked_at',3500], ['hourly_stats','hour',1000], ['incidents','resolved_at',500]] as const) {
    const key=table==='checks'?'id':table==='hourly_stats'?'(monitor_id,hour)':'rowid';
    const result=await env.DB.prepare(`DELETE FROM ${table} WHERE ${key} IN (${retentionCandidatesSQL(table, field, limit)})`).bind(dayBoundary).run();
    deleted[table]=result.meta.changes;pending ||= result.meta.changes>=limit;
  }
  const notifications=await env.DB.prepare(`DELETE FROM notifications WHERE rowid IN (
    SELECT n.rowid FROM notifications n JOIN users u ON u.id=n.user_id JOIN plan_limits p ON p.id=u.plan_id
    WHERE n.created_at < ? - (${historyDays}) * 86400 LIMIT 500)`).bind(dayBoundary).run();
  deleted.notifications=notifications.meta.changes;pending ||= notifications.meta.changes>=500;
  const maintenance=await env.DB.prepare(`DELETE FROM maintenance_windows WHERE rowid IN (
    SELECT w.rowid FROM maintenance_windows w JOIN monitors m ON m.id=w.monitor_id JOIN users u ON u.id=m.user_id JOIN plan_limits p ON p.id=u.plan_id
    WHERE MIN(w.ends_at,COALESCE(w.cancelled_at,w.ends_at)) < ? - (${historyDays}) * 86400 LIMIT 500)`).bind(dayBoundary).run();
  deleted.maintenance_windows=maintenance.meta.changes;pending ||= maintenance.meta.changes>=500;
  const statements = [
    ['sessions', 'expires_at', timestamp, 500],
    ['challenges', 'expires_at', timestamp, 1000],
    ['recent_auth', 'expires_at', timestamp, 500],
    ['rate_limits', 'expires_at', timestamp, 3500],
  ] as const;
  const security=await env.DB.batch(statements.map(([table, field, cutoff, limit]) => env.DB.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE ${field}<? LIMIT ${limit})`).bind(cutoff)));
  security.forEach((result,index)=>{deleted[statements[index][0]]=result.meta.changes;pending ||= result.meta.changes>=statements[index][3];});
  const operational=[
    env.DB.prepare('DELETE FROM team_invitations WHERE id IN (SELECT id FROM team_invitations WHERE expires_at<? LIMIT 200)').bind(timestamp),
    env.DB.prepare('DELETE FROM email_receipts WHERE provider_id IN (SELECT provider_id FROM email_receipts WHERE created_at<? LIMIT 500)').bind(timestamp-7*86400),
    env.DB.prepare(`DELETE FROM audit_events WHERE id IN (SELECT a.id FROM audit_events a JOIN users u ON u.id=a.workspace_id JOIN plan_limits p ON p.id=u.plan_id WHERE a.created_at<?-(${historyDays})*86400 LIMIT 500)`).bind(dayBoundary),
    env.DB.prepare(`DELETE FROM alert_deliveries WHERE id IN (SELECT d.id FROM alert_deliveries d JOIN alert_destinations a ON a.id=d.destination_id JOIN users u ON u.id=a.user_id JOIN plan_limits p ON p.id=u.plan_id WHERE d.created_at<?-(${historyDays})*86400 AND d.state NOT IN ('pending','sending') LIMIT 500)`).bind(dayBoundary),
    env.DB.prepare(`DELETE FROM status_announcements WHERE id IN (SELECT a.id FROM status_announcements a JOIN status_pages s ON s.id=a.page_id JOIN users u ON u.id=s.user_id JOIN plan_limits p ON p.id=u.plan_id WHERE a.state='resolved' AND a.updated_at<?-(${historyDays})*86400 LIMIT 200)`).bind(dayBoundary),
  ];
  const extra=await env.DB.batch(operational);
  extra.forEach((result,index)=>{const names=['team_invitations','email_receipts','audit_events','alert_deliveries','status_announcements'];deleted[names[index]]=result.meta.changes;pending ||=result.meta.changes>=[200,500,500,500,200][index];});
  return {deleted,pending};
}
