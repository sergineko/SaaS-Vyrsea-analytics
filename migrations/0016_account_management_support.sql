ALTER TABLE users ADD COLUMN owner_apply_plan INTEGER NOT NULL DEFAULT 0 CHECK(owner_apply_plan IN (0,1));
DROP TRIGGER monitor_capacity;
CREATE TRIGGER monitor_capacity BEFORE INSERT ON monitors BEGIN
 SELECT CASE WHEN NEW.root_domain IS NULL OR NEW.root_domain='' THEN RAISE(ABORT, 'DOMAIN_REQUIRED') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM monitors WHERE user_id=NEW.user_id AND url=NEW.url) THEN RAISE(ABORT, 'DUPLICATE_MONITOR') END;
 SELECT CASE WHEN (SELECT is_owner FROM users WHERE id=NEW.user_id)=0 AND
   (SELECT COUNT(*) FROM monitors m JOIN users u ON u.id=m.user_id WHERE u.is_owner=0) >= 10 THEN RAISE(ABORT, 'GLOBAL_CAPACITY') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND (is_owner=0 OR owner_apply_plan=1) AND plan_id='business' AND (domain_limit IS NULL OR monitor_limit IS NULL OR history_days_limit IS NULL)) THEN RAISE(ABORT, 'CUSTOM_PLAN_REQUIRED') END;
 SELECT CASE WHEN (SELECT is_owner=0 OR owner_apply_plan=1 FROM users WHERE id=NEW.user_id) AND (SELECT COUNT(*) FROM monitors WHERE user_id=NEW.user_id) >=
   (SELECT CASE WHEN u.plan_id='business' THEN u.monitor_limit ELSE p.max_monitors END FROM plan_limits p JOIN users u ON u.plan_id=p.id WHERE u.id=NEW.user_id)
   THEN RAISE(ABORT, 'MONITOR_CAPACITY') END;
 SELECT CASE WHEN (SELECT is_owner=0 OR owner_apply_plan=1 FROM users WHERE id=NEW.user_id) AND NOT EXISTS(SELECT 1 FROM monitors WHERE user_id=NEW.user_id AND root_domain=NEW.root_domain)
   AND (SELECT COUNT(DISTINCT COALESCE(root_domain,url)) FROM monitors WHERE user_id=NEW.user_id) >=
   (SELECT CASE WHEN u.plan_id='business' THEN u.domain_limit ELSE p.max_domains END FROM plan_limits p JOIN users u ON u.plan_id=p.id WHERE u.id=NEW.user_id)
   THEN RAISE(ABORT, 'DOMAIN_CAPACITY') END;
END;

DROP TRIGGER team_member_capacity;
DROP TRIGGER team_invitation_capacity;
DROP TRIGGER team_invitation_update_capacity;
DROP TRIGGER team_plan_capacity;
CREATE TRIGGER team_member_capacity BEFORE INSERT ON team_members BEGIN
 SELECT CASE WHEN (SELECT (is_owner=0 OR owner_apply_plan=1) AND plan_id NOT IN ('pro','business') FROM users WHERE id=NEW.workspace_id) THEN RAISE(ABORT,'TEAM_PLAN_REQUIRED') END;
 SELECT CASE WHEN (SELECT (is_owner=0 OR owner_apply_plan=1) AND plan_id='pro' FROM users WHERE id=NEW.workspace_id) AND
  (SELECT COUNT(*) FROM (SELECT user_id FROM team_members WHERE workspace_id=NEW.workspace_id AND user_id<>NEW.user_id UNION SELECT user_id FROM team_invitations WHERE workspace_id=NEW.workspace_id AND user_id<>NEW.user_id AND claimed_at IS NULL AND expires_at>unixepoch()))>=2 THEN RAISE(ABORT,'TEAM_CAPACITY') END;
END;
CREATE TRIGGER team_invitation_capacity BEFORE INSERT ON team_invitations BEGIN
 SELECT CASE WHEN (SELECT (is_owner=0 OR owner_apply_plan=1) AND plan_id NOT IN ('pro','business') FROM users WHERE id=NEW.workspace_id) THEN RAISE(ABORT,'TEAM_PLAN_REQUIRED') END;
 SELECT CASE WHEN (SELECT (is_owner=0 OR owner_apply_plan=1) AND plan_id='pro' FROM users WHERE id=NEW.workspace_id) AND
  (SELECT COUNT(*) FROM (SELECT user_id FROM team_members WHERE workspace_id=NEW.workspace_id AND user_id<>NEW.user_id UNION SELECT user_id FROM team_invitations WHERE workspace_id=NEW.workspace_id AND user_id<>NEW.user_id AND claimed_at IS NULL AND expires_at>unixepoch()))>=2 THEN RAISE(ABORT,'TEAM_CAPACITY') END;
