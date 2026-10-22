import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Wrangler needs the assets directory before the first production build.
if (!existsSync('dist/index.html')) { mkdirSync('dist', { recursive: true }); writeFileSync('dist/index.html', '<p>Abre http://localhost:5173 para desarrollar Vyrsea.</p>'); }
const run = (script, args) => spawn(process.execPath, [resolve(script), ...args], { stdio: 'inherit', env: { ...process.env, XDG_CONFIG_HOME: resolve('.wrangler/config'), WRANGLER_SEND_METRICS: 'false' } });
const migration = run('node_modules/wrangler/bin/wrangler.js', ['d1', 'migrations', 'apply', 'DB', '--local']);
const code = await new Promise(resolve => migration.on('exit', resolve));
if (code !== 0) process.exit(Number(code) || 1);
const children = [run('node_modules/wrangler/bin/wrangler.js', ['dev', '--port', '8787', '--test-scheduled']), run('node_modules/vite/bin/vite.js', ['--host', 'localhost'])];
// Cron is not automatic in wrangler dev. Invoke only its loopback development API.
let ticking = false;
let cleanupDate = '';
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const invoke = cron => fetch('http://127.0.0.1:8787/cdn-cgi/local/explorer/api/local/scheduled?worker=vyrsea-monitor', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cron }), signal: AbortSignal.timeout(25000),
    }).then(async response => { if (!response.ok) throw new Error(`Local Cron: HTTP ${response.status}`); });
    await invoke('* * * * *');
    const date = new Date().toISOString().slice(0, 10);
    if (date !== cleanupDate) { await invoke('17 3 * * *'); cleanupDate = date; }
  } catch (error) { console.warn('El programador local volverá a intentarlo en un minuto:', error.message); }
  finally { ticking = false; }
}
setTimeout(tick, 8000);
setInterval(tick, 60000);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { for (const child of children) child.kill(); process.exit(0); });
for (const child of children) child.on('exit', code => { for (const other of children) if (other !== child) other.kill(); process.exit(code ?? 1); });
