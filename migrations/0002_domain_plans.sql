CREATE TABLE plan_limits (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, max_domains INTEGER NOT NULL CHECK(max_domains>0),
 max_monitors INTEGER NOT NULL CHECK(max_monitors>0), interval_seconds INTEGER NOT NULL CHECK(interval_seconds>=300),
 available INTEGER NOT NULL DEFAULT 0
);
INSERT INTO plan_limits(id,name,max_domains,max_monitors,interval_seconds,available) VALUES
 ('free','Free',1,2,300,1), ('pro','Pro',5,15,300,0), ('agency','Agencia',20,60,300,0);
ALTER TABLE users ADD COLUMN plan_id TEXT NOT NULL DEFAULT 'free' REFERENCES plan_limits(id);
ALTER TABLE monitors ADD COLUMN root_domain TEXT;
CREATE INDEX monitors_user_domain ON monitors(user_id,root_domain);
DROP TRIGGER monitor_capacity;
CREATE TRIGGER monitor_capacity BEFORE INSERT ON monitors BEGIN
 SELECT CASE WHEN NEW.root_domain IS NULL OR NEW.root_domain='' THEN RAISE(ABORT, 'DOMAIN_REQUIRED') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM monitors WHERE user_id=NEW.user_id AND url=NEW.url) THEN RAISE(ABORT, 'DUPLICATE_MONITOR') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM monitors) >= 10 THEN RAISE(ABORT, 'GLOBAL_CAPACITY') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM monitors WHERE user_id=NEW.user_id) >=
   (SELECT p.max_monitors FROM plan_limits p JOIN users u ON u.plan_id=p.id WHERE u.id=NEW.user_id)
   THEN RAISE(ABORT, 'MONITOR_CAPACITY') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM monitors WHERE user_id=NEW.user_id AND root_domain=NEW.root_domain)
   AND (SELECT COUNT(DISTINCT COALESCE(root_domain,url)) FROM monitors WHERE user_id=NEW.user_id) >=
   (SELECT p.max_domains FROM plan_limits p JOIN users u ON u.plan_id=p.id WHERE u.id=NEW.user_id)
   THEN RAISE(ABORT, 'DOMAIN_CAPACITY') END;
END;
CREATE TRIGGER monitor_target_immutable BEFORE UPDATE OF root_domain,url,user_id ON monitors
 WHEN OLD.url!=NEW.url OR OLD.user_id!=NEW.user_id OR (OLD.root_domain IS NOT NULL AND OLD.root_domain IS NOT NEW.root_domain)
 BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_MONITOR_TARGET'); END;
