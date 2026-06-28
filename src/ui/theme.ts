/**
 * Theme engine for VELLUM. Customization is PRESENTATION-ONLY and SAFE: every
 * setting is either a clamped CSS variable or a validated descriptor — no raw
 * style/HTML from the user reaches the DOM. Invariants: text stays legible
 * (ink is skin-derived or emphasis-adjusted; background images sit under a min
 * scrim), every axis resets in one click, and the whole config is one JSON blob
 * (export/import). A broken theme can never corrupt a chronicle.
 *
 * Axes: skin (look) · layout (structure, see layout-defs) · accent + 2nd accent
 * + intensity · serif/mono fonts + sizes · window (opacity/blur/radius/border/
 * density/texture) · motion · display flags · launcher position.
 */
import { layoutPanel, setLayout, customLayoutEditor, setDensityOverride } from './layout-defs.js';
import { confirmModal } from './modal.js';

export interface Theme {
  skin: string;
  accent: string; accent2: string; accentIntensity: number; // 0.5–1.6
  serif: string; mono: string;
  scale: number;       // chrome size 0.85–1.5
  dataScale: number;   // data/mono text size 0.85–1.3
  density: number;     // gap/padding multiplier 0.7–1.4
  opacity: number;     // float bg alpha 0.4–1
  blur: number;        // backdrop blur px 0–16
  radius: number;      // corner radius px 0–24
  border: number;      // border weight px 0.5–2.5
  inkEmphasis: number; // text strength 0.7–1.15
  texture: string;     // '' | bundled id | data/https url (scrimmed)
  motion: boolean;     // animations on
  launcher: 'right' | 'left' | 'hidden';
  chrome: 'illuminated' | 'modern' | 'futuristic'; // window ornamentation, orthogonal to skin
  // display flags
  tensionStyle: 'bar' | 'num' | 'both';
  // skin-derived (overridden by skin pick)
  surf1: string; surf2: string; ink: string; ink2: string; glass: string;
  // semantic colors (skin-tunable; base hue + lighter ink variant)
  pos: string; posInk: string; neg: string; negInk: string; info: string; warn: string;
}

export interface Skin { id: string; name: string; blurb: string; theme: Pick<Theme, 'accent' | 'serif' | 'mono' | 'surf1' | 'surf2' | 'ink' | 'ink2' | 'glass' | 'pos' | 'posInk' | 'neg' | 'negInk' | 'info' | 'warn'> }

const F_SERIF = "'Cormorant Garamond',Georgia,serif";
const F_MONO = "'JetBrains Mono',ui-monospace,monospace";
const F_SANS = 'system-ui,-apple-system,"Segoe UI",sans-serif';

export type Chrome = 'illuminated' | 'modern' | 'futuristic';

/**
 * A "mode" is a one-click preset over existing axes — chrome (window ornament) plus
 * sensible window-knob defaults. It is orthogonal to skin: any mode composes with any
 * palette. After picking, every knob is still individually overridable.
 */
export interface Mode { id: Chrome; name: string; blurb: string; patch: Partial<Theme>; form: string }
export const MODES: Mode[] = [
  { id: 'illuminated', name: 'Illuminated', blurb: 'An open codex \u2014 gilt double-rule, center gutter, two facing pages.', patch: { chrome: 'illuminated', radius: 18, border: 1, texture: '', serif: F_SERIF }, form: 'codex' },
  { id: 'modern', name: 'Modern', blurb: 'A device \u2014 flat, sans, a bottom dock that swaps panels like an app.', patch: { chrome: 'modern', radius: 12, border: 1, texture: '', serif: F_SANS }, form: 'phone' },
  { id: 'futuristic', name: 'Futuristic', blurb: 'An Oracle HUD \u2014 sharp brackets, telemetry rows, a live system readout.', patch: { chrome: 'futuristic', radius: 3, border: 1, texture: 'grid', serif: F_MONO }, form: 'hud' },
];

// base semantic palette, reused by every skin (skins override clash-prone ones)
const SEM = { pos: '#8fa67e', posInk: '#a9c089', neg: '#c96a6a', negInk: '#e09090', info: '#9bc0e6', warn: '#b48ed0' } as const;

