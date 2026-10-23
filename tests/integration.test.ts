import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';
import { authenticator } from './webauthn';
import type { DashboardData } from '../src/types';
import type { ProbeResult } from '../worker/probe';

let mf: Miniflare;
let db: D1Database;
const origin = 'http://localhost:5173';
let cookie = '';
let targetStatus = 200;
const key = authenticator();
async function api(path: string, method = 'GET', body?: unknown, cookies = cookie, source = origin) {
  const response = await mf.dispatchFetch(`${origin}/api${path}`, { method, headers: { Cookie: cookies, Origin: source, 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }) });
  return response;
}
function sessionCookie(response: { headers: { get: (name: string) => string | null } }) {
  const value = response.headers.get('set-cookie')!;
  return value.match(/(?:__Host-)?pulso_session=[^;,\s]+/)?.[0] ?? value.split(';')[0];
}
async function dashboard() { return await (await api('/dashboard')).json() as DashboardData; }

beforeAll(async () => {
  await build({ entryPoints: ['tests/worker-harness.ts'], bundle: true, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:*'], outfile: '.test-build/worker.mjs', logLevel: 'silent' });
  mf = new Miniflare({cachePersist:`.test-build/in-${process.pid}`, modules: true, scriptPath: '.test-build/worker.mjs', compatibilityDate: '2026-07-01', compatibilityFlags: ['nodejs_compat'],
    bindings: { APP_ORIGIN: origin }, d1Databases: { DB: 'test-db' }, queueProducers: { CHECK_QUEUE: 'test-checks' },
    queueConsumers: { 'test-checks': { maxBatchSize: 1, maxBatchTimeout: 0.01 } },
    outboundService: async (request: { url: string }) => {
      if (request.url.includes('cloudflare-dns.com')) return Response.json({ Status: 0, Answer: [{ type: 1, data: '1.1.1.1' }] });
      return new Response('Test website', { status: targetStatus });
    },
  });
  db = await mf.getD1Database('DB') as unknown as D1Database;
  for (const file of readdirSync('migrations').filter(name => name.endsWith('.sql')).sort()) {
    const migration = readFileSync(`migrations/${file}`, 'utf8');
    const statements = migration.split(/\n(?=CREATE |PRAGMA |ALTER |DROP |INSERT |UPDATE )/);
    await db.batch(statements.map(sql => db.prepare(sql.trim())));
  }
});
afterAll(async () => { await mf?.dispose(); });

describe.sequential('MVP on the actual Workers runtime and SQLite D1', () => {
  it('serves health, rejects unauthenticated access and cross-origin writes', async () => {
    expect((await api('/health')).status).toBe(200);
    expect((await api('/dashboard')).status).toBe(401);
    expect((await api('/auth/login/options', 'POST', {}, '', 'https://evil.example.com')).status).toBe(403);
  });
  it('registers a real ES256 passkey and creates a hashed secure session', async () => {
    const options = await api('/auth/register/options', 'POST', { username: 'sergio' });
    expect(options.status).toBe(200);
    const body = await options.json() as { challenge: string };
    const verification = await api('/auth/register/verify', 'POST', key.register(body.challenge), sessionCookie(options));
    expect(await verification.clone().json()).toEqual({ ok: true });
    expect(verification.status).toBe(201);
    cookie = sessionCookie(verification);
    expect(verification.headers.get('set-cookie')).toContain('HttpOnly');
    expect(verification.headers.get('set-cookie')).toContain('SameSite=Strict');
    expect((await api('/dashboard')).status).toBe(403);
    const pending = await db.prepare("SELECT id,account_status FROM users WHERE username='sergio'").first<{id:string;account_status:string}>();
    expect(pending!.account_status).toBe('pending');
    // Trusted owner approval fixture; the actual approval API is covered in accounts.test.ts.
    await db.prepare("UPDATE users SET account_status='active' WHERE id=?").bind(pending!.id).run();
    expect((await dashboard()).user.username).toBe('sergio');
    const session = await db.prepare('SELECT token_hash FROM sessions').first<{ token_hash: string }>();
    expect(session!.token_hash).not.toBe(cookie.split('=')[1]);
    expect((await api('/auth/register/verify', 'POST', key.register(body.challenge), sessionCookie(options))).status).toBe(400);
  });
  it('logs out, signs a passkey assertion, logs back in, and rejects replay', async () => {
    expect((await api('/auth/logout', 'POST')).status).toBe(200);
    expect((await api('/dashboard')).status).toBe(401);
    const options = await api('/auth/login/options', 'POST');
    const { challenge } = await options.json() as { challenge: string };
    const signed = key.login(challenge);
    const verified = await api('/auth/login/verify', 'POST', signed, sessionCookie(options));
    expect(await verified.clone().json()).toEqual({ ok: true });
    cookie = sessionCookie(verified);
    expect((await api('/auth/login/verify', 'POST', signed, sessionCookie(options))).status).toBe(400);
  });
  it('creates real monitors, blocks internal URLs, and enforces capacity atomically', async () => {
    expect((await api('/monitors', 'POST', { name: 'Internal', url: 'http://127.0.0.1' })).status).toBe(400);
    expect((await api('/monitors', 'POST', { name: 'Web', url: 'https://www.example.com' })).status).toBe(201);
    const different = await api('/monitors', 'POST', { name: 'Other domain', url: 'https://example.org' });
    expect(different.status).toBe(409);
    expect(JSON.stringify(await different.json())).toContain('dominio');
    expect((await api('/monitors', 'POST', { name: 'Tienda', url: 'https://shop.example.com' })).status).toBe(201);
    const full = await api('/monitors', 'POST', { name: 'Third', url: 'https://api.example.com' });
    expect(full.status).toBe(409);
    expect((await dashboard()).monitors).toHaveLength(2);
    expect((await dashboard()).limits).toMatchObject({ id: 'free', domains: 1, monitors: 2 });
    expect((await dashboard()).monitors.every(m => m.rootDomain === 'example.com')).toBe(true);
  });
  it('keeps each account isolated', async () => {
    const id = (await dashboard()).monitors[0].id;
    await db.prepare("INSERT INTO users(id,username,created_at,account_status,last_active_at) VALUES('other','other',1,'active',unixepoch())").run();
    const raw = 'other-test-session';
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(raw).digest('base64');
    await db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,'other',?)").bind(hash, Math.floor(Date.now()/1000)+600).run();
    const other = `pulso_session=${raw}`;
    expect((await api(`/monitors/${id}`, 'DELETE', {}, other)).status).toBe(404);
    expect((await api(`/monitors/${id}/history`, 'GET', undefined, other)).status).toBe(404);
    expect(((await (await api('/dashboard', 'GET', undefined, other)).json()) as DashboardData).monitors).toHaveLength(0);
  });
  it('runs Cron → durable outbox → real Queue → probe → D1', async () => {
    const worker = await mf.getWorker();
    await worker.scheduled({ cron: '* * * * *' });
    await expect.poll(async () => (await dashboard()).monitors.filter(m => m.status === 'up').length, { timeout: 10000 }).toBe(2);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM check_jobs').first<{ n: number }>())!.n).toBe(0);
    expect((await dashboard()).stats.reduce((n, s) => n + s.total, 0)).toBe(2);
  });
  it('confirms on two failures, records recovery, and ignores duplicate/out-of-order results', async () => {
    const monitor = (await dashboard()).monitors[0];
    const job = { monitorId: monitor.id, slot: Math.floor(Date.now()/1000/300)*300 + 300 };
    const fail: ProbeResult = { ok: false, statusCode: 503, responseMs: 23, error: 'HTTP 503' };
    const record = async (slot: number, result: ProbeResult = fail) => mf.dispatchFetch('http://localhost/__test/result', { method: 'POST', body: JSON.stringify({ job: { ...job, slot }, result }) });
    await record(job.slot);
    expect((await dashboard()).monitors[0].status).toBe('degraded');
    expect((await dashboard()).incidents).toHaveLength(0);
    await record(job.slot + 300);
    expect((await dashboard()).monitors[0].status).toBe('down');
    expect((await dashboard()).incidents).toHaveLength(1);
    expect((await dashboard()).notifications).toHaveLength(1);
    const before = (await dashboard()).stats.reduce((n, s) => n + s.total, 0);
    await record(job.slot + 300); await record(job.slot);
    expect((await dashboard()).stats.reduce((n, s) => n + s.total, 0)).toBe(before);
    await record(job.slot + 600, { ok: true, statusCode: 200, responseMs: 10, error: null });
    expect((await dashboard()).monitors[0].status).toBe('up');
    expect((await dashboard()).incidents[0].resolvedAt).not.toBeNull();
    expect((await dashboard()).notifications).toHaveLength(2);
  });
  it('pauses and renames monitors and suppresses results while paused', async () => {
    const monitor = (await dashboard()).monitors[0];
    expect((await api(`/monitors/${monitor.id}`, 'PATCH', { name: 'Mi web', paused: true })).status).toBe(200);
    expect((await api(`/monitors/${monitor.id}/check`, 'POST')).status).toBe(400);
    const before = (await dashboard()).stats.reduce((n, s) => n + s.total, 0);
    await mf.dispatchFetch('http://localhost/__test/result', { method: 'POST', body: JSON.stringify({ job: { monitorId: monitor.id, slot: Math.floor(Date.now()/1000)+2000 }, result: { ok: false, statusCode: 500, responseMs: 1, error: 'HTTP 500' } }) });
    expect((await dashboard()).stats.reduce((n, s) => n + s.total, 0)).toBe(before);
    expect((await dashboard()).monitors[0].name).toBe('Mi web');
  });
  it('marks alerts as read and cascades monitor deletion', async () => {
    expect((await api('/notifications/read', 'POST')).status).toBe(200);
    expect((await dashboard()).notifications.every(n => n.readAt)).toBe(true);
    const monitor = (await dashboard()).monitors[0];
    expect((await api(`/monitors/${monitor.id}`, 'DELETE')).status).toBe(200);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM checks WHERE monitor_id=?').bind(monitor.id).first<{ n: number }>())!.n).toBe(0);
    expect((await dashboard()).incidents).toHaveLength(0);
  });
  it('recovers a reserved check after a failed Queue send without losing the job', async () => {
    const monitor = (await dashboard()).monitors[0];
    const timestamp = Math.floor(Date.now()/1000) + 300;
    const before = (await dashboard()).stats.reduce((n, s) => n + s.total, 0);
    await db.prepare('UPDATE monitors SET next_check_at=0 WHERE id=?').bind(monitor.id).run();
    const failed = await mf.dispatchFetch('http://localhost/__test/dispatch-failure', { method: 'POST', body: JSON.stringify({ monitorId: monitor.id, timestamp }) });
    expect(failed.status).toBe(503);
    const pending = await db.prepare('SELECT dispatched_at FROM check_jobs WHERE monitor_id=?').bind(monitor.id).first<{ dispatched_at: number | null }>();
    expect(pending).not.toBeNull(); expect(pending!.dispatched_at).toBeNull();
    const worker = await mf.getWorker();
    await worker.scheduled({ cron: '* * * * *' });
    await expect.poll(async () => (await db.prepare('SELECT COUNT(*) AS n FROM check_jobs').first<{ n: number }>())!.n).toBe(0);
    expect((await dashboard()).stats.reduce((n, s) => n + s.total, 0)).toBe(before + 1);
  });
  it('rejects forged passkey signatures without issuing a session', async () => {
    const options = await api('/auth/login/options', 'POST');
    const { challenge } = await options.json() as { challenge: string };
    const signed = key.login(challenge);
    signed.response.signature = 'AAAA';
    const result = await api('/auth/login/verify', 'POST', signed, sessionCookie(options));
    expect(result.status).toBe(400);
    expect(result.headers.get('set-cookie')).not.toContain('pulso_session=');
  });
  it('does not let a client select its plan or forge the counted domain', async () => {
    expect((await api('/monitors','POST',{name:'Spoof',url:'https://evil.com',rootDomain:'example.com',planId:'agency'})).status).toBe(400);
    expect((await api('/account/plan','POST',{planId:'agency'})).status).toBe(404);
    expect((await dashboard()).limits.id).toBe('free');
  });
  it('enforces the two-monitor quota for concurrent inserts and rejects duplicate URLs', async () => {
    await db.prepare("INSERT INTO users(id,username,created_at,account_status,last_active_at) VALUES('race','race',1,'active',unixepoch())").run();
    const insert=(i:number)=>db.prepare('INSERT INTO monitors(id,user_id,name,url,root_domain,next_check_at,created_at) VALUES(?,?,?,?,?,0,1)')
      .bind(`race-${i}`,'race','Race',`https://s${i}.negocio.es/`,'negocio.es').run();
    const results=await Promise.allSettled([insert(1),insert(2),insert(3)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(2);
    const duplicate=await Promise.allSettled([db.prepare("INSERT INTO monitors(id,user_id,name,url,root_domain,next_check_at,created_at) VALUES('dup','race','Dup','https://s1.negocio.es/','negocio.es',0,1)").run()]);
    expect(duplicate[0].status).toBe('rejected');
  });
  it('reads independent domain and monitor limits from the server-side plan', async () => {
    await db.prepare("INSERT INTO users(id,username,created_at,plan_id,account_status,last_active_at) VALUES('plan-fixture','plan-fixture',1,'pro','active',unixepoch())").run();
    for(const [i,domain] of ['uno.es','dos.co.uk'].entries()) await db.prepare('INSERT INTO monitors(id,user_id,name,url,root_domain,next_check_at,created_at) VALUES(?,?,?,?,?,0,1)')
      .bind(`plan-${i}`,'plan-fixture','Plan fixture',`https://${domain}/`,domain).run();
    // A trusted fixture can assign a proposed plan; the public API cannot.
    const row=await db.prepare("SELECT COUNT(DISTINCT root_domain) AS n FROM monitors WHERE user_id='plan-fixture'").first<{n:number}>();
    expect(row!.n).toBe(2);
    expect((await (await api('/plans')).json() as {plans:{id:string;available:boolean}[]}).plans.filter(p=>p.available).map(p=>p.id)).toEqual(['free']);
  });
});
