import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const backend = readFileSync(new URL('../src/backend.ts', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../src/ui/tabs/workbench.ts', import.meta.url), 'utf8');

describe('Workbench integration contract', () => {
  it('stages reconstruction and verifies both source revisions before apply', () => {
    expect(backend).toContain("type: 'vellum_workbench_progress'");
    expect(backend).toContain('source_changed_during_reconstruction');
    expect(backend).toContain("reason: 'candidate_stale'");
    expect(backend).toContain('await importLog(chatId, log)');
    expect(backend).toContain('reconstructionRollbackPath(chatId)');
    expect(backend).toContain('vellum_reconstruct_rollback');
  });

  it('does not expose the removed Cartographer intervention', () => {
    expect(backend).not.toContain("op === 'worldgen-now'");
    expect(ui).not.toContain("actionCard('worldgen-now'");
    expect(ui).not.toContain('((worldgen))');
  });

  it('exposes model, intervention, reconstruction, and health pages', () => {
    for (const label of ['Models', 'Interventions', 'Reconstruction', 'Health']) expect(ui).toContain(label);
  });

  it('exposes the canon-grounded parallel command from Workbench', () => {
    const source = readFileSync(new URL('../src/ui/tabs/workbench.ts', import.meta.url), 'utf8');
    expect(source).toContain("actionCard('parallel-now'");
    expect(source).toContain('((parallel))');
    expect(source).toContain("op === 'parallel-now'");
  });
});
