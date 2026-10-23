SET search_path TO vyrsea, pg_catalog;
ALTER TABLE business_contracts ADD COLUMN seat_price_cents BIGINT NOT NULL DEFAULT 1500 CHECK(seat_price_cents>=0 AND seat_price_cents<=100000000);
CREATE FUNCTION guard_team_seats() RETURNS trigger LANGUAGE plpgsql SET search_path = vyrsea, pg_catalog AS $$
DECLARE account users%ROWTYPE; occupied BIGINT;
BEGIN
 IF TG_TABLE_NAME='team_invitations' THEN
  IF NEW.claimed_at IS NOT NULL OR NEW.expires_at<=floor(extract(epoch from current_timestamp)) THEN RETURN NEW; END IF;
 END IF;
 SELECT * INTO account FROM users WHERE id=NEW.workspace_id FOR UPDATE;
 IF account.is_owner=1 THEN RETURN NEW; END IF;
 IF account.plan_id NOT IN ('pro','business') THEN RAISE EXCEPTION 'TEAM_PLAN_REQUIRED'; END IF;
 IF account.plan_id='pro' THEN
  SELECT count(*) INTO occupied FROM (SELECT user_id FROM team_members WHERE workspace_id=NEW.workspace_id AND user_id<>NEW.user_id
   UNION SELECT user_id FROM team_invitations WHERE workspace_id=NEW.workspace_id AND user_id<>NEW.user_id AND claimed_at IS NULL AND expires_at>floor(extract(epoch from current_timestamp))) seats;
  IF occupied>=2 THEN RAISE EXCEPTION 'TEAM_CAPACITY'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER team_member_capacity BEFORE INSERT OR UPDATE OF workspace_id,user_id ON team_members FOR EACH ROW EXECUTE FUNCTION guard_team_seats();
CREATE TRIGGER team_invitation_capacity BEFORE INSERT OR UPDATE ON team_invitations FOR EACH ROW EXECUTE FUNCTION guard_team_seats();
CREATE FUNCTION guard_team_plan() RETURNS trigger LANGUAGE plpgsql SET search_path = vyrsea, pg_catalog AS $$
DECLARE occupied BIGINT;
BEGIN
 IF NEW.is_owner=1 OR NEW.plan_id='business' THEN RETURN NEW; END IF;
 SELECT count(*) INTO occupied FROM (SELECT user_id FROM team_members WHERE workspace_id=NEW.id UNION SELECT user_id FROM team_invitations WHERE workspace_id=NEW.id AND claimed_at IS NULL AND expires_at>floor(extract(epoch from current_timestamp))) seats;
 IF occupied>(CASE WHEN NEW.plan_id='pro' THEN 2 ELSE 0 END) THEN RAISE EXCEPTION 'TEAM_CAPACITY'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER team_plan_capacity BEFORE UPDATE OF plan_id,is_owner ON users FOR EACH ROW EXECUTE FUNCTION guard_team_plan();
REVOKE ALL ON FUNCTION guard_team_seats(),guard_team_plan() FROM PUBLIC;
