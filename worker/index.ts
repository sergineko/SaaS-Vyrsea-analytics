import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { bodyLimit } from 'hono/body-limit';
import { ZodError } from 'zod';
import { auth } from './auth';
import { api } from './api';
import type { AppEnv, Env, QueuePayload } from './env';
import { cleanup, consume, schedule } from './jobs';
import { isLocal, sessionUser } from './security';
import { BILLING, PLAN_CATALOG } from '../shared/plans';
import { account, owner } from './accounts';

const app = new Hono<AppEnv>();
app.use('/api/*', bodyLimit({ maxSize: 16384, onError: c => c.json({ error: 'Solicitud demasiado grande.' }, 413) }));
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-Robots-Tag', 'noindex, nofollow');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    if (c.req.header('Origin') !== c.env.APP_ORIGIN || !c.req.header('Content-Type')?.startsWith('application/json')) {
      throw new HTTPException(403, { message: 'El origen de la solicitud no está autorizado.' });
    }
  }
  await next();
});
app.get('/api/health', c => c.json({ ok: true, service: 'vyrsea', version: '0.2.0' }));
app.get('/api/config', c => c.json({ turnstileSiteKey: c.env.TURNSTILE_SITE_KEY ?? '',
  registrationMode: 'approval', freeInactivityDays: 14,
  registrationAvailable: isLocal(c.env.APP_ORIGIN) || Boolean(c.env.TURNSTILE_SITE_KEY && c.env.TURNSTILE_SECRET_KEY) }));
app.get('/api/me', async c => c.json({ user: await sessionUser(c) }));
app.get('/api/plans', c => c.json({ plans: PLAN_CATALOG, billing: BILLING, activeProbeProviders: ['cloudflare'], multiProbeActive: false }));
app.route('/api/auth', auth);
app.route('/api/account', account);
app.route('/api/owner', owner);
app.route('/api', api);
app.notFound(c => c.req.path === '/api' || c.req.path.startsWith('/api/')
  ? c.json({ error: 'Ruta no encontrada.' }, 404)
  : c.env.ASSETS.fetch(c.req.raw));
app.onError((error, c) => {
  if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
  if (error instanceof ZodError) return c.json({ error: error.issues[0]?.message ?? 'Revisa los campos.' }, 400);
  const detail = error.message + ' ' + error.cause;
  if (/ACCOUNT_INACTIVE/.test(detail)) return c.json({ code: 'ACCOUNT_SUSPENDED', error: 'La cuenta necesita aprobación antes de crear monitores.' }, 403);
  if (/DOMAIN_CAPACITY/.test(detail)) return c.json({ error: 'Has alcanzado el límite de dominios de tu plan. En Free los dos monitores deben pertenecer al mismo dominio principal.' }, 409);
  if (/MONITOR_CAPACITY/.test(detail)) return c.json({ error: 'Has alcanzado el límite de monitores de tu plan. Free incluye 1 dominio y 2 monitores en total; los pausados también cuentan.' }, 409);
  if (/DUPLICATE_MONITOR/.test(detail)) return c.json({ error: 'Ya tienes un monitor para esta URL.' }, 409);
  if (/GLOBAL_CAPACITY/.test(detail)) return c.json({ error: 'La instalación de pruebas ha alcanzado sus 10 monitores. Este es un límite técnico global, independiente de tu plan.' }, 409);
  if (/CUSTOM_PLAN_REQUIRED/.test(detail)) return c.json({ error: 'El plan Business necesita cuotas personalizadas configuradas por contrato.' }, 409);
  if (/MAINTENANCE_OVERLAP/.test(detail)) return c.json({ error: 'Este horario coincide con otro mantenimiento del monitor.' }, 409);
  if (/MAINTENANCE_CAPACITY/.test(detail)) return c.json({ error: 'Puedes tener hasta cinco mantenimientos activos o programados por monitor.' }, 409);
  if (/ACCOUNT_CAPACITY|UNIQUE constraint failed: users.username/.test(detail)) return c.json({ error: 'No se puede crear la cuenta: el nombre está ocupado o la instalación ha alcanzado su capacidad.' }, 409);
  if (error instanceof SyntaxError) return c.json({ error: 'El formato de la solicitud no es válido.' }, 400);
  // Never log credentials, sessions, passkey responses, or full target URLs.
  console.error(JSON.stringify({ event: 'request_failed', path: new URL(c.req.url).pathname, type: error.name }));
  return c.json({ error: 'No se pudo completar la operación. Vuelve a intentarlo.' }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const time = new Date(controller.scheduledTime);
    // One Cron binding for the entire MVP; the account's Free limit is shared.
    const daily = time.getUTCHours() === 3 && time.getUTCMinutes() === 17;
    ctx.waitUntil(controller.cron === '17 3 * * *' ? cleanup(env) : Promise.all([schedule(env), ...(daily ? [cleanup(env)] : [])]));
  },
  async queue(batch: MessageBatch<QueuePayload>, env: Env) {
    for (const message of batch.messages) {
      try { await consume(message.body, env); message.ack(); }
      catch { console.error(JSON.stringify({ event: 'queue_retry', attempts: message.attempts })); message.retry({ delaySeconds: 60 }); }
    }
  },
} satisfies ExportedHandler<Env, QueuePayload>;
