export interface CheckJob { monitorId: string; slot: number }
export interface QueuePayload { jobs: CheckJob[] }
export interface Env {
  DB: import('./database').Database;
  HYPERDRIVE?: Hyperdrive;
  DATABASE_URL?: string;
  DATABASE_CA?: string;
  DATABASE_PROVIDER?: 'd1' | 'supabase';
  DATABASE_SCHEMA?: string;
  DATABASE_MIGRATION_LOCK?: string;
  CHECK_QUEUE: Queue<QueuePayload>;
  ASSETS: Fetcher;
  APP_ORIGIN: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  CLOUDFLARE_ANALYTICS_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_D1_ID?: string;
  CLOUDFLARE_QUEUE_ID?: string;
  CLOUDFLARE_SCRIPT_NAME?: string;
}
export type User = import('../shared/accounts').AccountUser;
export type AppEnv = { Bindings: Env; Variables: { user: User } };
export const MAX_MONITORS_TOTAL = 10;
// Idempotency slots use Cron's one-minute resolution; cadence comes from the account plan.
export const INTERVAL_SECONDS = 60;
export const nowSeconds = () => Math.floor(Date.now() / 1000);
