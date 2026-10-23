import { Hono } from 'hono';
import {auditedDatabase} from './audit';
import {auditStatement} from './team';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { AppEnv, User } from './env';
import { MAX_MONITORS_TOTAL, nowSeconds } from './env';
import { rateLimit, sessionUser } from './security';
import { expireInactiveAccounts } from './account-policy';
import { estimateCapacity } from '../shared/capacity';
import { infrastructure } from './infrastructure';
import { retentionStatus } from './retention-job';
import {business} from './business';

export function denyInactive(c: Context<AppEnv>, user: User) {
  if (user.accountStatus !== 'active') return c.json({ code: user.accountStatus === 'pending' ? 'ACCOUNT_PENDING' : 'ACCOUNT_SUSPENDED',
    error: user.accountStatus === 'pending' ? 'Tu solicitud está pendiente de aprobación.' : 'Tu cuenta está suspendida. Solicita la revisión del propietario.' }, 403);
}

const requireSession = async (c: Context<AppEnv>, next: () => Promise<void>) => {
  const user = await sessionUser(c);
  if (!user) throw new HTTPException(401, { message: 'Inicia sesión para continuar.' });
  c.set('user', user);
  await next();
};

export const account = new Hono<AppEnv>();
account.use('*', requireSession);
account.post('/activity', async c => {
  const denied = denyInactive(c, c.get('user')); if (denied) return denied;
  // No rate-limit counter write here: the conditional update itself bounds writes to one/hour.
  await c.env.DB.prepare("UPDATE users SET last_active_at=? WHERE id=? AND account_status='active' AND last_active_at<=?")
    .bind(nowSeconds(), c.get('user').id, nowSeconds() - 3600).run();
  return c.json({ ok: true });
});
account.post('/review', async c => {
  const user = c.get('user');
  if (user.accountStatus !== 'suspended') throw new HTTPException(409, { message: 'Esta cuenta no necesita solicitar una reactivación.' });
  await c.env.DB.prepare("UPDATE users SET review_requested_at=? WHERE id=? AND account_status='suspended' AND review_requested_at IS NULL")
    .bind(nowSeconds(), user.id).run();
  return c.json({ ok: true });
});

