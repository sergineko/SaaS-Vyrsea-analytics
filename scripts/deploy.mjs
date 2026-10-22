import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
const origin = config.vars.APP_ORIGIN;
if (!/^https:\/\/[^/]+$/.test(origin) || config.d1_databases[0].database_id === '00000000-0000-0000-0000-000000000000' || !config.vars.TURNSTILE_SITE_KEY) {
  console.error('Configura APP_ORIGIN con tu origen HTTPS, database_id y TURNSTILE_SITE_KEY en wrangler.jsonc. Consulta README.md antes de desplegar.');
  process.exit(1);
}
// Build and migration must both succeed before publication. Secret presence is verified separately via Wrangler.
for (const [script, args] of [
  ['node_modules/typescript/bin/tsc', ['--noEmit']],
  ['node_modules/vite/bin/vite.js', ['build']],
  ['scripts/prerender.mjs', []],
  ['scripts/check-site.mjs', []],
  ['node_modules/wrangler/bin/wrangler.js', ['d1', 'migrations', 'apply', 'DB', '--remote']],
  ['node_modules/wrangler/bin/wrangler.js', ['deploy']],
]) {
  const result = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
