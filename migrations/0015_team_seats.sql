ALTER TABLE business_contracts ADD COLUMN seat_price_cents INTEGER NOT NULL DEFAULT 1500 CHECK(seat_price_cents>=0 AND seat_price_cents<=100000000);
CREATE TRIGGER team_member_capacity BEFORE INSERT ON team_members BEGIN
 SELECT CASE WHEN (SELECT is_owner=0 AND plan_id NOT IN ('pro','business') FROM users WHERE id=NEW.workspace_id) THEN RAISE(ABORT,'TEAM_PLAN_REQUIRED') END;
 SELECT CASE WHEN (SELECT is_owner=0 AND plan_id='pro' FROM users WHERE id=NEW.workspace_id) AND
  (SELECT COUNT(*) FROM (SELECT user_id FROM team_members WHERE workspace_id=NEW.workspace_id AND user_id<>NEW.user_id UNION SELECT user_id FROM team_invitations WHERE workspace_id=NEW.workspace_id AND user_id<>NEW.user_id AND claimed_at IS NULL AND expires_at>unixepoch()))>=2 THEN RAISE(ABORT,'TEAM_CAPACITY') END;
END;
CREATE TRIGGER team_invitation_capacity BEFORE INSERT ON team_invitations BEGIN
 SELECT CASE WHEN (SELECT is_owner=0 AND plan_id NOT IN ('pro','business') FROM users WHERE id=NEW.workspace_id) THEN RAISE(ABORT,'TEAM_PLAN_REQUIRED') END;
 SELECT CASE WHEN (SELECT is_owner=0 AND plan_id='pro' FROM users WHERE id=NEW.workspace_id) AND
  (SELECT COUNT(*) FROM (SELECT user_id FROM team_members WHERE workspace_id=NEW.workspace_id AND user_id<>NEW.user_id UNION SELECT user_id FROM team_invitations WHERE workspace_id=NEW.workspace_id AND user_id<>NEW.user_id AND claimed_at IS NULL AND expires_at>unixepoch()))>=2 THEN RAISE(ABORT,'TEAM_CAPACITY') END;
END;
CREATE TRIGGER team_invitation_update_capacity BEFORE UPDATE ON team_invitations WHEN NEW.claimed_at IS NULL AND NEW.expires_at>unixepoch() BEGIN
 SELECT CASE WHEN (SELECT is_owner=0 AND plan_id NOT IN ('pro','business') FROM users WHERE id=NEW.workspace_id) THEN RAISE(ABORT,'TEAM_PLAN_REQUIRED') END;
 SELECT CASE WHEN (SELECT is_owner=0 AND plan_id='pro' FROM users WHERE id=NEW.workspace_id) AND
  (SELECT COUNT(*) FROM (SELECT user_id FROM team_members WHERE workspace_id=NEW.workspace_id AND user_id<>NEW.user_id UNION SELECT user_id FROM team_invitations WHERE workspace_id=NEW.workspace_id AND user_id<>NEW.user_id AND claimed_at IS NULL AND expires_at>unixepoch()))>=2 THEN RAISE(ABORT,'TEAM_CAPACITY') END;
END;
CREATE TRIGGER team_plan_capacity BEFORE UPDATE OF plan_id,is_owner ON users WHEN NEW.is_owner=0 AND NEW.plan_id<>'business' BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM (SELECT user_id FROM team_members WHERE workspace_id=NEW.id UNION SELECT user_id FROM team_invitations WHERE workspace_id=NEW.id AND claimed_at IS NULL AND expires_at>unixepoch()))>CASE WHEN NEW.plan_id='pro' THEN 2 ELSE 0 END THEN RAISE(ABORT,'TEAM_CAPACITY') END;
END;