export const owner = new Hono<AppEnv>();
owner.use('*', requireSession);
owner.use('*', async (c, next) => {
  const user = c.get('user');
  if (!user.isOwner || user.accountStatus !== 'active') throw new HTTPException(403, { message: 'Esta sección es exclusiva del propietario.' });
  if (c.req.method !== 'GET') await rateLimit(c, 'owner', 30, 60);
  if(!['GET','HEAD'].includes(c.req.method)){const base=c.env.DB;c.env={...c.env,DB:auditedDatabase(base,()=>auditStatement(c,c.req.method.toLowerCase(),c.req.path,base))};}
  await next();
});
owner.get('/infrastructure', async c => {
  const [data,retention]=await Promise.all([infrastructure(c.env),retentionStatus(c.env)]);
  return c.json({...data,retention});
});
owner.route('/',business);
owner.get('/accounts', async c => {
  await expireInactiveAccounts(c.env);
  const [accounts, usage] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT u.id,u.username,u.created_at AS createdAt,u.account_status AS accountStatus,u.is_owner AS isOwner,
      u.plan_id AS planId,u.last_active_at AS lastActiveAt,u.status_changed_at AS statusChangedAt,u.suspension_reason AS suspensionReason,
      u.review_requested_at AS reviewRequestedAt,u.domain_limit AS domainLimit,u.monitor_limit AS monitorLimit,u.history_days_limit AS historyDaysLimit,
      COUNT(m.id) AS monitors,COUNT(DISTINCT m.root_domain) AS domains,
      (SELECT COUNT(*) FROM credentials cr WHERE cr.user_id=u.id) AS passkeys,
      (SELECT expires_at FROM account_invitations ai WHERE ai.user_id=u.id AND ai.claimed_at IS NULL) AS invitationExpiresAt
      FROM users u LEFT JOIN monitors m ON m.user_id=u.id GROUP BY u.id
      ORDER BY CASE WHEN u.account_status='pending' OR u.review_requested_at IS NOT NULL THEN 0 ELSE 1 END,u.created_at DESC LIMIT 100`),
    c.env.DB.prepare(`SELECT (SELECT COUNT(*) FROM monitors m JOIN users u ON u.id=m.user_id WHERE u.is_owner=0) AS monitors,
      (SELECT COUNT(*) FROM check_jobs) AS queuedChecks,
      (SELECT COUNT(*) FROM users WHERE account_status='active') AS activeAccounts,
      COALESCE(SUM(CASE WHEN m.paused=0 AND u.account_status='active' THEN 86400 / p.interval_seconds ELSE 0 END),0) AS checksPerDay,
      COALESCE(SUM(CASE WHEN m.paused=0 AND u.account_status='active' THEN 1 ELSE 0 END),0) AS activeMonitors,
      COALESCE(MAX(CASE WHEN m.paused=0 AND u.account_status='active' THEN 86400 / p.interval_seconds ELSE 0 END),0) AS fastestChecksPerDay
      FROM monitors m JOIN users u ON u.id=m.user_id JOIN plan_limits p ON p.id=u.plan_id`),
  ]);
  const measured = usage.results[0] as Record<string, number>;
  return c.json({ accounts: accounts.results, usage: { ...measured, monitorLimit: MAX_MONITORS_TOTAL, accountLimit: 100 },
    capacity: estimateCapacity(measured.checksPerDay, measured.activeMonitors, measured.fastestChecksPerDay),databaseProvider:c.env.DATABASE_PROVIDER==='supabase'?'supabase':'d1', inactivityDays: 14 });
});
const planInput = z.discriminatedUnion('planId', [
  z.object({planId:z.literal('business'),domainLimit:z.number().int().min(1).max(1_000_000),monitorLimit:z.number().int().min(1).max(1_000_000),historyDaysLimit:z.number().int().min(1).max(365)}).strict(),
  z.object({planId:z.enum(['free','starter','pro'])}).strict(),
]);
owner.patch('/accounts/:id/plan', async c => {
  const input=planInput.parse(await c.req.json()), id=c.req.param('id'), timestamp=nowSeconds();
  const target=await c.env.DB.prepare('SELECT id,is_owner FROM users WHERE id=?').bind(id).first<{id:string;is_owner:number}>();
  if(!target)throw new HTTPException(404,{message:'No se ha encontrado la cuenta.'});
  if(target.is_owner)throw new HTTPException(409,{message:'El propietario tiene acceso completo y no se modifica desde este formulario.'});
  const interval=await c.env.DB.prepare('SELECT interval_seconds FROM plan_limits WHERE id=?').bind(input.planId).first<{interval_seconds:number}>();
  const resumeAt=(Math.floor(timestamp/60)+1)*60;
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET plan_id=?,domain_limit=?,monitor_limit=?,history_days_limit=?,monitoring_since=? WHERE id=? AND is_owner=0`)
      .bind(input.planId,input.planId==='business'?input.domainLimit:null,input.planId==='business'?input.monitorLimit:null,input.planId==='business'?input.historyDaysLimit:null,resumeAt,id),
    c.env.DB.prepare('DELETE FROM check_jobs WHERE monitor_id IN (SELECT id FROM monitors WHERE user_id=?)').bind(id),
    c.env.DB.prepare('UPDATE monitors SET next_check_at=MAX(COALESCE(last_checked_at,0)+?,?) WHERE user_id=?').bind(interval!.interval_seconds,resumeAt,id),
  ]);
  return c.json({ok:true,billingEnabled:false});
});
owner.post('/accounts/:id/:action', async c => {
  z.object({}).strict().parse(await c.req.json());
  const action = z.enum(['approve', 'suspend']).parse(c.req.param('action'));
  const id = c.req.param('id'), timestamp = nowSeconds();
  const target = await c.env.DB.prepare('SELECT id,is_owner,account_status FROM users WHERE id=?').bind(id).first<{id: string; is_owner: number; account_status: string}>();
  if (!target) throw new HTTPException(404, { message: 'No se ha encontrado la cuenta.' });
  if (target.is_owner) throw new HTTPException(409, { message: 'La cuenta de propietario se protege frente a estos cambios.' });
  if ((action === 'approve') === (target.account_status === 'active')) throw new HTTPException(409, { message: 'La cuenta ya tiene ese estado.' });
  // Start in the next minute so deliveries from before suspension/approval cannot be accepted.
  const resumeAt = (Math.floor(timestamp / 60) + 1) * 60;
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET account_status=?,suspension_reason=?,status_changed_at=?,review_requested_at=NULL,
      last_active_at=CASE WHEN ?='approve' THEN ? ELSE last_active_at END,
      monitoring_since=CASE WHEN ?='approve' THEN ? ELSE monitoring_since END
      WHERE id=? AND is_owner=0 AND account_status${action === 'approve' ? " IN ('pending','suspended')" : "='active'"}`)
      .bind(action === 'approve' ? 'active' : 'suspended', action === 'suspend' ? 'owner' : null, timestamp, action, timestamp, action, resumeAt, id),
    c.env.DB.prepare('DELETE FROM check_jobs WHERE monitor_id IN (SELECT id FROM monitors WHERE user_id=?)').bind(id),
    c.env.DB.prepare(`UPDATE monitors SET next_check_at=MAX(next_check_at,?),failures=CASE WHEN status='down' THEN failures ELSE 0 END,
      status=CASE WHEN status='degraded' THEN 'pending' ELSE status END WHERE user_id=?`)
      .bind(resumeAt, id),
  ]);
  return c.json({ ok: true });
});
