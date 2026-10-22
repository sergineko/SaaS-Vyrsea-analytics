import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { retentionCandidatesSQL } from '../worker/retention.ts';

// Synthetic, in-memory SQLite only. Never opens production or local user data.
const db = new DatabaseSync(':memory:'), timestamp = Math.floor(Date.now() / 1000);
for (const file of readdirSync('migrations').filter(file => file.endsWith('.sql') && file < '0007').sort()) db.exec(readFileSync(`migrations/${file}`, 'utf8'));
db.prepare(`INSERT INTO users(id,username,created_at,plan_id,account_status,domain_limit,monitor_limit,history_days_limit)
  VALUES('bench','bench',?,'business','active',10,10,90)`).run(timestamp);
for (let i = 0; i < 10; i++) db.prepare(`INSERT INTO monitors(id,user_id,name,url,root_domain,next_check_at,created_at)
  VALUES(?,'bench',?,?,'example.com',0,?)`).run(`m${i}`, `m${i}`, `https://m${i}.example.com/`, timestamp);
db.prepare(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<100000)
  INSERT INTO checks(id,monitor_id,checked_at,ok,status_code,response_ms)
  SELECT 'sample-'||n,'m'||((n-1)%10),?-CAST((n-1)/10 AS INTEGER)*60,1,200,20 FROM seq`).run(timestamp);
const oldSQL = `SELECT x.rowid FROM checks x JOIN monitors m ON m.id=x.monitor_id
  JOIN users u ON u.id=m.user_id JOIN plan_limits p ON p.id=u.plan_id
  WHERE x.checked_at < ? - (CASE WHEN u.plan_id='business' THEN u.history_days_limit ELSE p.history_days END)*86400 LIMIT 3500`;
function measure(sql) {
  const query = db.prepare(sql); query.all(timestamp);
  const times = Array.from({length: 7}, () => { const start = performance.now(); query.all(timestamp); return performance.now() - start; }).sort((a,b) => a-b);
  return { medianMs: Number(times[3].toFixed(3)), queryPlan: db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(timestamp).map(row => row.detail),
    checksIndexes: db.prepare("SELECT name FROM sqlite_schema WHERE type='index' AND tbl_name='checks' ORDER BY name").all().map(row => row.name) };
}
const before = measure(oldSQL);
db.exec(readFileSync('migrations/0007_history_costs.sql', 'utf8'));
const after = measure(retentionCandidatesSQL('checks', 'checked_at', 3500));
const report = { records: 100000, monitors: 10, expiredRecords: 0, before, after,
  note: 'Synthetic local SQLite. Timings and query plans are not Cloudflare billing or a production load test.' };
mkdirSync('artifacts', {recursive:true});
writeFileSync('artifacts/storage-cost-benchmark.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2)); db.close();
