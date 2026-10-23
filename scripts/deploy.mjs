import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--config')) throw new Error('Uso: node scripts/deploy.mjs [--config ruta]');
const configPath = args[1] ?? 'wrangler.jsonc';
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const origin = config.vars.APP_ORIGIN;
const postgres=config.vars.DATABASE_PROVIDER==='supabase';
const databaseConfigured=postgres?config.hyperdrive?.some(binding=>binding.binding==='HYPERDRIVE'&&/^[a-f0-9]{32}$/.test(binding.id)):config.d1_databases?.some(binding=>binding.binding==='DB'&&binding.database_id!=='00000000-0000-0000-0000-000000000000');
if (!/^https:\/\/[^/]+$/.test(origin) || !databaseConfigured || !config.vars.TURNSTILE_SITE_KEY) {
  console.error(`Configura APP_ORIGIN HTTPS, la conexión de base de datos y TURNSTILE_SITE_KEY en ${configPath}. Consulta README.md antes de desplegar.`);
  process.exit(1);
}
// PostgreSQL migrations are applied explicitly by an operator BEFORE deploying
// compatible code. Cloudflare Builds never receives the database admin password.
for (const [script, args] of [
  ['node_modules/typescript/bin/tsc', ['--noEmit']],
  ['node_modules/vite/bin/vite.js', ['build']],
  ['scripts/prerender.mjs', []],
  ['scripts/check-site.mjs', []],
  ...(!postgres?[['node_modules/wrangler/bin/wrangler.js', ['d1', 'migrations', 'apply', 'DB', '--remote', '--config', configPath]]]:[]),
  ['node_modules/wrangler/bin/wrangler.js', ['deploy', '--config', configPath]],
]) {
  const result = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
