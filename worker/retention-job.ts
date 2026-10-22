import type { Env } from './env';
import { nowSeconds } from './env';
import { cleanup } from './jobs';

export interface RetentionJob {runDay:string;startedAt:number;updatedAt:number;completedAt:number|null;pending:number;deleted:Record<string,number>}
type Saved = {run_day:string;started_at:number;updated_at:number;completed_at:number|null;pending:number;deleted_json:string};
export async function retentionStatus(env:Env):Promise<RetentionJob|null>{
  const row=await env.DB.prepare("SELECT * FROM maintenance_jobs WHERE id='retention'").first<Saved>();
  return row?{runDay:row.run_day,startedAt:row.started_at,updatedAt:row.updated_at,completedAt:row.completed_at,pending:row.pending,deleted:JSON.parse(row.deleted_json)}:null;
}
export async function runRetentionJob(env:Env, start=false, timestamp=nowSeconds()){
  let saved=await retentionStatus(env);
  const day=new Date(timestamp*1000).toISOString().slice(0,10);
  if(start&&saved?.runDay!==day){
    await env.DB.prepare("INSERT INTO maintenance_jobs(id,run_day,started_at,updated_at,pending) VALUES('retention',?,?,?,1) ON CONFLICT(id) DO UPDATE SET run_day=excluded.run_day,started_at=excluded.started_at,updated_at=excluded.updated_at,completed_at=NULL,pending=1,deleted_json='{}' WHERE maintenance_jobs.run_day<>excluded.run_day AND maintenance_jobs.lease_until<=excluded.updated_at")
      .bind(day,timestamp,timestamp).run();
    saved={runDay:day,startedAt:timestamp,updatedAt:timestamp,completedAt:null,pending:1,deleted:{}};
  }
  if(!saved?.pending)return;
  const lease=crypto.randomUUID();
  const acquired=await env.DB.prepare("UPDATE maintenance_jobs SET lease_until=?,lease_token=? WHERE id='retention' AND pending=1 AND lease_until<=? RETURNING *").bind(timestamp+120,lease,timestamp).first<Saved>();
  if(!acquired)return;
  saved={runDay:acquired.run_day,startedAt:acquired.started_at,updatedAt:acquired.updated_at,completedAt:acquired.completed_at,pending:acquired.pending,deleted:JSON.parse(acquired.deleted_json)};
  const result=await cleanup(env,timestamp);
  for(const [table,count] of Object.entries(result.deleted))saved.deleted[table]=(saved.deleted[table]??0)+count;
  await env.DB.prepare("UPDATE maintenance_jobs SET updated_at=?,completed_at=?,pending=?,deleted_json=?,lease_until=0,lease_token=NULL WHERE id='retention' AND run_day=? AND lease_token=?")
    .bind(timestamp,result.pending?null:timestamp,result.pending?1:0,JSON.stringify(saved.deleted),saved.runDay,lease).run();
}
