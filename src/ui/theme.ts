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
import { autoNameMode, setAutoNameMode } from './format.js';
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
  bg: string;          // '' = skin fill; else hex overriding the window/drawer background
  surf1c: string;      // '' = skin surface; else hex overriding card surface 1
  surf2c: string;      // '' = skin surface; else hex overriding card surface 2
  motion: boolean;     // animations on
  launcher: 'right' | 'left' | 'hidden';
  chrome: 'default' | 'illuminated' | 'modern' | 'futuristic' | 'bloom' | 'ember' | 'nocturne'; // window ornamentation, orthogonal to skin
  // display flags
  tensionStyle: 'bar' | 'num' | 'both';
  // skin-derived (overridden by skin pick)
  surf1: string; surf2: string; ink: string; ink2: string; glass: string;
  // semantic colors (skin-tunable; base hue + lighter ink variant)
  pos: string; posInk: string; neg: string; negInk: string; info: string; warn: string;
  press: string; pressInk: string; // amber "pressure" — tension/bond-shift, distinct from danger(neg)
}

export interface Skin { id: string; name: string; blurb: string; theme: Pick<Theme, 'accent' | 'serif' | 'mono' | 'surf1' | 'surf2' | 'ink' | 'ink2' | 'glass' | 'pos' | 'posInk' | 'neg' | 'negInk' | 'info' | 'warn' | 'press' | 'pressInk'> }

const F_SERIF = "'Cormorant Garamond',Georgia,serif";
const F_MONO = "'JetBrains Mono',ui-monospace,monospace";
const F_SANS = "'Inter',system-ui,-apple-system,\"Segoe UI\",sans-serif";
const F_DISPLAY = "'Cinzel','Cormorant Garamond',Georgia,serif"; // Fantasy display
const F_HUD = "'Orbitron','JetBrains Mono',ui-monospace,monospace"; // Futuristic display
const F_ETHEREAL = "'Cormorant Garamond','Quicksand',Georgia,serif"; // Ember display — airy serif with a dreamy italic lean

export type Chrome = 'default' | 'illuminated' | 'modern' | 'futuristic' | 'bloom' | 'ember' | 'nocturne';

/**
 * A "mode" is a one-click preset over existing axes — chrome (window ornament) plus
 * sensible window-knob defaults. It is orthogonal to skin: any mode composes with any
 * palette. After picking, every knob is still individually overridable.
 */
export interface Mode { id: Chrome; name: string; blurb: string; patch: Partial<Theme>; form: string; skin?: string }
export const MODES: Mode[] = [
  { id: 'default', name: 'Default', blurb: 'Calm &amp; legible \u2014 hierarchy first, quiet gold, the refined baseline.', patch: { chrome: 'default', radius: 14, border: 1, texture: '', serif: F_SERIF }, form: 'dashboard', skin: 'illuminated' },
  { id: 'illuminated', name: 'Fantasy', blurb: 'An open codex \u2014 warm parchment, brown ink, rubric headers, a wax seal.', patch: { chrome: 'illuminated', radius: 18, border: 1, texture: 'parchment', serif: F_SERIF }, form: 'codex', skin: 'parchment' },
  { id: 'modern', name: 'Modern', blurb: 'A calm card app \u2014 flat, sans, one smooth scroll of rounded cards.', patch: { chrome: 'modern', radius: 16, border: 1, texture: '', serif: F_SANS }, form: 'dashboard', skin: 'moonlit' },
  { id: 'futuristic', name: 'Futuristic', blurb: 'An Oracle HUD \u2014 cyan telemetry, reticle avatars, a live bond radar.', patch: { chrome: 'futuristic', radius: 2, border: 1, texture: 'grid', serif: F_HUD, accent: '#28e0d8', accent2: '#7a5cff' }, form: 'hud', skin: 'noir' },
  { id: 'bloom', name: 'Bloom', blurb: 'A pressed-flower garden \u2014 blush pink &amp; sage, petals, lace, a cozy romance.', patch: { chrome: 'bloom', radius: 20, border: 1, texture: 'petals', serif: F_SERIF, accent: '#d98cab', accent2: '#8fbf7f' }, form: 'dashboard', skin: 'blush' },
  // EMBER — "the night sky dreaming": a deep indigo void, drifting fireflies &
  // slow-rising bubbles, scattered pastel starlight, glowing soft-edged cards.
  // Distinct from Bloom (light/cozy) and Futuristic (hard/telemetry): Ember is
  // dark, soft, ethereal, and animated — pastels that glow on a midnight field.
  { id: 'ember', name: 'Ember', blurb: 'A starlit night dreaming \u2014 indigo void, fireflies, rising bubbles, pastel starlight.', patch: { chrome: 'ember', radius: 22, border: 1, texture: 'starfall', serif: F_ETHEREAL, accent: '#b8a9ff', accent2: '#8fd6c8', opacity: 0.92, blur: 12 }, form: 'dashboard', skin: 'starfall' },
  { id: 'nocturne', name: 'Nocturne', blurb: 'A midnight botanical salon \u2014 silver lace, blue lilies, constellations, and inlaid panels.', patch: { chrome: 'nocturne', radius: 8, border: 1.5, texture: 'midnight-lace', serif: F_DISPLAY, accent: '#b9cfee', accent2: '#466da8', opacity: 0.97, blur: 10 }, form: 'salon', skin: 'nocturne' },
];

