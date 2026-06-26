/**
 * Theme engine for VELLUM: an accent color (wheel + hex), font family, font
 * size scale, and named skins — applied as CSS custom properties on a scope
 * element so the whole UI (drawer + float + tabs + icons) recolors live. The
 * accent drives the tab colors, the tab icon, the window toggle, and the ❖ mark.
 * Persisted to localStorage.
 */

export interface Theme {
  skin: string;
  accent: string;      // hex
  serif: string;       // display/prose font stack
  mono: string;        // label/data font stack
  scale: number;       // chrome size multiplier (0.85–1.4)
  surf1: string;       // panel gradient top
  surf2: string;       // panel gradient bottom
  ink: string;
  ink2: string;
  glass: string;       // float window backdrop
}

export interface Skin {
  id: string;
  name: string;
  blurb: string;
  theme: Omit<Theme, 'skin' | 'scale'>;
}

const F_SERIF = "'Cormorant Garamond',Georgia,serif";
const F_MONO = "'JetBrains Mono',ui-monospace,monospace";

/** Five distinct skins — each a complete mood, not just a hue swap. */
export const SKINS: Skin[] = [
  {
    id: 'illuminated', name: 'Illuminated', blurb: 'Gilt manuscript on aged vellum — the classic.',
    theme: { accent: '#cda84e', serif: F_SERIF, mono: F_MONO, surf1: 'rgba(28,25,20,.55)', surf2: 'rgba(16,14,11,.5)', ink: '#e7d6ad', ink2: '#cdbfa0', glass: 'linear-gradient(168deg,rgba(26,22,16,.97),rgba(15,13,10,.985))' },
  },
  {
    id: 'moonlit', name: 'Moonlit Ink', blurb: 'Cold silver-blue, midnight paper — quiet and literary.',
    theme: { accent: '#9bc0e6', serif: "'Cormorant Garamond',Georgia,serif", mono: F_MONO, surf1: 'rgba(20,26,34,.55)', surf2: 'rgba(12,16,22,.5)', ink: '#d8e3f0', ink2: '#a9bdd2', glass: 'linear-gradient(168deg,rgba(18,24,32,.97),rgba(10,14,20,.985))' },
  },
  {
    id: 'crimson', name: 'Crimson Court', blurb: 'Oxblood and brass — opulent, dangerous, GoT-coded.',
    theme: { accent: '#c97a6a', serif: "'Cormorant Garamond',Georgia,serif", mono: F_MONO, surf1: 'rgba(34,18,18,.58)', surf2: 'rgba(20,10,11,.52)', ink: '#eccfc4', ink2: '#cda79c', glass: 'linear-gradient(168deg,rgba(32,16,16,.97),rgba(18,9,10,.985))' },
  },
  {
    id: 'verdant', name: 'Verdant Grove', blurb: 'Mossy sage and bark — pastoral, warm, alive.',
    theme: { accent: '#8fa67e', serif: "'Cormorant Garamond',Georgia,serif", mono: F_MONO, surf1: 'rgba(22,28,20,.55)', surf2: 'rgba(13,17,12,.5)', ink: '#dde6d2', ink2: '#aebfa0', glass: 'linear-gradient(168deg,rgba(20,26,18,.97),rgba(11,15,10,.985))' },
  },
  {
    id: 'noir', name: 'Onyx Terminal', blurb: 'High-contrast mono, amber phosphor — hardboiled/sci-fi.',
    theme: { accent: '#e0a44e', serif: "'JetBrains Mono',ui-monospace,monospace", mono: F_MONO, surf1: 'rgba(18,18,18,.6)', surf2: 'rgba(9,9,9,.55)', ink: '#e6dcc8', ink2: '#b8ad96', glass: 'linear-gradient(168deg,rgba(16,16,16,.98),rgba(7,7,7,.99))' },
  },
  {
    id: 'orchid', name: 'Orchid Dusk', blurb: 'Violet and rose-gold — dreamlike, romantic, soft.',
    theme: { accent: '#b48ed0', serif: "'Cormorant Garamond',Georgia,serif", mono: F_MONO, surf1: 'rgba(28,22,34,.55)', surf2: 'rgba(17,13,22,.5)', ink: '#e6d6ee', ink2: '#c2afce', glass: 'linear-gradient(168deg,rgba(26,20,32,.97),rgba(15,11,20,.985))' },
  },
];

const FONT_CHOICES: Array<{ id: string; label: string; stack: string }> = [
  { id: 'cormorant', label: 'Cormorant (serif)', stack: "'Cormorant Garamond',Georgia,serif" },
  { id: 'georgia', label: 'Georgia (serif)', stack: 'Georgia,"Times New Roman",serif' },
  { id: 'eb', label: 'EB Garamond', stack: "'EB Garamond',Georgia,serif" },
  { id: 'system', label: 'System sans', stack: 'system-ui,-apple-system,"Segoe UI",sans-serif' },
  { id: 'mono', label: 'JetBrains Mono', stack: "'JetBrains Mono',ui-monospace,monospace" },
];

const KEY = 'vellum2.theme';
const DEFAULT: Theme = { skin: 'illuminated', scale: 1.12, ...SKINS[0]!.theme };

