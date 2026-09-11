// ============================================================================
// Vellum .lumitheme pack builder
// ----------------------------------------------------------------------------
// Emits importable .lumitheme files (format:3 zip of theme.json) for the live
// Lumiverse app. Two variants are emitted per theme:
//   * ${id}.lumitheme           — static (no animation)
//   * ${id}-animated.lumitheme  — animated (A: page pseudo-layer motion,
//                                 B: drifting portrait particles)
// so users can choose whether to install the animated look or the calm one.
//
// Each pack carries:
//   Layer 1 — theme: ThemeConfig   (palette / mode / radius / glass)
//   Layer 2 — globalCSS            (page background, textures, palette vars, fonts)
//   Layer 3 — components.MinimalMessage {css, tsx, enabled}  (portrait-rail bubble)
//
// The TSX override obeys the component-override sandbox:
//   * export default function MinimalMessage({...}) { return (...) }
//   * only whitelisted host tags (div/span/header/article/img/button/em/...)
//   * slot tags <Content/> <Reasoning/> <Attachments/> for the real message body
//   * onClick only on <button>/<a>, bound to actions.* / editing.*
//   * NO svg/path/defs — so the mockups' inline SVG figures are replaced by the
//     painterly gradient portrait scene + the real avatarUrl image.
//   * source kept < 5000 chars (MAX_OVERRIDE_SOURCE_LENGTH)
//
// sanitizeCSS() in the live app strips @import and external url(https://…) but
// PRESERVES data: URIs, @keyframes and animation: — proven in production by the
// already-shipped gatsby vmShimmer/vmPulse and ember vmTwinkleBg. So animation
// is zero-risk.
// ============================================================================

import { zipSync, strToU8 } from 'fflate'
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { randomUUID, createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, 'dist')
const FONT_CACHE = join(HERE, '.fontcache')
mkdirSync(OUT, { recursive: true })
mkdirSync(FONT_CACHE, { recursive: true })
const NOW = Math.floor(Date.now() / 1000)
const AUTHOR = 'Vellum'

// ── Font bundling (as theme assets, not base64) ─────────────────────────────
// sanitizeCSS() strips @import and external url(https://…) but PRESERVES
// relative url(assets/…) references, which the app rewrites at runtime to the
// per-bundle asset API (/api/v1/theme-assets/bundles/<id>/assets/…). So instead
// of inlining fonts as huge base64 data: URIs (which bloated globalCSS and made
// the theme source unreadable), we ship each woff2 as a real file inside the
// .lumitheme zip and emit a clean @font-face that points at its relative path.
//
// For each theme we fetch the Google-Fonts css2 sheet, keep the latin subset
// only (to keep packs small), download each woff2, and hand back:
//   * faces  — the @font-face CSS block (src → url(assets/fonts/<file>.woff2))
//   * assets — [{ archivePath, slug, originalFilename, mimeType, bytes }] so the
//              emitter can drop the bytes into the zip and list them in the
//              manifest. On import the app uploads them and the relative URLs
//              resolve. A failed fetch degrades to the system fallbacks already
//              baked into the --vm-* font vars.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'

// Directory (slug prefix) the bundled font files live under, inside each pack.
const FONT_DIR = 'assets/fonts'

async function cachedGet(url, binary) {
  const key = createHash('sha1').update(url).digest('hex') + (binary ? '.bin' : '.txt')
  const p = join(FONT_CACHE, key)
  if (existsSync(p)) return binary ? readFileSync(p) : readFileSync(p, 'utf8')
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`fetch ${res.status} ${url}`)
  if (binary) {
    const buf = Buffer.from(await res.arrayBuffer())
    writeFileSync(p, buf)
    return buf
  }
  const txt = await res.text()
  writeFileSync(p, txt, 'utf8')
  return txt
}

