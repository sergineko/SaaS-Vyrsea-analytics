SET search_path TO vyrsea, pg_catalog;
ALTER TABLE users ADD COLUMN owner_apply_plan BIGINT NOT NULL DEFAULT 0 CHECK(owner_apply_plan IN (0,1));
CREATE OR REPLACE FUNCTION guard_monitor() RETURNS trigger LANGUAGE plpgsql SET search_path = vyrsea, pg_catalog AS $$
DECLARE account users%ROWTYPE; plan plan_limits%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(75257, 2);
  SELECT * INTO account FROM users WHERE id=NEW.user_id;
  IF NOT FOUND OR account.account_status<>'active' OR (account.is_owner=0 AND account.plan_id='free' AND account.last_active_at<floor(extract(epoch from current_timestamp))-1213200) THEN RAISE EXCEPTION 'ACCOUNT_INACTIVE'; END IF;
  IF NEW.root_domain IS NULL OR NEW.root_domain='' THEN RAISE EXCEPTION 'DOMAIN_REQUIRED'; END IF;
  IF EXISTS(SELECT 1 FROM monitors WHERE user_id=NEW.user_id AND url=NEW.url) THEN RAISE EXCEPTION 'DUPLICATE_MONITOR'; END IF;
  IF account.is_owner=1 AND account.owner_apply_plan=0 THEN RETURN NEW; END IF;
  IF account.is_owner=0 AND (SELECT count(*) FROM monitors m JOIN users u ON u.id=m.user_id WHERE u.is_owner=0)>=10 THEN RAISE EXCEPTION 'GLOBAL_CAPACITY'; END IF;
  SELECT * INTO plan FROM plan_limits WHERE id=account.plan_id;
  IF account.plan_id='business' AND (account.domain_limit IS NULL OR account.monitor_limit IS NULL OR account.history_days_limit IS NULL) THEN RAISE EXCEPTION 'CUSTOM_PLAN_REQUIRED'; END IF;
  IF (SELECT count(*) FROM monitors WHERE user_id=NEW.user_id) >= (CASE WHEN account.plan_id='business' THEN account.monitor_limit ELSE plan.max_monitors END) THEN RAISE EXCEPTION 'MONITOR_CAPACITY'; END IF;
  IF NOT EXISTS(SELECT 1 FROM monitors WHERE user_id=NEW.user_id AND root_domain=NEW.root_domain)
    AND (SELECT count(DISTINCT coalesce(root_domain,url)) FROM monitors WHERE user_id=NEW.user_id) >= (CASE WHEN account.plan_id='business' THEN account.domain_limit ELSE plan.max_domains END) THEN RAISE EXCEPTION 'DOMAIN_CAPACITY'; END IF;
  RETURN NEW;
END $$;



CREATE OR REPLACE FUNCTION guard_team_seats() RETURNS trigger LANGUAGE plpgsql SET search_path = vyrsea, pg_catalog AS $$
DECLARE account users%ROWTYPE; occupied BIGINT;
BEGIN
 IF TG_TABLE_NAME='team_invitations' THEN
  IF NEW.claimed_at IS NOT NULL OR NEW.expires_at<=floor(extract(epoch from current_timestamp)) THEN RETURN NEW; END IF;
 END IF;
 SELECT * INTO account FROM users WHERE id=NEW.workspace_id FOR UPDATE;
 IF account.is_owner=1 AND account.owner_apply_plan=0 THEN RETURN NEW; END IF;
 IF account.plan_id NOT IN ('pro','business') THEN RAISE EXCEPTION 'TEAM_PLAN_REQUIRED'; END IF;
 IF account.plan_id='pro' THEN
  SELECT count(*) INTO occupied FROM (SELECT user_id FROM team_members WHERE workspace_id=NEW.workspace_id AND user_id<>NEW.user_id
   UNION SELECT user_id FROM team_invitations WHERE workspace_id=NEW.workspace_id AND user_id<>NEW.user_id AND claimed_at IS NULL AND expires_at>floor(extract(epoch from current_timestamp))) seats;
  IF occupied>=2 THEN RAISE EXCEPTION 'TEAM_CAPACITY'; END IF;
 END IF;
 RETURN NEW;
END $$;


