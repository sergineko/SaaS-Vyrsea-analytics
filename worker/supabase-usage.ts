import type {Env} from './env';
import type {SupabaseUsage,DatabaseTableUsage,PlanDatabaseLoad} from '../shared/supabase-usage';
let snapshot:{key:string;data:SupabaseUsage}|undefined;
export async function supabaseUsage(env:Env,now:number):Promise<SupabaseUsage|null>{
  if(env.DATABASE_PROVIDER!=='supabase')return null;
  const schema=env.DATABASE_SCHEMA??'vyrsea',key=`${env.APP_ORIGIN}:${schema}:v3`;
  if(snapshot?.key===key&&now-snapshot.data.fetchedAt<300)return snapshot.data;
  let cache:Cache|undefined;const request=new Request(`${env.APP_ORIGIN}/api/owner/infrastructure?supabase=${encodeURIComponent(schema)}-v3`);
  try{
    cache=await caches.open('vyrsea-supabase-usage-v1');const cached=await cache.match(request);
    if(cached){const data=await cached.json() as SupabaseUsage;if(now-data.fetchedAt<300){snapshot={key,data};return data;}}
  }catch{/* The metrics remain available when the edge cache is unavailable. */}
  try{
    const [size,relations,plans]=await env.DB.batch([
      // Supabase reports the sum of every database in this project's cluster,
      // including PostgreSQL templates, rather than only the postgres database.
      env.DB.prepare(`SELECT (SELECT SUM(pg_database_size(oid)) FROM pg_database) AS bytes,
        pg_database_size(current_database()) AS primaryDatabaseBytes,
        (SELECT numbackends FROM pg_stat_database WHERE datname=current_database()) AS databaseConnections,
        (SELECT COUNT(*) FROM pg_stat_activity WHERE datname=current_database() AND usename=current_user) AS applicationConnections,
        (SELECT COUNT(*) FROM pg_stat_activity WHERE datname=current_database() AND usename=current_user AND state='active') AS applicationActive,
        (SELECT COUNT(*) FROM pg_stat_activity WHERE datname=current_database() AND usename=current_user AND state='idle') AS applicationIdle,
        (SELECT COUNT(*) FROM pg_stat_activity WHERE datname=current_database() AND usename=current_user AND state LIKE 'idle in transaction%') AS applicationIdleInTransaction,
        (SELECT COUNT(*) FROM pg_stat_activity WHERE datname=current_database() AND usename<>current_user) AS otherConnections,
        current_setting('max_connections')::integer AS maxConnections,
        (SELECT CASE WHEN blks_hit+blks_read>0 THEN round(100.0*blks_hit/(blks_hit+blks_read),2) ELSE NULL END FROM pg_stat_database WHERE datname=current_database()) AS cacheHitPercent`),
      env.DB.prepare(`SELECT c.relname AS name,pg_total_relation_size(c.oid) AS bytes,pg_indexes_size(c.oid) AS indexBytes,
        COALESCE(s.n_live_tup,0) AS estimatedRows,COALESCE(s.n_dead_tup,0) AS deadRows
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_stat_user_tables s ON s.relid=c.oid
        WHERE n.nspname=? AND c.relkind='r' ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 50`).bind(schema),
      env.DB.prepare(`SELECT p.id AS plan,COUNT(m.id) AS activeMonitors,COALESCE(SUM(86400.0/p.interval_seconds),0) AS checksPerDay,
        COALESCE(SUM(86400.0/p.interval_seconds*(CASE WHEN p.id='business' THEN u.history_days_limit ELSE p.history_days END+1)),0) AS retainedChecks,
        COALESCE(SUM(24*(CASE WHEN p.id='business' THEN u.history_days_limit ELSE p.history_days END+1)),0) AS retainedHours
        FROM users u JOIN plan_limits p ON p.id=u.plan_id JOIN monitors m ON m.user_id=u.id
        WHERE u.account_status='active' AND m.paused=0 GROUP BY p.id ORDER BY p.id`),
    ]);
    const row=size.results[0] as Record<string,number|null>,tables=relations.results as unknown as DatabaseTableUsage[];
    const data:SupabaseUsage={fetchedAt:now,databaseBytes:Number(row.bytes),primaryDatabaseBytes:Number(row.primaryDatabaseBytes),applicationBytes:tables.reduce((n,t)=>n+t.bytes,0),indexBytes:tables.reduce((n,t)=>n+t.indexBytes,0),databaseConnections:Number(row.databaseConnections),applicationConnections:Number(row.applicationConnections),applicationActive:Number(row.applicationActive),applicationIdle:Number(row.applicationIdle),applicationIdleInTransaction:Number(row.applicationIdleInTransaction),otherConnections:Number(row.otherConnections),maxConnections:Number(row.maxConnections),cacheHitPercent:row.cacheHitPercent,tables,plans:plans.results as unknown as PlanDatabaseLoad[]};
    snapshot={key,data};try{await cache?.put(request,Response.json(data,{headers:{'Cache-Control':'max-age=300'}}));}catch{/* Best effort, no telemetry rows. */}
    return data;
  }catch{return null;}
}