export const SKINS: Skin[] = [
  { id: 'illuminated', name: 'Illuminated', blurb: 'Gilt manuscript on aged vellum — the classic.', theme: { accent: '#cda84e', serif: F_SERIF, mono: F_MONO, surf1: 'rgba(28,25,20,.55)', surf2: 'rgba(16,14,11,.5)', ink: '#e7d6ad', ink2: '#cdbfa0', glass: 'linear-gradient(168deg,rgba(26,22,16,.97),rgba(15,13,10,.985))', ...SEM } },
  { id: 'moonlit', name: 'Moonlit Ink', blurb: 'Cold silver-blue, midnight paper — quiet and literary.', theme: { accent: '#9bc0e6', serif: F_SERIF, mono: F_MONO, surf1: 'rgba(20,26,34,.55)', surf2: 'rgba(12,16,22,.5)', ink: '#d8e3f0', ink2: '#a9bdd2', glass: 'linear-gradient(168deg,rgba(18,24,32,.97),rgba(10,14,20,.985))', ...SEM, info: '#86d0e0' } },
  { id: 'crimson', name: 'Crimson Court', blurb: 'Oxblood and brass — opulent, dangerous, GoT-coded.', theme: { accent: '#c97a6a', serif: F_SERIF, mono: F_MONO, surf1: 'rgba(34,18,18,.58)', surf2: 'rgba(20,10,11,.52)', ink: '#eccfc4', ink2: '#cda79c', glass: 'linear-gradient(168deg,rgba(32,16,16,.97),rgba(18,9,10,.985))', ...SEM, neg: '#d65a5a', negInk: '#f2a0a0' } },
  { id: 'verdant', name: 'Verdant Grove', blurb: 'Mossy sage and bark — pastoral, warm, alive.', theme: { accent: '#8fa67e', serif: F_SERIF, mono: F_MONO, surf1: 'rgba(22,28,20,.55)', surf2: 'rgba(13,17,12,.5)', ink: '#dde6d2', ink2: '#aebfa0', glass: 'linear-gradient(168deg,rgba(20,26,18,.97),rgba(11,15,10,.985))', ...SEM, pos: '#a8c089', posInk: '#c2db9f' } },
  { id: 'noir', name: 'Onyx Terminal', blurb: 'High-contrast mono, amber phosphor — hardboiled/sci-fi.', theme: { accent: '#e0a44e', serif: F_MONO, mono: F_MONO, surf1: 'rgba(18,18,18,.6)', surf2: 'rgba(9,9,9,.55)', ink: '#e6dcc8', ink2: '#b8ad96', glass: 'linear-gradient(168deg,rgba(16,16,16,.98),rgba(7,7,7,.99))', ...SEM } },
  { id: 'orchid', name: 'Orchid Dusk', blurb: 'Violet and rose-gold — dreamlike, romantic, soft.', theme: { accent: '#b48ed0', serif: F_SERIF, mono: F_MONO, surf1: 'rgba(28,22,34,.55)', surf2: 'rgba(17,13,22,.5)', ink: '#e6d6ee', ink2: '#c2afce', glass: 'linear-gradient(168deg,rgba(26,20,32,.97),rgba(15,11,20,.985))', ...SEM, warn: '#c79ae0' } },
];

const FONT_CHOICES: Array<{ label: string; stack: string }> = [
  { label: 'Cormorant (serif)', stack: F_SERIF },
  { label: 'Georgia (serif)', stack: 'Georgia,"Times New Roman",serif' },
  { label: 'EB Garamond', stack: "'EB Garamond',Georgia,serif" },
  { label: 'Spectral', stack: "'Spectral',Georgia,serif" },
  { label: 'System sans', stack: 'system-ui,-apple-system,"Segoe UI",sans-serif' },
  { label: 'JetBrains Mono', stack: F_MONO },
];
const MONO_CHOICES: Array<{ label: string; stack: string }> = [
  { label: 'JetBrains Mono', stack: F_MONO },
  { label: 'Consolas', stack: 'Consolas,"Courier New",monospace' },
  { label: 'System mono', stack: 'ui-monospace,SFMono-Regular,monospace' },
];
const TEXTURES: Array<{ id: string; label: string; css: string }> = [
  { id: '', label: 'None', css: 'none' },
  { id: 'parchment', label: 'Parchment', css: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.7' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='0.35'/%3E%3C/svg%3E\")" },
  { id: 'grid', label: 'Grid', css: 'linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px)' },
  { id: 'dots', label: 'Dots', css: 'radial-gradient(rgba(255,255,255,.06) 1px,transparent 1px)' },
];

const KEY = 'vellum2.theme';
const DEFAULT: Theme = {
  skin: 'illuminated', accent2: '#9bc0e6', accentIntensity: 1,
  scale: 1.12, dataScale: 1, density: 1,
  opacity: 1, blur: 8, radius: 18, border: 1, inkEmphasis: 1, texture: '', motion: true,
  launcher: 'right', chrome: 'illuminated', tensionStyle: 'both',
  ...SKINS[0]!.theme,
};

const clamp = (v: number, lo: number, hi: number, d: number): number => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
function hexToRgb(hex: string): string { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim()); if (!m) return '205,168,78'; const n = parseInt(m[1]!, 16); return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`; }
function safeFont(stack: string): string { const s = String(stack || '').replace(/[<>{}]/g, '').slice(0, 200); return s ? s + ',Georgia,serif' : F_SERIF; }
function safeTexture(t: string): string {
  if (!t) return 'none';
  const preset = TEXTURES.find((x) => x.id === t); if (preset) return preset.css;
  if (/^(data:image\/(png|jpeg|webp|svg\+xml)|https:\/\/)/i.test(t)) return `url("${t.replace(/["\\]/g, '')}")`; // validated; scrim enforced in CSS
  return 'none';
}

