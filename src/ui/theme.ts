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
  mode: 'dark' | 'light'; // color mode; picks the chrome's dark/light skin
  chrome: 'default' | 'illuminated' | 'modern' | 'futuristic' | 'bloom' | 'ember' | 'faewild'; // window ornamentation, orthogonal to skin

  // per-surface card shape overrides. {} = use the chrome's default shape for
  // every surface (so the default theme is visually unchanged). A missing/unknown
  // key falls back to the chrome default; sanitize() whitelists both surface & id.
  cardShapes: Partial<Record<Surface, ShapeId>>;

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
const F_HUD = "'Orbitron','JetBrains Mono',ui-monospace,monospace"; // Futuristic display
const F_ETHEREAL = "'Quicksand','Cormorant Garamond',Georgia,serif"; // Ember display — airy rounded geometric (bundled), Cormorant as graceful fallback

export type Chrome = 'default' | 'illuminated' | 'modern' | 'futuristic' | 'bloom' | 'ember' | 'faewild';

// --- card shapes (mockups 24, 30-35) ---------------------------------------
// The shape vocabulary is CSS-only (see .v-shape--* in styles.ts). A theme may
// override the shape per surface; anything unset uses the chrome's default map.
// v4: the shape vocabulary is the content-safe survivors only. Cut over rounds:
// folio/hex/cameo/glass/gem/constellation/ticket (round 1), then ribbon/rule/
// arch/petal/chamfer (round 2). Added this round: stitch (inset dashed border),
// gilt-edge (thin keyline all sides), binding (ledger holes down the left),
// studs (four corner registration dots), bracket (end [ ] brackets). Every shape
// expresses its read via radius / a small fixed-corner clip / an edge accent / a
// masked edge / a padding-anchored pseudo — never a full-bleed polygon — so a
// wide row never clips its content.
// Faewild round (mockups 39 / mode-4): four nature silhouettes, same content-safe
// discipline — toadstool (mushroom-cap dome top + top padding), trellis (climbing
// -vine left rail, left padding), bramble (leafy-wreath corner sprigs in padding),
// lantern (a hanging bulb tag: top hook pseudo + warm inset glow).
export type ShapeId =
  | 'slab' | 'left-spine' | 'tarot' | 'notched' | 'split' | 'inset' | 'scalloped'
  | 'aperture' | 'deckle' | 'stitch' | 'gilt-edge' | 'binding' | 'studs' | 'bracket'
  | 'toadstool' | 'trellis' | 'bramble' | 'lantern';