END;
CREATE TRIGGER team_invitation_update_capacity BEFORE UPDATE ON team_invitations WHEN NEW.claimed_at IS NULL AND NEW.expires_at>unixepoch() BEGIN
 SELECT CASE WHEN (SELECT (is_owner=0 OR owner_apply_plan=1) AND plan_id NOT IN ('pro','business') FROM users WHERE id=NEW.workspace_id) THEN RAISE(ABORT,'TEAM_PLAN_REQUIRED') END;
 SELECT CASE WHEN (SELECT (is_owner=0 OR owner_apply_plan=1) AND plan_id='pro' FROM users WHERE id=NEW.workspace_id) AND
  (SELECT COUNT(*) FROM (SELECT user_id FROM team_members WHERE workspace_id=NEW.workspace_id AND user_id<>NEW.user_id UNION SELECT user_id FROM team_invitations WHERE workspace_id=NEW.workspace_id AND user_id<>NEW.user_id AND claimed_at IS NULL AND expires_at>unixepoch()))>=2 THEN RAISE(ABORT,'TEAM_CAPACITY') END;
END;
CREATE TRIGGER team_plan_capacity BEFORE UPDATE OF plan_id,is_owner,owner_apply_plan ON users WHEN (NEW.is_owner=0 OR NEW.owner_apply_plan=1) AND NEW.plan_id<>'business' BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM (SELECT user_id FROM team_members WHERE workspace_id=NEW.id UNION SELECT user_id FROM team_invitations WHERE workspace_id=NEW.id AND claimed_at IS NULL AND expires_at>unixepoch()))>CASE WHEN NEW.plan_id='pro' THEN 2 ELSE 0 END THEN RAISE(ABORT,'TEAM_CAPACITY') END;
END;


CREATE TABLE platform_staff (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,created_at INTEGER NOT NULL);
CREATE TABLE support_cases (id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE SET NULL,public_ref TEXT NOT NULL UNIQUE,requester_email TEXT NOT NULL DEFAULT '',requester_name TEXT NOT NULL DEFAULT '',channel TEXT NOT NULL DEFAULT 'internal' CHECK(channel IN ('internal','portal','contact','email')),priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,source_key TEXT UNIQUE,subject TEXT NOT NULL,category TEXT NOT NULL CHECK(category IN ('access','plan','monitoring','other')),state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','waiting','resolved')),created_by TEXT REFERENCES users(id) ON DELETE SET NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,recovery_state TEXT NOT NULL DEFAULT 'none' CHECK(recovery_state IN ('none','approved','using','used','revoked')),token_hash TEXT UNIQUE,expires_at INTEGER,verified_by TEXT REFERENCES users(id) ON DELETE SET NULL,recovery_claim TEXT,used_at INTEGER);
CREATE INDEX support_cases_account ON support_cases(user_id,updated_at);
CREATE INDEX support_cases_state ON support_cases(state,updated_at);
CREATE TABLE support_events (id TEXT PRIMARY KEY,case_id TEXT NOT NULL REFERENCES support_cases(id) ON DELETE CASCADE,actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,actor_name TEXT NOT NULL,kind TEXT NOT NULL,visibility TEXT NOT NULL DEFAULT 'internal' CHECK(visibility IN ('internal','public')),message TEXT NOT NULL,message_id TEXT UNIQUE,delivery_state TEXT NOT NULL DEFAULT 'none' CHECK(delivery_state IN ('none','pending','sending','sent','failed','uncertain','disabled')),attempts INTEGER NOT NULL DEFAULT 0,retry_at INTEGER,last_error TEXT,provider_message_id TEXT,created_at INTEGER NOT NULL);
CREATE INDEX support_events_delivery ON support_events(delivery_state,retry_at);
CREATE INDEX support_events_case ON support_events(case_id,created_at);

CREATE TRIGGER support_grant_guard BEFORE INSERT ON platform_staff BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM support_cases WHERE user_id=NEW.user_id AND recovery_state IN ('approved','using')) THEN RAISE(ABORT,'SUPPORT_RECOVERY_CONFLICT') END;
END;
CREATE TRIGGER support_recovery_guard BEFORE UPDATE OF recovery_state ON support_cases WHEN NEW.recovery_state IN ('approved','using') BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND is_owner=0) OR EXISTS(SELECT 1 FROM platform_staff WHERE user_id=NEW.user_id) OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.verified_by AND is_owner=1 AND account_status='active') THEN RAISE(ABORT,'SUPPORT_RECOVERY_CONFLICT') END;
END;
