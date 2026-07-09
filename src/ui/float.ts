/**
 * A beautiful, self-contained floating window — more elegant than the legacy
 * VELLUM ledger pane. Illuminated-manuscript glass: a gilt double-rule frame,
 * a soft inner glow, a drag-handle title bar with a wax-seal mark, a corner
 * resize grip, persisted geometry, and a graceful open/close transition. Opened
 * from an input-bar action. Pointer-event based so it works on touch/phone.
 *
 * It's a presentation shell: the caller supplies render(host) to fill the body
 * and a toolbar of QOL actions. Geometry persists to localStorage.
 */
import { applyTheme, getTheme, patchTheme, type Theme } from './theme.js';
import { getPref, setPref } from './prefs.js';

type Edge = Extract<Theme['launcher'], 'left' | 'right' | 'top' | 'bottom'>;
const clampPct = (v: number): number => Math.max(3, Math.min(97, Math.round(Number(v)) || 0));

export interface FloatHooks {
  title?: string;
  /** fill the scrollable body */
  render(body: HTMLElement): void;
  /** QOL buttons in the title bar: [{ id, label, title }] */
  actions?: Array<{ id: string; label: string; title: string }>;
  onAction?(id: string): void;
}

export interface FloatWindow {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  refresh(): void;
  applyTheme(): void;
  /** Re-read persisted geometry (after a backend prefs hydrate) and re-apply. */
  reloadGeo(): void;
  destroy(): void;
}

const MARK = '\u2756';

interface Geo { x: number; y: number; w: number; h: number }
function loadGeo(): Geo {
  const g = getPref<Partial<Geo> | null>('floatGeo', null);
  if (g && typeof g.x === 'number' && typeof g.y === 'number' && typeof g.w === 'number' && typeof g.h === 'number') return g as Geo;
  const w = Math.min(420, Math.max(300, Math.round(window.innerWidth * 0.30)));
  const h = Math.min(620, Math.round(window.innerHeight * 0.66));
  return { x: window.innerWidth - w - 28, y: 84, w, h };
}
function clampGeo(g: Geo): Geo {
  const w = Math.max(280, Math.min(g.w, window.innerWidth - 16));
  const h = Math.max(220, Math.min(g.h, window.innerHeight - 16));
  const x = Math.max(8, Math.min(g.x, window.innerWidth - w - 8));
  const y = Math.max(8, Math.min(g.y, window.innerHeight - h - 8));
  return { x, y, w, h };
}

