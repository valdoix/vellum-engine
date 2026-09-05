import { describe, expect, it } from 'vitest';
import { contentHash, extensionsFromEntry, keywordHash, makeExtensions, ownedBooks, ownedEntries, type LiteEntry, type VaultSnapshot } from '../src/host/worldbooks.js';

const lite = (over: Partial<LiteEntry> = {}): LiteEntry => ({
  id: 'e1', bookId: 'b1', key: ['Alice'], keysecondary: [], content: 'Alice is a courier.', comment: 'Alice',
  position: 4, depth: 4, order_value: 100, constant: false, disabled: false, vellum: true,
  category: 'characters', source: 'cast', link: 'cast:alice', pending: false,
  hash: contentHash('Alice is a courier.'), keyHash: keywordHash(['Alice']), ownerChatId: 'chat-a', vaultRole: 'manual',
  canonicalType: 'cast', canonicalId: 'alice', schemaVersion: 2, createdAt: 10, updatedAt: 10, bodyState: 'clean', ...over,
});

describe('worldbook ownership envelope', () => {
  it('stores canonical identity, content/key hashes, role, and chat owner', () => {
    const ext = makeExtensions({ category: 'characters', source: 'cast', link: 'cast:alice', ownerChatId: 'chat-a', vaultRole: 'manual', content: 'Alice is a courier.', key: ['Alice'] });
    expect(ext).toMatchObject({
      vellum: true, vellumSchemaVersion: 2, vellumOwnerChatId: 'chat-a', vellumRole: 'manual',
      vellumCanonicalType: 'cast', vellumCanonicalId: 'alice', vellumHash: contentHash('Alice is a courier.'), vellumKeyHash: keywordHash(['Alice']),
    });
  });

  it('preserves identity metadata while recording explicit user overrides', () => {
    const ext = extensionsFromEntry(lite(), { content: 'My preferred wording.', overrideFields: ['content'] });
    expect(ext).toMatchObject({ vellumOwnerChatId: 'chat-a', vellumLink: 'cast:alice', vellumCreatedAt: 10, vellumOverrideFields: ['content'] });
    expect(ext.vellumHash).toBe(contentHash('Alice is a courier.'));
  });

  it('selects entries by entry owner even when they live outside an owned book', () => {
    const snap: VaultSnapshot = {
      ok: true, complete: true, errors: [], loadedAt: 1, attached: [], activated: [],
      books: [
        { id: 'b1', name: 'Owned', description: '', vellum: true, ownerChatId: 'chat-a', role: 'manual', attachedToChat: true, global: false, entries: [lite()] },
        { id: 'native', name: 'Native', description: '', vellum: false, ownerChatId: '', role: 'manual', attachedToChat: true, global: false, entries: [lite({ id: 'e2', bookId: 'native' })] },
        { id: 'foreign', name: 'Foreign', description: '', vellum: true, ownerChatId: 'chat-b', role: 'manual', attachedToChat: false, global: false, entries: [lite({ id: 'e3', bookId: 'foreign', ownerChatId: 'chat-b' })] },
      ],
    };
    expect(ownedBooks(snap, 'chat-a').map((x) => x.id)).toEqual(['b1']);
    expect(ownedEntries(snap, 'chat-a').map((x) => x.id)).toEqual(['e1', 'e2']);
  });
});
