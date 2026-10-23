import worker from '../worker/index';
import type {Env} from '../worker/env';
import {dispatchAlerts,consumeEmailEvent} from '../worker/alerts';
let mode='ok',sent:unknown[]=[];
export default {async fetch(request:Request,env:Env,ctx:ExecutionContext){
 const wired:Env={...env,EMAIL:{send:async message=>{
   if(mode==='rate'){const error=new Error('rate');Object.assign(error,{code:'E_RATE_LIMIT_EXCEEDED'});throw error;}
   if(mode==='uncertain')throw new Error('Simulated transport interruption');
   sent.push(message);const messageId='fake-'+crypto.randomUUID();
   if(mode==='bounce-first')await consumeEmailEvent(wired,{type:'cf.email.sending.message.bounced',source:{type:'email.sending',zoneId:env.CLOUDFLARE_EMAIL_ZONE_ID,domain:'notify.example.org'},payload:{messageId,recipient:message.to,terminal:true,delivery:{status:'bounced'}}});
   return {messageId};
 }}};
 const path=new URL(request.url).pathname;
 if(path==='/__test/dispatch-alerts'){const body=await request.json() as {timestamp?:number;mode?:string};mode=body.mode??'ok';sent=[];await dispatchAlerts(wired,body.timestamp);return Response.json({sent});}
 if(path==='/__test/email-event'){try{await consumeEmailEvent(wired,await request.json());return Response.json({ok:true});}catch{return Response.json({error:'Invalid source'},{status:400});}}
 return worker.fetch(request,wired,ctx);
}};
