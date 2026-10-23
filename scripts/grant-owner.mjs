import { spawnSync } from 'node:child_process';
import { existsSync,readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {migrationConnection} from './postgres-migrate.mjs';

const args = process.argv.slice(2), index = args.indexOf('--user-id'), id = args[index + 1];
if (index < 0 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id ?? '') ||
  args.filter(arg => arg === '--local' || arg === '--remote').length !== 1) {
  throw new Error('Uso: node scripts/grant-owner.mjs --local|--remote --user-id UUID. Comprueba personalmente la identidad antes de conceder acceso.');
}
const remote = args.includes('--remote'), config = remote ? 'wrangler.production.jsonc' : 'wrangler.jsonc';
if (!existsSync(config)) throw new Error(`Falta ${config}; no se modifica ninguna cuenta.`);
if(remote&&JSON.parse(readFileSync(config,'utf8')).vars?.DATABASE_PROVIDER==='supabase'){
  const client=migrationConnection();
  try{
    const owner=await client.begin(async tx=>{
      const [user]=await tx`UPDATE vyrsea.users SET is_owner=1,account_status='active',plan_id='business',domain_limit=NULL,monitor_limit=NULL,history_days_limit=90,
        last_active_at=floor(extract(epoch from now()))::bigint,status_changed_at=floor(extract(epoch from now()))::bigint,suspension_reason=NULL,review_requested_at=NULL,
        monitoring_since=(floor(extract(epoch from now())/60)::bigint+1)*60 WHERE id=${id}
        RETURNING id,username,account_status,plan_id,is_owner,domain_limit,monitor_limit,history_days_limit`;
      if(!user)throw new Error('No existe una cuenta con ese UUID.');
      await tx`DELETE FROM vyrsea.check_jobs WHERE monitor_id IN (SELECT id FROM vyrsea.monitors WHERE user_id=${id})`;
      await tx`UPDATE vyrsea.monitors SET next_check_at=GREATEST(COALESCE(last_checked_at,0)+60,floor(extract(epoch from now()))::bigint+60),
        failures=CASE WHEN status='down' THEN failures ELSE 0 END,status=CASE WHEN status='degraded' THEN 'pending' ELSE status END WHERE user_id=${id}`;
      return user;
    });
    console.log(JSON.stringify({environment:'production',database:'supabase',owner,billingEnabled:false},null,2));
  }catch(error){console.error(JSON.stringify({event:'grant_owner_failed',code:error.code,message:error.message}));process.exitCode=1;}
  finally{await client.end({timeout:5});}
  process.exit(process.exitCode??0);
}
// Owner is provisioned through a trusted operator CLI, never first-signup logic or a public API.
// The trusted owner is exempt from product quotas; physical Free capacity is still finite.
const sql = `UPDATE users SET is_owner=1,account_status='active',plan_id='business',domain_limit=NULL,monitor_limit=NULL,history_days_limit=90,
  last_active_at=unixepoch(),status_changed_at=unixepoch(),suspension_reason=NULL,review_requested_at=NULL
  ,monitoring_since=(CAST(unixepoch()/60 AS INTEGER)+1)*60
  WHERE id='${id}' RETURNING id,username,account_status,plan_id,is_owner,domain_limit,monitor_limit,history_days_limit;
  DELETE FROM check_jobs WHERE monitor_id IN (SELECT id FROM monitors WHERE user_id='${id}');
  UPDATE monitors SET next_check_at=MAX(COALESCE(last_checked_at,0)+60,unixepoch()+60),
    failures=CASE WHEN status='down' THEN failures ELSE 0 END,status=CASE WHEN status='degraded' THEN 'pending' ELSE status END
    WHERE user_id='${id}';`;
const result = spawnSync(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), 'd1', 'execute', 'DB', remote ? '--remote' : '--local', '--config', config, '--command', sql, '--json'], {
  encoding: 'utf8', env: { ...process.env, XDG_CONFIG_HOME: resolve('.wrangler/config'), WRANGLER_SEND_METRICS: 'false' },
});
if (result.status !== 0) { process.stderr.write(result.stderr || 'No se ha podido conceder el acceso.'); process.exit(result.status || 1); }
const rows = JSON.parse(result.stdout).flatMap(result => result.results ?? []);
if (rows.length !== 1) throw new Error('No existe una cuenta con ese UUID. No se ha concedido acceso.');
console.log(JSON.stringify({ environment: remote ? 'production' : 'local', owner: rows[0], billingEnabled: false }, null, 2));