export type Surface = 'present' | 'bonds' | 'cast' | 'beats' | 'factions' | 'items' | 'secrets';
export const SHAPE_IDS: readonly ShapeId[] = ['slab', 'left-spine', 'tarot', 'notched', 'split', 'inset', 'scalloped', 'aperture', 'deckle', 'stitch', 'gilt-edge', 'binding', 'studs', 'bracket', 'toadstool', 'trellis', 'bramble', 'lantern'];
export const SURFACES: readonly Surface[] = ['present', 'bonds', 'cast', 'beats', 'factions', 'items', 'secrets'];
// Human labels for the customizer rows.
export const SURFACE_LABELS: Record<Surface, string> = {
  present: 'Present (thoughts)', bonds: 'Bonds', cast: 'Cast', beats: 'Beats', factions: 'Factions', items: 'Items', secrets: 'Secrets',
};
// Per-chrome default silhouettes, transcribed from the card gallery (30-35).
// `default` keeps the current look so nothing changes until a chrome/override is
// chosen. Each chrome styles its own palette/type; shape is orthogonal.
export const CHROME_SHAPES: Record<Chrome, Record<Surface, ShapeId>> = {
  default: { present: 'left-spine', bonds: 'split', cast: 'inset', beats: 'slab', factions: 'slab', items: 'slab', secrets: 'slab' },
  // manuscript: gilt keylines, a framed portrait cast, a bound ledger of items/secrets
  illuminated: { present: 'gilt-edge', bonds: 'gilt-edge', cast: 'tarot', beats: 'left-spine', factions: 'binding', items: 'binding', secrets: 'slab' },
  modern: { present: 'slab', bonds: 'split', cast: 'slab', beats: 'slab', factions: 'slab', items: 'slab', secrets: 'slab' },
  // HUD: reticle notches, viewfinder brackets, registration studs, end brackets
  futuristic: { present: 'notched', bonds: 'aperture', cast: 'notched', beats: 'bracket', factions: 'studs', items: 'bracket', secrets: 'notched' },
  // cozy garden: stitched borders, a framed portrait cast, a scalloped faction card
  bloom: { present: 'stitch', bonds: 'stitch', cast: 'tarot', beats: 'inset', factions: 'scalloped', items: 'stitch', secrets: 'stitch' },
  // dreamy night: soft portrait, a torn deckle beat, plain-slab secrets (per request)
  ember: { present: 'tarot', bonds: 'gilt-edge', cast: 'slab', beats: 'deckle', factions: 'tarot', items: 'deckle', secrets: 'slab' },
  // twilight storybook glade: a toadstool-dome present, a bramble-wreath bond, a
  // tarot cast plate, a climbing-vine trellis beat, a scalloped faction, a hanging
  // fairy-lantern item; secrets stay a quiet slab (the sealed thing in the dark).
  faewild: { present: 'toadstool', bonds: 'bramble', cast: 'tarot', beats: 'trellis', factions: 'scalloped', items: 'lantern', secrets: 'slab' },
};
/** Resolve the shape for a surface: user override wins, else the chrome default. */
export function resolveShape(surface: Surface, chrome: Chrome, overrides: Partial<Record<Surface, ShapeId>>): ShapeId {
  const o = overrides[surface];
  if (o && SHAPE_IDS.includes(o)) return o;
  return CHROME_SHAPES[chrome][surface];
}
/**
 * The shape that is ACTUALLY active on the DOM for a surface, mirroring the
 * attribute emission in applyTheme(): a user override wins; otherwise a
 * non-default chrome contributes its gallery shape; the DEFAULT chrome with no
 * override emits nothing -> null. Renderers use this to decide whether to append
 * an ornament so the default theme stays byte-identical (no ornament markup).
 */
export function activeShape(surface: Surface): ShapeId | null {
  const t = getTheme();
  const o = t.cardShapes[surface];
  if (o && SHAPE_IDS.includes(o)) return o;
  return t.chrome !== 'default' ? CHROME_SHAPES[t.chrome][surface] : null;
}
/** Drop unknown surfaces / shape ids from a saved cardShapes map (same safety
 *  pattern as CHROME_REMAP: a broken theme can never inject an invalid class). */
export function sanitizeCardShapes(raw: unknown): Partial<Record<Surface, ShapeId>> {
  const out: Partial<Record<Surface, ShapeId>> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (SURFACES.includes(k as Surface) && typeof v === 'string' && SHAPE_IDS.includes(v as ShapeId)) {
      out[k as Surface] = v as ShapeId;
    }
  }
  return out;
}


/**
 * A "mode" is a one-click preset over existing axes — chrome (window ornament) plus
 * sensible window-knob defaults. It is orthogonal to skin: any mode composes with any
 * palette. After picking, every knob is still individually overridable.
 */
