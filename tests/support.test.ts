import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {Miniflare} from 'miniflare';
import {build} from 'esbuild';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {authenticator} from './webauthn';
import type {SupportDetail,SupportTicket} from '../shared/support';
let mf:Miniflare,db:D1Database;
const origin='http://localhost:5173',now=()=>Math.floor(Date.now()/1000),hash=(v:string)=>createHash('sha256').update(v).digest('base64');
const session=(id='owner')=>'pulso_session=support-'+id;
async function api(path:string,method='GET',body?:unknown,cookie=session()){return mf.dispatchFetch(origin+'/api'+path,{method,headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body??{})})});}
async function test(path:string,body:unknown){return mf.dispatchFetch(origin+'/__test/'+path,{method:'POST',body:JSON.stringify(body)});}
const challengeCookie=(r:{headers:{get:(s:string)=>string|null}})=>r.headers.get('set-cookie')!.match(/pulso_challenge=[^;,\s]+/)![0];
const input={subject:'No puedo acceder a mi cuenta',message:'He perdido mi dispositivo y necesito ayuda para recuperar el acceso.',category:'access',email:'cliente@example.com',name:'Cliente'};
async function ticket(user='customer'){const r=await api('/help/tickets','POST',input,session(user));expect(r.status).toBe(201);return await r.json() as {id:string;publicRef:string};}
async function proof(){await db.prepare('INSERT INTO recent_auth(session_hash,user_id,expires_at) VALUES(?,?,?) ON CONFLICT(session_hash) DO UPDATE SET expires_at=excluded.expires_at').bind(hash('support-owner'),'owner',now()+300).run();}
async function authorize(id:string){await proof();const r=await api('/support/tickets/'+id+'/recovery','POST',{verified:true,method:'manual_checks',note:'Identidad comprobada mediante el contacto previamente verificado.'});expect(r.status).toBe(200);const body=await r.json() as {url:string};return new URLSearchParams(new URL(body.url).hash.slice(1)).get('recovery')!;}
beforeAll(async()=>{
 await build({entryPoints:['tests/worker-harness.ts'],bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*'],outfile:'.test-build/support-worker.mjs',logLevel:'silent'});
 mf=new Miniflare({cachePersist:`.test-build/support-${process.pid}`,modules:true,scriptPath:'.test-build/support-worker.mjs',compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],bindings:{APP_ORIGIN:origin},d1Databases:{DB:'support-db'},queueProducers:{CHECK_QUEUE:'support-checks'}});
 db=await mf.getD1Database('DB') as unknown as D1Database;
 for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())await db.batch(readFileSync('migrations/'+file,'utf8').split(/\n(?=CREATE |PRAGMA |ALTER |DROP |INSERT |UPDATE )/).map(s=>db.prepare(s.trim())));
});
beforeEach(async()=>{
 await db.batch([db.prepare('DELETE FROM support_cases'),db.prepare('DELETE FROM users'),db.prepare('DELETE FROM rate_limits'),db.prepare('DELETE FROM challenges')]);
 for(const id of ['owner','customer','other','agent','pending']){
  await db.prepare("INSERT INTO users(id,username,created_at,last_active_at,plan_id,account_status,is_owner,domain_limit,monitor_limit,history_days_limit) VALUES(?,?,?,?,'business',?,?,5,10,90)").bind(id,id,now(),now(),id==='pending'?'pending':'active',id==='owner'?1:0).run();
  await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(hash('support-'+id),id,now()+3600).run();
 }
 await db.prepare("INSERT INTO platform_staff(user_id,granted_by,created_at) VALUES('agent','owner',?)").bind(now()).run();
});
afterAll(async()=>{await mf?.dispose();});
describe.sequential('Support CRM, customer isolation and assisted passkey recovery',()=>{
 it('separates global support from workspace permissions and applies revocation immediately',async()=>{
  for(const user of ['customer','pending'])expect((await api('/support/tickets','GET',undefined,session(user))).status).toBe(403);
  expect((await api('/support/tickets','GET',undefined,'')).status).toBe(401);
  expect((await api('/support/meta','GET',undefined,session('agent'))).status).toBe(200);
  expect((await api('/owner/accounts','GET',undefined,session('agent'))).status).toBe(403);
  await db.prepare("DELETE FROM platform_staff WHERE user_id='agent'").run();
  expect((await api('/support/meta','GET',undefined,session('agent'))).status).toBe(403);
 });
 it('allows pending users to request help without giving them monitor access, hides internal notes and prevents IDOR',async()=>{
  const {id}=await ticket('pending');
  expect((await api('/dashboard','GET',undefined,session('pending'))).status).toBe(403);
  expect((await api('/help/tickets/'+id,'GET',undefined,session('customer'))).status).toBe(404);
  expect((await api('/help/tickets/'+id+'/messages','POST',{message:'Intrusión'},session('customer'))).status).toBe(404);
  expect((await api('/support/tickets/'+id+'/messages','POST',{visibility:'internal',message:'Comprobación reservada de soporte'},session('agent'))).status).toBe(200);
  const reply=await api('/support/tickets/'+id+'/messages','POST',{visibility:'public',message:'Hemos recibido tu consulta.'},session('agent'));expect(await reply.json()).toMatchObject({emailState:'disabled'});
  const portal=await(await api('/help/tickets/'+id,'GET',undefined,session('pending'))).json() as SupportDetail;
  expect(portal.events).toHaveLength(2);expect(JSON.stringify(portal)).not.toContain('Comprobación reservada');expect(JSON.stringify(portal)).not.toContain('token_hash');
  expect((await api('/help/tickets/'+id+'/messages','POST',{message:'Gracias por la respuesta.'},session('pending'))).status).toBe(200);
  expect((await db.prepare('SELECT state FROM support_cases WHERE id=?').bind(id).first())!.state).toBe('open');
 });
 it('creates public contact tickets with no account binding, rejects injected fields and spam honeypots',async()=>{
  const r=await api('/public/contact','POST',{...input,website:''},'');expect(r.status).toBe(201);expect(Object.keys(await r.json() as object)).toEqual(['publicRef']);
  expect((await db.prepare('SELECT user_id,channel FROM support_cases').first())).toMatchObject({user_id:null,channel:'contact'});
  expect((await api('/public/contact','POST',{...input,website:'spam'},'')).status).toBe(400);
  expect((await api('/public/contact','POST',{...input,userId:'owner'},'')).status).toBe(400);
  expect((await api('/public/contact','POST',input,'')).status).toBe(429);
 });
 it('assigns and resolves tickets with an audit trail, rejecting arbitrary assignees',async()=>{
  const {id}=await ticket();
  expect((await api('/support/tickets/'+id,'PATCH',{state:'waiting',priority:'high',assigneeId:'customer'})).status).toBe(400);
  expect((await api('/support/tickets/'+id,'PATCH',{state:'resolved',priority:'urgent',assigneeId:'agent'})).status).toBe(200);
  const detail=await(await api('/support/tickets/'+id)).json() as SupportDetail;expect(detail.ticket).toMatchObject({state:'resolved',priority:'urgent',assigneeId:'agent'});expect(detail.events.some(e=>e.kind==='management')).toBe(true);
 });
 it('requires owner reauthentication and an existing passkey to grant global support; agents cannot promote others',async()=>{
  expect((await api('/support/staff/customer','PUT',{enabled:true},session('agent'))).status).toBe(403);
  expect((await api('/support/staff/customer','PUT',{enabled:true})).status).toBe(409);
  await db.prepare("INSERT INTO credentials(id,user_id,public_key,counter,transports,created_at) VALUES('fixture','customer','AA==',0,'[]',?)").bind(now()).run();
  expect((await api('/support/staff/customer','PUT',{enabled:true})).status).toBe(403);
  await proof();expect((await api('/support/staff/customer','PUT',{enabled:true})).status).toBe(200);
  expect((await api('/support/meta','GET',undefined,session('customer'))).status).toBe(200);
  expect((await api('/support/staff/customer','PUT',{enabled:false})).status).toBe(403);
  await proof();expect((await api('/support/staff/customer','PUT',{enabled:false})).status).toBe(200);
  expect((await api('/support/meta','GET',undefined,session('customer'))).status).toBe(403);
 });
 it('requires documented identity checks and owner proof; protects owner and support accounts',async()=>{
  const {id}=await ticket();
  const valid={verified:true,method:'manual_checks',note:'Identidad comprobada por un canal de confianza.'};
  expect((await api('/support/tickets/'+id+'/recovery','POST',valid,session('agent'))).status).toBe(403);
  expect((await api('/support/tickets/'+id+'/recovery','POST',valid)).status).toBe(403);
  expect((await api('/support/tickets/'+id+'/recovery','POST',{...valid,verified:false})).status).toBe(400);
  for(const user of ['owner','agent']){const t=await ticket(user);expect((await api('/support/tickets/'+t.id+'/recovery','POST',valid)).status).toBe(409);}
 });
 it('registers a new real passkey atomically, revokes old access, preserves approval, consumes the link once',async()=>{
  await db.prepare("INSERT INTO credentials(id,user_id,public_key,counter,transports,created_at) VALUES('old-key','pending','AA==',0,'[]',?)").bind(now()).run();
  const {id}=await ticket('pending'),token=await authorize(id),replacement=authenticator();
  const stored=await db.prepare('SELECT token_hash,recovery_state FROM support_cases WHERE id=?').bind(id).first();expect(stored).toMatchObject({token_hash:hash(token),recovery_state:'approved'});expect(JSON.stringify(stored)).not.toContain(token);
  await expect(db.prepare("INSERT INTO platform_staff(user_id,granted_by,created_at) VALUES('pending','owner',?)").bind(now()).run()).rejects.toThrow(/SUPPORT_RECOVERY_CONFLICT/);
  const options=await api('/auth/assisted-recovery/options','POST',{token},''),{challenge}=await options.json() as {challenge:string};expect(options.status).toBe(200);
  const result=await api('/auth/assisted-recovery/verify','POST',replacement.register(challenge),challengeCookie(options));expect(result.status).toBe(200);
  expect(await(await api('/me','GET',undefined,session('pending'))).json()).toEqual({user:null});
  expect((await db.prepare("SELECT id FROM credentials WHERE user_id='pending'").all()).results).toHaveLength(1);
  expect((await db.prepare("SELECT account_status,is_owner FROM users WHERE id='pending'").first())).toMatchObject({account_status:'pending',is_owner:0});
  expect((await db.prepare('SELECT recovery_state,token_hash,state FROM support_cases WHERE id=?').bind(id).first())).toMatchObject({recovery_state:'used',token_hash:null,state:'resolved'});
  expect((await api('/auth/assisted-recovery/options','POST',{token},'')).status).toBe(400);
 });
 it('rejects expired, replaced and revoked links and never deletes keys after an invalid registration',async()=>{
  const {id}=await ticket(),old=await authorize(id),token=await authorize(id);
  expect((await api('/auth/assisted-recovery/options','POST',{token:old},'')).status).toBe(400);
  const options=await api('/auth/assisted-recovery/options','POST',{token},'');
  expect((await api('/auth/assisted-recovery/verify','POST',{},challengeCookie(options))).status).toBe(400);
  expect((await db.prepare('SELECT recovery_state FROM support_cases WHERE id=?').bind(id).first())!.recovery_state).toBe('approved');
  await db.prepare('UPDATE support_cases SET expires_at=? WHERE id=?').bind(now()-1,id).run();expect((await api('/auth/assisted-recovery/options','POST',{token},'')).status).toBe(400);
  const current=await authorize(id);await api('/support/tickets/'+id+'/recovery/revoke','POST',{},session('agent'));expect((await api('/auth/assisted-recovery/options','POST',{token:current},'')).status).toBe(400);
 });
 it('allows only one of two concurrent valid recovery registrations to commit',async()=>{
  const {id}=await ticket(),token=await authorize(id);
  const options=await Promise.all([api('/auth/assisted-recovery/options','POST',{token},''),api('/auth/assisted-recovery/options','POST',{token},'')]);
  const results=await Promise.all(options.map(async r=>{const {challenge}=await r.json() as {challenge:string};return api('/auth/assisted-recovery/verify','POST',authenticator().register(challenge),challengeCookie(r));}));
  expect(results.map(r=>r.status).sort()).toEqual([200,400]);expect((await db.prepare("SELECT count(*) AS n FROM credentials WHERE user_id='customer'").first())!.n).toBe(1);
 });
 it('rolls back a recovery claim, key deletion and session revocation when the new key cannot be saved',async()=>{
  const key=authenticator(),collision=key.register('fixture').id;
  await db.prepare("INSERT INTO credentials(id,user_id,public_key,counter,transports) VALUES('keep-existing','customer','AA==',0,'[]')").run();
  await db.prepare("INSERT INTO credentials(id,user_id,public_key,counter,transports) VALUES(?,'other','AA==',0,'[]')").bind(collision).run();
  const {id}=await ticket(),token=await authorize(id),options=await api('/auth/assisted-recovery/options','POST',{token},''),{challenge}=await options.json() as {challenge:string};
  expect((await api('/auth/assisted-recovery/verify','POST',key.register(challenge),challengeCookie(options))).status).toBe(500);
  expect(await db.prepare("SELECT id FROM credentials WHERE user_id='customer'").first()).toMatchObject({id:'keep-existing'});
  expect(await(await api('/me','GET',undefined,session('customer'))).json()).toMatchObject({user:{id:'customer'}});
  expect(await db.prepare('SELECT recovery_state,token_hash FROM support_cases WHERE id=?').bind(id).first()).toMatchObject({recovery_state:'approved',token_hash:hash(token)});
 });
 it('forwards original incoming emails, deduplicates deliveries and threads replies only for the same sender',async()=>{
  const raw='From: Cliente <cliente@example.com>\r\nTo: soporte@vyrsea.com\r\nSubject: Problema al acceder\r\nMessage-ID: <one@example.com>\r\n\r\nNo puedo entrar en mi cuenta.';
  for(let i=0;i<2;i++)expect(await(await test('support-email',{raw})).json()).toMatchObject({forwarded:1});
  const tickets=(await db.prepare('SELECT id,public_ref,user_id,channel FROM support_cases').all()).results;expect(tickets).toHaveLength(1);expect(tickets[0]).toMatchObject({user_id:null,channel:'email'});
  const reply=raw.replace('Problema al acceder','Re: '+tickets[0].public_ref).replace('one@example.com','two@example.com');
  await test('support-email',{raw:reply});await test('support-email',{raw:reply});expect((await db.prepare('SELECT count(*) AS n FROM support_events').first())!.n).toBe(2);
  await test('support-email',{raw:reply.replaceAll('cliente@example.com','otro@example.com')});expect((await db.prepare('SELECT count(*) AS n FROM support_cases').first())!.n).toBe(2);
  expect(await(await test('support-email',{raw,size:300000})).json()).toMatchObject({forwarded:1});expect(await(await test('support-email',{raw,enabled:false})).json()).toMatchObject({forwarded:1});
 });
 it('does not query or send mail from the minute Cron while support email is disabled',async()=>{
  const metrics=await(await test('support-dispatch',{})).json();expect(metrics).toMatchObject({queries:0});
 });
});
