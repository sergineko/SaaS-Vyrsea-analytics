import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';
import { estimateCapacity } from '../shared/capacity';
import { retentionCandidatesSQL } from '../worker/retention';

describe('Cost bounds', () => {
  it('accounts for sparse batches and the fastest monitor without promising full packing', () => {
    expect(estimateCapacity(0,0,0).queueOperationsMin).toBe(0);
    expect(estimateCapacity(2880,2,1440)).toMatchObject({queueOperationsMin:4320,queueOperationsMax:8640});
    expect(estimateCapacity(960,10,96)).toMatchObject({queueOperationsMin:720,queueOperationsMax:2880});
    expect(estimateCapacity(19200,200,96)).toMatchObject({exceedsQueueFreeMinimum:true,exceedsScheduler:true});
    expect(estimateCapacity(192000,2000,96).queueOperationsMin).toBe(144000);
    expect(() => estimateCapacity(-1)).toThrow();
  });
});

let mf: Miniflare, db: D1Database, networkCalls = 0;
let slowGate:Promise<void>|undefined,releaseSlow:(()=>void)|undefined;
const now = () => Math.floor(Date.now()/1000);
const invoke = (path:string, body:unknown = {}) => mf.dispatchFetch(`http://localhost/__test/${path}`,{method:'POST',body:JSON.stringify(body)});
beforeAll(async () => {
  await build({entryPoints:['tests/worker-harness.ts'],bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*'],outfile:'.test-build/capacity-worker.mjs',logLevel:'silent'});
  mf = new Miniflare({modules:true,scriptPath:'.test-build/capacity-worker.mjs',compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],bindings:{APP_ORIGIN:'http://localhost:5173'},d1Databases:{DB:'capacity-db'},queueProducers:{CHECK_QUEUE:'capacity-checks'},outboundService:async(request:{url:string}) => {
    networkCalls++;
    if (request.url.includes('cloudflare-dns.com')) return Response.json({Status:0,Answer:[{type:1,data:'1.1.1.1'}]});
    if(new URL(request.url).hostname==='m5.example.com'&&slowGate)await slowGate;
    const hop = Number(new URL(request.url).pathname.slice(1));
    return hop < 3 ? new Response(null,{status:302,headers:{Location:`/${hop+1}`}}) : new Response('Fixture');
  }});
  db = await mf.getD1Database('DB') as unknown as D1Database;
  for (const file of readdirSync('migrations').filter(file=>file.endsWith('.sql')).sort()) await db.batch(readFileSync(`migrations/${file}`,'utf8').split(/\n(?=CREATE |PRAGMA |ALTER |DROP |INSERT |UPDATE )/).map(sql=>db.prepare(sql.trim())));
  await db.prepare("INSERT INTO users(id,username,created_at,plan_id,account_status,domain_limit,monitor_limit,history_days_limit) VALUES('owner','owner',?,'business','active',10,10,90)").bind(now()).run();
  for(let i=0;i<10;i++) await db.prepare("INSERT INTO monitors(id,user_id,name,url,root_domain,next_check_at,created_at) VALUES(?,'owner',?,?,'example.com',0,?)").bind(`m${i}`,`m${i}`,`https://m${i}.example.com/0`,now()).run();
});
afterAll(async()=>{await mf?.dispose();});

describe.sequential('Cost controls on actual Worker/D1', () => {
  it('packs ten due jobs into three messages rather than four', async () => {
    const slot = Math.floor(now()/60)*60;
    for(let i=0;i<10;i++) await db.prepare('INSERT INTO check_jobs(id,monitor_id,slot,created_at) VALUES(?,?,?,?)').bind(`m${i}:${slot}`,`m${i}`,slot,now()).run();
    const result = await (await invoke('dispatch-capture')).json() as {messages:{body:{jobs:unknown[]}}[]};
    expect(result.messages.map(message=>message.body.jobs.length)).toEqual([4,4,2]);
  });
  it('handles four probes with three redirects each within 48 external requests', async () => {
    networkCalls=0;
    expect((await invoke('consume',{jobs:Array.from({length:4},(_,i)=>({monitorId:`m${i}`,slot:Math.floor(now()/60)*60}))})).status).toBe(200);
    expect(networkCalls).toBe(48);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM checks').first<{n:number}>())!.n).toBe(4);
  });
  it('keeps concurrent duplicate results atomic when consumers run in parallel', async () => {
    const job={monitorId:'m4',slot:Math.floor(now()/60)*60}, result={ok:true,statusCode:200,responseMs:20,error:null};
    const responses=await Promise.all(Array.from({length:3},()=>invoke('result',{job,result})));
    expect(responses.every(response=>response.status===200)).toBe(true);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM checks WHERE monitor_id='m4'").first<{n:number}>())!.n).toBe(1);
    expect((await db.prepare("SELECT SUM(total) AS n FROM hourly_stats WHERE monitor_id='m4'").first<{n:number}>())!.n).toBe(1);
  });
  it('seeks retained history by monitor and time without a global time index', async () => {
    const plan=await db.prepare(`EXPLAIN QUERY PLAN ${retentionCandidatesSQL('checks','checked_at',3500)}`).bind(now()).all<{detail:string}>();
    expect(plan.results.map(row=>row.detail).join('\n')).toMatch(/checks_monitor_time.*monitor_id=.*checked_at</);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name IN ('checks_time','hourly_time')").first<{n:number}>())!.n).toBe(0);
    await db.prepare("INSERT INTO checks(id,monitor_id,checked_at,ok,response_ms) VALUES('expired','m0',?,1,10)").bind(now()-100*86400).run();
    expect((await invoke('cleanup',{timestamp:now()})).status).toBe(200);
    expect(await db.prepare("SELECT id FROM checks WHERE id='expired'").first()).toBeNull();
    expect((await db.prepare('SELECT COUNT(*) AS n FROM checks').first<{n:number}>())!.n).toBe(5);
  });
  it('finishes a healthy probe while its sibling target is still waiting',async()=>{
    slowGate=new Promise(resolve=>{releaseSlow=resolve;});
    const pending=invoke('consume',{jobs:[{monitorId:'m5',slot:Math.floor(now()/60)*60},{monitorId:'m6',slot:Math.floor(now()/60)*60}]});
    try{
      await expect.poll(async()=>Boolean(await db.prepare("SELECT id FROM checks WHERE monitor_id='m6'").first()),{timeout:2000}).toBe(true);
      expect(await db.prepare("SELECT id FROM checks WHERE monitor_id='m5'").first()).toBeNull();
    }finally{releaseSlow?.();slowGate=undefined;}
    expect((await pending).status).toBe(200);
  });
});
