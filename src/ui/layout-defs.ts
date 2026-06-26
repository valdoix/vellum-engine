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

// --- Custom layout (user-built: order + visibility + collapse) -----------
const CUSTOM_KEY = 'vellum2.layout.custom';
const SECTION_LABEL: Record<SectionId, string> = {
  status: 'Status', present: 'Present', tension: 'Tension', relations: 'Relations',
  threads: 'Threads', parallel: 'Parallel', recent: 'Latest',
};

function loadCustom(): LayoutDef {
  const base: LayoutDef = { id: 'custom', name: 'Custom', blurb: 'Your own arrangement.', glyph: '\u270E', order: [...ALL], hidden: [], collapsed: [], density: 'comfortable', columns: 1 };
  try { const c = JSON.parse(localStorage.getItem(CUSTOM_KEY) || ''); if (c && Array.isArray(c.order)) return { ...base, ...c, id: 'custom', name: 'Custom' }; } catch { /* default */ }
  return base;
}
let _custom: LayoutDef = loadCustom();
function saveCustom(): void { try { localStorage.setItem(CUSTOM_KEY, JSON.stringify({ order: _custom.order, hidden: _custom.hidden, collapsed: _custom.collapsed, density: _custom.density, columns: _custom.columns })); } catch { /* ignore */ } }

export const LAYOUTS_WITH_CUSTOM = (): LayoutDef[] => [...LAYOUTS, _custom];

const KEY = 'vellum2.layout';
let _id: string = load();
function load(): string { try { return localStorage.getItem(KEY) || 'dashboard'; } catch { return 'dashboard'; } }
export function setLayout(id: string): void { if (id === 'custom' || LAYOUTS.some((l) => l.id === id)) { _id = id; try { localStorage.setItem(KEY, id); } catch { /* ignore */ } } }
export function getLayout(): LayoutDef { return _id === 'custom' ? _custom : (LAYOUTS.find((l) => l.id === _id) ?? LAYOUTS[0]!); }
export function currentLayoutId(): string { return _id; }

/** Picker tiles (presets + Custom), separate from the skin gallery. */
export function layoutPanel(): string {
  const tiles = LAYOUTS_WITH_CUSTOM().map((l) =>
    `<button class="vle-lay${_id === l.id ? ' on' : ''}" data-layout-pick="${l.id}" title="${l.blurb}">`
    + `<span class="vle-lay-g">${l.glyph}</span><span class="vle-lay-n">${l.name}</span></button>`
  ).join('');
  return '<div class="vle-cz-h">Layout</div><div class="vle-lays">' + tiles + '</div>';
}

/** Editor for the Custom layout: each section with up/down, show/hide, fold. */
export function customLayoutEditor(): string {
  if (_id !== 'custom') return '<div class="vle-cz-note">Pick <b>Custom</b> above to arrange sections yourself.</div>';
  const rows = _custom.order.map((id, i) => {
    const hidden = _custom.hidden.includes(id);
    const folded = _custom.collapsed.includes(id);
    return `<div class="vle-clr${hidden ? ' off' : ''}" data-clay-row="${id}">`
      + `<span class="vle-clr-up" data-clay="up" data-id="${id}" ${i === 0 ? 'data-dis' : ''}>\u25B4</span>`
      + `<span class="vle-clr-dn" data-clay="dn" data-id="${id}" ${i === _custom.order.length - 1 ? 'data-dis' : ''}>\u25BE</span>`
      + `<span class="vle-clr-n">${SECTION_LABEL[id]}</span>`
      + `<button class="vle-clr-b${folded ? ' on' : ''}" data-clay="fold" data-id="${id}" title="Collapsed by default">fold</button>`
      + `<button class="vle-clr-b${hidden ? '' : ' on'}" data-clay="show" data-id="${id}" title="Visible">${hidden ? 'hidden' : 'shown'}</button>`
      + '</div>';
  }).join('');
  const dens = ['compact', 'comfortable', 'roomy'].map((d) => `<option value="${d}"${_custom.density === d ? ' selected' : ''}>${d}</option>`).join('');
  return '<div class="vle-cz-h">Arrange sections</div><div class="vle-clays">' + rows + '</div>'
    + `<div class="vle-cz-row"><span class="vle-cz-mini">Density</span><select class="vle-cz-sel" data-clay="density">${dens}</select>`
    + `<label class="vle-cz-chk"><input type="checkbox" data-clay="cols"${_custom.columns === 2 ? ' checked' : ''}> 2-col</label></div>`;
}

/** Handle a click inside the custom-layout editor (delegated from theme.ts). */
export function handleCustomLayoutClick(t: HTMLElement): void {
  const el = t.closest('[data-clay]'); if (!el) return;
  const op = el.getAttribute('data-clay'); const id = el.getAttribute('data-id') as SectionId | null;
  if (op === 'up' && id && !el.hasAttribute('data-dis')) { const i = _custom.order.indexOf(id); if (i > 0) { const o = [..._custom.order]; [o[i - 1], o[i]] = [o[i]!, o[i - 1]!]; _custom.order = o; } }
  else if (op === 'dn' && id && !el.hasAttribute('data-dis')) { const i = _custom.order.indexOf(id); if (i < _custom.order.length - 1) { const o = [..._custom.order]; [o[i + 1], o[i]] = [o[i]!, o[i + 1]!]; _custom.order = o; } }
  else if (op === 'show' && id) { _custom.hidden = _custom.hidden.includes(id) ? _custom.hidden.filter((x) => x !== id) : [..._custom.hidden, id]; }
  else if (op === 'fold' && id) { _custom.collapsed = _custom.collapsed.includes(id) ? _custom.collapsed.filter((x) => x !== id) : [..._custom.collapsed, id]; }
  else if (op === 'density') { _custom.density = (t as HTMLSelectElement).value as Density; }
  else if (op === 'cols') { _custom.columns = (t as HTMLInputElement).checked ? 2 : 1; }
  saveCustom();
}

/** Handle the density/cols change events (delegated). */
export function handleCustomLayoutChange(t: HTMLElement): void { handleCustomLayoutClick(t); }

