import type {Env} from './env';

export type Statistic={monitorId:string;hour:number;total:number;successful:number;totalMs:number};
const HISTORY_CACHE_SECONDS=300;
// The caller supplies IDs from a fresh, authenticated ownership query. Start
// with that list, then seek the composite PK instead of joining every sample.
export const dashboardStatsSQL=`SELECT h.monitor_id AS monitorId,?+CAST((h.hour-?)/? AS INTEGER)*? AS hour,
  SUM(h.total) AS total,SUM(h.successful) AS successful,SUM(h.total_ms) AS totalMs
  FROM json_each(?) selected CROSS JOIN hourly_stats h
  WHERE h.monitor_id=selected.value AND h.hour>=? AND h.hour<?
  GROUP BY h.monitor_id,CAST((h.hour-?)/? AS INTEGER) ORDER BY hour`;

export async function dashboardStatistics(env:Env,userId:string,monitorIds:string[],since:number,days:number,timestamp:number) {
  if(!monitorIds.length)return {stats:[] as Statistic[],historyAsOf:timestamp};
  const hour=Math.floor(timestamp/3600)*3600,step=days*3600,ids=JSON.stringify([...monitorIds].sort());
  const query=(from:number,to:number)=>env.DB.prepare(dashboardStatsSQL)
    .bind(since,since,step,step,ids,from,to,since,step).all<Statistic>();
  // Only closed hours are cached. Status, accounts, plans and the current hour
  // always come from D1. Keys also change when a monitor is added or deleted.
  let cache:Cache|undefined,key:Request|undefined,history:{rows:Statistic[];asOf:number}|undefined;
  try {
    cache=await caches.open('vyrsea-stats-v1');
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([userId,ids,since,days,hour])));
    const hash=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
    key=new Request(`${env.APP_ORIGIN}/__internal/statistics/${hash}`);
    const hit=await cache.match(key);
    if(hit){const value=await hit.json() as typeof history;if(value&&value.asOf<=timestamp&&timestamp-value.asOf<HISTORY_CACHE_SECONDS)history=value;}
  }catch{/* Cache eviction/unavailability must not prevent dashboard reads. */}
  const [current,closed]=await Promise.all([query(hour,hour+3600),history?Promise.resolve(null):query(since,hour)]);
  if(!history){
    history={rows:closed!.results,asOf:timestamp};
    if(cache&&key)try{await cache.put(key,Response.json(history,{headers:{'Cache-Control':`max-age=${HISTORY_CACHE_SECONDS}`}}));}catch{/* No D1 writes for caching. */}
  }
  const buckets=new Map(history.rows.map(row=>[`${row.monitorId}:${row.hour}`,{...row}]));
  for(const row of current.results){
    const id=`${row.monitorId}:${row.hour}`,old=buckets.get(id);
    if(old){old.total+=row.total;old.successful+=row.successful;old.totalMs+=row.totalMs;}else buckets.set(id,row);
  }
  return {stats:[...buckets.values()].sort((a,b)=>a.hour-b.hour),historyAsOf:history.asOf};
}

// Two indexed ranges avoid reading weeks between a past custom interval and
// the mandatory last 24h. The second range excludes overlap, so no duplicates.
export const availabilityStatsSQL=`SELECT monitor_id AS monitorId,hour,total,successful,total_ms AS totalMs
  FROM hourly_stats WHERE monitor_id=? AND hour>=? AND hour<?
  UNION ALL SELECT monitor_id AS monitorId,hour,total,successful,total_ms AS totalMs
  FROM hourly_stats WHERE monitor_id=? AND hour>=? AND hour<=? AND (hour<? OR hour>=?) ORDER BY hour`;
