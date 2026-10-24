import type {Context} from 'hono';
import {HTTPException} from 'hono/http-exception';
import {z} from 'zod';
import type {AppEnv} from './env';
import {nowSeconds} from './env';
import {accountPlanColumns,accountPlanFrom,resolveAccountPlan} from './plans';
import {digest} from './security';
import type {PlanLimits} from '../shared/plans';
import type {DashboardLive} from '../src/types';

// One read-only statement after fresh session/workspace authorization. Each
// subquery uses the workspace/monitor indexes and bounded notification lists.
// No historical aggregates, revision rows, or telemetry writes are required.
export async function liveDashboard(c:Context<AppEnv>){
 const days=z.coerce.number().int().min(1).max(365).parse(c.req.query('days')??'1');
 const now=nowSeconds(),hour=Math.floor(now/3600)*3600,start=hour-(days*24-1)*3600,id=c.get('user').id;
 const pg=c.env.DATABASE_PROVIDER==='supabase';
 const rows=(query:string,keys:string[])=>`(SELECT ${pg?'COALESCE(json_agg(json_build_object('+keys.map(k=>`'${k}',q."${k}"`).join(',')+")),'[]'::json)::text":"COALESCE(json_group_array(json_object("+keys.map(k=>`'${k}',q."${k}"`).join(',')+")),'[]')"} FROM (${query}) q)`;
 const since=`MAX(${now}-(CASE WHEN p.id='business' THEN u.history_days_limit ELSE p.history_days END)*86400,${start})`;
 const monitors=rows(`SELECT id,user_id AS userId,name,url,root_domain AS rootDomain,paused,status,failures,last_checked_at AS lastCheckedAt,
  last_status_code AS lastStatusCode,last_response_ms AS lastResponseMs,last_error AS lastError,next_check_at AS nextCheckAt,created_at AS createdAt,probe_mask AS probeMask FROM monitors WHERE user_id=u.id ORDER BY id`,
  ['id','userId','name','url','rootDomain','paused','status','failures','lastCheckedAt','lastStatusCode','lastResponseMs','lastError','nextCheckAt','createdAt','probeMask']);
 const stats=rows(`SELECT h.monitor_id AS monitorId,${start}+CAST((h.hour-${start})/${days*3600} AS INTEGER)*${days*3600} AS hour,h.total,h.successful,h.total_ms AS totalMs
  FROM monitors m JOIN hourly_stats h ON h.monitor_id=m.id WHERE m.user_id=u.id AND h.hour=${hour} ORDER BY m.id`,['monitorId','hour','total','successful','totalMs']);
 const incidents=rows(`SELECT i.id,i.monitor_id AS monitorId,m.name AS monitorName,i.opened_at AS openedAt,i.resolved_at AS resolvedAt,i.reason
  FROM incidents i JOIN monitors m ON m.id=i.monitor_id WHERE m.user_id=u.id AND (i.resolved_at IS NULL OR i.resolved_at>=${since}) ORDER BY i.opened_at DESC,i.id DESC LIMIT 50`,['id','monitorId','monitorName','openedAt','resolvedAt','reason']);
 const notifications=rows(`SELECT id,monitor_id AS monitorId,kind,message,created_at AS createdAt,read_at AS readAt FROM notifications WHERE user_id=u.id AND created_at>=${since} ORDER BY created_at DESC,id DESC LIMIT 50`,['id','monitorId','kind','message','createdAt','readAt']);
 const maintenance=rows(`SELECT w.id,w.monitor_id AS monitorId,m.name AS monitorName,w.starts_at AS startsAt,w.ends_at AS endsAt,w.reason,w.created_at AS createdAt,w.cancelled_at AS cancelledAt
  FROM maintenance_windows w JOIN monitors m ON m.id=w.monitor_id WHERE m.user_id=u.id AND MIN(w.ends_at,COALESCE(w.cancelled_at,w.ends_at))>=${since}
  ORDER BY CASE WHEN w.cancelled_at IS NULL AND w.ends_at>${now} THEN 0 ELSE 1 END,w.starts_at DESC,w.id DESC LIMIT 100`,['id','monitorId','monitorName','startsAt','endsAt','reason','createdAt','cancelledAt']);
 const result=await c.env.DB.prepare(`SELECT ${accountPlanColumns},u.username AS workspaceName,${monitors} AS monitorsJSON,${stats} AS statsJSON,${incidents} AS incidentsJSON,${notifications} AS notificationsJSON,${maintenance} AS maintenanceJSON ${accountPlanFrom}`)
  .bind(id).first<PlanLimits&{owner:number;workspaceName:string;monitorsJSON:string;statsJSON:string;incidentsJSON:string;notificationsJSON:string;maintenanceJSON:string}>();
 const limits=resolveAccountPlan(result);
 if(days>limits.historyDays||(c.req.query('view')==='advanced'&&!limits.advancedDashboard))throw new HTTPException(403,{message:'El periodo o la vista ya no están incluidos en tu plan.'});
 const payload:DashboardLive={user:c.get('actor'),workspace:{id,name:result!.workspaceName,role:c.get('workspaceRole')},limits,windowDays:days,liveHour:hour,serverTime:now,
  monitors:JSON.parse(result!.monitorsJSON).map((m:DashboardLive['monitors'][number])=>({...m,paused:Boolean(m.paused)})),currentStats:JSON.parse(result!.statsJSON),incidents:JSON.parse(result!.incidentsJSON),notifications:JSON.parse(result!.notificationsJSON),maintenance:JSON.parse(result!.maintenanceJSON)};
 const etag='"'+(await digest(JSON.stringify({...payload,serverTime:0})))+'"';
 c.header('ETag',etag);c.header('X-Vyrsea-Checked-At',String(now));
 if(c.req.header('If-None-Match')===etag)return c.body(null,304);
 return c.json(payload);
}
