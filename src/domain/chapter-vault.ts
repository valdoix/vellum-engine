import type { ChronicleState, Memory } from './types.js';
import type { EntrySettings } from './vault.js';
import type { LiteEntry } from '../host/worldbooks.js';

/**
 * Hybrid chapter memory — the VAULT projection (pure planning half).
 *
 * A chapter/arc memory's DETAILED summary is mirrored to a world-book entry so
 * the host's world-info system can inject it on keyword relevance, OUTSIDE
 * VELLUM's recall budget. The chronicle keeps only the lean gist (memory.text).
 * The event log stays the source of truth; the vault entry is a reconciled
 * projection keyed by `link = chapter:<id>` / `arc:<id>`.
 *
 * PURE: builds entry inputs + reconcile diffs; the host writes/deletes live in
 * the backend. No spindle, no I/O here.
 */

export type ChapterVaultMode = 'off' | 'keyed' | 'constant';
export const DEFAULT_CHAPTER_VAULT: ChapterVaultMode = 'keyed';

/** A projectable memory = a chapter or arc that carries detail worth shelving. */
export function projectable(state: ChronicleState): Memory[] {
  return state.memories.filter((m) => (m.tier === 'chapter' || m.tier === 'arc') && !!(m.detail ?? m.text));
}

export function linkFor(m: Memory): string { return (m.tier === 'arc' ? 'arc:' : 'chapter:') + m.id; }

/** Entry settings for a chapter/arc projection. Keyed entries fire on a key
 * match (depth injection); constant entries are always present. Arcs sit broader
 * and lower-priority than chapters (older, more compressed). */
export function entrySettings(mode: ChapterVaultMode, tier: 'chapter' | 'arc'): EntrySettings {
  return {
    position: 'at_depth',
    depth: tier === 'arc' ? 6 : 4,
    role: 'system',
    order: tier === 'arc' ? 40 : 60, // chapters slightly ahead of arcs
    constant: mode === 'constant',
  };
}

export interface ChapterEntryInput {
  link: string;
  key: string[];
  content: string;
  comment: string;
  category: 'chapter' | 'arc';
  settings: EntrySettings;
}

/** Build the world-book entry input for a chapter/arc memory's detail. */
export function planChapterEntry(m: Memory, mode: ChapterVaultMode): ChapterEntryInput {
  const tier = (m.tier === 'arc' ? 'arc' : 'chapter') as 'chapter' | 'arc';
  const range = m.covers ? `turns ${m.covers[0]}\u2013${m.covers[1]}` : `turn ${m.turn}`;
  const label = (tier === 'arc' ? 'Arc' : 'Chapter') + ' \u00b7 ' + range;
  return {
    link: linkFor(m),
    key: dedupeKeys(m.keys ?? []),
    content: (m.detail ?? m.text ?? '').trim(),
    comment: label,
    category: tier,
    settings: entrySettings(mode, tier),
  };
}

/** Lowercased, de-duplicated, trimmed keys (the form stored on the entry). */
export function dedupeKeys(keys: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keys) {
    const t = String(k || '').trim();
    if (!t) continue;
    const low = t.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low); out.push(t);
  }
  return out.slice(0, 16);
}

/**
 * Reconcile the desired chapter/arc projections against the vault entries that
 * currently exist (VELLUM-tagged, link chapter: or arc:). Returns the actions to
 * take. The event log (via `state`) is authoritative:
 *   - create:  a projectable memory with no live entry
 *   - update:  content/keys drifted from the memory (engine -> vault)
 *   - keySync: the USER edited the entry's keys -> pull them back to chronicle
 *   - remove:  an entry whose memory no longer exists (orphan)
 * Never touches non-VELLUM or non-chapter/arc entries.
 */
export interface ReconcilePlan {
  create: Array<{ memId: string; input: ChapterEntryInput }>;
  update: Array<{ entryId: string; memId: string; input: ChapterEntryInput }>;
  keySync: Array<{ memId: string; entryId: string; keys: string[] }>;
  remove: string[]; // entry ids
}

export function reconcileChapterEntries(state: ChronicleState, entries: LiteEntry[], mode: ChapterVaultMode): ReconcilePlan {
  const plan: ReconcilePlan = { create: [], update: [], keySync: [], remove: [] };
  if (mode === 'off') return plan; // caller decides whether to also tear down; default leave-as-is

  const mems = projectable(state);
  const byLink = new Map<string, LiteEntry>();
  for (const e of entries) {
    if (!e.vellum) continue;
    if (!/^(chapter|arc):/.test(e.link)) continue;
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
    if (!keysEqual(entryKeys, memKeys)) {
      // entry is the user-facing surface — trust its keys, sync chronicle to them
      plan.keySync.push({ memId: m.id, entryId: existing.id, keys: entryKeys });
    }

    // content/constant drift: push engine content only if the entry wasn't
    // hand-edited away from ours (respect a user-edited body; never clobber).
    const wantConstant = mode === 'constant';
    const contentDrift = existing.content.trim() !== input.content.trim();
    const constantDrift = existing.constant !== wantConstant;
    const userEditedBody = existing.source && existing.source !== 'chapter' && existing.source !== 'sync';
    if ((contentDrift && !userEditedBody) || constantDrift) {
      plan.update.push({ entryId: existing.id, memId: m.id, input });
    }
  }

  // orphans: VELLUM chapter/arc entries whose memory is gone
  for (const [link, e] of byLink) {
    if (!wantedLinks.has(link)) plan.remove.push(e.id);
  }
  return plan;
}

function keysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = a.map((x) => x.toLowerCase()).sort();
  const sb = b.map((x) => x.toLowerCase()).sort();
  return sa.every((x, i) => x === sb[i]);
}
