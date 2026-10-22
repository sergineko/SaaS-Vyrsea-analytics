export function retentionCandidatesSQL(table: 'checks' | 'hourly_stats' | 'incidents', field: 'checked_at' | 'hour' | 'resolved_at', limit: number) {
  // Start with the small monitor catalogue, then seek each monitor/time range.
  // CROSS JOIN keeps SQLite from starting with a scan of the entire history.
  return `SELECT x.rowid FROM monitors m JOIN users u ON u.id=m.user_id
    JOIN plan_limits p ON p.id=u.plan_id CROSS JOIN ${table} x
    WHERE x.monitor_id=m.id AND x.${field} < ? -
    (CASE WHEN u.plan_id='business' THEN u.history_days_limit ELSE p.history_days END) * 86400 LIMIT ${limit}`;
}
