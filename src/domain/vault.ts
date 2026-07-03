/**
 * Vault domain: categories + per-category auto-settings, and the mapping from
 * our friendly settings to the host world_books entry fields. Pure + tested.
 *
 * The Vault delegates ALL activation to the host's World Info engine; this
 * module only decides HOW a new entry of a given category is configured, so the
 * user can author lore without hand-tuning ~18 fields per entry.
 */

export type WBPosition =
  | 'before_main' | 'after_main' | 'before_an' | 'after_an'
  | 'at_depth' | 'before_examples' | 'after_examples';

export type WBRole = 'system' | 'user' | 'assistant';

export interface EntrySettings {
  position: WBPosition;
  depth?: number;
  role: WBRole;
  order: number;
  priority?: number;
  constant?: boolean;
  sticky?: number;
  cooldown?: number;
  delay?: number;
}

export type SyncMode = 'off' | 'promote' | 'sync' | 'auto';
export type SyncSource = 'cast' | 'relations' | 'secrets' | 'memories' | 'threads';

export interface VaultCategory {
  id: string;
  label: string;
  glyph: string;
  color: string;
  builtin: boolean;
  hidden: boolean;
  defaults: EntrySettings;
  sync: SyncMode;
  source?: SyncSource;
}

/** Host position code (0–6) used by the world_books API. */
export const POSITION_CODE: Record<WBPosition, number> = {
  before_main: 0, after_main: 1, before_an: 2, after_an: 3,
  at_depth: 4, before_examples: 5, after_examples: 6,
};
export const ROLE_CODE: Record<WBRole, number> = { system: 0, user: 1, assistant: 2 };

/**
 * Map our friendly EntrySettings → the host world_books entry payload fields.
 * Kept in one place so the field names live here and nowhere else.
 */
export function settingsToEntryFields(s: EntrySettings): Record<string, unknown> {
  const out: Record<string, unknown> = {
    position: POSITION_CODE[s.position],
    role: ROLE_CODE[s.role],
    order_value: s.order,
  };
  if (s.position === 'at_depth' && typeof s.depth === 'number') out.depth = s.depth;
  if (typeof s.priority === 'number') out.priority = s.priority;
  if (s.constant) out.constant = true;
  if (s.sticky) out.sticky = s.sticky;
  if (s.cooldown) out.cooldown = s.cooldown;
  if (s.delay) out.delay = s.delay;
  return out;
}

const sys = (o: Partial<EntrySettings> & Pick<EntrySettings, 'position' | 'order'>): EntrySettings =>
  ({ role: 'system', ...o });

/**
 * Default categories with their auto-settings. The wisdom the docs encode:
 * broad/static world framing goes before_main at low order; specific/urgent/
 * active info goes shallow-depth with high order; persistent things get sticky.
 */
export const DEFAULT_CATEGORIES: VaultCategory[] = [
  { id: 'characters', label: 'Characters', glyph: '\u263A', color: '#cda84e', builtin: true, hidden: false, sync: 'promote', source: 'cast', defaults: sys({ position: 'at_depth', depth: 4, order: 100, sticky: 2 }) },
  { id: 'locations', label: 'Locations', glyph: '\u2302', color: '#8fa67e', builtin: true, hidden: false, sync: 'off', defaults: sys({ position: 'before_main', order: 50, sticky: 3 }) },
  { id: 'factions', label: 'Factions', glyph: '\u2691', color: '#c97a9a', builtin: true, hidden: false, sync: 'off', defaults: sys({ position: 'before_main', order: 60 }) },
  { id: 'creatures', label: 'Creatures', glyph: '\u273F', color: '#6fb0a6', builtin: true, hidden: false, sync: 'off', defaults: sys({ position: 'at_depth', depth: 4, order: 100, sticky: 1 }) },
  { id: 'items', label: 'Items & Artifacts', glyph: '\u2756', color: '#d8a05a', builtin: true, hidden: false, sync: 'off', defaults: sys({ position: 'at_depth', depth: 2, order: 120, sticky: 4 }) },
  { id: 'concepts', label: 'Concepts & Lore', glyph: '\u2767', color: '#7ea6b0', builtin: true, hidden: false, sync: 'off', defaults: sys({ position: 'before_main', order: 30 }) },
  { id: 'systems', label: 'Systems & Rules', glyph: '\u2699', color: '#b48ed0', builtin: true, hidden: false, sync: 'off', defaults: sys({ position: 'after_main', order: 40, constant: true }) },
  { id: 'events', label: 'Events & Timeline', glyph: '\u29D6', color: '#c96a6a', builtin: true, hidden: false, sync: 'off', source: 'threads', defaults: sys({ position: 'at_depth', depth: 1, order: 200 }) },
  { id: 'relationships', label: 'Relationships', glyph: '\u29AF', color: '#cdbfa0', builtin: true, hidden: false, sync: 'off', source: 'relations', defaults: sys({ position: 'at_depth', depth: 3, order: 90, sticky: 2 }) },
  { id: 'summary', label: 'Summary', glyph: '\u269C', color: '#b9a06a', builtin: true, hidden: false, sync: 'off', defaults: sys({ position: 'at_depth', depth: 4, order: 60 }) },
];

export function customCategory(id: string, label: string, glyph: string, color: string): VaultCategory {
  return { id, label, glyph, color, builtin: false, hidden: false, sync: 'off', defaults: sys({ position: 'at_depth', depth: 4, order: 100 }) };
}

/** Resolve a category by id, falling back to a neutral default. */
export function resolveCategory(cats: VaultCategory[], id: string | undefined): VaultCategory {
  return cats.find((c) => c.id === id) ?? cats[0] ?? DEFAULT_CATEGORIES[0]!;
}