let _theme: Theme = load();
function load(): Theme { try { const t = JSON.parse(localStorage.getItem(KEY) || ''); if (t && t.accent) return sanitize({ ...DEFAULT, ...t }); } catch { /* default */ } return { ...DEFAULT }; }
function sanitize(t: Theme): Theme {
  return { ...t,
    accentIntensity: clamp(t.accentIntensity, 0.5, 1.6, 1), scale: clamp(t.scale, 0.85, 1.5, 1.12), dataScale: clamp(t.dataScale, 0.85, 1.3, 1),
    density: clamp(t.density, 0.7, 1.4, 1), opacity: clamp(t.opacity, 0.4, 1, 1), blur: clamp(t.blur, 0, 16, 8), radius: clamp(t.radius, 0, 24, 18),
    border: clamp(t.border, 0.5, 2.5, 1), inkEmphasis: clamp(t.inkEmphasis, 0.7, 1.15, 1),
    serif: safeFont(t.serif), mono: safeFont(t.mono),
    chrome: (['illuminated', 'modern', 'futuristic'] as const).includes(t.chrome) ? t.chrome : 'illuminated',
  };
}
function save(): void { try { localStorage.setItem(KEY, JSON.stringify(_theme)); } catch { /* ignore */ } }

export function getTheme(): Theme { return _theme; }

export function applyTheme(scope: HTMLElement | null): void {
  const t = _theme;
  const set = (el: HTMLElement): void => {
    el.style.setProperty('--vg', t.accent);
    el.style.setProperty('--vg-rgb', hexToRgb(t.accent));
    el.style.setProperty('--vg2', t.accent2);
    el.style.setProperty('--vg2-rgb', hexToRgb(t.accent2));
    el.style.setProperty('--vai', String(t.accentIntensity));
    el.style.setProperty('--vi', t.ink);
    el.style.setProperty('--vi2', t.ink2);
    el.style.setProperty('--vink-e', String(t.inkEmphasis));
    el.style.setProperty('--vserif', t.serif);
    el.style.setProperty('--vmono', t.mono);
    el.style.setProperty('--vscale', String(t.scale));
    el.style.setProperty('--vdscale', String(t.dataScale));
    el.style.setProperty('--vdensity', String(t.density));
    el.style.setProperty('--vopacity', String(t.opacity));
    el.style.setProperty('--vblur', t.blur + 'px');
    el.style.setProperty('--vradius', t.radius + 'px');
    el.style.setProperty('--vborder', t.border + 'px');
    el.style.setProperty('--vtexture', safeTexture(t.texture));
    el.style.setProperty('--vmotion', t.motion ? '1' : '0');
    el.style.setProperty('--vsurf-1', t.surf1);
    el.style.setProperty('--vsurf-2', t.surf2);
    el.style.setProperty('--vglass', t.glass);
    el.style.setProperty('--v-pos', t.pos);
    el.style.setProperty('--v-pos-i', t.posInk);
    el.style.setProperty('--v-neg', t.neg);
    el.style.setProperty('--v-neg-i', t.negInk);
    el.style.setProperty('--v-info', t.info);
    el.style.setProperty('--v-warn', t.warn);
  };
  if (scope) set(scope);
  set(document.documentElement);
  document.documentElement.setAttribute('data-vle-launch', t.launcher);
  document.documentElement.setAttribute('data-vle-chrome', t.chrome);
  document.documentElement.setAttribute('data-vle-motion', t.motion ? 'on' : 'off');
}

