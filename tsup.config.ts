import { defineConfig } from 'tsup';

/**
 * Two ESM bundles for Lumiverse: dist/backend.js (worker) and dist/frontend.js
 * (UI). The host imports each as an ES module — the frontend MUST expose a
 * named `export function setup(ctx)` and the backend runs on import. So we emit
 * `esm` (NOT iife): tsup then preserves the `export { setup }` the host needs.
 * zod is bundled (no external deps at runtime).
 */
export default defineConfig([
  {
    entry: { backend: 'src/backend.ts' },
    format: ['esm'],
    outDir: 'dist',
    minify: true,
    splitting: false,
    clean: true,
    target: 'es2022',
    outExtension: () => ({ js: '.js' }),
  },
  {
    entry: { frontend: 'src/ui/app.ts' },
    format: ['esm'],
    outDir: 'dist',
    minify: true,
    splitting: false,
    target: 'es2022',
    outExtension: () => ({ js: '.js' }),
  },
]);
