import type { Env } from './env';
import { nowSeconds } from './env';
import { projectDailyUsage, type InfrastructureData, type UsageMetric } from '../shared/infrastructure';

const fields = {queues:'billableOperations',d1Reads:'rowsRead',d1Writes:'rowsWritten',workers:'requests'} as const;
type MetricRow = {sum?:Record<string,number>;avg?:Record<string,number>;max?:Record<string,number>;quantiles?:Record<string,number>};
type Dataset = Record<string,MetricRow[] | undefined>;
let warmCache:{key:string;data:InfrastructureData}|undefined;
const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
function value(rows: MetricRow[] | undefined, group: keyof MetricRow, field: string): number | null {
  if (!Array.isArray(rows)) return null;
  if (!rows.length) return group==='sum'?0:null;
  const numbers=rows.map(row=>row[group]?.[field]);
  if (!numbers.every(valid)) return null;
  return group==='sum' ? numbers.reduce((a,b)=>a+b,0) : group==='max' ? Math.max(...numbers) : numbers[0];
}
export function infrastructureQuery(env: Env, timestamp: number) {
  const account=env.CLOUDFLARE_ACCOUNT_ID,db=env.CLOUDFLARE_D1_ID,queue=env.CLOUDFLARE_QUEUE_ID,script=env.CLOUDFLARE_SCRIPT_NAME;
  if(![account,db,queue].every(id=>/^[a-f0-9-]{32,36}$/.test(id??''))||!/^vyrsea-[a-z0-9-]+$/.test(script??''))throw new Error('Invalid infrastructure configuration');
  const day=Math.floor(timestamp/86400)*86400, end=Math.max(day,timestamp-120), recent=end-900;
  const time=(start:number)=>`datetime_geq:${JSON.stringify(new Date(start*1000).toISOString())},datetime_lt:${JSON.stringify(new Date(end*1000).toISOString())}`;
  const definitions=[
    ['queues','queueMessageOperationsAdaptiveGroups',`queueId:${JSON.stringify(queue)}`,'billableOperations'],
    ['d1','d1AnalyticsAdaptiveGroups',`databaseId:${JSON.stringify(db)}`,'rowsRead rowsWritten'],
    ['workers','workersInvocationsAdaptive',`scriptName:${JSON.stringify(script)}`,'requests errors'],
  ];
  const nodes=definitions.flatMap(([name,node,resource,sum])=>[
    `${name}Project:${node}(limit:1,filter:{${time(day)},${resource}}){sum{${sum}}${name==='workers'?' quantiles{cpuTimeP50}':''}}`,
    `${name}Account:${node}(limit:1,filter:{${time(day)}}){sum{${sum}}}`,
    `${name}Recent:${node}(limit:1,filter:{${time(recent)}}){sum{${sum}}}`,
  ]);
  nodes.push(`queueDelay:queueMessageOperationsAdaptiveGroups(limit:1,filter:{${time(recent)},queueId:${JSON.stringify(queue)},actionType:"ReadMessage"}){avg{lagTime retryCount}}`);
  nodes.push(`storage:d1StorageAdaptiveGroups(limit:1,filter:{date:${JSON.stringify(new Date(day*1000).toISOString().slice(0,10))},databaseId:${JSON.stringify(db)}}){max{databaseSizeBytes}}`);
  return {query:`{viewer{accounts(filter:{accountTag:${JSON.stringify(account)}}){${nodes.join('\n')}}}}`,dayStart:day,reportedThrough:end};
}
export function parseInfrastructure(data: Dataset, timestamp: number, window: {dayStart:number;reportedThrough:number}): InfrastructureData {
  function usage(kind:keyof typeof fields, dataset:string, dailyLimit:number):UsageMetric {
    const project=value(data[dataset+'Project'],'sum',fields[kind]),account=value(data[dataset+'Account'],'sum',fields[kind]);
    return {project,account,dailyLimit,projected:projectDailyUsage(account,value(data[dataset+'Recent'],'sum',fields[kind]),window.reportedThrough,window.dayStart)};
  }
  const cpu=value(data.workersProject,'quantiles','cpuTimeP50');
  return {configured:true,fetchedAt:timestamp,dayStart:window.dayStart,reportedThrough:window.reportedThrough,recentMinutes:15,
    usage:{queues:usage('queues','queues',10000),d1Reads:usage('d1Reads','d1',5000000),d1Writes:usage('d1Writes','d1',100000),workers:usage('workers','workers',100000)},
    queue:{backlog:null,oldestAgeSeconds:null,lagMs:value(data.queueDelay,'avg','lagTime'),retries:value(data.queueDelay,'avg','retryCount')},
    worker:{errors:value(data.workersProject,'sum','errors'),cpuP50Ms:cpu===null?null:cpu/1000},databaseBytes:value(data.storage,'max','databaseSizeBytes'),errors:[],
  };
}
async function analytics(env: Env, timestamp: number) {
  const window={dayStart:Math.floor(timestamp/86400)*86400,reportedThrough:Math.max(Math.floor(timestamp/86400)*86400,timestamp-120)};
  if(!env.CLOUDFLARE_ANALYTICS_TOKEN)return {...parseInfrastructure({},timestamp,window),configured:false,errors:['La conexión de analítica aún no está configurada.']};
  try {
    const key=new Request(`https://vyrsea.com/api/owner/infrastructure?cache=${env.CLOUDFLARE_ACCOUNT_ID}-${env.CLOUDFLARE_SCRIPT_NAME}-${env.CLOUDFLARE_D1_ID}-${env.CLOUDFLARE_QUEUE_ID}-${window.dayStart}-v1`);
    if(warmCache?.key===key.url&&timestamp-warmCache.data.fetchedAt<60)return warmCache.data;
    let cache:Cache|undefined;
    try{cache=await caches.open('vyrsea-infrastructure-v1');const cached=await cache.match(key);if(cached){const data=await cached.json() as InfrastructureData;if(timestamp-data.fetchedAt<60){warmCache={key:key.url,data};return data;}}}catch{/* Cache failures must not hide valid provider metrics. */}
    const query=infrastructureQuery(env,timestamp);
    const response=await fetch('https://api.cloudflare.com/client/v4/graphql',{method:'POST',headers:{Authorization:`Bearer ${env.CLOUDFLARE_ANALYTICS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:query.query}),signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('Analytics unavailable');
    const body=await response.json<{data?:{viewer?:{accounts?:Dataset[]}};errors?:unknown[]}>();
    const account=body.data?.viewer?.accounts?.[0];
    if(!account)throw new Error('Analytics unavailable');
    const data=parseInfrastructure(account,timestamp,query);
    if(body.errors?.length)data.errors.push('Cloudflare no ha devuelto todas las métricas. Los campos ausentes se muestran sin datos.');
    warmCache={key:key.url,data};
    try{await cache?.put(key,Response.json(data,{headers:{'Cache-Control':'max-age=60'}}));}catch{/* Best-effort edge cache; warm isolates still reuse the snapshot. */}
    return data;
  } catch {
    return {...parseInfrastructure({},timestamp,window),errors:['No se ha podido consultar la analítica de Cloudflare. Se reintentará en la próxima actualización.']};
  }
}
export async function infrastructure(env: Env, timestamp=nowSeconds()) {
  const realtime=async()=>{try{return await env.CHECK_QUEUE.metrics();}catch{return null;}};
  const [data,backlog]=await Promise.all([analytics(env,timestamp),realtime()]);
  return {...data,queue:{...data.queue,backlog:backlog?.backlogCount??null,oldestAgeSeconds:backlog?(backlog.backlogCount&&backlog.oldestMessageTimestamp?Math.max(0,timestamp-Math.floor(backlog.oldestMessageTimestamp.getTime()/1000)):0):null}};
}
