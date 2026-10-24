// Test-only entry point. Production Wrangler bundles worker/index.ts directly.
import worker from '../worker/index';
import { cleanup, consume, dispatchPending, recordResult, reserveCheck, schedule } from '../worker/jobs';
import type { CheckJob, Env,QueuePayload } from '../worker/env';
import type { ProbeResult } from '../worker/probe';
import { runRetentionJob } from '../worker/retention-job';
import {measureD1} from './d1-metrics';
import {dashboardStatistics} from '../worker/statistics';
import {withDatabase,type DatabaseBindings} from '../worker/database';
import {receiveSupportEmail,dispatchSupportEmail} from '../worker/support-email';
export default {
  ...worker,
  async fetch(request: Request, bindings: DatabaseBindings, ctx: ExecutionContext) {
    return withDatabase(bindings, async env => {
    if(new URL(request.url).pathname==='/__test/support-email'){
      const {raw,to='soporte@vyrsea.com',enabled=true,size}=await request.json() as {raw:string;to?:string;enabled?:boolean;size?:number};let forwarded=0;
      const metrics=measureD1(env.DB);
      await receiveSupportEmail({to,from:'envelope@example.com',raw:new Response(raw).body!,rawSize:size??new TextEncoder().encode(raw).length,headers:new Headers(raw.split(/\r?\n\r?\n/)[0].split(/\r?\n/).map(line=>{const index=line.indexOf(':');return [line.slice(0,index),line.slice(index+1).trim()];})),forward:async()=>{forwarded++;}} as unknown as ForwardableEmailMessage,{...env,DB:metrics.DB,SUPPORT_ADDRESS:'soporte@vyrsea.com',SUPPORT_FORWARD_TO:'fixture@example.com',SUPPORT_INBOUND_ENABLED:enabled?'1':'0'});
      return Response.json({forwarded,...metrics.report()});
    }
    if(new URL(request.url).pathname==='/__test/support-dispatch'){
      const metrics=measureD1(env.DB);await dispatchSupportEmail({...env,DB:metrics.DB});return Response.json(metrics.report());
    }
    if(new URL(request.url).pathname==='/__test/statistics') {
      const {userId,ids,since,days,timestamp}=await request.json() as {userId:string;ids:string[];since:number;days:number;timestamp:number};
      const metrics=measureD1(env.DB),body=await dashboardStatistics({...env,DB:metrics.DB},userId,ids,since,days,timestamp);
      return Response.json({body,...metrics.report()});
    }
    if(new URL(request.url).pathname==='/__test/query-metrics') {
      const {path}=await request.json() as {path:string};
      if(!path.startsWith('/api/'))return new Response(null,{status:400});
      const metrics=measureD1(env.DB),response=await worker.fetch(new Request(new URL(path,env.APP_ORIGIN),{headers:request.headers}),{...env,DB:metrics.DB},ctx);
      return Response.json({status:response.status,body:await response.json(),...metrics.report()});
    }
    if (new URL(request.url).pathname === '/__test/storage-cycle') {
      const {timestamp}=await request.json() as {timestamp:number};
      const metrics=measureD1(env.DB);
      const messages:QueuePayload[]=[];
      const instrumented={...env,DB:metrics.DB,CHECK_QUEUE:{sendBatch:async(batch:MessageSendRequest<QueuePayload>[])=>{messages.push(...batch.map(item=>item.body));}} as unknown as Env['CHECK_QUEUE']};
      await schedule(instrumented,timestamp);
      for(const payload of messages)for(const job of payload.jobs)await recordResult(instrumented,job,{ok:true,statusCode:200,responseMs:20,error:null},timestamp+1);
      return Response.json({...metrics.report(),checks:messages.reduce((n,p)=>n+p.jobs.length,0)});
    }
    if (new URL(request.url).pathname === '/__test/retention-run') {
      const {start,timestamp,withSchedule}=await request.json() as {start:boolean;timestamp:number;withSchedule?:boolean};
      let queries=0;const instrumented={...env,DB:new Proxy(env.DB,{get(target,property){if(property==='prepare')return (sql:string)=>{queries++;return target.prepare(sql);};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}})};
      try{await Promise.all([runRetentionJob(instrumented,start,timestamp),...(withSchedule?[schedule(instrumented,timestamp)]:[])]);return Response.json({ok:true,queries});}
      catch{return Response.json({error:'Fixture cleanup interrupted',queries},{status:503});}
    }
    if (['/__test/cleanup', '/__test/schedule'].includes(new URL(request.url).pathname)) {
      const { timestamp } = await request.json() as { timestamp: number };
      await (new URL(request.url).pathname.endsWith('cleanup') ? cleanup : schedule)(env, timestamp);
      return Response.json({ ok: true });
    }
    if (new URL(request.url).pathname === '/__test/result') {
      const { job, result, timestamp } = await request.json() as {job:CheckJob;result:ProbeResult;timestamp?:number};
      await recordResult(env, job, result, timestamp);
      return Response.json({ ok: true });
    }
    if (new URL(request.url).pathname === '/__test/consume') {
      await consume(await request.json(),env);
      return Response.json({ok:true});
    }
    if (new URL(request.url).pathname === '/__test/reserve') {
      const { monitorId, timestamp } = await request.json() as { monitorId: string; timestamp: number };
      return Response.json({ reserved: await reserveCheck(env, monitorId, timestamp) });
    }
    if (new URL(request.url).pathname === '/__test/dispatch-failure') {
      const input = await request.json() as { monitorId: string; timestamp: number };
      await reserveCheck(env, input.monitorId, input.timestamp);
      try {
        await dispatchPending({ ...env, CHECK_QUEUE: { sendBatch: async () => { throw new Error('Simulated queue outage'); } } as unknown as Env['CHECK_QUEUE'] });
      } catch { return Response.json({ failed: true }, { status: 503 }); }
    }
    if (new URL(request.url).pathname === '/__test/dispatch-capture') {
      const messages: unknown[] = [];
      await dispatchPending({ ...env, CHECK_QUEUE: { sendBatch: async (batch: unknown[]) => { messages.push(...batch); } } as unknown as Env['CHECK_QUEUE'] });
      return Response.json({messages});
    }
    return worker.fetch(request, env, ctx);
    },ctx);
  },
};
