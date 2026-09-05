import { afterEach, describe, expect, it } from 'vitest';
import { adoptBookForChat, contentHash, extensionsFromEntry, keywordHash, makeExtensions, ownedBooks, ownedEntries, type LiteEntry, type VaultSnapshot } from '../src/host/worldbooks.js';

const lite = (over: Partial<LiteEntry> = {}): LiteEntry => ({
  id: 'e1', bookId: 'b1', key: ['Alice'], keysecondary: [], content: 'Alice is a courier.', comment: 'Alice',
  position: 4, depth: 4, order_value: 100, constant: false, disabled: false, vellum: true,
  category: 'characters', source: 'cast', link: 'cast:alice', pending: false,
  hash: contentHash('Alice is a courier.'), keyHash: keywordHash(['Alice']), ownerChatId: 'chat-a', vaultRole: 'manual',
  canonicalType: 'cast', canonicalId: 'alice', schemaVersion: 2, createdAt: 10, updatedAt: 10, bodyState: 'clean', ...over,
});

describe('worldbook ownership envelope', () => {
  afterEach(() => { delete (globalThis as any).spindle; });

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

  it('adopts an attached native lorebook without changing its entry body or activation fields', async () => {
    const native = lite({ vellum: false, ownerChatId: '', vaultRole: undefined, schemaVersion: 0, category: '', source: '', link: '', hash: '', keyHash: '', bodyState: 'legacy' });
    const snap: VaultSnapshot = {
      ok: true, complete: true, errors: [], loadedAt: 1, attached: ['b1'], activated: [],
      books: [{ id: 'b1', name: 'Native lore', description: '', vellum: false, ownerChatId: '', role: 'manual', attachedToChat: true, global: false, entries: [native] }],
    };
    const entryWrites: any[] = [];
    const bookWrites: any[] = [];
    (globalThis as any).spindle = { world_books: {
      get: async () => ({ id: 'b1', metadata: { kept: 'yes' } }),
      update: async (_id: string, patch: any) => { bookWrites.push(patch); return { id: 'b1', metadata: patch.metadata }; },
      entries: { update: async (id: string, patch: any) => { entryWrites.push(patch); return { id }; } },
    } };

    const result = await adoptBookForChat(snap, 'b1', 'chat-a', 'user-a');
    expect(result).toMatchObject({ ok: true, value: { entriesClaimed: 1, entriesFailed: 0 } });
    expect(bookWrites[0].metadata).toMatchObject({ kept: 'yes', vellum: true, vellumOwnerChatId: 'chat-a', vellumRole: 'lore' });
    expect(entryWrites[0]).toEqual({ extensions: expect.objectContaining({ vellum: true, vellumOwnerChatId: 'chat-a', vellumRole: 'lore', vellumCategory: 'concepts' }) });
    expect(entryWrites[0]).not.toHaveProperty('content');
    expect(entryWrites[0]).not.toHaveProperty('key');
  });

  it('refuses to adopt a lorebook owned by another chat before any host write', async () => {
    let writes = 0;
    (globalThis as any).spindle = { world_books: {
      get: async () => null,
      update: async () => { writes++; },
      entries: { update: async () => { writes++; } },
    } };
    const snap: VaultSnapshot = {
      ok: true, complete: true, errors: [], loadedAt: 1, attached: ['b1'], activated: [],
      books: [{ id: 'b1', name: 'Other chat', description: '', vellum: true, ownerChatId: 'chat-b', role: 'lore', attachedToChat: true, global: false, entries: [] }],
    };
    expect(await adoptBookForChat(snap, 'b1', 'chat-a', 'user-a')).toEqual({ ok: false, error: 'foreign_owner' });
    expect(writes).toBe(0);
  });
});
