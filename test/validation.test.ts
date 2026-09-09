import { describe, expect, it } from 'vitest';
import { looksLikeVellumTurn, missingBlockMessage, validateTurnStructure } from '../src/host/validation.js';

describe('turn scaffold validation', () => {
  it('recognizes the raw Reverie on an Engine Pass response whose state was compiled separately', () => {
    const raw = '<reverie>\nAgency: protected\n</reverie>\n\nMara closes the ledger.';
    const folded = 'Mara closes the ledger.\n<vellum>{"turn":2,"scene":{"loc":"Archive"}}</vellum>';
    expect(looksLikeVellumTurn(raw)).toBe(true);
    expect(validateTurnStructure(raw, { reverie: true, state: true }, 'json')).toEqual({ valid: true, missing: [] });
    // This pins the old failure mechanism: validating the synthesized compiler
    // content would falsely claim the response omitted its visible Reverie.
    expect(missingBlockMessage(validateTurnStructure(folded, { reverie: true, state: true }, 'json'))).toContain('skipped the ‹reverie›');
  });
});
