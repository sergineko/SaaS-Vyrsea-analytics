import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { DashboardData } from '../src/types';
import { maintenanceActive, maintenanceFor, type MaintenanceWindow } from '../shared/maintenance';

let mf:Miniflare,db:D1Database,targetCalls=0,releaseTarget:(()=>void)|undefined,targetGate:Promise<void>|undefined;
const origin='http://localhost:5173',now=()=>Math.floor(Date.now()/1000),cookie='pulso_session=maintenance-owner';
async function api(path:string,method='GET',body?:unknown,session=cookie){return mf.dispatchFetch(`${origin}/api${path}`,{method,headers:{Cookie:session,Origin:origin,'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body??{})})});}
async function create(startsAt=now(),duration=1800,monitorId='monitor'){return api(`/monitors/${monitorId}/maintenance`,'POST',{startsAt,endsAt:startsAt+duration,reason:'Actualización prevista'});}
async function count(table:string){return(await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{n:number}>())!.n;}
async function record(slot:number,timestamp:number,ok=false){return mf.dispatchFetch(`${origin}/__test/result`,{method:'POST',body:JSON.stringify({job:{monitorId:'monitor',slot},timestamp,result:{ok,statusCode:ok?200:503,responseMs:10,error:ok?null:'HTTP 503'}})});}
beforeAll(async()=>{
  await build({entryPoints:['tests/worker-harness.ts'],bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*'],outfile:'.test-build/maintenance-worker.mjs',logLevel:'silent'});
  mf=new Miniflare({modules:true,scriptPath:'.test-build/maintenance-worker.mjs',compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],bindings:{APP_ORIGIN:origin},d1Databases:{DB:'maintenance-db'},queueProducers:{CHECK_QUEUE:'maintenance-checks'},outboundService:async(request:{url:string})=>{
    if(request.url.includes('cloudflare-dns.com'))return Response.json({Status:0,Answer:[{type:1,data:'1.1.1.1'}]});targetCalls++;if(targetGate)await targetGate;return new Response('Fixture',{status:503});
  }});
  db=await mf.getD1Database('DB') as unknown as D1Database;
  for(const file of readdirSync('migrations').filter(file=>file.endsWith('.sql')).sort())await db.batch(readFileSync(`migrations/${file}`,'utf8').split(/\n(?=CREATE |PRAGMA |ALTER |DROP |INSERT |UPDATE )/).map(sql=>db.prepare(sql.trim())));
  for(const id of ['owner','other']){
    await db.prepare("INSERT INTO users(id,username,created_at,account_status,last_active_at) VALUES(?,?,?,'active',unixepoch())").bind(id,id,now()).run();
    await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(createHash('sha256').update(`maintenance-${id}`).digest('base64'),id,now()+3600).run();
  }
});
beforeEach(async()=>{
  targetCalls=0;targetGate=undefined;releaseTarget=undefined;
  await db.batch([db.prepare('DELETE FROM monitors'),db.prepare('DELETE FROM rate_limits'),...['monitor','other-monitor'].map(id=>db.prepare('INSERT INTO monitors(id,user_id,name,url,root_domain,next_check_at,created_at) VALUES(?,?,?,?,?,0,?)').bind(id,id==='monitor'?'owner':'other',id,'https://www.example.com/','example.com',now()-3600))]);
});
afterAll(async()=>{releaseTarget?.();await mf?.dispose();});

describe.sequential('Maintenance through the actual Worker and D1',()=>{
  it('keeps windows private and validates timing, duration and input fields',async()=>{
    expect((await create(now(),1800,'other-monitor')).status).toBe(404);
    expect((await api('/monitors/monitor/maintenance','POST',{startsAt:now(),endsAt:now()+1800,reason:'Fixture'},'')).status).toBe(401);
    for(const [start,duration]of [[now()-120,900],[now()+31*86400,900],[now(),299],[now(),86401]])expect((await create(start,duration)).status).toBe(400);
    expect((await api('/monitors/monitor/maintenance','POST',{startsAt:now(),endsAt:now()+900,reason:' ',monitorId:'other-monitor'})).status).toBe(400);
    const created=await create();expect(created.status).toBe(201);const {id}=await created.json() as {id:string};
    expect((await api(`/monitors/monitor/maintenance/${id}/cancel`,'POST',{},'pulso_session=maintenance-other')).status).toBe(404);
    const other=await(await api('/dashboard','GET',undefined,'pulso_session=maintenance-other')).json() as DashboardData;expect(other.maintenance).toEqual([]);
    expect((await(await api('/dashboard')).json() as DashboardData).maintenance).toHaveLength(1);
  });
  it('rejects overlapping windows atomically under concurrent requests',async()=>{
    const start=now()+3600;const results=await Promise.all([create(start),create(start+60)]);expect(results.map(result=>result.status).sort()).toEqual([201,409]);expect(await count('maintenance_windows')).toBe(1);
  });
  it('bounds future schedules and lets cancellation release a pending slot',async()=>{
    const base=now()+3600;let id='';for(let index=0;index<5;index++){const result=await create(base+index*7200);expect(result.status).toBe(201);id=(await result.json() as {id:string}).id;}
    expect((await create(base+6*7200)).status).toBe(409);
    expect((await api(`/monitors/monitor/maintenance/${id}/cancel`,'POST')).status).toBe(200);
    expect((await create(base+6*7200)).status).toBe(201);
  });
  it('skips covered cycles, schedules after the end, and rejects manual probes during maintenance',async()=>{
    const start=now()+600,end=start+600;expect((await create(start,600)).status).toBe(201);
    const reserve=async(timestamp:number)=>(await(await mf.dispatchFetch(`${origin}/__test/reserve`,{method:'POST',body:JSON.stringify({monitorId:'monitor',timestamp})})).json() as {reserved:boolean}).reserved;
    expect(await reserve(start+60)).toBe(false);expect(await count('check_jobs')).toBe(0);
    expect((await db.prepare("SELECT next_check_at FROM monitors WHERE id='monitor'").first<{next_check_at:number}>())!.next_check_at).toBe(end);
    expect(await reserve(end)).toBe(true);
    await db.prepare('DELETE FROM maintenance_windows').run();expect((await create()).status).toBe(201);
    expect((await api('/monitors/monitor/check','POST')).status).toBe(409);
  });
  it('discards a queued probe whose slot belongs to a completed maintenance',async()=>{
    const stamp=now();await db.prepare("INSERT INTO maintenance_windows(id,monitor_id,starts_at,ends_at,reason,created_at) VALUES('past','monitor',?,?,'Fixture',?)").bind(stamp-900,stamp-300,stamp-1000).run();
    await mf.dispatchFetch(`${origin}/__test/consume`,{method:'POST',body:JSON.stringify({jobs:[{monitorId:'monitor',slot:stamp-600}]})});
    expect(targetCalls).toBe(0);expect(await count('checks')).toBe(0);
    await record(stamp-600,stamp);expect(await count('checks')).toBe(0);expect(await count('notifications')).toBe(0);
  });
  it('suppresses a probe that was already in flight when maintenance begins',async()=>{
    targetGate=new Promise(resolve=>{releaseTarget=resolve;});
    const running=mf.dispatchFetch(`${origin}/__test/consume`,{method:'POST',body:JSON.stringify({jobs:[{monitorId:'monitor',slot:Math.floor(now()/60)*60}]})});
    try{await expect.poll(()=>targetCalls,{timeout:5000}).toBe(1);expect((await create()).status).toBe(201);}finally{releaseTarget?.();}
    expect((await running).status).toBe(200);expect(await count('checks')).toBe(0);expect(await count('hourly_stats')).toBe(0);expect(await count('incidents')).toBe(0);expect(await count('notifications')).toBe(0);
  });
  it('breaks a failure sequence across planned gaps and confirms only two new failures',async()=>{
    const stamp=now();await db.prepare("UPDATE monitors SET status='degraded',failures=1,last_checked_at=? WHERE id='monitor'").bind(stamp-60).run();
    expect((await create(stamp+300,300)).status).toBe(201);
    await record(stamp+660,stamp+660);expect(await count('incidents')).toBe(0);
    expect(await db.prepare("SELECT status,failures FROM monitors WHERE id='monitor'").first()).toMatchObject({status:'degraded',failures:1});
    await record(stamp+1560,stamp+1560);expect(await count('incidents')).toBe(1);expect(await count('notifications')).toBe(1);
    await record(stamp+1560,stamp+1560);expect(await count('incidents')).toBe(1);expect(await count('notifications')).toBe(1);
  });
  it('retains pre-existing incidents and reports recovery only after maintenance',async()=>{
    const stamp=now();await db.prepare("UPDATE monitors SET status='down',failures=2,last_checked_at=? WHERE id='monitor'").bind(stamp-600).run();
    await db.prepare("INSERT INTO incidents(id,monitor_id,opened_at,reason) VALUES('old-incident','monitor',?,'Existing outage')").bind(stamp-600).run();
    expect((await create(stamp,600)).status).toBe(201);await record(stamp+60,stamp+60,true);
    expect((await db.prepare("SELECT resolved_at FROM incidents WHERE id='old-incident'").first<{resolved_at:number|null}>())!.resolved_at).toBeNull();expect(await count('notifications')).toBe(0);
    await record(stamp+660,stamp+660,true);expect((await db.prepare("SELECT resolved_at FROM incidents WHERE id='old-incident'").first<{resolved_at:number|null}>())!.resolved_at).toBe(stamp+660);expect(await count('notifications')).toBe(1);
  });
  it('cancels idempotently while preserving the plan cadence and manual pause',async()=>{
    const last=now()-60;await db.prepare("UPDATE monitors SET last_checked_at=?,next_check_at=? WHERE id='monitor'").bind(last,last+900).run();
    const response=await create();const {id}=await response.json() as {id:string};
    for(let index=0;index<2;index++)expect((await api(`/monitors/monitor/maintenance/${id}/cancel`,'POST')).status).toBe(200);
    expect((await db.prepare("SELECT next_check_at FROM monitors WHERE id='monitor'").first<{next_check_at:number}>())!.next_check_at).toBe(last+900);expect((await api('/monitors/monitor/check','POST')).status).toBe(429);
    await db.prepare("UPDATE monitors SET paused=1 WHERE id='monitor'").run();const next=await create();const nextId=(await next.json() as {id:string}).id;await api(`/monitors/monitor/maintenance/${nextId}/cancel`,'POST');
    expect((await db.prepare("SELECT paused FROM monitors WHERE id='monitor'").first<{paused:number}>())!.paused).toBe(1);
  });
  it('filters failed checks on the server, preserves pagination and excludes expired samples',async()=>{
    const stamp=now();for(const [id,age,ok]of [['one',60,0],['two',120,1],['three',180,0],['expired',8*86400,0]] as const)await db.prepare('INSERT INTO checks(id,monitor_id,checked_at,ok,response_ms) VALUES(?,\'monitor\',?,?,10)').bind(id,stamp-age,ok).run();
    const failures=await(await api('/monitors/monitor/history?result=failed')).json() as {ok:number;checkedAt:number}[];expect(failures).toHaveLength(2);expect(failures.every(row=>row.ok===0)).toBe(true);
    expect((await(await api(`/monitors/monitor/history?result=failed&before=${failures[0].checkedAt}`)).json() as unknown[])).toHaveLength(1);expect((await(await api('/monitors/monitor/history?result=ok')).json() as unknown[])).toHaveLength(1);expect((await api('/monitors/monitor/history?result=unsupported')).status).toBe(400);
  });
  it('applies retention to cancelled schedules and cascades monitor removal',async()=>{
    const stamp=now();await db.prepare("INSERT INTO maintenance_windows(id,monitor_id,starts_at,ends_at,reason,created_at) VALUES('expired','monitor',?,?,'Old window',?)").bind(stamp-9*86400,stamp-8*86400,stamp-10*86400).run();
    await db.prepare("INSERT INTO maintenance_windows(id,monitor_id,starts_at,ends_at,reason,created_at,cancelled_at) VALUES('cancelled-old','monitor',?,?,'Old cancellation',?,?)").bind(stamp+3600,stamp+7200,stamp-8*86400,stamp-8*86400).run();
    expect((await create(stamp+3600)).status).toBe(201);
    expect((await(await api('/dashboard?days=7')).json() as DashboardData).maintenance).toHaveLength(1);
    await(await mf.getWorker()).scheduled({cron:'17 3 * * *'});expect(await count('maintenance_windows')).toBe(1);
    expect((await api('/monitors/monitor','DELETE')).status).toBe(200);expect(await count('maintenance_windows')).toBe(0);
  });
});

describe('Maintenance status boundaries',()=>{
  const window:MaintenanceWindow={id:'one',monitorId:'monitor',monitorName:'Fixture',startsAt:1000,endsAt:2000,createdAt:900,reason:'Fixture',cancelledAt:null};
  it('includes the start and excludes the end',()=>{expect(maintenanceActive(window,999)).toBe(false);expect(maintenanceActive(window,1000)).toBe(true);expect(maintenanceActive(window,2000)).toBe(false);});
  it('stops at cancellation and ignores cancelled future schedules',()=>{expect(maintenanceActive({...window,cancelledAt:1500},1499)).toBe(true);expect(maintenanceActive({...window,cancelledAt:1500},1500)).toBe(false);expect(maintenanceActive({...window,cancelledAt:950},1100)).toBe(false);});
  it('scopes status to the monitor',()=>{expect(maintenanceFor('other',[window],1500)).toBeUndefined();expect(maintenanceFor('monitor',[window],1500)?.id).toBe('one');});
});