function hexToRgb(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '205,168,78';
  const n = parseInt(m[1]!, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

let _theme: Theme = load();
function load(): Theme {
  try { const t = JSON.parse(localStorage.getItem(KEY) || ''); if (t && t.accent) return { ...DEFAULT, ...t }; } catch { /* default */ }
  return { ...DEFAULT };
}
function save(): void { try { localStorage.setItem(KEY, JSON.stringify(_theme)); } catch { /* ignore */ } }

export function getTheme(): Theme { return _theme; }

/** Apply the theme as CSS variables onto a scope element (and document root for
 * the launcher/toggle which live on document.body). */
export function applyTheme(scope: HTMLElement | null): void {
  const t = _theme;
  const set = (el: HTMLElement) => {
    el.style.setProperty('--vg', t.accent);
    el.style.setProperty('--vg-rgb', hexToRgb(t.accent));
    el.style.setProperty('--vi', t.ink);
    el.style.setProperty('--vi2', t.ink2);
    el.style.setProperty('--vserif', t.serif);
    el.style.setProperty('--vmono', t.mono);
    el.style.setProperty('--vscale', String(t.scale));
    el.style.setProperty('--vsurf-1', t.surf1);
    el.style.setProperty('--vsurf-2', t.surf2);
    el.style.setProperty('--vglass', t.glass);
  };
  if (scope) set(scope);
  set(document.documentElement); // so the floating launcher + window inherit too
}

export function setSkin(id: string): void {
  const s = SKINS.find((x) => x.id === id);
  if (s) { _theme = { ..._theme, skin: id, ...s.theme }; save(); }
}
export function patchTheme(patch: Partial<Theme>): void { _theme = { ..._theme, ...patch }; save(); }

export { FONT_CHOICES };

/**
 * Build the Customize panel markup (color wheel via native color input + hex,
 * font, size, and the skin gallery). The caller wires its inputs to patchTheme/
 * setSkin + applyTheme + a re-render.
 */
import { layoutPanel, setLayout } from './layout-defs.js';

export function customizePanel(): string {
  const t = _theme;
  const skins = SKINS.map((s) =>
    `<button class="vle-skin${t.skin === s.id ? ' on' : ''}" data-skin="${s.id}" title="${s.blurb}" style="--sw:${s.theme.accent}">`
    + `<span class="vle-skin-sw"></span><span class="vle-skin-n">${s.name}</span></button>`
  ).join('');
  const fonts = FONT_CHOICES.map((f) => `<option value="${f.stack.replace(/"/g, '&quot;')}"${t.serif === f.stack ? ' selected' : ''}>${f.label}</option>`).join('');
  return '<div class="vle-cz">'
    + '<div class="vle-cz-h">Skins</div><div class="vle-skins">' + skins + '</div>'
    + layoutPanel()
    + '<div class="vle-cz-h">Accent</div><div class="vle-cz-row">'
      + `<input type="color" class="vle-cz-color" data-cz-color value="${t.accent}">`
      + `<input type="text" class="vle-cz-hex" data-cz-hex value="${t.accent}" maxlength="7" spellcheck="false">`
    + '</div>'
    + '<div class="vle-cz-h">Font</div><div class="vle-cz-row">'
      + `<select class="vle-cz-sel" data-cz-font>${fonts}</select>`
    + '</div>'
    + '<div class="vle-cz-h">Size</div><div class="vle-cz-row">'
      + `<input type="range" class="vle-cz-range" data-cz-scale min="0.85" max="1.5" step="0.05" value="${t.scale}">`
      + `<span class="vle-cz-sv" data-cz-scaleval>${Math.round(t.scale * 100)}%</span>`
    + '</div>'
    + '</div>';
}

/** Wire the customize panel controls within a container. onChange re-renders. */
export function wireCustomize(host: HTMLElement, onChange: () => void): void {
  const apply = (): void => { applyTheme(host.closest('.vle-root, .vlf, body') as HTMLElement); onChange(); };
  host.addEventListener('input', (e) => {
    const t = e.target as HTMLElement;
    if (t.matches('[data-cz-color]')) { const v = (t as HTMLInputElement).value; patchTheme({ accent: v }); const hx = host.querySelector('[data-cz-hex]') as HTMLInputElement | null; if (hx) hx.value = v; apply(); }
    else if (t.matches('[data-cz-hex]')) { const v = (t as HTMLInputElement).value.trim(); if (/^#?[0-9a-fA-F]{6}$/.test(v)) { const hex = v.startsWith('#') ? v : '#' + v; patchTheme({ accent: hex }); const cp = host.querySelector('[data-cz-color]') as HTMLInputElement | null; if (cp) cp.value = hex; apply(); } }
    else if (t.matches('[data-cz-scale]')) { const v = Number((t as HTMLInputElement).value); patchTheme({ scale: v }); const sv = host.querySelector('[data-cz-scaleval]'); if (sv) sv.textContent = Math.round(v * 100) + '%'; apply(); }
  });
  host.addEventListener('change', (e) => { const t = e.target as HTMLElement; if (t.matches('[data-cz-font]')) { patchTheme({ serif: (t as HTMLSelectElement).value }); apply(); } });
  host.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-skin]'); if (b) { setSkin(b.getAttribute('data-skin')!); onChange(); return; }
    const l = (e.target as HTMLElement).closest('[data-layout-pick]'); if (l) { setLayout(l.getAttribute('data-layout-pick')!); onChange(); }
  });
}
