import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';
import { authenticator } from './webauthn';
import type { AccountUser } from '../shared/accounts';

let mf: Miniflare, db: D1Database;
const origin='http://localhost:5173';
const now=()=>Math.floor(Date.now()/1000);
async function api(path:string, body?:unknown, cookie='', method=body===undefined?'GET':'POST') {
  return mf.dispatchFetch(`${origin}/api${path}`,{method,headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body??{})})});
}
function cookie(response:{headers:{get:(name:string)=>string|null}}, kind='challenge') {return response.headers.get('set-cookie')!.match(new RegExp(`pulso_${kind}=[^;,\\s]+`))![0];}
async function register(username='recover-user'){
  const key=authenticator();const options=await api('/auth/register/options',{username});
  const {challenge}=await options.json() as {challenge:string};
  const result=await api('/auth/register/verify',key.register(challenge),cookie(options));expect(result.status).toBe(201);
  const session=cookie(result,'session');const {user}=await (await api('/me',undefined,session)).json() as {user:AccountUser};
  return {key,session,user};
}
async function reauth(key:ReturnType<typeof authenticator>,session:string){
  const options=await api('/auth/reauth/options',{},session);expect(options.status).toBe(200);
  const {challenge}=await options.json() as {challenge:string};
  const result=await api('/auth/reauth/verify',key.login(challenge),`${session}; ${cookie(options)}`);expect(result.status).toBe(200);
}
async function kit(key:ReturnType<typeof authenticator>,session:string){
  await reauth(key,session);const response=await api('/auth/recovery-codes',{},session);expect(response.status).toBe(200);
  return (await response.json() as {codes:string[]}).codes;
}
async function recoveryOptions(code:string){return api('/auth/recovery/options',{username:'recover-user',code});}
async function login(key:ReturnType<typeof authenticator>){
  const options=await api('/auth/login/options',{});const {challenge}=await options.json() as {challenge:string};
  return api('/auth/login/verify',key.login(challenge),cookie(options));
}
beforeAll(async()=>{
  await build({entryPoints:['worker/index.ts'],bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*'],outfile:'.test-build/recovery-worker.mjs',logLevel:'silent'});
  mf=new Miniflare({cachePersist:`.test-build/re-${process.pid}`,modules:true,scriptPath:'.test-build/recovery-worker.mjs',compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],bindings:{APP_ORIGIN:origin},d1Databases:{DB:'recovery-db'},queueProducers:{CHECK_QUEUE:'recovery-checks'}});
  db=await mf.getD1Database('DB') as unknown as D1Database;
  for(const file of readdirSync('migrations').filter(file=>file.endsWith('.sql')).sort())await db.batch(readFileSync(`migrations/${file}`,'utf8').split(/\n(?=CREATE |PRAGMA |ALTER |DROP |INSERT |UPDATE )/).map(sql=>db.prepare(sql.trim())));
});
beforeEach(async()=>{await db.batch([db.prepare('DELETE FROM users'),db.prepare('DELETE FROM challenges'),db.prepare('DELETE FROM rate_limits')]);});
afterAll(async()=>{await mf?.dispose();});

describe.sequential('Passkey recovery with real WebAuthn signatures and D1',()=>{
  it('requires recent owned passkey verification, stores only hashes and consumes the proof once',async()=>{
    const {key,session}=await register();
    expect((await api('/auth/recovery-codes',{},session)).status).toBe(403);
    const codes=await kit(key,session);expect(codes).toHaveLength(8);expect(new Set(codes).size).toBe(8);
    expect(codes.every(code=>/^VYR-(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/.test(code))).toBe(true);
    const stored=(await db.prepare('SELECT * FROM recovery_codes').all()).results;
    expect(stored).toHaveLength(8);expect(JSON.stringify(stored)).not.toContain('VYR-');
    expect((await api('/auth/recovery-codes',{},session)).status).toBe(403);
    const summary=await (await api('/auth/security',undefined,session)).json();
    expect(summary).toMatchObject({passkeys:[{label:'Passkey'}],recovery:{remaining:8}});
    expect(JSON.stringify(summary)).not.toContain('code_hash');
  });
  it('binds reauthentication to its session and rejects other users and expired proofs',async()=>{
    const {key,session}=await register();const second=cookie(await login(key),'session');
    const options=await api('/auth/reauth/options',{},session);const {challenge}=await options.json() as {challenge:string};
    expect((await api('/auth/reauth/verify',key.login(challenge),`${second}; ${cookie(options)}`)).status).toBe(403);
    const other=await api('/auth/reauth/options',{},session);const body=await other.json() as {challenge:string};
    expect((await api('/auth/reauth/verify',authenticator().login(body.challenge),`${session}; ${cookie(other)}`)).status).toBe(400);
    await reauth(key,session);
    expect((await api('/auth/recovery-codes',{},second)).status).toBe(403);
    await db.prepare('UPDATE recent_auth SET expires_at=?').bind(now()-1).run();
    expect((await api('/auth/recovery-codes',{},session)).status).toBe(403);
  });
  it('adds an independent passkey usable for login without removing the original',async()=>{
    const {key,session}=await register();const backup=authenticator();
    expect((await api('/auth/passkeys/options',{label:'USB'},session)).status).toBe(403);
    await reauth(key,session);const options=await api('/auth/passkeys/options',{label:'Llave USB'},session);
    const {challenge,excludeCredentials}=await options.json() as {challenge:string;excludeCredentials:unknown[]};expect(excludeCredentials).toHaveLength(1);
    const result=await api('/auth/passkeys/verify',backup.register(challenge),`${session}; ${cookie(options)}`);expect(result.status).toBe(201);
    expect((await login(backup)).status).toBe(200);expect((await login(key)).status).toBe(200);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM credentials').first())!.n).toBe(2);
  });
  it('rotates a kit and returns the same error for unknown users and invalid codes',async()=>{
    const {key,session}=await register();const old=await kit(key,session);const current=await kit(key,session);
    const rejected=await recoveryOptions(old[0]);const unknown=await api('/auth/recovery/options',{username:'no-such-user',code:current[0]});
    expect(rejected.status).toBe(400);expect(unknown.status).toBe(400);expect(await rejected.json()).toEqual(await unknown.json());
    expect((await recoveryOptions(current[0].toLowerCase().replaceAll('-',' '))).status).toBe(200);
  });
  it('recovers the existing owner, preserves all entitlements and revokes every old key and session',async()=>{
    const {key,session,user}=await register();await db.prepare("UPDATE users SET account_status='active',is_owner=1,plan_id='business' WHERE id=?").bind(user.id).run();
    const codes=await kit(key,session);const second=cookie(await login(key),'session');
    const staleLogin=await api('/auth/login/options',{});const staleChallenge=await staleLogin.json() as {challenge:string};const staleResponse=key.login(staleChallenge.challenge);
    const replacement=authenticator();const options=await recoveryOptions(codes[0]);const {challenge}=await options.json() as {challenge:string};
    const result=await api('/auth/recovery/verify',replacement.register(challenge),cookie(options));expect(result.status).toBe(200);
    for(const old of [session,second])expect(await (await api('/me',undefined,old)).json()).toEqual({user:null});
    const recovered=await (await api('/me',undefined,cookie(result,'session'))).json() as {user:AccountUser};
    expect(recovered.user).toMatchObject({id:user.id,username:'recover-user',isOwner:true,planId:'business',accountStatus:'active'});
    expect((await login(key)).status).toBe(400);expect((await login(replacement)).status).toBe(200);
    expect((await api('/auth/login/verify',staleResponse,cookie(staleLogin))).status).toBe(400);
    expect((await recoveryOptions(codes[0])).status).toBe(400);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM recovery_codes').first())!.n).toBe(7);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM recent_auth').first())!.n).toBe(0);
  });
  it('does not burn a recovery code or revoke access after invalid attestation or expiration',async()=>{
    const {key,session}=await register();const codes=await kit(key,session);
    let options=await recoveryOptions(codes[0]);let body=await options.json() as {challenge:string};
    const wrongOrigin=authenticator('https://attacker.example');
    expect((await api('/auth/recovery/verify',wrongOrigin.register(body.challenge),cookie(options))).status).toBe(400);
    options=await recoveryOptions(codes[0]);body=await options.json() as {challenge:string};
    await db.prepare('UPDATE challenges SET expires_at=?').bind(now()-1).run();
    expect((await api('/auth/recovery/verify',authenticator().register(body.challenge),cookie(options))).status).toBe(400);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM recovery_codes').first())!.n).toBe(8);
    expect((await login(key)).status).toBe(200);
  });
  it('allows only one concurrent recovery with the same code',async()=>{
    const {key,session}=await register();const codes=await kit(key,session);
    const a=await recoveryOptions(codes[0]),b=await recoveryOptions(codes[0]);
    const ca=await a.json() as {challenge:string},cb=await b.json() as {challenge:string};
    const results=await Promise.all([api('/auth/recovery/verify',authenticator().register(ca.challenge),cookie(a)),api('/auth/recovery/verify',authenticator().register(cb.challenge),cookie(b))]);
    expect(results.map(r=>r.status).sort()).toEqual([200,400]);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM credentials').first())!.n).toBe(1);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM sessions').first())!.n).toBe(1);
  });
  it('rolls back key deletion and session revocation if saving the new credential fails',async()=>{
    const {key,session}=await register();const codes=await kit(key,session);const other=await register('other-user');
    const options=await recoveryOptions(codes[0]);const {challenge}=await options.json() as {challenge:string};
    expect((await api('/auth/recovery/verify',other.key.register(challenge),cookie(options))).status).toBe(500);
    expect((await login(key)).status).toBe(200);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM recovery_codes').first())!.n).toBe(8);
    const me=await (await api('/me',undefined,session)).json() as {user:AccountUser};expect(me.user.username).toBe('recover-user');
  });
  it('invalidates the recent authorization on logout and rejects a sixth passkey atomically',async()=>{
    const {key,session,user}=await register();
    for(let i=0;i<4;i++)await db.prepare('INSERT INTO credentials(id,user_id,public_key,counter,transports) SELECT ?,user_id,public_key,counter,transports FROM credentials WHERE user_id=? LIMIT 1').bind(`fixture-${i}`,user.id).run();
    await reauth(key,session);expect((await api('/auth/passkeys/options',{label:'Sixth'},session)).status).toBe(409);
    await expect(db.prepare("INSERT INTO credentials(id,user_id,public_key,counter,transports) VALUES('sixth',?,'unused',0,'[]')").bind(user.id).run()).rejects.toThrow(/CREDENTIAL_CAPACITY/);
    await reauth(key,session);await api('/auth/logout',{},session);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM recent_auth').first())!.n).toBe(0);
    expect((await api('/auth/recovery-codes',{},session)).status).toBe(401);
  });
  it.each(['pending','suspended'] as const)('keeps %s accounts subject to owner approval after recovery',async status=>{
    const {key,session,user}=await register();await db.prepare('UPDATE users SET account_status=? WHERE id=?').bind(status,user.id).run();
    const codes=await kit(key,session);const options=await recoveryOptions(codes[0]);const {challenge}=await options.json() as {challenge:string};
    const response=await api('/auth/recovery/verify',authenticator().register(challenge),cookie(options));expect(response.status).toBe(200);
    const newCookie=cookie(response,'session');const me=await (await api('/me',undefined,newCookie)).json() as {user:AccountUser};expect(me.user.accountStatus).toBe(status);
    expect((await api('/dashboard',undefined,newCookie)).status).toBe(403);
  });
  it('rejects cross-origin recovery and stops repeated guesses',async()=>{
    const input={username:'recover-user',code:'VYR-'+Array(8).fill('AAAA').join('-')};
    const cross=await mf.dispatchFetch(`${origin}/api/auth/recovery/options`,{method:'POST',headers:{Origin:'https://attacker.example','Content-Type':'application/json'},body:JSON.stringify(input)});expect(cross.status).toBe(403);
    for(let i=0;i<8;i++)expect((await api('/auth/recovery/options',input)).status).toBe(400);
    expect((await api('/auth/recovery/options',input)).status).toBe(429);
  });
});
