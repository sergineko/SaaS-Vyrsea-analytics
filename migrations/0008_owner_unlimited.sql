DROP TRIGGER monitor_capacity;
CREATE TRIGGER monitor_capacity BEFORE INSERT ON monitors BEGIN
 SELECT CASE WHEN NEW.root_domain IS NULL OR NEW.root_domain='' THEN RAISE(ABORT, 'DOMAIN_REQUIRED') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM monitors WHERE user_id=NEW.user_id AND url=NEW.url) THEN RAISE(ABORT, 'DUPLICATE_MONITOR') END;
 SELECT CASE WHEN (SELECT is_owner FROM users WHERE id=NEW.user_id)=0 AND
   (SELECT COUNT(*) FROM monitors m JOIN users u ON u.id=m.user_id WHERE u.is_owner=0) >= 10 THEN RAISE(ABORT, 'GLOBAL_CAPACITY') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND is_owner=0 AND plan_id='business' AND (domain_limit IS NULL OR monitor_limit IS NULL OR history_days_limit IS NULL)) THEN RAISE(ABORT, 'CUSTOM_PLAN_REQUIRED') END;
 SELECT CASE WHEN (SELECT is_owner FROM users WHERE id=NEW.user_id)=0 AND (SELECT COUNT(*) FROM monitors WHERE user_id=NEW.user_id) >=
   (SELECT CASE WHEN u.plan_id='business' THEN u.monitor_limit ELSE p.max_monitors END FROM plan_limits p JOIN users u ON u.plan_id=p.id WHERE u.id=NEW.user_id)
   THEN RAISE(ABORT, 'MONITOR_CAPACITY') END;
 SELECT CASE WHEN (SELECT is_owner FROM users WHERE id=NEW.user_id)=0 AND NOT EXISTS(SELECT 1 FROM monitors WHERE user_id=NEW.user_id AND root_domain=NEW.root_domain)
   AND (SELECT COUNT(DISTINCT COALESCE(root_domain,url)) FROM monitors WHERE user_id=NEW.user_id) >=
   (SELECT CASE WHEN u.plan_id='business' THEN u.domain_limit ELSE p.max_domains END FROM plan_limits p JOIN users u ON u.plan_id=p.id WHERE u.id=NEW.user_id)
   THEN RAISE(ABORT, 'DOMAIN_CAPACITY') END;
END;
