import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { AppEnv } from './env';
import { nowSeconds } from './env';
import type { Monitor } from '../src/types';
import { normalizeTarget } from './probe';
import { rateLimit, sessionUser } from './security';
import { dispatchPending, reserveCheck } from './jobs';
import { registeredDomain } from '../shared/domains';
import { accountPlan, backfillDomains } from './plans';
import { intervalLabel } from '../shared/plans';
import { maintenance } from './maintenance';
import { denyInactive } from './accounts';
import {statusPages} from './status-pages';
import {availabilityStatsSQL,dashboardStatistics} from './statistics';
import {team,workspaceContext,auditStatement} from './team';
import {auditedDatabase} from './audit';
import {alerts} from './alerts';

export const api = new Hono<AppEnv>();
api.use('*', async (c, next) => {
  const user = await sessionUser(c);
  if (!user) throw new HTTPException(401, { message: 'Inicia sesión para continuar.' });
  const denied = denyInactive(c, user); if (denied) return denied;
  await workspaceContext(c,user);
  if (!['GET', 'HEAD'].includes(c.req.method)) await rateLimit(c, 'write', 20, 60);
  if(!['GET','HEAD'].includes(c.req.method)&&!c.req.path.startsWith('/api/team/')){
    const base=c.env.DB;
    c.env={...c.env,DB:auditedDatabase(base,()=>auditStatement(c,c.req.method.toLowerCase(),c.req.path,base))};
  }
  await next();
});
api.route('/',team);
api.route('/alerts',alerts);
const monitorInput = z.object({ name: z.string().trim().min(1).max(60), url: z.string().max(2048) }).strict();
const monitorColumns = `id,user_id AS userId,name,url,root_domain AS rootDomain,paused,status,failures,
  last_checked_at AS lastCheckedAt,last_status_code AS lastStatusCode,last_response_ms AS lastResponseMs,
  last_error AS lastError,next_check_at AS nextCheckAt,created_at AS createdAt,probe_mask AS probeMask`;
const mapMonitor = (row: Monitor) => ({...row,paused:Boolean(row.paused)});
async function owned(c: Parameters<typeof sessionUser>[0], id: string) {
  const row = await c.env.DB.prepare(`SELECT ${monitorColumns} FROM monitors WHERE id=? AND user_id=?`).bind(id,c.get('user').id).first<Monitor>();
  if (!row) throw new HTTPException(404, { message: 'No se ha encontrado el monitor.' });
  return mapMonitor(row);
}
function target(value: string) {
  try { return normalizeTarget(value); } catch (e) { throw new HTTPException(400, { message: (e as Error).message }); }
}

