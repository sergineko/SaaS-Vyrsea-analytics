import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { bodyLimit } from 'hono/body-limit';
import { ZodError } from 'zod';
import { auth } from './auth';
import { credentialSecurity } from './credential-security';
import { api } from './api';
import type { AppEnv, Env, QueuePayload } from './env';
import { consume, schedule } from './jobs';
import { isLocal, sessionUser } from './security';
import { BILLING, PLAN_CATALOG } from '../shared/plans';
import { account, owner } from './accounts';
import { runRetentionJob } from './retention-job';
import {publicStatus} from './status-pages';
import {withDatabase, type DatabaseBindings} from './database';
import {publicAlerts,dispatchAlerts,consumeEmailEvent,type EmailEvent} from './alerts';
import {customStatusRequest} from './status-domains';

const app = new Hono<AppEnv>();
app.use('/api/*',(c,next)=>bodyLimit({maxSize:c.req.path.startsWith('/api/status-pages')?98304:16384,onError:c=>c.json({error:'Solicitud demasiado grande.'},413)})(c,next));
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
app.get('/api/health', async c => {
  const postgres=c.env.DATABASE_PROVIDER==='supabase';
  if(postgres)await c.env.DB.prepare('SELECT 1 AS ready').first();
  return c.json({ok:true,service:'vyrsea',version:'0.5.0',database:postgres?'supabase':'d1'});
});
app.get('/api/config', c => c.json({ turnstileSiteKey: c.env.TURNSTILE_SITE_KEY ?? '',
  registrationMode: 'approval', freeInactivityDays: 14,
  registrationAvailable: isLocal(c.env.APP_ORIGIN) || Boolean(c.env.TURNSTILE_SITE_KEY && c.env.TURNSTILE_SECRET_KEY) }));
app.get('/api/me', async c => c.json({ user: await sessionUser(c) }));
app.get('/api/plans', c => c.json({ plans: PLAN_CATALOG, billing: BILLING, activeProbeProviders: ['cloudflare'], multiProbeActive: false }));
app.route('/api/auth', auth);
app.route('/api/auth', credentialSecurity);
app.route('/api/account', account);
app.route('/api/owner', owner);
app.route('/api/public/status',publicStatus);
app.route('/api/public/alerts',publicAlerts);
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
  if (/CREDENTIAL_CAPACITY/.test(detail)) return c.json({ error: 'Ya tienes cinco passkeys. Puedes recuperar el acceso con un código para sustituirlas.' }, 409);
  if (/STATUS_PAGE_CAPACITY/.test(detail)) return c.json({error:'La beta permite cinco páginas de estado por cuenta.'},409);
  if (/TEAM_CAPACITY/.test(detail)) return c.json({error:'El equipo y las invitaciones superan el límite del plan: Pro / Agencia admite 3 usuarios; Free y Starter, 1. El titular cuenta. Retira un acceso o cancela una invitación antes de continuar.'},409);
  if (/TEAM_PLAN_REQUIRED/.test(detail)) return c.json({error:'Retira los miembros y cancela las invitaciones antes de cambiar a un plan sin equipo.'},409);
  if (/GLOBAL_CAPACITY/.test(detail)) return c.json({ error: 'La beta ha alcanzado sus 10 monitores de clientes compartidos. Este límite técnico se aplica además de las cuotas de cada plan.' }, 409);
  if (/CUSTOM_PLAN_REQUIRED/.test(detail)) return c.json({ error: 'El plan Business necesita cuotas personalizadas configuradas por contrato.' }, 409);
  if (/MAINTENANCE_OVERLAP/.test(detail)) return c.json({ error: 'Este horario coincide con otro mantenimiento del monitor.' }, 409);
  if (/MAINTENANCE_CAPACITY/.test(detail)) return c.json({ error: 'Puedes tener hasta cinco mantenimientos activos o programados por monitor.' }, 409);
  if (/ACCOUNT_CAPACITY|UNIQUE constraint failed: users.username/.test(detail) || ((error as {code?:string;constraint_name?:string}).code==='23505' && (error as {constraint_name?:string}).constraint_name==='users_username_key')) return c.json({ error: 'No se puede crear la cuenta: el nombre está ocupado o la instalación ha alcanzado su capacidad.' }, 409);
  if (error instanceof SyntaxError) return c.json({ error: 'El formato de la solicitud no es válido.' }, 400);
  // Never log credentials, sessions, passkey responses, or full target URLs.
  console.error(JSON.stringify({ event: 'request_failed', path: new URL(c.req.url).pathname, type: error.name, sqlState:(error as {code?:string}).code }));
  return c.json({ error: 'No se pudo completar la operación. Vuelve a intentarlo.' }, 500);
});

export default {
  async fetch(request: Request, bindings: DatabaseBindings, ctx: ExecutionContext) {
    if (bindings.DATABASE_MIGRATION_LOCK === '1' && new URL(request.url).pathname.startsWith('/api/') && !['/api/health','/api/config','/api/plans'].includes(new URL(request.url).pathname)) return Response.json({error:'Estamos migrando la base de datos. Vuelve a intentarlo en unos minutos.'},{status:503,headers:{'Retry-After':'60','Cache-Control':'no-store'}});
    return withDatabase(bindings, async env => {const custom=await customStatusRequest(request,env);return custom instanceof Response?custom:app.fetch(custom??request,env,ctx);}, ctx);
  },
  async scheduled(controller: ScheduledController, bindings: DatabaseBindings, ctx: ExecutionContext) {
    if (bindings.DATABASE_MIGRATION_LOCK === '1') return;
    return withDatabase(bindings, async env => {
    const time = new Date(controller.scheduledTime);
    // One Cron binding for the entire MVP; the account's Free limit is shared.
    const daily = time.getUTCHours() === 3 && time.getUTCMinutes() === 17;
    // Reuse the minute trigger; unfinished bounded deletes continue every 15 min.
    const continuation=(time.getUTCMinutes()+13)%15===0;
    await (controller.cron === '17 3 * * *' ? runRetentionJob(env,true) : Promise.all([schedule(env),dispatchAlerts(env), ...(daily||continuation ? [runRetentionJob(env,daily)] : [])]));
    }, ctx);
  },
  async queue(batch: MessageBatch<QueuePayload|EmailEvent>, bindings: DatabaseBindings, ctx: ExecutionContext) {
    if (bindings.DATABASE_MIGRATION_LOCK === '1') { batch.retryAll({delaySeconds:60}); return; }
    return withDatabase(bindings, async env => {
    for (const message of batch.messages) {
      try { if('type' in message.body)await consumeEmailEvent(env,message.body);else await consume(message.body, env); message.ack(); }
      catch { console.error(JSON.stringify({ event: 'queue_retry', attempts: message.attempts })); message.retry({ delaySeconds: 60 }); }
    }
    }, ctx);
  },
} satisfies ExportedHandler<DatabaseBindings, QueuePayload|EmailEvent>;
