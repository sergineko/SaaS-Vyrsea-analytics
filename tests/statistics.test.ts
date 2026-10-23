import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {Miniflare} from 'miniflare';
import {build} from 'esbuild';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import type {Statistic} from '../worker/statistics';
let mf:Miniflare,db:D1Database,id:string;const origin='http://localhost:5173',now=()=>Math.floor(Date.now()/1000);
type Measurement={status:number;reads:number;writes:number;queries:number;body:{stats:Statistic[];last24:Statistic[];historyAsOf:number}};
const metrics=(path:string,token='owner')=>mf.dispatchFetch(origin+'/__test/query-metrics',{method:'POST',headers:{Cookie:'pulso_session='+token},body:JSON.stringify({path})}).then(r=>r.json() as Promise<Measurement>);
const total=(rows:Statistic[])=>rows.reduce((n,row)=>n+row.total,0);
beforeAll(async()=>{
 await build({entryPoints:['tests/worker-harness.ts'],bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*'],outfile:'.test-build/statistics-worker.mjs',logLevel:'silent'});
 mf=new Miniflare({cachePersist:`.test-build/s-${process.pid}`,modules:true,scriptPath:'.test-build/statistics-worker.mjs',compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],bindings:{APP_ORIGIN:origin},d1Databases:{DB:'statistics-db'},queueProducers:{CHECK_QUEUE:'statistics-checks'}});db=await mf.getD1Database('DB') as unknown as D1Database;
 for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())await db.batch(readFileSync('migrations/'+file,'utf8').split(/\n(?=CREATE |PRAGMA |ALTER |DROP |INSERT |UPDATE )/).map(s=>db.prepare(s.trim())));
});
beforeEach(async()=>{
 await db.prepare('DELETE FROM users').run();id=randomUUID();
 for(const user of ['owner','other']){await db.prepare("INSERT INTO users(id,username,created_at,plan_id,account_status,is_owner,last_active_at,history_days_limit) VALUES(?,?,?,'business','active',1,?,90)").bind(user,user,now(),now()).run();await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(createHash('sha256').update(user).digest('base64'),user,now()+3600).run();}
 await db.prepare("INSERT INTO monitors(id,user_id,name,url,root_domain,next_check_at,created_at) VALUES(?,'owner','Test','https://example.com/','example.com',0,?)").bind(id,now()).run();
 const hour=Math.floor(now()/3600)*3600;await db.prepare('WITH RECURSIVE n(x) AS(VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<999) INSERT INTO hourly_stats(monitor_id,hour,total,successful,total_ms) SELECT ?,?-x*3600,10,9,200 FROM n').bind(id,hour).run();
});
afterAll(async()=>{await mf?.dispose();});
describe.sequential('Bounded historical queries and private summary caching',()=>{
 it('reuses closed hours without caching the current hour or writing D1',async()=>{
  const cold=await metrics('/api/dashboard?days=90'),warm=await metrics('/api/dashboard?days=90');expect(cold.status).toBe(200);expect(total(cold.body.stats)).toBe(10000);expect(warm.body.stats).toEqual(cold.body.stats);expect(warm.reads).toBeLessThan(40);expect(warm.reads).toBeLessThan(cold.reads/50);expect(warm.writes).toBe(0);
  await db.prepare('UPDATE hourly_stats SET total=total+2,successful=successful+1,total_ms=total_ms+70 WHERE monitor_id=? AND hour=?').bind(id,Math.floor(now()/3600)*3600).run();
  const updated=await metrics('/api/dashboard?days=90');expect(total(updated.body.stats)).toBe(10002);expect(updated.body.historyAsOf).toBe(warm.body.historyAsOf);
 });
 it('checks sessions, accounts, ownership and plans again even with a warm cache',async()=>{
  await metrics('/api/dashboard?days=90');expect((await metrics('/api/dashboard?days=90','invalid')).status).toBe(401);
  const other=await metrics('/api/dashboard?days=90','other');expect(other.body.stats).toEqual([]);
  await db.prepare("UPDATE users SET account_status='suspended' WHERE id='owner'").run();expect((await metrics('/api/dashboard?days=90')).status).toBe(403);
  await db.prepare("UPDATE users SET account_status='active',is_owner=0,plan_id='free' WHERE id='owner'").run();expect((await metrics('/api/dashboard?days=90')).status).toBe(403);const free=await metrics('/api/dashboard?days=7');expect(free.status).toBe(200);expect(total(free.body.stats)).toBe(1680);
 });
 it('does not resurrect deleted monitors from a cached historical summary',async()=>{
  await metrics('/api/dashboard?days=90');await db.prepare('DELETE FROM monitors WHERE id=?').bind(id).run();expect((await metrics('/api/dashboard?days=90')).body.stats).toEqual([]);
 });
 it('reads only the requested custom interval and last 24h, without reading the gap',async()=>{
  const hour=Math.floor(now()/3600)*3600,from=hour-35*86400,to=hour-34*86400;
  const result=await metrics(`/api/monitors/${id}/availability?from=${from}&to=${to}`);expect(result.status).toBe(200);expect(result.body.stats).toHaveLength(24);expect(result.body.last24).toHaveLength(24);expect(result.reads).toBeLessThanOrEqual(60);expect(total(result.body.stats)).toBe(240);
  const overlap=await metrics(`/api/monitors/${id}/availability?from=${hour-12*3600}&to=${hour}`);expect(overlap.body.stats).toHaveLength(12);expect(overlap.body.last24).toHaveLength(24);
 });
 it('refreshes cached closed hours after five minutes and rebuilds the key at an hour boundary',async()=>{
  const hour=Math.floor(now()/3600)*3600,timestamp=hour+100,since=hour-23*3600;
  async function summary(time:number,start=since){return (await mf.dispatchFetch(origin+'/__test/statistics',{method:'POST',body:JSON.stringify({userId:'owner',ids:[id],since:start,days:1,timestamp:time})})).json() as Promise<Measurement>;}
  const cold=await summary(timestamp);await db.prepare('UPDATE hourly_stats SET total=total+4 WHERE monitor_id=? AND hour=?').bind(id,hour-3600).run();
  expect(total((await summary(timestamp+299)).body.stats)).toBe(total(cold.body.stats));
  const refreshed=await summary(timestamp+300);expect(total(refreshed.body.stats)).toBe(total(cold.body.stats)+4);expect(refreshed.body.historyAsOf).toBe(timestamp+300);
  const next=await summary(hour+3601,since+3600);expect(next.body.historyAsOf).toBe(hour+3601);expect(total(next.body.stats)).toBe(total(refreshed.body.stats)-10);
 });
});
