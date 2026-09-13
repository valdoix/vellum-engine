import { describe, expect, it } from 'vitest';
import { entriesForVaultScope, type VBook } from '../src/ui/tabs/vault.js';

const book = (id: string, attachedToChat: boolean, ownerChatId: string): VBook => ({
  id, name: id, attachedToChat, global: false, vellum: true, ownerChatId, role: 'lore',
  entries: [{
    id: `${id}-entry`, bookId: id, key: [id], content: `Lore from ${id}.`, comment: id,
    disabled: false, vellum: true, category: 'concepts', source: 'manual', link: '', pending: false,
    ownerChatId,
  }],
});

describe('Vault lorebook scope', () => {
  it('shows every attached book entry even when another chat owns it', () => {
    const books = [book('local', true, 'chat-b'), book('shared', true, 'chat-a'), book('unattached', false, 'chat-a')];
    expect(entriesForVaultScope({ books }, 'attached').map((entry) => entry.id)).toEqual([
      'local-entry', 'shared-entry',
    ]);
    expect(entriesForVaultScope({ books }, 'all')).toHaveLength(3);
  });
});