export interface Mode { id: Chrome; name: string; blurb: string; patch: Partial<Theme>; form: string; skin?: string; skinDark: string; skinLight: string }
// Seven chromes, each with a paired dark + light skin. `skin` is the mode's
// recommended (dark) palette for back-compat; setMode picks dark/light by the
// active color mode. Philosophy: STORY (the scene leads) · BEAUTY (each chrome
// is a distinct world, ornament that encodes state) · MEMORY (the margin holds).
export const MODES: Mode[] = [
  { id: 'default', name: 'Default', blurb: 'Calm &amp; legible \u2014 hierarchy first, quiet gold, the refined baseline.', patch: { chrome: 'default', radius: 14, border: 1, texture: '', serif: F_SERIF }, form: 'dashboard', skin: 'illuminated', skinDark: 'illuminated', skinLight: 'parchment' },
  { id: 'illuminated', name: 'Fantasy', blurb: 'An open codex \u2014 warm parchment, brown ink, rubric headers, a wax seal.', patch: { chrome: 'illuminated', radius: 18, border: 1, texture: 'parchment', serif: F_SERIF }, form: 'codex', skin: 'vellum-dark', skinDark: 'vellum-dark', skinLight: 'parchment' },
  { id: 'modern', name: 'Modern', blurb: 'A calm card app \u2014 flat, sans, one smooth scroll of rounded cards.', patch: { chrome: 'modern', radius: 16, border: 1, texture: '', serif: F_SANS }, form: 'dashboard', skin: 'moonlit', skinDark: 'moonlit', skinLight: 'daylit' },
  { id: 'futuristic', name: 'Futuristic', blurb: 'An Oracle HUD \u2014 cyan telemetry, reticle avatars, a live bond radar.', patch: { chrome: 'futuristic', radius: 2, border: 1, texture: 'grid', serif: F_HUD, accent: '#28e0d8', accent2: '#7a5cff' }, form: 'hud', skin: 'noir', skinDark: 'noir', skinLight: 'chrome-light' },
  { id: 'bloom', name: 'Bloom', blurb: 'A pressed-flower garden \u2014 blush pink &amp; sage, petals, lace, a cozy romance.', patch: { chrome: 'bloom', radius: 20, border: 1, texture: 'petals', serif: F_SERIF, accent: '#d98cab', accent2: '#8fbf7f' }, form: 'dashboard', skin: 'blush-noir', skinDark: 'blush-noir', skinLight: 'blush' },
  // EMBER — "the night sky dreaming": a deep indigo void, drifting fireflies &
  // slow-rising bubbles, scattered pastel starlight, glowing soft-edged cards.
  // Distinct from Bloom (light/cozy) and Futuristic (hard/telemetry): Ember is
  // dark, soft, ethereal, and animated — pastels that glow on a midnight field.
  // Its light twin is a pale dawn sky (starfall-dawn).
  { id: 'ember', name: 'Ember', blurb: 'A starlit night dreaming \u2014 indigo void, fireflies, rising bubbles, pastel starlight.', patch: { chrome: 'ember', radius: 22, border: 1, texture: 'starfall', serif: F_ETHEREAL, accent: '#b8a9ff', accent2: '#8fd6c8', opacity: 0.92, blur: 12 }, form: 'dashboard', skin: 'starfall', skinDark: 'starfall', skinLight: 'starfall-dawn' },
  // FAEWILD — "the twilight storybook glade": a fairy-tale wood at dusk. Climbing
  // vines frame the window, fairy-light garlands catch in the dark (presence &
  // tension), toadstool tabs, pastel sage & lilac on a deep glade. Nature objects
  // dress every card. Distinct from Bloom (indoor cozy garden) & Ember (night sky):
  // Faewild is an enchanted forest — green-led, vined, storybook. Light twin = dawn glade.
  { id: 'faewild', name: 'Faewild', blurb: 'A twilight storybook glade \u2014 fairy lights, climbing vines, pastel sage &amp; lilac, toadstool tabs.', patch: { chrome: 'faewild', radius: 22, border: 1, texture: 'firefly-grove', serif: F_ETHEREAL, accent: '#8fbf88', accent2: '#c9b6f0', opacity: 0.94, blur: 10 }, form: 'dashboard', skin: 'faewild-dusk', skinDark: 'faewild-dusk', skinLight: 'faewild-dawn' },
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
  // Faewild Dusk — the twilight glade: a deep blue-green forest field, luminous
  // sage & lilac ink, warm-butter fairy-light glow, pastel-green semantics that
  // read against the wood. The recommended (dark) palette for the Faewild chrome.
  { id: 'faewild-dusk', name: 'Faewild Dusk', blurb: 'A twilight forest glade — deep blue-green field, sage & lilac ink, warm fairy-light glow.', theme: { accent: '#8fbf88', serif: F_ETHEREAL, mono: F_MONO, surf1: 'rgba(30,36,34,.62)', surf2: 'rgba(20,26,26,.58)', ink: '#e6efe0', ink2: '#aec2ac', glass: 'linear-gradient(168deg,rgba(24,32,32,.97),rgba(14,22,22,.985))', ...SEM, pos: '#a6d6a0', posInk: '#c2e8bc', neg: '#e79ab0', negInk: '#f2bccb', info: '#9bc8e8', warn: '#c9b6f0', press: '#f0c878', pressInk: '#f8dc9a' } },
  // --- LIGHT skins: the paired daytime twin for a chrome's dark default. Light
  // surfaces, dark ink, semantics preserved & darkened enough to read on white.
  // Modern's day face — clean paper white, cool slate ink, calm blue accent.
  { id: 'daylit', name: 'Daylit', blurb: 'A clean daytime card app — paper white, slate ink, cool blue.', theme: { accent: '#3f6fb0', serif: F_SANS, mono: F_MONO, surf1: 'rgba(255,255,255,.92)', surf2: 'rgba(240,243,248,.92)', ink: '#20242c', ink2: '#5a6472', glass: 'linear-gradient(168deg,#ffffff,#eef1f6)', ...SEM, pos: '#4f8a3f', posInk: '#3d7030', neg: '#c0504a', negInk: '#a63f3a', info: '#3f6fb0', warn: '#8a5aa8', press: '#c07f2a', pressInk: '#a5661a' } },
  // Futuristic's day face — bright chrome-white terminal, deep ink, teal HUD.
  { id: 'chrome-light', name: 'Daylight HUD', blurb: 'A bright command console — chrome white, deep ink, teal telemetry.', theme: { accent: '#0f9c94', serif: F_HUD, mono: F_MONO, surf1: 'rgba(244,247,248,.94)', surf2: 'rgba(228,234,236,.94)', ink: '#12201f', ink2: '#4a5c5a', glass: 'linear-gradient(168deg,#f4f7f8,#e2e9ea)', ...SEM, pos: '#3f8a5a', posInk: '#2f7048', neg: '#c0504a', negInk: '#a63f3a', info: '#0f7fa0', warn: '#6a5aa8', press: '#b57a1e', pressInk: '#9a6410' } },
  // Ember's day face — a pale dawn sky: soft lilac-white paper, plum ink, the
  // same lilac/mint accents so the chrome's fireflies & seal still read.
  { id: 'starfall-dawn', name: 'Ember Dawn', blurb: 'A pale dawn sky — soft lilac-white paper, plum ink, waking pastels.', theme: { accent: '#7a5fd0', serif: F_ETHEREAL, mono: F_MONO, surf1: 'rgba(250,247,255,.9)', surf2: 'rgba(240,235,250,.9)', ink: '#2a2340', ink2: '#6a5f88', glass: 'linear-gradient(168deg,#faf7ff,#efeafb)', ...SEM, pos: '#4f8a5f', posInk: '#3d7048', neg: '#c8607a', negInk: '#a84a62', info: '#4f7fb8', warn: '#9a6ac0', press: '#c08a2e', pressInk: '#a5701a' } },
  // Faewild's day face — a dawn glade: soft mint-white paper, mossy-green ink, the
  // same sage/lilac accents so the chrome's vines & fairy lights still read.
  { id: 'faewild-dawn', name: 'Faewild Dawn', blurb: 'A dawn glade — soft mint-white paper, mossy-green ink, waking woodland pastels.', theme: { accent: '#4f8a5f', serif: F_ETHEREAL, mono: F_MONO, surf1: 'rgba(247,252,246,.9)', surf2: 'rgba(236,246,235,.9)', ink: '#22301f', ink2: '#5c6f57', glass: 'linear-gradient(168deg,#f7fcf6,#eaf4e8)', ...SEM, pos: '#4f8a5f', posInk: '#3d7048', neg: '#c8607a', negInk: '#a84a62', info: '#4f7fb8', warn: '#7a5fd0', press: '#c08a2e', pressInk: '#a5701a' } },
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
  // woven artist's canvas — warm ochre warp/weft threads, a faint linen tooth
  { id: 'canvas', label: 'Canvas', css: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Cg stroke='%23b08840' stroke-opacity='0.09'%3E%3Cpath d='M0 4h16M0 12h16' stroke-width='2'/%3E%3Cpath d='M4 0v16M12 0v16' stroke-width='2'/%3E%3C/g%3E%3Cg stroke='%23000' stroke-opacity='0.05'%3E%3Cpath d='M0 8h16M8 0v16'/%3E%3C/g%3E%3C/svg%3E\")" },
  { id: 'firefly-grove', label: 'Firefly Grove', css: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='180'%3E%3Cg fill='%23f3c66b'%3E%3Ccircle cx='26' cy='31' r='1.5' fill-opacity='.35'/%3E%3Ccircle cx='176' cy='42' r='1' fill-opacity='.28'/%3E%3Ccircle cx='104' cy='139' r='1.4' fill-opacity='.3'/%3E%3Cpath d='M62 70l2 6 6 2-6 2-2 6-2-6-6-2 6-2z' fill-opacity='.18'/%3E%3C/g%3E%3Cg fill='none' stroke='%2393b39a' stroke-opacity='.12'%3E%3Cpath d='M0 168Q45 112 88 166T176 156T220 134'/%3E%3Cpath d='M22 148q18-28 36 0M164 150q16-26 32 0'/%3E%3C/g%3E%3Cg fill='%23668f88' fill-opacity='.14'%3E%3Cpath d='M43 132c15-15 27-5 18 11-11 5-19 1-18-11zm133-18c-14-13-25-4-17 11 11 4 18 0 17-11z'/%3E%3C/g%3E%3C/svg%3E\")" },
  // pressed flowers & inky flourishes — soft dusk-lilac line blooms with faint
  // sage leaves and a scattered ink dot, all hairline-thin (the light-academia
  // 'marginalia' texture: gentle, hand-drawn, no hard edges). Recommended for the
  // Marginalia chrome; composes with any chrome.
  { id: 'pressed-flowers', label: 'Pressed Flowers', css: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='190' height='190'%3E%3Cg fill='none' stroke='%23c8a9d8' stroke-opacity='.16' stroke-width='1.1'%3E%3Cg transform='translate(34 40)'%3E%3Ccircle r='3.4'/%3E%3Cpath d='M0 0C0-9 7-13 0-18M0 0C0-9-7-13 0-18M0 0C8-4 13 3 18 0M0 0C8 4 13-3 18 0M0 0C0 9 7 13 0 18M0 0C0 9-7 13 0 18M0 0C-8-4-13 3-18 0M0 0C-8 4-13-3-18 0'/%3E%3C/g%3E%3Cg transform='translate(140 132)'%3E%3Ccircle r='3'/%3E%3Cpath d='M0 0C0-8 6-11 0-15M0 0C0-8-6-11 0-15M0 0C7-3 11 3 15 0M0 0C7 4 11-3 15 0M0 0C0 8 6 11 0 15M0 0C0 8-6 11 0 15M0 0C-7-3-11 3-15 0M0 0C-7 4-11-3-15 0'/%3E%3C/g%3E%3C/g%3E%3Cg fill='none' stroke='%238fae8c' stroke-opacity='.13' stroke-width='1.1'%3E%3Cpath d='M96 26q10 8 6 22q-11-2-6-22z'/%3E%3Cpath d='M22 148q-9 7-6 20q10-3 6-20z'/%3E%3Cpath d='M168 58q9 6 6 18q-9-2-6-18z'/%3E%3C/g%3E%3Cg fill='%23b58fc8' fill-opacity='.12'%3E%3Ccircle cx='110' cy='70' r='1.4'/%3E%3Ccircle cx='60' cy='110' r='1.1'/%3E%3Ccircle cx='150' cy='168' r='1.2'/%3E%3C/g%3E%3C/svg%3E\")" },
];


