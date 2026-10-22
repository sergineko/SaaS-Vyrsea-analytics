import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { readFileSync,readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseInfrastructure,infrastructureQuery } from '../worker/infrastructure';
import { projectDailyUsage,type InfrastructureData } from '../shared/infrastructure';
let mf:Miniflare,calls=0;const now=Math.floor(Date.now()/1000),origin='http://localhost:5173';
const fixture={d1ProjectRecent:[{sum:{rowsRead:90,rowsWritten:30}}],queuesProject:[{sum:{billableOperations:300}}],queuesAccount:[{sum:{billableOperations:600}}],queuesRecent:[{sum:{billableOperations:90}}],d1Project:[{sum:{rowsRead:400,rowsWritten:200}}],d1Account:[{sum:{rowsRead:700,rowsWritten:300}}],d1Recent:[{sum:{rowsRead:150,rowsWritten:75}}],workersProject:[{sum:{requests:100,errors:2},quantiles:{cpuTimeP50:5000}}],workersAccount:[{sum:{requests:300}}],workersRecent:[{sum:{requests:15}}],queueDelay:[{avg:{lagTime:6000,retryCount:0}}],storage:[{max:{databaseSizeBytes:1048576}}]};
beforeAll(async()=>{
  await build({entryPoints:['worker/index.ts'],bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*'],outfile:'.test-build/infrastructure-worker.mjs',logLevel:'silent'});
  mf=new Miniflare({cachePersist:`.test-build/c-${process.pid}`,modules:true,scriptPath:'.test-build/infrastructure-worker.mjs',compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],bindings:{APP_ORIGIN:origin,CLOUDFLARE_ANALYTICS_TOKEN:'fixture-token-never-returned',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_D1_ID:'b'.repeat(32),CLOUDFLARE_QUEUE_ID:'c'.repeat(32),CLOUDFLARE_SCRIPT_NAME:'vyrsea-monitor'},d1Databases:{DB:'infrastructure-db'},queueProducers:{CHECK_QUEUE:'infra-checks'},outboundService:async(request:{url:string})=>{
    expect(request.url).toBe('https://api.cloudflare.com/client/v4/graphql');calls++;return Response.json({data:{viewer:{accounts:[fixture]}},errors:null});
  }});
  const db=await mf.getD1Database('DB') as unknown as D1Database;
  for(const file of readdirSync('migrations').filter(file=>file.endsWith('.sql')).sort())await db.batch(readFileSync(`migrations/${file}`,'utf8').split(/\n(?=CREATE |PRAGMA |ALTER |DROP |INSERT |UPDATE )/).map(sql=>db.prepare(sql.trim())));
  for(const [id,owner] of [['owner',1],['member',0]] as const){await db.prepare("INSERT INTO users(id,username,created_at,account_status,is_owner,last_active_at) VALUES(?,?,?,'active',?,?)").bind(id,id,now,owner,now).run();await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(createHash('sha256').update(id).digest('base64'),id,now+3600).run();}
});
afterAll(async()=>{await mf?.dispose();});
async function api(id='owner'){return mf.dispatchFetch(origin+'/api/owner/infrastructure',{headers:{Cookie:`pulso_session=${id}`}});}
describe.sequential('Cloudflare usage telemetry',()=>{
  it('limits real metrics to the active owner, caches analytics and never exposes credentials',async()=>{
    expect((await api('unknown')).status).toBe(401);expect((await api('member')).status).toBe(403);expect(calls).toBe(0);
    const response=await api();expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');const data=await response.json() as InfrastructureData;
    expect(data.usage.queues).toMatchObject({project:300,account:600,dailyLimit:10000});expect(data.queue).toMatchObject({lagMs:6000,retries:0});expect(data.worker.cpuP50Ms).toBe(5);expect(data.retention).toBeNull();
    expect(JSON.stringify(data)).not.toContain('fixture-token');expect(JSON.stringify(data)).not.toContain('query');expect(calls).toBe(1);
    expect((await api()).status).toBe(200);expect(calls).toBe(1);
  });
  it('projects from actual shared usage and leaves missing datasets unknown',()=>{
    const data=parseInfrastructure(fixture,43200,{dayStart:0,reportedThrough:43200});
    expect(data.usage.queues.projected).toBe(4920);expect(data.usage.d1Writes.projected).toBe(3900);expect(data.usage.d1Writes.projectedProject).toBe(1640);expect(data.usage.d1Writes.projectSustained24h).toBe(2880);
    const missing=parseInfrastructure({workersProject:fixture.workersProject},43200,{dayStart:0,reportedThrough:43200});expect(missing.usage.queues.account).toBeNull();expect(missing.usage.queues.projected).toBeNull();expect(missing.worker.errors).toBe(2);
    expect(projectDailyUsage(1,null,43200,0)).toBeNull();expect(projectDailyUsage(100,90,86400,0)).toBe(100);
  });
  it('keeps resource filters fixed on the server and accounts for the reporting delay',()=>{
    const env={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_D1_ID:'b'.repeat(32),CLOUDFLARE_QUEUE_ID:'c'.repeat(32),CLOUDFLARE_SCRIPT_NAME:'vyrsea-monitor'};
    const q=infrastructureQuery(env as never,43200);expect(q.dayStart).toBe(0);expect(q.reportedThrough).toBe(43080);expect(q.query).toContain('queueId:"'+env.CLOUDFLARE_QUEUE_ID+'"');expect(q.query).toContain('d1Account:');expect(q.query).toContain('workersRecent:');expect(q.query).not.toContain('token');
    expect(()=>infrastructureQuery({...env,CLOUDFLARE_SCRIPT_NAME:'other-project'} as never,43200)).toThrow();
  });
});
