import {Hono} from 'hono';
import {HTTPException} from 'hono/http-exception';
import {z} from 'zod';
import type {AppEnv,Env} from './env';
import {nowSeconds} from './env';
import {invalidatePublicPage} from './status-pages';
import type {Announcement,StatusComponent} from '../shared/status-components';
const state=z.enum(['investigating','identified','monitoring','resolved']);
const create=z.object({title:z.string().trim().min(1).max(120),severity:z.enum(['minor','major','critical']),state,componentIds:z.array(z.string().uuid()).max(20),message:z.string().trim().min(1).max(3000),published:z.boolean()}).strict();
type AnnouncementRow={id:string;title:string;severity:Announcement['severity'];state:Announcement['state'];component_ids:string;published:number;created_at:number;updated_at:number};
async function page(env:Env,user:string,id:string){const row=await env.DB.prepare('SELECT id,components_json FROM status_pages WHERE id=? AND user_id=?').bind(id,user).first<{id:string;components_json:string}>();if(!row)throw new HTTPException(404,{message:'Página no encontrada.'});return row;}
export const statusCommunications=new Hono<AppEnv>();
statusCommunications.get('/:id/announcements',async c=>{await page(c.env,c.get('user').id,c.req.param('id'));return c.json(await announcements(c.env,c.req.param('id')));});
statusCommunications.post('/:id/announcements',async c=>{
  const row=await page(c.env,c.get('user').id,c.req.param('id')),value=create.parse(await c.req.json());
  const components=JSON.parse(row.components_json) as StatusComponent[];
  if(value.componentIds.some(id=>!components.some(g=>g.id===id)))throw new HTTPException(400,{message:'Selecciona componentes de esta página.'});
  const count=await c.env.DB.prepare('SELECT COUNT(*) AS n FROM status_announcements WHERE page_id=? AND state<>\'resolved\'').bind(row.id).first<{n:number}>();
  if(count!.n>=20)throw new HTTPException(409,{message:'Resuelve un comunicado antes de abrir otro. Máximo 20 abiertos.'});
  const id=crypto.randomUUID(),now=nowSeconds();
  await c.env.DB.batch([c.env.DB.prepare('INSERT INTO status_announcements(id,page_id,title,severity,state,component_ids,published,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,row.id,value.title,value.severity,value.state,JSON.stringify(value.componentIds),Number(value.published),now,now),
    c.env.DB.prepare('INSERT INTO status_updates(id,announcement_id,state,message,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),id,value.state,value.message,now)]);
  await invalidatePublicPage(c.env.APP_ORIGIN,row.id);return c.json({id},201);
});
statusCommunications.post('/:id/announcements/:announcement/updates',async c=>{
  await page(c.env,c.get('user').id,c.req.param('id'));
  const value=z.object({state,message:z.string().trim().min(1).max(3000),published:z.boolean()}).strict().parse(await c.req.json()),now=nowSeconds();
  const row=await c.env.DB.prepare('SELECT id FROM status_announcements WHERE id=? AND page_id=?').bind(c.req.param('announcement'),c.req.param('id')).first<{id:string}>();
  if(!row)throw new HTTPException(404,{message:'Comunicado no encontrado.'});
  const count=await c.env.DB.prepare('SELECT COUNT(*) AS n FROM status_updates WHERE announcement_id=?').bind(row.id).first<{n:number}>();
  if(count!.n>=100)throw new HTTPException(409,{message:'Máximo 100 actualizaciones por comunicado.'});
  await c.env.DB.batch([c.env.DB.prepare('UPDATE status_announcements SET state=?,published=?,updated_at=? WHERE id=?').bind(value.state,Number(value.published),now,row.id),
    c.env.DB.prepare('INSERT INTO status_updates(id,announcement_id,state,message,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),row.id,value.state,value.message,now)]);
  await invalidatePublicPage(c.env.APP_ORIGIN,c.req.param('id'));return c.json({ok:true});
});
async function announcements(env:Env,id:string,cutoff?:number){
  const rows=await env.DB.prepare(`SELECT * FROM status_announcements WHERE page_id=? ${cutoff!==undefined?'AND published=1 AND (state<>\'resolved\' OR updated_at>=?)':''} ORDER BY created_at DESC LIMIT 20`).bind(id,...(cutoff!==undefined?[cutoff]:[])).all<AnnouncementRow>();
  if(!rows.results.length)return [];
  const updates=await env.DB.prepare(`SELECT announcement_id,state,message,created_at FROM status_updates WHERE announcement_id IN (SELECT value FROM json_each(?)) ORDER BY created_at,id LIMIT 2000`).bind(JSON.stringify(rows.results.map(r=>r.id))).all<{announcement_id:string;state:Announcement['state'];message:string;created_at:number}>();
  return rows.results.map(r=>({id:r.id,title:r.title,severity:r.severity,state:r.state,componentIds:JSON.parse(r.component_ids) as string[],published:Boolean(r.published),createdAt:r.created_at,updatedAt:r.updated_at,updates:updates.results.filter(u=>u.announcement_id===r.id).map(u=>({state:u.state,message:u.message,createdAt:u.created_at}))}));
}
export async function publicAnnouncements(env:Env,id:string,history:number,componentIds:string[]){
  return (await announcements(env,id,nowSeconds()-history*86400)).map(({published:_,...row})=>({...row,componentIds:row.componentIds.filter(id=>componentIds.includes(id))}));
}
