UPDATE plan_limits SET interval_seconds=900 WHERE id='free';
UPDATE plan_limits SET interval_seconds=300 WHERE id='starter';
UPDATE monitors SET next_check_at=last_checked_at+(SELECT p.interval_seconds FROM plan_limits p JOIN users u ON u.plan_id=p.id WHERE u.id=monitors.user_id) WHERE last_checked_at IS NOT NULL AND user_id IN (SELECT id FROM users WHERE plan_id IN ('free','starter'));