export function setSkin(id: string): void { const s = SKINS.find((x) => x.id === id); if (s) { _theme = sanitize({ ..._theme, skin: id, ...s.theme }); save(); } }
export function setMode(id: string): void { const m = MODES.find((x) => x.id === id); if (m) { _theme = sanitize({ ..._theme, ...m.patch }); save(); setLayout(m.form); } }
export function patchTheme(patch: Partial<Theme>): void { _theme = sanitize({ ..._theme, ...patch }); save(); }
export function resetTheme(): void { _theme = { ...DEFAULT }; save(); }
export function exportTheme(): string { return JSON.stringify(_theme, null, 2); }
export function importTheme(json: string): boolean { try { const t = JSON.parse(json); if (t && t.accent) { _theme = sanitize({ ...DEFAULT, ...t }); save(); return true; } } catch { /* ignore */ } return false; }

export { FONT_CHOICES, TEXTURES };

// --- tabbed Customize panel ---------------------------------------------
type CzTab = 'skin' | 'mode' | 'layout' | 'color' | 'type' | 'window' | 'sections';

const slider = (key: string, label: string, min: number, max: number, step: number, val: number, fmt: (v: number) => string): string =>
  `<div class="vle-cz-h">${label} <span class="vle-cz-rst" data-cz-reset="${key}" title="Reset">\u21BA</span></div><div class="vle-cz-row">`
  + `<input type="range" class="vle-cz-range" data-cz-num="${key}" min="${min}" max="${max}" step="${step}" value="${val}">`
  + `<span class="vle-cz-sv" data-cz-numval="${key}">${fmt(val)}</span></div>`;

const pct = (v: number): string => Math.round(v * 100) + '%';

