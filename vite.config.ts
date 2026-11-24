import { defineConfig, type Plugin } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';

/**
 * Writes sw.js at build time with the exact list of files to cache, so the app
 * works fully offline after the first visit and updates itself on each new deploy.
 */
function serviceWorker(): Plugin {
  return {
    name: 'service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = ['./', ...Object.keys(bundle), ...readdirSync('public')].filter((f) => f !== 'sw.js');
      const version = createHash('sha1').update(files.join('|')).digest('hex').slice(0, 10);
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `// Generated at build time.
const CACHE = 'cube-solver-${version}';
const FILES = ${JSON.stringify(files)};

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    // Page loads: fresh copy when online, cached app when offline.
    e.respondWith(fetch(req).catch(() => caches.match('./')));
    return;
  }
  // Everything else has a content hash in its name, so the cached copy is always right.
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
`,
      });
    },
  };
}

export default defineConfig({
  base: './', // relative paths: works at any address (a domain root or a sub-folder)
  plugins: [basicSsl(), serviceWorker()],
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 800 }, // three.js is most of the bundle; fine for an installable app
  test: { include: ['tests/**/*.test.ts'] },
});
