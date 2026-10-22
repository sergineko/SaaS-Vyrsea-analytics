import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { readFileSync,readdirSync } from 'node:fs';
let mf:Miniflare,db:D1Database;const now=Math.floor(Date.now()/1000),day=Math.floor(now/86400)*86400;
async function run(start=true,withSchedule=false,timestamp=now){return mf.dispatchFetch('http://localhost:5173/__test/retention-run',{method:'POST',body:JSON.stringify({start,timestamp,withSchedule})});}
async function state(){return db.prepare("SELECT * FROM maintenance_jobs WHERE id='retention'").first<{pending:number;deleted_json:string;completed_at:number|null;updated_at:number}>();}
beforeAll(async()=>{
  await build({entryPoints:['tests/worker-harness.ts'],bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*'],outfile:'.test-build/retention-worker.mjs',logLevel:'silent'});
  mf=new Miniflare({modules:true,scriptPath:'.test-build/retention-worker.mjs',compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],bindings:{APP_ORIGIN:'http://localhost:5173'},d1Databases:{DB:'retention-db'},queueProducers:{CHECK_QUEUE:'retention-checks'}});db=await mf.getD1Database('DB') as unknown as D1Database;
  for(const file of readdirSync('migrations').filter(file=>file.endsWith('.sql')).sort())await db.batch(readFileSync(`migrations/${file}`,'utf8').split(/\n(?=CREATE |PRAGMA |ALTER |DROP |INSERT |UPDATE )/).map(sql=>db.prepare(sql.trim())));
});
beforeEach(async()=>{
  await db.batch([db.prepare('DROP TRIGGER IF EXISTS fixture_cleanup_failure'),db.prepare('DELETE FROM users'),db.prepare('DELETE FROM maintenance_jobs')]);
  for(const plan of ['free','starter','pro','business']){await db.prepare("INSERT INTO users(id,username,created_at,plan_id,account_status,last_active_at,domain_limit,monitor_limit,history_days_limit) VALUES(?,?,?,?,'active',?,2,2,12)").bind(plan,plan,now,plan,now).run();await db.prepare('INSERT INTO monitors(id,user_id,name,url,root_domain,next_check_at,created_at,paused) VALUES(?,?,?,?,?,0,?,1)').bind(plan,plan,plan,`https://${plan}.example.com/`,'example.com',now).run();}
});
afterAll(async()=>{await mf?.dispose();});
describe.sequential('Scheduled historical retention',()=>{
  it('deletes expired whole UTC days by plan and applies the configured Business retention',async()=>{
    for(const [plan,days] of [['free',7],['starter',30],['pro',90],['business',12]] as const){const cutoff=day-days*86400;
      for(const [id,time] of [[`${plan}-old-start`,cutoff-86400],[`${plan}-old-end`,cutoff-1],[`${plan}-keep`,cutoff]] as const)await db.prepare('INSERT INTO checks(id,monitor_id,checked_at,ok,response_ms) VALUES(?,?,?,1,10)').bind(id,plan,time).run();
    }
    await db.prepare("INSERT INTO incidents(id,monitor_id,opened_at,reason) VALUES('open','free',?,'Still open')").bind(day-120*86400).run();
    expect((await run()).status).toBe(200);const checks=(await db.prepare('SELECT id FROM checks ORDER BY id').all<{id:string}>()).results.map(row=>row.id);expect(checks).toEqual(['business-keep','free-keep','pro-keep','starter-keep']);expect(await db.prepare("SELECT id FROM incidents WHERE id='open'").first()).not.toBeNull();
    const job=await state();expect(job!.pending).toBe(0);expect(job!.completed_at).toBe(now);expect(JSON.parse(job!.deleted_json).checks).toBe(8);
  });
  it('continues bounded deletes until all expired rows are removed and then stops',async()=>{
    await db.prepare("WITH RECURSIVE n(x) AS(VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<3600) INSERT INTO checks(id,monitor_id,checked_at,ok,response_ms) SELECT 'bulk-'||x,'free',?,1,10 FROM n").bind(day-9*86400).run();
    expect((await run()).status).toBe(200);expect((await state())!.pending).toBe(1);expect((await db.prepare('SELECT COUNT(*) AS n FROM checks').first())!.n).toBe(101);
    expect((await run(false)).status).toBe(200);const completed=await state();expect(completed!.pending).toBe(0);expect(JSON.parse(completed!.deleted_json).checks).toBe(3601);
    const noOp=await(await run(false)).json() as {queries:number};expect(noOp.queries).toBe(1);expect(await state()).toEqual(completed);
  });
  it('keeps the task pending after an interruption and recovers on continuation',async()=>{
    await db.prepare("INSERT INTO checks(id,monitor_id,checked_at,ok,response_ms) VALUES('expired','free',?,1,10)").bind(day-9*86400).run();
    await db.prepare("CREATE TRIGGER fixture_cleanup_failure BEFORE DELETE ON checks BEGIN SELECT RAISE(ABORT,'Fixture retention interruption'); END").run();
    expect((await run()).status).toBe(503);expect((await state())!.pending).toBe(1);
    await db.prepare('DROP TRIGGER fixture_cleanup_failure').run();expect((await run(false)).status).toBe(200);expect((await state())!.pending).toBe(1);
    expect((await run(false,false,now+121)).status).toBe(200);expect((await state())!.pending).toBe(0);
  });
  it('fits a full ten-monitor scheduler and daily cleanup under the Free 50-query budget',async()=>{
    await db.prepare("INSERT INTO users(id,username,created_at,plan_id,account_status,is_owner,last_active_at,history_days_limit) VALUES('owner','owner',?,'business','active',1,?,90)").bind(now,now).run();
    for(let i=0;i<10;i++)await db.prepare("INSERT INTO monitors(id,user_id,name,url,root_domain,next_check_at,created_at) VALUES(?,'owner',?,?,?,0,?)").bind(`owned-${i}`,`Owned ${i}`,`https://service${i}.com/`,`service${i}.com`,now).run();
    const response=await run(true,true);expect(response.status).toBe(200);const result=await response.json() as {queries:number};expect(result.queries).toBe(48);expect(result.queries).toBeLessThanOrEqual(50);
  });
});
