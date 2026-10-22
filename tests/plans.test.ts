import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { DashboardData } from '../src/types';

let mf: Miniflare, db: D1Database;
const now = Math.floor(Date.now()/1000), origin='http://localhost:5173';
const plans=['free','starter','pro','business'] as const;
const cookies: Record<string,string>={};
async function migrate(file:string) {
  const statements=readFileSync(`migrations/${file}`,'utf8').split(/\n(?=CREATE |PRAGMA |ALTER |DROP |INSERT |UPDATE )/);
  await db.batch(statements.map(sql=>db.prepare(sql.trim())));
}
async function get(plan:string,path:string,method='GET') {
  return mf.dispatchFetch(`${origin}/api${path}`,{method,headers:{Cookie:cookies[plan],Origin:origin,'Content-Type':'application/json'},...(method==='GET'?{}:{body:'{}'})});
}
async function reserve(plan:string,timestamp:number) {
  return (await (await mf.dispatchFetch(`${origin}/__test/reserve`,{method:'POST',body:JSON.stringify({monitorId:`monitor-${plan}`,timestamp})})).json() as {reserved:boolean}).reserved;
}
beforeAll(async()=>{
  await build({entryPoints:['tests/worker-harness.ts'],bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*'],outfile:'.test-build/plan-worker.mjs',logLevel:'silent'});
  mf=new Miniflare({modules:true,scriptPath:'.test-build/plan-worker.mjs',compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],bindings:{APP_ORIGIN:origin},d1Databases:{DB:'plan-db'},queueProducers:{CHECK_QUEUE:'plan-checks'}});
  db=await mf.getD1Database('DB') as unknown as D1Database;
  await migrate('0001_initial.sql'); await migrate('0002_domain_plans.sql');
  // Existing accounts, credentials and history must survive the plan-table replacement.
  for(const plan of ['free','pro','agency']) {
    await db.prepare('INSERT INTO users(id,username,created_at,plan_id) VALUES(?,?,?,?)').bind(`legacy-${plan}`,`legacy-${plan}`,now,plan).run();
    await db.prepare('INSERT INTO credentials(id,user_id,public_key,transports) VALUES(?,?,?,?)').bind(`credential-${plan}`,`legacy-${plan}`,'fixture','[]').run();
    await db.prepare('INSERT INTO monitors(id,user_id,name,url,root_domain,next_check_at,created_at,last_checked_at) VALUES(?,?,?,?,?,?,?,?)').bind(`legacy-monitor-${plan}`,`legacy-${plan}`,'Legacy','https://legacy.example.com','example.com',now+300,now,now).run();
    await db.prepare('INSERT INTO checks(id,monitor_id,checked_at,ok,response_ms) VALUES(?,?,?,1,10)').bind(`legacy-check-${plan}`,`legacy-monitor-${plan}`,now).run();
  }
  for(const file of readdirSync('migrations').filter(name=>name.endsWith('.sql')&&name>'0002_domain_plans.sql').sort())await migrate(file);
  for(const plan of plans) {
    await db.prepare('INSERT INTO users(id,username,created_at,plan_id) VALUES(?,?,?,?)').bind(plan,plan,now,plan).run();
    const raw=`plan-test-${plan}`, hash=createHash('sha256').update(raw).digest('base64');cookies[plan]=`pulso_session=${raw}`;
    await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(hash,plan,now+3600).run();
    if(plan!=='business')await db.prepare('INSERT INTO monitors(id,user_id,name,url,root_domain,next_check_at,created_at) VALUES(?,?,?,?,?,0,?)').bind(`monitor-${plan}`,plan,plan,`https://${plan}.example.com`,'example.com',now).run();
  }
});
afterAll(async()=>{await mf?.dispose();});

describe.sequential('Four plans with billing disabled',()=>{
  it('preserves existing accounts, passkeys, checks and foreign keys during migration',async()=>{
    const rows=await db.prepare("SELECT id,plan_id FROM users WHERE id LIKE 'legacy-%' ORDER BY id").all();
    expect(rows.results).toEqual([{id:'legacy-agency',plan_id:'pro'},{id:'legacy-free',plan_id:'free'},{id:'legacy-pro',plan_id:'starter'}]);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM credentials').first<{n:number}>())!.n).toBe(3);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM checks WHERE id LIKE 'legacy-%'").first<{n:number}>())!.n).toBe(3);
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    expect((await db.prepare("SELECT next_check_at FROM monitors WHERE id='legacy-monitor-free'").first<{next_check_at:number}>())!.next_check_at).toBe(now+900);
  });
  it('publishes exactly four plans and keeps all payment and multi-provider activation disabled',async()=>{
    const body=await (await get('free','/plans')).json() as {plans:{id:string;intervalSeconds:number;historyDays:number|null;maxMonitors:number|null;priceMonthly:number|null;available:boolean}[];billing:{provider:string;enabled:boolean};multiProbeActive:boolean;activeProbeProviders:string[]};
    expect(body.plans.map(p=>p.id)).toEqual([...plans]);
    expect(body.plans.map(p=>p.intervalSeconds)).toEqual([900,300,60,60]);
    expect(body.plans.map(p=>p.historyDays)).toEqual([7,30,90,null]);
    expect(body.plans.map(p=>p.maxMonitors)).toEqual([2,15,100,null]);
    expect(body.plans.map(p=>p.priceMonthly)).toEqual([0,7.99,29.99,null]);
    expect(body.plans.filter(p=>p.available).map(p=>p.id)).toEqual(['free']);
    expect(body.billing).toEqual({provider:'dodo_payments',enabled:false});expect(body.multiProbeActive).toBe(false);expect(body.activeProbeProviders).toEqual(['cloudflare']);
    expect((await get('free','/billing/checkout','POST')).status).toBe(404);
  });
  it.each([['free',900],['starter',300],['pro',60]] as const)('enforces %s cadence even for manual checks',async(plan,interval)=>{
    const timestamp=Math.floor(now/60)*60+5;
    expect(await reserve(plan,timestamp)).toBe(true);
    expect((await db.prepare('SELECT next_check_at FROM monitors WHERE id=?').bind(`monitor-${plan}`).first<{next_check_at:number}>())!.next_check_at).toBe(timestamp+interval);
    expect(await reserve(plan,timestamp+interval-1)).toBe(false);
    const blocked=await get(plan,`/monitors/monitor-${plan}/check`,'POST');expect(blocked.status).toBe(429);
    expect(await reserve(plan,timestamp+interval)).toBe(true);
  });
  it('requires explicit contract quotas for Business instead of treating custom as unlimited',async()=>{
    const insert=()=>db.prepare("INSERT INTO monitors(id,user_id,name,url,root_domain,next_check_at,created_at) VALUES('monitor-business','business','Business','https://business.example.com','example.com',0,?)").bind(now).run();
    await expect(insert()).rejects.toThrow(/CUSTOM_PLAN_REQUIRED/);
    await db.prepare("UPDATE users SET domain_limit=3,monitor_limit=4,history_days_limit=60 WHERE id='business'").run();await insert();
    const data=await (await get('business','/dashboard?days=60&view=advanced')).json() as DashboardData;
    expect(data.limits).toMatchObject({domains:3,monitors:4,historyDays:60,intervalSeconds:60,advancedDashboard:true,multiProbe:true});
    expect(data.multiProbeActive).toBe(false);
  });
  it('restricts history windows and advanced access on the server',async()=>{
    expect((await get('free','/dashboard?days=8')).status).toBe(403);
    expect((await get('starter','/dashboard?days=31')).status).toBe(403);
    expect((await get('free','/dashboard?view=advanced')).status).toBe(403);
    expect((await get('starter','/dashboard?view=advanced')).status).toBe(403);
    expect((await get('pro','/dashboard?days=90&view=advanced')).status).toBe(200);
    expect((await get('business','/dashboard?days=61')).status).toBe(403);
  });
  it('filters expired records immediately and cleans up by the account retention',async()=>{
    for(const [plan,ages] of [['free',[2,6,8]],['starter',[8,29,31]],['pro',[31,89,91]]] as const)for(const age of ages){
      const time=now-age*86400,id=`${plan}-${age}`;
      await db.prepare('INSERT INTO checks(id,monitor_id,checked_at,ok,response_ms) VALUES(?,?,?,1,10)').bind(id,`monitor-${plan}`,time).run();
      await db.prepare('INSERT INTO hourly_stats(monitor_id,hour,total,successful,total_ms) VALUES(?,?,1,1,10)').bind(`monitor-${plan}`,Math.floor(time/3600)*3600).run();
      await db.prepare('INSERT INTO notifications(id,user_id,monitor_id,kind,message,created_at) VALUES(?,?,?,?,?,?)').bind(id,plan,`monitor-${plan}`,'up','Fixture',time).run();
      await db.prepare('INSERT INTO incidents(id,monitor_id,opened_at,resolved_at,reason) VALUES(?,?,?,?,?)').bind(id,`monitor-${plan}`,time-300,time,'Fixture').run();
    }
    await db.prepare("INSERT INTO incidents(id,monitor_id,opened_at,reason) VALUES('open-old','monitor-free',?,'Still open')").bind(now-120*86400).run();
    for(const [plan,days] of [['free',7],['starter',30],['pro',90]] as const){
      const history=await(await get(plan,`/monitors/monitor-${plan}/history`)).json() as {checkedAt:number}[];expect(history).toHaveLength(2);
      const paged=await(await get(plan,`/monitors/monitor-${plan}/history?before=${history[0].checkedAt}`)).json() as {checkedAt:number}[];expect(paged).toHaveLength(1);
      const data=await(await get(plan,`/dashboard?days=${days}`)).json() as DashboardData;expect(data.stats).toHaveLength(2);expect(data.notifications).toHaveLength(2);
      expect(data.incidents.filter(i=>i.resolvedAt)).toHaveLength(2);
    }
    await (await mf.getWorker()).scheduled({cron:'17 3 * * *'});
    for(const [plan,expired] of [['free',8],['starter',31],['pro',91]] as const){
      for(const table of ['checks','notifications','incidents'])expect(await db.prepare(`SELECT id FROM ${table} WHERE id=?`).bind(`${plan}-${expired}`).first()).toBeNull();
      expect((await db.prepare('SELECT COUNT(*) AS n FROM hourly_stats WHERE monitor_id=?').bind(`monitor-${plan}`).first<{n:number}>())!.n).toBe(2);
    }
    expect(await db.prepare("SELECT id FROM incidents WHERE id='open-old'").first()).not.toBeNull();
  });
});
