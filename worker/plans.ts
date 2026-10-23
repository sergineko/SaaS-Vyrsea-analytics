import type { Env } from './env';
import { PLAN_CATALOG, type PlanLimits } from '../shared/plans';
import { registeredDomain } from '../shared/domains';

export async function accountPlan(env: Env, userId: string): Promise<PlanLimits> {
  const plan = await env.DB.prepare(`SELECT p.id,p.name,u.is_owner AS owner,
    CASE WHEN p.id='business' THEN u.domain_limit ELSE p.max_domains END AS domains,
    CASE WHEN p.id='business' THEN u.monitor_limit ELSE p.max_monitors END AS monitors,
    CASE WHEN p.id='business' THEN u.history_days_limit ELSE p.history_days END AS historyDays,p.interval_seconds AS intervalSeconds
    FROM users u JOIN plan_limits p ON p.id=CASE WHEN u.is_owner=1 THEN 'business' ELSE u.plan_id END WHERE u.id=?`).bind(userId).first<PlanLimits & {owner:number}>();
  const definition = PLAN_CATALOG.find(item => item.id === plan?.id);
  if (!plan || !definition || (!plan.owner && (!plan.domains || !plan.monitors)) || !plan.historyDays) throw new Error('Missing account plan or custom contract limits');
  const {owner,...limits}=plan;
  return { ...limits, ...(owner ? {name:'Business',domains:null,monitors:null} : {}), advancedDashboard: definition.advancedDashboard, multiProbe: definition.multiProbe };
}

export async function backfillDomains(env: Env, userId: string) {
  // Preserve existing monitors and history. Quota reductions never delete customer data.
  const legacy = await env.DB.prepare('SELECT id,url FROM monitors WHERE user_id=? AND root_domain IS NULL').bind(userId).all<{ id: string; url: string }>();
  if (!legacy.results.length) return;
  await env.DB.batch(legacy.results.map(row => {
    let domain: string;
    try { domain = registeredDomain(row.url); } catch { domain = new URL(row.url).hostname; }
    return env.DB.prepare('UPDATE monitors SET root_domain=? WHERE id=? AND root_domain IS NULL').bind(domain, row.id);
  }));
}