export function createFloatWindow(hooks: FloatHooks): FloatWindow {
  let geo = clampGeo(loadGeo());
  let open = false;
  let saveT: ReturnType<typeof setTimeout> | null = null;

  const el = document.createElement('div');
  el.className = 'vlf';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', hooks.title || 'VELLUM');
  el.innerHTML =
    '<div class="vlf-frame">'
    + '<div class="vlf-tex"></div><div class="vlf-scrim"></div>'
    + '<div class="vlf-bar" data-vlf-drag>'
    + `<span class="vlf-mark">${MARK}</span><span class="vlf-title">${(hooks.title || 'VELLUM')}</span>`
    + '<span class="vlf-actions" data-vlf-actions></span>'
    + '<button class="vlf-x" data-vlf-close title="Close" aria-label="Close">\u2715</button>'
    + '</div>'
    + '<div class="vlf-body" data-vlf-body></div>'
    + '<div class="vlf-grip" data-vlf-resize aria-hidden="true"></div>'
    + '</div>';
  const bar = el.querySelector('[data-vlf-drag]') as HTMLElement;
  const body = el.querySelector('[data-vlf-body]') as HTMLElement;
  const actionsEl = el.querySelector('[data-vlf-actions]') as HTMLElement;
  const grip = el.querySelector('[data-vlf-resize]') as HTMLElement;

  if (hooks.actions?.length) {
    actionsEl.innerHTML = hooks.actions.map((a) => `<button class="vlf-act" data-vlf-act="${a.id}" title="${a.title}">${a.label}</button>`).join('');
    actionsEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-vlf-act]');
      if (b) hooks.onAction?.(b.getAttribute('data-vlf-act')!);
    });
  }

  const applyGeo = (): void => {
    el.style.left = geo.x + 'px'; el.style.top = geo.y + 'px';
    el.style.width = geo.w + 'px'; el.style.height = geo.h + 'px';
  };
  const persist = (): void => { if (saveT) clearTimeout(saveT); saveT = setTimeout(() => { setPref('floatGeo', geo); }, 250); };

  // drag (pointer events → touch friendly, captured)
  let mode: 'drag' | 'resize' | null = null;
  let sx = 0, sy = 0, ox = 0, oy = 0, ow = 0, oh = 0;
  const down = (m: 'drag' | 'resize') => (e: PointerEvent): void => {
    if ((e.target as HTMLElement).closest('[data-vlf-close],[data-vlf-act]')) return;
    mode = m; sx = e.clientX; sy = e.clientY; ox = geo.x; oy = geo.y; ow = geo.w; oh = geo.h;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); e.preventDefault();
  };
  const move = (e: PointerEvent): void => {
    if (!mode) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (mode === 'drag') geo = clampGeo({ ...geo, x: ox + dx, y: oy + dy });
    else geo = clampGeo({ ...geo, w: ow + dx, h: oh + dy });
    applyGeo();
  };
  const up = (): void => { if (mode) { mode = null; persist(); } };
  bar.addEventListener('pointerdown', down('drag'));
  grip.addEventListener('pointerdown', down('resize'));
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);

  const onResizeWin = (): void => { geo = clampGeo(geo); applyGeo(); };
  window.addEventListener('resize', onResizeWin);

  el.querySelector('[data-vlf-close]')!.addEventListener('click', () => api.close());

  // Persistent launcher tab pinned to a screen edge — a guaranteed entry point
  // that doesn't depend on the host's input-bar API being present. Hidden while
  // open. Draggable: drop it near any edge to re-pin (persists to the theme), and
  // its position ALONG that edge persists as a percentage.
  const launcher = document.createElement('button');
  launcher.className = 'vlf-launch';
  launcher.title = 'Open VELLUM (drag to move)';
  launcher.setAttribute('aria-label', 'Open VELLUM');
  launcher.innerHTML = `<span class="vlf-launch-mark">${MARK}</span><span class="vlf-launch-t">VELLUM</span>`;
  document.body.appendChild(launcher);

  // along-edge offset, a 0–100% position on the pinned edge (top for left/right,
  // left for top/bottom). Restored on load; updated when dragged.
  const applyLaunchPos = (): void => {
    const p = clampPct(getPref<number>('launchPos', 46));
    document.documentElement.style.setProperty('--vlf-lpos', p + '%');
  };
  applyLaunchPos();

  // drag vs click: a small movement threshold separates a tap (open) from a drag.
  let lDown = false, lDragging = false, lsx = 0, lsy = 0;
  launcher.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button != null && e.button !== 0) return;
    lDown = true; lDragging = false; lsx = e.clientX; lsy = e.clientY;
    launcher.setPointerCapture?.(e.pointerId);
  });
  launcher.addEventListener('pointermove', (e: PointerEvent) => {
    if (!lDown) return;
    const dx = e.clientX - lsx, dy = e.clientY - lsy;
    if (!lDragging && Math.hypot(dx, dy) < 6) return;
    if (!lDragging) { lDragging = true; launcher.classList.add('is-dragging'); }
    // free-follow the pointer while dragging (inline px wins over the edge CSS)
    const r = launcher.getBoundingClientRect();
    launcher.style.right = 'auto'; launcher.style.bottom = 'auto';
    launcher.style.left = (e.clientX - r.width / 2) + 'px';
    launcher.style.top = (e.clientY - r.height / 2) + 'px';
  });
  const endLaunchDrag = (e: PointerEvent): void => {
    if (!lDown) return;
    lDown = false;
    if (!lDragging) { api.open(); return; }
    launcher.classList.remove('is-dragging');
    launcher.style.left = ''; launcher.style.top = ''; launcher.style.right = ''; launcher.style.bottom = '';
    // snap to the nearest edge; store the position along that edge as a percentage
    const vw = window.innerWidth, vh = window.innerHeight;
    const x = e.clientX, y = e.clientY;
    const dists: Array<[Edge, number, number]> = [
      ['left', x, (y / vh) * 100],
      ['right', vw - x, (y / vh) * 100],
      ['top', y, (x / vw) * 100],
      ['bottom', vh - y, (x / vw) * 100],
    ];
    dists.sort((a, b) => a[1] - b[1]);
    const [edge, , pct] = dists[0]!;
    setPref('launchPos', clampPct(pct));
    applyLaunchPos();
    if (getTheme().launcher !== edge) { patchTheme({ launcher: edge }); applyTheme(el); }
  };
  launcher.addEventListener('pointerup', endLaunchDrag);
  launcher.addEventListener('pointercancel', () => { lDown = false; if (lDragging) { lDragging = false; launcher.classList.remove('is-dragging'); launcher.style.left = ''; launcher.style.top = ''; launcher.style.right = ''; launcher.style.bottom = ''; } });

  const api: FloatWindow = {
    open(): void {
      if (open) return; open = true;
      geo = clampGeo(geo); applyGeo();
      if (!el.isConnected) document.body.appendChild(el);
      applyTheme(el);
      requestAnimationFrame(() => el.classList.add('is-open'));
      launcher.classList.add('is-hidden');
      hooks.render(body);
    },
    close(): void { if (!open) return; open = false; el.classList.remove('is-open'); launcher.classList.remove('is-hidden'); },
    toggle(): void { open ? api.close() : api.open(); },
    isOpen(): boolean { return open; },
    refresh(): void { if (open) hooks.render(body); },
    applyTheme(): void { applyTheme(el); },
    reloadGeo(): void { geo = clampGeo(loadGeo()); if (open) applyGeo(); },
    destroy(): void {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up); window.removeEventListener('resize', onResizeWin);
      try { el.remove(); } catch { /* ignore */ }
      try { launcher.remove(); } catch { /* ignore */ }
    },
  };
  return api;
}
