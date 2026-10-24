import {Hono,type Context} from 'hono';
import {HTTPException} from 'hono/http-exception';
import {z} from 'zod';
import type {AppEnv,Env} from './env';
import {nowSeconds} from './env';
import {digest,rateLimit,readCookie,sessionUser,verifyTurnstile} from './security';
import type {DatabaseStatement} from './database';
const category=z.enum(['access','plan','monitoring','other']);
const intake=z.object({subject:z.string().trim().min(4).max(160),message:z.string().trim().min(10).max(12000),category:category.default('other'),email:z.union([z.email().max(254),z.literal('')]).default(''),name:z.string().trim().max(100).default('')}).strict();
export const ticketColumns=`c.id,c.public_ref AS publicRef,c.user_id AS userId,u.username,u.is_owner AS isOwner,c.requester_email AS requesterEmail,c.requester_name AS requesterName,c.subject,c.category,c.state,c.priority,c.channel,c.assignee_id AS assigneeId,c.created_at AS createdAt,c.updated_at AS updatedAt,c.recovery_state AS recoveryState,c.expires_at AS expiresAt,c.used_at AS usedAt`;
export async function supportProof(c:Context<AppEnv>){
 const user=c.get('user'),hash=await digest(readCookie(c,'session')??'');
 const proof=await c.env.DB.prepare('DELETE FROM recent_auth WHERE session_hash=? AND user_id=? AND expires_at>? RETURNING user_id').bind(hash,user.id,nowSeconds()).first();
 if(!proof)throw new HTTPException(403,{message:'Confirma tu passkey antes de autorizar esta operación.'});
}
export function supportEvent(env:Env,id:string,actor:{id:string|null;username:string},kind:string,message:string,visibility='internal',delivery='none'):DatabaseStatement{
 return env.DB.prepare('INSERT INTO support_events(id,case_id,actor_id,actor_name,kind,message,visibility,delivery_state,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),id,actor.id,actor.username,kind,message,visibility,delivery,nowSeconds());
}
export async function createSupportTicket(env:Env,value:z.infer<typeof intake>,actor:{id:string|null;username:string},channel:string,sourceKey:string|null=null,creator=actor){
 if(sourceKey){const previous=await env.DB.prepare('SELECT id,public_ref AS publicRef FROM support_cases WHERE source_key=?').bind(sourceKey).first<{id:string;publicRef:string}>();if(previous)return previous;}
 const stamp=nowSeconds(),quota=await env.DB.prepare('INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=rate_limits.count+1 RETURNING count').bind('support-intake:'+Math.floor(stamp/86400),stamp+172800).first<{count:number}>();
 if(!quota||quota.count>200)throw new HTTPException(429,{message:'La recepción de soporte ha alcanzado la capacidad diaria de la beta. Contacta por correo y conservaremos el reenvío.'});
 const id=crypto.randomUUID(),ref='VYR-'+crypto.randomUUID().replaceAll('-','').slice(0,12).toUpperCase(),now=nowSeconds();
 await env.DB.batch([
  env.DB.prepare('INSERT INTO support_cases(id,public_ref,user_id,requester_email,requester_name,channel,source_key,subject,category,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,ref,actor.id,value.email.toLowerCase(),value.name,channel,sourceKey,value.subject,value.category,creator.id,now,now),
  supportEvent(env,id,creator,'incoming',value.message,'public'),
 ]);return {id,publicRef:ref};
}
async function requireLogin(c:Context<AppEnv>,next:()=>Promise<void>){const user=await sessionUser(c);if(!user)throw new HTTPException(401,{message:'Inicia sesión para consultar tus tickets.'});c.set('user',user);await next();}
export const customerSupport=new Hono<AppEnv>();customerSupport.use('*',requireLogin);
customerSupport.get('/tickets',async c=>{const data=await c.env.DB.prepare(`SELECT ${ticketColumns} FROM support_cases c LEFT JOIN users u ON u.id=c.user_id WHERE c.user_id=? ORDER BY c.updated_at DESC,c.id DESC LIMIT 100`).bind(c.get('user').id).all();return c.json(data.results);});
customerSupport.post('/tickets',async c=>{await rateLimit(c,'support-customer',5,3600);return c.json(await createSupportTicket(c.env,intake.parse(await c.req.json()),c.get('user'),'portal'),201);});
customerSupport.get('/tickets/:id',async c=>{
 const ticket=await c.env.DB.prepare(`SELECT ${ticketColumns} FROM support_cases c LEFT JOIN users u ON u.id=c.user_id WHERE c.id=? AND c.user_id=?`).bind(c.req.param('id'),c.get('user').id).first();
 if(!ticket)throw new HTTPException(404,{message:'Ticket no encontrado.'});
 const rows=await c.env.DB.prepare("SELECT id,actor_name AS actor,kind,visibility,message,created_at AS createdAt,delivery_state AS deliveryState FROM (SELECT * FROM support_events WHERE case_id=? AND visibility='public' ORDER BY created_at DESC,id DESC LIMIT 200) recent ORDER BY created_at,CASE WHEN kind='incoming' THEN 0 ELSE 1 END,id").bind(c.req.param('id')).all();return c.json({ticket,events:rows.results});
});
customerSupport.post('/tickets/:id/messages',async c=>{
 await rateLimit(c,'support-reply',15,3600);const {message}=z.object({message:z.string().trim().min(2).max(12000)}).strict().parse(await c.req.json()),id=c.req.param('id');
 if(!await c.env.DB.prepare('SELECT id FROM support_cases WHERE id=? AND user_id=?').bind(id,c.get('user').id).first())throw new HTTPException(404,{message:'Ticket no encontrado.'});
 await c.env.DB.batch([supportEvent(c.env,id,c.get('user'),'customer_reply',message,'public'),c.env.DB.prepare("UPDATE support_cases SET state='open',updated_at=? WHERE id=?").bind(nowSeconds(),id)]);return c.json({ok:true});
});
export const publicContact=new Hono<AppEnv>();
publicContact.post('/',async c=>{
 await rateLimit(c,'contact',3,3600);const {turnstileToken,...raw}=z.object({subject:z.string(),message:z.string(),category:category.optional(),email:z.email(),name:z.string(),turnstileToken:z.string().optional(),website:z.string().max(0).optional()}).strict().parse(await c.req.json());
 await verifyTurnstile(c,turnstileToken,'contact');const {website,...value}=raw;
 const created=await createSupportTicket(c.env,intake.parse(value),{id:null,username:value.name||'Contacto web'},'contact');return c.json({publicRef:created.publicRef},201);
});
export const support=new Hono<AppEnv>();support.use('*',requireLogin);
support.use('*',async(c,next)=>{const u=c.get('user');if(u.accountStatus!=='active'||(!u.isOwner&&!u.isSupport))throw new HTTPException(403,{message:'Necesitas permiso de soporte de la plataforma.'});if(c.req.method!=='GET')await rateLimit(c,'support-write',30,60);await next();});
support.get('/meta',async c=>{
 const [staff,counts]=await c.env.DB.batch([c.env.DB.prepare("SELECT id,username FROM users WHERE account_status='active' AND (is_owner=1 OR EXISTS(SELECT 1 FROM platform_staff p WHERE p.user_id=users.id)) ORDER BY username LIMIT 100"),c.env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN state='open' THEN 1 ELSE 0 END),0) AS open,COALESCE(SUM(CASE WHEN state='waiting' THEN 1 ELSE 0 END),0) AS waiting,COALESCE(SUM(CASE WHEN state='resolved' THEN 1 ELSE 0 END),0) AS resolved FROM support_cases")]);
 return c.json({owner:c.get('user').isOwner,staff:staff.results,counts:counts.results[0],channels:{address:c.env.SUPPORT_ADDRESS??'soporte@vyrsea.com',inboundReady:c.env.SUPPORT_INBOUND_ENABLED==='1',outboundReady:c.env.SUPPORT_EMAIL_ENABLED==='1'&&Boolean(c.env.EMAIL),forwarding:Boolean(c.env.SUPPORT_FORWARD_TO)}});
});
support.get('/accounts',async c=>{const q=(c.req.query('q')??'').slice(0,100);return c.json((await c.env.DB.prepare('SELECT id,username,plan_id AS planId,account_status AS accountStatus,is_owner AS isOwner FROM users WHERE username LIKE ? ORDER BY username LIMIT 100').bind('%'+q+'%').all()).results);});
support.get('/tickets',async c=>{
 const q=(c.req.query('q')??'').slice(0,100),state=z.enum(['all','open','waiting','resolved']).parse(c.req.query('state')??'all'),channel=z.enum(['all','internal','portal','contact','email']).parse(c.req.query('channel')??'all'),assignee=c.req.query('assignee')??'';
 const rows=await c.env.DB.prepare(`SELECT ${ticketColumns} FROM support_cases c LEFT JOIN users u ON u.id=c.user_id WHERE (?='all' OR c.state=?) AND (?='all' OR c.channel=?) AND (?='' OR c.assignee_id=?) AND (c.subject||' '||c.public_ref||' '||c.requester_email||' '||COALESCE(u.username,'')) LIKE ? ORDER BY c.updated_at DESC,c.id DESC LIMIT 100`).bind(state,state,channel,channel,assignee,assignee,'%'+q+'%').all();return c.json(rows.results);
});
support.post('/tickets',async c=>{
 const {accountId,...raw}=intake.extend({accountId:z.string().min(1).max(64).optional()}).parse(await c.req.json());
 const customer=accountId?await c.env.DB.prepare('SELECT id,username FROM users WHERE id=?').bind(accountId).first<{id:string;username:string}>():null;
 if(accountId&&!customer)throw new HTTPException(404,{message:'Cuenta no encontrada.'});
 const created=await createSupportTicket(c.env,raw,customer??{id:null,username:raw.name||'Contacto'},'internal',null,c.get('user'));
 await supportEvent(c.env,created.id,c.get('user'),'created_by_support','Ticket registrado por soporte.').run();return c.json(created,201);
});
support.get('/tickets/:id',async c=>{
 const id=c.req.param('id'),ticket=await c.env.DB.prepare(`SELECT ${ticketColumns} FROM support_cases c LEFT JOIN users u ON u.id=c.user_id WHERE c.id=?`).bind(id).first<{userId:string|null;isOwner:number|null}>();if(!ticket)throw new HTTPException(404,{message:'Ticket no encontrado.'});
 const [events,security]=await c.env.DB.batch([c.env.DB.prepare("SELECT id,actor_name AS actor,kind,visibility,message,created_at AS createdAt,delivery_state AS deliveryState,attempts,last_error AS lastError FROM (SELECT * FROM support_events WHERE case_id=? ORDER BY created_at DESC,id DESC LIMIT 200) recent ORDER BY created_at,CASE WHEN kind='incoming' THEN 0 ELSE 1 END,id").bind(id),c.env.DB.prepare('SELECT (SELECT COUNT(*) FROM credentials WHERE user_id=?) AS passkeys,(SELECT COUNT(*) FROM recovery_codes WHERE user_id=?) AS recoveryCodes,(SELECT COUNT(*) FROM platform_staff WHERE user_id=?) AS isStaff').bind(ticket.userId,ticket.userId,ticket.userId)]);
 return c.json({ticket,events:events.results,security:security.results[0],canApproveRecovery:c.get('user').isOwner&&!ticket.isOwner&&!!ticket.userId});
});
support.patch('/tickets/:id',async c=>{
 const input=z.object({state:z.enum(['open','waiting','resolved']),priority:z.enum(['low','normal','high','urgent']),assigneeId:z.string().max(64).nullable(),category:category.optional()}).strict().parse(await c.req.json()),id=c.req.param('id');
 if(!await c.env.DB.prepare('SELECT id FROM support_cases WHERE id=?').bind(id).first())throw new HTTPException(404,{message:'Ticket no encontrado.'});
 if(input.assigneeId&&!await c.env.DB.prepare("SELECT id FROM users WHERE id=? AND account_status='active' AND (is_owner=1 OR EXISTS(SELECT 1 FROM platform_staff ps WHERE ps.user_id=users.id))").bind(input.assigneeId).first())throw new HTTPException(400,{message:'Asigna el ticket a un miembro activo de soporte.'});
 await c.env.DB.batch([c.env.DB.prepare("UPDATE support_cases SET state=?,priority=?,assignee_id=?,category=COALESCE(?,category),updated_at=?,token_hash=CASE WHEN ?='resolved' THEN NULL ELSE token_hash END,recovery_state=CASE WHEN ?='resolved' AND recovery_state='approved' THEN 'revoked' ELSE recovery_state END WHERE id=?").bind(input.state,input.priority,input.assigneeId,input.category??null,nowSeconds(),input.state,input.state,id),supportEvent(c.env,id,c.get('user'),'management',`Estado: ${input.state}; prioridad: ${input.priority}; categoría: ${input.category??'sin cambios'}; responsable: ${input.assigneeId??'sin asignar'}.`)]);return c.json({ok:true});
});
support.post('/tickets/:id/messages',async c=>{
 const {message,visibility}=z.object({message:z.string().trim().min(2).max(12000),visibility:z.enum(['internal','public'])}).strict().parse(await c.req.json()),id=c.req.param('id');
 const ticket=await c.env.DB.prepare('SELECT requester_email FROM support_cases WHERE id=?').bind(id).first<{requester_email:string}>();if(!ticket)throw new HTTPException(404,{message:'Ticket no encontrado.'});
 const delivery=visibility==='public'&&ticket.requester_email?(c.env.SUPPORT_EMAIL_ENABLED==='1'&&c.env.EMAIL?'pending':'disabled'):'none';
 await c.env.DB.batch([supportEvent(c.env,id,c.get('user'),visibility==='public'?'staff_reply':'note',message,visibility,delivery),c.env.DB.prepare("UPDATE support_cases SET state=CASE WHEN ?='public' THEN 'waiting' ELSE state END,updated_at=? WHERE id=?").bind(visibility,nowSeconds(),id)]);return c.json({ok:true,emailState:delivery});
});
support.put('/staff/:id',async c=>{
 if(!c.get('user').isOwner)throw new HTTPException(403,{message:'Solo el propietario administra el equipo de soporte.'});
 const {enabled}=z.object({enabled:z.boolean()}).strict().parse(await c.req.json()),id=c.req.param('id');
 const target=await c.env.DB.prepare('SELECT id,is_owner,account_status FROM users WHERE id=?').bind(id).first<{id:string;is_owner:number;account_status:string}>();
 if(!target||target.is_owner||enabled&&target.account_status!=='active')throw new HTTPException(409,{message:'Elige una cuenta activa de cliente; el propietario ya tiene acceso.'});
 if(enabled&&!await c.env.DB.prepare('SELECT id FROM credentials WHERE user_id=? LIMIT 1').bind(id).first())throw new HTTPException(409,{message:'El futuro agente debe registrar primero su passkey.'});
 if(enabled&&await c.env.DB.prepare("SELECT id FROM support_cases WHERE user_id=? AND recovery_state IN ('approved','using') LIMIT 1").bind(id).first())throw new HTTPException(409,{message:'Revoca primero las recuperaciones pendientes de esta cuenta.'});
 await supportProof(c);
 await c.env.DB.batch([enabled?c.env.DB.prepare('INSERT INTO platform_staff(user_id,granted_by,created_at) VALUES(?,?,?) ON CONFLICT(user_id) DO NOTHING').bind(id,c.get('user').id,nowSeconds()):c.env.DB.prepare('DELETE FROM platform_staff WHERE user_id=?').bind(id),c.env.DB.prepare('INSERT INTO audit_events(id,workspace_id,actor_id,actor_name,action,resource,created_at) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),id,c.get('user').id,c.get('user').username,enabled?'support.grant':'support.revoke',id,nowSeconds())]);
 return c.json({ok:true});
});
