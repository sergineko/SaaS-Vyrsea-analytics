PRAGMA defer_foreign_keys = ON;
DROP TRIGGER monitor_capacity;
CREATE TABLE plan_limits_v3 (
 id TEXT PRIMARY KEY, name TEXT NOT NULL,
 max_domains INTEGER CHECK(max_domains>0), max_monitors INTEGER CHECK(max_monitors>0),
 interval_seconds INTEGER NOT NULL CHECK(interval_seconds>=60),
 history_days INTEGER CHECK(history_days>0 AND history_days<=365),
 available INTEGER NOT NULL DEFAULT 0,
 CHECK(id='business' OR (max_domains IS NOT NULL AND max_monitors IS NOT NULL AND history_days IS NOT NULL))
);
INSERT INTO plan_limits_v3(id,name,max_domains,max_monitors,interval_seconds,history_days,available) VALUES
 ('free','Free',1,2,1800,7,1), ('starter','Starter',5,15,600,30,0),
 ('pro','Pro / Agencia',20,100,60,90,0), ('business','Business',NULL,NULL,60,NULL,0);
UPDATE users SET plan_id=CASE plan_id WHEN 'pro' THEN 'starter' WHEN 'agency' THEN 'pro' ELSE plan_id END;
DROP TABLE plan_limits;
ALTER TABLE plan_limits_v3 RENAME TO plan_limits;
ALTER TABLE users ADD COLUMN domain_limit INTEGER CHECK(domain_limit>0);
ALTER TABLE users ADD COLUMN monitor_limit INTEGER CHECK(monitor_limit>0);
ALTER TABLE users ADD COLUMN history_days_limit INTEGER CHECK(history_days_limit>0 AND history_days_limit<=365);
CREATE TRIGGER monitor_capacity BEFORE INSERT ON monitors BEGIN
 SELECT CASE WHEN NEW.root_domain IS NULL OR NEW.root_domain='' THEN RAISE(ABORT, 'DOMAIN_REQUIRED') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM monitors WHERE user_id=NEW.user_id AND url=NEW.url) THEN RAISE(ABORT, 'DUPLICATE_MONITOR') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM monitors) >= 10 THEN RAISE(ABORT, 'GLOBAL_CAPACITY') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND plan_id='business' AND (domain_limit IS NULL OR monitor_limit IS NULL OR history_days_limit IS NULL)) THEN RAISE(ABORT, 'CUSTOM_PLAN_REQUIRED') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM monitors WHERE user_id=NEW.user_id) >=
   (SELECT CASE WHEN u.plan_id='business' THEN u.monitor_limit ELSE p.max_monitors END FROM plan_limits p JOIN users u ON u.plan_id=p.id WHERE u.id=NEW.user_id)
   THEN RAISE(ABORT, 'MONITOR_CAPACITY') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM monitors WHERE user_id=NEW.user_id AND root_domain=NEW.root_domain)
   AND (SELECT COUNT(DISTINCT COALESCE(root_domain,url)) FROM monitors WHERE user_id=NEW.user_id) >=
   (SELECT CASE WHEN u.plan_id='business' THEN u.domain_limit ELSE p.max_domains END FROM plan_limits p JOIN users u ON u.plan_id=p.id WHERE u.id=NEW.user_id)
   THEN RAISE(ABORT, 'DOMAIN_CAPACITY') END;
END;
UPDATE monitors SET next_check_at=last_checked_at+(SELECT p.interval_seconds FROM plan_limits p JOIN users u ON u.plan_id=p.id WHERE u.id=monitors.user_id) WHERE last_checked_at IS NOT NULL;
PRAGMA defer_foreign_keys = OFF;
