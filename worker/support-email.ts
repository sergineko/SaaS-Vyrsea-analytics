import PostalMime from 'postal-mime';
import type {Env} from './env';
import {nowSeconds} from './env';
import {digest} from './security';
import {createSupportTicket} from './support';

export async function receiveSupportEmail(message:ForwardableEmailMessage,env:Env){
 // Preserve the existing delivery to the owner, even if parsing, quotas or
 // the database prevent a ticket from being created. No raw body is logged.
 if(env.SUPPORT_FORWARD_TO)await message.forward(env.SUPPORT_FORWARD_TO);
 if(env.SUPPORT_INBOUND_ENABLED!=='1'||message.to.toLowerCase()!==(env.SUPPORT_ADDRESS??'soporte@vyrsea.com').toLowerCase())return;
 if(message.rawSize>262144){console.error(JSON.stringify({event:'support_email_oversize_forwarded'}));return;}
 if(message.headers.get('auto-submitted')&&!/^no$/i.test(message.headers.get('auto-submitted')!))return;
 try{
  const email=await PostalMime.parse(message.raw),sender=email.from?.address?.toLowerCase();
  if(!sender||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender))return;
  const text=(email.text??(email.html??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ')).trim().slice(0,12000)||'Correo recibido sin cuerpo de texto. Consulta el reenvío original.';
  const source='email:'+await digest((email.messageId??'')+':'+sender+':'+(email.subject??'')+':'+text);
  if(await env.DB.prepare('SELECT id FROM support_events WHERE message_id=?').bind(source).first())return;
  const ref=(email.subject??'').match(/\bVYR-[A-F0-9]{12}\b/i)?.[0]?.toUpperCase();
  const ticket=ref?await env.DB.prepare('SELECT id FROM support_cases WHERE public_ref=? AND requester_email=?').bind(ref,sender).first<{id:string}>():null;
  if(ticket){await env.DB.batch([env.DB.prepare("INSERT OR IGNORE INTO support_events(id,case_id,actor_name,kind,visibility,message,message_id,created_at) VALUES(?,? ,?,'email_reply','public',?,?,?)").bind(crypto.randomUUID(),ticket.id,email.from?.name||sender,text,source,nowSeconds()),env.DB.prepare("UPDATE support_cases SET state='open',updated_at=? WHERE id=?").bind(nowSeconds(),ticket.id)]);}
  else await createSupportTicket(env,{subject:(email.subject||'Consulta por correo').slice(0,160),message:text,category:'other',email:sender,name:(email.from?.name??'').slice(0,100)},{id:null,username:email.from?.name||sender},'email',source);
 }catch{console.error(JSON.stringify({event:'support_email_ticket_failed_forward_preserved'}));}
}

export async function dispatchSupportEmail(env:Env){
 if(env.SUPPORT_EMAIL_ENABLED!=='1'||!env.EMAIL||!env.EMAIL_FROM)return;
 const now=nowSeconds();
 await env.DB.prepare("UPDATE support_events SET delivery_state='uncertain',last_error='Envío interrumpido. Revisar antes de reenviar.' WHERE delivery_state='sending' AND retry_at<=?").bind(now).run();
 const rows=await env.DB.prepare("SELECT e.id,e.case_id,e.message,e.attempts,c.subject,c.public_ref,c.requester_email FROM support_events e JOIN support_cases c ON c.id=e.case_id WHERE e.delivery_state='pending' AND COALESCE(e.retry_at,0)<=? ORDER BY e.created_at LIMIT 2").bind(now).all<{id:string;case_id:string;message:string;attempts:number;subject:string;public_ref:string;requester_email:string}>();
 for(const row of rows.results){
  const claimed=await env.DB.prepare("UPDATE support_events SET delivery_state='sending',attempts=attempts+1,retry_at=? WHERE id=? AND delivery_state='pending' RETURNING id").bind(now+120,row.id).first();if(!claimed)continue;
  try{
   const sent=await env.EMAIL.send({to:row.requester_email,from:env.EMAIL_FROM,subject:`[${row.public_ref}] ${row.subject}`.replace(/[\r\n]/g,' '),text:row.message+'\n\nReferencia: '+row.public_ref+'\nTambién puedes consultar el ticket en tu panel de Vyrsea.',headers:{'Reply-To':env.SUPPORT_ADDRESS??'soporte@vyrsea.com','X-Vyrsea-Support-Id':row.id}});
   await env.DB.prepare("UPDATE support_events SET delivery_state='sent',provider_message_id=?,last_error=NULL WHERE id=?").bind(sent.messageId,row.id).run();
  }catch(error){const code=(error as {code?:string}).code,known=!!code&&['E_SENDER_NOT_VERIFIED','E_RECIPIENT_NOT_ALLOWED','E_RECIPIENT_SUPPRESSED','E_SENDER_DOMAIN_NOT_AVAILABLE','E_ACCOUNT_SUSPENDED','E_VALIDATION_ERROR','E_DELIVERY_FAILED'].includes(code);await env.DB.prepare('UPDATE support_events SET delivery_state=?,last_error=? WHERE id=?').bind(known?'failed':'uncertain',known?'Cloudflare ha rechazado el correo.':'No se puede confirmar si Cloudflare aceptó el correo. Revisión manual requerida.',row.id).run();}
 }
}
