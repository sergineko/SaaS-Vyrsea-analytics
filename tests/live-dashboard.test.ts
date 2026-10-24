import {afterAll,beforeAll,beforeEach,describe,it,expect} from 'vitest';
import {Miniflare} from 'miniflare';
import {build} from 'esbuild';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {mergeLiveDashboard} from '../shared/live-dashboard';
import type {DashboardData,DashboardLive} from '../src/types';
let mf:Miniflare,db:D1Database,id:string;const origin='http://localhost:5173',now=()=>Math.floor(Date.now()/1000);
const api=(path:string,extra:Record<string,string>={})=>mf.dispatchFetch(origin+'/api'+path,{headers:{Cookie:'pulso_session=live-owner',...extra}});
beforeAll(async()=>{
 await build({entryPoints:['tests/worker-harness.ts'],bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*'],outfile:'.test-build/live-worker.mjs',logLevel:'silent'});
 mf=new Miniflare({cachePersist:`.test-build/live-cache-${process.pid}`,modules:true,scriptPath:'.test-build/live-worker.mjs',compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],bindings:{APP_ORIGIN:origin},d1Databases:{DB:'live-db'},queueProducers:{CHECK_QUEUE:'live-checks'}});db=await mf.getD1Database('DB') as unknown as D1Database;
 for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())await db.batch(readFileSync('migrations/'+file,'utf8').split(/\n(?=CREATE |PRAGMA |ALTER |DROP |INSERT |UPDATE )/).map(s=>db.prepare(s.trim())));
});
beforeEach(async()=>{
 await db.prepare('DELETE FROM users').run();id=randomUUID();
 for(const user of ['live-owner','live-other']){await db.prepare("INSERT INTO users(id,username,created_at,plan_id,account_status,is_owner,last_active_at,history_days_limit) VALUES(?,?,?,'business','active',1,?,90)").bind(user,user,now(),now()).run();await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(createHash('sha256').update(user).digest('base64'),user,now()+3600).run();}
 await db.prepare("INSERT INTO monitors(id,user_id,name,url,root_domain,next_check_at,created_at) VALUES(?,'live-owner','Test','https://example.com/','example.com',0,?)").bind(id,now()).run();
 const hour=Math.floor(now()/3600)*3600;for(const h of [hour-3600,hour])await db.prepare('INSERT INTO hourly_stats(monitor_id,hour,total,successful,total_ms) VALUES(?,?,10,9,200)').bind(id,h).run();
});
afterAll(async()=>{await mf?.dispose();});
describe.sequential('Lightweight authenticated live dashboard',()=>{
 it('uses two reads including authentication, writes nothing and reads no closed history',async()=>{
  const response=await mf.dispatchFetch(origin+'/__test/query-metrics',{method:'POST',headers:{Cookie:'pulso_session=live-owner'},body:JSON.stringify({path:'/api/dashboard/live?days=90'})});
  const value=await response.json() as {status:number;queries:number;writes:number;body:DashboardLive};expect(value.status).toBe(200);expect(value.queries).toBe(2);expect(value.writes).toBe(0);expect(value.body.currentStats[0].total).toBe(10);expect(value.body.monitors[0].paused).toBe(false);expect(value.body.limits.monitors).toBeNull();expect(value.body).not.toHaveProperty('stats');
 });
 it('returns 304 for unchanged content and a different ETag for a new result',async()=>{
  const first=await api('/dashboard/live'),etag=first.headers.get('ETag')!;expect(first.status).toBe(200);
  const warm=await api('/dashboard/live',{'If-None-Match':etag});expect(warm.status).toBe(304);expect(await warm.text()).toBe('');expect(warm.headers.get('Cache-Control')).toBe('no-store');
  await db.prepare('UPDATE monitors SET last_checked_at=?,status=\'up\' WHERE id=?').bind(now(),id).run();
  const updated=await api('/dashboard/live',{'If-None-Match':etag});expect(updated.status).toBe(200);expect(updated.headers.get('ETag')).not.toBe(etag);
 });
 it('revalidates sessions, workspace membership, suspension and plan before conditional responses',async()=>{
  const etag=(await api('/dashboard/live?days=90')).headers.get('ETag')!;
  expect((await api('/dashboard/live',{'X-Vyrsea-Workspace':'live-other'})).status).toBe(403);
  expect((await api('/dashboard/live',{'Cookie':'pulso_session=invalid','If-None-Match':etag})).status).toBe(401);
  await db.prepare("UPDATE users SET is_owner=0,plan_id='free' WHERE id='live-owner'").run();expect((await api('/dashboard/live?days=90',{'If-None-Match':etag})).status).toBe(403);expect((await api('/dashboard/live?view=advanced')).status).toBe(403);
  await db.prepare("UPDATE users SET account_status='suspended' WHERE id='live-owner'").run();expect((await api('/dashboard/live',{'If-None-Match':etag})).status).toBe(403);
 });
 it('merges current hour contributions without double counting and reloads at hour or monitor changes',async()=>{
  const base=await(await api('/dashboard?days=7')).json() as DashboardData;
  await db.prepare('UPDATE hourly_stats SET total=total+2,successful=successful+1,total_ms=total_ms+60 WHERE monitor_id=? AND hour=?').bind(id,Math.floor(now()/3600)*3600).run();
  const live=await(await api('/dashboard/live?days=7')).json() as DashboardLive,merged=mergeLiveDashboard(base,live)!;
  expect(merged.stats.reduce((n,s)=>n+s.total,0)).toBe(22);expect(mergeLiveDashboard(merged,live)!.stats).toEqual(merged.stats);
  expect(mergeLiveDashboard(base,{...live,liveHour:live.liveHour+3600})).toBeNull();expect(mergeLiveDashboard(base,{...live,monitors:[]})).toBeNull();
 });
 it('keeps notifications and maintenance changes live without fetching historical checks',async()=>{
  await db.prepare("INSERT INTO notifications(id,user_id,monitor_id,kind,message,created_at) VALUES('n','live-owner',?,'down','Synthetic',?)").bind(id,now()).run();
  const live=await(await api('/dashboard/live')).json() as DashboardLive;expect(live.notifications).toHaveLength(1);expect(live.notifications[0].readAt).toBeNull();
  await db.prepare("UPDATE notifications SET read_at=? WHERE id='n'").bind(now()).run();const updated=await(await api('/dashboard/live')).json() as DashboardLive;expect(updated.notifications[0].readAt).toBeGreaterThan(0);
  const other=await(await api('/dashboard/live',{'Cookie':'pulso_session=live-other'})).json() as DashboardLive;expect(other.monitors).toEqual([]);expect(other.notifications).toEqual([]);
 });
 it('keeps a shared reader scoped to the selected workspace and revokes conditional access immediately',async()=>{
  await db.prepare("INSERT INTO team_members(workspace_id,user_id,role,created_at) VALUES('live-owner','live-other','reader',?)").bind(now()).run();
  const headers={'Cookie':'pulso_session=live-other','X-Vyrsea-Workspace':'live-owner'},first=await api('/dashboard/live',headers);
  expect(first.status).toBe(200);const value=await first.json() as DashboardLive;expect(value.user.id).toBe('live-other');expect(value.workspace).toMatchObject({id:'live-owner',role:'reader'});expect(value.monitors[0].id).toBe(id);
  await db.prepare("DELETE FROM team_members WHERE workspace_id='live-owner' AND user_id='live-other'").run();
  expect((await api('/dashboard/live',{...headers,'If-None-Match':first.headers.get('ETag')!})).status).toBe(403);
 });
});