const KEY = 'vellum2.theme';
const DEFAULT: Theme = {
  skin: 'illuminated', accent2: '#9bc0e6', accentIntensity: 1,
  scale: 1.12, dataScale: 1, density: 1,
  opacity: 1, blur: 8, radius: 18, border: 1, inkEmphasis: 1, texture: '', bg: '', surf1c: '', surf2c: '', motion: true,
  launcher: 'right', mode: 'dark', chrome: 'default', tensionStyle: 'both',
  cardShapes: {},
  ...SKINS[0]!.theme,
};

// Chromes cut in the six-chrome redesign remap to their nearest survivor so a
// saved theme never lands on an invalid chrome after update.
const CHROME_REMAP: Record<string, Chrome> = {
  nocturne: 'futuristic', atelier: 'illuminated', glimmerwood: 'bloom', marginalia: 'bloom',
};
const SKIN_REMAP: Record<string, string> = {
  nocturne: 'moonlit', atelier: 'vellum-dark', glimmerwood: 'blush-noir', marginalia: 'blush-noir',
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
let themePersistCb: (json: string) => void = () => {};
export function setThemePersist(cb: (json: string) => void): void { themePersistCb = cb; }
function persistTheme(): void { try { themePersistCb(JSON.stringify(_theme)); } catch { /* ignore */ } }
export function hydrateTheme(json: string | null): void {
  if (!json) return;
  try { const t = JSON.parse(json); if (t && t.accent) { _theme = sanitize({ ...DEFAULT, ...t }); } } catch { /* ignore */ }
}
function load(): Theme { try { const t = JSON.parse(localStorage.getItem(KEY) || ''); if (t && t.accent) return sanitize({ ...DEFAULT, ...t }); } catch { /* default */ } return { ...DEFAULT }; }
const CHROMES = ['default', 'illuminated', 'modern', 'futuristic', 'bloom', 'ember', 'faewild'] as const;
function sanitize(t: Theme): Theme {
  // migrate a cut chrome/skin to its nearest survivor before validating
  const rawChrome = t.chrome as string;
  const chrome = CHROMES.includes(t.chrome) ? t.chrome : (CHROME_REMAP[rawChrome] ?? 'default');
  const skin = SKIN_REMAP[t.skin as string] ?? t.skin;
  return { ...t, skin,
    accentIntensity: clamp(t.accentIntensity, 0.5, 1.6, 1), scale: clamp(t.scale, 0.85, 1.5, 1.12), dataScale: clamp(t.dataScale, 0.85, 1.3, 1),
    density: clamp(t.density, 0.7, 1.4, 1), opacity: clamp(t.opacity, 0.4, 1, 1), blur: clamp(t.blur, 0, 16, 8), radius: clamp(t.radius, 0, 24, 18),
    border: clamp(t.border, 0.5, 2.5, 1), inkEmphasis: clamp(t.inkEmphasis, 0.7, 1.15, 1),
    serif: safeFont(t.serif), mono: safeFont(t.mono),
    bg: safeHexOpt(t.bg), surf1c: safeHexOpt(t.surf1c), surf2c: safeHexOpt(t.surf2c),
    mode: t.mode === 'light' ? 'light' : 'dark',
    chrome,
    cardShapes: sanitizeCardShapes(t.cardShapes),
  };
}
function save(): void { try { localStorage.setItem(KEY, JSON.stringify(_theme)); } catch { /* ignore */ } persistTheme(); }

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
  document.documentElement.setAttribute('data-vle-mode', t.mode);
  document.documentElement.toggleAttribute('data-vle-bg', !!t.bg);
  document.documentElement.setAttribute('data-vle-motion', t.motion ? 'on' : 'off');
  // per-surface card shape. Emission rule:
  //   - explicit user override        -> emit the override (always wins)
  //   - a NON-default chrome, no ovr   -> emit that chrome's gallery shape
  //     (mockups 30-35), so picking Ember/Futuristic/etc. reshapes its cards
  //   - the DEFAULT chrome, no ovr     -> emit NOTHING, so the default theme is
  //     byte-identical to before (it keeps its bespoke per-card CSS geometry)
  for (const surface of SURFACES) {
    const o = t.cardShapes[surface];
    const shape = (o && SHAPE_IDS.includes(o)) ? o : (t.chrome !== 'default' ? CHROME_SHAPES[t.chrome][surface] : null);
    if (shape) document.documentElement.setAttribute('data-shape-' + surface, shape);
    else document.documentElement.removeAttribute('data-shape-' + surface);
  }
}

