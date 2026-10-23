import {Miniflare} from 'miniflare';
import {build} from 'esbuild';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

// Isolated synthetic Worker + D1. Never connects to production or user data.
await build({entryPoints:['tests/worker-harness.ts'],bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*'],outfile:'.test-build/queries-worker.mjs',logLevel:'silent'});
const mf=new Miniflare({cachePersist:`.test-build/q-${process.pid}`,modules:true,scriptPath:'.test-build/queries-worker.mjs',compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],bindings:{APP_ORIGIN:'http://localhost:5173'},d1Databases:{DB:'queries-benchmark'},queueProducers:{CHECK_QUEUE:'queries-queue'}});
try {
  const db=await mf.getD1Database('DB'),now=Math.floor(Date.now()/1000),hour=Math.floor(now/3600)*3600;
  for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())await db.batch(readFileSync('migrations/'+file,'utf8').split(/\n(?=CREATE |PRAGMA |ALTER |DROP |INSERT |UPDATE )/).map(sql=>db.prepare(sql.trim())));
  for(const user of ['bench','other'])await db.prepare("INSERT INTO users(id,username,created_at,plan_id,account_status,last_active_at,is_owner,history_days_limit) VALUES(?,?,?,'business','active',?,1,90)").bind(user,user,now,now).run();
  await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(createHash('sha256').update('bench-token').digest('base64'),'bench',now+3600).run();
  for(let i=0;i<10;i++) {
    await db.prepare('INSERT INTO monitors(id,user_id,name,url,root_domain,next_check_at,created_at) VALUES(?,?,?,?,?,0,?)').bind(`m${i}`,i<2?'bench':'other',`m${i}`,`https://m${i}.example.com/`,'example.com',now).run();
    await db.prepare('WITH RECURSIVE n(x) AS(VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<999) INSERT INTO hourly_stats(monitor_id,hour,total,successful,total_ms) SELECT ?,?-x*3600,10,9,200 FROM n').bind(`m${i}`,hour).run();
  }
  const measurements=[];
  const paths=['/api/dashboard?days=90',`/api/monitors/m0/availability?from=${hour-35*86400}&to=${hour-34*86400}`];
  for(const path of paths)for(const run of ['cold','warm']) {
    const response=await mf.dispatchFetch('http://localhost/__test/query-metrics',{method:'POST',headers:{Cookie:'pulso_session=bench-token'},body:JSON.stringify({path})});
    const {body,...metrics}=await response.json();
    if(metrics.status!==200)throw new Error(JSON.stringify({path,...metrics,body}));
    measurements.push({path,run,...metrics,returnedStats:body.stats.length,statsTotal:body.stats.reduce((sum,row)=>sum+row.total,0)});
  }
  const label=process.argv[2]??'current',report={label,fixture:{monitors:10,accountMonitors:2,hourlyRows:10000},measurements,note:'Synthetic Miniflare/workerd D1 meta rows_read/rows_written. Not production analytics or a load test. Cache hits are local to an edge location.'};
  mkdirSync('artifacts',{recursive:true});writeFileSync(`artifacts/d1-queries-${label}.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,measurements:measurements.map(({samples,...m})=>m)},null,2));
}finally{await mf.dispose();}
