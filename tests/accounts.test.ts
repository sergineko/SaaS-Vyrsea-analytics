import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { authenticator } from './webauthn';
import { ACTIVITY_WRITE_SECONDS, INACTIVITY_CUTOFF, INACTIVITY_SECONDS } from '../worker/account-policy';
import type { AccountUser, OwnerAccountsData } from '../shared/accounts';

let mf: Miniflare, db: D1Database, targetCalls = 0, gate: Promise<void> | undefined, release: (() => void) | undefined;
const origin = 'http://localhost:5173', now = () => Math.floor(Date.now() / 1000);
const token = (id: string) => `pulso_session=accounts-${id}`;
async function api(path: string, method = 'GET', body?: unknown, cookie = token('owner')) {
  return mf.dispatchFetch(`${origin}/api${path}`, { method, headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }) });
}
async function test(path: string, body: unknown) { return mf.dispatchFetch(`${origin}/__test/${path}`, { method: 'POST', body: JSON.stringify(body) }); }
async function user(id = 'free') { return db.prepare('SELECT * FROM users WHERE id=?').bind(id).first<Record<string, string | number | null>>(); }
async function count(table: string) { return (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{n: number}>())!.n; }
async function monitor(userId = 'free', id = 'monitor', paused = 0) {
  await db.prepare('INSERT INTO monitors(id,user_id,name,url,root_domain,next_check_at,created_at,paused) VALUES(?,?,?,?,?,0,?,?)')
    .bind(id, userId, id, `https://${id}.example.com/`, 'example.com', now(), paused).run();
}
function sessionCookie(response: {headers: {get: (name: string) => string | null}}) { return response.headers.get('set-cookie')!.match(/pulso_(?:session|challenge)=[^;,\s]+/g)!.at(-1)!; }
async function register() {
  const key = authenticator();
  const options = await api('/auth/register/options', 'POST', { username: 'new-user' }, '');
  const { challenge } = await options.json() as {challenge: string};
  const result = await api('/auth/register/verify', 'POST', key.register(challenge), sessionCookie(options));
  expect(result.status).toBe(201);
  const cookie = sessionCookie(result);
  const { user } = await (await api('/me', 'GET', undefined, cookie)).json() as {user: AccountUser};
  return { key, cookie, user };
}

