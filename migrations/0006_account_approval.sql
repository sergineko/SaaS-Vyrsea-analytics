ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'pending' CHECK(account_status IN ('pending','active','suspended'));
ALTER TABLE users ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0 CHECK(is_owner IN (0,1));
ALTER TABLE users ADD COLUMN last_active_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN status_changed_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN suspension_reason TEXT CHECK(suspension_reason IN ('inactivity','owner'));
ALTER TABLE users ADD COLUMN review_requested_at INTEGER;
ALTER TABLE users ADD COLUMN monitoring_since INTEGER NOT NULL DEFAULT 0;
UPDATE users SET account_status='active',last_active_at=unixepoch(),status_changed_at=unixepoch();
CREATE INDEX users_inactivity ON users(account_status,plan_id,is_owner,last_active_at);
CREATE TRIGGER monitor_account_access BEFORE INSERT ON monitors BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND account_status='active'
  AND (is_owner=1 OR plan_id!='free' OR last_active_at>=unixepoch()-1213200)) THEN RAISE(ABORT,'ACCOUNT_INACTIVE') END;
END;
