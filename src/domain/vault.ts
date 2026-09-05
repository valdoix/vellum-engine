/** Vault categories and the mapping from friendly settings to host fields. */
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
export type SyncSource =
  | 'cast' | 'relations' | 'factions' | 'locations' | 'items'
  | 'knowledge' | 'secrets' | 'memories' | 'threads' | 'journal'
  | 'scars' | 'lore' | 'timeline';
export const SYNC_SOURCES: readonly SyncSource[] = [
  'cast', 'relations', 'factions', 'locations', 'items', 'knowledge', 'secrets',
  'memories', 'threads', 'journal', 'scars', 'lore', 'timeline',
];
export function isSyncSource(value: unknown): value is SyncSource {
  return typeof value === 'string' && (SYNC_SOURCES as readonly string[]).includes(value);
}

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
/** Kept for import compatibility; current Spindle accepts the role string. */
export const ROLE_CODE: Record<WBRole, number> = { system: 0, user: 1, assistant: 2 };

export function settingsToEntryFields(s: EntrySettings): Record<string, unknown> {
  const out: Record<string, unknown> = {
    position: POSITION_CODE[s.position],
    role: s.role,
    order_value: s.order,
  };
  if (s.position === 'at_depth' && typeof s.depth === 'number') out.depth = s.depth;
  if (typeof s.priority === 'number') out.priority = s.priority;
  if (typeof s.constant === 'boolean') out.constant = s.constant;
  if (typeof s.sticky === 'number') out.sticky = s.sticky;
  if (typeof s.cooldown === 'number') out.cooldown = s.cooldown;
  if (typeof s.delay === 'number') out.delay = s.delay;
  return out;
}

const sys = (o: Partial<EntrySettings> & Pick<EntrySettings, 'position' | 'order'>): EntrySettings =>
  ({ role: 'system', ...o });

export const DEFAULT_CATEGORIES: VaultCategory[] = [
  { id: 'characters', label: 'Characters', glyph: '\u263A', color: '#cda84e', builtin: true, hidden: false, sync: 'promote', source: 'cast', defaults: sys({ position: 'at_depth', depth: 4, order: 100, sticky: 2 }) },
  { id: 'locations', label: 'Locations', glyph: '\u2302', color: '#8fa67e', builtin: true, hidden: false, sync: 'off', source: 'locations', defaults: sys({ position: 'before_main', order: 50, sticky: 3 }) },
  { id: 'factions', label: 'Factions', glyph: '\u2691', color: '#c97a9a', builtin: true, hidden: false, sync: 'off', source: 'factions', defaults: sys({ position: 'before_main', order: 60 }) },
  { id: 'creatures', label: 'Creatures', glyph: '\u273F', color: '#6fb0a6', builtin: true, hidden: false, sync: 'off', defaults: sys({ position: 'at_depth', depth: 4, order: 100, sticky: 1 }) },
  { id: 'items', label: 'Items & Artifacts', glyph: '\u2756', color: '#d8a05a', builtin: true, hidden: false, sync: 'off', source: 'items', defaults: sys({ position: 'at_depth', depth: 2, order: 120, sticky: 4 }) },
  { id: 'concepts', label: 'Concepts & Lore', glyph: '\u2767', color: '#7ea6b0', builtin: true, hidden: false, sync: 'off', source: 'lore', defaults: sys({ position: 'before_main', order: 30 }) },
  { id: 'systems', label: 'Systems & Rules', glyph: '\u2699', color: '#b48ed0', builtin: true, hidden: false, sync: 'off', defaults: sys({ position: 'after_main', order: 40, constant: true }) },
  { id: 'events', label: 'Events & Timeline', glyph: '\u29D6', color: '#c96a6a', builtin: true, hidden: false, sync: 'off', source: 'timeline', defaults: sys({ position: 'at_depth', depth: 1, order: 200 }) },
  { id: 'relationships', label: 'Relationships', glyph: '\u29AF', color: '#cdbfa0', builtin: true, hidden: false, sync: 'off', source: 'relations', defaults: sys({ position: 'at_depth', depth: 3, order: 90, sticky: 2 }) },
  { id: 'summary', label: 'Summary', glyph: '\u269C', color: '#b9a06a', builtin: true, hidden: false, sync: 'off', source: 'memories', defaults: sys({ position: 'at_depth', depth: 4, order: 60 }) },
  { id: 'knowledge', label: 'Knowledge', glyph: '\u25C8', color: '#84a9c0', builtin: true, hidden: false, sync: 'off', source: 'knowledge', defaults: sys({ position: 'at_depth', depth: 3, order: 105, sticky: 1 }) },
  { id: 'secrets', label: 'Secrets', glyph: '\u26C0', color: '#a9789d', builtin: true, hidden: false, sync: 'off', source: 'secrets', defaults: sys({ position: 'at_depth', depth: 2, order: 130, sticky: 1 }) },
  { id: 'journal', label: 'Character Memory', glyph: '\u270E', color: '#b68f6a', builtin: true, hidden: false, sync: 'off', source: 'journal', defaults: sys({ position: 'at_depth', depth: 3, order: 95, sticky: 2 }) },
  { id: 'scars', label: 'Scars', glyph: '\u2620', color: '#b56f6f', builtin: true, hidden: false, sync: 'off', source: 'scars', defaults: sys({ position: 'at_depth', depth: 2, order: 115, sticky: 2 }) },
  { id: 'threads', label: 'Threads & Arcs', glyph: '\u29AF', color: '#9b8ec4', builtin: true, hidden: false, sync: 'off', source: 'threads', defaults: sys({ position: 'at_depth', depth: 2, order: 125, sticky: 1 }) },
];

export function customCategory(id: string, label: string, glyph: string, color: string): VaultCategory {
  return { id, label, glyph, color, builtin: false, hidden: false, sync: 'off', defaults: sys({ position: 'at_depth', depth: 4, order: 100 }) };
}

export function resolveCategory(cats: VaultCategory[], id: string | undefined): VaultCategory {
  return cats.find((c) => c.id === id) ?? cats[0] ?? DEFAULT_CATEGORIES[0]!;
}
