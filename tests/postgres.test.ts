import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {PostgresDatabase,postgresClient,postgresQuery} from '../worker/database';
import {authenticator} from './webauthn';
import type {DashboardData} from '../src/types';
import {postgresTlsBridge} from './postgres-tls-bridge';

// Explicit opt-in only. Normal local/Builds runs never discover a production
// credential file. GitHub CI supplies a disposable PostgreSQL 17 service.
const connection=process.env.VYRSEA_POSTGRES_TEST_URL;
const caPath=process.env.DATABASE_CA_FILE ?? '.wrangler/supabase-migration/supabase-ca.crt';
const ca=existsSync(caPath)?readFileSync(caPath,'utf8'):undefined;
const schema=`vyrsea_test_${process.pid}_${Date.now()}`;
const origin='http://localhost:5173',now=()=>Math.floor(Date.now()/1000);
let sql:ReturnType<typeof postgresClient>,db:PostgresDatabase,mf:Miniflare;
let bridge:Awaited<ReturnType<typeof postgresTlsBridge>>;
const owner='pg-owner',other='pg-other',monitor=randomUUID();
const cookie=(user=owner)=>`pulso_session=${user}`;
async function api(path:string,method='GET',body?:unknown,user=owner){return mf.dispatchFetch(origin+'/api'+path,{method,headers:{Cookie:cookie(user),Origin:origin,'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body??{})})});}
async function result(slot:number,ok=true,id=monitor){return mf.dispatchFetch(origin+'/__test/result',{method:'POST',body:JSON.stringify({job:{monitorId:id,slot},timestamp:now(),result:{ok,statusCode:ok?200:503,responseMs:24,error:ok?null:'HTTP 503'}})});}
const challengeCookie=(r:{headers:{get:(name:string)=>string|null}})=>r.headers.get('set-cookie')!.split(';')[0];

describe.skipIf(!connection).sequential('PostgreSQL 17: real Worker, transactions and original account semantics',()=>{
  beforeAll(async()=>{
    sql=postgresClient(connection!,ca);
    await sql.begin(async tx=>{
      for(const file of readdirSync('migrations/postgres').filter(f=>f.endsWith('.sql')).sort())await tx.unsafe(readFileSync('migrations/postgres/'+file,'utf8').replace(/\bvyrsea\b/g,schema));
    });
    db=new PostgresDatabase(sql,schema);
    for(const id of [owner,other]){
      await db.prepare("INSERT INTO users(id,username,created_at,plan_id,account_status,is_owner,last_active_at,history_days_limit) VALUES(?,?,?,'business','active',1,?,90)").bind(id,id,now(),now()).run();
      await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(createHash('sha256').update(id).digest('base64'),id,now()+3600).run();
    }
    await db.prepare('INSERT INTO monitors(id,user_id,name,url,root_domain,next_check_at,created_at) VALUES(?,?,?,?,?,0,?)').bind(monitor,owner,'Servicio PostgreSQL','https://example.com/','example.com',now()).run();
    await build({entryPoints:['tests/worker-harness.ts'],bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*'],outfile:'.test-build/postgres-worker.mjs',logLevel:'silent'});
    bridge=['localhost','127.0.0.1','[::1]'].includes(new URL(connection!).hostname)?{url:connection!,close:async()=>{}}:await postgresTlsBridge(connection!,ca);
    mf=new Miniflare({cachePersist:`.test-build/pg-${process.pid}`,modules:true,scriptPath:'.test-build/postgres-worker.mjs',compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],bindings:{APP_ORIGIN:origin,DATABASE_URL:bridge.url,DATABASE_SCHEMA:schema,DATABASE_PROVIDER:'supabase'},queueProducers:{CHECK_QUEUE:'postgres-test-checks'},outboundService:async (request:Request)=>request.url.includes('cloudflare-dns.com')?Response.json({Status:0,Answer:[{type:1,data:'1.1.1.1'}]}):new Response('Synthetic target',{status:200})});
  },60000);
  afterAll(async()=>{
    await mf?.dispose();
    await bridge?.close();
    if(sql){await sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await sql.end({timeout:5});}
  },30000);

  it('reads the owner, unlimited plan and boolean monitor fields without exposing another account',async()=>{
    const response=await api('/dashboard');expect(response.status).toBe(200);
    const data=await response.json() as DashboardData;expect(data.user.username).toBe(owner);expect(data.limits.monitors).toBeNull();expect(data.monitors[0]).toMatchObject({id:monitor,paused:false,rootDomain:'example.com'});
    expect((await(await api('/dashboard','GET',undefined,other)).json() as DashboardData).monitors).toEqual([]);
    expect((await api('/monitors/'+monitor,'DELETE',{},other)).status).toBe(404);
  });
  it('retains the passkey registration and login protocol with a pending account',async()=>{
    const key=authenticator(),options=await api('/auth/register/options','POST',{username:'pg-real-user'});
    expect(options.status).toBe(200);const challenge=await options.json() as {challenge:string};
    const registration=await mf.dispatchFetch(origin+'/api/auth/register/verify',{method:'POST',headers:{Cookie:challengeCookie(options),Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(key.register(challenge.challenge))});
    expect(registration.status).toBe(201);
    const [registered]=await sql.unsafe(`SELECT account_status,is_owner FROM "${schema}".users WHERE username='pg-real-user'`);expect(registered).toMatchObject({account_status:'pending',is_owner:0});
    const login=await api('/auth/login/options','POST',{}),loginOptions=await login.json() as {challenge:string};
    const verification=await mf.dispatchFetch(origin+'/api/auth/login/verify',{method:'POST',headers:{Cookie:challengeCookie(login),Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(key.login(loginOptions.challenge))});
    expect(verification.status).toBe(200);
  });
  it('lists actual accounts and usage with stable numeric and camelCase results',async()=>{
    const response=await api('/owner/accounts');expect(response.status).toBe(200);
    const data=await response.json() as {accounts:{username:string;monitors:number;createdAt:number}[];usage:{activeAccounts:number}};
    expect(data.accounts.find(a=>a.username===owner)).toMatchObject({monitors:1});expect(typeof data.accounts[0].createdAt).toBe('number');expect(data.usage.activeAccounts).toBe(2);
    const infra=await api('/owner/infrastructure');expect(infra.status).toBe(200);const metrics=await infra.json() as {databaseBytes:number;database:{provider:string;applicationBytes:number}};
    expect(metrics.database.provider).toBe('supabase');expect(metrics.databaseBytes).toBeGreaterThan(0);expect(metrics.database.applicationBytes).toBeGreaterThan(0);
    const detailed=metrics as typeof metrics&{supabase:{databaseBytes:number;primaryDatabaseBytes:number;databaseConnections:number;maxConnections:number;tables:unknown[];plans:unknown[]}};
    expect(detailed.supabase.databaseConnections).toBeGreaterThan(0);expect(detailed.supabase.maxConnections).toBeGreaterThan(0);expect(detailed.supabase.tables.length).toBeGreaterThan(19);expect(detailed.supabase.plans).toHaveLength(1);
    expect(detailed.supabase.primaryDatabaseBytes).toBeGreaterThan(0);
    // The project includes PostgreSQL template databases as well as postgres.
    expect(detailed.supabase.databaseBytes).toBeGreaterThan(detailed.supabase.primaryDatabaseBytes);
    expect(metrics.databaseBytes).toBe(detailed.supabase.databaseBytes);
    const live=await api('/dashboard/live?days=90');expect(live.status).toBe(200);
    const liveData=await live.json() as {monitors:{id:string;paused:boolean}[];currentStats:unknown[];limits:{monitors:null}};
    expect(liveData.monitors[0]).toMatchObject({id:monitor,paused:false});expect(liveData.limits.monitors).toBeNull();expect(liveData.currentStats).toEqual([]);
  });
  it('applies an entire batch atomically on constraint failure',async()=>{
    await expect(db.batch([db.prepare("UPDATE monitors SET name='Should roll back' WHERE id=?").bind(monitor),db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES('orphan','missing-user',1)")])).rejects.toThrow();
    expect((await db.prepare('SELECT name FROM monitors WHERE id=?').bind(monitor).first<{name:string}>())!.name).toBe('Servicio PostgreSQL');
  });
  it('stores publication groups, editorial updates, team roles and atomic author audit on PostgreSQL',async()=>{
    const component=randomUUID(),created=await api('/status-pages','POST',{title:'PG launch',description:'Synthetic',accent:'#187356',theme:'light',monitorIds:[monitor],published:true,components:[{id:component,name:'Public component',monitorIds:[monitor]}]});
    expect(created.status).toBe(201);const {id}=await created.json() as {id:string};
    const announcement=await api(`/status-pages/${id}/announcements`,'POST',{title:'Editorial update',severity:'minor',state:'identified',componentIds:[component],message:'Synthetic public content',published:true});expect(announcement.status).toBe(201);
    const publicPage=await api('/public/status/'+id);expect(publicPage.status).toBe(200);const payload=await publicPage.json() as {components:unknown[];announcements:unknown[]};expect(payload.components).toHaveLength(1);expect(payload.announcements).toHaveLength(1);
    const invited=await api('/team/invitations','POST',{username:other,role:'reader'});expect(invited.status).toBe(201);const link=(await invited.json() as {invitationURL:string}).invitationURL,token=new URLSearchParams(new URL(link).hash.slice(1)).get('team');
    expect((await api('/team/accept','POST',{token},other)).status).toBe(200);
    const shared=await mf.dispatchFetch(origin+'/api/dashboard',{headers:{Cookie:cookie(other),'X-Vyrsea-Workspace':owner}});expect(shared.status).toBe(200);
    const denied=await mf.dispatchFetch(origin+'/api/monitors/'+monitor,{method:'PATCH',headers:{Cookie:cookie(other),'X-Vyrsea-Workspace':owner,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({paused:true})});expect(denied.status).toBe(403);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM audit_events WHERE workspace_id=?').bind(owner).first<{n:number}>())!.n).toBeGreaterThan(2);
    expect((await api(`/status-pages/${id}/domain`,'POST',{hostname:'pg.example.org'})).status).toBe(201);
    expect((await api('/status-pages/'+id,'DELETE')).status).toBe(200);
  });
  it('does not count duplicate concurrent Queue deliveries more than once',async()=>{
    const slot=now()-60;const responses=await Promise.all(Array.from({length:4},()=>result(slot)));expect(responses.every(r=>r.status===200)).toBe(true);
    expect((await db.prepare('SELECT count(*) AS n FROM checks WHERE monitor_id=?').bind(monitor).first<{n:number}>())!.n).toBe(1);
    expect((await db.prepare('SELECT sum(total) AS n FROM hourly_stats WHERE monitor_id=?').bind(monitor).first<{n:number}>())!.n).toBe(1);
  });
  it('exports detailed Business report datasets from native PostgreSQL without crossing workspace ownership',async()=>{
    const from=Math.floor(now()/3600)*3600-3600,to=now();
    for(const kind of ['summary','checks','hourly','incidents','maintenance']){
      const response=await api('/reports/export?filter='+encodeURIComponent(JSON.stringify({kind,from,to,domains:[],monitors:[],cursor:null})));expect(response.status).toBe(200);
      const page=await response.json() as {rows:{monitor_id:string;monitor_name:string}[]};expect(page.rows.every(r=>r.monitor_id===monitor)).toBe(true);
    }
  });
  it('stores a result with one network statement and rejects a suspended account even after a probe has started',async()=>{
    const id=randomUUID();await db.prepare('INSERT INTO monitors(id,user_id,name,url,root_domain,next_check_at,created_at) VALUES(?,?,?,?,?,0,?)').bind(id,owner,'One statement','https://single.example.org/','example.org',now()).run();
    const queries:string[]=[],previous=sql.options.debug;sql.options.debug=(_connection,query)=>{queries.push(query);};
    try{await db.recordCheckResult(id,now(),now(),{ok:true,statusCode:200,responseMs:12,error:null});}finally{sql.options.debug=previous;}
    expect(queries).toHaveLength(1);expect(queries[0]).toContain('record_monitor_result');
    const user=randomUUID(),blocked=randomUUID();await db.prepare("INSERT INTO users(id,username,created_at,plan_id,account_status,last_active_at) VALUES(?,?,?,'pro','active',?)").bind(user,user,now(),now()).run();
    await db.prepare('INSERT INTO monitors(id,user_id,name,url,root_domain,next_check_at,created_at) VALUES(?,?,?,?,?,0,?)').bind(blocked,user,'Suspended in flight','https://blocked.example.org/','example.org',now()).run();
    await db.prepare("UPDATE users SET account_status='suspended' WHERE id=?").bind(user).run();
    await db.recordCheckResult(blocked,now(),now(),{ok:true,statusCode:200,responseMs:12,error:null});
    expect((await db.prepare('SELECT count(*) AS n FROM checks WHERE monitor_id=?').bind(blocked).first<{n:number}>())!.n).toBe(0);
  });
  it('enforces the Pro three-seat ceiling across concurrent reservations, acceptance and plan reductions',async()=>{
    const user=randomUUID();await db.prepare("INSERT INTO users(id,username,created_at,plan_id,account_status,last_active_at) VALUES(?,?,?,'pro','active',?)").bind(user,user,now(),now()).run();
    const targets=[owner,other];
    const extra=randomUUID();await db.prepare("INSERT INTO users(id,username,created_at,account_status,last_active_at) VALUES(?,?,?,'active',?)").bind(extra,extra,now(),now()).run();targets.push(extra);
    const invites=await Promise.allSettled(targets.map((target,index)=>db.prepare("INSERT INTO team_invitations(id,workspace_id,user_id,role,token_hash,expires_at) VALUES(?,?,?,'reader',?,?)").bind(randomUUID(),user,target,'pg-seat-'+user+index,now()+3600).run()));
    expect(invites.filter(r=>r.status==='fulfilled')).toHaveLength(2);
    await expect(db.prepare("UPDATE users SET plan_id='starter' WHERE id=?").bind(user).run()).rejects.toThrow('TEAM_CAPACITY');
    const invitation=await db.prepare('SELECT user_id FROM team_invitations WHERE workspace_id=? LIMIT 1').bind(user).first<{user_id:string}>();
    await db.prepare("INSERT INTO team_members(workspace_id,user_id,role,created_at) VALUES(?,?,'reader',?)").bind(user,invitation!.user_id,now()).run();
    expect((await db.prepare('SELECT count(*) AS n FROM team_members WHERE workspace_id=?').bind(user).first<{n:number}>())!.n).toBe(1);
  });
  it('opens one incident after two failures and records its recovery exactly once',async()=>{
    const slot=now();expect((await result(slot+60,false)).status).toBe(200);expect((await result(slot+120,false)).status).toBe(200);
    expect((await db.prepare('SELECT status FROM monitors WHERE id=?').bind(monitor).first<{status:string}>())!.status).toBe('down');
    expect((await result(slot+180,true)).status).toBe(200);
    expect((await db.prepare('SELECT count(*) AS n FROM incidents WHERE monitor_id=? AND resolved_at IS NOT NULL').bind(monitor).first<{n:number}>())!.n).toBe(1);
    expect((await db.prepare('SELECT count(*) AS n FROM notifications WHERE monitor_id=?').bind(monitor).first<{n:number}>())!.n).toBe(2);
  });
  it('queries multiple availability windows, aggregation and public status pages',async()=>{
    const dashboard=await api('/dashboard?days=90');expect(dashboard.status).toBe(200);const data=await dashboard.json() as DashboardData;expect(data.stats.every(s=>typeof s.hour==='number'&&typeof s.total==='number')).toBe(true);
    expect((await api('/monitors/'+monitor+'/availability?days=7')).status).toBe(200);
    const page=await api('/status-pages','POST',{title:'PostgreSQL status',description:'Synthetic test',accent:'#187356',theme:'light',monitorIds:[monitor],published:true});expect(page.status).toBe(201);const{id}=await page.json() as {id:string};
    const published=await api('/public/status/'+id);expect(published.status).toBe(200);expect(await published.text()).not.toContain('https://example.com');expect((await api('/status-pages/'+id,'DELETE')).status).toBe(200);
  });
  it('enforces monitor quotas under concurrent inserts and accepts unlimited owner domains',async()=>{
    const user=randomUUID();await db.prepare("INSERT INTO users(id,username,created_at,account_status,last_active_at) VALUES(?,?,?,'active',?)").bind(user,'pg-quota',now(),now()).run();
    const inserts=await Promise.allSettled([1,2,3].map(i=>db.prepare('INSERT INTO monitors(id,user_id,name,url,root_domain,next_check_at,created_at) VALUES(?,?,?,?,?,0,?)').bind(randomUUID(),user,'Quota '+i,`https://quota${i}.example.org/`,'example.org',now()).run()));
    expect(inserts.filter(r=>r.status==='fulfilled')).toHaveLength(2);
    expect((await db.prepare('SELECT count(*) AS n FROM monitors WHERE user_id=?').bind(user).first<{n:number}>())!.n).toBe(2);
    expect(inserts.filter(r=>r.status==='rejected').map(r=>(r as PromiseRejectedResult).reason.message).join(' ')).toContain('MONITOR_CAPACITY');
  });
  it('retains maintenance exclusion and scheduled cleanup on PostgreSQL',async()=>{
    const window=await api('/monitors/'+monitor+'/maintenance','POST',{startsAt:now(),endsAt:now()+900,reason:'Synthetic maintenance'});expect(window.status).toBe(201);
    const before=(await db.prepare('SELECT count(*) AS n FROM checks WHERE monitor_id=?').bind(monitor).first<{n:number}>())!.n;expect((await result(now()+600)).status).toBe(200);expect((await db.prepare('SELECT count(*) AS n FROM checks WHERE monitor_id=?').bind(monitor).first<{n:number}>())!.n).toBe(before);
    const expired=now()-100*86400;await db.prepare('INSERT INTO checks(id,monitor_id,checked_at,ok,response_ms) VALUES(?,?,?,1,10)').bind('pg-expired',monitor,expired).run();
    const cleanup=await mf.dispatchFetch(origin+'/__test/retention-run',{method:'POST',body:JSON.stringify({start:true,timestamp:now()})});expect(cleanup.status).toBe(200);expect(await db.prepare("SELECT id FROM checks WHERE id='pg-expired'").first()).toBeNull();
  });
  it('preserves all data when PostgreSQL cannot satisfy a transaction',async()=>{
    const before=(await db.prepare('SELECT count(*) AS n FROM checks').first<{n:number}>())!.n;
    await expect(db.batch([db.prepare('DELETE FROM checks'),db.prepare("INSERT INTO monitors(id,user_id,name,url,root_domain,next_check_at,created_at) VALUES('invalid','missing','Bad','https://invalid.example.com','example.com',0,1)")])).rejects.toThrow();
    expect((await db.prepare('SELECT count(*) AS n FROM checks').first<{n:number}>())!.n).toBe(before);
  });
  it('keeps the database schema inaccessible to Supabase public API roles',async()=>{
    const [access]=await sql.unsafe(`SELECT COALESCE((SELECT has_schema_privilege(oid,$1,'USAGE') FROM pg_roles WHERE rolname='anon'),false) AS anonymous,
      COALESCE((SELECT has_schema_privilege(oid,$1,'USAGE') FROM pg_roles WHERE rolname='authenticated'),false) AS authenticated`,[schema]);expect(access).toEqual({anonymous:false,authenticated:false});
  });
  it('reserves and delivers due checks through the real PostgreSQL scheduler',async()=>{
    const id=randomUUID();await db.prepare('INSERT INTO monitors(id,user_id,name,url,root_domain,next_check_at,created_at) VALUES(?,?,?,?,?,0,?)').bind(id,owner,'Scheduler','https://scheduler.example.com/','example.com',now()).run();
    const tick=now();const response=await mf.dispatchFetch(origin+'/__test/storage-cycle',{method:'POST',body:JSON.stringify({timestamp:tick})});
    expect(response.status).toBe(200);expect((await response.json() as {checks:number}).checks).toBeGreaterThan(0);
    expect((await db.prepare('SELECT status,next_check_at FROM monitors WHERE id=?').bind(id).first<{status:string;next_check_at:number}>())!).toMatchObject({status:'up'});
    expect((await db.prepare('SELECT next_check_at AS n FROM monitors WHERE id=?').bind(id).first<{n:number}>())!.n).toBeGreaterThan(tick);
    expect((await db.prepare('SELECT count(*) AS n FROM check_jobs WHERE monitor_id=?').bind(id).first<{n:number}>())!.n).toBe(0);
  });
  it('keeps tickets private, grants only global support, and atomically consumes assisted recovery on PostgreSQL',async()=>{
    const target='pg-support-customer';await db.prepare("INSERT INTO users(id,username,created_at,last_active_at,plan_id,account_status) VALUES(?,?,?,?,'free','pending')").bind(target,target,now(),now()).run();
    await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(createHash('sha256').update(target).digest('base64'),target,now()+3600).run();
    const response=await api('/help/tickets','POST',{subject:'Recover my access',message:'Please assist me with my lost passkey.',category:'access'},target);expect(response.status).toBe(201);const {id}=await response.json() as {id:string};
    expect((await api('/support/tickets','GET',undefined,target)).status).toBe(403);
    expect((await api('/help/tickets/'+id,'GET',undefined,other)).status).toBe(404);
    expect((await api('/support/tickets/'+id+'/messages','POST',{visibility:'internal',message:'Private identity verification note.'})).status).toBe(200);
    const portal=await(await api('/help/tickets/'+id,'GET',undefined,target)).json() as {events:unknown[]};expect(portal.events).toHaveLength(1);
    await db.prepare('INSERT INTO recent_auth(session_hash,user_id,expires_at) VALUES(?,?,?) ON CONFLICT(session_hash) DO UPDATE SET expires_at=excluded.expires_at').bind(createHash('sha256').update(owner).digest('base64'),owner,now()+300).run();
    const approval=await api('/support/tickets/'+id+'/recovery','POST',{verified:true,method:'manual_checks',note:'Previously verified contact and company representation checked.'});expect(approval.status).toBe(200);
    const {url}=await approval.json() as {url:string},token=new URLSearchParams(new URL(url).hash.slice(1)).get('recovery');
    const options=await api('/auth/assisted-recovery/options','POST',{token}),data=await options.json() as {challenge:string};expect(options.status).toBe(200);
    const verification=await mf.dispatchFetch(origin+'/api/auth/assisted-recovery/verify',{method:'POST',headers:{Cookie:challengeCookie(options),Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(authenticator().register(data.challenge))});expect(verification.status).toBe(200);
    expect(await db.prepare('SELECT state,recovery_state,token_hash FROM support_cases WHERE id=?').bind(id).first()).toMatchObject({state:'resolved',recovery_state:'used',token_hash:null});
    expect(await db.prepare('SELECT account_status FROM users WHERE id=?').bind(target).first()).toMatchObject({account_status:'pending'});
    expect((await api('/auth/assisted-recovery/options','POST',{token})).status).toBe(400);
  });
  it('handles parallel unrelated monitors, duplicate deliveries and out-of-order results without corrupting aggregates',async()=>{
    const ids=Array.from({length:4},()=>randomUUID()),slot=now()+900;
    for(const id of ids)await db.prepare('INSERT INTO monitors(id,user_id,name,url,root_domain,next_check_at,created_at) VALUES(?,?,?,?,?,0,?)').bind(id,other,'Parallel',`https://${id}.example.net/`,'example.net',now()).run();
    const work=ids.flatMap(id=>[{id,slot:slot+180,ok:true},{id,slot:slot+60,ok:false},{id,slot:slot+120,ok:false},{id,slot:slot+180,ok:true}]);
    async function lane(){for(;;){const next=work.shift();if(!next)return;expect((await result(next.slot,next.ok,next.id)).status).toBe(200);}}
    await Promise.all(Array.from({length:6},lane));
    for(const id of ids){
      expect(await db.prepare('SELECT last_slot,status,failures FROM monitors WHERE id=?').bind(id).first()).toMatchObject({last_slot:slot+180,status:'up',failures:0});
      const checks=(await db.prepare('SELECT count(*) AS n FROM checks WHERE monitor_id=?').bind(id).first<{n:number}>())!.n;
      expect(checks).toBeGreaterThanOrEqual(1);expect(checks).toBeLessThanOrEqual(3);
      expect((await db.prepare('SELECT sum(total) AS n FROM hourly_stats WHERE monitor_id=?').bind(id).first<{n:number}>())!.n).toBe(checks);
      expect((await db.prepare('SELECT count(*) AS n FROM incidents WHERE monitor_id=? AND resolved_at IS NULL').bind(id).first<{n:number}>())!.n).toBe(0);
    }
  },60000);
});

describe('SQL parameter safety across the PostgreSQL adapter',()=>{
  it('keeps strings and comments untouched while preserving mixed-case results',()=>{
    const query=postgresQuery("SELECT '?' AS question, 'users' AS label, id AS monitorId FROM monitors WHERE id=? -- ? users\n");
    expect(query).toContain("'?' AS question");expect(query).toContain("'users' AS label");expect(query).toContain('AS "monitorId"');expect(query).toContain('"vyrsea".monitors');expect(query).toContain('id=$1');expect(query).toContain('-- ? users');
  });
});
