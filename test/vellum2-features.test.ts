import { describe, it, expect } from 'vitest';
import { parseState } from '../src/parse/state-block.js';

const J = (body: string) => `The lamp guttered.\n<vellum>\n${body}\n</vellum>`;

describe('VELLUM II 2.1 — new feature state shapes round-trip', () => {
  it('Palimpsest: ext.scars survives validation and does not break the turn', () => {
    const r = parseState(J(JSON.stringify({
      turn: 41,
      delta: { knowledge: [{ who: 'Mira', fact: 'the letter was a forgery', reliability: 'knows', truth: 'true' }] },
      ext: { scars: [{ who: 'Mira', was: 'believed Aldous was loyal', turn: 41 }] },
    })));
    expect(r.source).toBe('json');
    expect(r.state?.turn).toBe(41);
    // ext is preserved by the schema (open record)
    expect((r.state as any)?.ext?.scars?.[0]?.who).toBe('Mira');
    // the real knowledge delta still folds
    expect(r.state?.delta?.knowledge?.[0]?.reliability).toBe('knows');
  });

  it('Codex: a world-fact knowledge entry parses (who:"world")', () => {
    const r = parseState(J(JSON.stringify({
      turn: 12,
      delta: { knowledge: [{ who: 'world', fact: 'the Salt Guild brands initiates on the wrist', reliability: 'knows', truth: 'true' }] },
      ext: { codex: [{ fact: 'Salt Guild wrist-brand rite' }] },
    })));
    expect(r.source).toBe('json');
    expect(r.state?.delta?.knowledge?.[0]?.who).toBe('world');
    expect((r.state as any)?.ext?.codex?.[0]?.fact).toContain('Salt Guild');
  });

  it('Emotional Save: a turn that emits only aff/trust deltas folds normally', () => {
    const r = parseState(J(JSON.stringify({
      turn: 77,
      delta: { bonds: [{ a: 'Mira', b: 'Aldous', aff: -6, trust: -10, cat: ['romantic'], why: 'it glanced off an old wound' }] },
    })));
    expect(r.source).toBe('json');
    const b = r.state?.delta?.bonds?.[0];
    expect(b?.aff).toBe(-6);
    expect(b?.trust).toBe(-10);
    // preset emits `cat`; normalizeBlock maps it to addCats
    expect((b as any)?.addCats).toEqual(['romantic']);
  });

  it('a turn with ext but no other delta still yields a valid state', () => {
    const r = parseState(J(JSON.stringify({ turn: 5, ext: { scars: [] } })));
    expect(r.source).toBe('json');
    expect(r.state?.turn).toBe(5);
  });

  it('terse fallback line (promoted in the diet) still parses a bond', () => {
    const r = parseState('She left without a word.\nrel Aldous -> Mira: aff -6, trust -10 cat:romantic (the lie)');
    expect(r.source).toBe('regex');
    const b = r.state?.delta?.bonds?.[0];
    expect(b?.a).toBe('Aldous');
    expect(b?.b).toBe('Mira');
    expect(b?.aff).toBe(-6);
    expect(b?.addCats).toEqual(['romantic']);
  });
});
