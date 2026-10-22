import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { resolve } from 'node:path';
// Optional online smoke test: a real outbound probe in workerd, with no HTTP mocks.
await build({ stdin: { contents: "import { probe } from './worker/probe.ts'; export default { async fetch(request, env) { return Response.json(await probe(env.TARGET)); } };", resolveDir: resolve('.') },
  bundle: true, format: 'esm', platform: 'neutral', outfile: '.test-build/smoke-probe.mjs' });
const mf = new Miniflare({ modules: true, scriptPath: '.test-build/smoke-probe.mjs', compatibilityDate: '2026-07-01', bindings: { TARGET: process.argv[2] ?? 'https://www.cloudflare.com/' } });
try {
  const response = await mf.dispatchFetch('http://localhost/');
  const result = await response.json();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} finally { await mf.dispose(); }