export function setSkin(id: string): void { const s = SKINS.find((x) => x.id === id); if (s) { _theme = sanitize({ ..._theme, skin: id, ...s.theme }); save(); } }
export function setMode(id: string): void {
  const m = MODES.find((x) => x.id === id);
  if (!m) return;
  // a mode is a one-click bundle: the chrome's skin for the CURRENT color mode
  // (dark/light) first, then the mode's own patch (chrome/radius/fonts/accent)
  // which wins over the skin.
  const skinId = _theme.mode === 'light' ? m.skinLight : m.skinDark;
  const skin = SKINS.find((x) => x.id === skinId);
  _theme = sanitize({ ..._theme, ...(skin ? { skin: skin.id, ...skin.theme } : {}), ...m.patch });
  save(); setLayout(m.form);
}
/** Flip the whole theme between dark and light, re-resolving the active chrome's
 * paired skin. Keeps chrome/layout; swaps only the palette. */
export function setColorMode(mode: 'dark' | 'light'): void {
  _theme = sanitize({ ..._theme, mode });
  const m = MODES.find((x) => x.id === _theme.chrome);
  if (m) {
    const skin = SKINS.find((x) => x.id === (mode === 'light' ? m.skinLight : m.skinDark));
    if (skin) _theme = sanitize({ ..._theme, skin: skin.id, ...skin.theme, ...m.patch });
  }
  save();
}
export function getColorMode(): 'dark' | 'light' { return _theme.mode; }
export function patchTheme(patch: Partial<Theme>): void { _theme = sanitize({ ..._theme, ...patch }); save(); }
export function resetTheme(): void { _theme = { ...DEFAULT }; save(); }
export function exportTheme(): string { return JSON.stringify(_theme, null, 2); }
export function importTheme(json: string): boolean { try { const t = JSON.parse(json); if (t && t.accent) { _theme = sanitize({ ...DEFAULT, ...t }); save(); return true; } } catch { /* ignore */ } return false; }

