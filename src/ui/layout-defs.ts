/**
 * Float-window LAYOUTS — structure only (which sections show, order, density,
 * columns, collapsed). Orthogonal to skins (look) and scale (size). Persisted
 * alongside the theme. A layout is a pure descriptor; dashboard.ts composes the
 * section functions by id.
 */

export type SectionId = 'status' | 'present' | 'tension' | 'relations' | 'threads' | 'parallel' | 'recent' | 'stats';
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
  mode?: 'stack' | 'switch'; // 'stack' (default) = vertical sections; 'switch' = one section + a dock (phone)
}

const ALL: SectionId[] = ['status', 'present', 'tension', 'relations', 'threads', 'parallel', 'recent', 'stats'];

export const LAYOUTS: LayoutDef[] = [
  {
    id: 'dashboard', name: 'Dashboard', blurb: 'Everything, comfortably — the default.', glyph: '\u2637',
    order: ['status', 'present', 'tension', 'relations', 'threads', 'parallel', 'recent', 'stats'],
    hidden: [], collapsed: [], density: 'comfortable', columns: 1,
  },
  {
    id: 'scene', name: 'Scene Focus', blurb: 'The living moment — present cast & tension up top, the rest tucked away.', glyph: '\u25C9',
    order: ['present', 'tension', 'status', 'relations', 'parallel', 'recent', 'threads', 'stats'],
    hidden: [], collapsed: ['parallel', 'recent', 'threads', 'stats'], density: 'comfortable', columns: 1,
  },
  {
    id: 'director', name: 'Director', blurb: 'Plot at a glance — threads & off-screen beside the cast (2-col when wide).', glyph: '\u2630',
    order: ['status', 'threads', 'parallel', 'present', 'relations', 'recent', 'stats'],
    hidden: [], collapsed: [], density: 'comfortable', columns: 2,
  },
  {
    id: 'hud', name: 'Compact HUD', blurb: 'Dense always-on pulse beside the chat.', glyph: '\u25A4',
    order: ['status', 'present', 'tension', 'relations', 'threads', 'parallel', 'recent'],
    hidden: [], collapsed: ['relations', 'threads', 'parallel', 'recent'], density: 'compact', columns: 1,
  },
  {
    id: 'ledger', name: 'Ledger', blurb: 'A tall reading column — prose-first, journal-like.', glyph: '\u2261',
    order: ['status', 'present', 'recent', 'relations', 'threads', 'parallel', 'tension', 'stats'],
    hidden: [], collapsed: [], density: 'roomy', columns: 1,
  },
  {
    id: 'minimal', name: 'Minimal', blurb: 'Just the live scene pulse.', glyph: '\u25CB',
    order: ['status', 'present', 'tension'],
    hidden: ['relations', 'threads', 'parallel', 'recent'], collapsed: [], density: 'comfortable', columns: 1,
  },
  // --- form layouts: pair with a chrome to make the float an OBJECT ---
  {
    id: 'codex', name: 'Codex', blurb: 'An open book \u2014 two facing pages (illuminated chrome).', glyph: '\uD83D\uDCD6',
    order: ['present', 'tension', 'status', 'threads', 'parallel', 'relations', 'recent', 'stats'],
    hidden: [], collapsed: [], density: 'comfortable', columns: 2,
  },
  {
    id: 'scroll', name: 'Scroll', blurb: 'A single unfurled parchment \u2014 one tall column.', glyph: '\u07F7',
    order: ['status', 'present', 'tension', 'threads', 'relations', 'parallel', 'recent', 'stats'],
    hidden: [], collapsed: [], density: 'roomy', columns: 1,
  },
  {
    id: 'phone', name: 'Phone', blurb: 'A device \u2014 one panel at a time with a bottom dock (modern chrome).', glyph: '\u25AF',
    order: ['present', 'status', 'tension', 'relations', 'threads', 'parallel', 'recent'],
    hidden: [], collapsed: [], density: 'comfortable', columns: 1, mode: 'switch',
  },
  // --- "Now" layouts (mockups 25/26/28): the live scene as a composed page.
  // All three reuse the 8-section registry; only order + CSS (keyed on
  // data-layout) differ, so no new sections and no engine change.
  {
    id: 'livingpage', name: 'Living Page', blurb: 'The scene as an illuminated page \u2014 full-bleed header, thoughts as pull-quotes, bonds as a diverging meter (default/fantasy chrome).', glyph: '\u2748',
    order: ['status', 'tension', 'present', 'relations', 'threads', 'parallel', 'recent', 'stats'],
    hidden: [], collapsed: [], density: 'roomy', columns: 1,
  },
  {
    id: 'orrery', name: 'Orrery HUD', blurb: 'A living-system readout \u2014 scene at the core, present cast orbiting, tension as a corona (futuristic/ember chrome).', glyph: '\u2609',
    order: ['status', 'tension', 'present', 'relations', 'threads', 'parallel', 'recent', 'stats'],
    hidden: [], collapsed: [], density: 'comfortable', columns: 1,
  },
  {
    id: 'openbook', name: 'Open Book', blurb: 'A two-leaf spread \u2014 the world on the left page, the players on the right (fantasy/parchment chrome).', glyph: '\uD83D\uDCD6',
    order: ['status', 'tension', 'threads', 'parallel', 'stats', 'present', 'relations', 'recent'],
    hidden: [], collapsed: [], density: 'comfortable', columns: 2,
  },
];