api.get('/dashboard', async c => {
  const userId = c.get('user').id;
  await backfillDomains(c.env, userId);
  const limits = await accountPlan(c.env, userId);
  if (c.req.query('view') === 'advanced' && !limits.advancedDashboard) throw new HTTPException(403, { message: 'La plataforma avanzada es exclusiva de Pro / Agencia y Business.' });
  const days = z.coerce.number().int().min(1).max(365).parse(c.req.query('days') ?? '1');
  if (days > limits.historyDays) throw new HTTPException(403, { message: `Tu plan incluye ${limits.historyDays} días de histórico.` });
  const timestamp=nowSeconds();
  const since = Math.max(timestamp - limits.historyDays * 86400, Math.floor(timestamp / 3600) * 3600 - (days * 24 - 1) * 3600);
  const items=(await c.env.DB.prepare(`SELECT ${monitorColumns} FROM monitors WHERE user_id=?`).bind(userId).all<Monitor>()).results.map(mapMonitor);
  const [statistics, incidents, notifications, windows] = await Promise.all([
    dashboardStatistics(c.env,userId,items.map(item=>item.id),since,days,timestamp),
    c.env.DB.prepare(`SELECT i.id,i.monitor_id AS monitorId,m.name AS monitorName,i.opened_at AS openedAt,i.resolved_at AS resolvedAt,i.reason
      FROM incidents i JOIN monitors m ON m.id=i.monitor_id WHERE m.user_id=? AND (i.resolved_at IS NULL OR i.resolved_at>=?) ORDER BY i.opened_at DESC LIMIT 50`).bind(userId, since).all(),
    c.env.DB.prepare(`SELECT id,monitor_id AS monitorId,kind,message,created_at AS createdAt,read_at AS readAt
      FROM notifications WHERE user_id=? AND created_at>=? ORDER BY created_at DESC LIMIT 50`).bind(userId, since).all(),
    c.env.DB.prepare(`SELECT w.id,w.monitor_id AS monitorId,m.name AS monitorName,w.starts_at AS startsAt,w.ends_at AS endsAt,
      w.reason,w.created_at AS createdAt,w.cancelled_at AS cancelledAt FROM maintenance_windows w JOIN monitors m ON m.id=w.monitor_id
      WHERE m.user_id=? AND MIN(w.ends_at,COALESCE(w.cancelled_at,w.ends_at))>=? ORDER BY CASE WHEN w.cancelled_at IS NULL AND w.ends_at>? THEN 0 ELSE 1 END,w.starts_at DESC LIMIT 100`)
      .bind(userId,since,nowSeconds()).all(),
  ]);
  return c.json({ user: c.get('actor')??c.get('user'),workspace:{id:userId,name:c.get('user').username,role:c.get('workspaceRole')}, monitors: items, stats: statistics.stats, incidents: incidents.results, notifications: notifications.results,
    maintenance: windows.results, limits, windowDays: days, activeProbeProviders: ['cloudflare'], multiProbeActive: false, serverTime: timestamp,
    historyAsOf:statistics.historyAsOf,historyCacheSeconds:300 });
});
api.route('/',maintenance);
api.route('/status-pages',statusPages);
api.get('/monitors/:id/availability',async c=>{
  const monitor=await owned(c,c.req.param('id')),plan=await accountPlan(c.env,c.get('user').id),now=nowSeconds();
  const hour=Math.floor(now/3600)*3600,earliest=Math.ceil((now-plan.historyDays*86400)/3600)*3600;
  const days=c.req.query('days');let from:number,to=now;
  if(days!==undefined){const n=z.coerce.number().int().min(1).max(365).parse(days);if(n>plan.historyDays)throw new HTTPException(403,{message:`Tu plan conserva ${plan.historyDays} días.`});from=Math.max(earliest,hour-(n*24-1)*3600);}
  else{from=z.coerce.number().int().min(0).parse(c.req.query('from'));to=z.coerce.number().int().min(0).parse(c.req.query('to'));if(from<earliest)throw new HTTPException(403,{message:`El inicio debe estar dentro de los ${plan.historyDays} días de tu plan.`});if(from%3600||to%3600||from>=to||from>now||to>now+3600)throw new HTTPException(400,{message:'Elige un intervalo válido, con precisión de una hora y sin fechas futuras.'});to=Math.min(to,now);}
  const last24From=hour-23*3600;
  const rows=await c.env.DB.prepare(availabilityStatsSQL).bind(monitor.id,from,to,monitor.id,last24From,hour,from,to).all();
  return c.json({from,to,serverTime:now,stats:rows.results.filter(row=>Number(row.hour)>=from&&Number(row.hour)<to),last24:rows.results.filter(row=>Number(row.hour)>=last24From),last24From});
});
api.patch('/monitors/:id/probes',async c=>{
  const monitor=await owned(c,c.req.param('id')),plan=await accountPlan(c.env,c.get('user').id);
  if(!plan.advancedDashboard)throw new HTTPException(403,{message:'La selección de sondas requiere Pro / Agencia o Business.'});
  const {probeMask}=z.object({probeMask:z.number().int().min(1).max(7)}).strict().parse(await c.req.json());
  if(!(probeMask&1))throw new HTTPException(409,{message:'Mantén Cloudflare activa mientras AWS y Google Cloud no estén conectadas. Debe quedar al menos una sonda operativa.'});
  await c.env.DB.prepare('UPDATE monitors SET probe_mask=? WHERE id=?').bind(probeMask,monitor.id).run();return c.json({ok:true,probeMask,activeProbeProviders:['cloudflare']});
});
api.post('/monitors', async c => {
  const input = monitorInput.parse(await c.req.json());
  const url = target(input.url);
  let rootDomain: string;
  try { rootDomain = registeredDomain(url); } catch (error) { throw new HTTPException(400, { message: (error as Error).message }); }
  await backfillDomains(c.env, c.get('user').id);
  const id = crypto.randomUUID();
  await c.env.DB.prepare('INSERT INTO monitors(id,user_id,name,url,root_domain,next_check_at,created_at) VALUES(?,?,?,?,?,?,?)').bind(id,c.get('user').id,input.name,url,rootDomain,nowSeconds(),nowSeconds()).run();
  return c.json({ id }, 201);
});
api.patch('/monitors/:id', async c => {
  const monitor = await owned(c, c.req.param('id'));
  const input = monitorInput.partial().extend({ paused: z.boolean().optional() }).strict().parse(await c.req.json());
  if (Object.keys(input).length === 0) throw new HTTPException(400, { message: 'No hay cambios.' });
  const changedURL = input.url !== undefined && target(input.url) !== monitor.url;
  const timestamp = nowSeconds();
  const plan = await accountPlan(c.env, c.get('user').id);
  // A changed destination starts a fresh monitor history. Prevent attribution to the old URL.
  if (changedURL) throw new HTTPException(400, { message: 'Para cambiar el destino, elimina este monitor y crea uno nuevo. Así conservarás estadísticas coherentes.' });
  const changes:string[]=[],values:unknown[]=[];
  if(input.name!==undefined){changes.push('name=?');values.push(input.name);}
  if(input.paused!==undefined){changes.push('paused=?','next_check_at=?');values.push(Number(input.paused),timestamp+plan.intervalSeconds);}
  if(changes.length)await c.env.DB.prepare(`UPDATE monitors SET ${changes.join(',')} WHERE id=? AND user_id=?`).bind(...values,monitor.id,c.get('user').id).run();
  return c.json({ ok: true });
});
api.delete('/monitors/:id', async c => {
  const monitor = await owned(c, c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM monitors WHERE id=? AND user_id=?').bind(monitor.id,c.get('user').id).run();
  return c.json({ ok: true });
});
api.post('/monitors/:id/check', async c => {
  const monitor = await owned(c, c.req.param('id'));
  if (monitor.paused) throw new HTTPException(400, { message: 'Reanuda el monitor antes de comprobarlo.' });
  const window=await c.env.DB.prepare('SELECT id FROM maintenance_windows WHERE monitor_id=? AND cancelled_at IS NULL AND starts_at<=? AND ends_at>?').bind(monitor.id,nowSeconds(),nowSeconds()).first();
  if(window)throw new HTTPException(409,{message:'El monitor está en mantenimiento. Las comprobaciones se reanudarán al terminar.'});
  const plan = await accountPlan(c.env, c.get('user').id);
  const reserved = await reserveCheck(c.env, monitor.id);
  if (!reserved) throw new HTTPException(429, { message: `El monitor ya está programado. Tu plan permite una comprobación cada ${intervalLabel(plan.intervalSeconds)}.` });
  await dispatchPending(c.env);
  return c.json({ ok: true, message: 'Comprobación en cola. El resultado aparecerá en unos segundos.' }, 202);
});
api.get('/monitors/:id/history', async c => {
  const monitor = await owned(c, c.req.param('id'));
  const plan = await accountPlan(c.env, c.get('user').id);
  const before = z.coerce.number().int().positive().parse(c.req.query('before') ?? String(nowSeconds() + 1));
  const result=z.enum(['all','failed','ok']).parse(c.req.query('result')??'all');
  const rows = await c.env.DB.prepare(`SELECT checked_at AS checkedAt,ok,status_code AS statusCode,response_ms AS responseMs,error
    FROM checks WHERE monitor_id=? AND checked_at>=? AND checked_at<? AND (?='all' OR ok=?) ORDER BY checked_at DESC LIMIT 100`).bind(monitor.id, nowSeconds() - plan.historyDays * 86400, before,result,result==='ok'?1:0).all();
  return c.json(rows.results);
});
api.post('/notifications/read', async c => {
  await c.env.DB.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').bind(nowSeconds(), c.get('user').id).run();
  return c.json({ ok: true });
});