CREATE OR REPLACE FUNCTION guard_team_plan() RETURNS trigger LANGUAGE plpgsql SET search_path = vyrsea, pg_catalog AS $$
DECLARE occupied BIGINT;
BEGIN
 IF (NEW.is_owner=1 AND NEW.owner_apply_plan=0) OR NEW.plan_id='business' THEN RETURN NEW; END IF;
 SELECT count(*) INTO occupied FROM (SELECT user_id FROM team_members WHERE workspace_id=NEW.id UNION SELECT user_id FROM team_invitations WHERE workspace_id=NEW.id AND claimed_at IS NULL AND expires_at>floor(extract(epoch from current_timestamp))) seats;
 IF occupied>(CASE WHEN NEW.plan_id='pro' THEN 2 ELSE 0 END) THEN RAISE EXCEPTION 'TEAM_CAPACITY'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER team_plan_capacity ON users;
CREATE TRIGGER team_plan_capacity BEFORE UPDATE OF plan_id,is_owner,owner_apply_plan ON users FOR EACH ROW EXECUTE FUNCTION guard_team_plan();
REVOKE ALL ON FUNCTION guard_team_seats(),guard_team_plan() FROM PUBLIC;


CREATE TABLE platform_staff (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,created_at BIGINT NOT NULL);
CREATE TABLE support_cases (id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE SET NULL,public_ref TEXT NOT NULL UNIQUE,requester_email TEXT NOT NULL DEFAULT '',requester_name TEXT NOT NULL DEFAULT '',channel TEXT NOT NULL DEFAULT 'internal' CHECK(channel IN ('internal','portal','contact','email')),priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,source_key TEXT UNIQUE,subject TEXT NOT NULL,category TEXT NOT NULL CHECK(category IN ('access','plan','monitoring','other')),state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','waiting','resolved')),created_by TEXT REFERENCES users(id) ON DELETE SET NULL,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL,recovery_state TEXT NOT NULL DEFAULT 'none' CHECK(recovery_state IN ('none','approved','using','used','revoked')),token_hash TEXT UNIQUE,expires_at BIGINT,verified_by TEXT REFERENCES users(id) ON DELETE SET NULL,recovery_claim TEXT,used_at BIGINT);
CREATE INDEX support_cases_account ON support_cases(user_id,updated_at);
CREATE INDEX support_cases_state ON support_cases(state,updated_at);
CREATE TABLE support_events (id TEXT PRIMARY KEY,case_id TEXT NOT NULL REFERENCES support_cases(id) ON DELETE CASCADE,actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,actor_name TEXT NOT NULL,kind TEXT NOT NULL,visibility TEXT NOT NULL DEFAULT 'internal' CHECK(visibility IN ('internal','public')),message TEXT NOT NULL,message_id TEXT UNIQUE,delivery_state TEXT NOT NULL DEFAULT 'none' CHECK(delivery_state IN ('none','pending','sending','sent','failed','uncertain','disabled')),attempts BIGINT NOT NULL DEFAULT 0,retry_at BIGINT,last_error TEXT,provider_message_id TEXT,created_at BIGINT NOT NULL);
CREATE INDEX support_events_delivery ON support_events(delivery_state,retry_at);
CREATE INDEX support_events_case ON support_events(case_id,created_at);

CREATE FUNCTION guard_support_security() RETURNS trigger LANGUAGE plpgsql SET search_path = vyrsea, pg_catalog AS $$
DECLARE target_id TEXT;
BEGIN
 target_id=NEW.user_id;
 -- Serialize a global support grant and a recovery claim for the same user.
 PERFORM 1 FROM users WHERE id=target_id FOR UPDATE;
 IF TG_TABLE_NAME='platform_staff' THEN
  IF EXISTS(SELECT 1 FROM support_cases WHERE user_id=target_id AND recovery_state IN ('approved','using')) THEN RAISE EXCEPTION 'SUPPORT_RECOVERY_CONFLICT'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=target_id AND is_owner=0) OR EXISTS(SELECT 1 FROM platform_staff WHERE user_id=target_id) OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.verified_by AND is_owner=1 AND account_status='active') THEN RAISE EXCEPTION 'SUPPORT_RECOVERY_CONFLICT'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER support_grant_guard BEFORE INSERT ON platform_staff FOR EACH ROW EXECUTE FUNCTION guard_support_security();
CREATE TRIGGER support_recovery_guard BEFORE UPDATE OF recovery_state ON support_cases FOR EACH ROW WHEN (NEW.recovery_state IN ('approved','using')) EXECUTE FUNCTION guard_support_security();
REVOKE ALL ON FUNCTION guard_support_security() FROM PUBLIC;

DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='vyrsea_app') THEN GRANT SELECT,INSERT,UPDATE,DELETE ON platform_staff,support_cases,support_events TO vyrsea_app; END IF; END $$;
RESET search_path;
