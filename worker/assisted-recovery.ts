import {Hono} from 'hono';
import {HTTPException} from 'hono/http-exception';
import {z} from 'zod';
import type {AppEnv} from './env';
import {nowSeconds} from './env';
import {challenge,registration,verifyRegistration} from './credential-security';
import {consumeChallenge} from './auth';
import {digest,randomToken,rateLimit,verifyTurnstile,bytesToBase64,putCookie} from './security';
import {support,supportProof,supportEvent} from './support';
import {expireInactiveAccounts} from './account-policy';
const invalid=()=>new HTTPException(400,{message:'El enlace de recuperación no es válido, ha caducado o ya se utilizó.'});
const eligible=`c.recovery_state='approved' AND c.token_hash=? AND c.expires_at>? AND c.state<>'resolved' AND u.is_owner=0 AND NOT EXISTS(SELECT 1 FROM platform_staff ps WHERE ps.user_id=u.id) AND EXISTS(SELECT 1 FROM users a WHERE a.id=c.verified_by AND a.is_owner=1 AND a.account_status='active')`;
support.post('/tickets/:id/recovery',async c=>{
 if(!c.get('user').isOwner)throw new HTTPException(403,{message:'Soporte puede registrar la solicitud; solo el propietario autoriza la recuperación.'});
 const input=z.object({verified:z.literal(true),method:z.enum(['verified_contact','business_contract','manual_checks']),note:z.string().trim().min(20).max(2000)}).strict().parse(await c.req.json()),id=c.req.param('id');
 const ticket=await c.env.DB.prepare("SELECT c.user_id,u.is_owner,EXISTS(SELECT 1 FROM platform_staff ps WHERE ps.user_id=u.id) AS staff FROM support_cases c JOIN users u ON u.id=c.user_id WHERE c.id=? AND c.category='access' AND c.state<>'resolved'").bind(id).first<{user_id:string;is_owner:number;staff:number}>();
 if(!ticket)throw new HTTPException(409,{message:'Abre un ticket de acceso y vincúlalo a la cuenta verificada.'});
 if(ticket.is_owner||ticket.staff)throw new HTTPException(409,{message:'No se recuperan cuentas propietarias o de soporte por esta vía. Para un agente, retira primero su permiso global y verifica su identidad.'});
 await supportProof(c);const token=randomToken(),expiresAt=nowSeconds()+3600;
 await c.env.DB.batch([c.env.DB.prepare("UPDATE support_cases SET recovery_state='approved',token_hash=?,expires_at=?,verified_by=?,recovery_claim=NULL,used_at=NULL,updated_at=? WHERE id=?").bind(await digest(token),expiresAt,c.get('user').id,nowSeconds(),id),supportEvent(c.env,id,c.get('user'),'recovery_approved',`Verificación ${input.method}: ${input.note}`)]);
 return c.json({url:`${c.env.APP_ORIGIN}/#recovery=${encodeURIComponent(token)}`,expiresAt});
});
support.post('/tickets/:id/recovery/revoke',async c=>{
 const id=c.req.param('id');await c.env.DB.batch([c.env.DB.prepare("UPDATE support_cases SET recovery_state='revoked',token_hash=NULL,recovery_claim=NULL,updated_at=? WHERE id=? AND recovery_state='approved'").bind(nowSeconds(),id),supportEvent(c.env,id,c.get('user'),'recovery_revoked','Enlace de recuperación retirado por soporte.')]);return c.json({ok:true});
});
support.put('/tickets/:id/account',async c=>{
 if(!c.get('user').isOwner)throw new HTTPException(403,{message:'Solo el propietario puede vincular contactos a cuentas.'});
 const {accountId}=z.object({accountId:z.string().min(1).max(64)}).strict().parse(await c.req.json()),id=c.req.param('id');
 if(!await c.env.DB.prepare('SELECT id FROM users WHERE id=?').bind(accountId).first())throw new HTTPException(404,{message:'Cuenta no encontrada.'});
 await c.env.DB.batch([c.env.DB.prepare("UPDATE support_cases SET user_id=?,token_hash=NULL,recovery_state=CASE WHEN recovery_state='approved' THEN 'revoked' ELSE recovery_state END,updated_at=? WHERE id=?").bind(accountId,nowSeconds(),id),supportEvent(c.env,id,c.get('user'),'account_linked','Contacto vinculado a la cuenta '+accountId+'. Esto no acredita por sí solo su titularidad.')]);return c.json({ok:true});
});
export const assistedRecovery=new Hono<AppEnv>();
assistedRecovery.post('/options',async c=>{
 await rateLimit(c,'assisted-recover',8,600);const {token,turnstileToken}=z.object({token:z.string().min(30).max(100),turnstileToken:z.string().optional()}).strict().parse(await c.req.json());await verifyTurnstile(c,turnstileToken,'recover');
 const hash=await digest(token),row=await c.env.DB.prepare(`SELECT c.id,u.id AS userId,u.username FROM support_cases c JOIN users u ON u.id=c.user_id WHERE ${eligible}`).bind(hash,nowSeconds()).first<{id:string;userId:string;username:string}>();if(!row)throw invalid();
 const options=await registration(c,row.userId,row.username,false);await challenge(c,'assisted-recovery',options.challenge,row.userId,JSON.stringify({id:row.id,hash}));return c.json(options);
});
assistedRecovery.post('/verify',async c=>{
 await rateLimit(c,'assisted-verify',10,600);const saved=await consumeChallenge(c,'assisted-recovery'),proof=z.object({id:z.string().uuid(),hash:z.string()}).parse(JSON.parse(saved.context??'{}')),key=await verifyRegistration(c,saved.challenge),now=nowSeconds();
 await expireInactiveAccounts(c.env,now,saved.user_id);
 const token=randomToken(),session=await digest(token),claim=crypto.randomUUID(),guard="EXISTS(SELECT 1 FROM support_cases c WHERE c.id=? AND c.user_id=? AND c.recovery_state='using' AND c.recovery_claim=?)",params=[proof.id,saved.user_id,claim];
 const results=await c.env.DB.batch([
  c.env.DB.prepare(`UPDATE support_cases SET recovery_state='using',recovery_claim=? WHERE id=? AND user_id=? AND EXISTS(SELECT 1 FROM support_cases c JOIN users u ON u.id=c.user_id WHERE c.id=? AND ${eligible})`).bind(claim,proof.id,saved.user_id,proof.id,proof.hash,now),
  c.env.DB.prepare(`DELETE FROM credentials WHERE user_id=? AND ${guard}`).bind(saved.user_id,...params),
  c.env.DB.prepare(`INSERT INTO credentials(id,user_id,public_key,counter,transports,label,created_at) SELECT ?,?,?,?,?,?,? WHERE ${guard}`).bind(key.id,saved.user_id,bytesToBase64(key.publicKey),key.counter,JSON.stringify(key.transports??[]),'Acceso restaurado por soporte',now,...params),
  c.env.DB.prepare(`DELETE FROM sessions WHERE user_id=? AND ${guard}`).bind(saved.user_id,...params),
  c.env.DB.prepare(`INSERT INTO sessions(token_hash,user_id,expires_at) SELECT ?,?,? WHERE ${guard}`).bind(session,saved.user_id,now+604800,...params),
  c.env.DB.prepare(`DELETE FROM recovery_codes WHERE user_id=? AND ${guard}`).bind(saved.user_id,...params),
  c.env.DB.prepare(`DELETE FROM challenges WHERE user_id=? AND ${guard}`).bind(saved.user_id,...params),
  c.env.DB.prepare(`INSERT INTO support_events(id,case_id,actor_id,actor_name,kind,message,visibility,created_at) SELECT ?,c.id,c.user_id,u.username,'recovery_used','El titular ha registrado una nueva passkey. Se han revocado las claves, sesiones y códigos anteriores.','internal',? FROM support_cases c JOIN users u ON u.id=c.user_id WHERE c.id=? AND c.recovery_claim=? AND c.recovery_state='using'`).bind(crypto.randomUUID(),now,proof.id,claim),
  c.env.DB.prepare("UPDATE support_cases SET recovery_state='used',token_hash=NULL,recovery_claim=NULL,used_at=?,updated_at=?,state='resolved' WHERE id=? AND recovery_state='using' AND recovery_claim=?").bind(now,now,proof.id,claim),
 ]);
 if(results[2].meta.changes!==1)throw invalid();putCookie(c,'session',token,604800);return c.json({ok:true});
});
