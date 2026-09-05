import { describe, expect, it } from 'vitest';
import { auditVault } from '../src/domain/vault-health.js';
import { freshState } from '../src/domain/types.js';
import type { LiteEntry, VaultSnapshot } from '../src/host/worldbooks.js';

const entry = (over: Partial<LiteEntry> = {}): LiteEntry => ({
  id: 'e1', bookId: 'b1', key: ['Alice'], keysecondary: [], content: 'Alice is a courier.', comment: 'Alice',
  position: 4, depth: 4, order_value: 100, constant: false, disabled: false, vellum: true,
  category: 'characters', source: 'cast', link: 'cast:alice', pending: false, hash: 'h',
  ownerChatId: 'chat-a', vaultRole: 'manual', bodyState: 'clean', ...over,
});

const snapshot = (entries: LiteEntry[], complete = true): VaultSnapshot => ({
  ok: true, complete, errors: complete ? [] : ['entries_incomplete:b1'], loadedAt: 1, attached: ['b1'], activated: [],
  books: [{ id: 'b1', name: 'Owned', description: '', vellum: true, ownerChatId: 'chat-a', role: 'manual', attachedToChat: true, global: false, entries }],
});

describe('Vault integrity audit', () => {
  it('reports partial reads, conflicts, duplicate links, orphans, and private projections', () => {
    const state = freshState();
    state.cast.alice = { id: 'alice', name: 'Alice', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false };
    const snap = snapshot([
      entry({ id: 'e1', bodyState: 'conflict' }),
      entry({ id: 'e2' }),
      entry({ id: 'e3', link: 'secret:lost', source: 'secrets', key: [] }),
    ], false);
    const health = auditVault(snap, 'chat-a', state);
    const codes = new Set(health.issues.map((x) => x.code));
    expect(codes.has('snapshot_incomplete')).toBe(true);
    expect(codes.has('body_conflict')).toBe(true);
    expect(codes.has('duplicate_link')).toBe(true);
    expect(codes.has('orphan_link')).toBe(true);
    expect(codes.has('restricted_projection')).toBe(true);
    expect(codes.has('missing_keys')).toBe(true);
    expect(health.score).toBeLessThan(100);
  });

  it('does not audit another chat\'s entries as owned', () => {
    const state = freshState();
    const snap = snapshot([entry({ ownerChatId: 'chat-b', bodyState: 'conflict' })]);
    const health = auditVault(snap, 'chat-a', state);
    expect(health.stats.entries).toBe(0);
    expect(health.issues.some((x) => x.code === 'body_conflict')).toBe(false);
  });
});
