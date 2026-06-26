import { type VaultCategory, DEFAULT_CATEGORIES } from '../domain/vault.js';
import { tryCatchAsync } from '../core/result.js';

declare const spindle: any;

/**
 * Vault category config store. Categories are global to the user (lore
 * organization is a personal taste, not per-chat), persisted in extension
 * storage. Defaults seed on first use; user edits/additions/hides override.
 */

const PATH = 'vellum/vault-categories.json';
let _cache: VaultCategory[] | null = null;

export async function loadCategories(): Promise<VaultCategory[]> {
  if (_cache) return _cache;
  const r = await tryCatchAsync(async () => {
    if (spindle.storage?.exists && (await spindle.storage.exists(PATH))) {
      const raw = await spindle.storage.read(PATH);
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.categories) && parsed.categories.length) return parsed.categories as VaultCategory[];
    }
    return null;
  });
  _cache = (r.ok && r.value) ? mergeDefaults(r.value) : DEFAULT_CATEGORIES.map((c) => ({ ...c }));
  return _cache;
}

/** Ensure built-in categories always exist (so a new default appears for users). */
function mergeDefaults(stored: VaultCategory[]): VaultCategory[] {
  const out = stored.slice();
  for (const d of DEFAULT_CATEGORIES) if (!out.some((c) => c.id === d.id)) out.push({ ...d });
  return out;
}

async function persist(): Promise<void> {
  if (!_cache) return;
  await tryCatchAsync(async () => { if (spindle.storage?.write) await spindle.storage.write(PATH, JSON.stringify({ categories: _cache })); });
}

export async function upsertCategory(cat: VaultCategory): Promise<VaultCategory[]> {
  const cats = await loadCategories();
  const i = cats.findIndex((c) => c.id === cat.id);
  if (i >= 0) cats[i] = { ...cats[i]!, ...cat };
  else cats.push(cat);
  await persist();
  return cats;
}

export async function deleteCategory(id: string): Promise<VaultCategory[]> {
  const cats = await loadCategories();
  const c = cats.find((x) => x.id === id);
  if (c && !c.builtin) { _cache = cats.filter((x) => x.id !== id); await persist(); return _cache; }
  // built-ins can't be deleted, only hidden
  if (c) { c.hidden = true; await persist(); }
  return cats;
}

export function invalidateCategories(): void { _cache = null; }
