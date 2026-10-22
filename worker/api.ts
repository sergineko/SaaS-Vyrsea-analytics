import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from './env';
import { nowSeconds } from './env';
import { monitors } from './schema';
import { normalizeTarget } from './probe';
import { rateLimit, sessionUser } from './security';
import { dispatchPending, reserveCheck } from './jobs';
import { registeredDomain } from '../shared/domains';
import { accountPlan, backfillDomains } from './plans';
import { intervalLabel } from '../shared/plans';
import { maintenance } from './maintenance';
import { denyInactive } from './accounts';

export const api = new Hono<AppEnv>();
api.use('*', async (c, next) => {
  const user = await sessionUser(c);
  if (!user) throw new HTTPException(401, { message: 'Inicia sesión para continuar.' });
  const denied = denyInactive(c, user); if (denied) return denied;
  c.set('user', user);
  if (!['GET', 'HEAD'].includes(c.req.method)) await rateLimit(c, 'write', 20, 60);
  await next();
});
const monitorInput = z.object({ name: z.string().trim().min(1).max(60), url: z.string().max(2048) }).strict();
async function owned(c: Parameters<typeof sessionUser>[0], id: string) {
  const row = await drizzle(c.env.DB).select().from(monitors).where(and(eq(monitors.id, id), eq(monitors.userId, c.get('user').id))).get();
  if (!row) throw new HTTPException(404, { message: 'No se ha encontrado el monitor.' });
  return row;
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
  const since = Math.max(nowSeconds() - limits.historyDays * 86400, Math.floor(nowSeconds() / 3600) * 3600 - (days * 24 - 1) * 3600);
  const [items, stats, incidents, notifications, windows] = await Promise.all([
    drizzle(c.env.DB).select().from(monitors).where(eq(monitors.userId, userId)).all(),
    c.env.DB.prepare(`SELECT h.monitor_id AS monitorId,h.hour,h.total,h.successful,h.total_ms AS totalMs
      FROM hourly_stats h JOIN monitors m ON m.id=h.monitor_id WHERE m.user_id=? AND h.hour>=? ORDER BY h.hour`).bind(userId, since).all(),
    c.env.DB.prepare(`SELECT i.id,i.monitor_id AS monitorId,m.name AS monitorName,i.opened_at AS openedAt,i.resolved_at AS resolvedAt,i.reason
      FROM incidents i JOIN monitors m ON m.id=i.monitor_id WHERE m.user_id=? AND (i.resolved_at IS NULL OR i.resolved_at>=?) ORDER BY i.opened_at DESC LIMIT 50`).bind(userId, since).all(),
    c.env.DB.prepare(`SELECT id,monitor_id AS monitorId,kind,message,created_at AS createdAt,read_at AS readAt
      FROM notifications WHERE user_id=? AND created_at>=? ORDER BY created_at DESC LIMIT 50`).bind(userId, since).all(),
    c.env.DB.prepare(`SELECT w.id,w.monitor_id AS monitorId,m.name AS monitorName,w.starts_at AS startsAt,w.ends_at AS endsAt,
      w.reason,w.created_at AS createdAt,w.cancelled_at AS cancelledAt FROM maintenance_windows w JOIN monitors m ON m.id=w.monitor_id
      WHERE m.user_id=? AND MIN(w.ends_at,COALESCE(w.cancelled_at,w.ends_at))>=? ORDER BY CASE WHEN w.cancelled_at IS NULL AND w.ends_at>? THEN 0 ELSE 1 END,w.starts_at DESC LIMIT 100`)
      .bind(userId,since,nowSeconds()).all(),
  ]);
  return c.json({ user: c.get('user'), monitors: items, stats: stats.results, incidents: incidents.results, notifications: notifications.results,
    maintenance: windows.results, limits, windowDays: days, activeProbeProviders: ['cloudflare'], multiProbeActive: false, serverTime: nowSeconds() });
});
api.route('/',maintenance);
api.post('/monitors', async c => {
  const input = monitorInput.parse(await c.req.json());
  const url = target(input.url);
  let rootDomain: string;
  try { rootDomain = registeredDomain(url); } catch (error) { throw new HTTPException(400, { message: (error as Error).message }); }
  await backfillDomains(c.env, c.get('user').id);
  const id = crypto.randomUUID();
  await drizzle(c.env.DB).insert(monitors).values({ id, userId: c.get('user').id, name: input.name, url, rootDomain, nextCheckAt: nowSeconds(), createdAt: nowSeconds() }).run();
  return c.json({ id }, 201);
});
api.patch('/monitors/:id', async c => {
  const monitor = await owned(c, c.req.param('id'));
  const input = monitorInput.partial().extend({ paused: z.boolean().optional() }).strict().parse(await c.req.json());
  if (Object.keys(input).length === 0) throw new HTTPException(400, { message: 'No hay cambios.' });
  const changedURL = input.url !== undefined && target(input.url) !== monitor.url;
  const timestamp = nowSeconds();
  const plan = await accountPlan(c.env, c.get('user').id);
  const db = drizzle(c.env.DB);
  // A changed destination starts a fresh monitor history. Prevent attribution to the old URL.
  if (changedURL) throw new HTTPException(400, { message: 'Para cambiar el destino, elimina este monitor y crea uno nuevo. Así conservarás estadísticas coherentes.' });
  await db.update(monitors).set({ ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.paused !== undefined ? { paused: input.paused, nextCheckAt: timestamp + plan.intervalSeconds } : {}),
  }).where(eq(monitors.id, monitor.id)).run();
  return c.json({ ok: true });
});
api.delete('/monitors/:id', async c => {
  const monitor = await owned(c, c.req.param('id'));
  await drizzle(c.env.DB).delete(monitors).where(eq(monitors.id, monitor.id)).run();
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