export function customizePanel(tab: CzTab = 'skin'): string {
  const t = _theme;
  const tabs = (['skin', 'mode', 'layout', 'color', 'type', 'window', 'sections'] as CzTab[])
    .map((id) => `<button class="vle-czt${tab === id ? ' on' : ''}" data-cz-tab="${id}">${id}</button>`).join('');
  let body = '';
  if (tab === 'skin') {
    body = '<div class="vle-cz-h">Skins</div><div class="vle-skins">'
      + SKINS.map((s) => `<button class="vle-skin${t.skin === s.id ? ' on' : ''}" data-skin="${s.id}" title="${s.blurb}" style="--sw:${s.theme.accent}"><span class="vle-skin-sw"></span><span class="vle-skin-n">${s.name}</span></button>`).join('')
      + '</div>'
      + '<div class="vle-cz-h">Theme</div><div class="vle-cz-row"><button class="vle-cz-btn" data-cz-export>\u2913 Export</button><button class="vle-cz-btn" data-cz-import>\u2912 Import</button><button class="vle-cz-btn danger" data-cz-resetall>\u21BA Reset all</button></div>';
  } else if (tab === 'mode') {
    body = '<div class="vle-cz-h">Window mode</div><div class="vle-skins">'
      + MODES.map((m) => `<button class="vle-skin${t.chrome === m.id ? ' on' : ''}" data-mode="${m.id}" title="${m.blurb}" style="--sw:${t.accent}"><span class="vle-skin-sw"></span><span class="vle-skin-n">${m.name}</span></button>`).join('')
      + '</div><div class="vle-cz-note">A starting point — composes with any skin. Fine-tune corners, border &amp; texture in <b>Window</b>.</div>';
  } else if (tab === 'layout') {
    body = layoutPanel() + customLayoutEditor();
  } else if (tab === 'color') {
    body = `<div class="vle-cz-h">Accent <span class="vle-cz-rst" data-cz-reset="accent" title="Reset">\u21BA</span></div><div class="vle-cz-row"><input type="color" class="vle-cz-color" data-cz-color value="${t.accent}"><input type="text" class="vle-cz-hex" data-cz-hex value="${t.accent}" maxlength="7" spellcheck="false"></div>`
      + `<div class="vle-cz-h">Secondary accent</div><div class="vle-cz-row"><input type="color" class="vle-cz-color" data-cz-color2 value="${t.accent2}"><input type="text" class="vle-cz-hex" data-cz-hex2 value="${t.accent2}" maxlength="7" spellcheck="false"></div>`
      + slider('accentIntensity', 'Accent intensity', 0.5, 1.6, 0.05, t.accentIntensity, pct)
      + slider('inkEmphasis', 'Text emphasis', 0.7, 1.15, 0.05, t.inkEmphasis, pct);
  } else if (tab === 'type') {
    const fopts = (sel: string) => FONT_CHOICES.map((f) => `<option value="${f.stack.replace(/"/g, '&quot;')}"${sel === f.stack ? ' selected' : ''}>${f.label}</option>`).join('');
    const mopts = MONO_CHOICES.map((f) => `<option value="${f.stack.replace(/"/g, '&quot;')}"${t.mono === f.stack ? ' selected' : ''}>${f.label}</option>`).join('');
    body = `<div class="vle-cz-h">Display font</div><div class="vle-cz-row"><select class="vle-cz-sel" data-cz-font>${fopts(t.serif)}</select></div>`
      + `<div class="vle-cz-h">Data font</div><div class="vle-cz-row"><select class="vle-cz-sel" data-cz-mono>${mopts}</select></div>`
      + slider('scale', 'Interface size', 0.85, 1.5, 0.05, t.scale, pct)
      + slider('dataScale', 'Data text size', 0.85, 1.3, 0.05, t.dataScale, pct);
  } else if (tab === 'window') {
    body = slider('opacity', 'Opacity', 0.4, 1, 0.05, t.opacity, pct)
      + slider('blur', 'Backdrop blur', 0, 16, 1, t.blur, (v) => v + 'px')
      + slider('radius', 'Corner radius', 0, 24, 1, t.radius, (v) => v + 'px')
      + slider('border', 'Border weight', 0.5, 2.5, 0.5, t.border, (v) => v + 'px')
      + slider('density', 'Density', 0.7, 1.4, 0.05, t.density, pct)
      + '<div class="vle-cz-h">Texture</div><div class="vle-cz-row"><select class="vle-cz-sel" data-cz-texture>'
        + TEXTURES.map((x) => `<option value="${x.id}"${t.texture === x.id ? ' selected' : ''}>${x.label}</option>`).join('')
        + (t.texture && !TEXTURES.some((x) => x.id === t.texture) ? `<option value="${t.texture}" selected>Custom URL</option>` : '') + '</select></div>'
      + `<div class="vle-cz-row"><input type="text" class="vle-cz-hex" data-cz-textureurl placeholder="https:// or data: image url" value="${TEXTURES.some((x) => x.id === t.texture) ? '' : t.texture}"></div>`
      + '<div class="vle-cz-h">Launcher tab</div><div class="vle-cz-row"><select class="vle-cz-sel" data-cz-launcher>'
        + ['right', 'left', 'hidden'].map((p) => `<option value="${p}"${t.launcher === p ? ' selected' : ''}>${p}</option>`).join('') + '</select></div>'
      + `<div class="vle-cz-h">Motion</div><div class="vle-cz-row"><label class="vle-cz-chk"><input type="checkbox" data-cz-motion${t.motion ? ' checked' : ''}> animations</label></div>`;
  } else {
    // sections = display flags
    body = '<div class="vle-cz-h">Tension display</div><div class="vle-cz-row"><select class="vle-cz-sel" data-cz-tension>'
      + ['both', 'bar', 'num'].map((v) => `<option value="${v}"${t.tensionStyle === v ? ' selected' : ''}>${v === 'num' ? 'number' : v}</option>`).join('') + '</select></div>'
      + '<div class="vle-cz-note">Per-section visibility & order live in the <b>Layout</b> tab \u2192 Custom.</div>';
  }
  return `<div class="vle-cz"><div class="vle-czt-bar">${tabs}</div><div class="vle-cz-body" data-cz-tab-body data-tab="${tab}">${body}</div></div>`;
}