// base semantic palette, reused by every skin (skins override clash-prone ones)
const SEM = { pos: '#8fa67e', posInk: '#a9c089', neg: '#c96a6a', negInk: '#e09090', info: '#9bc0e6', warn: '#b48ed0', press: '#c8923e', pressInk: '#dcad62' } as const;

export const SKINS: Skin[] = [
  { id: 'illuminated', name: 'Illuminated', blurb: 'Gilt manuscript on aged vellum — the classic.', theme: { accent: '#cda84e', serif: F_SERIF, mono: F_MONO, surf1: 'rgba(28,25,20,.55)', surf2: 'rgba(16,14,11,.5)', ink: '#e7d6ad', ink2: '#cdbfa0', glass: 'linear-gradient(168deg,rgba(26,22,16,.97),rgba(15,13,10,.985))', ...SEM } },
  { id: 'parchment', name: 'Parchment', blurb: 'Light aged vellum, brown ink, rubric red — a real open book.', theme: { accent: '#9a6f1e', serif: F_SERIF, mono: F_MONO, surf1: 'rgba(230,214,172,.92)', surf2: 'rgba(214,196,150,.92)', ink: '#2a1d0c', ink2: '#5a4524', glass: 'linear-gradient(168deg,#efe2c0,#e3d2a6)', ...SEM, pos: '#5a7a3a', posInk: '#4a6a2a', neg: '#7d2b27', negInk: '#9a3530', info: '#3b5a78', warn: '#6a3b78', press: '#9a6f1e', pressInk: '#7d5810' } },
  { id: 'vellum-dark', name: 'Aged Vellum', blurb: 'Dark tea-stained parchment — old brown leather, gilt ink.', theme: { accent: '#c79a4e', serif: F_SERIF, mono: F_MONO, surf1: 'rgba(46,34,22,.92)', surf2: 'rgba(33,24,15,.94)', ink: '#e8d6b0', ink2: '#b59a72', glass: 'linear-gradient(168deg,#332618,#231a10)', ...SEM, pos: '#9cb07a', posInk: '#b6c894', neg: '#c46a52', negInk: '#e0937e', info: '#7fa8c4', warn: '#bd96cf', press: '#c79a4e', pressInk: '#dcb568' } },
  { id: 'moonlit', name: 'Moonlit Ink', blurb: 'Cold silver-blue, midnight paper — quiet and literary.', theme: { accent: '#9bc0e6', serif: F_SERIF, mono: F_MONO, surf1: 'rgba(20,26,34,.55)', surf2: 'rgba(12,16,22,.5)', ink: '#d8e3f0', ink2: '#a9bdd2', glass: 'linear-gradient(168deg,rgba(18,24,32,.97),rgba(10,14,20,.985))', ...SEM, info: '#86d0e0' } },
  { id: 'crimson', name: 'Crimson Court', blurb: 'Oxblood and brass — opulent, dangerous, GoT-coded.', theme: { accent: '#c97a6a', serif: F_SERIF, mono: F_MONO, surf1: 'rgba(34,18,18,.58)', surf2: 'rgba(20,10,11,.52)', ink: '#eccfc4', ink2: '#cda79c', glass: 'linear-gradient(168deg,rgba(32,16,16,.97),rgba(18,9,10,.985))', ...SEM, neg: '#d65a5a', negInk: '#f2a0a0' } },
  { id: 'verdant', name: 'Verdant Grove', blurb: 'Mossy sage and bark — pastoral, warm, alive.', theme: { accent: '#8fa67e', serif: F_SERIF, mono: F_MONO, surf1: 'rgba(22,28,20,.55)', surf2: 'rgba(13,17,12,.5)', ink: '#dde6d2', ink2: '#aebfa0', glass: 'linear-gradient(168deg,rgba(20,26,18,.97),rgba(11,15,10,.985))', ...SEM, pos: '#a8c089', posInk: '#c2db9f' } },
  { id: 'noir', name: 'Onyx Terminal', blurb: 'High-contrast mono, amber phosphor — hardboiled/sci-fi.', theme: { accent: '#e0a44e', serif: F_MONO, mono: F_MONO, surf1: 'rgba(18,18,18,.6)', surf2: 'rgba(9,9,9,.55)', ink: '#e6dcc8', ink2: '#b8ad96', glass: 'linear-gradient(168deg,rgba(16,16,16,.98),rgba(7,7,7,.99))', ...SEM } },
  { id: 'orchid', name: 'Orchid Dusk', blurb: 'Violet and rose-gold — dreamlike, romantic, soft.', theme: { accent: '#b48ed0', serif: F_SERIF, mono: F_MONO, surf1: 'rgba(28,22,34,.55)', surf2: 'rgba(17,13,22,.5)', ink: '#e6d6ee', ink2: '#c2afce', glass: 'linear-gradient(168deg,rgba(26,20,32,.97),rgba(15,11,20,.985))', ...SEM, warn: '#c79ae0' } },
  // Light pastel garden — blush paper, rosewood ink, sage & pink semantics. The
  // recommended palette for the Bloom chrome (works standalone on any chrome too).
  { id: 'blush', name: 'Blush Garden', blurb: 'Pressed-flower pastels — blush paper, sage & rose, soft and cozy.', theme: { accent: '#d98cab', serif: F_SERIF, mono: F_MONO, surf1: 'rgba(255,241,246,.9)', surf2: 'rgba(246,232,240,.9)', ink: '#5c3a4a', ink2: '#9a7686', glass: 'linear-gradient(168deg,#fff4f8,#f3e4ec)', ...SEM, pos: '#7fa86a', posInk: '#688f54', neg: '#d06b7e', negInk: '#b8556a', info: '#8aa8c8', warn: '#c090c8', press: '#d99a5a', pressInk: '#c07f3e' } },
  // Dark twin of Blush — the cozy garden after dusk. Deep plum-charcoal paper,
  // moonlit rose ink, pastel pink & sage that glow on dark. Bloom's dark mode.
  { id: 'blush-noir', name: 'Moonlit Bloom', blurb: 'The garden after dusk — plum-charcoal paper, glowing rose & sage pastels.', theme: { accent: '#e6a3c0', serif: F_SERIF, mono: F_MONO, surf1: 'rgba(38,28,40,.6)', surf2: 'rgba(26,18,28,.55)', ink: '#f2dce7', ink2: '#c7a9ba', glass: 'linear-gradient(168deg,rgba(34,24,36,.97),rgba(20,14,22,.985))', ...SEM, pos: '#a6c98c', posInk: '#c0dfa4', neg: '#e08298', negInk: '#f0a6b8', info: '#a0bfe0', warn: '#d0a8e0', press: '#e0b070', pressInk: '#f0c890' } },
  // Starfall — the ember night-sky palette. Deep indigo-charcoal paper, luminous
  // pastel ink (lilac & mint), pastel starlight semantics that glow against the
  // void. The recommended skin for the Ember chrome; composes with any chrome.
  { id: 'starfall', name: 'Ember Sky', blurb: 'A starlit indigo void — pastel lilac & mint starlight, fireflies, soft glow.', theme: { accent: '#b8a9ff', serif: F_ETHEREAL, mono: F_MONO, surf1: 'rgba(24,24,40,.62)', surf2: 'rgba(15,15,28,.58)', ink: '#e6e0f5', ink2: '#b0a8d0', glass: 'linear-gradient(168deg,rgba(20,20,36,.97),rgba(12,12,24,.985))', ...SEM, pos: '#9cd6a8', posInk: '#c0e8cc', neg: '#f0a8b8', negInk: '#f8c4d0', info: '#9bc8e8', warn: '#d8b0e8', press: '#f0c878', pressInk: '#f8dc9a' } },
  { id: 'nocturne', name: 'Nocturne Blue', blurb: 'Ink-black navy with porcelain blue, tarnished silver, and botanical shadows.', theme: { accent: '#b9cfee', serif: F_DISPLAY, mono: F_MONO, surf1: 'rgba(8,18,39,.84)', surf2: 'rgba(3,9,23,.9)', ink: '#e8f0fb', ink2: '#9eb2ce', glass: 'linear-gradient(145deg,rgba(9,22,48,.985),rgba(2,8,22,.995))', ...SEM, pos: '#82afaa', posInk: '#a7d3ce', neg: '#bb7182', negInk: '#df9aaa', info: '#78a8de', warn: '#a49aca', press: '#bda46c', pressInk: '#dcc88f' } },
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
  // scattered pressed petals — soft blush + sage blooms, tiled SVG (no network)
  { id: 'petals', label: 'Petals', css: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cg fill='%23d98cab' fill-opacity='0.12'%3E%3Cpath d='M30 22c6-10 14-10 20 0-6 6-14 6-20 0z'/%3E%3Cpath d='M104 96c6-10 14-10 20 0-6 6-14 6-20 0z'/%3E%3Cpath d='M18 104c10 4 12 12 4 18-4-6-6-14-4-18z'/%3E%3C/g%3E%3Cg fill='%238fbf7f' fill-opacity='0.12'%3E%3Cpath d='M96 20c10 4 12 12 4 18-4-6-6-14-4-18z'/%3E%3Cpath d='M56 70c8-6 16-2 16 8-8 0-14-2-16-8z'/%3E%3C/g%3E%3C/svg%3E\")" },
  // scattered pastel stars on indigo — faint four-point sparkles (lilac, mint,
  // rose, butter). Static texture layer; the animated fireflies/bubbles live in
  // the ember chrome CSS block so they respect the motion kill-switch.
  { id: 'starfall', label: 'Starfall', css: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cg fill='%23b8a9ff' fill-opacity='0.14'%3E%3Cpath d='M24 30l2 6 6 2-6 2-2 6-2-6-6-2 6-2z'/%3E%3Cpath d='M120 110l1.5 4.5 4.5 1.5-4.5 1.5-1.5 4.5-1.5-4.5-4.5-1.5 4.5-1.5z'/%3E%3C/g%3E%3Cg fill='%238fd6c8' fill-opacity='0.12'%3E%3Cpath d='M96 40l1.5 4.5 4.5 1.5-4.5 1.5-1.5 4.5-1.5-4.5-4.5-1.5 4.5-1.5z'/%3E%3Cpath d='M40 120l1.2 3.6 3.6 1.2-3.6 1.2-1.2 3.6-1.2-3.6-3.6-1.2 3.6-1.2z'/%3E%3C/g%3E%3Cg fill='%23f0b8d0' fill-opacity='0.10'%3E%3Cpath d='M140 70l1 3 3 1-3 1-1 3-1-3-3-1 3-1z'/%3E%3C/g%3E%3Cg fill='%23f5d98a' fill-opacity='0.10'%3E%3Cpath d='M70 90l1 3 3 1-3 1-1 3-1-3-3-1 3-1z'/%3E%3C/g%3E%3C/svg%3E\")" },
  { id: 'midnight-lace', label: 'Midnight Lace', css: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cg fill='none' stroke='%23b9cfee' stroke-opacity='.105'%3E%3Cpath d='M0 22Q22 0 44 22T88 22T132 22T176 22M0 158q22 22 44 0t44 0t44 0t44 0'/%3E%3Ccircle cx='18' cy='18' r='11'/%3E%3Ccircle cx='162' cy='162' r='11'/%3E%3Cpath d='M18 4v28M4 18h28M162 148v28m-14-14h28'/%3E%3C/g%3E%3Cg fill='%23466da8' fill-opacity='.1'%3E%3Cpath d='M52 72c18-16 30-3 20 15-14 3-22-3-20-15zm76 35c-18 16-30 3-20-15 14-3 22 3 20 15z'/%3E%3C/g%3E%3C/svg%3E\")" },
];

