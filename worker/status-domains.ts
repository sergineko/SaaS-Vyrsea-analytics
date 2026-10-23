import {Hono} from 'hono';
import {HTTPException} from 'hono/http-exception';
import {z} from 'zod';
import type {AppEnv,Env} from './env';
import {nowSeconds} from './env';
import {normalizeTarget} from './probe';
import {randomToken} from './security';
import {accountPlan} from './plans';
type Domain={id:string;page_id:string;hostname:string;verification_token:string;verified_at:number|null;provider_id:string|null;certificate_status:string;validation_json:string;checked_at:number|null};
const ready=(env:Env)=>env.CUSTOM_DOMAINS_ENABLED==='1'&&Boolean(env.CUSTOM_DOMAINS_TOKEN&&env.CUSTOM_DOMAINS_ZONE_ID&&env.CUSTOM_DOMAINS_CNAME);
async function page(env:Env,id:string,user:string){if(!await env.DB.prepare('SELECT id FROM status_pages WHERE id=? AND user_id=?').bind(id,user).first())throw new HTTPException(404,{message:'Página no encontrada.'});}
async function cf(env:Env,path:string,method='GET',body?:unknown){
  const response=await fetch(`https://api.cloudflare.com/client/v4/zones/${env.CUSTOM_DOMAINS_ZONE_ID}/custom_hostnames${path}`,{method,headers:{Authorization:`Bearer ${env.CUSTOM_DOMAINS_TOKEN}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});
  const value=await response.json() as {success:boolean;result:{id:string;hostname:string;status:string;ssl?:{status:string;validation_records?:unknown[]};ownership_verification?:unknown}};
  if(!response.ok||!value.success)throw new HTTPException(502,{message:'Cloudflare no ha podido configurar el certificado. Revisa la activación y los permisos.'});return value.result;
}
export const statusDomains=new Hono<AppEnv>();
statusDomains.use('/:id/domain*',async(c,next)=>{if((await accountPlan(c.env,c.get('user').id)).id!=='business')throw new HTTPException(403,{message:'El dominio propio requiere Business.'});await page(c.env,c.req.param('id'),c.get('user').id);await next();});
statusDomains.get('/:id/domain',async c=>{
  const row=await c.env.DB.prepare('SELECT * FROM status_domains WHERE page_id=?').bind(c.req.param('id')).first<Domain>();
  return c.json({ready:ready(c.env),cname:c.env.CUSTOM_DOMAINS_CNAME??null,domain:row?{hostname:row.hostname,verificationName:`_vyrsea.${row.hostname}`,verificationValue:row.verification_token,verifiedAt:row.verified_at,certificateStatus:row.certificate_status,validation:JSON.parse(row.validation_json),checkedAt:row.checked_at}:null});
});
statusDomains.post('/:id/domain',async c=>{
  const {hostname}=z.object({hostname:z.string().trim().toLowerCase().max(253)}).strict().parse(await c.req.json());
  try{if(new URL(normalizeTarget('https://'+hostname)).hostname!==hostname||hostname==='vyrsea.com'||hostname.endsWith('.vyrsea.com'))throw new Error();}catch{throw new HTTPException(400,{message:'Introduce un subdominio público como estado.tunegocio.com.'});}
  if(await c.env.DB.prepare('SELECT id FROM status_domains WHERE page_id=? OR hostname=?').bind(c.req.param('id'),hostname).first())throw new HTTPException(409,{message:'La página o el dominio ya tienen una configuración. Desvincúlalo antes de cambiarlo.'});
  await c.env.DB.prepare('INSERT INTO status_domains(id,page_id,hostname,verification_token) VALUES(?,?,?,?)').bind(crypto.randomUUID(),c.req.param('id'),hostname,'vyrsea-verification='+randomToken()).run();return c.json({ok:true},201);
});
statusDomains.post('/:id/domain/verify',async c=>{
  const row=await c.env.DB.prepare('SELECT * FROM status_domains WHERE page_id=?').bind(c.req.param('id')).first<Domain>();
  if(!row)throw new HTTPException(404,{message:'Configura primero el dominio.'});
  const response=await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent('_vyrsea.'+row.hostname)}&type=TXT`,{headers:{Accept:'application/dns-json'},signal:AbortSignal.timeout(5000)});
  const data=await response.json() as {Status:number;Answer?:{type:number;data:string}[]};
  const valid=response.ok&&data.Status===0&&data.Answer?.some(a=>a.type===16&&a.data.replaceAll('"','').replaceAll(' ','')===row.verification_token);
  if(!valid)throw new HTTPException(409,{message:'Todavía no aparece el registro TXT de propiedad. Revisa el valor y la propagación DNS.'});
  await c.env.DB.prepare('UPDATE status_domains SET verified_at=?,checked_at=? WHERE id=?').bind(nowSeconds(),nowSeconds(),row.id).run();
  return c.json({ok:true,provisioningReady:ready(c.env)});
});
statusDomains.post('/:id/domain/provision',async c=>{
  if(!ready(c.env))throw new HTTPException(503,{message:'La conexión de dominios y certificados aún no se ha activado. La verificación DNS ya puede prepararse.'});
  const row=await c.env.DB.prepare('SELECT * FROM status_domains WHERE page_id=?').bind(c.req.param('id')).first<Domain>();
  if(!row?.verified_at||nowSeconds()-row.verified_at>86400)throw new HTTPException(409,{message:'Verifica de nuevo la propiedad DNS antes de solicitar el certificado.'});
  const data=row.provider_id?await cf(c.env,'/'+row.provider_id):await cf(c.env,'','POST',{hostname:row.hostname,ssl:{method:'txt',type:'dv',settings:{min_tls_version:'1.2'}}});
  await c.env.DB.prepare('UPDATE status_domains SET provider_id=?,certificate_status=?,validation_json=?,checked_at=? WHERE id=?')
    .bind(data.id,data.status==='active'&&data.ssl?.status==='active'?'active':data.ssl?.status??'pending',JSON.stringify([...(data.ssl?.validation_records??[]),...(data.ownership_verification?[data.ownership_verification]:[])]),nowSeconds(),row.id).run();
  return c.json({ok:true});
});
statusDomains.delete('/:id/domain',async c=>{
  const row=await c.env.DB.prepare('SELECT * FROM status_domains WHERE page_id=?').bind(c.req.param('id')).first<Domain>();
  if(row?.provider_id){if(!ready(c.env))throw new HTTPException(503,{message:'Reconecta la gestión de certificados antes de desvincular un dominio activo.'});await cf(c.env,'/'+row.provider_id,'DELETE');}
  await c.env.DB.prepare('DELETE FROM status_domains WHERE page_id=?').bind(c.req.param('id')).run();return c.json({ok:true});
});
export async function customStatusRequest(request:Request,env:Env){
  const url=new URL(request.url);
  if(url.hostname===new URL(env.APP_ORIGIN).hostname||url.hostname==='localhost'||url.hostname.endsWith('.workers.dev'))return null;
  if(!ready(env)||request.method!=='GET'||!['/','/status.json'].includes(url.pathname))return new Response('Página no encontrada',{status:404});
  const row=await env.DB.prepare(`SELECT d.page_id FROM status_domains d JOIN status_pages s ON s.id=d.page_id JOIN users u ON u.id=s.user_id
    WHERE d.hostname=? AND d.certificate_status='active' AND d.verified_at IS NOT NULL AND s.published=1 AND u.account_status='active' AND (u.is_owner=1 OR u.plan_id='business')`).bind(url.hostname).first<{page_id:string}>();
  if(!row)return new Response('Página no encontrada',{status:404});
  return new Request(`${env.APP_ORIGIN}/api/public/status/${row.page_id}${url.pathname==='/'?'/view':''}`,{method:'GET'});
}