void ALL;

// --- Custom layout (user-built: order + visibility + collapse) -----------
const CUSTOM_KEY = 'vellum2.layout.custom';
const SECTION_LABEL: Record<SectionId, string> = {
  status: 'Status', present: 'Present', tension: 'Tension', relations: 'Relations',
  threads: 'Threads', parallel: 'Parallel', recent: 'Latest', stats: 'Stats',
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

// Density OVERRIDE — a quick compact/comfortable/roomy preset applied over ANY
// active layout (separate from the per-layout default + the numeric --vdensity
// slider). null = use the layout's own density.
const DKEY = 'vellum2.density';
let _density: Density | null = loadDensity();
function loadDensity(): Density | null { try { const v = localStorage.getItem(DKEY); return v === 'compact' || v === 'comfortable' || v === 'roomy' ? v : null; } catch { return null; } }
export function setDensityOverride(d: Density | null): void { _density = d; try { if (d) localStorage.setItem(DKEY, d); else localStorage.removeItem(DKEY); } catch { /* ignore */ } }
export function densityOverride(): Density | null { return _density; }

export function getLayout(): LayoutDef {
  const base = _id === 'custom' ? _custom : (LAYOUTS.find((l) => l.id === _id) ?? LAYOUTS[0]!);
  return _density ? { ...base, density: _density } : base;
}
export function currentLayoutId(): string { return _id; }

/** Picker tiles (presets + Custom) + a quick density preset row. */
export function layoutPanel(): string {
  const tiles = LAYOUTS_WITH_CUSTOM().map((l) =>
    `<button class="vle-lay${_id === l.id ? ' on' : ''}" data-layout-pick="${l.id}" title="${l.blurb}">`
    + `<span class="vle-lay-g">${l.glyph}</span><span class="vle-lay-n">${l.name}</span></button>`
  ).join('');
  const eff = getLayout().density;
  const dens = ([['compact', 'Compact'], ['comfortable', 'Comfortable'], ['roomy', 'Roomy']] as Array<[Density, string]>)
    .map(([d, l]) => `<button class="vle-fb-btn${eff === d ? ' on' : ''}" data-density-pick="${d}">${l}</button>`).join('');
  return '<div class="vle-cz-h">Layout</div><div class="vle-lays">' + tiles + '</div>'
    + '<div class="vle-cz-h">Density</div><div class="vle-fbar">' + dens + '</div>'
    + '<div class="vle-cz-note">Density spacing applies over any layout. Fine-tune the exact gap with the slider in <b>Window</b>.</div>';
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

