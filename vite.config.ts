import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const publicDocuments: Record<string, string> = {
  '/robots.txt': 'text/plain', '/llms.txt': 'text/plain',
  '/sitemap.xml': 'application/xml', '/openapi.json': 'application/json',
};

export default defineConfig({
  plugins: [react(), tailwindcss(), {
    name: 'local-public-documents',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split('?')[0] ?? '';
        if (!publicDocuments[pathname] || !['GET', 'HEAD'].includes(req.method ?? '')) return next();
        try {
          const body = readFileSync(resolve('dist', pathname.slice(1)));
          res.setHeader('Content-Type', `${publicDocuments[pathname]}; charset=utf-8`);
          res.setHeader('Cache-Control', 'no-store');
          res.end(req.method === 'HEAD' ? undefined : body);
        } catch {
          res.statusCode = 404;
          res.end('Ejecuta pnpm build para generar la documentación pública.');
        }
      });
    },
  }],
  server: { host: 'localhost', strictPort: true,
    watch: { ignored: ['**/artifacts/**', '**/.wrangler/**', '**/.pnpm-store/**', '**/.test-build/**'] },
    proxy: { '/api': 'http://127.0.0.1:8787' } },
});
