import {Miniflare} from 'miniflare';
import {build} from 'esbuild';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
await build({entryPoints:['tests/worker-harness.ts'],bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*'],outfile:'.test-build/writes-worker.mjs',logLevel:'silent'});
const mf=new Miniflare({modules:true,scriptPath:'.test-build/writes-worker.mjs',compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],bindings:{APP_ORIGIN:'http://localhost:5173'},d1Databases:{DB:'writes-benchmark'},queueProducers:{CHECK_QUEUE:'writes-queue'}});
try{
  const db=await mf.getD1Database('DB'),now=Math.floor(Date.now()/60000)*60;
  const last=process.argv[2]??'9999',monitors=Number(process.argv[3]??3);
  if(!Number.isInteger(monitors)||monitors<1||monitors>10)throw new Error('Choose 1–10 monitors');
  for(const file of readdirSync('migrations').filter(file=>file.endsWith('.sql')&&file.slice(0,4)<=last).sort())await db.batch(readFileSync(`migrations/${file}`,'utf8').split(/\n(?=CREATE |PRAGMA |ALTER |DROP |INSERT |UPDATE )/).map(sql=>db.prepare(sql.trim())));
  await db.prepare("INSERT INTO users(id,username,created_at,plan_id,account_status,is_owner,last_active_at) VALUES('bench','bench',?,'business','active',1,?)").bind(now,now).run();
  for(let i=0;i<monitors;i++)await db.prepare("INSERT INTO monitors(id,user_id,name,url,root_domain,next_check_at,created_at) VALUES(?,'bench',?,?,'example.com',?,?)").bind(`m${i}`,`m${i}`,`https://m${i}.example.com/`,now,now).run();
  const cycles=[];
  for(let i=0;i<3;i++)cycles.push(await(await mf.dispatchFetch('http://localhost/__test/storage-cycle',{method:'POST',body:JSON.stringify({timestamp:now+i*60})})).json());
  const result={lastMigration:last,monitors,cycles,note:'Miniflare/workerd D1 meta rows_written. Synthetic healthy checks, no production traffic. Production analytics can differ.'};
  mkdirSync('artifacts',{recursive:true});writeFileSync(`artifacts/d1-writes-${last}.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify({...result,cycles:cycles.map(({samples,...cycle})=>cycle)},null,2));
}finally{await mf.dispose();}
