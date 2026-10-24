import {Hono} from 'hono';
import {HTTPException} from 'hono/http-exception';
import {z} from 'zod';
import type {AppEnv,Env} from './env';
import {nowSeconds} from './env';
import {digest,randomToken,rateLimit} from './security';
import {accountPlan} from './plans';
import {normalizeTarget,publicDNS} from './probe';
import {decryptSecret,encryptSecret,signature} from './alert-crypto';

const enabled=(env:Env)=>env.ALERTS_ENABLED==='1';
const emailReady=(env:Env)=>enabled(env)&&Boolean(env.EMAIL&&env.EMAIL_FROM&&env.EMAIL_EVENTS_ENABLED==='1'&&env.CLOUDFLARE_EMAIL_ZONE_ID&&env.ALERTS_ENCRYPTION_KEY);
const webhookReady=(env:Env)=>enabled(env)&&Boolean(env.ALERTS_ENCRYPTION_KEY);
const emailAllowed=(plan:string)=>['starter','pro','business'].includes(plan);
const webhookAllowed=(plan:string)=>['pro','business'].includes(plan);
const backoff=[60,300,900,3600,10800];
type Destination={id:string;user_id:string;kind:'email'|'webhook';target:string;secret_cipher:string|null;verified_at:number|null;verification_expires:number|null;enabled:number;created_at:number};
type Delivery={id:string;destination_id:string;event_id:string;payload:string;attempts:number;created_at:number;lease_token:string};
export const alerts=new Hono<AppEnv>();
alerts.use('*',async(c,next)=>{if(!['owner','admin'].includes(c.get('workspaceRole')??'owner'))throw new HTTPException(403,{message:'La configuración de alertas requiere un administrador.'});await next();});
alerts.get('/',async c=>{
  const id=c.get('user').id,plan=await accountPlan(c.env,id);
  const [destinations,deliveries]=await c.env.DB.batch([
    c.env.DB.prepare('SELECT id,kind,target,verified_at AS verifiedAt,enabled,created_at AS createdAt FROM alert_destinations WHERE user_id=? ORDER BY created_at LIMIT 10').bind(id),
    c.env.DB.prepare(`SELECT d.id,d.destination_id AS destinationId,d.event_id AS eventId,d.state,d.attempts,d.provider_id AS providerId,d.last_status AS lastStatus,d.last_error AS lastError,d.created_at AS createdAt,d.updated_at AS updatedAt
      FROM alert_deliveries d JOIN alert_destinations a ON a.id=d.destination_id WHERE a.user_id=? ORDER BY d.created_at DESC LIMIT 50`).bind(id),
  ]);
  return c.json({destinations:destinations.results,deliveries:deliveries.results,email:{entitled:emailAllowed(plan.id),ready:emailReady(c.env)},webhook:{entitled:webhookAllowed(plan.id),ready:webhookReady(c.env)}});
});
alerts.post('/',async c=>{
  const value=z.discriminatedUnion('kind',[z.object({kind:z.literal('email'),target:z.email().max(254)}).strict(),z.object({kind:z.literal('webhook'),target:z.string().max(2048)}).strict()]).parse(await c.req.json());
  const id=c.get('user').id,plan=await accountPlan(c.env,id);
  if(!(value.kind==='email'?emailAllowed(plan.id):webhookAllowed(plan.id)))throw new HTTPException(403,{message:'Este canal no está incluido en tu plan.'});
  const count=await c.env.DB.prepare('SELECT COUNT(*) AS n FROM alert_destinations WHERE user_id=?').bind(id).first<{n:number}>();
  if(count!.n>=5)throw new HTTPException(409,{message:'La beta admite cinco destinos por cuenta.'});
  let target:string;
  try{target=value.kind==='email'?value.target.trim().toLowerCase():normalizeTarget(value.target);}catch(e){throw new HTTPException(400,{message:(e as Error).message});}
  if(value.kind==='webhook'&&!target.startsWith('https:'))throw new HTTPException(400,{message:'Los webhooks requieren HTTPS.'});
  if(await c.env.DB.prepare('SELECT id FROM alert_destinations WHERE user_id=? AND kind=? AND target=?').bind(id,value.kind,target).first())throw new HTTPException(409,{message:'Ese destino ya está registrado.'});
  if(value.kind==='webhook'&&!c.env.ALERTS_ENCRYPTION_KEY)throw new HTTPException(503,{message:'Falta instalar la clave de cifrado de alertas.'});
  const destinationId=crypto.randomUUID(),secret=value.kind==='webhook'?randomToken():null;
  await c.env.DB.prepare('INSERT INTO alert_destinations(id,user_id,kind,target,secret_cipher,verified_at,created_at) VALUES(?,?,?,?,?,?,?)')
    .bind(destinationId,id,value.kind,target,secret?await encryptSecret(c.env,secret):null,null,nowSeconds()).run();
  return c.json({id:destinationId,...(secret?{secret}:{}),verificationRequired:true},201);
});
alerts.delete('/:id',async c=>{await c.env.DB.prepare('DELETE FROM alert_destinations WHERE id=? AND user_id=?').bind(c.req.param('id'),c.get('user').id).run();return c.json({ok:true});});
alerts.patch('/:id',async c=>{
  const {enabled}=z.object({enabled:z.boolean()}).strict().parse(await c.req.json());
  await c.env.DB.prepare('UPDATE alert_destinations SET enabled=? WHERE id=? AND user_id=?').bind(Number(enabled),c.req.param('id'),c.get('user').id).run();return c.json({ok:true});
});
alerts.post('/:id/test',async c=>{
  z.object({}).strict().parse(await c.req.json());
  const row=await c.env.DB.prepare('SELECT * FROM alert_destinations WHERE id=? AND user_id=?').bind(c.req.param('id'),c.get('user').id).first<Destination>();
  if(!row)throw new HTTPException(404,{message:'Destino no encontrado.'});
  const plan=await accountPlan(c.env,c.get('user').id);
  if(!(row.kind==='email'?emailAllowed(plan.id):webhookAllowed(plan.id)))throw new HTTPException(403,{message:'El canal no está incluido en tu plan.'});
  if(!(row.kind==='email'?emailReady(c.env):webhookReady(c.env)))throw new HTTPException(503,{message:'El canal todavía no está activado.'});
  if(!row.enabled||!row.verified_at)throw new HTTPException(409,{message:'Confirma y habilita el destino antes de enviar una prueba.'});
  await rateLimit(c,'alert-test',5,3600);
  const id='test:'+crypto.randomUUID(),now=nowSeconds();
  await c.env.DB.prepare('INSERT INTO alert_deliveries(id,destination_id,event_id,payload,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
    .bind(id,row.id,id,'Prueba de alertas de Vyrsea. No representa una incidencia real.',now,now,now).run();
  return c.json({ok:true,message:'Prueba en cola. Consulta su resultado en Últimas entregas.'});
});
alerts.post('/:id/verify',async c=>{
  const destination=await c.env.DB.prepare('SELECT * FROM alert_destinations WHERE id=? AND user_id=?').bind(c.req.param('id'),c.get('user').id).first<Destination>();
  if(!destination)throw new HTTPException(404,{message:'Destino no encontrado.'});
  if(!destination.enabled)throw new HTTPException(409,{message:'Habilita el destino antes de verificarlo.'});
  const now=nowSeconds();
  if(destination.kind==='email'){
    if(!emailReady(c.env))throw new HTTPException(503,{message:'El envío aún no está activado. Falta conectar el proveedor y verificar el remitente.'});
    if(destination.verification_expires&&destination.verification_expires>now)throw new HTTPException(429,{message:'Ya hay una confirmación vigente. Revisa tu correo o espera a que caduque.'});
    await rateLimit(c,'email-verification',5,3600);
    const token=randomToken(),event=crypto.randomUUID();
    // Store the verification message encrypted; the public confirmation only sees its hash.
    const payload='enc:'+await encryptSecret(c.env,JSON.stringify({subject:'Confirma tus alertas de Vyrsea',text:`Confirma este destino para recibir alertas: ${c.env.APP_ORIGIN}/#confirm-email=${token}`}));
    await c.env.DB.batch([c.env.DB.prepare('UPDATE alert_destinations SET verification_hash=?,verification_expires=? WHERE id=?').bind(await digest(token),now+1800,destination.id),
      c.env.DB.prepare(`INSERT INTO alert_deliveries(id,destination_id,event_id,payload,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`).bind(event,destination.id,event,payload,now,now,now)]);
    return c.json({ok:true,message:'Confirmación en cola. El enlace caduca en 30 minutos.'});
  }
  if(!webhookReady(c.env))throw new HTTPException(503,{message:'Las entregas externas están deshabilitadas hasta completar su activación.'});
  await rateLimit(c,'webhook-verification',5,3600);
  const challenge=randomToken();
  try{
    await publicDNS(new URL(destination.target).hostname,AbortSignal.timeout(5000),fetch);
    const body=JSON.stringify({type:'vyrsea.webhook.verify',challenge}),timestamp=String(now),secret=await decryptSecret(c.env,destination.secret_cipher!);
    const response=await fetch(destination.target,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/json','X-Vyrsea-Timestamp':timestamp,'X-Vyrsea-Signature':`v1,${await signature(secret,`${timestamp}.${challenge}.${body}`)}`,'X-Vyrsea-Event-Id':challenge},body});
    if(!response.ok)throw new Error();
    const text=await boundedText(response,1024);const data=JSON.parse(text);
    if(data.challenge!==challenge)throw new Error();
    await c.env.DB.prepare('UPDATE alert_destinations SET verified_at=? WHERE id=?').bind(now,destination.id).run();return c.json({ok:true});
  }catch{throw new HTTPException(400,{message:'El destino debe responder con JSON {"challenge":"valor recibido"}, usando HTTPS y DNS público, sin redirecciones.'});}
});
export async function boundedText(response:Response,max:number){
  if(!response.body)return '';const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)throw new Error('Response too large');chunks.push(value);}}finally{await reader.cancel();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}return new TextDecoder().decode(bytes);
}
export const publicAlerts=new Hono<AppEnv>();
publicAlerts.post('/confirm',async c=>{
  const {token}=z.object({token:z.string().min(30).max(100)}).strict().parse(await c.req.json()),now=nowSeconds();
  const row=await c.env.DB.prepare('UPDATE alert_destinations SET verified_at=?,verification_hash=NULL,verification_expires=NULL WHERE kind=\'email\' AND verification_hash=? AND verification_expires>? RETURNING id').bind(now,await digest(token),now).first();
  if(!row)throw new HTTPException(409,{message:'La confirmación ha caducado o ya se utilizó.'});return c.json({ok:true});
});
const emailEventSchema=z.object({type:z.string().startsWith('cf.email.sending.message.'),source:z.object({type:z.literal('email.sending'),zoneId:z.string(),domain:z.string()}),
  payload:z.object({messageId:z.string().max(254),recipient:z.email(),terminal:z.boolean(),delivery:z.object({status:z.enum(['delivered','deferred','bounced','failed','rejected','complained'])})})});
