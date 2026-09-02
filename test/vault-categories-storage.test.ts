import { beforeEach, describe, expect, it } from 'vitest';
import { customCategory, DEFAULT_CATEGORIES } from '../src/domain/vault.js';
import { invalidateCategories, loadCategories, upsertCategory } from '../src/store/vault-categories.js';

const shared = new Map<string, string>();
const personal = new Map<string, Map<string, string>>();
const writes: Array<{ path: string; userId?: string }> = [];

function userFiles(userId?: string): Map<string, string> {
  const key = userId ?? '__single_user__';
  let files = personal.get(key);
  if (!files) { files = new Map(); personal.set(key, files); }
  return files;
}

beforeEach(() => {
  shared.clear(); personal.clear(); writes.length = 0; invalidateCategories();
  (globalThis as any).spindle = {
    storage: {
      exists: async (path: string) => shared.has(path),
      read: async (path: string) => shared.get(path),
      write: async (path: string, data: string) => { shared.set(path, data); },
    },
    userStorage: {
      exists: async (path: string, userId?: string) => userFiles(userId).has(path),
      read: async (path: string, userId?: string) => userFiles(userId).get(path),
      write: async (path: string, data: string, userId?: string) => {
        writes.push({ path, userId }); userFiles(userId).set(path, data);
      },
    },
  };
});

describe('vault category user storage', () => {
  it('keeps caches and writes isolated by authenticated user', async () => {
    const custom = customCategory('u1-only', 'Private', 'P', '#123456');
    await upsertCategory(custom, 'u1');

    expect((await loadCategories('u1')).some((item) => item.id === 'u1-only')).toBe(true);
    expect((await loadCategories('u2')).some((item) => item.id === 'u1-only')).toBe(false);
    expect(writes.some((write) => write.userId === 'u1')).toBe(true);
    expect(writes.some((write) => write.userId === 'u2')).toBe(false);
  });

  it('lets only one concurrent user claim the former shared value', async () => {
    const legacy = [...DEFAULT_CATEGORIES, customCategory('legacy-only', 'Legacy', 'L', '#654321')];
    shared.set('vellum/vault-categories.json', JSON.stringify({ categories: legacy }));

    const [first, second] = await Promise.all([loadCategories('u1'), loadCategories('u2')]);
    const claimed = [first, second].filter((items) => items.some((item) => item.id === 'legacy-only'));

    expect(claimed).toHaveLength(1);
    expect(shared.has('vellum/migration-1.1.6-vault-categories.json')).toBe(true);
  });
});
