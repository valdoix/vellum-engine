import { describe, expect, it } from 'vitest';
import { matchesPresetResponse } from '../src/domain/preset-request.js';

describe('preset request correlation', () => {
  it('rejects a late response from an earlier request', () => {
    const expected = { requestId: 'new', presetId: 'p2', chatId: 'c2' };
    expect(matchesPresetResponse({ requestId: 'old', presetId: 'p2', chatId: 'c2' }, expected)).toBe(false);
  });

  it('rejects replies for the prior preset or chat even if the operation id is reused', () => {
    const expected = { requestId: 'run', presetId: 'p2', chatId: 'c2' };
    expect(matchesPresetResponse({ requestId: 'run', presetId: 'p1', chatId: 'c2' }, expected)).toBe(false);
    expect(matchesPresetResponse({ requestId: 'run', presetId: 'p2', chatId: 'c1' }, expected)).toBe(false);
  });

  it('accepts only an exact current scope and fails closed without an active request', () => {
    expect(matchesPresetResponse({ requestId: 'run', presetId: 'p2', chatId: 'c2' }, { requestId: 'run', presetId: 'p2', chatId: 'c2' })).toBe(true);
    expect(matchesPresetResponse({ requestId: '' }, { requestId: '' })).toBe(false);
  });
});
