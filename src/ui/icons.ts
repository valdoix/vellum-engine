/**
 * Inline-SVG icon set — one coherent monochrome family replacing the arbitrary
 * Unicode glyph soup across tabs, toolbar, and the Actions menu. No runtime dep:
 * each icon is a tiny stroked path on a 24×24 grid using `currentColor`, so it
 * inherits color and themes for free. Boundary-safe strings (no framework).
 *
 * Usage: icon('cast')  → '<svg class="vi" ...>…</svg>'
 *        icon('cast', { size: 18 })
 */

type IconOpts = { size?: number; cls?: string };

// 24×24 path bodies (stroke-based; `currentColor`). Keep them simple + legible
// at 14–18px. Add an entry here when a new tab/action needs an icon. Every path
// sits natively on the 24×24 grid — no `transform` scale/translate hacks, so the
// stroke weight stays uniform with the rest of the family at any render size.
const PATHS: Record<string, string> = {
  // --- primary tabs ---
  now: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/>',
  cast: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><path d="M16 7.2a3 3 0 0 1 0 5.6"/><path d="M17.5 19c0-2.4-1-4.2-2.6-5.2"/>',
  bonds: '<circle cx="7" cy="7" r="2.6"/><circle cx="17" cy="17" r="2.6"/><path d="M9 9l6 6"/><path d="M14.5 7.5l2 2M7.5 14.5l2 2" opacity=".55"/>',
  chronicle: '<path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  // --- tool tabs ---
  journal: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9 12h6M9 16h4"/>',
  graph: '<circle cx="6" cy="7" r="2"/><circle cx="18" cy="9" r="2"/><circle cx="9" cy="18" r="2"/><path d="M7.6 8.2l8.8.6M8.4 16.3l8.4-5.6M7.3 8.8l1.4 7.4" opacity=".7"/>',
  vault: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M12 9.2v5.6"/>',
  context: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M8 5v14" opacity=".6"/><path d="M11.5 9.5l2.5 2.5-2.5 2.5"/>',
  // --- header stat pills (turn counter, weather; cast/bonds/calendar reuse tab icons) ---
  turn: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5v5l3.5 2"/>',
  weather: '<path d="M7 18a4 4 0 0 1 .5-8 5 5 0 0 1 9.7 1.2A3.4 3.4 0 0 1 16.5 18z"/>',
  // --- toolbar ---
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.3-4.3"/>',

  // clapperboard-free director star, drawn natively on the grid (was a scaled/
  // translated path that thinned the stroke against its neighbors).
  director: '<path d="M12 4l2.1 4.3 4.7.7-3.4 3.3.8 4.7L12 15.5 7.8 17l.8-4.7L5.2 9l4.7-.7z"/>',
  customize: '<path d="M4 8h10M18 8h2M4 16h2M10 16h10"/><circle cx="16" cy="8" r="2.2"/><circle cx="8" cy="16" r="2.2"/>',
  actions: '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  // --- action verbs ---
  summarize: '<path d="M4 6h16M4 10h16M4 14h10M4 18h6"/>',
  rescan: '<path d="M20 11a8 8 0 1 0-1 5"/><path d="M20 5v5h-5"/>',
  // undo arrow, redrawn native to the grid (previously a translated path).
  undo: '<path d="M8 6L3 11l5 5"/><path d="M3 11h10a6 6 0 0 1 0 12h-1.5"/>',
  rebuild: '<path d="M4 12a8 8 0 0 1 14-5l2 2"/><path d="M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-14 5l-2-2"/><path d="M4 20v-5h5"/>',
  resummarize: '<path d="M5 12a7 7 0 0 1 12-4.5"/><path d="M17 5v3h-3" transform="translate(0,-0.5)"/><path d="M19 12a7 7 0 0 1-12 4.5"/><path d="M7 19v-3h3"/>',
  tidy: '<path d="M7 6l3 3M7 6l-2 2 9 9 2-2z"/><path d="M14 13l4 4-2 2-4-4" opacity=".8"/>',
  // tidy facts = clean up the fact record: a page of lines with a sparkle (kept
  // distinct from `tidy` (prose broom) and `journal`/`chronicle` documents).
  tidyfacts: '<path d="M6 3h9l3 3v15H6z"/><path d="M9 11h5M9 15h3" opacity=".85"/><path d="M17 3.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  summarizer: '<circle cx="12" cy="12" r="3"/><path d="M12 4v2M12 18v2M4 12h2M18 12h2M6 6l1.5 1.5M16.5 16.5L18 18M18 6l-1.5 1.5M7.5 16.5L6 18"/>',
  // preset editor = a diagnostic panel: a framed card with a heartbeat/pulse line
  // (link + health + budget readouts). Distinct from customize (sliders) and the
  // document tabs (journal/chronicle).
  preset: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M6.5 12h2l1.5-3 2 6 1.5-3h3.5"/>',
  // repair block = a retry arc looping a small state block (the ‹vellum› square),
  // reads as "regenerate the block". Distinct from rescan/recover (no inner block).
  autoretry: '<path d="M19 12a7 7 0 1 1-2-4.9"/><path d="M19 4.5V8h-3.5"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/>',
  hide: '<path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="2.5"/><path d="M4 4l16 16" opacity=".8"/>',
  traverse: '<circle cx="12" cy="5" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/><path d="M12 7v4M12 11l-5 5M12 11l5 5"/>',
  tone: '<path d="M12 20s-7-4.5-7-9.5A4 4 0 0 1 12 7a4 4 0 0 1 7 3.5C19 15.5 12 20 12 20z"/>',
  offscreen: '<path d="M18 14a7 7 0 0 1-9-9 7 7 0 1 0 9 9z"/>',
  foldtoast: '<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7l-4 3v-3H6a2 2 0 0 1-2-2z"/><path d="M9 9h6M9 11.5h4" opacity=".8"/>',
  export: '<path d="M12 4v10"/><path d="M8 8l4-4 4 4"/><path d="M5 16v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3"/>',
  exportmd: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M8.5 16v-4l1.8 2 1.8-2v4" opacity=".9"/><path d="M14.5 12v4M14.5 16l-1.3-1.4M14.5 16l1.3-1.4"/>',
  boundaries: '<path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" opacity=".85"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 9h16"/><path d="M8 3v4M16 3v4"/><path d="M8 13h2M12 13h2M8 16.5h2M12 16.5h2" opacity=".8"/>',
  budget: '<path d="M12 3v3M12 3a5 3 0 0 0 0 6a5 3 0 0 1 0 6"/><path d="M5 9l7 3 7-3"/><path d="M4 20h16"/><path d="M6 20v-4M18 20v-4"/>',
  import: '<path d="M12 14V4"/><path d="M8 10l4 4 4-4"/><path d="M5 16v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3"/>',
  recover: '<path d="M4 12a8 8 0 1 1 2.3 5.6"/><path d="M4 18v-4h4"/><path d="M12 8v4l3 2"/>',
  clear: '<path d="M6 7h12"/><path d="M9 7V5h6v2"/><path d="M8 7l1 13h6l1-13"/>',
  // help / guide = question mark in a circle, drawn native to the 24×24 grid so
  // the stroke weight matches the rest of the family.
  help: '<circle cx="12" cy="12" r="8"/><path d="M9.6 9.4a2.4 2.4 0 0 1 4.7.6c0 1.6-2.3 2-2.3 3.6"/><circle cx="12" cy="16.5" r="0.6" fill="currentColor" stroke="none"/>',
};

/** Render a named icon as an inline SVG string. Falls back to a dot if unknown. */
export function icon(name: string, opts: IconOpts = {}): string {
  const body = PATHS[name] ?? '<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>';
  const size = opts.size ?? 18;
  const cls = opts.cls ? ` ${opts.cls}` : '';
  return `<svg class="vi${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** True if a named icon exists (used by the completeness assert). */
export function hasIcon(name: string): boolean { return name in PATHS; }
