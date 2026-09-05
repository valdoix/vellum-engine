import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('frontend distribution bundle', () => {
  it('is self-contained for Lumiverse blob URL loading', () => {
    const bundle = readFileSync(resolve(process.cwd(), 'dist/frontend.js'), 'utf8');

    // Lumiverse imports this file through a blob: URL. Bare package imports have
    // no base URL or import map there and prevent setup() from running at all.
    expect(bundle).not.toMatch(/\bfrom\s*["']zod["']/);
    expect(bundle).not.toMatch(/\bimport\s*\(\s*["']zod["']\s*\)/);
    expect(bundle).toMatch(/export\s*\{[^}]*\bsetup\b[^}]*\}\s*;?\s*$/);
  });
});
