import type { Env } from './env';
import { nowSeconds } from './env';

export const INACTIVITY_SECONDS = 14 * 86400;
export const ACTIVITY_WRITE_SECONDS = 3600;
// Activity writes are coalesced hourly. This grace avoids suspending anyone before
// fourteen complete days since their most recent unrecorded interaction.
export const INACTIVITY_CUTOFF = INACTIVITY_SECONDS + ACTIVITY_WRITE_SECONDS;
// Used again inside the result transaction, including after an HTTP probe has started.
export const accountEligible = (timestamp: number) => `EXISTS(SELECT 1 FROM users u WHERE u.id=monitors.user_id
  AND u.account_status='active' AND (u.is_owner=1 OR u.plan_id!='free' OR u.last_active_at>=${timestamp - INACTIVITY_CUTOFF}))`;
export const slotEligible = (slot: number) => `EXISTS(SELECT 1 FROM users u WHERE u.id=monitors.user_id AND u.monitoring_since<=${slot})`;

export async function expireInactiveAccounts(env: Env, timestamp = nowSeconds(), userId?: string) {
  return env.DB.prepare(`UPDATE users SET account_status='suspended',suspension_reason='inactivity',status_changed_at=?,review_requested_at=NULL
    WHERE account_status='active' AND plan_id='free' AND is_owner=0 AND last_active_at<?${userId ? ' AND id=?' : ''}`)
    .bind(timestamp, timestamp - INACTIVITY_CUTOFF, ...(userId ? [userId] : [])).run();
}
