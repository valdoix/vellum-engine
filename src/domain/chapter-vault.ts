import type { ChronicleState, Memory } from './types.js';
import type { EntrySettings } from './vault.js';
import type { LiteEntry } from '../host/worldbooks.js';
import { contentHash, keywordHash } from '../host/worldbooks.js';
import { archiveCoverageHash, memorySnapshotHash } from './memory.js';

/**
 * Hybrid chapter memory — the VAULT projection (pure planning half).
 *
 * A chapter/arc/book memory's DETAILED summary is mirrored to a world-book entry so
 * the host's world-info system can inject it on keyword relevance, OUTSIDE
 * VELLUM's recall budget. The chronicle keeps only the lean gist (memory.text).
 * The event log stays the source of truth; the vault entry is a reconciled
 * projection keyed by its tier and stable memory id.
 *
 * PURE: builds entry inputs + reconcile diffs; the host writes/deletes live in
 * the backend. No spindle, no I/O here.
 */

export type ChapterVaultMode = 'off' | 'keyed' | 'constant';
export const DEFAULT_CHAPTER_VAULT: ChapterVaultMode = 'keyed';

/** A projectable summary carries detail worth shelving. */
export function projectable(state: ChronicleState): Memory[] {
  return state.memories.filter((m) => {
    if (!(m.tier === 'chapter' || m.tier === 'arc' || m.tier === 'book') || !(m.detail ?? m.text)) return false;
    if (m.status && m.status !== 'ready') return false;
    if (m.sourceHash && m.sourceHash !== memorySnapshotHash(m)) return false;
    if (m.subsumed?.length && m.coverageHash && m.coverageHash !== archiveCoverageHash(m.subsumed)) return false;
    return true;
  });
}

export function linkFor(m: Memory): string {
  const tier = m.tier === 'book' ? 'book' : m.tier === 'arc' ? 'arc' : 'chapter';
  return tier + ':' + m.id;
}

/** Entry settings for a hierarchical summary projection. Keyed entries fire on
 * a match; older, broader tiers sit deeper and at lower order. */
export function entrySettings(mode: ChapterVaultMode, tier: 'chapter' | 'arc' | 'book'): EntrySettings {
  return {
    position: 'at_depth',
    depth: tier === 'book' ? 8 : tier === 'arc' ? 6 : 4,
    role: 'system',
    order: tier === 'book' ? 20 : tier === 'arc' ? 40 : 60,
    constant: mode === 'constant',
  };
}

export interface ChapterEntryInput {
  link: string;
  key: string[];
  content: string;
  comment: string;
  category: 'summary'; // grouped under the vault "Summary" section; identity is the link
  settings: EntrySettings;
  hash: string;
}

/** Build the world-book entry input for a hierarchical summary's detail. */
export function planChapterEntry(m: Memory, mode: ChapterVaultMode): ChapterEntryInput {
  const tier = (m.tier === 'book' ? 'book' : m.tier === 'arc' ? 'arc' : 'chapter') as 'chapter' | 'arc' | 'book';
  const range = m.covers ? `turns ${m.covers[0]}\u2013${m.covers[1]}` : `turn ${m.turn}`;
  const label = (tier === 'book' ? 'Book' : tier === 'arc' ? 'Arc' : 'Chapter') + ' \u00b7 ' + range;
  return {
    link: linkFor(m),
    key: dedupeKeys([...(m.keys ?? []), ...deterministicKeys(m.detail ?? m.text ?? '')], 48),
    content: (m.detail ?? m.text ?? '').trim(),
    comment: label,
    category: 'summary',
    settings: entrySettings(mode, tier),
    hash: contentHash((m.detail ?? m.text ?? '').trim()),
  };
}

/** Lowercased, de-duplicated, trimmed keys (the form stored on the entry). */
export function dedupeKeys(keys: string[], limit = 16): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keys) {
    const t = String(k || '').trim();
    if (!t) continue;
    const low = t.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low); out.push(t);
  }
  return out.slice(0, limit);
}

/** Proper nouns, quoted labels and stable numbers augment model-supplied keys.
 * Model keys remain useful but can no longer be the sole route to old canon. */
export function deterministicKeys(text: string): string[] {
  const out: string[] = [];
  const quoted = text.match(/[“"]([^”"]{3,60})[”"]/g) ?? [];
  for (const q of quoted) out.push(q.replace(/^[“"]|[”"]$/g, ''));
  const names = text.match(/\b[\p{Lu}][\p{L}\p{M}'’-]{2,}(?:\s+[\p{Lu}][\p{L}\p{M}'’-]{2,}){0,3}\b/gu) ?? [];
  out.push(...names);
  return dedupeKeys(out, 24);
}

