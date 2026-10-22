export interface CheckJob { monitorId: string; slot: number }
export interface QueuePayload { jobs: CheckJob[] }
export interface Env {
  DB: D1Database;
  CHECK_QUEUE: Queue<QueuePayload>;
  ASSETS: Fetcher;
  APP_ORIGIN: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}
export type User = import('../shared/accounts').AccountUser;
export type AppEnv = { Bindings: Env; Variables: { user: User } };
export const MAX_MONITORS_TOTAL = 10;
// Idempotency slots use Cron's one-minute resolution; cadence comes from the account plan.
export const INTERVAL_SECONDS = 60;
export const nowSeconds = () => Math.floor(Date.now() / 1000);
