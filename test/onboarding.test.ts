import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Onboarding show-once logic (Phase 6). Runs in node (no DOM); the module's
 * localStorage + document access is guarded, and we stub localStorage so the
 * flag round-trips. We only exercise the pure flag helpers here.
 */

// minimal localStorage stub
class MemStore {
  private m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
}

beforeEach(() => {
  (globalThis as any).localStorage = new MemStore();
  vi.resetModules();
});

describe('onboarding — show-once flag', () => {
  it('hasOnboarded is false when the flag is unset', async () => {
    const { hasOnboarded } = await import('../src/ui/onboarding.js');
    expect(hasOnboarded()).toBe(false);
  });

  it('hasOnboarded is true once the flag is set', async () => {
    (globalThis as any).localStorage.setItem('vellum2.onboarded', '1');
    const { hasOnboarded } = await import('../src/ui/onboarding.js');
    expect(hasOnboarded()).toBe(true);
  });

  it('tolerates a missing/throwing localStorage (returns false, no throw)', async () => {
    (globalThis as any).localStorage = { getItem() { throw new Error('nope'); } };
    const { hasOnboarded } = await import('../src/ui/onboarding.js');
    expect(hasOnboarded()).toBe(false);
  });
});
