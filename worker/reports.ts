import {Hono} from 'hono';
import {HTTPException} from 'hono/http-exception';
import {z} from 'zod';
import type {AppEnv} from './env';
import {nowSeconds} from './env';
import {accountPlan} from './plans';
import {REPORT_KINDS,type ReportRow} from '../shared/reports';
const parameters=z.object({kind:z.enum(REPORT_KINDS),from:z.number().int().min(0),to:z.number().int().min(1),
 domains:z.array(z.string().min(1).max(253)).max(200).default([]),monitors:z.array(z.string().uuid()).max(200).default([]),
 cursor:z.object({monitor:z.string().max(64),at:z.number().int().min(0),id:z.string().max(130)}).strict().nullable().default(null)}).strict();
const metadata=`m.id AS monitor_id,m.root_domain AS domain,m.name AS monitor_name,m.url,m.status AS current_status,m.paused,m.probe_mask,
 m.created_at AS monitor_created_at,m.last_checked_at,m.next_check_at,m.last_status_code,m.last_response_ms,m.last_error,m.failures`;
export const reports=new Hono<AppEnv>();
reports.get('/export',async c=>{
 const user=c.get('user'),plan=await accountPlan(c.env,user.id);
 if(plan.id!=='business')throw new HTTPException(403,{message:'Los informes detallados requieren Business.'});
 const raw=c.req.query('filter')??'';if(raw.length>26000)throw new HTTPException(400,{message:'Selecciona menos elementos o exporta todos dejando los filtros vacíos.'});
 const input=parameters.parse(JSON.parse(raw)),now=nowSeconds(),earliest=Math.ceil((now-plan.historyDays*86400)/3600)*3600;
 if(input.from%3600||input.from>=input.to||input.to>now||input.from<earliest-3600)throw new HTTPException(400,{message:`Selecciona un intervalo horario válido dentro de los ${plan.historyDays} días de histórico, sin fechas futuras.`});
 const from=Math.max(input.from,earliest),to=input.to;
 if(from>=to)throw new HTTPException(400,{message:'El intervalo ya no contiene histórico disponible.'});
 const domains=JSON.stringify([...new Set(input.domains)]),monitors=JSON.stringify([...new Set(input.monitors)]),cursor=input.cursor;
 const scope=`m.user_id=? AND (?='[]' OR m.root_domain IN (SELECT value FROM json_each(?))) AND (?='[]' OR m.id IN (SELECT value FROM json_each(?)))`;
 const scopeValues=[user.id,domains,domains,monitors,monitors];
 let query:string,values:unknown[];
 if(input.kind==='summary'){
  const complete=Math.floor(to/3600)*3600;
  query=`WITH chosen AS (SELECT m.* FROM monitors m WHERE ${scope} AND m.id>? ORDER BY m.id LIMIT 501),
   samples AS (SELECT h.monitor_id,h.total,h.successful,h.total_ms FROM hourly_stats h JOIN chosen m ON m.id=h.monitor_id WHERE h.hour>=? AND h.hour<?
    UNION ALL SELECT ch.monitor_id,COUNT(*) AS total,SUM(ch.ok) AS successful,SUM(ch.response_ms) AS total_ms FROM checks ch JOIN chosen m ON m.id=ch.monitor_id WHERE ch.checked_at>=? AND ch.checked_at<? GROUP BY ch.monitor_id),
   totals AS (SELECT monitor_id,SUM(total) AS total,SUM(successful) AS successful,SUM(total_ms) AS total_ms FROM samples GROUP BY monitor_id)
   SELECT ${metadata},m.id AS record_id,0 AS record_at,COALESCE(t.total,0) AS total,COALESCE(t.successful,0) AS successful,COALESCE(t.total_ms,0) AS total_ms
   FROM chosen m LEFT JOIN totals t ON t.monitor_id=m.id ORDER BY m.id LIMIT 501`;
  values=[...scopeValues,cursor?.monitor??'',from,complete,Math.max(from,complete),to];
 }else{
  const kinds={checks:{table:'checks',at:'checked_at',fields:'r.ok,r.status_code,r.response_ms,r.error',window:'r.checked_at>=? AND r.checked_at<?',id:'r.id'},
   hourly:{table:'hourly_stats',at:'hour',fields:'r.total,r.successful,r.total_ms',window:'r.hour>=? AND r.hour<?',id:"r.monitor_id || ':' || CAST(r.hour AS TEXT)"},
   incidents:{table:'incidents',at:'opened_at',fields:'r.opened_at AS started_at,r.resolved_at AS ended_at,r.reason',window:'COALESCE(r.resolved_at,?)>=? AND r.opened_at<?',id:'r.id'},
   maintenance:{table:'maintenance_windows',at:'starts_at',fields:'r.starts_at AS started_at,r.ends_at AS ended_at,r.reason,r.created_at,r.cancelled_at',window:'r.ends_at>=? AND r.starts_at<?',id:'r.id'}} as const;
  const kind=kinds[input.kind],page=cursor?`AND (m.id>? OR (m.id=? AND (r.${kind.at}<? OR (r.${kind.at}=? AND ${kind.id}<?))))`:'';
  query=`SELECT ${metadata},${kind.id} AS record_id,r.${kind.at} AS record_at,${kind.fields} FROM ${kind.table} r JOIN monitors m ON m.id=r.monitor_id
   WHERE ${scope} AND ${kind.window} ${page} ORDER BY m.id,r.${kind.at} DESC,${kind.id} DESC LIMIT 501`;
  values=[...scopeValues,...(input.kind==='incidents'?[to,from,to]:[from,input.kind==='hourly'?Math.floor(to/3600)*3600:to]),...(cursor?[cursor.monitor,cursor.monitor,cursor.at,cursor.at,cursor.id]:[])];
 }
 const result=await c.env.DB.prepare(query).bind(...values).all<ReportRow>(),rows=result.results.slice(0,500),last=rows.at(-1);
 return c.json({kind:input.kind,from,to,generatedAt:now,rows:rows.map(r=>({...r,...(input.kind==='summary'?{record_at:null}:{}),...(input.kind==='incidents'?{duration_seconds:Number(r.ended_at??to)-Number(r.started_at)}:{}),interval_seconds:plan.intervalSeconds,active_probes:'Cloudflare',note:input.kind==='hourly'?'Hora completa. El tramo final figura en comprobaciones y resumen.':'Configuración actual del monitor. Sin datos de credenciales, sesiones ni secretos.'})),
   nextCursor:result.results.length>500&&last?JSON.stringify({monitor:last.monitor_id,at:last.record_at,id:last.record_id}):null});
});
