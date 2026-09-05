import { type VaultCategory, DEFAULT_CATEGORIES, isSyncSource } from '../domain/vault.js';
import { tryCatchAsync } from '../core/result.js';

declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

/**
 * Vault category config store. Categories are global to the user (lore
 * organization is a personal taste, not per-chat), persisted in extension
 * storage. Defaults seed on first use; user edits/additions/hides override.
 */

const PATH = 'vellum/vault-categories.json';
const LEGACY_CLAIM = 'vellum/migration-1.1.6-vault-categories.json';
const _cache = new Map<string, VaultCategory[]>();
let _legacyClaimQueue: Promise<unknown> = Promise.resolve();

/** Serialize the one-time shared-to-personal migration. Two operator users can
 * open VELLUM concurrently; without a queue they can both observe the marker as
 * absent and receive the same former shared preferences. */
function claimLegacy(userId?: string | null): Promise<VaultCategory[] | null> {
  const run = _legacyClaimQueue.catch(() => {}).then(async () => {
    if (await spindle.userStorage.exists(PATH, userId ?? undefined)) {
      const raw = await spindle.userStorage.read(PATH, userId ?? undefined);
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed?.categories) && parsed.categories.length
        ? parsed.categories as VaultCategory[] : null;
    }
    if ((await spindle.storage.exists(LEGACY_CLAIM)) || !(await spindle.storage.exists(PATH))) return null;
    const raw = await spindle.storage.read(PATH);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.categories) || !parsed.categories.length) return null;
    await spindle.userStorage.write(PATH, raw, userId ?? undefined);
    await spindle.storage.write(LEGACY_CLAIM, JSON.stringify({ migratedAt: Date.now() }));
    return parsed.categories as VaultCategory[];
  });
  _legacyClaimQueue = run.then(() => undefined, () => undefined);
  return run;
}

export async function loadCategories(userId?: string | null): Promise<VaultCategory[]> {
  const key = userId ?? '__single_user__';
  const cached = _cache.get(key);
  if (cached) return cached;
  const r = await tryCatchAsync(async () => {
    if (await spindle.userStorage.exists(PATH, userId ?? undefined)) {
      const raw = await spindle.userStorage.read(PATH, userId ?? undefined);
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.categories) && parsed.categories.length) return parsed.categories as VaultCategory[];
    }
    // One-time compatibility migration for the first user of an older personal
    // install. Never fan the former shared value out to multiple operator users.
    return claimLegacy(userId);
  });
  const categories = (r.ok && r.value) ? mergeDefaults(r.value) : DEFAULT_CATEGORIES.map((c) => ({ ...c }));
  _cache.set(key, categories);
  return categories;
}

/** Ensure built-in categories always exist (so a new default appears for users). */
function mergeDefaults(stored: VaultCategory[]): VaultCategory[] {
  const out = stored.map<VaultCategory>((c) => {
    const d = DEFAULT_CATEGORIES.find((x) => x.id === c.id);
    // Add newly introduced schema fields without replacing personal colors,
    // activation defaults, visibility, or sync choices.
    const source = isSyncSource(c.source) ? c.source : d?.source;
    return d ? { ...d, ...c, defaults: { ...d.defaults, ...c.defaults }, source } : { ...c, source };
  });
  for (const d of DEFAULT_CATEGORIES) if (!out.some((c) => c.id === d.id)) out.push({ ...d, defaults: { ...d.defaults } });
  return out;
}

async function persist(userId?: string | null): Promise<void> {
  const categories = _cache.get(userId ?? '__single_user__');
  if (!categories) return;
  await spindle.userStorage.write(PATH, JSON.stringify({ categories }), userId ?? undefined);
}

export async function upsertCategory(cat: VaultCategory, userId?: string | null): Promise<VaultCategory[]> {
  const cats = await loadCategories(userId);
  const i = cats.findIndex((c) => c.id === cat.id);
  if (i >= 0) cats[i] = { ...cats[i]!, ...cat };
  else cats.push(cat);
  await persist(userId);
  return cats;
}

export async function deleteCategory(id: string, userId?: string | null): Promise<VaultCategory[]> {
  const cats = await loadCategories(userId);
  const c = cats.find((x) => x.id === id);
  if (c && !c.builtin) {
    const next = cats.filter((x) => x.id !== id);
    _cache.set(userId ?? '__single_user__', next);
    await persist(userId);
    return next;
  }
  // built-ins can't be deleted, only hidden
  if (c) { c.hidden = true; await persist(userId); }
  return cats;
}

export function invalidateCategories(userId?: string | null): void {
  if (userId === undefined) _cache.clear();
  else _cache.delete(userId ?? '__single_user__');
}
