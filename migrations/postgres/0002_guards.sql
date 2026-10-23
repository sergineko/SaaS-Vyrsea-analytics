SET search_path TO vyrsea, pg_catalog;

CREATE FUNCTION guard_account_capacity() RETURNS trigger LANGUAGE plpgsql SET search_path = vyrsea, pg_catalog AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(75257, 1);
  IF (SELECT count(*) FROM users) >= 100 THEN RAISE EXCEPTION 'ACCOUNT_CAPACITY'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER account_capacity BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION guard_account_capacity();

CREATE FUNCTION guard_monitor() RETURNS trigger LANGUAGE plpgsql SET search_path = vyrsea, pg_catalog AS $$
DECLARE account users%ROWTYPE; plan plan_limits%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(75257, 2);
  SELECT * INTO account FROM users WHERE id=NEW.user_id;
  IF NOT FOUND OR account.account_status<>'active' OR (account.is_owner=0 AND account.plan_id='free' AND account.last_active_at<floor(extract(epoch from current_timestamp))-1213200) THEN RAISE EXCEPTION 'ACCOUNT_INACTIVE'; END IF;
  IF NEW.root_domain IS NULL OR NEW.root_domain='' THEN RAISE EXCEPTION 'DOMAIN_REQUIRED'; END IF;
  IF EXISTS(SELECT 1 FROM monitors WHERE user_id=NEW.user_id AND url=NEW.url) THEN RAISE EXCEPTION 'DUPLICATE_MONITOR'; END IF;
  IF account.is_owner=1 THEN RETURN NEW; END IF;
  IF (SELECT count(*) FROM monitors m JOIN users u ON u.id=m.user_id WHERE u.is_owner=0)>=10 THEN RAISE EXCEPTION 'GLOBAL_CAPACITY'; END IF;
  SELECT * INTO plan FROM plan_limits WHERE id=account.plan_id;
  IF account.plan_id='business' AND (account.domain_limit IS NULL OR account.monitor_limit IS NULL OR account.history_days_limit IS NULL) THEN RAISE EXCEPTION 'CUSTOM_PLAN_REQUIRED'; END IF;
  IF (SELECT count(*) FROM monitors WHERE user_id=NEW.user_id) >= (CASE WHEN account.plan_id='business' THEN account.monitor_limit ELSE plan.max_monitors END) THEN RAISE EXCEPTION 'MONITOR_CAPACITY'; END IF;
  IF NOT EXISTS(SELECT 1 FROM monitors WHERE user_id=NEW.user_id AND root_domain=NEW.root_domain)
    AND (SELECT count(DISTINCT coalesce(root_domain,url)) FROM monitors WHERE user_id=NEW.user_id) >= (CASE WHEN account.plan_id='business' THEN account.domain_limit ELSE plan.max_domains END) THEN RAISE EXCEPTION 'DOMAIN_CAPACITY'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER monitor_capacity BEFORE INSERT ON monitors FOR EACH ROW EXECUTE FUNCTION guard_monitor();

CREATE FUNCTION guard_monitor_target() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.url IS DISTINCT FROM NEW.url OR OLD.user_id IS DISTINCT FROM NEW.user_id OR (OLD.root_domain IS NOT NULL AND OLD.root_domain IS DISTINCT FROM NEW.root_domain) THEN RAISE EXCEPTION 'IMMUTABLE_MONITOR_TARGET'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER monitor_target_immutable BEFORE UPDATE OF root_domain,url,user_id ON monitors FOR EACH ROW EXECUTE FUNCTION guard_monitor_target();

CREATE FUNCTION guard_maintenance() RETURNS trigger LANGUAGE plpgsql SET search_path = vyrsea, pg_catalog AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(75258, hashtext(NEW.monitor_id));
  IF EXISTS(SELECT 1 FROM maintenance_windows w WHERE w.monitor_id=NEW.monitor_id AND w.cancelled_at IS NULL AND NEW.starts_at<w.ends_at AND NEW.ends_at>w.starts_at) THEN RAISE EXCEPTION 'MAINTENANCE_OVERLAP'; END IF;
  IF (SELECT count(*) FROM maintenance_windows w WHERE w.monitor_id=NEW.monitor_id AND w.cancelled_at IS NULL AND w.ends_at>floor(extract(epoch from current_timestamp)))>=5 THEN RAISE EXCEPTION 'MAINTENANCE_CAPACITY'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER maintenance_overlap BEFORE INSERT ON maintenance_windows FOR EACH ROW EXECUTE FUNCTION guard_maintenance();

CREATE FUNCTION guard_credential_capacity() RETURNS trigger LANGUAGE plpgsql SET search_path = vyrsea, pg_catalog AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(75259, hashtext(NEW.user_id));
  IF (SELECT count(*) FROM credentials WHERE user_id=NEW.user_id)>=5 THEN RAISE EXCEPTION 'CREDENTIAL_CAPACITY'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER credential_capacity BEFORE INSERT ON credentials FOR EACH ROW EXECUTE FUNCTION guard_credential_capacity();

CREATE FUNCTION guard_status_page_capacity() RETURNS trigger LANGUAGE plpgsql SET search_path = vyrsea, pg_catalog AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(75260, hashtext(NEW.user_id));
  IF (SELECT count(*) FROM status_pages WHERE user_id=NEW.user_id)>=5 THEN RAISE EXCEPTION 'STATUS_PAGE_CAPACITY'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER status_page_capacity BEFORE INSERT ON status_pages FOR EACH ROW EXECUTE FUNCTION guard_status_page_capacity();
RESET search_path;
