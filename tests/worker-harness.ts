// Test-only entry point. Production Wrangler bundles worker/index.ts directly.
import worker from '../worker/index';
import { cleanup, consume, dispatchPending, recordResult, reserveCheck, schedule } from '../worker/jobs';
import type { CheckJob, Env } from '../worker/env';
import type { ProbeResult } from '../worker/probe';
export default {
  ...worker,
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
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
  },
};
