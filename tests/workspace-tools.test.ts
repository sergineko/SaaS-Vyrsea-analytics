import {beforeAll,afterAll,beforeEach,describe,it,expect} from 'vitest';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {authenticator} from './webauthn';
import {statusPageHTML} from '../shared/status-pages';
let mf:Miniflare,db:D1Database;const origin='http://localhost:5173',now=()=>Math.floor(Date.now()/1000),hash=(s:string)=>createHash('sha256').update(s).digest('base64');
const ids={owner:randomUUID(),pro:randomUUID(),free:randomUUID(),starter:randomUUID()};
const contract={company:'Cliente de prueba',contactEmail:'ops@example.com',priceCents:4999,billingCycle:'monthly',notes:'Informes y retención de 45 días'};
async function api(path:string,method='GET',body?:unknown,user='owner'){return mf.dispatchFetch(origin+'/api'+path,{method,headers:{Cookie:`pulso_session=${user}`,Origin:origin,'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body??{})})});}
const cookie=(response:{headers:{get:(name:string)=>string|null}},kind='challenge')=>response.headers.get('set-cookie')!.match(new RegExp(`pulso_${kind}=[^;,\\s]+`))![0];
async function publicAPI(id:string,view=''){return mf.dispatchFetch(origin+'/api/public/status/'+id+view);}
async function createBusiness(username='new-business'){const response=await api('/owner/business-accounts','POST',{username,domainLimit:3,monitorLimit:15,historyDaysLimit:45,contract});expect(response.status).toBe(201);return response.json() as Promise<{id:string;invitationURL:string;expiresAt:number}>;}
async function options(invitationURL:string){const params=new URLSearchParams(new URL(invitationURL).hash.slice(1));return api('/auth/register/options','POST',{username:params.get('usuario'),invitationToken:params.get('business')},'');}
async function verify(options:{headers:{get:(name:string)=>string|null};json:()=>Promise<unknown>},key=authenticator()) {const data=await options.json() as {challenge:string};return mf.dispatchFetch(origin+'/api/auth/register/verify',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie(options)},body:JSON.stringify(key.register(data.challenge))});}
beforeAll(async()=>{
 await build({entryPoints:['tests/worker-harness.ts'],bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*'],outfile:'.test-build/tools-worker.mjs',logLevel:'silent'});
 mf=new Miniflare({cachePersist:`.test-build/t-${process.pid}`,modules:true,scriptPath:'.test-build/tools-worker.mjs',compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],bindings:{APP_ORIGIN:origin},d1Databases:{DB:'tools-db',LEGACY:'legacy-tools-db'},queueProducers:{CHECK_QUEUE:'tools-checks'}});db=await mf.getD1Database('DB') as unknown as D1Database;
 for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())await db.batch(readFileSync('migrations/'+file,'utf8').split(/\n(?=CREATE |PRAGMA |ALTER |DROP |INSERT |UPDATE )/).map(s=>db.prepare(s.trim())));
});
beforeEach(async()=>{
 await db.batch([db.prepare('DELETE FROM users'),db.prepare('DELETE FROM challenges'),db.prepare('DELETE FROM rate_limits')]);
 for(const name of ['owner','pro','free','starter'] as const){await db.prepare("INSERT INTO users(id,username,created_at,plan_id,account_status,is_owner,last_active_at,domain_limit,monitor_limit,history_days_limit) VALUES(?,?,?,?,'active',?, ?,5,100,90)").bind(name,name,now(),name==='owner'?'business':name,name==='owner'?1:0,now()).run();await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(hash(name),name,now()+3600).run();await db.prepare('INSERT INTO monitors(id,user_id,name,url,root_domain,next_check_at,created_at) VALUES(?,?,?,?,?,0,?)').bind(ids[name],name,`${name} private service`,`https://${name}.example.com/private?key=not-public`,'example.com',now()).run();}
});
afterAll(async()=>{await mf?.dispose();});
describe.sequential('Workspace tools on real Worker and D1',()=>{
 it('separates a fixed 24h window and the chosen monitor period, enforcing ownership and retention',async()=>{
  const hour=Math.floor(now()/3600)*3600;
  for(const offset of [0,2,48,24*8])await db.prepare('INSERT INTO hourly_stats(monitor_id,hour,total,successful,total_ms) VALUES(?,?,10,9,200)').bind(ids.free,hour-offset*3600).run();
  const response=await api(`/monitors/${ids.free}/availability?days=7`,'GET',undefined,'free');expect(response.status).toBe(200);const data=await response.json() as {stats:unknown[];last24:unknown[]};expect(data.stats).toHaveLength(3);expect(data.last24).toHaveLength(2);
  expect((await api(`/monitors/${ids.free}/availability?days=30`,'GET',undefined,'free')).status).toBe(403);
  expect((await api(`/monitors/${ids.free}/availability?days=1`)).status).toBe(404);
  expect((await api(`/monitors/${ids.free}/availability?from=${hour-24*3600}&to=${hour}`,'GET',undefined,'free')).status).toBe(200);
  expect((await api(`/monitors/${ids.free}/availability?from=${hour}&to=${hour-3600}`,'GET',undefined,'free')).status).toBe(400);
  expect((await api(`/monitors/${ids.free}/availability?from=${hour-9*86400}&to=${hour}`,'GET',undefined,'free')).status).toBe(403);
 });
 it('bounds dashboard response size to 24 buckets per monitor without losing totals',async()=>{
  const hour=Math.floor(now()/3600)*3600;await db.prepare('WITH RECURSIVE n(x) AS(VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<999) INSERT INTO hourly_stats(monitor_id,hour,total,successful,total_ms) SELECT ?,?-x*3600,10,9,100 FROM n').bind(ids.pro,hour).run();
  const data=await(await api('/dashboard?days=90','GET',undefined,'pro')).json() as {stats:{total:number;successful:number}[]};expect(data.stats.length).toBeLessThanOrEqual(24);expect(data.stats.reduce((n,s)=>n+s.total,0)).toBe(10000);expect(data.stats.reduce((n,s)=>n+s.successful,0)).toBe(9000);
 });
 it('stores per-monitor provider preferences only for entitled owners and keeps a connected probe',async()=>{
  expect((await api(`/monitors/${ids.free}/probes`,'PATCH',{probeMask:1},'free')).status).toBe(403);
  expect((await api(`/monitors/${ids.pro}/probes`,'PATCH',{probeMask:1})).status).toBe(404);
  expect((await api(`/monitors/${ids.pro}/probes`,'PATCH',{probeMask:4},'pro')).status).toBe(409);
  expect((await api(`/monitors/${ids.pro}/probes`,'PATCH',{probeMask:3},'pro')).status).toBe(200);
  expect((await db.prepare('SELECT probe_mask FROM monitors WHERE id=?').bind(ids.pro).first())!.probe_mask).toBe(3);
  expect((await db.prepare('SELECT probe_mask FROM monitors WHERE id=?').bind(ids.owner).first())!.probe_mask).toBe(7);
 });
 it('publishes only explicitly selected service names and availability with public read caching',async()=>{
  const value={title:'Estado del cliente',description:'Consulta pública',accent:'#187356',theme:'dark',monitorIds:[ids.pro],published:false};
  expect((await api('/status-pages','POST',value,'free')).status).toBe(403);
  expect((await api('/status-pages','POST',{...value,monitorIds:[ids.owner]},'pro')).status).toBe(400);
  const created=await api('/status-pages','POST',value,'pro');expect(created.status).toBe(201);const {id}=await created.json() as {id:string};
  expect((await publicAPI(id)).status).toBe(404);
  expect((await api(`/status-pages/${id}`,'PUT',{...value,published:true})).status).toBe(404);
  await api(`/status-pages/${id}`,'PUT',{...value,published:true},'pro');
  const result=await publicAPI(id);expect(result.status).toBe(200);expect(result.headers.get('access-control-allow-origin')).toBe('*');const text=await result.text();expect(text).toContain('pro private service');for(const secret of ['not-public','monitorIds','user_id','last_error',ids.owner,ids.pro])expect(text).not.toContain(secret);
  const page=await publicAPI(id,'/view');expect(page.status).toBe(200);expect(page.headers.get('x-frame-options')).toBeNull();expect(page.headers.get('content-security-policy')).toContain('frame-ancestors *');
  await api(`/status-pages/${id}`,'PUT',value,'pro');expect((await publicAPI(id)).status).toBe(404);
 });
 it('exports HTML without injecting user text into markup or executable code',()=>{
  const html=statusPageHTML({title:'</title><script>alert(1)</script>',description:'<img src=x onerror=alert(1)>',accent:'red;display:none',theme:'dark'},'https://vyrsea.com/api/public/status/a');
  expect(html).not.toContain('<script>alert(1)');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<img');expect(html).not.toContain('red;display:none');expect(html).toContain('credentials:\'omit\'');expect(html).toContain('textContent=service.name');
 });
 it('creates Business with custom limits and a one-use invitation, without billing or credentials',async()=>{
  expect((await api('/owner/business-accounts','POST',{},'pro')).status).toBe(403);
  const created=await createBusiness(),stored=await db.prepare('SELECT * FROM users WHERE id=?').bind(created.id).first();expect(stored).toMatchObject({plan_id:'business',is_owner:0,monitor_limit:15,history_days_limit:45});
  const row=await db.prepare('SELECT * FROM account_invitations WHERE user_id=?').bind(created.id).first();expect(row!.token_hash).not.toBe(new URLSearchParams(new URL(created.invitationURL).hash.slice(1)).get('business'));
  expect(await db.prepare('SELECT id FROM credentials WHERE user_id=?').bind(created.id).first()).toBeNull();
  const opts=await options(created.invitationURL);expect(opts.status).toBe(200);const verified=await verify(opts);expect(verified.status).toBe(201);const session=cookie(verified,'session');const response=await mf.dispatchFetch(origin+'/api/me',{headers:{Cookie:session}});expect(await response.json()).toMatchObject({user:{id:created.id,planId:'business',isOwner:false,accountStatus:'active'}});
  expect((await options(created.invitationURL)).status).toBe(400);expect((await api(`/owner/accounts/${created.id}/invitation`,'POST')).status).toBe(409);
 });
 it('rejects replaced, expired and concurrently consumed invitations, preserving passkeys',async()=>{
  const first=await createBusiness(),old=await options(first.invitationURL);const renewed=await api(`/owner/accounts/${first.id}/invitation`,'POST');const next=await renewed.json() as {invitationURL:string};expect((await verify(old)).status).toBe(409);
  const a=await options(next.invitationURL),b=await options(next.invitationURL),responses=await Promise.all([verify(a),verify(b)]);expect(responses.map(r=>r.status).sort()).toEqual([201,409]);expect((await db.prepare('SELECT COUNT(*) AS n FROM credentials WHERE user_id=?').bind(first.id).first())!.n).toBe(1);
  const expired=await createBusiness('expired-business');await db.prepare('UPDATE account_invitations SET expires_at=? WHERE user_id=?').bind(now()-1,expired.id).run();expect((await options(expired.invitationURL)).status).toBe(400);
 });
 it('keeps Business commercial drafts private and rejects client-side billing or owner escalation',async()=>{
  const created=await createBusiness();expect((await api(`/owner/accounts/${created.id}/contract`,'GET',undefined,'pro')).status).toBe(403);
  expect((await api(`/owner/accounts/${created.id}/contract`,'PUT',{...contract,priceCents:12345})).status).toBe(200);
  expect(await(await api(`/owner/accounts/${created.id}/contract`)).json()).toMatchObject({billingEnabled:false,contract:{priceCents:12345}});
  expect((await api(`/owner/accounts/${created.id}/contract`,'PUT',{...contract,billingEnabled:true})).status).toBe(400);
  expect((await api('/owner/business-accounts','POST',{username:'evil',domainLimit:1,monitorLimit:1,historyDaysLimit:7,contract,isOwner:true})).status).toBe(400);
 });
 it('uses ten D1 writes per healthy check after the compact-table migration',async()=>{
  await db.prepare("UPDATE monitors SET paused=1 WHERE user_id!='owner'").run();const tick=Math.floor(now()/60)*60;
  const response=await mf.dispatchFetch(origin+'/__test/storage-cycle',{method:'POST',body:JSON.stringify({timestamp:tick})});const result=await response.json() as {writes:number;checks:number};expect(result.checks).toBe(1);expect(result.writes).toBe(10);
 });
 it('migrates existing history and pending outbox without changing data or cascades',async()=>{
  const legacy=await mf.getD1Database('LEGACY') as unknown as D1Database,files=readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort();
  async function migrate(file:string){await legacy.batch(readFileSync('migrations/'+file,'utf8').split(/\n(?=CREATE |PRAGMA |ALTER |DROP |INSERT |UPDATE )/).map(s=>legacy.prepare(s.trim())));}
  for(const file of files.filter(f=>f<'0011'))await migrate(file);
  await legacy.prepare("INSERT INTO users(id,username,created_at,plan_id,account_status,last_active_at) VALUES('existing','existing',?,'pro','active',?)").bind(now(),now()).run();
  await legacy.prepare("INSERT INTO monitors(id,user_id,name,url,root_domain,next_check_at,created_at) VALUES('existing','existing','Existing','https://example.com/','example.com',0,?)").bind(now()).run();
  await legacy.batch([legacy.prepare("INSERT INTO checks(id,monitor_id,checked_at,ok,status_code,response_ms,error) VALUES('old','existing',100,0,503,123,'HTTP 503')"),legacy.prepare("INSERT INTO hourly_stats(monitor_id,hour,total,successful,total_ms) VALUES('existing',0,4,3,500)"),legacy.prepare("INSERT INTO check_jobs(id,monitor_id,slot,created_at,dispatched_at) VALUES('existing:120','existing',120,120,NULL)")]);
  const tables=['checks','hourly_stats','check_jobs'],before=await Promise.all(tables.map(table=>legacy.prepare(`SELECT * FROM ${table}`).all()));
  for(const file of files.filter(f=>f>='0011'))await migrate(file);
  for(const [index,table]of tables.entries())expect((await legacy.prepare(`SELECT * FROM ${table}`).all()).results).toEqual(before[index].results);
  await legacy.prepare("DELETE FROM monitors WHERE id='existing'").run();for(const table of tables)expect((await legacy.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first())!.n).toBe(0);
 });
});