export type EmailEvent=z.infer<typeof emailEventSchema>;
// Only called by the trusted queue consumer; there is no public callback URL.
export async function consumeEmailEvent(env:Env,event:unknown,now=nowSeconds()){
  const data=emailEventSchema.parse(event);
  if(env.EMAIL_EVENTS_ENABLED!=='1'||data.source.zoneId!==env.CLOUDFLARE_EMAIL_ZONE_ID||!env.EMAIL_FROM?.endsWith('@'+data.source.domain))throw new Error('Untrusted email source');
  if(!data.payload.terminal)return;
  const delivered=data.payload.delivery.status==='delivered',state=delivered?'delivered':'failed',provider=data.payload.messageId;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO email_receipts(provider_id,state,created_at) VALUES(?,?,?) ON CONFLICT(provider_id) DO UPDATE SET state=CASE WHEN email_receipts.state='failed' THEN 'failed' ELSE excluded.state END`).bind(provider,state,now),
    env.DB.prepare(`UPDATE alert_deliveries SET state=(SELECT state FROM email_receipts WHERE provider_id=?),last_error=?,updated_at=? WHERE provider_id=? AND state IN ('sending','accepted','delivered','uncertain')`).bind(provider,delivered?null:data.payload.delivery.status,now,provider),
    ...(!delivered?[env.DB.prepare('UPDATE alert_destinations SET enabled=0 WHERE id IN (SELECT destination_id FROM alert_deliveries WHERE provider_id=?)').bind(provider)]:[]),
  ]);
}
// Called once per minute. No new queue; at most five deliveries are claimed per tick.
export async function dispatchAlerts(env:Env,now=nowSeconds()){
  if(!enabled(env)||!env.ALERTS_ENCRYPTION_KEY)return;
  // Materialize only recent, eligible notifications. Unique keys deduplicate retries.
  await env.DB.prepare(`INSERT OR IGNORE INTO alert_deliveries(id,destination_id,event_id,payload,next_attempt_at,created_at,updated_at)
    SELECT a.id || ':' || n.id,a.id,n.id,n.message,?,?,? FROM notifications n JOIN alert_destinations a ON a.user_id=n.user_id JOIN users u ON u.id=n.user_id
    WHERE n.created_at>=? AND n.created_at>=a.created_at AND a.enabled=1 AND a.verified_at IS NOT NULL AND u.account_status='active'
    AND ((a.kind='email' AND u.plan_id IN ('starter','pro','business')) OR (a.kind='webhook' AND u.plan_id IN ('pro','business')) OR (u.is_owner=1 AND u.owner_apply_plan=0))
    AND NOT EXISTS(SELECT 1 FROM alert_deliveries d WHERE d.destination_id=a.id AND d.event_id=n.id) ORDER BY n.created_at LIMIT 100`).bind(now,now,now,now-86400).run();
  // The email API has no provider idempotency key. Never resend an expired
  // in-flight email blindly: an accepted send may have lost its local receipt.
  await env.DB.prepare(`UPDATE alert_deliveries SET state='uncertain',last_error='Envío interrumpido: revisar antes de reenviar.',updated_at=? WHERE state='sending' AND lease_until<=? AND destination_id IN (SELECT id FROM alert_destinations WHERE kind='email')`).bind(now,now).run();
  const rows=await env.DB.prepare(`SELECT d.* FROM alert_deliveries d JOIN alert_destinations a ON a.id=d.destination_id WHERE d.state IN ('pending','sending') AND d.next_attempt_at<=? AND d.lease_until<=? AND a.enabled=1 AND ((a.kind='email' AND ?=1) OR (a.kind='webhook' AND ?=1)) ORDER BY d.created_at LIMIT 5`).bind(now,now,Number(emailReady(env)),Number(webhookReady(env))).all<Delivery>();
  for(const row of rows.results){
    const lease=crypto.randomUUID();
    const claimed=await env.DB.prepare(`UPDATE alert_deliveries SET state='sending',lease_token=?,lease_until=?,attempts=attempts+1 WHERE id=? AND state IN ('pending','sending') AND lease_until<=? RETURNING attempts`).bind(lease,now+60,row.id,now).first<{attempts:number}>();
    if(!claimed)continue;
    const dest=await env.DB.prepare(`SELECT a.* FROM alert_destinations a JOIN users u ON u.id=a.user_id WHERE a.id=? AND a.enabled=1 AND u.account_status='active'
      AND ((u.is_owner=1 AND u.owner_apply_plan=0) OR (a.kind='email' AND u.plan_id IN ('starter','pro','business')) OR (a.kind='webhook' AND u.plan_id IN ('pro','business')))` ).bind(row.destination_id).first<Destination>();
    let state='pending',status:number|null=null,error:string|null=null,providerId:string|null=null;
    try{
      if(!dest){state='cancelled';throw new Error('Destino o plan sin acceso.');}
      if(dest.kind==='email'){
        if(!emailReady(env))throw new Error('Proveedor de correo sin activar.');
        let payload:{subject:string;text:string};
        if(row.payload.startsWith('enc:'))payload=JSON.parse(await decryptSecret(env,row.payload.slice(4)));
        else {if(!dest.verified_at){state='cancelled';throw new Error('Destino sin confirmar.');}payload={subject:row.event_id.startsWith('test:')?'Vyrsea · prueba de alertas':'Vyrsea · cambio de disponibilidad',text:row.payload};}
        try{
          const result=await env.EMAIL!.send({from:env.EMAIL_FROM!,to:dest.target,...payload,headers:{'X-Vyrsea-Event-Id':row.event_id,'Auto-Submitted':'auto-generated'}});
          providerId=result.messageId;state='accepted';
        }catch(e){
          const code=(e as {code?:string}).code;
          if(['E_RATE_LIMIT_EXCEEDED','E_DAILY_LIMIT_EXCEEDED'].includes(code??''))throw new Error('Cloudflare ha limitado temporalmente el envío.');
          state=code&&['E_SENDER_NOT_VERIFIED','E_RECIPIENT_NOT_ALLOWED','E_RECIPIENT_SUPPRESSED','E_SENDER_DOMAIN_NOT_AVAILABLE','E_ACCOUNT_SUSPENDED','E_VALIDATION_ERROR','E_DELIVERY_FAILED'].includes(code)?'failed':'uncertain';
          throw new Error(state==='uncertain'?'Respuesta de envío incierta: revisar antes de reenviar.':'Cloudflare ha rechazado el envío.');
        }
      }else{
        if(!webhookReady(env)||!dest.verified_at){state='cancelled';throw new Error('Destino sin verificar.');}
        await publicDNS(new URL(dest.target).hostname,AbortSignal.timeout(5000),fetch);
        const body=JSON.stringify({id:row.event_id,type:row.event_id.startsWith('test:')?'monitor.test':row.event_id.endsWith(':down')?'monitor.down':'monitor.up',createdAt:row.created_at,message:row.payload}),time=String(now);
        const response=await fetch(dest.target,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/json','X-Vyrsea-Event-Id':row.event_id,'X-Vyrsea-Timestamp':time,'X-Vyrsea-Signature':`v1,${await signature(await decryptSecret(env,dest.secret_cipher!),`${time}.${row.event_id}.${body}`)}`},body});
        status=response.status;await response.body?.cancel();if(!response.ok)throw new Error(`Destino HTTP ${status}`);state='delivered';
      }
    }catch(e){error=e instanceof Error?e.message:'Error de entrega';if(!['cancelled','uncertain','failed'].includes(state)&&(claimed.attempts>=5||now-row.created_at>=23*3600||status!==null&&status>=400&&status<500&&status!==429))state='failed';}
    await env.DB.prepare('UPDATE alert_deliveries SET state=?,last_status=?,last_error=?,provider_id=?,next_attempt_at=?,lease_until=0,lease_token=NULL,updated_at=? WHERE id=? AND lease_token=?')
      .bind(state,status,error,providerId,now+backoff[Math.min(claimed.attempts-1,4)],now,row.id,lease).run();
    if(providerId){await env.DB.prepare(`UPDATE alert_deliveries SET state=COALESCE((SELECT state FROM email_receipts WHERE provider_id=?),state) WHERE id=? AND state='accepted'`).bind(providerId,row.id).run();}
    if(providerId)await env.DB.prepare(`UPDATE alert_destinations SET enabled=0 WHERE id=? AND EXISTS(SELECT 1 FROM email_receipts WHERE provider_id=? AND state='failed')`).bind(row.destination_id,providerId).run();
  }
}
