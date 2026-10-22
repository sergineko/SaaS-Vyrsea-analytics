import {Hono} from 'hono';
import {HTTPException} from 'hono/http-exception';
import {z} from 'zod';
import type {AppEnv} from './env';
import {nowSeconds} from './env';
import {accountPlan} from './plans';
import {availabilityBuckets,availabilitySummary} from '../shared/availability';
import {statusPageHTML,type StatusPage} from '../shared/status-pages';
import {staleAfterSeconds} from '../shared/plans';
type Row={id:string;user_id:string;title:string;description:string;accent:string;theme:'light'|'dark';monitor_ids:string;published:number;updated_at:number};
const map=(row:Row):StatusPage=>({id:row.id,title:row.title,description:row.description,accent:row.accent,theme:row.theme,monitorIds:JSON.parse(row.monitor_ids),published:Boolean(row.published),updatedAt:row.updated_at});
const input=z.object({title:z.string().trim().min(1).max(80),description:z.string().trim().max(300),accent:z.string().regex(/^#[a-f0-9]{6}$/i),theme:z.enum(['light','dark']),monitorIds:z.array(z.string().uuid()).min(1).max(100),published:z.boolean()}).strict();
export const statusPages=new Hono<AppEnv>();
statusPages.use('*',async(c,next)=>{if(!(await accountPlan(c.env,c.get('user').id)).advancedDashboard)throw new HTTPException(403,{message:'Las páginas de estado requieren Pro / Agencia o Business.'});await next();});
statusPages.get('/',async c=>{const rows=await c.env.DB.prepare('SELECT * FROM status_pages WHERE user_id=? ORDER BY updated_at DESC LIMIT 5').bind(c.get('user').id).all<Row>();return c.json(rows.results.map(map));});
statusPages.post('/',async c=>{
  const value=input.parse(await c.req.json()),userId=c.get('user').id;
  const count=await c.env.DB.prepare('SELECT COUNT(*) AS n FROM status_pages WHERE user_id=?').bind(userId).first<{n:number}>();if(count!.n>=5)throw new HTTPException(409,{message:'La beta permite cinco páginas de estado por cuenta.'});
  const ids=[...new Set(value.monitorIds)];const found=await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM monitors WHERE user_id=? AND id IN (SELECT value FROM json_each(?))`).bind(userId,JSON.stringify(ids)).first<{n:number}>();
  if(found?.n!==ids.length)throw new HTTPException(400,{message:'Selecciona monitores de tu cuenta.'});
  const id=crypto.randomUUID(),timestamp=nowSeconds();await c.env.DB.prepare('INSERT INTO status_pages(id,user_id,title,description,accent,theme,monitor_ids,published,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,userId,value.title,value.description,value.accent,value.theme,JSON.stringify(ids),Number(value.published),timestamp,timestamp).run();return c.json({id},201);
});
statusPages.put('/:id',async c=>{
  const value=input.parse(await c.req.json()),id=c.req.param('id'),userId=c.get('user').id;
  if(!await c.env.DB.prepare('SELECT id FROM status_pages WHERE id=? AND user_id=?').bind(id,userId).first())throw new HTTPException(404,{message:'Página no encontrada.'});
  const ids=[...new Set(value.monitorIds)],found=await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM monitors WHERE user_id=? AND id IN (SELECT value FROM json_each(?))`).bind(userId,JSON.stringify(ids)).first<{n:number}>();if(found?.n!==ids.length)throw new HTTPException(400,{message:'Selecciona monitores de tu cuenta.'});
  await c.env.DB.prepare('UPDATE status_pages SET title=?,description=?,accent=?,theme=?,monitor_ids=?,published=?,updated_at=? WHERE id=? AND user_id=?').bind(value.title,value.description,value.accent,value.theme,JSON.stringify(ids),Number(value.published),nowSeconds(),id,userId).run();
  try{await(await caches.open('vyrsea-public-status-v1')).delete(new Request(`${c.env.APP_ORIGIN}/api/public/status/${id}`));}catch{/* Other edge locations expire within sixty seconds. */}
  return c.json({ok:true});
});
export const publicStatus=new Hono<AppEnv>();
publicStatus.get('/:id/:view?',async c=>{
  const id=z.string().uuid().parse(c.req.param('id')),view=c.req.param('view');if(view&&view!=='view')throw new HTTPException(404,{message:'Página no encontrada.'});
  const cache=await caches.open('vyrsea-public-status-v1'),key=new Request(`${c.env.APP_ORIGIN}/api/public/status/${id}`);let payload:{page:StatusPage;services:unknown[];headline:string;generatedAt:number}|undefined;
  try{const cached=await cache.match(key);if(cached)payload=await cached.json();}catch{/* Read-only public cache is best effort. */}
  if(!payload){
    const row=await c.env.DB.prepare(`SELECT s.* FROM status_pages s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.published=1 AND u.account_status='active' AND (u.is_owner=1 OR u.plan_id IN ('pro','business'))`).bind(id).first<Row>();
    if(!row)throw new HTTPException(404,{message:'Esta página no está publicada.'});
    const plan=await accountPlan(c.env,row.user_id),now=nowSeconds(),from=Math.floor(now/3600)*3600-23*3600,to=from+86400,ids=JSON.parse(row.monitor_ids) as string[];
    const [monitors,stats]=await c.env.DB.batch<Record<string,string|number|null>>([
      c.env.DB.prepare(`SELECT id,name,status,paused,last_checked_at,EXISTS(SELECT 1 FROM maintenance_windows w WHERE w.monitor_id=monitors.id AND w.cancelled_at IS NULL AND w.starts_at<=? AND w.ends_at>?) AS maintenance FROM monitors WHERE user_id=? AND id IN (SELECT value FROM json_each(?))`).bind(now,now,row.user_id,JSON.stringify(ids)),
      c.env.DB.prepare(`SELECT h.monitor_id,h.hour,h.total,h.successful,h.total_ms AS totalMs FROM hourly_stats h JOIN monitors m ON m.id=h.monitor_id WHERE m.user_id=? AND h.hour>=? AND h.monitor_id IN (SELECT value FROM json_each(?)) ORDER BY h.hour`).bind(row.user_id,from,JSON.stringify(ids)),
    ]);
    const services=monitors.results.map(m=>{const values=stats.results.filter(s=>s.monitor_id===m.id) as unknown as {hour:number;total:number;successful:number;totalMs:number}[];const summary=availabilitySummary(values);const status=m.paused?'paused':m.maintenance?'maintenance':!m.last_checked_at||now-Number(m.last_checked_at)>staleAfterSeconds(plan.intervalSeconds)?'pending':String(m.status);return {name:m.name,status,label:({up:'Operativo',down:'Incidencia',degraded:'Confirmando',paused:'En pausa',maintenance:'Mantenimiento',pending:'Sin datos recientes'} as Record<string,string>)[status],uptime:summary.uptime,total:summary.total,buckets:availabilityBuckets(values,from,to)};});
    payload={page:map(row),services,headline:services.some(s=>s.status==='down'||s.status==='degraded')?'Hay servicios que requieren atención':services.every(s=>s.status==='up')&&services.length?'Todos los servicios operativos':'Consulta el estado de cada servicio',generatedAt:now};
    try{await cache.put(key,Response.json(payload,{headers:{'Cache-Control':'max-age=60'}}));}catch{/* Avoid D1 writes for telemetry and public reads. */}
  }
  c.header('Access-Control-Allow-Origin','*');c.header('Cache-Control','public,max-age=30');c.header('Referrer-Policy','no-referrer');
  if(view){c.header('X-Frame-Options',undefined);c.header('Content-Security-Policy',"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self' https://vyrsea.com; frame-ancestors *; base-uri 'none'; form-action 'none'");return c.html(statusPageHTML(payload.page,`${c.env.APP_ORIGIN}/api/public/status/${id}`));}
  return c.json({title:payload.page.title,description:payload.page.description,services:payload.services,headline:payload.headline,generatedAt:payload.generatedAt});
});
