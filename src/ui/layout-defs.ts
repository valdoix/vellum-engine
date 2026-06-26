/**
 * Float-window LAYOUTS — structure only (which sections show, order, density,
 * columns, collapsed). Orthogonal to skins (look) and scale (size). Persisted
 * alongside the theme. A layout is a pure descriptor; dashboard.ts composes the
 * section functions by id.
 */

export type SectionId = 'status' | 'present' | 'tension' | 'relations' | 'threads' | 'parallel' | 'recent';
export type Density = 'compact' | 'comfortable' | 'roomy';

export interface LayoutDef {
  id: string;
  name: string;
  blurb: string;
  glyph: string;        // tiny wireframe-ish mark for the picker tile
  order: SectionId[];
  hidden: SectionId[];
  collapsed: SectionId[];
  density: Density;
  columns: 1 | 2;
}

const ALL: SectionId[] = ['status', 'present', 'tension', 'relations', 'threads', 'parallel', 'recent'];

export const LAYOUTS: LayoutDef[] = [
  {
    id: 'dashboard', name: 'Dashboard', blurb: 'Everything, comfortably — the default.', glyph: '\u2637',
    order: ['status', 'present', 'tension', 'relations', 'threads', 'parallel', 'recent'],
    hidden: [], collapsed: [], density: 'comfortable', columns: 1,
  },
  {
    id: 'scene', name: 'Scene Focus', blurb: 'The living moment — present cast & tension up top, the rest tucked away.', glyph: '\u25C9',
    order: ['present', 'tension', 'status', 'relations', 'parallel', 'recent', 'threads'],
    hidden: [], collapsed: ['parallel', 'recent', 'threads'], density: 'comfortable', columns: 1,
  },
  {
    id: 'director', name: 'Director', blurb: 'Plot at a glance — threads & off-screen beside the cast (2-col when wide).', glyph: '\u2630',
    order: ['status', 'threads', 'parallel', 'present', 'relations', 'recent'],
    hidden: [], collapsed: [], density: 'comfortable', columns: 2,
  },
  {
    id: 'hud', name: 'Compact HUD', blurb: 'Dense always-on pulse beside the chat.', glyph: '\u25A4',
    order: ['status', 'present', 'tension', 'relations', 'threads', 'parallel', 'recent'],
    hidden: [], collapsed: ['relations', 'threads', 'parallel', 'recent'], density: 'compact', columns: 1,
  },
  {
    id: 'ledger', name: 'Ledger', blurb: 'A tall reading column — prose-first, journal-like.', glyph: '\u2261',
    order: ['status', 'present', 'recent', 'relations', 'threads', 'parallel', 'tension'],
    hidden: [], collapsed: [], density: 'roomy', columns: 1,
  },
  {
    id: 'minimal', name: 'Minimal', blurb: 'Just the live scene pulse.', glyph: '\u25CB',
    order: ['status', 'present', 'tension'],
    hidden: ['relations', 'threads', 'parallel', 'recent'], collapsed: [], density: 'comfortable', columns: 1,
  },
];

void ALL;

const KEY = 'vellum2.layout';
let _id: string = load();
function load(): string {
  try { return localStorage.getItem(KEY) || 'dashboard'; } catch { return 'dashboard'; }
}
export function setLayout(id: string): void {
  if (LAYOUTS.some((l) => l.id === id)) { _id = id; try { localStorage.setItem(KEY, id); } catch { /* ignore */ } }
}
export function getLayout(): LayoutDef {
  return LAYOUTS.find((l) => l.id === _id) ?? LAYOUTS[0]!;
}
export function currentLayoutId(): string { return _id; }

/** Picker tiles for the Customize panel (separate from the skin gallery). */
export function layoutPanel(): string {
  const tiles = LAYOUTS.map((l) =>
    `<button class="vle-lay${_id === l.id ? ' on' : ''}" data-layout-pick="${l.id}" title="${l.blurb}">`
    + `<span class="vle-lay-g">${l.glyph}</span><span class="vle-lay-n">${l.name}</span></button>`
  ).join('');
  return '<div class="vle-cz-h">Layout</div><div class="vle-lays">' + tiles + '</div>';
}
