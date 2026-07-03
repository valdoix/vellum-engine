import type { ChronicleState, Faction } from './types.js';
import type { EntrySettings } from './vault.js';
import type { LiteEntry } from '../host/worldbooks.js';
import type { ChapterVaultMode } from './chapter-vault.js';
import { dedupeKeys } from './chapter-vault.js';

/**
 * Faction VAULT projection (pure). Each tracked faction becomes a keyword-
 * activated world-book "group lore sheet" — roster + standing + note — injected
 * by the host's world-info when the scene names the group, OUTSIDE the recall
 * budget. Keyed by `link = faction:<id>`. Same reconcile discipline + boundary
 * as the chapter-vault: only touches VELLUM-tagged `faction:` entries.
 */

export interface FactionEntryInput {
  link: string;
  key: string[];
  content: string;
  comment: string;
  category: 'factions';
  settings: EntrySettings;
}

export interface FactionReconcilePlan {
  create: Array<{ facId: string; input: FactionEntryInput }>;
  update: Array<{ entryId: string; facId: string; input: FactionEntryInput }>;
  remove: string[];
}

function settings(mode: ChapterVaultMode): EntrySettings {
  return { position: 'at_depth', depth: 5, role: 'system', order: 50, constant: mode === 'constant' };
}

function standingWord(n: number): string {
  if (n >= 40) return 'devoted'; if (n >= 15) return 'friendly';
  if (n > -15) return 'neutral'; if (n > -40) return 'wary'; return 'hostile';
}

/** Build the group lore-sheet entry from a faction + its membership roster. */
export function planFactionEntry(state: ChronicleState, f: Faction): FactionEntryInput {
  const members = state.memberships
    .filter((m) => m.faction === f.id)
    .map((m) => (state.cast[m.char]?.name ?? m.char) + (m.role ? ` (${m.role})` : ''));
  const seatName = f.seat ? (state.locations.find((l) => l.id === f.seat)?.name ?? f.seat) : '';
  const facName = (id: string): string => state.factions[id]?.name ?? id.replace(/^fac:/, '');
  const rels = (state.factionRelations ?? []).filter((r) => r.a === f.id).map((r) => `${r.kind} with ${facName(r.b)}${r.standing ? ` (${r.standing})` : ''}`);
  const lines = [
    f.kind ? `Kind: ${f.kind}.` : '',
    seatName ? `Seat: ${seatName}.` : '',
    `Standing toward the player: ${standingWord(f.standing)} (${f.standing}${f.trust ? `, trust ${f.trust}` : ''}).`,
    rels.length ? `Relations: ${rels.join('; ')}.` : '',
    members.length ? `Members: ${members.join(', ')}.` : '',
    f.note ? f.note : '',
  ].filter(Boolean);
  // keys: the name + aka + each member's name + the seat name (so a scene naming a
  // member OR the seat location can pull the group sheet too)
  const memberNames = state.memberships.filter((m) => m.faction === f.id).map((m) => state.cast[m.char]?.name ?? m.char);
  return {
    link: 'faction:' + f.id,
    key: dedupeKeys([f.name, ...(f.aka ?? []), ...memberNames, ...(seatName ? [seatName] : [])]),
    content: lines.join(' ').trim(),
    comment: 'Faction \u00b7 ' + f.name,
    category: 'factions',
    settings: settings('keyed'),
  };
}

/** A faction worth projecting: tracked (not just 'added') with some substance. */
function projectableFactions(state: ChronicleState): Faction[] {
  return Object.values(state.factions).filter((f) => f.status !== 'added' || (f.note || state.memberships.some((m) => m.faction === f.id)));
}

export function reconcileFactionEntries(state: ChronicleState, entries: LiteEntry[], mode: ChapterVaultMode): FactionReconcilePlan {
  const plan: FactionReconcilePlan = { create: [], update: [], remove: [] };
  if (mode === 'off') return plan;
  const facs = projectableFactions(state);
  const byLink = new Map<string, LiteEntry>();
  for (const e of entries) { if (e.vellum && /^faction:/.test(e.link)) byLink.set(e.link, e); }
  const wanted = new Set<string>();
  for (const f of facs) {
    const input = planFactionEntry(state, f);
    wanted.add(input.link);
    const existing = byLink.get(input.link);
    if (!existing) { plan.create.push({ facId: f.id, input }); continue; }
    const wantConstant = mode === 'constant';
    const userEditedBody = existing.source && existing.source !== 'faction' && existing.source !== 'sync';
    if ((existing.content.trim() !== input.content.trim() && !userEditedBody) || existing.constant !== wantConstant) {
      plan.update.push({ entryId: existing.id, facId: f.id, input });
    }
  }
  for (const [link, e] of byLink) if (!wanted.has(link)) plan.remove.push(e.id);
  return plan;
}