export { FONT_CHOICES, TEXTURES };

// --- tabbed Customize panel ---------------------------------------------
type CzTab = 'look' | 'skin' | 'mode' | 'layout' | 'color' | 'type' | 'window' | 'cards' | 'sections';

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
  const advanced: CzTab[] = ['skin', 'mode', 'layout', 'color', 'type', 'window', 'cards', 'sections'];
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
    faewild: '<span class="vle-mode-sk sk-faewild"><i></i><i></i><i></i></span>',
  };
  // dark/light segmented toggle — flips every chrome to its paired skin
  const modeToggle = '<div class="vle-cz-h">Mode</div><div class="vle-fbar" data-cz-colormode-bar>'
    + (['dark', 'light'] as const).map((mm) => `<button class="vle-fb-btn${t.mode === mm ? ' on' : ''}" data-cz-colormode="${mm}">${mm}</button>`).join('')
    + '</div>';

  const themeCards = MODES.map((m) => `<button class="vle-mode${t.chrome === m.id ? ' on' : ''}" data-mode="${m.id}" title="${m.blurb}">`
    + `${sketch[m.id]}<span class="vle-mode-n">${m.name}</span><span class="vle-mode-b">${m.blurb}</span></button>`).join('');
  let body = '';
  if (tab === 'look') {
    // the approachable front: pick a theme + set size. Everything else is Advanced.
    body = '<div class="vle-cz-h">Theme</div><div class="vle-modes">' + themeCards + '</div>'
      + modeToggle
      + slider('scale', 'Interface size', 0.85, 1.5, 0.05, t.scale, pct)
      + '<div class="vle-cz-note">Pick a look, a dark/light mode and size \u2014 that\u2019s usually all you need. For palettes, fonts, layout and window controls, open <b>Advanced</b> above.</div>';
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
  } else if (tab === 'cards') {
    // per-surface card shape. First option 'Auto' clears the override so the
    // surface falls back to the current chrome's default (shown in the label).
    const shapeLabel = (id: ShapeId): string => id.replace(/-/g, ' ');
    const row = (surface: Surface): string => {
      const def = CHROME_SHAPES[t.chrome][surface];
      const cur = t.cardShapes[surface];
      const opts = `<option value=""${cur ? '' : ' selected'}>Auto (${shapeLabel(def)})</option>`
        + SHAPE_IDS.map((id) => `<option value="${id}"${cur === id ? ' selected' : ''}>${shapeLabel(id)}</option>`).join('');
      return `<div class="vle-cz-h">${SURFACE_LABELS[surface]}${cur ? ` <span class="vle-cz-rst" data-cz-cardshape-reset="${surface}" title="Reset to Auto">\u21BA</span>` : ''}</div>`
        + `<div class="vle-cz-row"><select class="vle-cz-sel" data-cz-cardshape="${surface}">${opts}</select></div>`;
    };
    body = SURFACES.map(row).join('')
      + '<div class="vle-cz-note">Set a silhouette per card surface. <b>Auto</b> follows the current theme\u2019s default shape. Shapes are geometry only \u2014 palette &amp; type stay from your skin/theme. Exotic edges fall back to a rounded card where unsupported.</div>';
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
    else if (el.matches('[data-cz-cardshape]')) {
      const surface = el.getAttribute('data-cz-cardshape') as Surface;
      const next = { ...getTheme().cardShapes };
      if (el.value) next[surface] = el.value as ShapeId; else delete next[surface];
      patchTheme({ cardShapes: next }); rerender('cards'); reapply();
    }
    else if (el.matches('[data-clay]')) { import('./layout-defs.js').then((m) => { m.handleCustomLayoutChange(el); rerender('layout'); onChange(); }); }
  });
  host.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const tab = t.closest('[data-cz-tab]'); if (tab) { rerender(tab.getAttribute('data-cz-tab') as CzTab); return; }
    const csr = t.closest('[data-cz-cardshape-reset]'); if (csr) { const surface = csr.getAttribute('data-cz-cardshape-reset') as Surface; const next = { ...getTheme().cardShapes }; delete next[surface]; patchTheme({ cardShapes: next }); rerender('cards'); reapply(); return; }
    const rst = t.closest('[data-cz-reset]'); if (rst) { const k = rst.getAttribute('data-cz-reset')!; patchTheme({ [k]: (DEFAULT as unknown as Record<string, unknown>)[k] } as Partial<Theme>); rerender(curTab()); reapply(); return; }
    if (t.closest('[data-cz-resetall]')) { confirmModal('Reset all appearance settings to defaults?', () => { resetTheme(); rerender('skin'); reapply(); }); return; }
    if (t.closest('[data-cz-export]')) { try { const b = new Blob([exportTheme()], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'vellum-theme.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); } catch { /* ignore */ } return; }
    if (t.closest('[data-cz-import]')) { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json'; inp.addEventListener('change', () => { const f = inp.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => { if (importTheme(String(r.result))) { rerender('skin'); reapply(); } }; r.readAsText(f); }); inp.click(); return; }
    const sk = t.closest('[data-skin]'); if (sk) { setSkin(sk.getAttribute('data-skin')!); rerender('skin'); reapply(); return; }
    const md = t.closest('[data-mode]'); if (md) { setMode(md.getAttribute('data-mode')!); rerender('mode'); reapply(); return; }
    const cm = t.closest('[data-cz-colormode]'); if (cm) { setColorMode(cm.getAttribute('data-cz-colormode') as 'dark' | 'light'); rerender(curTab()); reapply(); return; }
    const lp = t.closest('[data-layout-pick]'); if (lp) { setLayout(lp.getAttribute('data-layout-pick')!); rerender('layout'); onChange(); return; }
    const dp = t.closest('[data-density-pick]'); if (dp) { setDensityOverride(dp.getAttribute('data-density-pick') as 'compact' | 'comfortable' | 'roomy'); rerender('layout'); onChange(); return; }
    const an = t.closest('[data-cz-autoname]'); if (an) { setAutoNameMode(an.getAttribute('data-cz-autoname') as 'off' | 'solid' | 'gradient'); rerender('color'); onChange(); return; }
    // custom-layout editor clicks are handled by layout-defs via delegation below
    if (t.closest('[data-clay]')) { import('./layout-defs.js').then((m) => { m.handleCustomLayoutClick(t); rerender('layout'); onChange(); }); }
  });
}