beforeAll(async () => {
  await build({ entryPoints: ['tests/worker-harness.ts'], bundle: true, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:*'], outfile: '.test-build/accounts-worker.mjs', logLevel: 'silent' });
  mf = new Miniflare({cachePersist:`.test-build/ac-${process.pid}`, modules: true, scriptPath: '.test-build/accounts-worker.mjs', compatibilityDate: '2026-07-01', compatibilityFlags: ['nodejs_compat'],
    bindings: { APP_ORIGIN: origin }, d1Databases: { DB: 'accounts-db' }, queueProducers: { CHECK_QUEUE: 'account-checks' },
    outboundService: async (request: {url: string}) => {
      if (request.url.includes('cloudflare-dns.com')) return Response.json({ Status: 0, Answer: [{ type: 1, data: '1.1.1.1' }] });
      targetCalls++; if (gate) await gate; return new Response('Fixture', {status: 503});
    },
  });
  db = await mf.getD1Database('DB') as unknown as D1Database;
  for (const file of readdirSync('migrations').filter(file => file.endsWith('.sql')).sort()) await db.batch(readFileSync(`migrations/${file}`, 'utf8').split(/\n(?=CREATE |PRAGMA |ALTER |DROP |INSERT |UPDATE )/).map(sql => db.prepare(sql.trim())));
});
beforeEach(async () => {
  targetCalls = 0; gate = undefined; release = undefined;
  await db.batch([db.prepare('DELETE FROM users'), db.prepare('DELETE FROM challenges'), db.prepare('DELETE FROM rate_limits')]);
  for (const [id, plan, status, isOwner] of [['owner','business','active',1], ['free','free','active',0], ['pending','free','pending',0], ['suspended','free','suspended',0], ['starter','starter','active',0], ['pro','pro','active',0]] as const) {
    await db.prepare('INSERT INTO users(id,username,created_at,plan_id,account_status,is_owner,last_active_at,domain_limit,monitor_limit,history_days_limit) VALUES(?,?,?,?,?,?,?,2,2,90)')
      .bind(id, id, now(), plan, status, isOwner, now()).run();
    await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(createHash('sha256').update(`accounts-${id}`).digest('base64'), id, now() + 3600).run();
  }
});
afterAll(async () => { release?.(); await mf?.dispose(); });

describe.sequential('Owner approval and inactive Free accounts on actual Worker/D1', () => {
  it('exempts only the owner from domain, monitor and trial quotas', async () => {
    for(let i=0;i<12;i++)await db.prepare("INSERT INTO monitors(id,user_id,name,url,root_domain,next_check_at,created_at) VALUES(?,'owner',?,?,?,0,?)")
      .bind(`owned-${i}`,`Service ${i}`,`https://domain${i}.com/`,`domain${i}.com`,now()).run();
    const ownerData=await (await api('/dashboard')).json() as {limits:{domains:number|null;monitors:number|null;advancedDashboard:boolean;id:string}};
    expect(ownerData.limits).toMatchObject({domains:null,monitors:null,advancedDashboard:true,id:'business'});
    await monitor('free','customer-one');await monitor('free','customer-two');
    await expect(monitor('free','customer-three')).rejects.toThrow(/MONITOR_CAPACITY/);
    expect((await (await api('/owner/accounts')).json() as OwnerAccountsData).usage.monitors).toBe(2);
  });
  it('lets the owner configure Business, preserve approval and enforce the custom limits', async () => {
    const input={planId:'business',domainLimit:2,monitorLimit:3,historyDaysLimit:45};
    expect((await api('/owner/accounts/free/plan','PATCH',input,token('free'))).status).toBe(403);
    expect((await api('/owner/accounts/free/plan','PATCH',{...input,isOwner:1})).status).toBe(400);
    expect((await api('/owner/accounts/free/plan','PATCH',{planId:'business'})).status).toBe(400);
    expect((await api('/owner/accounts/owner/plan','PATCH',input)).status).toBe(409);
    expect((await api('/owner/accounts/free/plan','PATCH',input)).status).toBe(200);
    expect(await user()).toMatchObject({plan_id:'business',is_owner:0,account_status:'active',domain_limit:2,monitor_limit:3,history_days_limit:45});
    const paid=await (await api('/dashboard','GET',undefined,token('free'))).json() as {limits:unknown};
    expect(paid.limits).toMatchObject({domains:2,monitors:3,historyDays:45,intervalSeconds:60});
    for(let i=0;i<3;i++)await monitor('free',`custom-${i}`);
    await expect(monitor('free','custom-four')).rejects.toThrow(/MONITOR_CAPACITY/);
    expect((await api('/owner/accounts/free/plan','PATCH',{planId:'free'})).status).toBe(200);
    expect(await count('monitors')).toBe(3);
    expect((await user())!.is_owner).toBe(0);
    await expect(monitor('free','another')).rejects.toThrow(/MONITOR_CAPACITY/);
  });
  it('projects cadence costs without counting paused or suspended monitoring', async () => {
    await monitor('owner','paid'); await monitor('free','live'); await monitor('free','paused',1);
    const before=await (await api('/owner/accounts')).json() as OwnerAccountsData;
    expect(before.capacity).toMatchObject({checksPerDay:1536,queueOperationsMin:4320,queueOperationsMax:4608});
    expect((await api('/owner/accounts/free/suspend','POST')).status).toBe(200);
    const after=await (await api('/owner/accounts')).json() as OwnerAccountsData;
    expect(after.capacity).toMatchObject({checksPerDay:1440,queueOperationsMin:4320,queueOperationsMax:4320});
  });
  it('registers a passkey as pending with no owner or paid privileges', async () => {
    const registered = await register();
    expect(registered.user).toMatchObject({accountStatus: 'pending', isOwner: false, planId: 'free'});
    expect((await api('/dashboard', 'GET', undefined, registered.cookie)).status).toBe(403);
    expect((await (await api('/config')).json() as {registrationMode: string}).registrationMode).toBe('approval');
  });
  it('blocks pending and suspended users from every workspace write and read', async () => {
    for (const id of ['pending', 'suspended']) for (const [path, method, body] of [
      ['/dashboard', 'GET'], ['/monitors', 'POST', {name:'Web',url:'https://example.com'}], ['/monitors/monitor', 'PATCH', {paused:false}],
      ['/monitors/monitor/check', 'POST'], ['/monitors/monitor/history', 'GET'], ['/notifications/read', 'POST'], ['/account/activity', 'POST'],
    ] as const) expect((await api(path, method, body, token(id))).status).toBe(403);
    await expect(monitor('pending')).rejects.toThrow(/ACCOUNT_INACTIVE/);
    expect(await count('monitors')).toBe(0);
  });
  it('keeps approval private, enforces CSRF and rejects privilege/plan injection', async () => {
    expect((await api('/owner/accounts', 'GET', undefined, '')).status).toBe(401);
    for (const id of ['free','pending','pro']) expect((await api('/owner/accounts', 'GET', undefined, token(id))).status).toBe(403);
    expect((await api('/owner/accounts/pending/approve', 'POST', {isOwner:true,planId:'business'})).status).toBe(400);
    expect((await mf.dispatchFetch(`${origin}/api/owner/accounts/pending/approve`, {method:'POST',headers:{Cookie:token('owner'),Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'})).status).toBe(403);
    expect((await user('pending'))!.account_status).toBe('pending');
  });
  it('lets only the owner approve a Free account and exposes bounded usage', async () => {
    expect((await api('/owner/accounts/pending/approve', 'POST')).status).toBe(200);
    expect((await user('pending'))).toMatchObject({account_status:'active',is_owner:0,plan_id:'free'});
    expect((await api('/monitors', 'POST', {name:'Web',url:'https://example.com'}, token('pending'))).status).toBe(201);
    const data = await (await api('/owner/accounts')).json() as OwnerAccountsData;
    expect(data.usage).toMatchObject({monitors:1,monitorLimit:10,accountLimit:100});
    expect(data.accounts.find(account => account.id === 'pending')!.monitors).toBe(1);
    expect((await api('/owner/accounts/pending/approve', 'POST')).status).toBe(409);
  });
  it('protects owner accounts and cannot assign a new owner through public endpoints', async () => {
    expect((await api('/owner/accounts/owner/suspend', 'POST')).status).toBe(409);
    expect((await api('/owner/accounts/owner/approve', 'POST')).status).toBe(409);
    expect((await api('/account/owner', 'POST', {isOwner:true}, token('free'))).status).toBe(404);
    expect((await user('owner'))).toMatchObject({is_owner:1,account_status:'active'});
  });
  it('does not treat panel polling, session checks or agent reads as activity', async () => {
    const last = now() - 2 * 86400; await db.prepare("UPDATE users SET last_active_at=? WHERE id='free'").bind(last).run();
    for (const path of ['/me','/dashboard','/dashboard?days=7']) expect((await api(path, 'GET', undefined, token('free'))).status).toBe(200);
    expect((await user())!.last_active_at).toBe(last);
  });
  it('coalesces genuine activity writes to once per hour', async () => {
    const last = now() - 7200; await db.prepare("UPDATE users SET last_active_at=? WHERE id='free'").bind(last).run();
    expect((await api('/account/activity', 'POST', {}, token('free'))).status).toBe(200);
    const updated = (await user())!.last_active_at as number; expect(updated).toBeGreaterThan(last);
    for (let index = 0; index < 3; index++) await api('/account/activity', 'POST', {}, token('free'));
    expect((await user())!.last_active_at).toBe(updated);
  });
  it('suspends only Free non-owner accounts after 14 full days with hourly-write grace', async () => {
    const stamp = now(), expired = stamp - INACTIVITY_CUTOFF - 1;
    await db.prepare("UPDATE users SET last_active_at=? WHERE id IN ('free','starter','pro','owner')").bind(expired).run();
    await test('cleanup', {timestamp:stamp});
    expect((await user())).toMatchObject({account_status:'suspended',suspension_reason:'inactivity',last_active_at:expired});
    for (const id of ['starter','pro','owner']) expect((await user(id))!.account_status).toBe('active');
    expect((await user('pending'))!.account_status).toBe('pending');
  });
  it('does not suspend at exactly the deadline or before 14 days of real use', async () => {
    const stamp = now();
    for (const age of [INACTIVITY_SECONDS, INACTIVITY_CUTOFF]) {
      await db.prepare("UPDATE users SET last_active_at=? WHERE id='free'").bind(stamp-age).run();
      await test('cleanup', {timestamp:stamp}); expect((await user())!.account_status).toBe('active');
    }
    expect(INACTIVITY_CUTOFF - INACTIVITY_SECONDS).toBe(ACTIVITY_WRITE_SECONDS);
  });
  it('refuses a late activity ping and suspends on access before the daily cleanup', async () => {
    const last = now() - INACTIVITY_CUTOFF - 60; await db.prepare("UPDATE users SET last_active_at=? WHERE id='free'").bind(last).run();
    const response = await api('/account/activity', 'POST', {}, token('free')); expect(response.status).toBe(403);
    expect((await user())).toMatchObject({last_active_at:last,account_status:'suspended'});
    expect((await (await api('/me', 'GET', undefined, token('free'))).json() as {user: AccountUser}).user.accountStatus).toBe('suspended');
  });
  it('excludes inactive users from Cron reservations without waiting for cleanup', async () => {
    await monitor(); await db.prepare("UPDATE users SET last_active_at=? WHERE id='free'").bind(now()-INACTIVITY_CUTOFF-60).run();
    await test('schedule', {timestamp:now()}); expect(await count('check_jobs')).toBe(0); expect(targetCalls).toBe(0);
    expect((await (await test('reserve', {monitorId:'monitor',timestamp:now()})).json() as {reserved:boolean}).reserved).toBe(false);
  });
  it('discards stale queued work and preserves monitors and their manual pause', async () => {
    await monitor(); await monitor('free','paused',1); const slot = Math.floor(now()/60)*60;
    await test('reserve', {monitorId:'monitor',timestamp:now()}); expect(await count('check_jobs')).toBe(1);
    expect((await api('/owner/accounts/free/suspend', 'POST')).status).toBe(200);
    await test('consume', {jobs:[{monitorId:'monitor',slot}]});
    expect(targetCalls).toBe(0); expect(await count('checks')).toBe(0); expect(await count('check_jobs')).toBe(0);
    expect(await count('monitors')).toBe(2); expect((await db.prepare("SELECT paused FROM monitors WHERE id='paused'").first<{paused:number}>())!.paused).toBe(1);
  });
  it('suppresses an in-flight result even when the owner reactivates before completion', async () => {
    await monitor(); gate = new Promise(resolve => {release=resolve;}); const slot = Math.floor(now()/60)*60;
    const running = test('consume', {jobs:[{monitorId:'monitor',slot}]});
    try {
      await expect.poll(() => targetCalls).toBe(1);
      expect((await api('/owner/accounts/free/suspend', 'POST')).status).toBe(200);
      expect((await api('/owner/accounts/free/approve', 'POST')).status).toBe(200);
    } finally { release?.(); }
    expect((await running).status).toBe(200);
    for (const table of ['checks','hourly_stats','incidents','notifications']) expect(await count(table)).toBe(0);
    expect((await user())!.monitoring_since).toBeGreaterThan(slot);
  });
  it('requires owner review for reactivation and never revives through login', async () => {
    const registered = await register(); await api(`/owner/accounts/${registered.user.id}/approve`, 'POST');
    const last = now()-INACTIVITY_CUTOFF-60; await db.prepare('UPDATE users SET last_active_at=? WHERE id=?').bind(last,registered.user.id).run();
    const options = await api('/auth/login/options', 'POST', {}, ''); const {challenge} = await options.json() as {challenge:string};
    const login = await api('/auth/login/verify', 'POST', registered.key.login(challenge), sessionCookie(options)); expect(login.status).toBe(200);
    expect((await user(registered.user.id))).toMatchObject({account_status:'suspended',last_active_at:last});
    const cookie = sessionCookie(login); expect((await api('/account/review', 'POST', {}, cookie)).status).toBe(200);
    const requested = (await user(registered.user.id))!.review_requested_at; expect(requested).toBeTruthy();
    await api('/account/review', 'POST', {}, cookie); expect((await user(registered.user.id))!.review_requested_at).toBe(requested);
    expect((await api('/dashboard', 'GET', undefined, cookie)).status).toBe(403);
    await api(`/owner/accounts/${registered.user.id}/approve`, 'POST');
    expect((await user(registered.user.id))).toMatchObject({account_status:'active',review_requested_at:null,suspension_reason:null});
    expect((await api('/dashboard', 'GET', undefined, cookie)).status).toBe(200);
  });
  it('rejects oversized or malformed Queue batches before any external requests', async () => {
    for (const jobs of [[], [{monitorId:'monitor',slot:'0'}], Array.from({length:5},(_,i)=>({monitorId:`monitor-${i}`,slot:now()})), [{monitorId:'monitor',slot:now()},{monitorId:'monitor',slot:now()}]]) {
      expect((await test('consume', {jobs})).status).toBe(500);
    }
    expect(targetCalls).toBe(0);
  });
  it('processes three jobs in one message and ignores a replay without extra probes', async () => {
    await monitor(); await monitor('free', 'second'); await monitor('starter', 'third');
    const jobs = ['monitor', 'second', 'third'].map(monitorId => ({monitorId, slot: Math.floor(now()/60)*60}));
    expect((await test('consume', {jobs})).status).toBe(200);
    expect(targetCalls).toBe(3); expect(await count('checks')).toBe(3); expect(await count('hourly_stats')).toBe(3);
    expect((await test('consume', {jobs})).status).toBe(200);
    expect(targetCalls).toBe(3); expect(await count('checks')).toBe(3); expect(await count('incidents')).toBe(0);
  });
  it('runs daily suspension from the single minute Cron at 03:17 UTC', async () => {
    await db.prepare("UPDATE users SET last_active_at=? WHERE id='free'").bind(now()-INACTIVITY_CUTOFF-60).run();
    const worker = await mf.getWorker();
    await worker.scheduled({cron:'* * * * *',scheduledTime:new Date(Date.UTC(2026,9,22,3,16))});
    expect((await user())!.account_status).toBe('active');
    await worker.scheduled({cron:'* * * * *',scheduledTime:new Date(Date.UTC(2026,9,22,3,17))});
    expect((await user())!.account_status).toBe('suspended');
  });
});