function importUrl(fontsImport) {
  const m = fontsImport.match(/url\((['"]?)(https?:\/\/[^)'"]+)\1\)/i)
  return m ? m[2] : null
}

// Build a stable, filesystem-safe font file name from a @font-face block, e.g.
// "eb-garamond-400-italic.woff2". Mirrors the server's slug normalization so the
// url() we emit resolves to the uploaded asset without surprises.
function fontFileName(family, weight, style) {
  const slug = (s) =>
    String(s)
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .toLowerCase() || 'font'
  return `${slug(family)}-${slug(weight || '400')}-${slug(style || 'normal')}.woff2`
}

async function bundleFonts(fontsImport) {
  const empty = { faces: '', assets: [] }
  const url = importUrl(fontsImport)
  if (!url) return empty

  let css
  try {
    css = await cachedGet(url, false)
  } catch (e) {
    console.warn('  ! font sheet fetch failed → system fallback:', e.message)
    return empty
  }

  // Each @font-face is preceded by a /* subset */ comment (latin, latin-ext, …).
  const blocks = css.split(/(?=\/\*[^*]+\*\/\s*@font-face)/g)
  const faces = []
  const assets = []
  const seen = new Set()

  for (const block of blocks) {
    const sub = block.match(/\/\*\s*([^*]+?)\s*\*\//)
    if (!sub || sub[1].trim() !== 'latin') continue // latin subset only keeps packs small

    const woff2 = block.match(/url\((https:\/\/[^)]+\.woff2)\)/i)
    if (!woff2) continue

    const family = (block.match(/font-family:\s*(['"]?)([^;'"]+)\1/i) || [])[2] || 'font'
    const weight = (block.match(/font-weight:\s*([^;]+)/i) || [])[1]?.trim()
    const style = (block.match(/font-style:\s*([^;]+)/i) || [])[1]?.trim()

    const fileName = fontFileName(family, weight, style)
    if (seen.has(fileName)) continue
    seen.add(fileName)

    let bytes
    try {
      bytes = await cachedGet(woff2[1], true)
    } catch (e) {
      console.warn('  ! woff2 fetch failed:', e.message)
      continue
    }

    const relPath = `${FONT_DIR}/${fileName}`
    // Rebuild the @font-face: drop the subset comment + unicode-range, and point
    // src at the bundled relative asset path (kept multi-line for readability).
    const face = block
      .replace(/\/\*[^*]+\*\/\s*/, '')
      .replace(
        /src:\s*url\([^)]+\)\s*format\(([^)]+)\)/i,
        `src: url(${relPath}) format($1)`,
      )
      .replace(/unicode-range:[^;]+;/i, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\s*;\s*/g, ';\n  ')
      .replace(/\{\s*/g, ' {\n  ')
      .replace(/\s*\}\s*/g, '\n}')
      .trim()

    faces.push(face)
    assets.push({
      archivePath: relPath,
      slug: relPath,
      originalFilename: fileName,
      mimeType: 'font/woff2',
      bytes,
    })
  }

  return { faces: faces.join('\n\n'), assets }
}


// ── Chat-skin CSS mapping (Approach A: no TSX override) ──────────────────────
// The Vellum look is applied entirely through globalCSS that restyles the app's
// DEFAULT MinimalMessage renderer, so every recipient keeps working swipes, the
// real edit window, all action buttons, TTS, and the context menu on a stock,
// unmodified Lumiverse. We hook the stable, forge-proof selectors the app emits:
//
//   [data-component="MinimalMessage"]  — the message card (flex row → grid rail)
//   [data-part="user|character|streaming"]
//   [class*="avatar" i]   — the portrait cell (CSS-module class, matched loosely)
//   [class*="bubble" i]   — the text column
//   [class*="header" i]   — name + meta row
//   [class*="name" i]     — display name
//   [class*="metaPill" i] — meta chip
//   [class*="actionsWrap" i] — hover action row
//   [data-component="MessageContent"] — the real formatted prose
//   [data-component="SwipeControls"]  — the real swipe buttons (fully working)
//
// CSS-module names are hashed (e.g. `.card`→`_card_1xd55_327`) so we never target
// the bare readable class; `[class*="avatar" i]` matches the surviving substring,
// exactly as the app's own base CSS does (`[class*=avatarFallback i]`). All rules
// are scoped under the card so they can't leak into other components. Because the
// theme <style> is injected last and unlayered, these win without heavy
// !important — a few are used only where a module rule has higher specificity.
//
// Custom decorative layers the old override built as real DOM (portrait gradient
// fill, film grain, gilt frame, drifting particles) are recreated with
// ::before/::after pseudo-elements on the existing nodes.

// short alias helpers for the default-renderer DOM, scoped to the card
const CARD = '[data-component="MinimalMessage"]'
const USER = `${CARD}[data-part="user"]`
const AV = `${CARD} [class*="avatar" i]:not([class*="avatarFallback" i])`
const AVBOX = `${CARD} [class*="avatar" i]:not([class*="avatarFallback" i])`

// ── Structural skeleton: turn the default flex card into the portrait-rail grid
// and prepare the avatar cell + content column as positioning contexts for the
// pseudo-element skin layers. Mirrors the old SKELETON but on real DOM hooks.
const SKELETON = `
/* card → portrait-rail grid */
${CARD}{--vm-avatar-w:clamp(150px,18vw,260px);position:relative;display:grid !important;grid-template-columns:var(--vm-avatar-w) minmax(0,1fr);column-gap:clamp(14px,1.6vw,26px);align-items:start;gap:0;padding:0 !important;background:transparent !important;border:0 !important;margin-bottom:clamp(28px,3.4vw,52px) !important;font-family:var(--vm-body,inherit)}
/* neutralize the default card's accent pseudos (::after is reclaimed by the
   animated variant for a second particle cluster, so only hide ::before here) */
${CARD}::before{display:none !important}
${CARD}::after{display:none}
${USER}{grid-template-columns:minmax(0,1fr) var(--vm-avatar-w) !important}
/* avatar cell → tall masked sticky portrait rail */
${AVBOX}{grid-column:1;grid-row:1;justify-self:start;position:sticky !important;top:24px;width:var(--vm-avatar-w) !important;height:clamp(360px,52vh,560px) !important;border-radius:var(--vm-radius) !important;overflow:hidden !important;isolation:isolate;border:0 !important;-webkit-mask-image:linear-gradient(to right,#000 0,#000 52%,rgba(0,0,0,.86) 68%,rgba(0,0,0,.44) 86%,transparent 100%),linear-gradient(to bottom,#000 0,#000 64%,rgba(0,0,0,.72) 82%,transparent 100%);mask-image:linear-gradient(to right,#000 0,#000 52%,rgba(0,0,0,.86) 68%,rgba(0,0,0,.44) 86%,transparent 100%),linear-gradient(to bottom,#000 0,#000 64%,rgba(0,0,0,.72) 82%,transparent 100%);-webkit-mask-composite:source-in;mask-composite:intersect}
${USER} [class*="avatar" i]:not([class*="avatarFallback" i]){grid-column:2;justify-self:end;-webkit-mask-image:linear-gradient(to left,#000 0,#000 52%,rgba(0,0,0,.86) 68%,rgba(0,0,0,.44) 86%,transparent 100%),linear-gradient(to bottom,#000 0,#000 64%,rgba(0,0,0,.72) 82%,transparent 100%);mask-image:linear-gradient(to left,#000 0,#000 52%,rgba(0,0,0,.86) 68%,rgba(0,0,0,.44) 86%,transparent 100%),linear-gradient(to bottom,#000 0,#000 64%,rgba(0,0,0,.72) 82%,transparent 100%)}
/* the real avatar <img>/container fills the rail */
${AVBOX} img{width:100% !important;height:100% !important;object-fit:cover !important;z-index:1}
${AVBOX}>div{position:absolute !important;inset:0;width:100% !important;height:100% !important}
/* portrait gradient fill BEHIND the avatar image (theme skins paint --portraitA) */
${AVBOX}::before{content:"";position:absolute;inset:0;z-index:0;background:var(--vm-portraitA,transparent)}
${USER} [class*="avatar" i]:not([class*="avatarFallback" i])::before{background:var(--vm-portraitB,transparent)}
/* grain / vignette / frame layer OVER the avatar image */
${AVBOX}::after{content:"";position:absolute;inset:0;z-index:3;pointer-events:none}
/* text column */
${CARD} [class*="bubble" i]{grid-column:2;min-width:0;max-width:none !important}
${USER} [class*="bubble" i]{grid-column:1}
/* header: name over a small caps pill row */
${CARD} [class*="header" i]{display:flex !important;flex-direction:column;align-items:center;gap:.35rem;padding:8px 16px 16px;position:relative;margin-bottom:0 !important}
/* meta pill restyled as the small-caps "in scene" chip */
${CARD} [class*="metaPill" i]{font-family:var(--vm-serif,inherit);letter-spacing:.12em;text-transform:uppercase;opacity:.72;background:transparent !important;border:0 !important;color:var(--lumiverse-text-2) !important}
/* content wrapper = the prose card (theme skins add borders/bg via pseudos) */
${CARD} [class*="bubble" i]>[data-component="MessageContent"],${CARD} [class*="bubble" i]>[class*="reasoning" i]{position:relative;isolation:isolate}
${CARD} [data-component="MessageContent"]{position:relative;isolation:isolate;padding:20px 24px;border-radius:var(--vm-radius)}
${CARD} [data-component="MessageContent"]>*{position:relative;z-index:1}
/* justified illuminated-prose type */
${CARD} [data-component="MessageContent"]{font-size:calc(16px * var(--lumiverse-font-scale,1));line-height:1.76;text-align:justify;hyphens:auto;text-wrap:pretty;font-family:var(--vm-body,inherit)}
${CARD} [data-component="MessageContent"] *{font-size:inherit}
/* particle motes: up to 5 per rail, inert (static) unless the animated variant turns them on */
${AVBOX} span[class*="mote"]{display:none}
/* swipe controls + actions: center them, themed pill styling */
${CARD} [data-component="SwipeControls"]{justify-content:center;margin-top:14px;opacity:.9}
${CARD} [class*="actionsWrap" i]{opacity:.55;transition:opacity .2s}
${CARD}:hover [class*="actionsWrap" i]{opacity:1}
@media(max-width:720px){${CARD}{--vm-avatar-w:clamp(64px,26vw,120px)}${AVBOX}{height:clamp(180px,48vw,300px) !important;top:14px}}
`

// ── Skin translator: .vm-* authoring vocabulary → real default-renderer DOM ──
// The per-theme `skin`/`anim.component` blocks are authored against the old
// override's custom DOM (.vm-avatar, .vm-content, .vm-portraitA…). Approach A
// has no custom DOM, so we translate those selectors onto the stable hooks the
// stock renderer emits, allocating pseudo-element "slots" so decorative layers
// that were separate elements before still have somewhere to live:
//
//   .vm-portraitA/B  → captured into --vm-portraitA/B vars (skeleton paints them
//                      on the avatar-cell ::before, behind the real avatar image)
//   .vm-grain        → avatar image container ::after   (LazyImage's inner <div>)
//   .vm-avatar::after→ avatar cell ::after              (frame / vignette)
//   .vm-avatar::before (deco bars) → avatar container ::before
//   .vm-content      → [data-component="MessageContent"] (the real prose card)
//   .vm-content::before/::after → the prose card's own two pseudos (frame/bars)
//   .vm-leafgrain    → bubble ::before (an extra prose-card underlay slot)
//   .vm-header::before → header ::before
//   .vm-name/.vm-pill/.vm-prose → the class hooks
//   .vm-mote/.vm-mN  → collapsed into layered backgrounds on one animated pseudo
//                      (avatar container ::before), since there are no mote nodes
const AVIMG = `${CARD} [class*="avatar" i]:not([class*="avatarFallback" i]) > div` // LazyImage wrapper
const CONTENT = `${CARD} [data-component="MessageContent"]`
const BUBBLE = `${CARD} [class*="bubble" i]`
const HEADER = `${CARD} [class*="header" i]`

// Capture `.vm-portraitA/B{background:…}` blocks into CSS custom properties so
// the skeleton's avatar-cell ::before can paint them behind the real image.
function extractPortraitVars(skin) {
  const vars = []
  let rest = skin
  for (const key of ['A', 'B']) {
    const re = new RegExp(`\\.vm-portrait${key}\\{background:([\\s\\S]*?)\\}`, 'i')
    const m = rest.match(re)
    if (m) {
      vars.push(`--vm-portrait${key}:${m[1].trim()}`)
      rest = rest.replace(re, '')
    }
  }
  return { portraitVars: vars.join(';'), rest }
}

// Rewrite the remaining `.vm-*` selectors onto real DOM. Ordering matters:
// longer / more specific patterns first so we don't partially match.
function translateSelectors(css) {
  const map = [
    // user-variant portrait name gradients etc. (handle `.vm-user .vm-x` first)
    [/\.vm-user\s+\.vm-name/g, `${USER} [class*="name" i]`],
    [/\.vm-user\s+\.vm-content::before/g, `${USER} ${'[data-component="MessageContent"]'}::before`],
    [/\.vm-user\s+\.vm-content::after/g, `${USER} ${'[data-component="MessageContent"]'}::after`],
    [/\.vm-user\s+\.vm-content/g, `${USER} [data-component="MessageContent"]`],
    [/\.vm-user\s+\.vm-avatar::before/g, `${USER} [class*="avatar" i]:not([class*="avatarFallback" i]) > div::before`],
    [/\.vm-user\s+\.vm-avatar::after/g, `${USER} [class*="avatar" i]:not([class*="avatarFallback" i])::after`],
    // avatar layers
    [/\.vm-avatar::after/g, `${AVBOX}::after`],
    [/\.vm-avatar::before/g, `${AVIMG}::before`],
    [/\.vm-grain/g, `${AVIMG}::after`],
    // prose-card layers
    [/\.vm-leafgrain/g, `${BUBBLE}::before`],
    [/\.vm-content::before/g, `${CONTENT}::before`],
    [/\.vm-content::after/g, `${CONTENT}::after`],
    [/\.vm-content/g, CONTENT],
    // header + text
    [/\.vm-header::before/g, `${HEADER}::before`],
    [/\.vm-name/g, `${CARD} [class*="name" i]`],
    [/\.vm-pill/g, `${CARD} [class*="metaPill" i]`],
    [/\.vm-prose\s*>\s*p:first-of-type::first-letter/g, `${CONTENT} > p:first-of-type::first-letter, ${CONTENT} p:first-of-type::first-letter`],
    [/\.vm-prose\s+\*/g, `${CONTENT} *`],
    [/\.vm-prose/g, CONTENT],
    // root token holder
    [/\.vm\{/g, `${CARD}{`],
    [/\.vm-user\s+/g, `${USER} `],
  ]
  let out = css
  for (const [re, sub] of map) out = out.replace(re, sub)
  return out
}

// Motes had five real spans, each with its own position, size, keyframe,
// duration and delay. The stock DOM has no mote nodes and an element only gives
// us ::before/::after, so we cannot reproduce five independently-timed spans.
// Instead we recreate the effect as close as Approach A allows, using the two
// pseudo hosts that sit over the portrait rail:
//
//   Group A → ${AVIMG}::before  (inside the sticky rail; stays aligned always)
//   Group B → ${CARD}::after    (reclaimed from the skeleton; a second cluster)
//
// Each host paints several particles as layered radial-gradients, and each host
// runs the theme's OWN verbatim @keyframes but with a DIFFERENT duration/delay
// taken from the original motes — so the two clusters drift out of phase with
// each other (independent motion) instead of the old single lockstep layer.
// Within a cluster the particles also travel distinct paths, because we compose
// the theme keyframe (element transform) with a generated `vmDrift*` keyframe
// that nudges each background layer's position independently.
function translateMotes(animComponent, themeId) {
  if (!animComponent) return ''

  // Derive the particle tint from the theme's mote glyph (first colour stop).
  const gm = animComponent.match(/\.vm-mote\{[^}]*background:([^;}]+)[;}]/i)
  const glyph = gm ? gm[1].trim() : 'radial-gradient(circle,#fff,transparent 70%)'
  const tint = (glyph.match(/#[0-9a-f]{3,8}|rgba?\([^)]+\)/i) || ['#fff'])[0]

  // Per-mote `animation:` shorthands (keyframe name + duration + delay + …), in
  // source order, so each cluster can adopt an authentic, distinct timing.
  const perMote = [...animComponent.matchAll(/\.vm-m\d\{[^}]*animation:\s*([^;}]+)[;}]/gi)].map((m) => m[1].trim())
  const animA = perMote[0] || ''
  // Pick a later mote's timing for cluster B so it runs out of phase with A.
  const animB = perMote[2] || perMote[perMote.length - 1] || animA

  // Keep the theme's @keyframes verbatim (element transform: rise / fall / drift).
  const keyframes = [...animComponent.matchAll(/@keyframes[^{]+\{[\s\S]*?\}\s*\}/g)].map((m) => m[0]).join('\n')

  // A dedicated per-theme drift keyframe that shifts each background layer by a
  // different small offset, giving intra-cluster variation on top of the shared
  // element transform. background-size < 100% leaves room for the shift.
  const drift = `vmDrift_${themeId.replace(/[^a-z0-9]/gi, '')}`

  // Render a particle cluster: `spots` are per-layer positions; `sizes` the dot
  // radii. Layers are non-repeating so background-position can move them.
  const cluster = (spots, sizes) => {
    const bg = spots.map((pos, i) => `radial-gradient(${sizes[i]}px ${sizes[i]}px at ${pos}, ${tint}, transparent 62%)`).join(',')
    const size = spots.map(() => '140% 140%').join(',')
    return { bg, size }
  }

  const a = cluster(['20% 72%', '48% 88%', '72% 58%'], [3, 2, 3])
  const b = cluster(['34% 40%', '80% 30%'], [2, 3])

  return `
/* animated portrait particles (approach B) — two independently-timed clusters */
${AVIMG}::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  background: ${a.bg};
  background-repeat: no-repeat;
  background-size: ${a.size};
  opacity: .8;
  ${animA ? `animation: ${animA}, ${drift} 6s ease-in-out infinite;` : ''}
}
/* second cluster on the reclaimed card ::after, positioned over the rail */
${CARD}::after {
  content: "" !important;
  display: block !important;
  position: absolute;
  top: 24px;
  left: 0;
  width: var(--vm-avatar-w);
  height: clamp(360px, 52vh, 560px);
  z-index: 2;
  pointer-events: none;
  background: ${b.bg};
  background-repeat: no-repeat;
  background-size: ${b.size};
  opacity: .7;
  ${animB ? `animation: ${animB}, ${drift} 7.5s ease-in-out .8s infinite reverse;` : ''}
}
${USER}::after { left: auto; right: 0; }
@media (max-width: 720px) {
  ${CARD}::after { top: 14px; height: clamp(180px, 48vw, 300px); }
}
@keyframes ${drift} {
  0%, 100% { background-position: 0 0, 0 0, 0 0; }
  50% { background-position: 6% -10%, -8% 6%, 4% -6%; }
}
${keyframes}
`
}

// helper: hsl accent
const hsl = (h, s, l) => ({ h, s, l })

// ── App-chrome theming: live Lumiverse drawer rail + composer ────────────────
// Every pack also restyles the app's drawer tabs (ViewportDrawer) and input area
// (InputArea) so the whole chat frame matches the chrome, not just the message
// bubble. We target the app's STABLE hooks — [data-spindle-mount="sidebar"],
// [data-component="InputArea"] — plus CSS-module substring classes
// ([class*="tabBtn"], button[class*="sendBtn"], [class*="inputWrapper"], …),
// which keep their base name in the production build (verified against the built
// bundle: ._tabBtn_lclsg_121, ._sendBtn_zb2ko_1663, ._inputWrapper_zb2ko_1101).
// sanitizeCSS() preserves attribute selectors, [class*=], !important and
// color-mix() (dreamgarden/floribunda shipped the same shape in production), so
// this is safe. Palette-driven from t.base, with a per-theme signature (corner
// radius / active-tab rail accent / send-button treatment / frame flourish).
//
// Fields (all optional; sensible palette-derived fallbacks): radius (px),
// rail (active-tab rail + active text colour), sendFg (send-button text),
// send / composer / inputwrap / sidebar (extra decl strings, win over the base
// because they are emitted last in their block), extra (freeform trailing rules).
const APP_SIG = {
  // ── legacy chromes (tasteful, palette-derived signatures) ──
  'vellum-fantasy': { radius: 10, sendFg: '#231a10' },
  'vellum-gatsby': { radius: 2, sendFg: '#0a0806', rail: '#e8c85a',
    composer: 'box-shadow:0 0 0 1px color-mix(in srgb,#d4af37 45%,transparent),0 0 0 3px #0a0806,0 14px 34px rgba(0,0,0,.6) !important' },
  'vellum-ember': { radius: 16, sendFg: '#0d0d1a',
    composer: 'box-shadow:0 0 26px rgba(184,169,255,.16),0 14px 34px rgba(8,8,24,.6) !important',
    send: 'box-shadow:0 0 14px rgba(184,169,255,.45) !important' },
  'vellum-bloom': { radius: 16, sendFg: '#1a0e16' },
  'vellum-faewild': { radius: 16, sendFg: '#101a14',
    composer: 'box-shadow:0 0 24px rgba(143,191,136,.16),0 14px 34px rgba(8,20,16,.55) !important' },
  // ── maximalist + nature chromes (ported from lumiverse-chrome-ui mockup) ──
  'vellum-arcade': { radius: 3, sendFg: '#0a0710', rail: '#2ef0ff',
    composer: 'border:2px solid #2ef0ff !important;box-shadow:0 0 0 1px rgba(255,46,166,.4),0 0 24px rgba(255,46,166,.3),0 14px 34px rgba(0,0,0,.6) !important',
    inputwrap: 'border-radius:2px !important',
    send: 'box-shadow:4px 4px 0 rgba(46,240,255,.5) !important',
    sidebar: 'border-right:2px solid #ff2ea6 !important',
    extra: `[data-spindle-mount="sidebar"]{position:relative}[data-spindle-mount="sidebar"]::after{content:"";position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(46,240,255,.05) 0 2px,transparent 2px 4px)}` },
  'vellum-riot': { radius: 0, sendFg: '#101014', rail: '#c400ff',
    composer: 'border:3px solid #ececdf !important;border-radius:0 !important;box-shadow:6px 6px 0 #c400ff,0 14px 34px rgba(0,0,0,.5) !important',
    inputwrap: 'border-radius:0 !important',
    send: 'border-radius:0 !important;box-shadow:3px 3px 0 #c400ff !important',
    sidebar: 'border-right:3px solid #c400ff !important' },
  'vellum-grimoire': { radius: 12, sendFg: '#ffffff', rail: '#2fd48f',
    composer: 'box-shadow:0 0 30px rgba(162,76,255,.2),0 14px 34px rgba(6,3,16,.6) !important',
    send: 'background:linear-gradient(135deg,#a24cff,#2fd48f) !important;box-shadow:0 0 16px rgba(162,76,255,.5) !important' },
  'vellum-bestiary': { radius: 4, sendFg: '#241a10', rail: '#a3243a',
    composer: 'border:2px solid #c8a24e !important;box-shadow:inset 0 0 0 1px rgba(200,162,78,.4),inset 0 0 0 3px rgba(38,28,18,.95),inset 0 0 0 4px rgba(163,36,58,.3),0 14px 34px rgba(0,0,0,.5) !important',
    sidebar: 'border-right:3px double #c8a24e !important' },
  'vellum-terracotta': { radius: 8, sendFg: '#f6ead7', rail: '#2f8f8f',
    composer: 'box-shadow:inset 0 0 0 3px rgba(255,255,255,.06),inset 0 0 0 4px rgba(47,143,143,.14),0 14px 34px rgba(90,50,24,.5) !important',
    send: 'background:linear-gradient(135deg,#c96f4a,#a8542f) !important' },
  'vellum-terracotta-dark': { radius: 8, sendFg: '#1c120b', rail: '#3fa6a6',
    composer: 'box-shadow:inset 0 0 0 3px rgba(255,235,205,.05),inset 0 0 0 4px rgba(63,166,166,.16),0 14px 34px rgba(6,3,1,.55) !important',
    send: 'background:linear-gradient(135deg,#d0764f,#a8542f) !important' },
  'vellum-greenhouse': { radius: 16, sendFg: '#ffffff',
    composer: 'border-color:rgba(198,154,62,.5) !important;border-radius:6px 6px 18px 18px !important',
    inputwrap: 'border-radius:6px 6px 14px 14px !important',
    send: 'border-radius:6px 6px 14px 14px !important;background:radial-gradient(circle at 35% 30%,#6cbf6c,#3f8f57) !important',
    extra: `[data-spindle-mount="sidebar"]{background-image:linear-gradient(rgba(63,143,87,.1) 1px,transparent 1px),linear-gradient(90deg,rgba(63,143,87,.1) 1px,transparent 1px) !important;background-size:28px 28px !important}` },
  'vellum-greenhouse-dark': { radius: 16, sendFg: '#0e1811',
    composer: 'border-color:rgba(208,169,74,.5) !important;border-radius:6px 6px 18px 18px !important',
    inputwrap: 'border-radius:6px 6px 14px 14px !important',
    send: 'border-radius:6px 6px 14px 14px !important;background:radial-gradient(circle at 35% 30%,#6cbf6c,#3f8f57) !important',
    extra: `[data-spindle-mount="sidebar"]{background-image:linear-gradient(rgba(90,174,110,.1) 1px,transparent 1px),linear-gradient(90deg,rgba(90,174,110,.1) 1px,transparent 1px) !important;background-size:28px 28px !important}` },
  'vellum-greenhouse-dark': { radius: 16, sendFg: '#0e1811',
    composer: 'border-color:rgba(208,169,74,.5) !important;border-radius:6px 6px 18px 18px !important',
    inputwrap: 'border-radius:6px 6px 14px 14px !important',
    send: 'border-radius:6px 6px 14px 14px !important;background:radial-gradient(circle at 35% 30%,#6cbf6c,#3f8f57) !important',
    extra: `[data-spindle-mount="sidebar"]{background-image:linear-gradient(rgba(90,174,110,.12) 1px,transparent 1px),linear-gradient(90deg,rgba(90,174,110,.12) 1px,transparent 1px) !important;background-size:28px 28px !important}` },
  'vellum-aurora': { radius: 14, sendFg: '#04140f', rail: '#9a6cff',
    composer: 'border-color:rgba(79,240,192,.3) !important;box-shadow:0 0 34px rgba(79,240,192,.12),0 14px 34px rgba(2,6,18,.6) !important',
    send: 'box-shadow:0 0 16px rgba(79,240,192,.5) !important',
    extra: `[data-component="InputArea"]::after{content:"";position:absolute;top:0;left:14px;right:14px;height:2px;pointer-events:none;z-index:2;background:linear-gradient(90deg,#4ff0c0,#9a6cff,#6ab8ff,#4ff0c0);box-shadow:0 0 10px rgba(79,240,192,.5)}` },
  'vellum-rosace': { radius: 10, sendFg: '#f0ecff', rail: '#e0243f',
    composer: 'border:2.5px solid #05040a !important;border-radius:10px 10px 4px 4px !important;box-shadow:inset 0 0 22px rgba(31,111,224,.16),0 14px 34px rgba(0,0,0,.6) !important',
    send: 'background:linear-gradient(160deg,#1f6fe0,#9a4ce0) !important;box-shadow:0 0 12px rgba(31,111,224,.5) !important' },
}

function appChrome(t) {
  const p = t.base.primary
  const tx = t.base.text
  const bg = t.base.background
  const S = APP_SIG[t.id] || {}
  const R = S.radius != null ? S.radius : Math.max(0, Math.round((t.radiusScale || 1) * 8))
  const ri = Math.max(0, R - 2) // inner radius (tabs / wrapper / send / attach)
  const rail = S.rail || p // active-tab rail + active text colour
  const sendFg = S.sendFg || '#ffffff'
  const mix = (c, pct) => `color-mix(in srgb, ${c} ${pct}%, transparent)`
  return `
/* ── ${t.name}: themed drawer rail + composer (live Lumiverse app chrome) ── */
[data-spindle-mount="sidebar"]{background:color-mix(in srgb, ${p} 7%, ${bg}) !important;border-color:${mix(p, 22)} !important${S.sidebar ? `;${S.sidebar}` : ''}}
[class*="drawerTab"]{background:color-mix(in srgb, ${p} 6%, ${bg}) !important;border-color:${mix(p, 30)} !important;color:${mix(tx, 65)} !important}
[class*="drawerTab"] [class*="tabIconBox"]{color:${p} !important}
[class*="tabBtn"]{color:${mix(tx, 55)} !important;font-family:var(--vm-body, inherit) !important;border-radius:${ri}px !important}
[class*="tabBtn"]:hover{background:${mix(p, 15)} !important;color:${tx} !important}
[class*="tabBtnActive"]{background:${mix(p, 20)} !important;color:${rail} !important;box-shadow:inset 3px 0 0 ${rail} !important}
[class*="tabLabel"]{font-family:var(--vm-body, inherit) !important}
[class*="tabBtnActive"] [class*="tabLabel"]{color:${rail} !important}
[class*="panelHeader"]{background:${mix(p, 8)} !important;border-bottom-color:${mix(p, 18)} !important}
[class*="panelTitle"]{font-family:var(--vm-serif, inherit) !important;color:${tx} !important}
[data-component="InputArea"]{border-radius:${R}px !important;border:1px solid ${mix(p, 42)} !important;font-family:var(--vm-body, inherit) !important${S.composer ? `;${S.composer}` : ''}}
[data-component="InputArea"] [class*="actionBtn"]{color:${mix(tx, 45)} !important}
[data-component="InputArea"] [class*="actionBtn"]:hover{color:${tx} !important;background:${mix(p, 10)} !important}
[data-component="InputArea"] [class*="actionBtn"][class*="HasSelection"]{color:${p} !important;background:${mix(p, 12)} !important}
[data-component="InputArea"] [class*="inputWrapper"]{border-radius:${ri}px !important;background:${mix(p, 5)} !important;box-shadow:inset 0 0 0 1px ${mix(p, 18)} !important${S.inputwrap ? `;${S.inputwrap}` : ''}}
[data-component="InputArea"] [class*="inputWrapper"]:focus-within{background:${mix(p, 8)} !important;box-shadow:inset 0 0 0 1px ${mix(p, 55)}, 0 0 0 2px ${mix(p, 22)} !important}
[data-component="InputArea"] [class*="textarea"]{font-family:var(--vm-body, inherit) !important}
[data-component="InputArea"] [class*="attachBtn"]{border-radius:${ri}px !important;color:${mix(tx, 45)} !important}
[data-component="InputArea"] [class*="attachBtn"]:hover{color:${tx} !important;background:${mix(p, 10)} !important}
[data-component="InputArea"] button[class*="sendBtn"]{border-radius:${ri}px !important;background:${p} !important;color:${sendFg} !important${S.send ? `;${S.send}` : ''}}
${S.extra || ''}
`
}

// ── Theme definitions ───────────────────────────────────────────────────────
// Each theme carries an `anim` block used only by the animated variant:
//   anim.component — CSS appended to the MinimalMessage css. Turns the inert
//                    .vm-mote spans on (display:block) and drifts them
//                    (approach B — portrait particles).
//   anim.global    — CSS appended to globalCSS. Adds @keyframes and applies
//                    animation to the existing page ::before/::after pseudo
//                    layers (approach A — animated page background).
const THEMES = [
  // ═══════════════════════════════ FANTASY ═════════════════════════════════
  {
    id: 'vellum-fantasy',
    name: 'Vellum · Fantasy — The Open Codex',
    description: 'Gilt ink & rubric red on aged vellum. An illuminated open-codex MinimalMessage override with parchment textures, drop-cap prose, and a gilt-framed portrait rail.',
    accent: hsl(38, 52, 54),
    radiusScale: 1.5,
    base: {
      background: '#231a10', text: '#e8d6b0', primary: '#c79a4e', secondary: '#b34a3a',
      speech: '#c79a4e', thoughts: '#b59a72', danger: '#b34a3a', success: '#8f9a4e', warning: '#dcb568',
    },
    fonts: "@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;0,700;1,600&family=EB+Garamond:ital@0;1&display=swap');",
    vars: `--vm-serif:'Cormorant Garamond',Georgia,serif;--vm-body:'EB Garamond',Georgia,serif;--lumiverse-bg:#231a10;--lumiverse-text:#e8d6b0;--lumiverse-text-2:#b59a72;--lumiverse-accent:#c79a4e;--lumiverse-accent-2:#b34a3a;--glass-border:rgba(199,154,78,.28)`,
    page: `background:
      radial-gradient(1200px 680px at 50% -10%, rgba(220,181,104,.16), transparent 60%),
      radial-gradient(900px 640px at 4% 108%, rgba(179,74,58,.12), transparent 62%),
      radial-gradient(420px 320px at 96% 8%, rgba(120,80,36,.28), transparent 70%),
      radial-gradient(520px 380px at 2% 84%, rgba(96,62,26,.3), transparent 72%),
      linear-gradient(90deg, transparent 46%, rgba(20,13,5,.42) 50%, transparent 54%),
      linear-gradient(158deg,#3a2b18 0%, #2b2012 55%, #150f07 100%) !important;`,
    pageBefore: `opacity:.5;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.62' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.4'/%3E%3C/svg%3E");`,
    pageAfter: `background:radial-gradient(140% 120% at 50% 42%, transparent 58%, rgba(12,8,3,.55) 100%),url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cg fill='none' stroke='%23c79a4e' stroke-opacity='0.1' stroke-width='1'%3E%3Cpath d='M14 14q34 5 34 34M166 14q-34 5-34 34M14 166q34-5 34-34M166 166q-34-5-34-34'/%3E%3Ccircle cx='14' cy='14' r='2'/%3E%3Ccircle cx='166' cy='14' r='2'/%3E%3Ccircle cx='14' cy='166' r='2'/%3E%3Ccircle cx='166' cy='166' r='2'/%3E%3C/g%3E%3C/svg%3E");background-repeat:no-repeat,repeat;`,
    skin: `
.vm{--vm-radius:18px}
.vm-portraitA{background:radial-gradient(120% 80% at 46% 6%, rgba(255,236,190,.5), transparent 58%),radial-gradient(60% 50% at 88% 92%, rgba(120,78,34,.55), transparent 70%),radial-gradient(40% 34% at 8% 88%, rgba(150,98,44,.4), transparent 72%),linear-gradient(160deg,#e9d5a8,#d8bd86 46%,#b9975c 100%)}
.vm-portraitB{background:radial-gradient(120% 80% at 54% 6%, rgba(255,228,196,.46), transparent 58%),radial-gradient(60% 50% at 12% 92%, rgba(150,60,44,.5), transparent 70%),radial-gradient(40% 34% at 92% 86%, rgba(150,98,44,.4), transparent 72%),linear-gradient(160deg,#e6c79c,#cc9a72 48%,#8f5a3a 100%)}
.vm-grain{opacity:.5;mix-blend-mode:multiply;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23g)' opacity='0.5'/%3E%3C/svg%3E")}
.vm-avatar::after{content:"";position:absolute;inset:6px;border-radius:calc(var(--vm-radius) - 6px);border:1px solid rgba(199,154,78,.55);box-shadow:inset 0 0 0 3px rgba(179,74,58,.12),inset 0 0 26px rgba(60,36,12,.55),inset 0 0 90px rgba(30,18,6,.4);pointer-events:none;z-index:3}
.vm-header::before{content:"\\2766";color:var(--lumiverse-accent-2);font-size:1rem;opacity:.9;text-shadow:0 0 10px rgba(179,74,58,.5)}
.vm-name{font-family:var(--vm-serif);font-weight:700;font-size:clamp(1.6rem,2.1vw,2.3rem);line-height:1.02;background:linear-gradient(92deg,#c79a4e,#dcb568 55%,#c79a4e);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.vm-user .vm-name{background:linear-gradient(92deg,#b34a3a,#d97a68 58%,#c79a4e);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.vm-pill{font-family:var(--vm-serif);letter-spacing:.14em}
.vm-content{border:1px solid var(--glass-border);background:radial-gradient(120% 90% at 50% 0%, rgba(199,154,78,.08), transparent 60%),rgba(46,34,22,.92);box-shadow:inset 0 0 0 1px rgba(199,154,78,.06),0 14px 36px rgba(0,0,0,.5);backdrop-filter:blur(8px) saturate(112%);-webkit-backdrop-filter:blur(8px) saturate(112%)}
.vm-leafgrain{position:absolute;inset:0;z-index:0;border-radius:var(--vm-radius);opacity:.28;mix-blend-mode:overlay;pointer-events:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='lg'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.7' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23lg)' opacity='0.4'/%3E%3C/svg%3E")}
.vm-content::after{content:"";position:absolute;inset:6px;z-index:0;border-radius:calc(var(--vm-radius) - 6px);border:1px solid rgba(199,154,78,.4);pointer-events:none;box-shadow:inset 0 0 0 3px rgba(199,154,78,.05)}
.vm-content::before{content:"";position:absolute;top:14px;bottom:14px;left:0;width:3px;border-radius:2px;background:linear-gradient(180deg,#b34a3a,transparent);opacity:.8}
.vm-user .vm-content::before{left:auto;right:0;background:linear-gradient(180deg,#c79a4e,transparent)}
.vm-prose{font-family:var(--vm-body)}
.vm-prose>p:first-of-type::first-letter{font-family:var(--vm-serif);font-weight:700;font-size:3.1em;line-height:.78;float:left;margin:.04em .1em 0 0;color:#b34a3a;text-shadow:0 1px 0 rgba(199,154,78,.4)}
`,
    // Animated: gilt embers float up the portrait; the corner-flourish vignette
    // breathes like candlelight.
    anim: {
      component: `
.vm-mote{display:block;width:5px;height:5px;background:radial-gradient(circle,#dcb568,rgba(199,154,78,.4) 50%,transparent 72%);box-shadow:0 0 6px rgba(220,181,104,.6)}
.vm-m1{left:18%;bottom:6%;animation:vmFantasyEmber 8s ease-in-out infinite}
.vm-m2{left:40%;bottom:2%;width:3px;height:3px;animation:vmFantasyEmber 10.5s ease-in-out 1.1s infinite}
.vm-m3{left:64%;bottom:10%;width:4px;height:4px;animation:vmFantasyEmber 9s ease-in-out 2.2s infinite}
.vm-m4{left:80%;bottom:4%;animation:vmFantasyEmber 11s ease-in-out 3.4s infinite}
.vm-m5{left:30%;bottom:14%;width:3px;height:3px;animation:vmFantasyEmber 9.6s ease-in-out 4.6s infinite}
@keyframes vmFantasyEmber{0%{transform:translateY(0);opacity:0}12%{opacity:.6}82%{opacity:.5}100%{transform:translateY(-340px);opacity:0}}
`,
      global: `
/* living parchment: the fractal-noise grain (::before) drifts diagonally.
   Endpoint = one full 140px tile, so the linear loop is perfectly seamless. */
@keyframes vmFantasyParchment { to { background-position: 140px 140px; } }
/* candlelight: the vignette (::after) breathes with a slow opacity + micro-scale
   pulse. scale stays >= 1 so no edges are ever revealed (no inset change). */
@keyframes vmFantasyCandle {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: .82; transform: scale(1.03); }
}
body::before, [data-chat-bg]::before { animation: vmFantasyParchment 60s linear infinite; }
body::after, [data-chat-bg]::after {
  transform-origin: 50% 40%;
  animation: vmFantasyCandle 9s ease-in-out infinite;
}`,
    },
  },

  // ═══════════════════════════════ GATSBY ══════════════════════════════════
  {
    id: 'vellum-gatsby',
    name: 'Vellum · Gatsby — Jazz Age Opulence',
    description: 'Gilt gold on midnight & champagne. A hard-edged Deco MinimalMessage override with sunburst backgrounds, 3px gold card rules, corner accent bars, and gold shimmer.',
    accent: hsl(46, 65, 52),
    radiusScale: 0,
    base: {
      background: '#0a0806', text: '#f8e5a0', primary: '#d4af37', secondary: '#e8c85a',
      speech: '#d4af37', thoughts: '#c8a870', danger: '#b34a3a', success: '#c99a2e', warning: '#e8c85a',
    },
    fonts: "@import url('https://fonts.googleapis.com/css2?family=Poiret+One&family=Playfair+Display:wght@600;700&family=EB+Garamond:ital@0;1&display=swap');",
    vars: `--vm-serif:'Playfair Display',Georgia,serif;--vm-body:'EB Garamond',Georgia,serif;--vm-deco:'Poiret One','Playfair Display',Georgia,serif;--lumiverse-bg:#0a0806;--lumiverse-text:#f8e5a0;--lumiverse-text-2:#c8a870;--lumiverse-accent:#d4af37;--lumiverse-accent-2:#e8c85a;--glass-border:rgba(212,175,55,.35)`,
    page: `background:
      radial-gradient(720px 460px at 50% -4%, rgba(232,200,90,.22), transparent 62%),
      radial-gradient(560px 420px at 88% 12%, rgba(212,175,55,.12), transparent 66%),
      radial-gradient(600px 460px at 6% 96%, rgba(212,175,55,.14), transparent 68%),
      radial-gradient(140% 130% at 50% 46%, transparent 52%, rgba(4,3,2,.72) 100%),
      linear-gradient(180deg,#141009 0%, #0a0806 55%, #050403 100%) !important;`,
    pageBefore: `top:-46vh;left:50%;transform:translateX(-50%);width:190vw;height:190vw;inset:auto;opacity:.16;background:repeating-conic-gradient(from 0deg at 50% 50%,rgba(232,200,90,.9) 0deg, rgba(232,200,90,.9) .5deg, transparent .5deg, transparent 6deg);-webkit-mask-image:radial-gradient(circle at 50% 50%,#000 0,transparent 44%);mask-image:radial-gradient(circle at 50% 50%,#000 0,transparent 44%);`,
    pageAfter: `opacity:.9;background-image:radial-gradient(circle at 18% 24%, rgba(232,200,90,.10) 0, transparent 5%),radial-gradient(circle at 74% 16%, rgba(212,175,55,.09) 0, transparent 4%),radial-gradient(circle at 86% 62%, rgba(232,200,90,.08) 0, transparent 6%),radial-gradient(circle at 30% 78%, rgba(212,175,55,.08) 0, transparent 5%),url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60'%3E%3Cg fill='none' stroke='%23d4af37' stroke-opacity='0.06' stroke-width='1'%3E%3Cpath d='M0 30l15-15 15 15 15-15 15 15'/%3E%3Cpath d='M0 45l15-15 15 15 15-15 15 15'/%3E%3C/g%3E%3C/svg%3E");background-repeat:no-repeat,no-repeat,no-repeat,no-repeat,repeat;`,
    skin: `
.vm{--vm-radius:0px}
.vm-portraitA{background:radial-gradient(90% 60% at 50% 8%, rgba(244,230,168,.55), transparent 58%),repeating-conic-gradient(from 0deg at 50% 30%, rgba(201,154,46,.16) 0deg, rgba(201,154,46,.16) 1deg, transparent 1deg, transparent 9deg),radial-gradient(70% 40% at 50% 100%, rgba(20,12,4,.85), transparent 66%),linear-gradient(165deg,#e8c85a,#b8902a 46%,#241606 100%)}
.vm-portraitB{background:radial-gradient(90% 60% at 50% 8%, rgba(232,222,178,.42), transparent 58%),repeating-conic-gradient(from 0deg at 50% 30%, rgba(160,132,70,.14) 0deg, rgba(160,132,70,.14) 1deg, transparent 1deg, transparent 9deg),radial-gradient(70% 40% at 50% 100%, rgba(14,10,6,.88), transparent 66%),linear-gradient(165deg,#d9c9a0,#8f7038 48%,#1c140a 100%)}
.vm-grain{opacity:.4;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23g)' opacity='0.5'/%3E%3C/svg%3E")}
.vm-avatar::before{content:"";position:absolute;top:8px;left:8px;width:44px;height:3px;background:#d4af37;box-shadow:0 0 10px rgba(212,175,55,.6);z-index:3}
.vm-avatar::after{content:"";position:absolute;top:8px;left:8px;width:3px;height:44px;background:#d4af37;box-shadow:0 0 10px rgba(212,175,55,.6);z-index:3}
.vm-user .vm-avatar::before,.vm-user .vm-avatar::after{left:auto;right:8px}
.vm-header::before{content:"\\2726";color:#d4af37;font-size:1rem;opacity:.9;text-shadow:0 0 12px rgba(212,175,55,.6);animation:vmShimmer 4s ease-in-out infinite}
@keyframes vmShimmer{0%,100%{opacity:.5;text-shadow:0 0 12px rgba(212,175,55,.4)}50%{opacity:1;text-shadow:0 0 22px rgba(212,175,55,.85)}}
@keyframes vmPulse{0%,100%{opacity:1}50%{opacity:.55}}
.vm-name{font-family:var(--vm-deco);font-weight:400;font-size:clamp(1.6rem,2.2vw,2.3rem);line-height:1.02;letter-spacing:.14em;text-transform:uppercase;background:linear-gradient(92deg,#d4af37,#f8e5a0 55%,#d4af37);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.vm-pill{font-family:var(--vm-deco);letter-spacing:.22em;font-size:.7rem}
.vm-content{border:1px solid rgba(212,175,55,.35);border-top:3px solid #d4af37;border-bottom:3px solid #d4af37;background:rgba(20,16,12,.95);box-shadow:inset 0 0 24px rgba(212,175,55,.06),0 14px 40px rgba(0,0,0,.6);backdrop-filter:blur(6px) saturate(115%);-webkit-backdrop-filter:blur(6px) saturate(115%)}
.vm-leafgrain{position:absolute;inset:0;z-index:0;opacity:.16;mix-blend-mode:overlay;pointer-events:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='lg'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23lg)' opacity='0.5'/%3E%3C/svg%3E")}
.vm-content::before{content:"";position:absolute;top:0;left:0;width:46px;height:3px;background:#d4af37;animation:vmPulse 3s ease-in-out infinite;z-index:1}
.vm-content::after{content:"";position:absolute;top:0;right:0;width:46px;height:3px;background:#d4af37;animation:vmPulse 3s ease-in-out infinite;z-index:1}
.vm-prose{font-family:var(--vm-body)}
`,
    // Animated: the sunburst backdrop slowly rotates; champagne gold flecks
    // drift up the portrait.
    anim: {
      component: `
.vm-mote{display:block;width:4px;height:4px;background:radial-gradient(circle,#f8e5a0,rgba(212,175,55,.4) 50%,transparent 72%);box-shadow:0 0 6px rgba(212,175,55,.6)}
.vm-m1{left:22%;top:28%;animation:vmGatsbyGold 6s ease-in-out infinite}
.vm-m2{left:46%;top:52%;width:3px;height:3px;animation:vmGatsbyGold 7.5s ease-in-out .9s infinite}
.vm-m3{left:68%;top:36%;width:5px;height:5px;animation:vmGatsbyGold 6.8s ease-in-out 1.8s infinite}
.vm-m4{left:34%;top:70%;animation:vmGatsbyGold 8s ease-in-out 2.6s infinite}
.vm-m5{left:78%;top:62%;width:3px;height:3px;animation:vmGatsbyGold 7.2s ease-in-out 3.5s infinite}
@keyframes vmGatsbyGold{0%,100%{transform:translate(0,0);opacity:.3}50%{transform:translate(5px,-12px);opacity:.85}}
`,
      global: `@keyframes vmGatsbySunburst{from{transform:translateX(-50%) rotate(0deg)}to{transform:translateX(-50%) rotate(360deg)}}
body::before,[data-chat-bg]::before{animation:vmGatsbySunburst 140s linear infinite}`,
    },
  },

  // ═══════════════════════════════ EMBER ═══════════════════════════════════
  {
    id: 'vellum-ember',
    name: 'Vellum · Ember — A Starlit Night, Dreaming',
    description: 'Lilac & mint over the indigo void. A dreamy starfield MinimalMessage override with nebula backgrounds, twinkling drift, and a gilt-edge glass card.',
    accent: hsl(251, 100, 83),
    radiusScale: 1.83,
    base: {
      background: '#0d0d1a', text: '#e6e0f5', primary: '#b8a9ff', secondary: '#8fd6c8',
      speech: '#b8a9ff', thoughts: '#b0a8d0', danger: '#e08aa0', success: '#8fd6c8', warning: '#e8d6a0',
    },
    fonts: "@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=Quicksand:wght@400;500;700&family=EB+Garamond:ital@0;1&display=swap');",
    vars: `--vm-serif:'Cormorant Garamond',Georgia,serif;--vm-body:'EB Garamond',Georgia,serif;--vm-ethereal:'Quicksand','Cormorant Garamond',Georgia,serif;--lumiverse-bg:#0d0d1a;--lumiverse-text:#e6e0f5;--lumiverse-text-2:#b0a8d0;--lumiverse-accent:#b8a9ff;--lumiverse-accent-2:#8fd6c8;--glass-border:rgba(184,169,255,.16)`,
    page: `background:
      radial-gradient(1100px 620px at 82% -10%, rgba(184,169,255,.22), transparent 60%),
      radial-gradient(960px 720px at 6% 112%, rgba(143,214,200,.16), transparent 60%),
      radial-gradient(520px 420px at 68% 42%, rgba(150,120,220,.12), transparent 66%),
      radial-gradient(600px 300px at 30% 20%, rgba(120,150,220,.1), transparent 70%),
      radial-gradient(150% 130% at 50% 46%, transparent 52%, rgba(4,4,10,.72) 100%),
      linear-gradient(165deg,#141430 0%, #0d0d1c 58%, #06060d 100%) !important;`,
    pageBefore: `opacity:.7;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cg fill='%23ffffff'%3E%3Ccircle cx='24' cy='30' r='1.1' fill-opacity='0.7'/%3E%3Ccircle cx='120' cy='18' r='0.8' fill-opacity='0.5'/%3E%3Ccircle cx='72' cy='84' r='1.3' fill-opacity='0.6'/%3E%3Ccircle cx='140' cy='120' r='0.9' fill-opacity='0.55'/%3E%3Ccircle cx='40' cy='134' r='1' fill-opacity='0.45'/%3E%3Ccircle cx='196' cy='60' r='1' fill-opacity='0.5'/%3E%3Ccircle cx='178' cy='168' r='0.8' fill-opacity='0.4'/%3E%3Ccircle cx='90' cy='196' r='1.1' fill-opacity='0.5'/%3E%3C/g%3E%3Cg fill='%23b8a9ff'%3E%3Ccircle cx='60' cy='50' r='0.9' fill-opacity='0.5'/%3E%3Ccircle cx='150' cy='40' r='0.7' fill-opacity='0.4'/%3E%3Ccircle cx='30' cy='180' r='0.8' fill-opacity='0.45'/%3E%3Ccircle cx='206' cy='110' r='0.9' fill-opacity='0.4'/%3E%3C/g%3E%3Cg fill='%238fd6c8'%3E%3Ccircle cx='96' cy='52' r='0.9' fill-opacity='0.45'/%3E%3Ccircle cx='16' cy='96' r='1' fill-opacity='0.4'/%3E%3Ccircle cx='128' cy='72' r='0.7' fill-opacity='0.35'/%3E%3Ccircle cx='170' cy='210' r='0.9' fill-opacity='0.4'/%3E%3C/g%3E%3C/svg%3E");animation:vmTwinkleBg 6s ease-in-out infinite`,
    pageAfter: `opacity:.5;mix-blend-mode:screen;background-size:cover;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Cfilter id='neb'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.012' numOctaves='3' seed='7'/%3E%3CfeColorMatrix values='0 0 0 0 0.55  0 0 0 0 0.45  0 0 0 0 0.85  0 0 0 0.6 0'/%3E%3C/filter%3E%3Crect width='400' height='400' filter='url(%23neb)'/%3E%3C/svg%3E");`,
    extraGlobal: `@keyframes vmTwinkleBg{0%,100%{opacity:.55}50%{opacity:.85}}`,
    skin: `
.vm{--vm-radius:22px}
.vm-portraitA{background:radial-gradient(70% 42% at 50% 6%, rgba(230,224,255,.6), transparent 58%),radial-gradient(90% 60% at 30% 40%, rgba(150,120,220,.4), transparent 64%),radial-gradient(60% 40% at 50% 100%, rgba(10,10,26,.9), transparent 66%),linear-gradient(160deg,#cabfff,#7a68c6 46%,#26224a 100%)}
.vm-portraitB{background:radial-gradient(70% 42% at 50% 6%, rgba(214,244,236,.5), transparent 58%),radial-gradient(90% 60% at 70% 40%, rgba(90,180,164,.34), transparent 64%),radial-gradient(60% 40% at 50% 100%, rgba(8,20,18,.9), transparent 66%),linear-gradient(160deg,#b3ebe0,#559a8c 48%,#1c3a34 100%)}
.vm-grain{opacity:.85;mix-blend-mode:screen;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cg fill='%23ffffff'%3E%3Ccircle cx='18' cy='22' r='0.9' fill-opacity='0.8'/%3E%3Ccircle cx='70' cy='40' r='0.7' fill-opacity='0.6'/%3E%3Ccircle cx='100' cy='16' r='0.8' fill-opacity='0.7'/%3E%3Ccircle cx='44' cy='70' r='0.6' fill-opacity='0.5'/%3E%3Ccircle cx='96' cy='90' r='0.9' fill-opacity='0.7'/%3E%3Ccircle cx='30' cy='104' r='0.7' fill-opacity='0.5'/%3E%3C/g%3E%3C/svg%3E")}
.vm-avatar::after{content:"";position:absolute;inset:0;background:radial-gradient(120% 80% at 50% 12%,rgba(255,255,255,.16),transparent 55%);z-index:3;pointer-events:none}
.vm-name{font-family:var(--vm-serif);font-weight:700;font-size:clamp(1.5rem,2vw,2.15rem);line-height:1.02;background:linear-gradient(92deg,#b8a9ff,#d6cbff 60%,#8fd6c8);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.vm-user .vm-name{background:linear-gradient(92deg,#8fd6c8,#c2efe6 60%,#b8a9ff);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.vm-pill{font-family:var(--vm-ethereal);font-weight:700;letter-spacing:.08em;font-size:.68rem}
.vm-content{overflow:hidden}
.vm-content::before{content:"";position:absolute;inset:0;z-index:0;border-radius:inherit;border:1px solid var(--glass-border);background:color-mix(in srgb,#0d0d1a 42%, transparent);box-shadow:inset 0 0 0 1px rgba(184,169,255,.05),0 12px 36px rgba(0,0,0,.36);backdrop-filter:blur(12px) saturate(122%);-webkit-backdrop-filter:blur(12px) saturate(122%)}
.vm-content::after{content:"";position:absolute;inset:6px;z-index:0;border-radius:calc(var(--vm-radius) - 8px);border:1px solid color-mix(in srgb,#b8a9ff 36%,transparent);box-shadow:inset 0 0 14px color-mix(in srgb,#b8a9ff 14%,transparent);pointer-events:none;opacity:.85}
.vm-prose{font-family:var(--vm-body)}
`,
    // Animated: stars twinkle across the portrait; the nebula slowly breathes.
    anim: {
      component: `
.vm-mote{display:block;width:3px;height:3px;background:radial-gradient(circle,#fff,rgba(184,169,255,.5) 50%,transparent 72%);box-shadow:0 0 6px rgba(184,169,255,.7)}
.vm-m1{left:22%;top:20%;animation:vmEmberTwinkle 3s ease-in-out infinite}
.vm-m2{left:54%;top:34%;width:4px;height:4px;animation:vmEmberTwinkle 4.2s ease-in-out .7s infinite}
.vm-m3{left:70%;top:16%;animation:vmEmberTwinkle 3.6s ease-in-out 1.4s infinite}
.vm-m4{left:34%;top:58%;width:2px;height:2px;animation:vmEmberTwinkle 5s ease-in-out 2.1s infinite}
.vm-m5{left:80%;top:48%;animation:vmEmberTwinkle 3.9s ease-in-out 2.8s infinite}
@keyframes vmEmberTwinkle{0%,100%{opacity:.2;transform:scale(.7)}50%{opacity:.95;transform:scale(1.2)}}
`,
      global: `
/* drifting cosmos: the starfield (::before) slowly wheels across the sky while
   still twinkling (vmTwinkleBg, set in pageBefore). Endpoint = one 220px tile in
   each axis, so the star drift loops seamlessly. Two animations compose. */
@keyframes vmEmberStarDrift { to { background-position: 220px -220px; } }
/* nebula (::after) breathes and slowly rotates. Because it rotates, it is
   oversized (inset:-25%) so the corners never swing into view. */
@keyframes vmEmberNebula {
  0%, 100% { transform: scale(1.15) rotate(0deg); opacity: .5; }
  50%      { transform: scale(1.2) rotate(8deg); opacity: .62; }
}
body::before, [data-chat-bg]::before { animation: vmTwinkleBg 6s ease-in-out infinite, vmEmberStarDrift 120s linear infinite; }
body::after, [data-chat-bg]::after {
  inset: -25%;
  transform-origin: 50% 50%;
  animation: vmEmberNebula 60s ease-in-out infinite;
}`,
    },
  },

  // ═══════════════════════════════ BLOOM ═══════════════════════════════════
  {
    id: 'vellum-bloom',
    name: 'Vellum · Bloom — Pressed-Flower Garden',
    description: 'Blush & sage on plum dusk. A moonlit-garden MinimalMessage override with foliage textures, drifting pollen, and a stitched dashed glass card.',
    accent: hsl(336, 50, 70),
    radiusScale: 1.67,
    base: {
      background: '#1a0e16', text: '#f2dce7', primary: '#d98cab', secondary: '#8fbf7f',
      speech: '#d98cab', thoughts: '#c7a9ba', danger: '#d9708c', success: '#8fbf7f', warning: '#e8c07a',
    },
    fonts: "@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=EB+Garamond:ital@0;1&display=swap');",
    vars: `--vm-serif:'Cormorant Garamond',Georgia,serif;--vm-body:'EB Garamond',Georgia,serif;--lumiverse-bg:#1a0e16;--lumiverse-text:#f2dce7;--lumiverse-text-2:#c7a9ba;--lumiverse-accent:#d98cab;--lumiverse-accent-2:#8fbf7f;--glass-border:rgba(230,163,192,.14)`,
    page: `background:
      radial-gradient(1200px 600px at 78% -8%, rgba(217,140,171,.22), transparent 60%),
      radial-gradient(1000px 700px at 8% 108%, rgba(143,191,127,.18), transparent 60%),
      radial-gradient(520px 420px at 62% 44%, rgba(180,110,150,.12), transparent 66%),
      radial-gradient(150% 130% at 50% 44%, transparent 52%, rgba(8,4,8,.7) 100%),
      linear-gradient(160deg,#20111c 0%, #150a12 60%, #0c060b 100%) !important;`,
    pageBefore: `opacity:.5;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cg fill='%238fbf7f' fill-opacity='0.12'%3E%3Cpath d='M30 40c26-14 52 0 52 26-26 6-50-6-52-26z'/%3E%3Cpath d='M170 60c-24-16-52-4-54 22 26 8 52-2 54-22z'/%3E%3Cpath d='M60 150c22 18 18 48-6 58-10-24-4-46 6-58z'/%3E%3Cpath d='M180 168c-20 16-16 44 6 54 10-22 4-42-6-54z'/%3E%3C/g%3E%3Cg fill='%23d98cab' fill-opacity='0.1'%3E%3Cpath d='M120 30c6-10 14-10 20 0-6 6-14 6-20 0z'/%3E%3Cpath d='M28 110c6-10 14-10 20 0-6 6-14 6-20 0z'/%3E%3Cpath d='M150 190c6-10 14-10 20 0-6 6-14 6-20 0z'/%3E%3C/g%3E%3C/svg%3E");`,
    pageAfter: `opacity:.6;background-image:radial-gradient(circle at 22% 30%, rgba(242,220,231,.14) 0, transparent 4%),radial-gradient(circle at 68% 20%, rgba(217,140,171,.12) 0, transparent 3%),radial-gradient(circle at 82% 66%, rgba(143,191,127,.1) 0, transparent 5%),radial-gradient(circle at 34% 80%, rgba(242,220,231,.1) 0, transparent 4%);background-repeat:no-repeat;`,
    skin: `
.vm{--vm-radius:20px}
.vm-portraitA{background:radial-gradient(70% 42% at 50% 6%, rgba(248,228,238,.55), transparent 58%),radial-gradient(90% 60% at 34% 42%, rgba(200,110,150,.4), transparent 64%),radial-gradient(60% 40% at 50% 100%, rgba(20,10,18,.9), transparent 66%),linear-gradient(160deg,#e9a7c4,#a35d80 46%,#3a2230 100%)}
.vm-portraitB{background:radial-gradient(70% 42% at 50% 6%, rgba(236,246,226,.5), transparent 58%),radial-gradient(90% 60% at 66% 42%, rgba(120,170,104,.36), transparent 64%),radial-gradient(60% 40% at 50% 100%, rgba(12,20,10,.9), transparent 66%),linear-gradient(160deg,#a7d495,#5f8a52 48%,#233019 100%)}
.vm-grain{opacity:.55;mix-blend-mode:screen;background-repeat:no-repeat;background-image:radial-gradient(circle at 22% 26%, rgba(248,220,231,.55),transparent 5px),radial-gradient(circle at 74% 42%, rgba(217,140,171,.45),transparent 6px),radial-gradient(circle at 46% 76%, rgba(248,220,231,.4),transparent 4px),radial-gradient(circle at 88% 84%, rgba(217,140,171,.35),transparent 6px),radial-gradient(circle at 12% 60%, rgba(242,200,220,.4),transparent 5px)}
.vm-avatar::after{content:"";position:absolute;inset:0;background:radial-gradient(120% 80% at 50% 12%,rgba(255,255,255,.14),transparent 55%);z-index:3;pointer-events:none}
.vm-name{font-family:var(--vm-serif);font-weight:700;font-size:clamp(1.5rem,2vw,2.15rem);line-height:1.02;background:linear-gradient(92deg,#d98cab,#f0b7cf 60%,#8fbf7f);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.vm-user .vm-name{background:linear-gradient(92deg,#8fbf7f,#c7e3b8 60%,#d98cab);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.vm-pill{letter-spacing:.06em;font-size:.72rem;font-weight:700}
.vm-content{overflow:hidden}
.vm-content::before{content:"";position:absolute;inset:0;z-index:0;border-radius:inherit;border:1px solid var(--glass-border);background:color-mix(in srgb,#1a0e16 42%, transparent);box-shadow:inset 0 0 0 1px rgba(255,255,255,.02),0 12px 32px rgba(0,0,0,.28);backdrop-filter:blur(10px) saturate(120%);-webkit-backdrop-filter:blur(10px) saturate(120%)}
.vm-content::after{content:"";position:absolute;inset:7px;z-index:0;border-radius:calc(var(--vm-radius) - 8px);border:1.5px dashed color-mix(in srgb,#d98cab 34%,transparent);pointer-events:none;opacity:.8}
.vm-prose{font-family:var(--vm-body)}
`,
    // Animated: blush petals tumble down the portrait; pollen bokeh drifts.
    anim: {
      component: `
.vm-mote{display:block;width:8px;height:8px;background:radial-gradient(circle at 30% 30%,#f0b7cf,#d98cab 60%,transparent 74%);border-radius:60% 0 60% 0}
.vm-m1{left:16%;top:-12px;animation:vmBloomFall 9s linear infinite}
.vm-m2{left:38%;top:-12px;width:6px;height:6px;animation:vmBloomFall 11s linear 1.4s infinite}
.vm-m3{left:60%;top:-12px;width:7px;height:7px;animation:vmBloomFall 8s linear 2.8s infinite}
.vm-m4{left:78%;top:-12px;width:5px;height:5px;animation:vmBloomFall 10.5s linear 4s infinite}
.vm-m5{left:48%;top:-12px;width:9px;height:9px;animation:vmBloomFall 9.6s linear 5.4s infinite}
@keyframes vmBloomFall{0%{transform:translateY(-20px) rotate(0deg);opacity:0}10%{opacity:.7}90%{opacity:.6}100%{transform:translateY(560px) rotate(340deg);opacity:0}}
`,
      global: `
/* night breeze: the foliage silhouette (::before) sways gently. The tile is
   220px, so a small non-tile offset reads as a breeze without a visible seam
   (it eases back to 0, never accumulating). */
@keyframes vmBloomSway {
  0%, 100% { background-position: 0 0; }
  50%      { background-position: 18px 4px; }
}
/* pollen bokeh (::after) drifts upward and fades. The layer is oversized
   (inset:-14%) so the vertical travel never exposes a bare edge. */
@keyframes vmBloomPollen {
  0%, 100% { transform: translateY(0); opacity: .6; }
  50%      { transform: translateY(-22px); opacity: .34; }
}
body::before, [data-chat-bg]::before { animation: vmBloomSway 11s ease-in-out infinite; }
body::after, [data-chat-bg]::after {
  inset: -14%;
  animation: vmBloomPollen 16s ease-in-out infinite;
}`,
    },
  },

  // ═══════════════════════════════ FAEWILD ═════════════════════════════════
  {
    id: 'vellum-faewild',
    name: 'Vellum · Faewild — A Twilight Storybook Glade',
    description: 'Sage & lilac among the fairy lights. A moonlit-glade MinimalMessage override with leaf-canopy textures, godrays, drifting motes, and a lantern glass card.',
    accent: hsl(112, 30, 64),
    radiusScale: 1.83,
    base: {
      background: '#101a14', text: '#e6efe0', primary: '#8fbf88', secondary: '#c9b6f0',
      speech: '#8fbf88', thoughts: '#aec2ac', danger: '#c98a8a', success: '#8fbf88', warning: '#d8c98a',
    },
    fonts: "@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=Quicksand:wght@400;500;700&family=EB+Garamond:ital@0;1&display=swap');",
    vars: `--vm-serif:'Cormorant Garamond',Georgia,serif;--vm-body:'EB Garamond',Georgia,serif;--vm-ethereal:'Quicksand','Cormorant Garamond',Georgia,serif;--lumiverse-bg:#101a14;--lumiverse-text:#e6efe0;--lumiverse-text-2:#aec2ac;--lumiverse-accent:#8fbf88;--lumiverse-accent-2:#c9b6f0;--glass-border:rgba(143,191,136,.16)`,
    page: `background:
      radial-gradient(1100px 620px at 80% -10%, rgba(201,182,240,.22), transparent 60%),
      radial-gradient(980px 720px at 6% 110%, rgba(143,191,136,.2), transparent 60%),
      radial-gradient(520px 420px at 56% 46%, rgba(120,150,110,.14), transparent 66%),
      radial-gradient(150% 132% at 50% 46%, transparent 52%, rgba(4,9,6,.72) 100%),
      linear-gradient(165deg,#16241b 0%, #0f1a13 58%, #08110b 100%) !important;`,
    pageBefore: `opacity:.55;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cg fill='%238fbf88' fill-opacity='0.13'%3E%3Cpath d='M28 34c30-14 58 0 58 28-28 8-56-6-58-28z'/%3E%3Cpath d='M188 56c-26-16-56-4-58 24 28 8 56-2 58-24z'/%3E%3Cpath d='M56 150c24 18 20 50-6 60-12-24-6-48 6-60z'/%3E%3Cpath d='M186 170c-22 16-18 46 6 56 12-22 6-44-6-56z'/%3E%3C/g%3E%3Cg fill='%23c9b6f0' fill-opacity='0.11'%3E%3Ccircle cx='120' cy='40' r='2'/%3E%3Ccircle cx='40' cy='120' r='1.6'/%3E%3Ccircle cx='170' cy='120' r='1.8'/%3E%3Cpath d='M96 96c12-6 22 2 20 14-12 0-20-4-20-14z'/%3E%3C/g%3E%3C/svg%3E");`,
    pageAfter: `opacity:.6;background:linear-gradient(114deg, transparent 46%, rgba(201,182,240,.08) 52%, transparent 58%),linear-gradient(120deg, transparent 62%, rgba(220,230,210,.06) 68%, transparent 74%),radial-gradient(120% 60% at 50% 118%, rgba(180,200,180,.12), transparent 60%);`,
    skin: `
.vm{--vm-radius:22px}
.vm-portraitA{background:radial-gradient(70% 42% at 50% 6%, rgba(224,236,214,.5), transparent 58%),radial-gradient(90% 60% at 34% 42%, rgba(120,164,110,.42), transparent 64%),radial-gradient(60% 40% at 50% 100%, rgba(10,18,12,.9), transparent 66%),linear-gradient(160deg,#b6dcaf,#6f9e68 46%,#22321f 100%)}
.vm-portraitB{background:radial-gradient(70% 42% at 50% 6%, rgba(232,224,248,.5), transparent 58%),radial-gradient(90% 60% at 66% 42%, rgba(160,140,208,.4), transparent 64%),radial-gradient(60% 40% at 50% 100%, rgba(14,10,22,.9), transparent 66%),linear-gradient(160deg,#ddccf7,#a58fd6 48%,#342a48 100%)}
.vm-grain{opacity:.7;mix-blend-mode:screen;background-repeat:no-repeat;background-image:radial-gradient(circle at 28% 30%, rgba(206,234,150,.85),rgba(206,234,150,0) 4px),radial-gradient(circle at 68% 20%, rgba(201,182,240,.7),rgba(201,182,240,0) 5px),radial-gradient(circle at 50% 64%, rgba(220,240,170,.75),rgba(220,240,170,0) 4px),radial-gradient(circle at 84% 78%, rgba(180,220,140,.6),rgba(180,220,140,0) 6px),radial-gradient(circle at 16% 82%, rgba(201,182,240,.6),rgba(201,182,240,0) 4px)}
.vm-avatar::after{content:"";position:absolute;inset:0;background:radial-gradient(120% 80% at 50% 12%,rgba(255,255,255,.15),transparent 55%);z-index:3;pointer-events:none}
.vm-name{font-family:var(--vm-serif);font-weight:700;font-size:clamp(1.5rem,2vw,2.15rem);line-height:1.02;background:linear-gradient(92deg,#8fbf88,#bfe0b8 60%,#c9b6f0);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.vm-user .vm-name{background:linear-gradient(92deg,#c9b6f0,#e3d8f7 60%,#8fbf88);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.vm-pill{font-family:var(--vm-ethereal);font-weight:700;letter-spacing:.08em;font-size:.68rem}
.vm-content{overflow:hidden}
.vm-content::before{content:"";position:absolute;inset:0;z-index:0;border-radius:inherit;border:1px solid var(--glass-border);background:color-mix(in srgb,#101a14 42%, transparent);box-shadow:inset 0 0 0 1px rgba(143,191,136,.05),0 12px 34px rgba(0,0,0,.34);backdrop-filter:blur(10px) saturate(120%);-webkit-backdrop-filter:blur(10px) saturate(120%)}
.vm-content::after{content:"";position:absolute;inset:7px;z-index:0;border-radius:calc(var(--vm-radius) - 6px);border:1.5px solid color-mix(in srgb,#8fbf88 34%,transparent);box-shadow:inset 0 0 16px color-mix(in srgb,#c9b6f0 12%,transparent);pointer-events:none;opacity:.8}
.vm-prose{font-family:var(--vm-body)}
`,
    // Animated: lilac fireflies drift and pulse across the portrait; godrays
    // shimmer over the glade.
    anim: {
      component: `
.vm-mote{display:block;width:5px;height:5px;background:radial-gradient(circle,#fff,rgba(201,182,240,.6) 45%,transparent 72%);box-shadow:0 0 8px rgba(201,182,240,.7),0 0 16px rgba(143,191,136,.4)}
.vm-m1{left:20%;top:30%;animation:vmFaeDrift 7s ease-in-out infinite}
.vm-m2{left:52%;top:22%;width:4px;height:4px;animation:vmFaeDrift 8.4s ease-in-out 1.2s infinite}
.vm-m3{left:70%;top:44%;width:6px;height:6px;animation:vmFaeDrift 6.6s ease-in-out 2.4s infinite}
.vm-m4{left:34%;top:60%;animation:vmFaeDrift 9s ease-in-out 3.3s infinite}
.vm-m5{left:78%;top:66%;width:4px;height:4px;animation:vmFaeDrift 7.6s ease-in-out 4.5s infinite}
@keyframes vmFaeDrift{0%{transform:translate(0,0);opacity:.25}25%{opacity:.9}50%{transform:translate(18px,-22px);opacity:.55}75%{opacity:.9}100%{transform:translate(0,0);opacity:.25}}
`,
      global: `
/* sunlight through canopy: the leaf-canopy texture (::before) drifts slowly.
   Endpoint = one 220px tile (+40px vertical, also a whole multiple) so the
   linear loop is seamless. */
@keyframes vmFaeCanopy { to { background-position: -220px 40px; } }
/* godrays: the light bands (::after) sweep side to side while brightening.
   The layer is oversized (inset:-35%) so the horizontal slide never reveals an
   edge; opacity swells at mid-sweep like sun breaking through leaves. */
@keyframes vmFaeGodray {
  0%, 100% { transform: translateX(-12%); opacity: .55; }
  50%      { transform: translateX(12%);  opacity: .8; }
}
body::before, [data-chat-bg]::before { animation: vmFaeCanopy 44s linear infinite; }
body::after, [data-chat-bg]::after {
  inset: -35%;
  animation: vmFaeGodray 16s ease-in-out infinite;
}`,
    },
  },
  // ═══════════════════════════════ ARCADE ══════════════════════════════════
  {
    id: 'vellum-arcade',
    name: 'Vellum · Arcade — Insert Coin',
    description: 'Hot pink & cyan neon on black. A CRT arcade-cabinet MinimalMessage override with scanline fields, chromatic-aberration names, neon-glow keylines, and a masked portrait rail lit like a coin-op screen.',
    accent: hsl(326, 100, 59),
    radiusScale: 0.25,
    base: {
      background: '#0a0710', text: '#f4eaff', primary: '#ff2ea6', secondary: '#2ef0ff',
      speech: '#2ef0ff', thoughts: '#b79fd0', danger: '#ff2e5e', success: '#2bff88', warning: '#ffe23a',
    },
    fonts: "@import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Share+Tech+Mono&family=EB+Garamond:ital@0;1&display=swap');",
    vars: `--vm-serif:'Press Start 2P',ui-monospace,monospace;--vm-body:'EB Garamond',Georgia,serif;--vm-deco:'Share Tech Mono',ui-monospace,monospace;--lumiverse-bg:#0a0710;--lumiverse-text:#f4eaff;--lumiverse-text-2:#b79fd0;--lumiverse-accent:#ff2ea6;--lumiverse-accent-2:#2ef0ff;--glass-border:rgba(46,240,255,.4)`,
    page: `background:
      radial-gradient(720px 460px at 50% -6%, rgba(255,46,166,.16), transparent 60%),
      radial-gradient(620px 460px at 92% 108%, rgba(46,240,255,.12), transparent 62%),
      radial-gradient(140% 130% at 50% 46%, transparent 52%, rgba(3,1,7,.8) 100%),
      linear-gradient(180deg,#140b20 0%, #0a0710 55%, #050308 100%) !important;`,
    pageBefore: `opacity:.55;background:repeating-linear-gradient(0deg,rgba(46,240,255,.05) 0 2px,transparent 2px 4px);`,
    pageAfter: `opacity:.8;background-image:radial-gradient(circle at 18% 26%, rgba(255,46,166,.1) 0, transparent 5%),radial-gradient(circle at 78% 18%, rgba(46,240,255,.09) 0, transparent 4%),radial-gradient(circle at 86% 64%, rgba(255,46,166,.08) 0, transparent 6%),radial-gradient(circle at 30% 80%, rgba(46,240,255,.08) 0, transparent 5%);background-repeat:no-repeat;`,
    skin: `
.vm{--vm-radius:3px}
.vm-portraitA{background:radial-gradient(90% 60% at 50% 8%, rgba(255,46,166,.5), transparent 58%),radial-gradient(70% 40% at 50% 100%, rgba(6,4,12,.9), transparent 66%),linear-gradient(165deg,#ff2ea6,#7a1a6a 46%,#0a0710 100%)}
.vm-portraitB{background:radial-gradient(90% 60% at 50% 8%, rgba(46,240,255,.46), transparent 58%),radial-gradient(70% 40% at 50% 100%, rgba(4,8,12,.9), transparent 66%),linear-gradient(165deg,#2ef0ff,#1a5a7a 48%,#070a10 100%)}
.vm-grain{opacity:.5;mix-blend-mode:overlay;background:repeating-linear-gradient(0deg,rgba(0,0,0,.4) 0 2px,transparent 2px 4px)}
.vm-avatar::after{content:"";position:absolute;inset:6px;border:2px solid rgba(46,240,255,.6);border-radius:2px;box-shadow:inset 0 0 22px rgba(46,240,255,.14),0 0 14px rgba(46,240,255,.3);pointer-events:none;z-index:3;animation:vmArcadeGlow 2.6s ease-in-out infinite}
@keyframes vmArcadeGlow{0%,100%{box-shadow:inset 0 0 22px rgba(46,240,255,.12),0 0 12px rgba(46,240,255,.24)}50%{box-shadow:inset 0 0 30px rgba(46,240,255,.24),0 0 22px rgba(46,240,255,.5)}}
.vm-header::before{content:"\\25B6";color:var(--lumiverse-accent-2);font-size:.7rem;opacity:.9;text-shadow:0 0 10px rgba(46,240,255,.7)}
.vm-name{font-family:var(--vm-serif);font-weight:400;font-size:clamp(.9rem,1.5vw,1.2rem);line-height:1.5;letter-spacing:.02em;text-transform:uppercase;color:var(--lumiverse-accent-2);text-shadow:-2px 0 rgba(255,46,166,.7),2px 0 rgba(46,240,255,.7),0 0 10px rgba(46,240,255,.6);animation:vmArcadeAberr 2.6s steps(2) infinite}
@keyframes vmArcadeAberr{0%,100%{text-shadow:-2px 0 rgba(255,46,166,.7),2px 0 rgba(46,240,255,.7),0 0 10px rgba(46,240,255,.6)}50%{text-shadow:2px 0 rgba(255,46,166,.7),-2px 0 rgba(46,240,255,.7),0 0 10px rgba(46,240,255,.6)}}
.vm-user .vm-name{color:var(--lumiverse-accent);text-shadow:-2px 0 rgba(46,240,255,.7),2px 0 rgba(255,46,166,.7),0 0 10px rgba(255,46,166,.6)}
.vm-pill{font-family:var(--vm-deco);letter-spacing:.18em;text-transform:uppercase;font-size:.72rem}
.vm-content{border:2px solid var(--lumiverse-accent-2);background:linear-gradient(180deg,rgba(23,16,31,.92),rgba(14,9,22,.94));box-shadow:4px 4px 0 rgba(255,46,166,.5),inset 0 0 18px rgba(46,240,255,.08)}
.vm-leafgrain{position:absolute;inset:0;z-index:0;opacity:.4;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(46,240,255,.05) 0 2px,transparent 2px 4px)}
.vm-content::before{content:"";position:absolute;top:0;left:0;width:46px;height:3px;background:var(--lumiverse-accent);animation:vmArcadePulse 3s ease-in-out infinite;z-index:1}
.vm-content::after{content:"";position:absolute;bottom:0;right:0;width:46px;height:3px;background:var(--lumiverse-accent);animation:vmArcadePulse 3s ease-in-out infinite;z-index:1}
@keyframes vmArcadePulse{0%,100%{opacity:1}50%{opacity:.5}}
.vm-prose{font-family:var(--vm-body)}
.vm-prose .say{text-shadow:0 0 12px rgba(46,240,255,.4)}
`,
    anim: {
      component: `
.vm-mote{display:block;width:4px;height:4px;background:radial-gradient(circle,#2ef0ff,rgba(46,240,255,.4) 50%,transparent 72%);box-shadow:0 0 6px rgba(46,240,255,.7)}
.vm-m1{left:20%;bottom:6%;animation:vmArcadeRise 7s linear infinite}
.vm-m2{left:44%;bottom:2%;width:3px;height:3px;animation:vmArcadeRise 9s linear 1.2s infinite}
.vm-m3{left:66%;bottom:10%;animation:vmArcadeRise 8s linear 2.4s infinite}
.vm-m4{left:80%;bottom:4%;width:3px;height:3px;animation:vmArcadeRise 10s linear 3.6s infinite}
.vm-m5{left:32%;bottom:14%;animation:vmArcadeRise 8.6s linear 4.8s infinite}
@keyframes vmArcadeRise{0%{transform:translateY(0);opacity:0}12%{opacity:1}88%{opacity:.8}100%{transform:translateY(-320px);opacity:0}}
`,
      global: `
/* CRT scanline roll (::before) + neon bokeh flicker (::after) */
@keyframes vmArcadeScan { to { background-position: 0 4px; } }
@keyframes vmArcadeFlickerBg { 0%,92%,100% { opacity:.8 } 93% { opacity:.5 } 94% { opacity:.8 } 96% { opacity:.6 } 97% { opacity:.82 } }
body::before, [data-chat-bg]::before { animation: vmArcadeScan 1.2s steps(2) infinite; }
body::after, [data-chat-bg]::after { animation: vmArcadeFlickerBg 3.2s steps(1) infinite; }`,
    },
  },

  // ═══════════════════════════════ RIOT ════════════════════════════════════
  {
    id: 'vellum-riot',
    name: 'Vellum · Riot — Cut & Paste Chaos',
    description: 'Acid yellow & violet on newsprint ink. A DIY punk-zine MinimalMessage override with halftone paper, taped/torn poster rails, hard offset shadows, and marker-scrawl headers.',
    accent: hsl(66, 100, 59),
    radiusScale: 0,
    base: {
      background: '#0e0e0c', text: '#ececdf', primary: '#e8ff2e', secondary: '#c400ff',
      speech: '#e8ff2e', thoughts: '#9a9a8e', danger: '#ff1744', success: '#00c853', warning: '#ff9100',
    },
    fonts: "@import url('https://fonts.googleapis.com/css2?family=Anton&family=Oswald:wght@500;700&family=EB+Garamond:ital@0;1&display=swap');",
    vars: `--vm-serif:'Anton','Oswald',Impact,sans-serif;--vm-body:'EB Garamond',Georgia,serif;--vm-deco:'Oswald',Impact,sans-serif;--lumiverse-bg:#0e0e0c;--lumiverse-text:#ececdf;--lumiverse-text-2:#9a9a8e;--lumiverse-accent:#e8ff2e;--lumiverse-accent-2:#c400ff;--glass-border:rgba(236,236,223,.4)`,
    page: `background:
      radial-gradient(700px 460px at 12% -6%, rgba(232,255,46,.1), transparent 60%),
      radial-gradient(620px 460px at 92% 8%, rgba(196,0,255,.12), transparent 62%),
      linear-gradient(172deg,#161612 0%, #0e0e0c 60%, #080806 100%) !important;`,
    pageBefore: `opacity:.5;background-image:radial-gradient(circle at 1px 1px, rgba(236,236,223,.13) 1px, transparent 1.5px);background-size:7px 7px;`,
    pageAfter: `opacity:.8;background-image:radial-gradient(circle at 20% 22%, rgba(232,255,46,.08) 0, transparent 5%),radial-gradient(circle at 82% 70%, rgba(196,0,255,.09) 0, transparent 6%),url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cg fill='none' stroke='%23ececdf' stroke-opacity='0.05' stroke-width='2'%3E%3Cpath d='M20 40 L60 30 M30 80 L70 74 M180 60 L220 52 M170 200 L210 196'/%3E%3C/g%3E%3C/svg%3E");background-repeat:no-repeat,no-repeat,repeat;`,
    skin: `
.vm{--vm-radius:0px}
.vm-portraitA{background:radial-gradient(80% 50% at 50% 6%, rgba(232,255,46,.5), transparent 56%),radial-gradient(70% 40% at 50% 100%, rgba(14,14,12,.92), transparent 62%),linear-gradient(165deg,#c400ff,#5a0078 50%,#120016 100%)}
.vm-portraitB{background:radial-gradient(80% 50% at 50% 6%, rgba(196,0,255,.45), transparent 56%),radial-gradient(70% 40% at 50% 100%, rgba(14,14,12,.92), transparent 62%),linear-gradient(165deg,#e8ff2e,#8a9a00 48%,#181800 100%)}
.vm-grain{opacity:.5;mix-blend-mode:multiply;background-image:radial-gradient(circle at 1px 1px, rgba(0,0,0,.6) 1px, transparent 1.6px);background-size:5px 5px}
.vm-avatar::after{content:"";position:absolute;inset:0;border:3px solid var(--paper,#ececdf);pointer-events:none;z-index:3}
.vm-avatar::before{content:"";position:absolute;top:-8px;left:18px;width:70px;height:24px;background:rgba(232,255,46,.5);transform:rotate(-8deg);z-index:4;box-shadow:0 0 0 1px rgba(0,0,0,.15);animation:vmRiotTape 3s ease-in-out infinite}
@keyframes vmRiotTape{0%,100%{transform:rotate(-8deg)}50%{transform:rotate(-4deg)}}
.vm-name{font-family:var(--vm-serif);font-weight:400;font-size:clamp(1.9rem,2.6vw,2.8rem);line-height:.96;text-transform:uppercase;color:var(--lumiverse-text);background:#101014;padding:2px 12px;transform:rotate(-1.5deg);box-shadow:4px 4px 0 var(--lumiverse-accent)}
.vm-user .vm-name{box-shadow:4px 4px 0 var(--lumiverse-accent-2)}
.vm-pill{font-family:var(--vm-deco);font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#101014 !important;background:var(--lumiverse-accent);padding:1px 8px;transform:rotate(1deg)}
.vm-content{border:3px solid var(--lumiverse-text);background:rgba(24,24,20,.94);box-shadow:6px 6px 0 rgba(236,236,223,.9)}
.vm-leafgrain{position:absolute;inset:0;z-index:0;opacity:.4;mix-blend-mode:multiply;pointer-events:none;background-image:radial-gradient(circle at 1px 1px, rgba(0,0,0,.5) 1px, transparent 1.6px);background-size:5px 5px}
.vm-prose{font-family:var(--vm-body)}
.vm-prose .say{font-weight:600}
.vm-prose strong{background:var(--lumiverse-accent-2);padding:0 3px;color:#fff}
`,
    anim: {
      component: `
.vm-mote{display:block;width:9px;height:9px;background:rgba(232,255,46,.6);box-shadow:0 0 0 1px rgba(0,0,0,.2)}
.vm-m1{left:16%;top:-12px;animation:vmRiotCut 9s linear infinite}
.vm-m2{left:40%;top:-12px;width:7px;height:11px;background:rgba(196,0,255,.55);animation:vmRiotCut 11s linear 1.4s infinite}
.vm-m3{left:62%;top:-12px;width:8px;height:8px;animation:vmRiotCut 8s linear 2.8s infinite}
.vm-m4{left:80%;top:-12px;width:6px;height:10px;background:rgba(196,0,255,.5);animation:vmRiotCut 10.5s linear 4s infinite}
.vm-m5{left:48%;top:-12px;width:10px;height:7px;animation:vmRiotCut 9.6s linear 5.4s infinite}
@keyframes vmRiotCut{0%{transform:translateY(-20px) rotate(0deg);opacity:0}10%{opacity:.7}90%{opacity:.6}100%{transform:translateY(540px) rotate(220deg);opacity:0}}
`,
      global: `
/* halftone paper drift (::before) + violet/acid bokeh throb (::after) */
@keyframes vmRiotHalftone { 0% { background-position:0 0 } 100% { background-position:28px 14px } }
@keyframes vmRiotThrob { 0%,100% { opacity:.7 } 50% { opacity:.9 } }
body::before, [data-chat-bg]::before { animation: vmRiotHalftone 8s linear infinite; }
body::after, [data-chat-bg]::after { animation: vmRiotThrob 5s ease-in-out infinite; }`,
    },
  },

  // ═══════════════════════════════ GRIMOIRE ════════════════════════════════
  {
    id: 'vellum-grimoire',
    name: 'Vellum · Grimoire — A Living Spellbook',
    description: 'Arcane violet & emerald over amethyst void. An illuminated-tome MinimalMessage override with constellation textures, gilt drop-cap prose, flowing magic keylines, drifting arcane motes, and a rune-framed portrait rail.',
    accent: hsl(269, 100, 65),
    radiusScale: 1,
    base: {
      background: '#0d0819', text: '#ece2ff', primary: '#a24cff', secondary: '#2fd48f',
      speech: '#2fd48f', thoughts: '#a98fd0', danger: '#ff5c6a', success: '#2fd48f', warning: '#ffcf5a',
    },
    fonts: "@import url('https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@700;900&family=Cormorant+Garamond:ital,wght@0,600;0,700;1,600&family=EB+Garamond:ital@0;1&display=swap');",
    vars: `--vm-serif:'Cinzel Decorative',Georgia,serif;--vm-body:'EB Garamond',Georgia,serif;--vm-deco:'Cormorant Garamond',Georgia,serif;--lumiverse-bg:#0d0819;--lumiverse-text:#ece2ff;--lumiverse-text-2:#a98fd0;--lumiverse-accent:#a24cff;--lumiverse-accent-2:#2fd48f;--glass-border:rgba(162,76,255,.3)`,
    page: `background:
      radial-gradient(1100px 640px at 50% -10%, rgba(162,76,255,.24), transparent 60%),
      radial-gradient(900px 680px at 8% 110%, rgba(47,212,143,.14), transparent 62%),
      radial-gradient(520px 420px at 82% 40%, rgba(120,80,220,.14), transparent 66%),
      radial-gradient(150% 130% at 50% 46%, transparent 52%, rgba(4,2,12,.74) 100%),
      linear-gradient(165deg,#1a1230 0%, #0d0819 58%, #060310 100%) !important;`,
    pageBefore: `opacity:.7;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cg stroke='%23a24cff' stroke-opacity='0.14' stroke-width='1' fill='none'%3E%3Cpath d='M30 40L96 70L150 34L206 78'/%3E%3Cpath d='M40 180L110 150L168 190L214 150'/%3E%3C/g%3E%3Cg fill='%23ffcf5a'%3E%3Ccircle cx='30' cy='40' r='1.4' fill-opacity='0.7'/%3E%3Ccircle cx='150' cy='34' r='1.2' fill-opacity='0.6'/%3E%3Ccircle cx='168' cy='190' r='1.3' fill-opacity='0.6'/%3E%3C/g%3E%3Cg fill='%232fd48f'%3E%3Ccircle cx='96' cy='70' r='1.1' fill-opacity='0.6'/%3E%3Ccircle cx='110' cy='150' r='1' fill-opacity='0.5'/%3E%3Ccircle cx='214' cy='150' r='1.2' fill-opacity='0.55'/%3E%3C/g%3E%3C/svg%3E");`,
    pageAfter: `opacity:.5;mix-blend-mode:screen;background:radial-gradient(60% 50% at 30% 30%, rgba(162,76,255,.28), transparent 60%),radial-gradient(50% 46% at 74% 70%, rgba(47,212,143,.2), transparent 62%);`,
    skin: `
.vm{--vm-radius:12px}
.vm-portraitA{background:radial-gradient(120% 80% at 46% 6%, rgba(200,160,255,.55), transparent 58%),radial-gradient(60% 50% at 84% 92%, rgba(47,212,143,.4), transparent 70%),radial-gradient(40% 34% at 10% 90%, rgba(120,70,200,.5), transparent 72%),linear-gradient(160deg,#3a2a5c,#241640 48%,#0d0819 100%)}
.vm-portraitB{background:radial-gradient(120% 80% at 54% 6%, rgba(160,230,200,.46), transparent 58%),radial-gradient(60% 50% at 14% 92%, rgba(162,76,255,.44), transparent 70%),radial-gradient(40% 34% at 90% 88%, rgba(47,212,143,.4), transparent 72%),linear-gradient(160deg,#1c3a30,#16283a 48%,#0d0819 100%)}
.vm-grain{opacity:.85;mix-blend-mode:screen;background-image:radial-gradient(2px 2px at 22% 72%, #ffcf5a, transparent 62%),radial-gradient(1.5px 1.5px at 48% 88%, #2fd48f, transparent 62%),radial-gradient(2px 2px at 72% 58%, #a24cff, transparent 62%),radial-gradient(1.5px 1.5px at 34% 40%, #ffcf5a, transparent 62%);background-repeat:no-repeat}
.vm-avatar::after{content:"";position:absolute;inset:6px;border-radius:calc(var(--vm-radius) - 4px);border:1px solid rgba(255,207,90,.5);box-shadow:inset 0 0 26px rgba(162,76,255,.4),inset 0 0 60px rgba(47,212,143,.14);pointer-events:none;z-index:3;animation:vmGrimFrame 5s ease-in-out infinite}
@keyframes vmGrimFrame{0%,100%{box-shadow:inset 0 0 26px rgba(162,76,255,.34),inset 0 0 60px rgba(47,212,143,.12)}50%{box-shadow:inset 0 0 34px rgba(162,76,255,.6),inset 0 0 80px rgba(47,212,143,.22)}}
.vm-header::before{content:"\\2727";color:var(--lumiverse-accent-2);font-size:1rem;opacity:.9;text-shadow:0 0 12px rgba(47,212,143,.6);animation:vmGrimRune 4s ease-in-out infinite}
@keyframes vmGrimRune{0%,100%{opacity:.6;text-shadow:0 0 10px rgba(47,212,143,.5)}50%{opacity:1;text-shadow:0 0 22px rgba(47,212,143,.9),0 0 34px rgba(162,76,255,.5)}}
.vm-name{font-family:var(--vm-serif);font-weight:700;font-size:clamp(1.6rem,2.1vw,2.3rem);line-height:1.02;letter-spacing:.02em;background:linear-gradient(92deg,#a24cff,#d9b6ff 55%,#2fd48f);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;filter:drop-shadow(0 0 12px rgba(162,76,255,.4))}
.vm-user .vm-name{background:linear-gradient(92deg,#2fd48f,#9ff0cf 55%,#a24cff);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.vm-pill{font-family:var(--vm-deco);letter-spacing:.14em;text-transform:uppercase;font-size:.72rem}
.vm-content{border:1px solid var(--glass-border);background:linear-gradient(168deg,rgba(38,26,58,.72),rgba(24,16,40,.72));box-shadow:inset 0 0 24px rgba(162,76,255,.1),0 14px 36px rgba(6,3,16,.55);backdrop-filter:blur(10px) saturate(118%);-webkit-backdrop-filter:blur(10px) saturate(118%)}
.vm-content::after{content:"";position:absolute;inset:6px;z-index:0;border-radius:calc(var(--vm-radius) - 4px);border:1px solid rgba(255,207,90,.28);pointer-events:none}
.vm-content::before{content:"";position:absolute;top:12px;bottom:12px;left:0;width:3px;border-radius:2px;background:linear-gradient(180deg,#a24cff,#2fd48f,#a24cff);background-size:100% 200%;animation:vmGrimFlow 3s linear infinite;box-shadow:0 0 10px rgba(162,76,255,.6)}
.vm-user .vm-content::before{left:auto;right:0}
@keyframes vmGrimFlow{0%{background-position:0 0}100%{background-position:0 200%}}
.vm-prose{font-family:var(--vm-body)}
.vm-prose>p:first-of-type::first-letter{font-family:var(--vm-serif);font-weight:900;font-size:3.2em;line-height:.72;float:left;margin:.06em .12em 0 0;padding:.04em .12em;color:#ffcf5a;background:radial-gradient(circle,rgba(162,76,255,.28),transparent 72%);text-shadow:0 0 16px rgba(255,207,90,.7)}
.vm-prose .say{text-shadow:0 0 12px rgba(47,212,143,.3)}
`,
    anim: {
      component: `
.vm-mote{display:block;width:5px;height:5px;background:radial-gradient(circle,#ffcf5a,rgba(162,76,255,.5) 48%,transparent 72%);box-shadow:0 0 8px rgba(162,76,255,.7),0 0 16px rgba(47,212,143,.4)}
.vm-m1{left:20%;top:30%;animation:vmGrimMote 7s ease-in-out infinite}
.vm-m2{left:52%;top:22%;width:4px;height:4px;animation:vmGrimMote 8.4s ease-in-out 1.2s infinite}
.vm-m3{left:70%;top:44%;width:6px;height:6px;animation:vmGrimMote 6.6s ease-in-out 2.4s infinite}
.vm-m4{left:34%;top:60%;animation:vmGrimMote 9s ease-in-out 3.3s infinite}
.vm-m5{left:78%;top:66%;width:4px;height:4px;animation:vmGrimMote 7.6s ease-in-out 4.5s infinite}
@keyframes vmGrimMote{0%{transform:translate(0,0);opacity:.25}25%{opacity:.9}50%{transform:translate(14px,-20px);opacity:.55}75%{opacity:.9}100%{transform:translate(0,0);opacity:.25}}
`,
      global: `
/* constellation twinkle + drift (::before) and nebula wheel (::after) */
@keyframes vmGrimTwinkle { 0%,100% { opacity:.55 } 50% { opacity:.85 } }
@keyframes vmGrimStarDrift { to { background-position: 240px -240px; } }
@keyframes vmGrimNebula { 0%,100% { transform:scale(1.15) rotate(0deg); opacity:.5 } 50% { transform:scale(1.2) rotate(8deg); opacity:.62 } }
body::before, [data-chat-bg]::before { animation: vmGrimTwinkle 7s ease-in-out infinite, vmGrimStarDrift 120s linear infinite; }
body::after, [data-chat-bg]::after { inset:-25%; transform-origin:50% 50%; animation: vmGrimNebula 60s ease-in-out infinite; }`,
    },
  },

  // ═══════════════════════════════ BESTIARY ════════════════════════════════
  {
    id: 'vellum-bestiary',
    name: 'Vellum · Bestiary — Illuminated Menagerie',
    description: 'Crimson, royal blue & gilt on candlelit vellum. An illuminated-manuscript MinimalMessage override with gilt double frames, vine-corner marginalia, rubricated drop-caps, gold-leaf shimmer, and a candlelight glow.',
    accent: hsl(40, 53, 55),
    radiusScale: 0.3,
    base: {
      background: '#241a10', text: '#f0e2c4', primary: '#c8a24e', secondary: '#2f4a9a',
      speech: '#c8a24e', thoughts: '#b8a276', danger: '#a3243a', success: '#7a8a3a', warning: '#e0c078',
    },
    fonts: "@import url('https://fonts.googleapis.com/css2?family=MedievalSharp&family=UnifrakturCook:wght@700&family=EB+Garamond:ital,wght@0,500;0,600;1,500&display=swap');",
    vars: `--vm-serif:'MedievalSharp',Georgia,serif;--vm-body:'EB Garamond',Georgia,serif;--vm-deco:'UnifrakturCook','MedievalSharp',Georgia,serif;--lumiverse-bg:#241a10;--lumiverse-text:#f0e2c4;--lumiverse-text-2:#b8a276;--lumiverse-accent:#c8a24e;--lumiverse-accent-2:#e0c078;--glass-border:rgba(200,162,78,.4)`,
    page: `background:
      radial-gradient(1000px 620px at 50% -8%, rgba(200,162,78,.2), transparent 60%),
      radial-gradient(820px 600px at 8% 106%, rgba(163,36,58,.14), transparent 62%),
      radial-gradient(520px 400px at 94% 40%, rgba(47,74,154,.12), transparent 66%),
      radial-gradient(140% 128% at 50% 44%, transparent 54%, rgba(12,8,3,.6) 100%),
      linear-gradient(158deg,#2e2213 0%, #241a10 56%, #150f07 100%) !important;`,
    pageBefore: `opacity:.5;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cg fill='none' stroke='%23c8a24e' stroke-opacity='0.24' stroke-width='1.4'%3E%3Cpath d='M10 40 C40 20 40 60 70 44 C56 70 26 66 10 40Z'/%3E%3Cpath d='M190 60 C160 40 160 80 130 64 C144 90 174 86 190 60Z'/%3E%3Cpath d='M40 190 C20 160 60 160 44 130 C70 144 66 174 40 190Z'/%3E%3C/g%3E%3Cg fill='%23c8a24e' fill-opacity='0.2'%3E%3Ccircle cx='84' cy='40' r='2.5'/%3E%3Ccircle cx='40' cy='96' r='2'/%3E%3Ccircle cx='160' cy='120' r='2.4'/%3E%3Ccircle cx='120' cy='170' r='2'/%3E%3C/g%3E%3Cg fill='%23a3243a' fill-opacity='0.16'%3E%3Ccircle cx='150' cy='40' r='3'/%3E%3Ccircle cx='60' cy='150' r='2.6'/%3E%3C/g%3E%3C/svg%3E");`,
    pageAfter: `opacity:.7;background-image:radial-gradient(circle at 16% 22%, rgba(224,192,120,.16) 0, transparent 5%),radial-gradient(circle at 78% 16%, rgba(200,162,78,.13) 0, transparent 4%),radial-gradient(circle at 86% 64%, rgba(47,74,154,.12) 0, transparent 6%),radial-gradient(circle at 30% 80%, rgba(163,36,58,.12) 0, transparent 5%);background-repeat:no-repeat;`,
    skin: `
.vm{--vm-radius:4px}
.vm-portraitA{background:radial-gradient(80% 50% at 50% 6%, rgba(240,211,138,.5), transparent 58%),radial-gradient(70% 46% at 26% 92%, rgba(163,36,58,.5), transparent 70%),radial-gradient(50% 40% at 90% 86%, rgba(47,74,154,.4), transparent 72%),linear-gradient(160deg,#e9d4a2,#b8902e 44%,#3a2a12 100%)}
.vm-portraitB{background:radial-gradient(80% 50% at 50% 6%, rgba(224,220,240,.44), transparent 58%),radial-gradient(70% 46% at 74% 92%, rgba(47,74,154,.5), transparent 70%),radial-gradient(50% 40% at 10% 86%, rgba(163,36,58,.4), transparent 72%),linear-gradient(160deg,#c6cfe6,#5a6ea8 46%,#1c223a 100%)}
.vm-grain{opacity:.42;mix-blend-mode:multiply;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23g)' opacity='0.5'/%3E%3C/svg%3E")}
.vm-avatar::after{content:"";position:absolute;inset:6px;border-radius:2px;border:1px solid rgba(200,162,78,.6);box-shadow:inset 0 0 0 3px rgba(163,36,58,.16),inset 0 0 26px rgba(60,36,12,.5),inset 0 0 80px rgba(30,18,6,.4);pointer-events:none;z-index:3}
.vm-avatar::before{content:"";position:absolute;inset:0;z-index:4;pointer-events:none;background:linear-gradient(115deg,transparent 40%,rgba(240,211,138,.28) 50%,transparent 60%);background-size:250% 250%;animation:vmBestGoldleaf 6s ease-in-out infinite}
@keyframes vmBestGoldleaf{0%{background-position:120% 0}100%{background-position:-40% 0}}
.vm-header::before{content:"\\2767";color:#a3243a;font-size:1.05rem;opacity:.9;text-shadow:0 0 12px rgba(163,36,58,.5);animation:vmBestBob 3s ease-in-out infinite;display:inline-block}
@keyframes vmBestBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
.vm-name{font-family:var(--vm-deco);font-weight:700;font-size:clamp(1.9rem,2.5vw,2.7rem);line-height:1.02;letter-spacing:.01em;color:var(--lumiverse-accent);text-shadow:0 1px 0 rgba(60,36,12,.6),0 0 18px rgba(200,162,78,.4)}
.vm-user .vm-name{color:#2f4a9a;text-shadow:0 1px 0 rgba(10,14,30,.6),0 0 18px rgba(47,74,154,.5)}
.vm-pill{font-family:var(--vm-serif);font-size:.74rem;letter-spacing:.12em;text-transform:uppercase;color:var(--lumiverse-text-2)}
.vm-content{border:2px solid var(--lumiverse-accent);background:rgba(38,28,18,.94);box-shadow:inset 0 0 0 1px rgba(200,162,78,.4),inset 0 0 0 3px rgba(38,28,18,.94),inset 0 0 0 4px rgba(163,36,58,.3),0 8px 24px rgba(12,8,3,.5)}
.vm-leafgrain{position:absolute;inset:0;z-index:0;pointer-events:none}
.vm-leafgrain::before{content:"";position:absolute;top:5px;left:5px;width:30px;height:30px;border-top:2px solid #a3243a;border-left:2px solid #a3243a;border-top-left-radius:12px;opacity:.6}
.vm-leafgrain::after{content:"";position:absolute;bottom:5px;right:5px;width:30px;height:30px;border-bottom:2px solid #2f4a9a;border-right:2px solid #2f4a9a;border-bottom-right-radius:12px;opacity:.55}
.vm-prose{font-family:var(--vm-body)}
.vm-prose>p:first-of-type::first-letter{font-family:var(--vm-deco);font-weight:700;font-size:3.4em;line-height:.7;float:left;margin:.06em .12em 0 0;padding:.06em .16em;color:var(--lumiverse-text);background:#a3243a;box-shadow:0 0 0 2px var(--lumiverse-accent);text-shadow:0 1px 2px rgba(0,0,0,.4)}
.vm-prose em{font-style:italic;color:var(--lumiverse-text-2)}
.vm-prose .say{color:var(--lumiverse-accent);font-family:var(--vm-serif);text-shadow:0 0 12px rgba(200,162,78,.3)}
.vm-user .vm-prose .say{color:#2f4a9a}
.vm-prose strong{color:#fff;font-weight:700}
`,
    anim: {
      component: `
.vm-mote{display:block;width:5px;height:5px;background:radial-gradient(circle,#f0d38a,rgba(200,162,78,.6) 48%,transparent 72%);box-shadow:0 0 8px rgba(200,162,78,.7),0 0 16px rgba(163,36,58,.3)}
.vm-m1{left:20%;top:34%;animation:vmBestMote 8s ease-in-out infinite}
.vm-m2{left:50%;top:24%;width:4px;height:4px;animation:vmBestMote 10s ease-in-out 1.3s infinite}
.vm-m3{left:70%;top:46%;width:6px;height:6px;animation:vmBestMote 8.6s ease-in-out 2.5s infinite}
.vm-m4{left:34%;top:62%;animation:vmBestMote 11s ease-in-out 3.4s infinite}
.vm-m5{left:80%;top:66%;width:4px;height:4px;animation:vmBestMote 9.2s ease-in-out 4.6s infinite}
@keyframes vmBestMote{0%,100%{transform:translate(0,0);opacity:.25}50%{transform:translate(12px,-18px);opacity:.85}}
`,
      global: `
/* gilt vine marginalia drift (::before) + gold bokeh breathe (::after) */
@keyframes vmBestVineDrift { to { background-position: 200px 200px; } }
@keyframes vmBestGiltBreathe { 0%,100% { opacity:.6; transform:scale(1) } 50% { opacity:.82; transform:scale(1.02) } }
body::before, [data-chat-bg]::before { animation: vmBestVineDrift 60s linear infinite; }
body::after, [data-chat-bg]::after { animation: vmBestGiltBreathe 8s ease-in-out infinite; }`,
    },
  },

  // ═══════════════════════════════ TERRACOTTA ══════════════════════════════
  {
    id: 'vellum-terracotta',
    name: 'Vellum · Terracotta — Casa del Sol',
    description: 'Fired clay & glazed azulejo teal on sun-baked plaster. A Mediterranean-courtyard MinimalMessage override with talavera-tile textures, a glazed-sheen sweep across every card, kiln-warm glow, and a double-keyline portrait rail.',
    accent: hsl(18, 53, 54),
    mode: 'light',
    radiusScale: 0.5,
    base: {
      background: '#efe0c8', text: '#3a2418', primary: '#c96f4a', secondary: '#2f8f8f',
      speech: '#b5432f', thoughts: '#8a6a4a', danger: '#b5432f', success: '#6f8f3a', warning: '#d99a2e',
    },
    fonts: "@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,600;0,9..144,700;1,9..144,500&family=EB+Garamond:ital@0;1&display=swap');",
    vars: `--vm-serif:'Fraunces',Georgia,serif;--vm-body:'EB Garamond',Georgia,serif;--vm-deco:'Fraunces',Georgia,serif;--lumiverse-bg:#efe0c8;--lumiverse-text:#3a2418;--lumiverse-text-2:#8a6a4a;--lumiverse-accent:#c96f4a;--lumiverse-accent-2:#2f8f8f;--glass-border:rgba(216,185,140,.7)`,
    page: `background:
      repeating-linear-gradient(0deg, rgba(58,36,24,.05) 0 1px, transparent 1px 46px),
      repeating-linear-gradient(90deg, rgba(58,36,24,.05) 0 1px, transparent 1px 46px),
      radial-gradient(120% 90% at 20% 0%, #f6ead7, transparent 60%),
      linear-gradient(160deg,#efe0c8 0%, #e6cfae 100%) !important;`,
    pageBefore: `opacity:.5;background-image:radial-gradient(circle at 1px 1px, rgba(58,36,24,.08) 1px, transparent 1.6px);background-size:24px 24px;`,
    pageAfter: `opacity:.7;background-image:radial-gradient(circle at 16% 22%, rgba(201,111,74,.1) 0, transparent 6%),radial-gradient(circle at 82% 18%, rgba(47,143,143,.08) 0, transparent 5%),radial-gradient(circle at 30% 82%, rgba(217,154,46,.08) 0, transparent 6%);background-repeat:no-repeat;`,
    skin: `
.vm{--vm-radius:8px}
.vm-portraitA{background:radial-gradient(90% 60% at 50% 6%, rgba(246,234,215,.7), transparent 58%),radial-gradient(70% 46% at 22% 92%, rgba(201,111,74,.5), transparent 70%),linear-gradient(160deg,#e6cfae,#c96f4a 52%,#5a3218 100%)}
.vm-portraitB{background:radial-gradient(90% 60% at 50% 6%, rgba(246,234,215,.62), transparent 58%),radial-gradient(70% 46% at 78% 92%, rgba(47,143,143,.5), transparent 70%),linear-gradient(160deg,#d8e0d4,#2f8f8f 50%,#173a3a 100%)}
.vm-grain{opacity:.4;mix-blend-mode:multiply;background-image:radial-gradient(circle at 1px 1px, rgba(58,36,24,.3) 1px, transparent 1.6px);background-size:6px 6px}
.vm-avatar::after{content:"";position:absolute;inset:5px;border:2px solid rgba(246,234,215,.7);border-radius:6px;box-shadow:0 0 0 2px rgba(201,111,74,.5),inset 0 0 20px rgba(90,50,24,.3);pointer-events:none;z-index:3}
.vm-header::before{content:"\\25C8";color:var(--lumiverse-accent-2);font-size:.9rem;opacity:.85}
.vm-name{font-family:var(--vm-serif);font-weight:700;font-size:clamp(1.7rem,2.2vw,2.4rem);line-height:1.02;letter-spacing:.01em;color:var(--lumiverse-accent)}
.vm-user .vm-name{color:var(--lumiverse-accent-2)}
.vm-pill{font-family:var(--vm-deco);font-style:italic;letter-spacing:.04em;font-size:.8rem;color:var(--lumiverse-text-2)}
.vm-content{border:1.5px solid var(--glass-border);background:linear-gradient(168deg,rgba(244,230,210,.95),rgba(236,216,189,.95));box-shadow:inset 0 0 0 3px rgba(255,255,255,.4),inset 0 0 0 4px rgba(201,111,74,.28),0 4px 12px rgba(120,70,30,.18)}
.vm-content::after{content:"";position:absolute;inset:0;pointer-events:none;z-index:2;background:linear-gradient(115deg,transparent 42%,rgba(255,255,255,.35) 50%,transparent 58%);background-size:260% 260%;animation:vmTerraGlaze 7s ease-in-out infinite}
@keyframes vmTerraGlaze{0%{background-position:130% 0}100%{background-position:-40% 0}}
.vm-leafgrain{position:absolute;inset:0;z-index:0;opacity:.5;pointer-events:none;background-image:repeating-linear-gradient(0deg, rgba(58,36,24,.05) 0 1px, transparent 1px 24px),repeating-linear-gradient(90deg, rgba(58,36,24,.05) 0 1px, transparent 1px 24px)}
.vm-prose{font-family:var(--vm-body)}
.vm-prose .say{color:var(--lumiverse-accent);font-weight:600}
.vm-user .vm-prose .say{color:var(--lumiverse-accent-2)}
`,
    anim: {
      component: `
.vm-mote{display:block;width:5px;height:5px;border-radius:50%;background:radial-gradient(circle,rgba(217,154,46,.8),rgba(201,111,74,.4) 50%,transparent 72%);box-shadow:0 0 6px rgba(217,154,46,.5)}
.vm-m1{left:20%;bottom:8%;animation:vmTerraDust 9s ease-in-out infinite}
.vm-m2{left:46%;bottom:3%;width:4px;height:4px;animation:vmTerraDust 11s ease-in-out 1.4s infinite}
.vm-m3{left:66%;bottom:12%;animation:vmTerraDust 8s ease-in-out 2.6s infinite}
.vm-m4{left:82%;bottom:5%;width:4px;height:4px;animation:vmTerraDust 10.5s ease-in-out 3.8s infinite}
.vm-m5{left:32%;bottom:16%;animation:vmTerraDust 9.6s ease-in-out 5s infinite}
@keyframes vmTerraDust{0%{transform:translateY(0);opacity:0}14%{opacity:.7}86%{opacity:.5}100%{transform:translateY(-220px);opacity:0}}
`,
      global: `
/* talavera tile grain drift (::before) + warm bokeh breathe (::after) */
@keyframes vmTerraGrain { to { background-position: 24px 24px; } }
@keyframes vmTerraBreathe { 0%,100% { opacity:.6 } 50% { opacity:.82 } }
body::before, [data-chat-bg]::before { animation: vmTerraGrain 40s linear infinite; }
body::after, [data-chat-bg]::after { animation: vmTerraBreathe 9s ease-in-out infinite; }`,
    },
  },

  // ═══════════════════════════════ GREENHOUSE ══════════════════════════════
  {
    id: 'vellum-greenhouse',
    name: 'Vellum · Greenhouse — The Conservatory',
    description: 'Leaf-green & brass under a sunlit glasshouse. A solarpunk MinimalMessage override with a glass-pane muntin grid, a slow sun-dapple sweep, art-nouveau vine growth, and a brass-framed portrait rail.',
    accent: hsl(137, 38, 40),
    mode: 'light',
    radiusScale: 1,
    base: {
      background: '#eef5e4', text: '#21301d', primary: '#3f8f57', secondary: '#c69a3e',
      speech: '#b3812a', thoughts: '#5c6b52', danger: '#c65a4a', success: '#4f9a44', warning: '#d99a3a',
    },
    fonts: "@import url('https://fonts.googleapis.com/css2?family=Yeseva+One&family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=EB+Garamond:ital@0;1&display=swap');",
    vars: `--vm-serif:'Yeseva One',Georgia,serif;--vm-body:'EB Garamond',Georgia,serif;--vm-deco:'Cormorant Garamond',Georgia,serif;--lumiverse-bg:#eef5e4;--lumiverse-text:#21301d;--lumiverse-text-2:#5c6b52;--lumiverse-accent:#3f8f57;--lumiverse-accent-2:#c69a3e;--glass-border:rgba(198,154,62,.4)`,
    page: `background:
      linear-gradient(115deg, transparent 46%, rgba(198,154,62,.06) 50%, transparent 54%),
      linear-gradient(160deg,#eef5e4 0%, #dfeacd 100%) !important;`,
    pageBefore: `opacity:.5;background-image:linear-gradient(rgba(63,143,87,.14) 1px, transparent 1px),linear-gradient(90deg, rgba(63,143,87,.14) 1px, transparent 1px);background-size:46px 46px;`,
    pageAfter: `background:linear-gradient(115deg, transparent 30%, rgba(214,178,90,.22) 48%, transparent 66%);background-size:260% 100%;`,
    skin: `
.vm{--vm-radius:16px}
.vm-portraitA{background:radial-gradient(90% 60% at 50% 8%, rgba(248,251,242,.7), transparent 58%),radial-gradient(70% 46% at 24% 92%, rgba(63,143,87,.5), transparent 70%),linear-gradient(160deg,#cfe0c0,#3f8f57 52%,#1a3a24 100%)}
.vm-portraitB{background:radial-gradient(90% 60% at 50% 8%, rgba(248,251,242,.64), transparent 58%),radial-gradient(70% 46% at 76% 92%, rgba(198,154,62,.5), transparent 70%),linear-gradient(160deg,#e6dcc0,#c69a3e 50%,#5a4618 100%)}
.vm-grain{opacity:.4;mix-blend-mode:multiply;background-image:linear-gradient(rgba(63,143,87,.2) 1px, transparent 1px),linear-gradient(90deg, rgba(63,143,87,.2) 1px, transparent 1px);background-size:24px 24px}
.vm-avatar::after{content:"";position:absolute;inset:5px;border:2px solid rgba(198,154,62,.7);border-radius:6px 6px 18px 18px;box-shadow:inset 0 0 22px rgba(30,50,25,.3);pointer-events:none;z-index:3}
.vm-header::before{content:"\\2767";color:var(--lumiverse-accent-2);font-size:1rem;opacity:.85}
.vm-name{font-family:var(--vm-serif);font-weight:400;font-size:clamp(1.7rem,2.2vw,2.4rem);line-height:1.04;color:var(--lumiverse-accent)}
.vm-user .vm-name{color:var(--lumiverse-accent-2)}
.vm-pill{font-family:var(--vm-deco);font-style:italic;letter-spacing:.04em;font-size:.82rem;color:var(--lumiverse-text-2)}
.vm-content{border:1px solid var(--glass-border);border-radius:6px 6px 18px 18px;background:linear-gradient(168deg,rgba(248,251,242,.94),rgba(233,242,224,.94));box-shadow:inset 0 1px 0 rgba(255,255,255,.7),0 6px 16px rgba(40,60,30,.14)}
.vm-content::before{content:"";position:absolute;left:6px;bottom:6px;width:26px;height:30px;pointer-events:none;z-index:1;border-left:2px solid rgba(63,143,87,.5);border-bottom:2px solid rgba(63,143,87,.5);border-bottom-left-radius:22px;opacity:.7;transform-origin:bottom left;animation:vmGhGrow 3.6s ease-in-out infinite}
@keyframes vmGhGrow{0%,100%{transform:scaleY(.86) rotate(0deg)}50%{transform:scaleY(1.05) rotate(-3deg)}}
.vm-leafgrain{position:absolute;inset:0;z-index:0;opacity:.5;pointer-events:none;background-image:linear-gradient(rgba(63,143,87,.1) 1px, transparent 1px),linear-gradient(90deg, rgba(63,143,87,.1) 1px, transparent 1px);background-size:24px 24px}
.vm-prose{font-family:var(--vm-body)}
.vm-prose .say{color:var(--lumiverse-accent);font-weight:600}
.vm-user .vm-prose .say{color:var(--lumiverse-accent-2)}
`,
    anim: {
      component: `
.vm-mote{display:block;width:5px;height:5px;border-radius:50%;background:radial-gradient(circle,rgba(198,154,62,.7),rgba(63,143,87,.4) 50%,transparent 72%);box-shadow:0 0 6px rgba(198,154,62,.4)}
.vm-m1{left:22%;bottom:10%;animation:vmGhPollen 10s ease-in-out infinite}
.vm-m2{left:48%;bottom:4%;width:4px;height:4px;animation:vmGhPollen 12s ease-in-out 1.6s infinite}
.vm-m3{left:68%;bottom:14%;animation:vmGhPollen 9s ease-in-out 2.8s infinite}
.vm-m4{left:84%;bottom:6%;width:4px;height:4px;animation:vmGhPollen 11.5s ease-in-out 4s infinite}
.vm-m5{left:34%;bottom:18%;animation:vmGhPollen 10.6s ease-in-out 5.4s infinite}
@keyframes vmGhPollen{0%{transform:translate(0,0);opacity:0}15%{opacity:.7}50%{transform:translate(12px,-120px);opacity:.5}85%{opacity:.4}100%{transform:translate(-6px,-240px);opacity:0}}
`,
      global: `
/* glass-pane grid drift (::before) + sun-dapple sweep (::after) */
@keyframes vmGhPaneDrift { to { background-position: 46px 46px; } }
@keyframes vmGhSun { 0%{background-position:120% 0} 100%{background-position:-40% 0} }
body::before, [data-chat-bg]::before { animation: vmGhPaneDrift 50s linear infinite; }
body::after, [data-chat-bg]::after { animation: vmGhSun 11s ease-in-out infinite; }`,
    },
  },

  // ═══════════════════════════ TERRACOTTA (DARK) ═══════════════════════════
  {
    id: 'vellum-terracotta-dark',
    name: 'Vellum · Terracotta — Casa de Noche',
    description: 'Fired clay & glazed azulejo teal after dark. The night-mode twin of Casa del Sol: warm terracotta glow over deep umber plaster, a glazed-sheen sweep across every card, kiln-warm motes, and a double-keyline portrait rail.',
    accent: hsl(18, 53, 54),
    mode: 'dark',
    radiusScale: 0.5,
    base: {
      background: '#1c120b', text: '#f4e2cc', primary: '#d0764f', secondary: '#3fa6a6',
      speech: '#e0895a', thoughts: '#b0906a', danger: '#d4553a', success: '#8faa4a', warning: '#e0a94a',
    },
    fonts: "@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,600;0,9..144,700;1,9..144,500&family=EB+Garamond:ital@0;1&display=swap');",
    vars: `--vm-serif:'Fraunces',Georgia,serif;--vm-body:'EB Garamond',Georgia,serif;--vm-deco:'Fraunces',Georgia,serif;--lumiverse-bg:#1c120b;--lumiverse-text:#f4e2cc;--lumiverse-text-2:#b0906a;--lumiverse-accent:#d0764f;--lumiverse-accent-2:#3fa6a6;--glass-border:rgba(208,118,79,.34)`,
    page: `background:
      repeating-linear-gradient(0deg, rgba(255,230,200,.035) 0 1px, transparent 1px 46px),
      repeating-linear-gradient(90deg, rgba(255,230,200,.035) 0 1px, transparent 1px 46px),
      radial-gradient(120% 90% at 20% 0%, rgba(90,50,24,.5), transparent 60%),
      radial-gradient(120% 128% at 50% 44%, transparent 54%, rgba(8,5,2,.6) 100%),
      linear-gradient(160deg,#2a1a0f 0%, #1c120b 56%, #0e0805 100%) !important;`,
    pageBefore: `opacity:.5;background-image:radial-gradient(circle at 1px 1px, rgba(255,230,200,.08) 1px, transparent 1.6px);background-size:24px 24px;`,
    pageAfter: `opacity:.7;background-image:radial-gradient(circle at 16% 22%, rgba(208,118,79,.14) 0, transparent 6%),radial-gradient(circle at 82% 18%, rgba(63,166,166,.1) 0, transparent 5%),radial-gradient(circle at 30% 82%, rgba(224,169,74,.1) 0, transparent 6%);background-repeat:no-repeat;`,
    skin: `
.vm{--vm-radius:8px}
.vm-portraitA{background:radial-gradient(90% 60% at 50% 6%, rgba(208,118,79,.55), transparent 58%),radial-gradient(70% 46% at 22% 92%, rgba(90,50,24,.6), transparent 70%),linear-gradient(160deg,#3a2416,#c96f4a 58%,#1c120b 100%)}
.vm-portraitB{background:radial-gradient(90% 60% at 50% 6%, rgba(63,166,166,.5), transparent 58%),radial-gradient(70% 46% at 78% 92%, rgba(23,58,58,.62), transparent 70%),linear-gradient(160deg,#173a3a,#2f8f8f 54%,#0e1c1c 100%)}
.vm-grain{opacity:.4;mix-blend-mode:overlay;background-image:radial-gradient(circle at 1px 1px, rgba(255,230,200,.16) 1px, transparent 1.6px);background-size:6px 6px}
.vm-avatar::after{content:"";position:absolute;inset:5px;border:2px solid rgba(208,118,79,.55);border-radius:6px;box-shadow:0 0 0 2px rgba(90,50,24,.5),inset 0 0 22px rgba(0,0,0,.4);pointer-events:none;z-index:3}
.vm-header::before{content:"\\25C8";color:var(--lumiverse-accent-2);font-size:.9rem;opacity:.85}
.vm-name{font-family:var(--vm-serif);font-weight:700;font-size:clamp(1.7rem,2.2vw,2.4rem);line-height:1.02;letter-spacing:.01em;color:var(--lumiverse-accent)}
.vm-user .vm-name{color:var(--lumiverse-accent-2)}
.vm-pill{font-family:var(--vm-deco);font-style:italic;letter-spacing:.04em;font-size:.8rem;color:var(--lumiverse-text-2)}
.vm-content{border:1.5px solid var(--glass-border);background:linear-gradient(168deg,rgba(44,28,18,.95),rgba(30,20,12,.96));box-shadow:inset 0 0 0 3px rgba(255,230,200,.05),inset 0 0 0 4px rgba(208,118,79,.24),0 8px 22px rgba(6,3,1,.5)}
.vm-content::after{content:"";position:absolute;inset:0;pointer-events:none;z-index:2;background:linear-gradient(115deg,transparent 42%,rgba(255,235,205,.16) 50%,transparent 58%);background-size:260% 260%;animation:vmTerraGlaze 7s ease-in-out infinite}
@keyframes vmTerraGlaze{0%{background-position:130% 0}100%{background-position:-40% 0}}
.vm-leafgrain{position:absolute;inset:0;z-index:0;opacity:.5;pointer-events:none;background-image:repeating-linear-gradient(0deg, rgba(255,230,200,.035) 0 1px, transparent 1px 24px),repeating-linear-gradient(90deg, rgba(255,230,200,.035) 0 1px, transparent 1px 24px)}
.vm-prose{font-family:var(--vm-body)}
.vm-prose .say{color:var(--lumiverse-accent);font-weight:600}
.vm-user .vm-prose .say{color:var(--lumiverse-accent-2)}
`,
    anim: {
      component: `
.vm-mote{display:block;width:5px;height:5px;border-radius:50%;background:radial-gradient(circle,rgba(224,169,74,.85),rgba(208,118,79,.4) 50%,transparent 72%);box-shadow:0 0 6px rgba(224,169,74,.6)}
.vm-m1{left:20%;bottom:8%;animation:vmTerraDust 9s ease-in-out infinite}
.vm-m2{left:46%;bottom:3%;width:4px;height:4px;animation:vmTerraDust 11s ease-in-out 1.4s infinite}
.vm-m3{left:66%;bottom:12%;animation:vmTerraDust 8s ease-in-out 2.6s infinite}
.vm-m4{left:82%;bottom:5%;width:4px;height:4px;animation:vmTerraDust 10.5s ease-in-out 3.8s infinite}
.vm-m5{left:32%;bottom:16%;animation:vmTerraDust 9.6s ease-in-out 5s infinite}
@keyframes vmTerraDust{0%{transform:translateY(0);opacity:0}14%{opacity:.8}86%{opacity:.6}100%{transform:translateY(-220px);opacity:0}}
`,
      global: `
/* talavera tile grain drift (::before) + warm bokeh breathe (::after) */
@keyframes vmTerraGrain { to { background-position: 24px 24px; } }
@keyframes vmTerraBreathe { 0%,100% { opacity:.6 } 50% { opacity:.82 } }
body::before, [data-chat-bg]::before { animation: vmTerraGrain 40s linear infinite; }
body::after, [data-chat-bg]::after { animation: vmTerraBreathe 9s ease-in-out infinite; }`,
    },
  },

  // ═══════════════════════════ GREENHOUSE (DARK) ════════════════════════════
  {
    id: 'vellum-greenhouse-dark',
    name: 'Vellum · Greenhouse — The Conservatory (Night)',
    description: 'Leaf-green & brass in a moonlit glasshouse. The night-mode twin of The Conservatory: verdant green over deep botanical dark, a glass-pane muntin grid, a slow moonlight sweep, art-nouveau vine growth, and a brass-framed portrait rail.',
    accent: hsl(137, 42, 46),
    mode: 'dark',
    radiusScale: 1,
    base: {
      background: '#0e1811', text: '#e2eed8', primary: '#5aae6e', secondary: '#d0a94a',
      speech: '#cf9e3a', thoughts: '#8ba07f', danger: '#d0685a', success: '#5aae6e', warning: '#d9a83a',
    },
    fonts: "@import url('https://fonts.googleapis.com/css2?family=Yeseva+One&family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=EB+Garamond:ital@0;1&display=swap');",
    vars: `--vm-serif:'Yeseva One',Georgia,serif;--vm-body:'EB Garamond',Georgia,serif;--vm-deco:'Cormorant Garamond',Georgia,serif;--lumiverse-bg:#0e1811;--lumiverse-text:#e2eed8;--lumiverse-text-2:#8ba07f;--lumiverse-accent:#5aae6e;--lumiverse-accent-2:#d0a94a;--glass-border:rgba(208,169,74,.4)`,
    page: `background:
      linear-gradient(115deg, transparent 46%, rgba(208,169,74,.05) 50%, transparent 54%),
      radial-gradient(120% 90% at 20% 0%, rgba(30,60,36,.5), transparent 60%),
      radial-gradient(120% 128% at 50% 44%, transparent 54%, rgba(4,10,6,.6) 100%),
      linear-gradient(160deg,#16281b 0%, #0e1811 56%, #060f09 100%) !important;`,
    pageBefore: `opacity:.5;background-image:linear-gradient(rgba(90,174,110,.12) 1px, transparent 1px),linear-gradient(90deg, rgba(90,174,110,.12) 1px, transparent 1px);background-size:46px 46px;`,
    pageAfter: `background:linear-gradient(115deg, transparent 30%, rgba(208,169,74,.14) 48%, transparent 66%);background-size:260% 100%;`,
    skin: `
.vm{--vm-radius:16px}
.vm-portraitA{background:radial-gradient(90% 60% at 50% 8%, rgba(90,174,110,.5), transparent 58%),radial-gradient(70% 46% at 24% 92%, rgba(20,50,28,.62), transparent 70%),linear-gradient(160deg,#1e3a26,#3f8f57 54%,#0e1811 100%)}
.vm-portraitB{background:radial-gradient(90% 60% at 50% 8%, rgba(208,169,74,.5), transparent 58%),radial-gradient(70% 46% at 76% 92%, rgba(60,46,18,.6), transparent 70%),linear-gradient(160deg,#3a2e12,#c69a3e 52%,#1a1408 100%)}
.vm-grain{opacity:.4;mix-blend-mode:overlay;background-image:linear-gradient(rgba(90,174,110,.18) 1px, transparent 1px),linear-gradient(90deg, rgba(90,174,110,.18) 1px, transparent 1px);background-size:24px 24px}
.vm-avatar::after{content:"";position:absolute;inset:5px;border:2px solid rgba(208,169,74,.6);border-radius:6px 6px 18px 18px;box-shadow:inset 0 0 22px rgba(0,0,0,.4);pointer-events:none;z-index:3}
.vm-header::before{content:"\\2767";color:var(--lumiverse-accent-2);font-size:1rem;opacity:.85}
.vm-name{font-family:var(--vm-serif);font-weight:400;font-size:clamp(1.7rem,2.2vw,2.4rem);line-height:1.04;color:var(--lumiverse-accent)}
.vm-user .vm-name{color:var(--lumiverse-accent-2)}
.vm-pill{font-family:var(--vm-deco);font-style:italic;letter-spacing:.04em;font-size:.82rem;color:var(--lumiverse-text-2)}
.vm-content{border:1px solid var(--glass-border);border-radius:6px 6px 18px 18px;background:linear-gradient(168deg,rgba(20,34,24,.95),rgba(12,22,15,.96));box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 6px 16px rgba(2,8,4,.5)}
.vm-content::before{content:"";position:absolute;left:6px;bottom:6px;width:26px;height:30px;pointer-events:none;z-index:1;border-left:2px solid rgba(90,174,110,.6);border-bottom:2px solid rgba(90,174,110,.6);border-bottom-left-radius:22px;opacity:.7;transform-origin:bottom left;animation:vmGhGrow 3.6s ease-in-out infinite}
@keyframes vmGhGrow{0%,100%{transform:scaleY(.86) rotate(0deg)}50%{transform:scaleY(1.05) rotate(-3deg)}}
.vm-leafgrain{position:absolute;inset:0;z-index:0;opacity:.5;pointer-events:none;background-image:linear-gradient(rgba(90,174,110,.09) 1px, transparent 1px),linear-gradient(90deg, rgba(90,174,110,.09) 1px, transparent 1px);background-size:24px 24px}
.vm-prose{font-family:var(--vm-body)}
.vm-prose .say{color:var(--lumiverse-accent);font-weight:600}
.vm-user .vm-prose .say{color:var(--lumiverse-accent-2)}
`,
    anim: {
      component: `
.vm-mote{display:block;width:5px;height:5px;border-radius:50%;background:radial-gradient(circle,rgba(208,169,74,.75),rgba(90,174,110,.4) 50%,transparent 72%);box-shadow:0 0 6px rgba(208,169,74,.45)}
.vm-m1{left:22%;bottom:10%;animation:vmGhPollen 10s ease-in-out infinite}
.vm-m2{left:48%;bottom:4%;width:4px;height:4px;animation:vmGhPollen 12s ease-in-out 1.6s infinite}
.vm-m3{left:68%;bottom:14%;animation:vmGhPollen 9s ease-in-out 2.8s infinite}
.vm-m4{left:84%;bottom:6%;width:4px;height:4px;animation:vmGhPollen 11.5s ease-in-out 4s infinite}
.vm-m5{left:34%;bottom:18%;animation:vmGhPollen 10.6s ease-in-out 5.4s infinite}
@keyframes vmGhPollen{0%{transform:translate(0,0);opacity:0}15%{opacity:.7}50%{transform:translate(12px,-120px);opacity:.5}85%{opacity:.4}100%{transform:translate(-6px,-240px);opacity:0}}
`,
      global: `
/* glass-pane grid drift (::before) + moonlight sweep (::after) */
@keyframes vmGhPaneDrift { to { background-position: 46px 46px; } }
@keyframes vmGhSun { 0%{background-position:120% 0} 100%{background-position:-40% 0} }
body::before, [data-chat-bg]::before { animation: vmGhPaneDrift 50s linear infinite; }
body::after, [data-chat-bg]::after { animation: vmGhSun 11s ease-in-out infinite; }`,
    },
  },

  // ═══════════════════════════════ AURORA ══════════════════════════════════
  {
    id: 'vellum-aurora',
    name: 'Vellum · Aurora — 69°N',
    description: 'Teal & violet northern lights over a glacier. A polar-night MinimalMessage override with a starfield, waving aurora curtains, hue-shifting glacial-glass keylines, and drifting snow motes.',
    accent: hsl(167, 82, 62),
    radiusScale: 0.875,
    base: {
      background: '#0c1830', text: '#e6f0f7', primary: '#4ff0c0', secondary: '#9a6cff',
      speech: '#4ff0c0', thoughts: '#8fa8bc', danger: '#ff6a8a', success: '#4ff0c0', warning: '#ffd66a',
    },
    fonts: "@import url('https://fonts.googleapis.com/css2?family=Josefin+Sans:wght@300;400;600&family=EB+Garamond:ital@0;1&display=swap');",
    vars: `--vm-serif:'Josefin Sans',sans-serif;--vm-body:'EB Garamond',Georgia,serif;--vm-deco:'Josefin Sans',sans-serif;--lumiverse-bg:#0c1830;--lumiverse-text:#e6f0f7;--lumiverse-text-2:#8fa8bc;--lumiverse-accent:#4ff0c0;--lumiverse-accent-2:#9a6cff;--glass-border:rgba(79,240,192,.2)`,
    page: `background:
      radial-gradient(1000px 300px at 50% -20%, rgba(79,240,192,.16), transparent 60%),
      radial-gradient(700px 260px at 80% -8%, rgba(154,108,255,.14), transparent 62%),
      linear-gradient(180deg,#0c1830 0%, #060c1c 100%) !important;`,
    pageBefore: `background-image:radial-gradient(1.2px 1.2px at 12% 24%, rgba(255,255,255,.8), transparent),radial-gradient(1px 1px at 68% 16%, rgba(255,255,255,.6), transparent),radial-gradient(1.4px 1.4px at 42% 40%, rgba(200,230,255,.7), transparent),radial-gradient(1px 1px at 86% 30%, rgba(255,255,255,.6), transparent),radial-gradient(1px 1px at 26% 12%, rgba(255,255,255,.55), transparent);background-repeat:no-repeat;`,
    pageAfter: `top:0;left:-20%;right:-20%;bottom:auto;height:60%;background:linear-gradient(100deg, transparent 20%, rgba(79,240,192,.22) 40%, rgba(154,108,255,.18) 58%, transparent 78%);filter:blur(14px);background-size:200% 100%;`,
    skin: `
.vm{--vm-radius:14px}
.vm-portraitA{background:radial-gradient(90% 60% at 50% 8%, rgba(79,240,192,.4), transparent 58%),radial-gradient(70% 46% at 76% 92%, rgba(154,108,255,.44), transparent 70%),linear-gradient(160deg,#16324a,#0a1830 52%,#050a18 100%)}
.vm-portraitB{background:radial-gradient(90% 60% at 50% 8%, rgba(154,108,255,.44), transparent 58%),radial-gradient(70% 46% at 24% 92%, rgba(79,240,192,.4), transparent 70%),linear-gradient(160deg,#1a2c4a,#0a1830 52%,#050a18 100%)}
.vm-grain{opacity:.5;background-image:radial-gradient(1.2px 1.2px at 20% 30%, rgba(255,255,255,.8), transparent),radial-gradient(1px 1px at 70% 50%, rgba(200,230,255,.6), transparent),radial-gradient(1px 1px at 44% 74%, rgba(255,255,255,.5), transparent);background-repeat:no-repeat}
.vm-avatar::after{content:"";position:absolute;inset:5px;border:1px solid rgba(79,240,192,.5);border-radius:12px;box-shadow:inset 0 0 22px rgba(79,240,192,.14),0 0 14px rgba(79,240,192,.3);pointer-events:none;z-index:3}
.vm-header::before{content:"\\2726";color:var(--lumiverse-accent);font-size:.85rem;opacity:.9;text-shadow:0 0 10px rgba(79,240,192,.6)}
.vm-name{font-family:var(--vm-serif);font-weight:600;font-size:clamp(1.7rem,2.2vw,2.4rem);line-height:1.04;letter-spacing:.08em;text-transform:uppercase;color:#9ff0da;text-shadow:0 0 12px rgba(79,240,192,.4)}
.vm-user .vm-name{color:#c4abff;text-shadow:0 0 12px rgba(154,108,255,.5)}
.vm-pill{font-family:var(--vm-deco);letter-spacing:.2em;text-transform:uppercase;font-size:.72rem;color:var(--lumiverse-text-2)}
.vm-content{border:1px solid rgba(79,240,192,.2);background:linear-gradient(168deg,rgba(16,26,44,.72),rgba(9,16,32,.78));box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 6px 22px rgba(2,6,18,.5);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}
.vm-content::before{content:"";position:absolute;top:0;left:12px;right:12px;height:2px;pointer-events:none;z-index:2;background:linear-gradient(90deg,#4ff0c0,#9a6cff,#6ab8ff,#4ff0c0);background-size:300% 100%;box-shadow:0 0 10px rgba(79,240,192,.5);animation:vmAuFlow 6s linear infinite}
@keyframes vmAuFlow{0%{background-position:0 0}100%{background-position:300% 0}}
.vm-prose{font-family:var(--vm-body)}
.vm-prose .say{text-shadow:0 0 12px rgba(79,240,192,.3)}
`,
    anim: {
      component: `
.vm-mote{display:block;width:4px;height:4px;border-radius:50%;background:radial-gradient(circle,#fff,rgba(200,230,255,.5) 50%,transparent 72%);box-shadow:0 0 6px rgba(255,255,255,.6)}
.vm-m1{left:20%;top:-12px;animation:vmAuSnow 11s linear infinite}
.vm-m2{left:44%;top:-12px;width:3px;height:3px;animation:vmAuSnow 14s linear 1.6s infinite}
.vm-m3{left:64%;top:-12px;animation:vmAuSnow 12s linear 3.2s infinite}
.vm-m4{left:82%;top:-12px;width:3px;height:3px;animation:vmAuSnow 15s linear 4.4s infinite}
.vm-m5{left:32%;top:-12px;animation:vmAuSnow 13s linear 5.8s infinite}
@keyframes vmAuSnow{0%{transform:translate(0,-20px);opacity:0}12%{opacity:.9}88%{opacity:.7}100%{transform:translate(20px,520px);opacity:0}}
`,
      global: `
/* starfield twinkle (::before) + aurora curtain wave (::after) */
@keyframes vmAuTwinkle { 0%,100% { opacity:.55 } 50% { opacity:1 } }
@keyframes vmAuWave { 0%,100%{background-position:0 0;transform:translateY(0)} 50%{background-position:100% 0;transform:translateY(6px)} }
body::before, [data-chat-bg]::before { animation: vmAuTwinkle 4s ease-in-out infinite; }
body::after, [data-chat-bg]::after { animation: vmAuWave 9s ease-in-out infinite; }`,
    },
  },

  // ═══════════════════════════════ ROSACE ══════════════════════════════════
  {
    id: 'vellum-rosace',
    name: 'Vellum · Rosace — The Nave',
    description: 'Cobalt, ruby & amber panes behind black leading. A cathedral stained-glass MinimalMessage override with a leaded-came lattice, a slow-moving sun that blooms each pane, jewel-shimmer headers, and a tracery-cut portrait rail.',
    accent: hsl(214, 75, 50),
    radiusScale: 0.625,
    base: {
      background: '#14122a', text: '#eae6ff', primary: '#1f6fe0', secondary: '#e0243f',
      speech: '#e8a41f', thoughts: '#9a93c0', danger: '#e0243f', success: '#23c05a', warning: '#e8a41f',
    },
    fonts: "@import url('https://fonts.googleapis.com/css2?family=Marcellus&family=EB+Garamond:ital@0;1&display=swap');",
    vars: `--vm-serif:'Marcellus',Georgia,serif;--vm-body:'EB Garamond',Georgia,serif;--vm-deco:'Marcellus',Georgia,serif;--lumiverse-bg:#14122a;--lumiverse-text:#eae6ff;--lumiverse-text-2:#9a93c0;--lumiverse-accent:#1f6fe0;--lumiverse-accent-2:#e0243f;--vm-amethyst:#9a4ce0;--glass-border:rgba(120,120,140,.3)`,
    page: `background:
      repeating-linear-gradient(60deg, rgba(0,0,0,.5) 0 2px, transparent 2px 40px),
      repeating-linear-gradient(-60deg, rgba(0,0,0,.5) 0 2px, transparent 2px 40px),
      radial-gradient(90% 70% at 50% -10%, rgba(31,111,224,.3), transparent 55%),
      radial-gradient(70% 60% at 80% 110%, rgba(224,36,63,.24), transparent 60%),
      radial-gradient(60% 50% at 12% 90%, rgba(154,76,224,.24), transparent 62%),
      linear-gradient(165deg,#14122a 0%, #08060f 100%) !important;`,
    pageBefore: `background:radial-gradient(60% 90% at 20% 20%, rgba(255,255,255,.14), transparent 40%);`,
    pageAfter: `opacity:.5;background:radial-gradient(50% 40% at 70% 60%, rgba(224,36,63,.14), transparent 55%),radial-gradient(46% 40% at 30% 80%, rgba(154,76,224,.14), transparent 58%);`,
    skin: `
.vm{--vm-radius:10px}
.vm-portraitA{background:radial-gradient(90% 60% at 50% 8%, rgba(31,111,224,.5), transparent 58%),radial-gradient(70% 46% at 76% 92%, rgba(224,36,63,.44), transparent 70%),linear-gradient(160deg,#261432,#14122a 52%,#08060f 100%)}
.vm-portraitB{background:radial-gradient(90% 60% at 50% 8%, rgba(154,76,224,.46), transparent 58%),radial-gradient(70% 46% at 24% 92%, rgba(31,111,224,.44), transparent 70%),linear-gradient(160deg,#1a1440,#14122a 52%,#08060f 100%)}
.vm-grain{opacity:.6;mix-blend-mode:overlay;background:repeating-linear-gradient(60deg, rgba(0,0,0,.5) 0 2px, transparent 2px 22px),repeating-linear-gradient(-60deg, rgba(0,0,0,.5) 0 2px, transparent 2px 22px)}
.vm-avatar::after{content:"";position:absolute;inset:5px;border:2px solid #05040a;border-radius:10px;box-shadow:0 0 0 1px rgba(232,164,31,.4),inset 0 0 22px rgba(31,111,224,.2);pointer-events:none;z-index:3}
.vm-header::before{content:"\\271D";color:var(--lumiverse-accent-2);font-size:.95rem;opacity:.9;text-shadow:0 0 12px rgba(224,36,63,.6)}
.vm-name{font-family:var(--vm-serif);letter-spacing:.06em;text-transform:uppercase;font-size:clamp(1.7rem,2.2vw,2.4rem);line-height:1.04;color:#9fc0ff;text-shadow:0 0 10px rgba(31,111,224,.6)}
.vm-user .vm-name{color:#ff9fb0;text-shadow:0 0 10px rgba(224,36,63,.6)}
.vm-pill{font-family:var(--vm-deco);letter-spacing:.18em;text-transform:uppercase;font-size:.72rem;color:var(--lumiverse-text-2)}
.vm-content{border:2.5px solid #05040a;background:linear-gradient(168deg,rgba(20,18,38,.82),rgba(12,10,26,.86));box-shadow:inset 0 0 22px rgba(31,111,224,.18);animation:vmRosaceBloom 9s ease-in-out infinite}
@keyframes vmRosaceBloom{0%,100%{filter:saturate(.85) brightness(.9)}50%{filter:saturate(1.35) brightness(1.15)}}
.vm-content::before{content:"";position:absolute;top:12px;bottom:12px;left:0;width:3px;background:linear-gradient(180deg,#1f6fe0,#9a4ce0,#e0243f);box-shadow:0 0 12px rgba(31,111,224,.6);z-index:1}
.vm-user .vm-content::before{left:auto;right:0}
.vm-prose{font-family:var(--vm-body)}
.vm-prose .say{color:#ffd98a;text-shadow:0 0 8px rgba(232,164,31,.5)}
`,
    anim: {
      component: `
.vm-mote{display:block;width:5px;height:5px;border-radius:50%;background:radial-gradient(circle,rgba(232,164,31,.9),rgba(224,36,63,.4) 50%,transparent 72%);box-shadow:0 0 8px rgba(232,164,31,.6)}
.vm-m1{left:20%;top:30%;animation:vmRosaceGlint 7s ease-in-out infinite}
.vm-m2{left:52%;top:22%;width:4px;height:4px;background:radial-gradient(circle,rgba(31,111,224,.9),transparent 70%);animation:vmRosaceGlint 8.4s ease-in-out 1.2s infinite}
.vm-m3{left:70%;top:44%;width:6px;height:6px;background:radial-gradient(circle,rgba(154,76,224,.9),transparent 70%);animation:vmRosaceGlint 6.6s ease-in-out 2.4s infinite}
.vm-m4{left:34%;top:60%;animation:vmRosaceGlint 9s ease-in-out 3.3s infinite}
.vm-m5{left:78%;top:66%;width:4px;height:4px;background:radial-gradient(circle,rgba(224,36,63,.9),transparent 70%);animation:vmRosaceGlint 7.6s ease-in-out 4.5s infinite}
@keyframes vmRosaceGlint{0%,100%{opacity:.2;transform:scale(.7)}50%{opacity:.95;transform:scale(1)}}
`,
      global: `
/* the sun crossing the window (::before) + jewel-pane bloom wash (::after) */
@keyframes vmRosaceSun { 0%,100%{transform:translate(-30%,-10%);opacity:.5} 50%{transform:translate(60%,20%);opacity:.95} }
@keyframes vmRosaceWash { 0%,100%{opacity:.4} 50%{opacity:.62} }
body::before, [data-chat-bg]::before { animation: vmRosaceSun 14s ease-in-out infinite; }
body::after, [data-chat-bg]::after { animation: vmRosaceWash 9s ease-in-out infinite; }`,
    },
  },
]

// ── Assemble globalCSS for a theme ───────────────────────────────────────────
// The page field is painted on a stable, always-present anchor. In the live
// app `[data-chat-bg]` is only set on <html> when a wallpaper/scene bg exists,
// so a fresh theme would show nothing — we target `body` (always present) and
// force `#root`/the app shell transparent so the body field shows through. The
// fixed ::before/::after texture layers sit at z-index:-1 so they stay behind
// all app content but above the base field, matching the mockups' layering.
//
// When `animated` is true, the theme's anim.global block is appended so the
// existing page pseudo-layers gain their keyframe animation (approach A).
// Build the translated chat skin (SKELETON + per-theme skin, all on the default
// renderer DOM) plus, for animated packs, the pseudo-collapsed portrait motes.
function buildChatSkin(t, animated) {
  const { portraitVars, rest } = extractPortraitVars(t.skin)
  const themeSkin = translateSelectors(rest)
  const motes = animated ? translateMotes(t.anim?.component, t.id) : ''
  return `
/* ── Vellum chat skin (Approach A: restyles the stock MinimalMessage) ── */
${CARD}{${portraitVars}}
${SKELETON}
/* per-theme skin */
${themeSkin}
${motes}
`
}

// Returns { css, assets }. `assets` are the bundled font files (empty if the
// font fetch failed / no web fonts); the emitter drops them into the zip and
// lists them in the manifest so their relative url(assets/fonts/…) references
// resolve at runtime.
//
// NOTE: font-size is NOT pinned here. We intentionally do not set
// --lumiverse-font-scale, so the app's own font-size control stays live and
// recipients can scale all text (see the font-size rule in SKELETON, which
// multiplies by var(--lumiverse-font-scale,1)).
async function buildGlobalCSS(t, animated) {
  const { faces, assets } = await bundleFonts(t.fonts)
  // Animated packs also ship a prefers-reduced-motion guard: users who ask their
  // OS to minimise motion get the full static look with every Vellum animation
  // (page layers, portrait motes, ember twinkle) switched off. Scoped to the
  // layers we drive so it can't disable unrelated app animations.
  const reducedMotion = `
/* respect the OS "reduce motion" setting — freeze all Vellum motion */
@media (prefers-reduced-motion: reduce) {
  body::before, body::after,
  [data-chat-bg]::before, [data-chat-bg]::after,
  ${CARD}::after,
  ${AVIMG}::before { animation: none !important; }
}`
  const animGlobal = animated && t.anim
    ? `\n/* animated variant — page motion (A) */\n${t.anim.global}\n${reducedMotion}`
    : ''
  const chatSkin = buildChatSkin(t, animated)
  const css = `/* ${t.name} — Vellum globalCSS (Layer 2) */
${faces ? `/* bundled web fonts (shipped as pack assets, not inlined) */\n${faces}\n` : ''}
:root{${t.vars}}
body{--lumiverse-font-family:var(--vm-body,inherit)}
${t.extraGlobal || ''}
/* themed app chrome — drawer rail + composer (all packs) */
${appChrome(t)}
/* page field painted on the always-present body anchor */
html,body{${t.page}}
/* let the themed body field show through the app shell */
#root,#root>*{background:transparent !important}
body::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:-1;${t.pageBefore}}
body::after{content:"";position:fixed;inset:0;pointer-events:none;z-index:-1;${t.pageAfter}}
/* keep it working too when a wallpaper sets [data-chat-bg] on <html> */
[data-chat-bg]{${t.page}}
[data-chat-bg]::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:-1;${t.pageBefore}}
[data-chat-bg]::after{content:"";position:fixed;inset:0;pointer-events:none;z-index:-1;${t.pageAfter}}${animGlobal}
${chatSkin}`
  return { css, assets }
}

function bundleThemeAssets(t) {
  return (t.assets || []).map((a) => ({
    archivePath: a.archivePath,
    slug: a.archivePath,
    originalFilename: a.originalFilename || a.archivePath.split('/').pop(),
    mimeType: a.mimeType || 'application/octet-stream',
    tags: a.tags || ['image'],
    metadata: a.metadata || {},
    bytes: readFileSync(join(HERE, a.source)),
  }))
}

// ── Assemble the format:3 archive manifest ───────────────────────────────────
// `animated` selects the variant: false → static pack (motes stay hidden, page
// is calm); true → animated pack (id/name suffixed, anim.component drives the
// portrait particles (B), anim.global drives the page motion (A)).
async function buildManifest(t, animated) {
  const id = animated ? `${t.id}-animated` : t.id
  const name = animated ? `${t.name} (Animated)` : t.name
  const description = animated
    ? `${t.description} This is the animated variant: drifting portrait particles and a gently moving background.`
    : t.description

  const mode = t.mode || 'dark'
  const theme = {
    id,
    name,
    mode,
    accent: t.accent,
    statusColors: {
      danger: t.base.danger,
      success: t.base.success,
      warning: t.base.warning,
    },
    baseColorsByMode: {
      [mode]: {
        primary: t.base.primary,
        secondary: t.base.secondary,
        background: t.base.background,
        text: t.base.text,
        danger: t.base.danger,
        success: t.base.success,
        warning: t.base.warning,
        speech: t.base.speech,
        thoughts: t.base.thoughts,
      },
    },
    radiusScale: t.radiusScale,
    enableGlass: true,
    // fontScale is intentionally omitted so the app's own font-size control
    // stays authoritative — recipients can freely scale all text.
    characterAware: true,
  }

  const { css, assets: fontAssets } = await buildGlobalCSS(t, animated)
  const themeAssets = bundleThemeAssets(t)

  // format:3 archive asset descriptors. The actual bytes are dropped into the
  // zip by the emitter at each asset's archivePath; here we list the metadata so
  // the app can upload them on import and the relative url(assets/fonts/…)
  // references resolve to the per-bundle asset API.
  const assets = fontAssets.map((a) => ({
    slug: a.slug,
    originalFilename: a.originalFilename,
    mimeType: a.mimeType,
    tags: ['font'],
    metadata: {},
    archivePath: a.archivePath,
  })).concat(themeAssets.map((a) => ({
    slug: a.slug,
    originalFilename: a.originalFilename,
    mimeType: a.mimeType,
    tags: a.tags,
    metadata: a.metadata,
    archivePath: a.archivePath,
  })))

  // Approach A: no Layer-3 component override. The entire Vellum skin now lives
  // in globalCSS (Layer 2), which restyles the stock default renderer — so every
  // recipient keeps working swipes, the real edit window, all action buttons,
  // TTS, and the context menu on an unmodified Lumiverse. `components` is empty.
  const manifest = {
    format: 3,
    name,
    author: AUTHOR,
    description,
    createdAt: NOW,
    bundleId: randomUUID(),
    theme,
    globalCSS: css,
    components: {},
    assets,
  }
  // Return the raw font bytes alongside so the emitter can write them into the
  // zip at their archivePath (they are not part of the JSON manifest).
  return { manifest, fontAssets, themeAssets }
}

// ── Emit each .lumitheme (zip containing only theme.json) ────────────────────
// Two variants per theme so users can pick calm or animated:
//   ${id}.lumitheme  and  ${id}-animated.lumitheme
let built = 0
for (const t of THEMES) {
  for (const animated of [false, true]) {
    const { manifest, fontAssets, themeAssets } = await buildManifest(t, animated)
    const json = JSON.stringify(manifest, null, 2)

    // Approach A ships no component override; globalCSS carries the whole skin.
    // The app sanitizer caps globalCSS at 2 MB — guard well under that.
    if (manifest.globalCSS.length > 2_000_000) {
      throw new Error(`${manifest.theme.id}: globalCSS exceeds 2 MB (${manifest.globalCSS.length})`)
    }

    // The zip carries theme.json plus each bundled font file at its archivePath
    // (assets/fonts/<file>.woff2). The manifest's assets[] entries reference the
    // same archivePath, so the app extracts + uploads them on import.
    const files = { 'theme.json': strToU8(json) }
    for (const fa of fontAssets) files[fa.archivePath] = fa.bytes
    for (const ta of themeAssets) files[ta.archivePath] = ta.bytes

    const zipped = zipSync(files, { level: 6 })
    const file = join(OUT, `${manifest.theme.id}.lumitheme`)
    writeFileSync(file, zipped)
    built++
    const fontBytes = fontAssets.reduce((n, fa) => n + fa.bytes.length, 0)
    console.log(
      `✓ ${manifest.theme.id}.lumitheme  ` +
        `(theme.json ${json.length}B, globalCSS ${manifest.globalCSS.length}B, ` +
        `${fontAssets.length} fonts ${fontBytes}B, zip ${zipped.length}B)`,
    )
  }
}
console.log(`\nBuilt ${built} .lumitheme packs → ${OUT}`)
