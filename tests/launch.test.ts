import {beforeAll,beforeEach,afterAll,describe,it,expect} from 'vitest';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash,createHmac,randomUUID} from 'node:crypto';
let mf:Miniflare,db:D1Database;
const origin='http://localhost:5173',now=()=>Math.floor(Date.now()/1000),hash=(value:string)=>createHash('sha256').update(value).digest('base64');
let webhookCalls:{body:string;headers:Headers}[]=[],webhookFailure=false,txt='';
const monitor=randomUUID(),zone='a'.repeat(32);
async function api(path:string,method='GET',body?:unknown,user='owner',workspace=''){
 return mf.dispatchFetch(origin+'/api'+path,{method,headers:{Cookie:'pulso_session='+user,Origin:origin,'Content-Type':'application/json',...(workspace?{'X-Vyrsea-Workspace':workspace}:{})},...(method==='GET'?{}:{body:JSON.stringify(body??{})})});
}
async function dispatch(mode='ok',timestamp=now()){return mf.dispatchFetch(origin+'/__test/dispatch-alerts',{method:'POST',body:JSON.stringify({mode,timestamp})});}
async function page(){const result=await api('/status-pages','POST',{title:'Estado público',description:'Servicios',accent:'#187356',theme:'light',monitorIds:[monitor],published:true,components:[{id:'90000000-0000-4000-8000-000000000001',name:'Tienda online',monitorIds:[monitor]}]});expect(result.status).toBe(201);return (await result.json() as {id:string}).id;}
async function notification(id='cycle:down'){await db.prepare("INSERT INTO notifications(id,user_id,monitor_id,kind,message,created_at) VALUES(?,'owner',?,'down','Cambio sintético',?)").bind(id,monitor,now()+1).run();}
beforeAll(async()=>{
 await build({entryPoints:['tests/launch-harness.ts'],bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*'],outfile:'.test-build/launch-worker.mjs',logLevel:'silent'});
 mf=new Miniflare({cachePersist:`.test-build/launch-cache-${process.pid}`,modules:true,scriptPath:'.test-build/launch-worker.mjs',compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],bindings:{APP_ORIGIN:origin,ALERTS_ENABLED:'1',ALERTS_ENCRYPTION_KEY:Buffer.alloc(32,17).toString('base64'),EMAIL_FROM:'alerts@notify.example.org',EMAIL_EVENTS_ENABLED:'1',CLOUDFLARE_EMAIL_ZONE_ID:zone},d1Databases:{DB:'launch-db'},queueProducers:{CHECK_QUEUE:'launch-checks'},outboundService:async(request:Request)=>{
   if(request.url.startsWith('https://cloudflare-dns.com/'))return Response.json({Status:0,Answer:new URL(request.url).searchParams.get('type')==='TXT'?[{type:16,data:JSON.stringify(txt)}]:[{type:1,data:'1.1.1.1'}]});
   expect(request.url).toBe('https://hooks.example.org/alerts');const body=await request.text();webhookCalls.push({body,headers:request.headers});const value=JSON.parse(body);
   return webhookFailure?new Response('Temporary error',{status:503}):Response.json(value.challenge?{challenge:value.challenge}:{ok:true});
 }});db=await mf.getD1Database('DB') as unknown as D1Database;
 for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())await db.batch(readFileSync('migrations/'+file,'utf8').split(/\n(?=CREATE |PRAGMA |ALTER |DROP |INSERT |UPDATE )/).map(s=>db.prepare(s.trim())));
});
beforeEach(async()=>{
 await db.batch([db.prepare('DELETE FROM users'),db.prepare('DELETE FROM rate_limits'),db.prepare('DELETE FROM email_receipts')]);webhookCalls=[];webhookFailure=false;txt='';
 for(const name of ['owner','member','other']){await db.prepare("INSERT INTO users(id,username,created_at,plan_id,account_status,is_owner,last_active_at,domain_limit,monitor_limit,history_days_limit) VALUES(?,?,?,?,'active',?,?,20,100,90)").bind(name,name,now(),name==='owner'?'business':'free',name==='owner'?1:0,now()).run();await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(hash(name),name,now()+3600).run();}
 await db.prepare("INSERT INTO monitors(id,user_id,name,url,root_domain,next_check_at,created_at,last_checked_at,status) VALUES(?,'owner','API privada','https://secret.example.org/private?key=hidden','example.org',0,?,?,'up')").bind(monitor,now(),now()).run();
});
afterAll(async()=>{await mf?.dispose();});
describe.sequential('Commercial preparation without paid activation',()=>{
 it('rolls back a product change when its author audit cannot be saved',async()=>{
   await db.prepare("CREATE TRIGGER audit_fixture_failure BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'SYNTHETIC_AUDIT_FAILURE'); END").run();
   try{expect((await api('/monitors/'+monitor,'PATCH',{name:'Must roll back'})).status).toBe(500);expect((await db.prepare('SELECT name FROM monitors WHERE id=?').bind(monitor).first())!.name).toBe('API privada');}
   finally{await db.prepare('DROP TRIGGER audit_fixture_failure').run();}
 });
 it('groups selected public services and publishes a separate, escaped incident chronology',async()=>{
   const id=await page(),component='90000000-0000-4000-8000-000000000001';
   const created=await api('/status-pages/'+id+'/announcements','POST',{title:'Incidencia editorial',severity:'major',state:'investigating',componentIds:[component],message:'<script>not executable</script>',published:false});expect(created.status).toBe(201);
   const incident=(await created.json() as {id:string}).id;
   const read=()=>mf.dispatchFetch(origin+'/api/public/status/'+id);
   expect((await(await read()).json() as {announcements:unknown[]}).announcements).toEqual([]);
   expect((await api(`/status-pages/${id}/announcements/${incident}/updates`,'POST',{state:'monitoring',message:'Observamos la recuperación',published:true})).status).toBe(200);
   const response=await read(),text=await response.text(),value=JSON.parse(text);expect(value.components[0]).toMatchObject({name:'Tienda online',status:'up'});expect(value.announcements[0]).toMatchObject({state:'monitoring',severity:'major'});expect(value.announcements[0].updates).toHaveLength(2);expect(text).not.toContain('hidden');expect(text).not.toContain(monitor);
   expect((await db.prepare('SELECT status FROM monitors WHERE id=?').bind(monitor).first())!.status).toBe('up');
   const audit=(await db.prepare("SELECT actor_name FROM audit_events WHERE workspace_id='owner'").all()).results;expect(audit.length).toBeGreaterThanOrEqual(3);expect(audit.every(row=>row.actor_name==='owner')).toBe(true);
 });
 it('requires Business membership acceptance, enforces all roles and revokes access on the next request',async()=>{
   const invited=await api('/team/invitations','POST',{username:'member',role:'reader'});expect(invited.status).toBe(201);const link=(await invited.json() as {invitationURL:string}).invitationURL,token=new URLSearchParams(new URL(link).hash.slice(1)).get('team');
   expect((await api('/dashboard','GET',undefined,'member','owner')).status).toBe(403);
   expect((await api('/team/accept','POST',{token},'other')).status).toBe(409);
   const accepted=await Promise.all([api('/team/accept','POST',{token},'member'),api('/team/accept','POST',{token},'member')]);expect(accepted.map(r=>r.status).sort()).toEqual([200,409]);
   const shared=await api('/dashboard','GET',undefined,'member','owner');expect(shared.status).toBe(200);const data=await shared.json() as {user:{id:string;isOwner:boolean};workspace:{role:string};monitors:{id:string}[]};expect(data.user.id).toBe('member');expect(data.user.isOwner).toBe(false);expect(data.workspace.role).toBe('reader');expect(data.monitors[0].id).toBe(monitor);
   expect((await api('/monitors/'+monitor,'PATCH',{paused:true},'member','owner')).status).toBe(403);expect((await api('/owner/accounts','GET',undefined,'member','owner')).status).toBe(403);expect((await api('/alerts','GET',undefined,'member','owner')).status).toBe(403);
   expect((await api('/team/members/member','PATCH',{role:'operator'})).status).toBe(200);expect((await api('/monitors/'+monitor,'PATCH',{name:'Operator changed'},'member','owner')).status).toBe(200);expect((await api('/monitors/'+monitor,'DELETE',{},'member','owner')).status).toBe(403);expect((await api('/team/invitations','POST',{username:'other',role:'admin'},'member','owner')).status).toBe(403);
   expect((await db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE actor_name='member' AND workspace_id='owner'").first())!.n).toBeGreaterThan(0);
   await api('/team/members/member','PATCH',{role:'admin'});expect((await api('/team/members','GET',undefined,'member','owner')).status).toBe(200);
   await api('/team/members/member','DELETE');expect((await api('/dashboard','GET',undefined,'member','owner')).status).toBe(403);expect((await api('/workspaces','GET',undefined,'member','owner')).status).toBe(200);
 });
 it('encrypts webhook secrets, verifies destinations, signs deliveries and deduplicates notification fanout',async()=>{
   const created=await api('/alerts','POST',{kind:'webhook',target:'https://hooks.example.org/alerts'});expect(created.status).toBe(201);const value=await created.json() as {id:string;secret:string};
   const stored=await db.prepare('SELECT secret_cipher FROM alert_destinations WHERE id=?').bind(value.id).first();expect(stored!.secret_cipher).not.toContain(value.secret);expect(await(await api('/alerts')).text()).not.toContain(value.secret);
   expect((await api('/alerts/'+value.id+'/verify','POST')).status).toBe(200);await notification();await dispatch();await dispatch();expect(webhookCalls).toHaveLength(2);
   const last=webhookCalls.at(-1)!,time=last.headers.get('X-Vyrsea-Timestamp'),id=last.headers.get('X-Vyrsea-Event-Id');expect(last.headers.get('X-Vyrsea-Signature')).toBe('v1,'+createHmac('sha256',value.secret).update(`${time}.${id}.${last.body}`).digest('base64'));
   expect((await db.prepare('SELECT state,attempts FROM alert_deliveries').first())).toMatchObject({state:'delivered',attempts:1});
 });
 it('retries temporary webhook failures with a stable event ID and rejects internal or redirected destinations',async()=>{
   expect((await api('/alerts','POST',{kind:'webhook',target:'http://hooks.example.org/alerts'})).status).toBe(400);expect((await api('/alerts','POST',{kind:'webhook',target:'https://127.0.0.1/'})).status).toBe(400);
   const id=(await(await api('/alerts','POST',{kind:'webhook',target:'https://hooks.example.org/alerts'})).json() as {id:string}).id;await api('/alerts/'+id+'/verify','POST');await notification();webhookFailure=true;await dispatch();expect((await db.prepare('SELECT state,attempts FROM alert_deliveries').first())).toMatchObject({state:'pending',attempts:1});webhookFailure=false;await dispatch('ok',now()+61);expect((await db.prepare('SELECT state,attempts FROM alert_deliveries').first())).toMatchObject({state:'delivered',attempts:2});
   expect(webhookCalls.at(-1)!.headers.get('X-Vyrsea-Event-Id')).toBe('cycle:down');
 });
 it('requires email confirmation, tracks Cloudflare queue receipts and handles receipt-before-send races',async()=>{
   const id=(await(await api('/alerts','POST',{kind:'email',target:'synthetic@example.net'})).json() as {id:string}).id;
   expect((await api('/alerts/'+id+'/verify','POST')).status).toBe(200);const sent=await(await dispatch()).json() as {sent:{text:string}[]};expect(sent.sent).toHaveLength(1);
   const token=new URLSearchParams(new URL(sent.sent[0].text.split(' ').at(-1)!).hash.slice(1)).get('confirm-email');expect((await api('/public/alerts/confirm','POST',{token})).status).toBe(200);expect((await api('/public/alerts/confirm','POST',{token})).status).toBe(409);
   const delivery=await db.prepare('SELECT provider_id FROM alert_deliveries').first<{provider_id:string}>();
   const event={type:'cf.email.sending.message.delivered',source:{type:'email.sending',zoneId:zone,domain:'notify.example.org'},payload:{messageId:delivery!.provider_id,recipient:'synthetic@example.net',terminal:true,delivery:{status:'delivered'}}};
   const receipt=()=>mf.dispatchFetch(origin+'/__test/email-event',{method:'POST',body:JSON.stringify(event)});expect((await receipt()).status).toBe(200);expect((await receipt()).status).toBe(200);expect((await db.prepare('SELECT state FROM alert_deliveries').first())!.state).toBe('delivered');
   await notification();await dispatch('bounce-first');expect((await db.prepare("SELECT state FROM alert_deliveries WHERE event_id='cycle:down'").first())!.state).toBe('failed');expect((await db.prepare('SELECT enabled FROM alert_destinations').first())!.enabled).toBe(0);
   event.source.zoneId='b'.repeat(32);expect((await receipt()).status).toBe(400);
 });
 it('does not blindly resend an email whose acceptance is uncertain',async()=>{
   const id=(await(await api('/alerts','POST',{kind:'email',target:'synthetic@example.net'})).json() as {id:string}).id;await api('/alerts/'+id+'/verify','POST');await dispatch('rate');expect((await db.prepare('SELECT state,attempts FROM alert_deliveries').first())).toMatchObject({state:'pending',attempts:1});await dispatch('uncertain',now()+61);expect((await db.prepare('SELECT state,attempts FROM alert_deliveries').first())).toMatchObject({state:'uncertain',attempts:2});await dispatch('ok',now()+500);expect((await db.prepare('SELECT attempts FROM alert_deliveries').first())!.attempts).toBe(2);
 });
 it('prepares and verifies a custom domain without provisioning paid services or exposing another account',async()=>{
   const id=await page();expect((await api('/status-pages/'+id+'/domain','POST',{hostname:'estado.customer.example.org'})).status).toBe(201);
   const data=await(await api('/status-pages/'+id+'/domain')).json() as {ready:boolean;domain:{verificationValue:string}};expect(data.ready).toBe(false);txt=data.domain.verificationValue;
   expect((await api('/status-pages/'+id+'/domain/verify','POST')).status).toBe(200);expect((await api('/status-pages/'+id+'/domain/provision','POST')).status).toBe(503);
   expect((await api('/status-pages/'+id+'/domain','GET',undefined,'member')).status).toBe(403);expect((await api('/status-pages/'+id+'/announcements','GET',undefined,'member')).status).toBe(403);
   expect((await mf.dispatchFetch('https://estado.customer.example.org/')).status).toBe(404);
 });
});
