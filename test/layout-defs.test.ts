import { describe, it, expect } from 'vitest';
import { LAYOUTS, setLayout, getLayout, type SectionId } from '../src/ui/layout-defs.js';

/**
 * Layout descriptor guards. layout-defs is pure (localStorage access is
 * try/catch-guarded), so these run in node with no DOM.
 */

const ALL: SectionId[] = ['status', 'present', 'tension', 'relations', 'threads', 'parallel', 'recent', 'stats'];

describe('layout definitions', () => {
  it('the three "Now" layouts are registered', () => {
    for (const id of ['livingpage', 'orrery', 'openbook']) {
      expect(LAYOUTS.some((l) => l.id === id), id).toBe(true);
    }
  });

  it('every layout orders only known section ids (no typos)', () => {
    for (const l of LAYOUTS) {
      for (const id of l.order) expect(ALL.includes(id), `${l.id}:${id}`).toBe(true);
    }
  });

  it('the three Now layouts expose all eight sections (nothing dropped)', () => {
    for (const id of ['livingpage', 'orrery', 'openbook']) {
      const lay = LAYOUTS.find((l) => l.id === id)!;
      const shown = lay.order.filter((s) => !lay.hidden.includes(s));
      expect(new Set(shown), id).toEqual(new Set(ALL));
    }
  });

  it('setLayout selects a registered layout; getLayout returns it', () => {
    setLayout('livingpage');
    expect(getLayout().id).toBe('livingpage');
    setLayout('openbook');
    expect(getLayout().columns).toBe(2);
    setLayout('dashboard'); // reset
  });

  it('setLayout ignores an unknown id (falls back safely)', () => {
    setLayout('dashboard');
    setLayout('bogus-layout');
    expect(getLayout().id).toBe('dashboard');
  });
});
