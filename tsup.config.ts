import { defineConfig } from 'tsup';

/**
 * Two IIFE bundles for Lumiverse: dist/backend.js (worker) and dist/frontend.js
 * (UI). No code splitting — the host loads each as a single file. The frontend
 * must export `setup`, so we keep it discoverable via a named global footer.
 */
export default defineConfig([
  {
    entry: { backend: 'src/backend.ts' },
    format: ['iife'],
    outDir: 'dist',
    minify: true,
    splitting: false,
    clean: true,
    target: 'es2022',
    outExtension: () => ({ js: '.js' }),
  },
  {
    entry: { frontend: 'src/ui/app.ts' },
    format: ['iife'],
    outDir: 'dist',
    minify: true,
    splitting: false,
    target: 'es2022',
    outExtension: () => ({ js: '.js' }),
    // expose setup() on the global the host invokes
    globalName: 'VellumFrontend',
    footer: { js: 'if(typeof VellumFrontend!=="undefined"&&VellumFrontend.setup){globalThis.setup=VellumFrontend.setup;}' },
  },
]);
