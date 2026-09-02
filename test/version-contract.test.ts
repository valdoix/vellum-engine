import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VELLUM_VERSION } from '../src/version.js';

const readJson = (relativePath: string): Record<string, any> =>
  JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));

describe('release compatibility contract', () => {
  it('keeps the package, manifest, and runtime version synchronized', () => {
    const pkg = readJson('../package.json');
    const manifest = readJson('../spindle.json');

    expect(pkg.version).toBe(VELLUM_VERSION);
    expect(manifest.version).toBe(VELLUM_VERSION);
  });

  it('pins the SDK used by Lumiverse 1.1.6', () => {
    const pkg = readJson('../package.json');
    const manifest = readJson('../spindle.json');

    expect(pkg.devDependencies['lumiverse-spindle-types']).toBe('0.6.27');
    expect(manifest.minimum_lumiverse_version).toBe('1.1.6');
  });
});
