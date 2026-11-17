import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const playableEntry = fileURLToPath(new URL('./index.html', import.meta.url));
const playableTemplate = fileURLToPath(new URL('./scripts/standalone-template.html', import.meta.url));

function redirectLegacyEntry(req: IncomingMessage, res: ServerResponse, next: () => void): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/playable-v2.html') { next(); return; }
  res.statusCode = 302;
  res.setHeader('Location', `./index.html${url.search}`);
  res.end();
}

function playableDefault(): Plugin {
  return {
    name: 'standalone-default-entry',
    configureServer(server) { server.middlewares.use(redirectLegacyEntry); },
    configurePreviewServer(server) { server.middlewares.use(redirectLegacyEntry); },
    transformIndexHtml: {
      order: 'pre',
      async handler(html, context) {
        if (!context.server || (context.path !== '/' && !context.path.endsWith('/index.html'))) return html;
        // Use the same bootstrap with Vite's normal module/CSS hot reload in development.
        return (await readFile(playableTemplate, 'utf8')).replace(
          '<!-- STANDALONE_ASSETS -->', '<script type="module" src="/src/standalone.ts"></script>',
        );
      },
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [playableDefault()],
  server: {
    port: 5173,
    strictPort: false,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    rolldownOptions: { input: playableEntry },
    sourcemap: false,
    // The generated playable entry already contains its script and styles.
    chunkSizeWarningLimit: 800,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    environment: 'node',
    globals: false,
    testTimeout: 15000,
  },
});