/**
 * Reconcile desired chapter/arc/book projections against existing VELLUM entries.
 * Returns the actions to
 * take. The event log (via `state`) is authoritative:
 *   - create:  a projectable memory with no live entry
 *   - update:  content/keys drifted from the memory (engine -> vault)
 *   - keySync: the USER edited the entry's keys -> pull them back to chronicle
 *   - remove:  an entry whose memory no longer exists (orphan)
 * Never touches non-VELLUM or unrelated entries.
 */
export interface ReconcilePlan {
  create: Array<{ memId: string; input: ChapterEntryInput }>;
  update: Array<{ entryId: string; memId: string; input: ChapterEntryInput }>;
  keySync: Array<{ memId: string; entryId: string; keys: string[] }>;
  remove: string[]; // entry ids
  conflicts: Array<{ entryId: string; memId: string; reason: 'body_changed' | 'user_override' }>;
}

export function reconcileChapterEntries(state: ChronicleState, entries: LiteEntry[], mode: ChapterVaultMode): ReconcilePlan {
  const plan: ReconcilePlan = { create: [], update: [], keySync: [], remove: [], conflicts: [] };
  if (mode === 'off') return plan; // caller decides whether to also tear down; default leave-as-is

  const mems = projectable(state);
  const byLink = new Map<string, LiteEntry>();
  for (const e of entries) {
    if (!e.vellum) continue;
    if (!/^(chapter|arc|book):/.test(e.link)) continue;
    byLink.set(e.link, e);
  }
  const wantedLinks = new Set<string>();

  for (const m of mems) {
    const link = linkFor(m);
    wantedLinks.add(link);
    const input = planChapterEntry(m, mode);
    const existing = byLink.get(link);
    if (!existing) { plan.create.push({ memId: m.id, input }); continue; }

    // KEY SYNC: if the user edited the entry's keys, pull them back so the
    // chronicle memory and the vault entry stay in lockstep (round-trip).
    const entryKeys = dedupeKeys(existing.key);
    const memKeys = dedupeKeys(m.keys ?? []);
    const keysWereEdited = existing.keyHash ? keywordHash(entryKeys) !== existing.keyHash : !keysEqual(entryKeys, input.key);
    if (keysWereEdited && !keysEqual(entryKeys, memKeys)) {
      plan.keySync.push({ memId: m.id, entryId: existing.id, keys: entryKeys });
    }

    // content/constant drift: push engine content only if the entry wasn't
    // hand-edited away from ours (respect a user-edited body; never clobber).
    const wantConstant = mode === 'constant';
    const contentDrift = existing.content.trim() !== input.content.trim();
    const constantDrift = existing.constant !== wantConstant;
    const userEditedBody = existing.bodyState === 'override' || (existing.overrideFields ?? []).includes('content')
      || (existing.bodyState == null && existing.source === 'manual');
    const conflictBody = existing.bodyState === 'conflict' || (existing.bodyState === 'legacy' && contentDrift);
    if (contentDrift && (userEditedBody || conflictBody)) {
      plan.conflicts.push({ entryId: existing.id, memId: m.id, reason: userEditedBody ? 'user_override' : 'body_changed' });
    } else if (contentDrift || constantDrift || !existing.hash || (!keysWereEdited && !keysEqual(entryKeys, input.key))) {
      plan.update.push({ entryId: existing.id, memId: m.id, input });
    }
  }

  // Orphans: VELLUM summary entries whose canonical memory is gone.
  for (const [link, e] of byLink) {
    if (!wantedLinks.has(link)) {
      const protectedBody = e.bodyState === 'override' || e.bodyState === 'conflict' || e.bodyState === 'legacy' || (e.overrideFields ?? []).includes('content');
      if (protectedBody) plan.conflicts.push({ entryId: e.id, memId: link.slice(link.indexOf(':') + 1), reason: e.bodyState === 'override' ? 'user_override' : 'body_changed' });
      else plan.remove.push(e.id);
    }
  }
  return plan;
}

function keysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = a.map((x) => x.toLowerCase()).sort();
  const sb = b.map((x) => x.toLowerCase()).sort();
  return sa.every((x, i) => x === sb[i]);
}
