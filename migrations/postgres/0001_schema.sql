-- PostgreSQL schema for the existing Vyrsea data. No Supabase Auth migration.
CREATE SCHEMA IF NOT EXISTS vyrsea;
REVOKE ALL ON SCHEMA vyrsea FROM PUBLIC;
SET search_path TO vyrsea, pg_catalog;

CREATE TABLE "plan_limits" (
 id TEXT PRIMARY KEY, name TEXT NOT NULL,
 max_domains BIGINT CHECK(max_domains>0), max_monitors BIGINT CHECK(max_monitors>0),
 interval_seconds BIGINT NOT NULL CHECK(interval_seconds>=60),
 history_days BIGINT CHECK(history_days>0 AND history_days<=365),
 available BIGINT NOT NULL DEFAULT 0,
 CHECK(id='business' OR (max_domains IS NOT NULL AND max_monitors IS NOT NULL AND history_days IS NOT NULL))
);
CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, created_at BIGINT NOT NULL, plan_id TEXT NOT NULL DEFAULT 'free' REFERENCES plan_limits(id), domain_limit BIGINT CHECK(domain_limit>0), monitor_limit BIGINT CHECK(monitor_limit>0), history_days_limit BIGINT CHECK(history_days_limit>0 AND history_days_limit<=365), account_status TEXT NOT NULL DEFAULT 'pending' CHECK(account_status IN ('pending','active','suspended')), is_owner BIGINT NOT NULL DEFAULT 0 CHECK(is_owner IN (0,1)), last_active_at BIGINT NOT NULL DEFAULT 0, status_changed_at BIGINT NOT NULL DEFAULT 0, suspension_reason TEXT CHECK(suspension_reason IN ('inactivity','owner')), review_requested_at BIGINT, monitoring_since BIGINT NOT NULL DEFAULT 0);
CREATE TABLE credentials (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, public_key TEXT NOT NULL, counter BIGINT NOT NULL DEFAULT 0, transports TEXT NOT NULL, label TEXT NOT NULL DEFAULT 'Passkey', created_at BIGINT NOT NULL DEFAULT 0);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at BIGINT NOT NULL);
CREATE TABLE challenges (id TEXT PRIMARY KEY, kind TEXT NOT NULL, challenge TEXT NOT NULL, user_id TEXT, username TEXT, expires_at BIGINT NOT NULL, context TEXT);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count BIGINT NOT NULL DEFAULT 1, expires_at BIGINT NOT NULL);
CREATE TABLE monitors (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL, url TEXT NOT NULL, paused BIGINT NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','up','degraded','down')),
 failures BIGINT NOT NULL DEFAULT 0, last_checked_at BIGINT, last_status_code BIGINT,
 last_response_ms DOUBLE PRECISION, last_error TEXT, next_check_at BIGINT NOT NULL,
 last_slot BIGINT NOT NULL DEFAULT 0, created_at BIGINT NOT NULL
, root_domain TEXT, probe_mask BIGINT NOT NULL DEFAULT 7 CHECK(probe_mask BETWEEN 1 AND 7));
CREATE TABLE "checks" (
 id TEXT PRIMARY KEY, monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
 checked_at BIGINT NOT NULL, ok BIGINT NOT NULL, status_code BIGINT, response_ms DOUBLE PRECISION NOT NULL, error TEXT
);
CREATE TABLE "hourly_stats" (
 monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE, hour BIGINT NOT NULL,
 total BIGINT NOT NULL, successful BIGINT NOT NULL, total_ms DOUBLE PRECISION NOT NULL,
 PRIMARY KEY(monitor_id,hour)
);
CREATE TABLE incidents (
 id TEXT PRIMARY KEY, monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
 opened_at BIGINT NOT NULL, resolved_at BIGINT, reason TEXT NOT NULL
);
CREATE TABLE notifications (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
 kind TEXT NOT NULL, message TEXT NOT NULL, created_at BIGINT NOT NULL, read_at BIGINT
);
CREATE TABLE "check_jobs" (
 id TEXT PRIMARY KEY, monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
 slot BIGINT NOT NULL, created_at BIGINT NOT NULL, dispatched_at BIGINT
);
CREATE TABLE maintenance_windows (
 id TEXT PRIMARY KEY,
 monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
 starts_at BIGINT NOT NULL, ends_at BIGINT NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 140),
 created_at BIGINT NOT NULL, cancelled_at BIGINT,
 CHECK(ends_at-starts_at BETWEEN 300 AND 86400)
);
CREATE TABLE recent_auth (
 session_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at BIGINT NOT NULL
);
CREATE TABLE recovery_codes (
 code_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at BIGINT NOT NULL
);
CREATE TABLE maintenance_jobs (
 id TEXT PRIMARY KEY, run_day TEXT NOT NULL, started_at BIGINT NOT NULL,
 updated_at BIGINT NOT NULL, completed_at BIGINT, pending BIGINT NOT NULL DEFAULT 1,
 deleted_json TEXT NOT NULL DEFAULT '{}',lease_until BIGINT NOT NULL DEFAULT 0,lease_token TEXT
);
CREATE TABLE status_pages (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', accent TEXT NOT NULL DEFAULT '#187356',
 theme TEXT NOT NULL DEFAULT 'light', monitor_ids TEXT NOT NULL DEFAULT '[]', published BIGINT NOT NULL DEFAULT 0,
 created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE TABLE business_contracts (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 company TEXT NOT NULL DEFAULT '', contact_email TEXT NOT NULL DEFAULT '',
 price_cents BIGINT NOT NULL DEFAULT 0, billing_cycle TEXT NOT NULL DEFAULT 'monthly',
 notes TEXT NOT NULL DEFAULT '', updated_at BIGINT NOT NULL
);
CREATE TABLE account_invitations (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE, expires_at BIGINT NOT NULL, claimed_at BIGINT
);
CREATE INDEX challenges_expiry ON challenges(expires_at);
CREATE INDEX checks_monitor_time ON checks(monitor_id,checked_at);
CREATE INDEX credentials_user ON credentials(user_id);
CREATE INDEX incidents_monitor_resolved ON incidents(monitor_id, resolved_at);
CREATE UNIQUE INDEX incidents_open ON incidents(monitor_id) WHERE resolved_at IS NULL;
CREATE INDEX incidents_time ON incidents(opened_at);
CREATE INDEX jobs_dispatch ON check_jobs(created_at);
CREATE INDEX maintenance_end ON maintenance_windows(ends_at);
CREATE INDEX maintenance_monitor_time ON maintenance_windows(monitor_id,starts_at,ends_at);
CREATE INDEX monitors_due ON monitors(paused, next_check_at);
CREATE INDEX monitors_user ON monitors(user_id);
CREATE INDEX monitors_user_domain ON monitors(user_id,root_domain);
CREATE INDEX notifications_user_time ON notifications(user_id, created_at);
CREATE INDEX rate_limits_expiry ON rate_limits(expires_at);
CREATE INDEX recent_auth_expiry ON recent_auth(expires_at);
CREATE INDEX recovery_codes_user ON recovery_codes(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX status_pages_user ON status_pages(user_id);
CREATE INDEX users_inactivity ON users(account_status,plan_id,is_owner,last_active_at);
INSERT INTO plan_limits(id,name,max_domains,max_monitors,interval_seconds,history_days,available) VALUES ('free','Free',1,2,900,7,1),('starter','Starter',5,15,300,30,0),('pro','Pro / Agencia',20,100,60,90,0),('business','Business',NULL,NULL,60,NULL,0) ON CONFLICT(id) DO NOTHING;
RESET search_path;
