/**
 * UI PREFERENCES — the small, non-palette bits of "how the floating window is
 * arranged" that must survive an extension RELOAD: the chosen layout, the
 * density preset, the hand-built custom layout, the float's tab + geometry, the
 * auto-name color mode, and the fold-toast toggle.
 *
 * localStorage alone is NOT durable here — the host can drop it on an extension
 * reload/reinstall (that's why the theme keeps a backend mirror). So every pref
 * lives in ONE JSON blob that is both cached in localStorage (instant reads) and
 * persisted through a host-backed callback, then rehydrated from the backend on
 * the first state broadcast. Backend value wins on hydrate (authoritative after
 * a reload wiped localStorage); local writes update both layers immediately.
 *
 * This is a LEAF module: it imports nothing from the rest of the UI, so the
 * layout/format/float modules can depend on it without a cycle.
 */

const LKEY = 'vellum2.prefs';

// Legacy per-key localStorage names migrated into the blob on first load, so an
// existing user's arrangement carries forward the first time they update.
const LEGACY: Array<{ from: string; key: string; json?: boolean; bool?: boolean }> = [
  { from: 'vellum2.layout', key: 'layout' },
  { from: 'vellum2.density', key: 'density' },
  { from: 'vellum2.layout.custom', key: 'customLayout', json: true },
  { from: 'vellum2.float.tab', key: 'floatTab' },
  { from: 'vellum2.float.geo', key: 'floatGeo', json: true },
  { from: 'vellum2.autoname', key: 'autoName' },
  { from: 'vellum2.foldToast', key: 'foldToast', bool: true },
];

let _prefs: Record<string, unknown> = load();
let persistCb: (json: string) => void = () => {};

function load(): Record<string, unknown> {
  let base: Record<string, unknown> = {};
  try { const p = JSON.parse(localStorage.getItem(LKEY) || ''); if (p && typeof p === 'object') base = p; } catch { /* default */ }
  // one-time migration: fill any key still absent from its legacy home
  let migrated = false;
  for (const m of LEGACY) {
    if (m.key in base) continue;
    try {
      const raw = localStorage.getItem(m.from);
      if (raw === null) continue;
      if (m.bool) base[m.key] = raw === '1';
      else if (m.json) { try { base[m.key] = JSON.parse(raw); } catch { continue; } }
      else base[m.key] = raw;
      migrated = true;
    } catch { /* ignore */ }
  }
  if (migrated) { try { localStorage.setItem(LKEY, JSON.stringify(base)); } catch { /* ignore */ } }
  return base;
}

function save(): void {
  try { localStorage.setItem(LKEY, JSON.stringify(_prefs)); } catch { /* ignore */ }
  try { persistCb(JSON.stringify(_prefs)); } catch { /* ignore */ }
}

/** Register the host-backed persistence sink (set once in app setup). */
export function setPrefsPersist(cb: (json: string) => void): void { persistCb = cb; }

/** Read a pref, or `dflt` when unset. */
export function getPref<T>(key: string, dflt: T): T {
  return Object.prototype.hasOwnProperty.call(_prefs, key) ? (_prefs[key] as T) : dflt;
}

/** Write a pref (null/undefined removes it) and persist to both layers. */
export function setPref(key: string, val: unknown): void {
  if (val === undefined || val === null) { if (!(key in _prefs)) return; delete _prefs[key]; }
  else _prefs[key] = val;
  save();
}

/** Merge a backend-persisted blob over the local one (backend wins) WITHOUT
 * re-persisting — this is the hydrate path on a state broadcast. Returns true
 * when anything actually changed, so the caller can re-render. */
export function hydratePrefs(json: string | null | undefined): boolean {
  if (!json) return false;
  try {
    const p = JSON.parse(json);
    if (!p || typeof p !== 'object') return false;
    const before = JSON.stringify(_prefs);
    _prefs = { ..._prefs, ...p };
    const after = JSON.stringify(_prefs);
    if (after === before) return false;
    try { localStorage.setItem(LKEY, after); } catch { /* ignore */ }
    return true;
  } catch { return false; }
}

/** The full prefs blob (for export/inspection). */
export function allPrefs(): Record<string, unknown> { return _prefs; }