const KEY = 'vellum2.theme';
const DEFAULT: Theme = {
  skin: 'illuminated', accent2: '#9bc0e6', accentIntensity: 1,
  scale: 1.12, dataScale: 1, density: 1,
  opacity: 1, blur: 8, radius: 18, border: 1, inkEmphasis: 1, texture: '', bg: '', surf1c: '', surf2c: '', motion: true,
  launcher: 'right', chrome: 'default', tensionStyle: 'both',
  ...SKINS[0]!.theme,
};

const clamp = (v: number, lo: number, hi: number, d: number): number => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
function hexToRgb(hex: string): string { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim()); if (!m) return '205,168,78'; const n = parseInt(m[1]!, 16); return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`; }
function safeFont(stack: string): string { const s = String(stack || '').replace(/[<>{}]/g, '').slice(0, 200); return s ? s + ',Georgia,serif' : F_SERIF; }
function safeHexOpt(v: string): string { const s = String(v || '').trim(); return /^#[0-9a-fA-F]{6}$/.test(s) ? s : ''; } // '' = derive from skin
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
    bg: safeHexOpt(t.bg), surf1c: safeHexOpt(t.surf1c), surf2c: safeHexOpt(t.surf2c),
    chrome: (['default', 'illuminated', 'modern', 'futuristic', 'bloom', 'ember', 'nocturne'] as const).includes(t.chrome) ? t.chrome : 'default',
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
    // custom fill overrides the skin surfaces when set; '' falls back to the skin
    el.style.setProperty('--vsurf-1', t.surf1c || t.surf1);
    el.style.setProperty('--vsurf-2', t.surf2c || t.surf2);
    el.style.setProperty('--vglass', t.bg || t.glass);
    el.style.setProperty('--vle-bg-custom', t.bg);
    el.style.setProperty('--v-pos', t.pos);
    el.style.setProperty('--v-pos-i', t.posInk);
    el.style.setProperty('--v-neg', t.neg);
    el.style.setProperty('--v-neg-i', t.negInk);
    el.style.setProperty('--v-info', t.info);
    el.style.setProperty('--v-warn', t.warn);
    el.style.setProperty('--v-press', t.press);
    el.style.setProperty('--v-press-i', t.pressInk);
  };
  if (scope) set(scope);
  set(document.documentElement);
  document.documentElement.setAttribute('data-vle-launch', t.launcher);
  document.documentElement.setAttribute('data-vle-chrome', t.chrome);
  document.documentElement.toggleAttribute('data-vle-bg', !!t.bg);
  document.documentElement.setAttribute('data-vle-motion', t.motion ? 'on' : 'off');
}

export function setSkin(id: string): void { const s = SKINS.find((x) => x.id === id); if (s) { _theme = sanitize({ ..._theme, skin: id, ...s.theme }); save(); } }
export function setMode(id: string): void {
  const m = MODES.find((x) => x.id === id);
  if (!m) return;
  // a mode is a one-click bundle: recommended skin palette first, then the
  // mode's own patch (chrome/radius/fonts/accent) which wins over the skin.
  const skin = m.skin ? SKINS.find((x) => x.id === m.skin) : undefined;
  _theme = sanitize({ ..._theme, ...(skin ? { skin: skin.id, ...skin.theme } : {}), ...m.patch });
  save(); setLayout(m.form);
}
export function patchTheme(patch: Partial<Theme>): void { _theme = sanitize({ ..._theme, ...patch }); save(); }
export function resetTheme(): void { _theme = { ...DEFAULT }; save(); }
export function exportTheme(): string { return JSON.stringify(_theme, null, 2); }
export function importTheme(json: string): boolean { try { const t = JSON.parse(json); if (t && t.accent) { _theme = sanitize({ ...DEFAULT, ...t }); save(); return true; } } catch { /* ignore */ } return false; }

export { FONT_CHOICES, TEXTURES };

// --- tabbed Customize panel ---------------------------------------------
type CzTab = 'look' | 'skin' | 'mode' | 'layout' | 'color' | 'type' | 'window' | 'sections';

const slider = (key: string, label: string, min: number, max: number, step: number, val: number, fmt: (v: number) => string): string =>
  `<div class="vle-cz-h">${label} <span class="vle-cz-rst" data-cz-reset="${key}" title="Reset">\u21BA</span></div><div class="vle-cz-row">`
  + `<input type="range" class="vle-cz-range" data-cz-num="${key}" min="${min}" max="${max}" step="${step}" value="${val}">`
  + `<span class="vle-cz-sv" data-cz-numval="${key}">${fmt(val)}</span></div>`;

const pct = (v: number): string => Math.round(v * 100) + '%';

export function customizePanel(tab: CzTab = 'look'): string {
  const t = _theme;
  // two-tier: a "Look" front tab (themes + size — the 90% case) and an Advanced
  // cluster (the full cockpit) set off by a divider so it doesn't overwhelm.
  const front: CzTab[] = ['look'];
  const advanced: CzTab[] = ['skin', 'mode', 'layout', 'color', 'type', 'window', 'sections'];
  const tabBtn = (id: CzTab): string => `<button class="vle-czt${tab === id ? ' on' : ''}" data-cz-tab="${id}">${id === 'look' ? 'Look' : id}</button>`;
  const tabs = front.map(tabBtn).join('')
    + '<span class="vle-czt-sep" title="Advanced">advanced</span>'
    + advanced.map(tabBtn).join('');
  // theme gallery sketch markup (shared by Look + the mode tab)
  const sketch: Record<Chrome, string> = {
    default: '<span class="vle-mode-sk sk-default"><i></i><i></i><i></i></span>',
    illuminated: '<span class="vle-mode-sk sk-codex"><i></i><i></i></span>',
    modern: '<span class="vle-mode-sk sk-phone"><i></i><i></i><i></i></span>',
    futuristic: '<span class="vle-mode-sk sk-hud"><i></i><i></i></span>',
    bloom: '<span class="vle-mode-sk sk-bloom"><i></i><i></i><i></i></span>',
    ember: '<span class="vle-mode-sk sk-ember"><i></i><i></i><i></i></span>',
    nocturne: '<span class="vle-mode-sk sk-nocturne"><i></i><i></i><i></i></span>',
  };
  const themeCards = MODES.map((m) => `<button class="vle-mode${t.chrome === m.id ? ' on' : ''}" data-mode="${m.id}" title="${m.blurb}">`
    + `${sketch[m.id]}<span class="vle-mode-n">${m.name}</span><span class="vle-mode-b">${m.blurb}</span></button>`).join('');
  let body = '';
  if (tab === 'look') {
    // the approachable front: pick a theme + set size. Everything else is Advanced.
    body = '<div class="vle-cz-h">Theme</div><div class="vle-modes">' + themeCards + '</div>'
      + slider('scale', 'Interface size', 0.85, 1.5, 0.05, t.scale, pct)
      + '<div class="vle-cz-note">Pick a look and size \u2014 that\u2019s usually all you need. For palettes, fonts, layout and window controls, open <b>Advanced</b> above.</div>';
  } else if (tab === 'skin') {
    body = '<div class="vle-cz-h">Skins</div><div class="vle-skins">'
      + SKINS.map((s) => `<button class="vle-skin${t.skin === s.id ? ' on' : ''}" data-skin="${s.id}" title="${s.blurb}" style="--sw:${s.theme.accent}"><span class="vle-skin-sw"></span><span class="vle-skin-n">${s.name}</span></button>`).join('')
      + '</div>'
      + '<div class="vle-cz-h">Theme</div><div class="vle-cz-row"><button class="vle-cz-btn" data-cz-export>\u2913 Export</button><button class="vle-cz-btn" data-cz-import>\u2912 Import</button><button class="vle-cz-btn danger" data-cz-resetall>\u21BA Reset all</button></div>';
  } else if (tab === 'mode') {
    body = '<div class="vle-cz-h">Theme</div><div class="vle-modes">' + themeCards
      + '</div><div class="vle-cz-note">A one-click starting point \u2014 sets chrome, palette, layout &amp; font together, then composes with any skin. Fine-tune everything in the other tabs.</div>';
  } else if (tab === 'layout') {
    body = layoutPanel() + customLayoutEditor();
  } else if (tab === 'color') {
    body = `<div class="vle-cz-h">Accent <span class="vle-cz-rst" data-cz-reset="accent" title="Reset">\u21BA</span></div><div class="vle-cz-row"><input type="color" class="vle-cz-color" data-cz-color value="${t.accent}"><input type="text" class="vle-cz-hex" data-cz-hex value="${t.accent}" maxlength="7" spellcheck="false"></div>`
      + `<div class="vle-cz-h">Secondary accent</div><div class="vle-cz-row"><input type="color" class="vle-cz-color" data-cz-color2 value="${t.accent2}"><input type="text" class="vle-cz-hex" data-cz-hex2 value="${t.accent2}" maxlength="7" spellcheck="false"></div>`
      + slider('accentIntensity', 'Accent intensity', 0.5, 1.6, 0.05, t.accentIntensity, pct)
      + slider('inkEmphasis', 'Text emphasis', 0.7, 1.15, 0.05, t.inkEmphasis, pct)
      // custom background + card surfaces. Empty = derive from the skin (the reset ↺ clears).
      + `<div class="vle-cz-h">Background <span class="vle-cz-rst" data-cz-reset="bg" title="Reset to skin">\u21BA</span></div><div class="vle-cz-row"><input type="color" class="vle-cz-color" data-cz-bg value="${t.bg || '#141210'}"><input type="text" class="vle-cz-hex" data-cz-bghex value="${t.bg}" placeholder="skin default" maxlength="7" spellcheck="false"></div>`
      + `<div class="vle-cz-h">Card surface 1 <span class="vle-cz-rst" data-cz-reset="surf1c" title="Reset to skin">\u21BA</span></div><div class="vle-cz-row"><input type="color" class="vle-cz-color" data-cz-surf1 value="${t.surf1c || '#1c1914'}"><input type="text" class="vle-cz-hex" data-cz-surf1hex value="${t.surf1c}" placeholder="skin default" maxlength="7" spellcheck="false"></div>`
      + `<div class="vle-cz-h">Card surface 2 <span class="vle-cz-rst" data-cz-reset="surf2c" title="Reset to skin">\u21BA</span></div><div class="vle-cz-row"><input type="color" class="vle-cz-color" data-cz-surf2 value="${t.surf2c || '#12100b'}"><input type="text" class="vle-cz-hex" data-cz-surf2hex value="${t.surf2c}" placeholder="skin default" maxlength="7" spellcheck="false"></div>`
      + '<div class="vle-cz-note">Leave blank to use the skin\u2019s colors. A background color composes with the current theme; the card surfaces are the panels behind cast &amp; record cards.</div>'
      + '<div class="vle-cz-h">Auto name color</div><div class="vle-fbar">'
      + (['off', 'solid', 'gradient'] as const).map((m) => `<button class="vle-fb-btn${autoNameMode() === m ? ' on' : ''}" data-cz-autoname="${m}">${m}</button>`).join('')
      + '</div><div class="vle-cz-note">Give every character a distinct auto color from their identity. A color set on a character in the Cast tab always wins.</div>';
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
  const curTab = (): CzTab => (host.querySelector('[data-cz-tab-body]')?.getAttribute('data-tab') as CzTab) || 'look';

  host.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.matches('[data-cz-num]')) { const k = el.getAttribute('data-cz-num')!; patchTheme({ [k]: Number(el.value) } as Partial<Theme>); const out = host.querySelector(`[data-cz-numval="${k}"]`); if (out) out.textContent = (k === 'blur' || k === 'radius' || k === 'border') ? el.value + 'px' : Math.round(Number(el.value) * 100) + '%'; reapply(); }
    else if (el.matches('[data-cz-color]')) { patchTheme({ accent: el.value }); const hx = host.querySelector('[data-cz-hex]') as HTMLInputElement | null; if (hx) hx.value = el.value; reapply(); }
    else if (el.matches('[data-cz-color2]')) { patchTheme({ accent2: el.value }); const hx = host.querySelector('[data-cz-hex2]') as HTMLInputElement | null; if (hx) hx.value = el.value; reapply(); }
    else if (el.matches('[data-cz-hex]') && !el.matches('[data-cz-textureurl]')) { const v = el.value.trim(); if (/^#?[0-9a-fA-F]{6}$/.test(v)) { patchTheme({ accent: v.startsWith('#') ? v : '#' + v }); reapply(); } }
    else if (el.matches('[data-cz-hex2]')) { const v = el.value.trim(); if (/^#?[0-9a-fA-F]{6}$/.test(v)) { patchTheme({ accent2: v.startsWith('#') ? v : '#' + v }); reapply(); } }
    else if (el.matches('[data-cz-textureurl]')) { const v = el.value.trim(); patchTheme({ texture: v }); reapply(); }
    // custom fill colors: color pickers (always valid hex) + hex fields (blank = reset to skin, sanitize clears)
    else if (el.matches('[data-cz-bg]')) { patchTheme({ bg: el.value }); const hx = host.querySelector('[data-cz-bghex]') as HTMLInputElement | null; if (hx) hx.value = el.value; reapply(); }
    else if (el.matches('[data-cz-surf1]')) { patchTheme({ surf1c: el.value }); const hx = host.querySelector('[data-cz-surf1hex]') as HTMLInputElement | null; if (hx) hx.value = el.value; reapply(); }
    else if (el.matches('[data-cz-surf2]')) { patchTheme({ surf2c: el.value }); const hx = host.querySelector('[data-cz-surf2hex]') as HTMLInputElement | null; if (hx) hx.value = el.value; reapply(); }
    else if (el.matches('[data-cz-bghex]')) { const v = el.value.trim(); if (v === '' || /^#[0-9a-fA-F]{6}$/.test(v)) { patchTheme({ bg: v }); reapply(); } }
    else if (el.matches('[data-cz-surf1hex]')) { const v = el.value.trim(); if (v === '' || /^#[0-9a-fA-F]{6}$/.test(v)) { patchTheme({ surf1c: v }); reapply(); } }
    else if (el.matches('[data-cz-surf2hex]')) { const v = el.value.trim(); if (v === '' || /^#[0-9a-fA-F]{6}$/.test(v)) { patchTheme({ surf2c: v }); reapply(); } }
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
    const an = t.closest('[data-cz-autoname]'); if (an) { setAutoNameMode(an.getAttribute('data-cz-autoname') as 'off' | 'solid' | 'gradient'); rerender('color'); onChange(); return; }
    // custom-layout editor clicks are handled by layout-defs via delegation below
    if (t.closest('[data-clay]')) { import('./layout-defs.js').then((m) => { m.handleCustomLayoutClick(t); rerender('layout'); onChange(); }); }
  });
}