/** Wire all customize controls. rerender(tab) rebuilds the panel; reapply themes. */
export function wireCustomize(host: HTMLElement, onChange: () => void, rerender: (tab: CzTab) => void): void {
  const reapply = (): void => { applyTheme(host.closest('.vle-root, .vlf, .vlfm, body') as HTMLElement); onChange(); };
  const curTab = (): CzTab => (host.querySelector('[data-cz-tab-body]')?.getAttribute('data-tab') as CzTab) || 'skin';

  host.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.matches('[data-cz-num]')) { const k = el.getAttribute('data-cz-num')!; patchTheme({ [k]: Number(el.value) } as Partial<Theme>); const out = host.querySelector(`[data-cz-numval="${k}"]`); if (out) out.textContent = (k === 'blur' || k === 'radius' || k === 'border') ? el.value + 'px' : Math.round(Number(el.value) * 100) + '%'; reapply(); }
    else if (el.matches('[data-cz-color]')) { patchTheme({ accent: el.value }); const hx = host.querySelector('[data-cz-hex]') as HTMLInputElement | null; if (hx) hx.value = el.value; reapply(); }
    else if (el.matches('[data-cz-color2]')) { patchTheme({ accent2: el.value }); const hx = host.querySelector('[data-cz-hex2]') as HTMLInputElement | null; if (hx) hx.value = el.value; reapply(); }
    else if (el.matches('[data-cz-hex]') && !el.matches('[data-cz-textureurl]')) { const v = el.value.trim(); if (/^#?[0-9a-fA-F]{6}$/.test(v)) { patchTheme({ accent: v.startsWith('#') ? v : '#' + v }); reapply(); } }
    else if (el.matches('[data-cz-hex2]')) { const v = el.value.trim(); if (/^#?[0-9a-fA-F]{6}$/.test(v)) { patchTheme({ accent2: v.startsWith('#') ? v : '#' + v }); reapply(); } }
    else if (el.matches('[data-cz-textureurl]')) { const v = el.value.trim(); patchTheme({ texture: v }); reapply(); }
  });
  host.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.matches('[data-cz-font]')) { patchTheme({ serif: el.value }); reapply(); }
    else if (el.matches('[data-cz-mono]')) { patchTheme({ mono: el.value }); reapply(); }
    else if (el.matches('[data-cz-texture]')) { patchTheme({ texture: el.value }); reapply(); }
    else if (el.matches('[data-cz-launcher]')) { patchTheme({ launcher: el.value as Theme['launcher'] }); reapply(); }
    else if (el.matches('[data-cz-tension]')) { patchTheme({ tensionStyle: el.value as Theme['tensionStyle'] }); reapply(); }
    else if (el.matches('[data-cz-motion]')) { patchTheme({ motion: el.checked }); reapply(); }
    else if (el.matches('[data-clay]')) { import('./layout-defs.js').then((m) => { m.handleCustomLayoutChange(el); rerender('layout'); onChange(); }); }
  });
  host.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const tab = t.closest('[data-cz-tab]'); if (tab) { rerender(tab.getAttribute('data-cz-tab') as CzTab); return; }
    const rst = t.closest('[data-cz-reset]'); if (rst) { const k = rst.getAttribute('data-cz-reset')!; patchTheme({ [k]: (DEFAULT as unknown as Record<string, unknown>)[k] } as Partial<Theme>); rerender(curTab()); reapply(); return; }
    if (t.closest('[data-cz-resetall]')) { confirmModal('Reset all appearance settings to defaults?', () => { resetTheme(); rerender('skin'); reapply(); }); return; }
    if (t.closest('[data-cz-export]')) { try { const b = new Blob([exportTheme()], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'vellum-theme.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); } catch { /* ignore */ } return; }
    if (t.closest('[data-cz-import]')) { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json'; inp.addEventListener('change', () => { const f = inp.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => { if (importTheme(String(r.result))) { rerender('skin'); reapply(); } }; r.readAsText(f); }); inp.click(); return; }
    const sk = t.closest('[data-skin]'); if (sk) { setSkin(sk.getAttribute('data-skin')!); rerender('skin'); reapply(); return; }
    const md = t.closest('[data-mode]'); if (md) { setMode(md.getAttribute('data-mode')!); rerender('mode'); reapply(); return; }
    const lp = t.closest('[data-layout-pick]'); if (lp) { setLayout(lp.getAttribute('data-layout-pick')!); rerender('layout'); onChange(); return; }
    const dp = t.closest('[data-density-pick]'); if (dp) { setDensityOverride(dp.getAttribute('data-density-pick') as 'compact' | 'comfortable' | 'roomy'); rerender('layout'); onChange(); return; }
    // custom-layout editor clicks are handled by layout-defs via delegation below
    if (t.closest('[data-clay]')) { import('./layout-defs.js').then((m) => { m.handleCustomLayoutClick(t); rerender('layout'); onChange(); }); }
  });
}
