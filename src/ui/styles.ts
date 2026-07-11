/**
 * Themed CSS for the VELLUM shell + components. Illuminated-manuscript palette
 * via CSS variables so skins/host theme can override. Single string loaded via
 * spindle.dom.addStyle.
 */

// ---------------------------------------------------------------------------
// CARD SHAPE geometry (mockup 24 / 30-35). ONE source of truth: each shape's
// declaration body (geometry only -- never color/type) is stored here, then
// emitted twice: once as a `.v-shape--<id>` primitive (used directly by
// renderers e.g. beat folios, journal leaves) and once per surface as a
// `html[data-shape-<surface>='<id>'] <root>` override so the theme customizer
// can reshape a whole surface with no per-card class churn. Keeping both from
// one map means the primitive and the override can never drift apart.
// ---------------------------------------------------------------------------
const R = 'var(--v-shape-radius)';
// SHAPE_GEOM v4 (grounded, mockups 36-38). Every VELLUM card is a WIDE HORIZONTAL
// ROW (width ~351px, height content-driven, measured ratios 1.2..6.7). So the
// silhouette is expressed as EDGE / CORNER / FRAME / MASKED-EDGE geometry that
// NEVER clips the content box, NOT as a full-bleed polygon. Round 2 of the review
// cut ribbon/rule/arch/petal/chamfer and added five treatments that keep their
// detail in the card PADDING or as an inset pseudo: stitch (inset dashed border),
// gilt-edge (thin keyline all sides), binding (ledger holes down the left), studs
// (four corner registration dots), bracket (end [ ] brackets). Shapes that need
// room reserve it with side padding so text/avatars always clear the decoration.
const SHAPE_GEOM: Record<string, string> = {
  // FILL family — radius/border/fill only
  slab: `border-radius:${R}`,
  'left-spine': `border-radius:0 ${R} ${R} 0;border-left-width:3px`,
  split: `border-radius:${R} 0 ${R} 0`,
  inset: `border-radius:calc(${R} * .7);box-shadow:inset 0 0 0 1px rgba(var(--vg-rgb),.12)`,
  // CORNER family — small fixed corner clip (lives in padding) or asymmetric radius
  notched: 'clip-path:polygon(9px 0,calc(100% - 9px) 0,100% 9px,100% calc(100% - 9px),calc(100% - 9px) 100%,9px 100%,0 calc(100% - 9px),0 9px)',
  aperture: `border-radius:calc(${R} * .5);padding:12px 14px`, // detail = corner brackets (styles.ts)
  studs: `border-radius:${R};padding:11px 13px`, // detail = four corner dots (styles.ts)
  // FRAME family — inset hairline frame/keyline overlay (pseudo) + generous inner
  // padding so content clears the frame (fix: tarot text was hugging the border).
  tarot: `border-radius:calc(${R} * 1.5) calc(${R} * 1.5) calc(${R} * .5) calc(${R} * .5);padding:13px 14px`,
  stitch: `border-radius:${R};padding:11px 13px`, // detail = inset dashed border (styles.ts)
  'gilt-edge': `border-radius:${R};padding:11px 13px`, // detail = thin keyline all sides (styles.ts)
  // END-BRACKET — square [ ] brackets on the two vertical ends (pseudo); side pad.
  bracket: `border-radius:calc(${R} * .3);padding:10px 16px`,
  // LEFT-BINDING — ledger binding holes down the left edge (pseudo); left padding.
  binding: `border-radius:0 ${R} ${R} 0;border-left-width:3px;padding-left:20px`,
  // MASKED-EDGE — a torn deckle down the LEFT edge (mask); left padding clears it.
  deckle: `border-radius:0 ${R} ${R} 0;padding-left:16px;-webkit-mask:radial-gradient(circle 4px at 0 4px,transparent 98%,#000) 0 0/8px 8px repeat-y,linear-gradient(#000,#000) 4px 0/calc(100% - 4px) 100% no-repeat;mask:radial-gradient(circle 4px at 0 4px,transparent 98%,#000) 0 0/8px 8px repeat-y,linear-gradient(#000,#000) 4px 0/calc(100% - 4px) 100% no-repeat`,
  // BOTTOM — scallop the bottom edge only; content bottom-pads clear of the bumps
  scalloped: `border-radius:calc(${R} * .8);-webkit-mask:radial-gradient(circle 5px at 5px 100%,transparent 98%,#000) 0 100%/12px 12px repeat-x,linear-gradient(#000,#000) 0 0/100% calc(100% - 6px) no-repeat;mask:radial-gradient(circle 5px at 5px 100%,transparent 98%,#000) 0 100%/12px 12px repeat-x,linear-gradient(#000,#000) 0 0/100% calc(100% - 6px) no-repeat`,
  // FAEWILD family (mockup 39) — nature silhouettes; detail lives in reserved padding.
  // toadstool: a domed mushroom-cap top (big top radius) + extra top padding so the
  // spotted cap band (pseudo) never touches content.
  toadstool: `border-radius:calc(${R} * 2) calc(${R} * 2) calc(${R} * .5) calc(${R} * .5);padding:16px 13px 11px`,
  // trellis: a climbing-vine left rail lives in the left padding (pseudo draws it).
  trellis: `border-radius:0 ${R} ${R} 0;border-left-width:3px;padding-left:20px`,
  // bramble: a leafy-wreath sprig tucks into two corners (pseudo, in the padding).
  bramble: `border-radius:${R};padding:11px 14px`,
  // lantern: a hanging bulb tag — a warm inset glow + a top hook pseudo above it.
  lantern: `border-radius:calc(${R} * .8);padding:11px 13px`,
  // GATSBY / ART DECO family — content-safe geometric treatments (detail in pad).
  // sunburst: a top keystone + starburst glyph rides in reserved top padding.
  sunburst: `border-radius:calc(${R} * .3);padding:18px 13px 11px`,
  // marquee: dotted theater-light borders (pseudo strips) top & bottom; V padding.
  marquee: `border-radius:calc(${R} * .3);padding:14px 13px`,
  // scallop-deco: art-deco fan-scalloped BOTTOM edge (mask); bottom padding clears
  // the bumps. Larger radius bumps than `scalloped` for a bolder deco fan.
  'scallop-deco': `border-radius:calc(${R} * .3);padding-bottom:14px;-webkit-mask:radial-gradient(circle 7px at 8px 100%,transparent 98%,#000) 0 100%/16px 14px repeat-x,linear-gradient(#000,#000) 0 0/100% calc(100% - 7px) no-repeat;mask:radial-gradient(circle 7px at 8px 100%,transparent 98%,#000) 0 100%/16px 14px repeat-x,linear-gradient(#000,#000) 0 0/100% calc(100% - 7px) no-repeat`,
  // stepped: a nested ziggurat corner frame (pseudo) sits in the reserved padding.
  stepped: `border-radius:0;padding:13px 15px`,
  // SUMI / INK WASH family — minimal, quiet treatments (detail in reserved pad).
  // hanko: a vermillion seal stamp rides the top-right corner (pseudo); top pad.
  hanko: `border-radius:4px;padding:14px 13px 11px`,
  // washi-fold: a folded-paper corner crease at the top-right (pseudo); top pad so
  // the fold triangle never crosses content.
  'washi-fold': `border-radius:calc(${R} * .2);padding:14px 15px 11px`,
};
// shapes whose clip-path needs a rounded-slab fallback on old UAs. notched shaves
// small fixed corners that live in padding.
const CLIP_SHAPES = ['notched'];
// surface -> the single stable root selector for that surface's card. cast
// excludes .vle-fac so a Cast shape doesn't also reshape faction cards.
const SHAPE_SURFACE_ROOT: Record<string, string> = {
  present: '.vld-pc', bonds: '.vle-rel-card', cast: '.vle-card:not(.vle-fac)',
  beats: '.vle-mem--beat', factions: '.vle-fac', items: '.vle-item-row', secrets: '.vle-mem--secret',
};
// shapes whose edge is a CSS mask; on old UAs they drop the mask and round off.
const MASK_SHAPES = ['scalloped', 'deckle', 'scallop-deco'];
const shapePrimitives = (): string[] => [
  `:root{--v-shape-radius:var(--vradius)}`,
  ...Object.entries(SHAPE_GEOM).map(([id, body]) => `.v-shape--${id}{${body}}`),
  `@supports not (clip-path: polygon(0 0,100% 0,100% 100%)){${CLIP_SHAPES.map((id) => `.v-shape--${id}`).join(',')}{clip-path:none;border-radius:${R}}}`,
  `@supports not ((-webkit-mask:radial-gradient(#000,#000)) or (mask:radial-gradient(#000,#000))){${MASK_SHAPES.map((id) => `.v-shape--${id}`).join(',')}{-webkit-mask:none;mask:none;border-radius:${R}}}`,
];
// Emit a pseudo-element shape DETAIL for a given shape id across EVERY surface
// root, so whichever surface resolves to that shape gets the decoration. The
// detail lives in the padding reserved by SHAPE_GEOM, so it never overlaps text.
// secrets is excluded (it owns its ::before/::after for the G3 medallion/seal).
const shapeDetail = (id: string, decl: string, pseudo: '::before' | '::after'): string[] => {
  const sel = Object.entries(SHAPE_SURFACE_ROOT)
    .filter(([surface]) => surface !== 'secrets')
    .map(([surface, root]) => `[data-shape-${surface}='${id}'] ${root}${pseudo}`)
    .join(',');
  return [`${sel}{${decl}}`];
};
const shapeOverrides = (): string[] => {
  const rules: string[] = [];
  // Specificity booster: chrome card rules reach (0,3,1) via `html[chrome] .vlf
  // .vld-pc`. Repeating the shape attribute on <html> lifts the override to
  // (0,4,1) so it wins in BOTH the drawer and the float without !important.
  const at = (surface: string, id: string): string => `[data-shape-${surface}='${id}'][data-shape-${surface}][data-shape-${surface}]`;
  for (const [surface, root] of Object.entries(SHAPE_SURFACE_ROOT)) {
    for (const [id, body] of Object.entries(SHAPE_GEOM)) {
      rules.push(`html${at(surface, id)} ${root}{${body}}`);
    }
    // per-surface fallbacks so an override degrades the same way the primitive does
    rules.push(`@supports not (clip-path: polygon(0 0,100% 0,100% 100%)){${CLIP_SHAPES.map((id) => `html${at(surface, id)} ${root}`).join(',')}{clip-path:none;border-radius:${R}}}`);
    rules.push(`@supports not ((-webkit-mask:radial-gradient(#000,#000)) or (mask:radial-gradient(#000,#000))){${MASK_SHAPES.map((id) => `html${at(surface, id)} ${root}`).join(',')}{-webkit-mask:none;mask:none;border-radius:${R}}}`);
  }
  return rules;
};

export const STYLES = [
  // --- theme tokens (overridden at runtime by theme.ts) ---------------------
  // --vg accent (hex) + --vg-rgb its r,g,b ; --vi primary ink, --vi2 muted ink ;
  // --vserif/--vmono fonts ; --vscale chrome size multiplier ; --vsurf-* panel bg.
  // SEMANTIC INK ROLES (alias --vi2 today; split later without touching call sites):
  //   --vle-ink        = primary reading ink (body copy).
  //   --vle-ink-muted  = de-emphasised interactive ink (control labels, nav, chips).
  //   --vle-meta       = static metadata ink (turn counts, timestamps, keys).
  //   --vle-bg-solid   = opaque panel backing for surfaces that can't blur.
  //
  // SEMANTIC COLOR CONTRACT (one meaning each — do not overload):

  //   --vg     gold   = brand / accent / interactive (tabs, links, focus). NOT a status.
  //   --v-pos  sage   = positive / affection / kept memory (journal).
  //   --v-info blue   = knowledge / trust / information.
  //   --v-press amber = pressure / tension / a bond shifting. (Freed from red.)
  //   --v-neg  red    = harm / danger / destructive / "wrong" belief (irony).
  //   --v-warn violet = the INTERNAL/AMBIGUOUS register ONLY: inner thoughts,
  //                     scars, complex sentiment, romance. If a new use isn't
  //                     "internal/ambiguous", pick another token — don't add to violet.
  ":root{--vg:#cda84e;--vg-rgb:205,168,78;--vi:#e7d6ad;--vi2:#cdbfa0;--vserif:'Cormorant Garamond',Georgia,serif;--vmono:'JetBrains Mono',ui-monospace,monospace;--vscale:1;--vsurf-1:rgba(28,25,20,.5);--vsurf-2:rgba(18,16,12,.4);--vle-gold:var(--vg);--vle-gold-soft:rgba(var(--vg-rgb),.16);--vle-ink:var(--vi);--vle-ink-muted:var(--vi2);--vle-meta:var(--vi2);--vle-bg:rgba(20,18,14,.55);--vle-bg-solid:#14120e;--vg2:#9bc0e6;--vg2-rgb:155,192,230;--vai:1;--vdscale:1;--vdensity:1;--vopacity:1;--vblur:8px;--vradius:18px;--vborder:1px;--vink-e:1;--v1:4px;--v2:8px;--v3:12px;--v4:16px;--v5:20px;--v6:24px;--vr1:6px;--vr2:9px;--vr3:13px;--rpill:20px;--v-pos:#8fa67e;--v-pos-i:#a9c089;--v-neg:#c96a6a;--v-neg-i:#e09090;--v-info:#9bc0e6;--v-warn:#b48ed0;--v-press:#c8923e;--v-press-i:#dcad62;--vt-display:calc(24px * var(--vscale));--vt-title:calc(18px * var(--vscale));--vt-body:calc(14px * var(--vscale));--vt-meta:calc(11px * var(--vdscale));--vt-eyebrow:calc(10px * var(--vscale))}",
  // launcher edge + reduced-motion (set on document by theme.ts)
  "html[data-vle-launch='left'] .vlf-launch{right:auto;left:0;top:var(--vlf-lpos,46%);border-radius:0 13px 13px 0;border-right:1px solid rgba(var(--vg-rgb),.5);border-left:none;writing-mode:vertical-rl;transform:rotate(180deg)}",
  "html[data-vle-launch='left'] .vlf-launch .vlf-launch-mark,html[data-vle-launch='left'] .vlf-launch .vlf-launch-t{transform:rotate(180deg)}",
  "html[data-vle-launch='left'] .vlf-launch:hover{transform:rotate(180deg) translateX(-3px)}",
  // top / bottom edges — horizontal tab, rounded on the inner corners
  "html[data-vle-launch='top'] .vlf-launch{right:auto;bottom:auto;left:var(--vlf-lpos,46%);top:0;border-radius:0 0 13px 13px;border-top:none;border-right:1px solid rgba(var(--vg-rgb),.5);writing-mode:horizontal-tb;box-shadow:4px 6px 22px rgba(0,0,0,.5)}",
  "html[data-vle-launch='top'] .vlf-launch:hover{transform:translateY(3px);box-shadow:4px 8px 24px rgba(0,0,0,.55)}",
  "html[data-vle-launch='bottom'] .vlf-launch{right:auto;top:auto;left:var(--vlf-lpos,46%);bottom:0;border-radius:13px 13px 0 0;border-bottom:none;border-right:1px solid rgba(var(--vg-rgb),.5);writing-mode:horizontal-tb;box-shadow:4px -6px 22px rgba(0,0,0,.5)}",
  "html[data-vle-launch='bottom'] .vlf-launch:hover{transform:translateY(-3px);box-shadow:4px -8px 24px rgba(0,0,0,.55)}",
  // while actively dragging: kill the transition + hover nudge so it tracks the pointer 1:1
  ".vlf-launch.is-dragging{transition:none!important;transform:none!important;cursor:grabbing}",
  "html[data-vle-launch='hidden'] .vlf-launch{display:none!important}",
  "html[data-vle-motion='off'] *{transition:none!important;animation:none!important}",
  // unified chip family: ONE shape (radius --vr1, mono label, --vt-meta) with
  // tone modifiers driving color only. New surfaces use this; legacy bespoke
  // chips migrate onto it incrementally. .v-chip--solid fills; default is outline.
  ".v-chip{display:inline-flex;align-items:center;gap:4px;font:600 var(--vt-meta)/1 var(--vmono);letter-spacing:.4px;text-transform:uppercase;padding:2px 7px;border-radius:var(--vr1);border:1px solid color-mix(in srgb,var(--v-chip-c,var(--vg)) 42%,transparent);color:var(--v-chip-c,var(--vi2));white-space:nowrap}",
  ".v-chip--solid{background:color-mix(in srgb,var(--v-chip-c,var(--vg)) 16%,transparent)}",
  ".v-chip--gold{--v-chip-c:var(--vg)}.v-chip--pos{--v-chip-c:var(--v-pos-i)}.v-chip--neg{--v-chip-c:var(--v-neg-i)}.v-chip--info{--v-chip-c:var(--v-info)}.v-chip--warn{--v-chip-c:var(--v-warn)}.v-chip--press{--v-chip-c:var(--v-press-i)}.v-chip--muted{--v-chip-c:#8c8478}",
  // mono/data text honors its own scale; ink emphasis tints body text
  ".vld-stat,.vld-h,.vld-mood,.vld-cond,.vld-thread-s,.vld-par-w,.vld-rec-k{font-size:calc(1em * var(--vdscale))}",
  ".vle-root,.vlf-body{opacity:1}",
  ".vle-root{font-family:var(--vserif);color:var(--vle-ink);padding:calc(13px * var(--vscale)) calc(15px * var(--vscale))}",
  // H3 nav panel (mockup 20): header + tab rail grouped into one framed block.
  // Rounded, hairline border, a subtle STATIC radial wash (no motion). Default is
  // quiet; per-chrome variants below add each world's flavor.
  ".vle-navpanel{position:relative;border:1px solid var(--vle-gold-soft);border-radius:calc(var(--vradius) + 2px);padding:calc(11px * var(--vscale)) calc(13px * var(--vscale)) calc(8px * var(--vscale));margin-bottom:calc(11px * var(--vscale));background:radial-gradient(120% 140% at 0% 0%,rgba(var(--vg-rgb),.06),transparent 60%)}",
  ".vle-navpanel .vle-head{border-bottom:1px solid var(--vle-gold-soft)}",
  "@media (max-width:440px){.vle-navpanel{padding:calc(8px * var(--vscale)) calc(9px * var(--vscale)) calc(6px * var(--vscale))}}",
  ".vle-head{display:flex;align-items:center;gap:9px;font-size:calc(22px * var(--vscale));letter-spacing:1.5px;padding-bottom:calc(11px * var(--vscale));border-bottom:1px solid var(--vle-gold-soft)}",
  ".vle-mark{color:var(--vle-gold);text-shadow:0 0 8px rgba(var(--vg-rgb),.4)}",
  ".vle-ver{font:600 calc(10px * var(--vscale))/1 var(--vmono);letter-spacing:1px;text-transform:uppercase;opacity:.6;color:var(--vle-gold)}",
  // header stat pills: discrete labeled chips (icon + value) replacing the old
  // `·`-joined run-on string. Each pill wears its meta ink; the icon is quieter.
  ".vle-stats{margin-left:auto;display:flex;align-items:center;flex-wrap:wrap;gap:calc(5px * var(--vscale))}",
  ".vle-stat{display:inline-flex;align-items:center;gap:4px;font:600 calc(10px * var(--vscale))/1 var(--vmono);letter-spacing:.5px;color:var(--vle-meta);opacity:.85}",
  ".vle-stat .vi{opacity:.6}",
  ".vle-stat b{color:var(--vle-ink);font-weight:600;opacity:.9}",

  // tab bar
  ".vle-tabbar{display:flex;align-items:center;gap:5px;margin:calc(11px * var(--vscale)) 0 calc(5px * var(--vscale));flex-wrap:wrap}",
  ".vle-tabicons{display:flex;align-items:center;gap:5px;margin:0 0 calc(9px * var(--vscale));flex-wrap:wrap;padding-top:calc(6px * var(--vscale));border-top:1px solid rgba(var(--vg-rgb),.14)}",
  ".vle-tabbtn{font:600 calc(11px * var(--vscale))/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--vi2);background:transparent;border:1px solid transparent;border-radius:9px;padding:calc(8px * var(--vscale)) calc(13px * var(--vscale));cursor:pointer;opacity:.7;transition:opacity .15s,background .15s,color .15s}",
  ".vle-tabbtn:hover{opacity:1;background:rgba(var(--vg-rgb),.08)}",
  ".vle-tabbtn{position:relative}",
  ".vle-tabbtn.on{opacity:1;background:rgba(var(--vg-rgb),.2);border-color:rgba(var(--vg-rgb),.45);color:var(--vle-gold)}",
  // H2 active-tab glow underline (base). A short centered accent bar with a soft
  // glow; additive to the lozenge fill. Chrome ::after underlines (modern/
  // futuristic/illuminated) have higher specificity and keep winning where set.
  ".vle-tabbtn.on::after{content:'';position:absolute;left:24%;right:24%;bottom:-2px;height:2px;border-radius:2px;background:var(--vg);box-shadow:0 0 6px rgba(var(--vg-rgb),.6)}",
  "@media (prefers-reduced-motion:reduce){.vle-tabbtn.on::after{box-shadow:none}}",
  ".vle-tabbar-sep{flex:none;width:1px;align-self:stretch;margin:2px 4px;background:rgba(var(--vg-rgb),.22)}",
  // labeled tool dock (Journal/Graph/Vault/Context) — icon + label chip, a real
  // second tier. Labels hide when the dock is tight (see the container query below).
  ".vle-tabicon{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;height:calc(30px * var(--vscale));padding:0 calc(11px * var(--vscale));font:600 calc(10.5px * var(--vscale))/1 var(--vmono);letter-spacing:.4px;color:var(--vi2);background:transparent;border:1px solid transparent;border-radius:9px;cursor:pointer;opacity:.62;transition:opacity .15s,background .15s,color .15s}",
  ".vle-tabicon:hover{opacity:1;background:rgba(var(--vg-rgb),.08)}",
  ".vle-tabicon.on{opacity:1;background:rgba(var(--vg-rgb),.2);border-color:rgba(var(--vg-rgb),.45);color:var(--vle-gold)}",
  ".vle-tabicon .vi{opacity:.85}",
  ".vle-tabicon-l{white-space:nowrap}",
  // when the shell is narrow, the dock collapses to icon-only (labels hidden)
  "@media (max-width:440px){.vle-tabicon{padding:0;width:calc(30px * var(--vscale));justify-content:center}.vle-tabicon-l{display:none}.vle-tabbtn{padding:calc(8px * var(--vscale)) calc(10px * var(--vscale))}.vle-tabbtn-l{display:none}}",
  // inline-SVG icon family (icons.ts): inherits color, sized per call
  ".vi{display:inline-block;vertical-align:-0.18em;flex:none}",
  ".vle-tabbtn{display:inline-flex;align-items:center;gap:6px}",
  ".vle-tabbtn .vi{opacity:.85}",
  ".vle-qol{display:inline-flex;align-items:center;gap:6px}",
  // float mini-app tab strip (4 primary tabs mounted into the float body)
  ".vlf-tabs{display:flex;gap:3px;padding:calc(8px * var(--vscale)) calc(10px * var(--vscale)) 0;flex:none}",
  ".vlf-tab{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:5px;font:600 calc(10.5px * var(--vscale))/1 var(--vmono);letter-spacing:.4px;text-transform:uppercase;color:var(--vi2);background:transparent;border:1px solid transparent;border-radius:9px 9px 0 0;padding:7px 6px;cursor:pointer;opacity:.65;transition:opacity .15s,background .15s,color .15s}",
  ".vlf-tab:hover{opacity:1;background:rgba(var(--vg-rgb),.08)}",
  ".vlf-tab.on{opacity:1;color:var(--vle-gold);background:rgba(var(--vg-rgb),.14);border-color:rgba(var(--vg-rgb),.3);border-bottom-color:transparent}",
  ".vlf-tab .vi{opacity:.85}",
  // hide labels when the float is very narrow (icons only)
  "@container (max-width:320px){.vlf-tab-l{display:none}}",
  ".vlf-tabbody{flex:1;min-height:0;overflow-y:auto;padding:calc(12px * var(--vscale)) calc(14px * var(--vscale)) calc(16px * var(--vscale))}",
  ".vlf-tabbody .vlm-comp{display:block}",
  // chronicle sub-nav (segmented in-tab views)
  ".vle-subnav{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 calc(11px * var(--vscale))}",
  // soft group label between sub-nav clusters (forces a wrap to its own line)
  ".vle-subnav-g{flex-basis:100%;font:600 var(--vt-eyebrow)/1 var(--vmono);letter-spacing:1.2px;text-transform:uppercase;color:var(--vg);opacity:.55;margin:6px 0 2px}",
  ".vle-subnav-g:first-child{margin-top:0}",
  ".vle-subnav-b{font:600 calc(10px * var(--vscale))/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--vi2);background:transparent;border:1px solid transparent;border-radius:8px;padding:6px 10px;cursor:pointer;opacity:.7;transition:opacity .15s,background .15s,color .15s}",
  ".vle-subnav-b:hover{opacity:1;background:rgba(var(--vg-rgb),.08)}",
  ".vle-subnav-b.on{opacity:1;background:rgba(var(--vg-rgb),.18);border-color:rgba(var(--vg-rgb),.4);color:var(--vle-gold)}",
  // timeline (Plot Director, Phase 3) — turn-axis rail
  ".vle-spine{position:relative;margin:10px 0;padding:4px 0}",
  // the spine is a dotted VINE (mockup 21) rather than a solid rule
  ".vle-spine::before{content:'';position:absolute;left:50%;top:0;bottom:0;width:2px;margin-left:-1px;background:repeating-linear-gradient(to bottom,rgba(var(--vg-rgb),.5) 0 4px,transparent 4px 9px)}",
  // kind-colored node pinned to the center rail for each branching row
  ".vle-spine-node{position:absolute;top:15px;width:9px;height:9px;border-radius:50%;background:var(--vg);box-shadow:0 0 0 3px var(--vsurf-2),0 0 7px rgba(var(--vg-rgb),.4);z-index:2}",
  ".vle-spine-l .vle-spine-node{right:-4px}.vle-spine-r .vle-spine-node{left:-4px}",
  ".vle-spine-node--secret{background:var(--v-neg)}.vle-spine-node--knew{background:var(--v-info)}.vle-spine-node--journal{background:var(--v-pos)}.vle-spine-node--memory{background:var(--vg)}.vle-spine-node--scar{background:var(--v-warn)}.vle-spine-node--lore{background:var(--vg)}",
  ".vle-spine-act{position:relative;z-index:1;text-align:center;margin:14px auto 10px;max-width:70%;font:600 var(--vt-eyebrow)/1.4 var(--vmono);letter-spacing:3px;text-transform:uppercase;color:var(--vg);background:rgba(var(--vg-rgb),.08);border-radius:var(--vr1);padding:5px 10px}",
  ".vle-spine-day{position:relative;z-index:1;display:flex;justify-content:center;margin:8px 0}",
  ".vle-spine-day span{font:600 calc(9px * var(--vscale))/1 var(--vmono);color:var(--vg);background:var(--vsurf-2);border:1px solid rgba(var(--vg-rgb),.5);border-radius:50%;width:30px;height:30px;display:grid;place-items:center}",
  ".vle-spine-beat{position:relative;z-index:1;margin:8px auto;max-width:80%;text-align:center;background:color-mix(in srgb,var(--vg) 12%,var(--vsurf-1));border:1px solid rgba(var(--vg-rgb),.5);border-radius:var(--vr2);padding:7px 12px}",
  // filled square node on the rail marking a spine beat (vs the round branch dots)
  ".vle-spine-beat--sq::before{content:'';position:absolute;left:50%;top:-7px;width:9px;height:9px;margin-left:-4.5px;background:var(--vg);box-shadow:0 0 0 3px var(--vsurf-2),0 0 8px rgba(var(--vg-rgb),.5);z-index:2}",
  ".vle-spine-beat-k{display:block;font:600 var(--vt-eyebrow)/1 var(--vmono);letter-spacing:1px;text-transform:uppercase;color:var(--vg);opacity:.8;margin-bottom:3px}",
  ".vle-spine-beat-x{font-family:var(--vserif);font-style:italic;font-size:calc(14px * var(--vscale));color:var(--vi)}",
  ".vle-spine-row{position:relative;display:flex;width:50%;box-sizing:border-box;margin:5px 0}",
  ".vle-spine-l{margin-right:auto;padding-right:20px;justify-content:flex-end}",
  ".vle-spine-r{margin-left:auto;padding-left:20px}",
  ".vle-spine-card{position:relative;background:var(--vsurf-1);border:1px solid rgba(var(--vg-rgb),.16);border-left:3px solid var(--vle-gold-soft);border-radius:var(--vr2);padding:7px 11px;max-width:100%}",
  ".vle-spine-l .vle-spine-card::after,.vle-spine-r .vle-spine-card::after{content:'';position:absolute;top:14px;width:18px;height:2px;background:rgba(var(--vg-rgb),.3)}",
  ".vle-spine-l .vle-spine-card::after{right:-21px}.vle-spine-r .vle-spine-card::after{left:-21px}",
  ".vle-spine-meta{display:flex;gap:7px;align-items:baseline;margin-bottom:2px}",
  ".vle-spine-kind{font:600 var(--vt-eyebrow)/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;opacity:.7}",
  ".vle-spine-t{font:600 calc(9px * var(--vscale))/1 var(--vmono);opacity:.5}",
  ".vle-spine-x{font-size:calc(12.5px * var(--vscale));line-height:1.45;color:var(--vi2)}",
  ".vle-spine-memory{border-left-color:var(--vg)}.vle-spine-memory .vle-spine-kind{color:var(--vg)}",
  ".vle-spine-knew{border-left-color:var(--v-info)}.vle-spine-knew .vle-spine-kind{color:var(--v-info)}",
  ".vle-spine-secret{border-left-color:var(--v-neg)}.vle-spine-secret .vle-spine-kind{color:var(--v-neg-i)}",
  ".vle-spine-journal{border-left-color:var(--v-pos)}.vle-spine-journal .vle-spine-kind{color:var(--v-pos-i)}",
  ".vle-spine-scar{border-left-color:var(--v-warn)}.vle-spine-scar .vle-spine-kind{color:var(--v-warn)}",
  ".vle-spine-lore{border-left-color:var(--vg)}.vle-spine-lore .vle-spine-kind{color:var(--vg)}",
  "@container (max-width:420px){.vle-spine::before{left:13px}.vle-spine-row{width:100%;padding-left:30px!important;padding-right:0!important;justify-content:flex-start!important;margin-left:0!important;margin-right:0!important}.vle-spine-l .vle-spine-card::after,.vle-spine-r .vle-spine-card::after{left:-17px!important;right:auto!important}.vle-spine-l .vle-spine-node,.vle-spine-r .vle-spine-node{left:9px!important;right:auto!important}.vle-spine-beat,.vle-spine-act{margin-left:0;max-width:100%}.vle-spine-beat--sq::before{left:13px}.vle-spine-day{justify-content:flex-start;margin-left:0}}",
  ".vle-tl{display:flex;flex-direction:column;gap:0;margin-top:6px;position:relative}",
  ".vle-tl-row{display:flex;align-items:flex-start;gap:9px;padding:5px 0;position:relative}",
  ".vle-tl-t{flex:none;width:54px;text-align:right;font:600 9px/1.5 var(--vmono);color:var(--vle-gold);opacity:.7}",
  ".vle-tl-dot{flex:none;width:9px;height:9px;margin-top:3px;border-radius:50%;background:var(--vle-gold);box-shadow:0 0 0 3px rgba(var(--vg-rgb),.12);position:relative}",
  ".vle-tl-dot::before{content:'';position:absolute;left:50%;top:11px;transform:translateX(-50%);width:1px;height:calc(100% + 9px);background:rgba(var(--vg-rgb),.22)}",
  ".vle-tl-row:last-child .vle-tl-dot::before{display:none}",
  ".vle-tl-dot.vle-tl-arc{background:var(--v-warn)}.vle-tl-dot.vle-tl-chapter{background:var(--vle-gold)}",
  ".vle-tl-dot.vle-tl-knew{background:var(--v-info)}.vle-tl-dot.vle-tl-secret{background:var(--v-neg)}.vle-tl-dot.vle-tl-journal{background:var(--v-pos)}",
  ".vle-tl-dot.vle-tl-scar{background:var(--v-warn)}.vle-tl-dot.vle-tl-lore{background:var(--vle-gold)}",
  ".vle-tl-dot.vle-tl-beat{background:var(--vle-gold);box-shadow:0 0 0 2px color-mix(in srgb,var(--vle-gold) 40%,transparent)}",
  ".vle-mem-tier.t-beat{color:var(--vle-gold);border-color:color-mix(in srgb,var(--vle-gold) 45%,transparent)}",
  // G5 index-card feel: beat rows get a hairline card + a faint alternating tilt.
  // (.vle-mem.vle-mem--beat so it beats the base .vle-mem padding at equal-spec.)
  ".vle-mem.vle-mem--beat{position:relative;padding:6px 10px;margin:5px 0;background:color-mix(in srgb,var(--vg) 5%,var(--vsurf-1));border:1px solid rgba(var(--vg-rgb),.16);border-left:3px solid var(--vle-gold);border-radius:var(--vr2);transform:rotate(-.5deg);transition:transform .18s ease}",
  ".vle-mem.vle-mem--beat:nth-child(2n){transform:rotate(.5deg)}",
  ".vle-mem.vle-mem--beat:hover{transform:rotate(0)}",
  "@media (prefers-reduced-motion:reduce){.vle-mem--beat,.vle-mem--beat:nth-child(2n),.vle-mem--beat:hover{transform:none;transition:none}}",
  ".vle-beat-sug-h{display:flex;align-items:center;gap:8px;margin:4px 0 8px;min-width:0}",
  ".vle-beat-sug-lbl{flex:0 0 auto;font:600 10px/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;opacity:.6}",
  ".vle-beat-sug-row{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;scrollbar-width:thin}",
  ".vle-beat-sug-chip{flex:0 0 auto;white-space:nowrap;font:500 11px/1 var(--vmono);color:var(--vi2);background:color-mix(in srgb,var(--vle-gold) 8%,transparent);border:1px solid color-mix(in srgb,var(--vle-gold) 30%,transparent);border-radius:999px;padding:5px 10px;cursor:pointer}",
  ".vle-beat-sug-chip:hover{background:color-mix(in srgb,var(--vle-gold) 18%,transparent);color:var(--vle-gold)}",
  ".vle-scar-was{text-decoration:line-through;text-decoration-color:var(--v-neg);opacity:.85}",
  ".vle-arc{margin:6px 0 8px}",
  ".vle-turn{margin:0 0 8px;padding:7px 9px;border:1px solid rgba(var(--vg-rgb),.16);border-radius:9px;background:color-mix(in srgb,var(--vi) 3%,transparent)}",
  ".vle-plant{display:flex;align-items:baseline;gap:8px;padding:5px 2px}",
  ".vle-plant.paid{opacity:.5}",
  ".vle-plant-mark{flex:0 0 auto;color:var(--vle-gold)}",
  ".vle-plant.paid .vle-plant-mark{color:var(--v-pos)}",
  ".vle-plant-what{flex:1 1 auto;font-family:var(--vserif);font-size:calc(14px * var(--vscale));color:var(--vi)}",
  ".vle-plant.paid .vle-plant-what{text-decoration:line-through;text-decoration-color:rgba(var(--vg-rgb),.4)}",
  ".vle-plant-meta{flex:0 0 auto;font:500 10px/1.4 var(--vmono);color:var(--vi2);opacity:.6}",
  ".vle-os-ripe{font:600 9px/1.4 var(--vmono);letter-spacing:.4px;text-transform:uppercase;color:var(--vle-gold);margin-left:6px}",
  ".vle-os-stale{font:500 9px/1.4 var(--vmono);color:var(--vi2);opacity:.55;margin-left:6px}",
  ".vle-av.has-img{background-size:cover;background-position:center}.vle-av.has-img>.vle-av-dot{}",
  // shared portrait convention: any medallion with .has-img shows the image (cover) + hides initials text
  ".vld-pc-av.has-img,.vle-strip-av.has-img,.vle-jspine-av.has-img{background-size:cover!important;background-position:center;color:transparent;font-size:0}",
  ".vld-stats{display:flex;flex-wrap:wrap;gap:10px;margin:2px 0 6px}",
  ".vld-stat{display:flex;flex-direction:column;align-items:center;min-width:44px}",
  ".vld-stat-v{font-family:var(--vserif);font-size:calc(18px * var(--vscale));color:var(--vle-gold);line-height:1}",
  ".vld-stat-k{font:500 9px/1.4 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--vi2);opacity:.65}",
  ".vld-stat-row{font-size:calc(12px * var(--vscale));color:var(--vi);margin-top:3px}",
  ".vld-stat-lbl{font:600 9px/1.4 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--vi2);opacity:.6;margin-right:5px}",
  "html[data-vle-chrome='futuristic'] .vld-stat-v{font-family:var(--vmono);color:var(--vg)}",
  "html[data-vle-chrome='modern'] .vld-stat-v{color:var(--vi)}",
  ".vle-turn-h{display:flex;align-items:baseline;gap:8px;margin-bottom:4px}",
  ".vle-turn-n{font:600 11px/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--vle-gold)}",
  ".vle-turn-count{flex:1 1 auto;font:500 10px/1.4 var(--vmono);color:var(--vi2);opacity:.6}",
  ".vle-turn-change{display:flex;align-items:baseline;gap:7px;padding:2px 0;font-size:calc(12.5px * var(--vscale))}",
  ".vle-turn-ico{flex:0 0 auto;color:var(--vle-gold);opacity:.8}",
  ".vle-turn-tx{color:var(--vi)}",
  "html[data-vle-chrome='futuristic'] .vle-turn{border-radius:2px}html[data-vle-chrome='futuristic'] .vle-turn-n{font-family:var(--vmono);color:var(--vg)}",
  "html[data-vle-chrome='modern'] .vle-turn{background:color-mix(in srgb,var(--vi) 5%,transparent);border-radius:12px}html[data-vle-chrome='modern'] .vle-turn-n{color:var(--vi2);opacity:.7}",
  ".vle-arc-svg{width:100%;height:46px;display:block}",
  ".vle-arc-zero{stroke:rgba(var(--vg-rgb),.25);stroke-width:1;stroke-dasharray:3 3}",
  ".vle-arc-aff{stroke:var(--v-pos);stroke-width:1.5}",
  ".vle-arc-trust{stroke:var(--vg);stroke-width:1.5}",
  ".vle-arc-key{display:flex;gap:12px;font:500 9px/1.4 var(--vmono);letter-spacing:.4px;text-transform:uppercase;opacity:.6;margin-top:2px}",
  ".vle-arc-k-aff{color:var(--v-pos)}.vle-arc-k-tr{color:var(--vg)}",
  "html[data-vle-chrome='futuristic'] .vle-arc-aff,html[data-vle-chrome='futuristic'] .vle-arc-trust{stroke-width:1.25}",
  "html[data-vle-chrome='modern'] .vle-arc-zero{stroke-dasharray:none;opacity:.5}",
  ".vle-drift{margin:7px 0 3px;padding:7px 9px;border:1px solid rgba(var(--vg-rgb),.16);border-radius:9px;background:color-mix(in srgb,var(--vi) 3%,transparent)}",
  ".vle-drift-arc{display:flex;align-items:center;flex-wrap:wrap;gap:5px;font-size:calc(12.5px * var(--vscale))}",
  ".vle-drift-k{font:600 9px/1.4 var(--vmono);letter-spacing:.6px;text-transform:uppercase;color:var(--vle-gold);opacity:.75;margin-right:3px}",
  ".vle-drift-t{font-family:var(--vserif);color:var(--vi)}",
  ".vle-drift-hardened{color:var(--vle-gold);font-weight:600}",
  ".vle-drift-rising{color:var(--v-pos)}",
  ".vle-drift-gone{opacity:.5;text-decoration:line-through;text-decoration-color:rgba(var(--vg-rgb),.4)}",
  ".vle-drift-arrow{color:var(--vi2);opacity:.5}",
  ".vle-drift-dormant-lbl,.vle-drift-op{font:600 9px/1.4 var(--vmono);letter-spacing:.4px;text-transform:uppercase;color:var(--vi2);opacity:.6}",
  ".vle-drift-timeline{margin-top:6px;display:flex;flex-direction:column;gap:3px;border-left:1px solid rgba(var(--vg-rgb),.16);padding-left:8px}",
  ".vle-drift-node{display:flex;align-items:baseline;gap:6px;font-size:calc(12px * var(--vscale))}",
  ".vle-drift-mark{flex:0 0 auto;color:var(--vle-gold)}",
  ".vle-drift-reverse .vle-drift-mark{color:var(--v-warn)}",
  ".vle-drift-fade .vle-drift-mark{color:var(--vi2);opacity:.5}",
  ".vle-drift-lab{font-family:var(--vserif);color:var(--vi)}",
  ".vle-drift-cause{flex:1 1 auto;min-width:0;color:var(--vi2);opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".vle-drift-turn{flex:0 0 auto;font:500 10px/1.4 var(--vmono);color:var(--vi2);opacity:.55}",
  "html[data-vle-chrome='futuristic'] .vle-drift{border-radius:2px;background:rgba(var(--vg-rgb),.05)}",
  "html[data-vle-chrome='futuristic'] .vle-drift-t,html[data-vle-chrome='futuristic'] .vle-drift-lab{font-family:var(--vmono);font-style:normal}",
  "html[data-vle-chrome='futuristic'] .vle-drift-hardened{text-shadow:0 0 6px color-mix(in srgb,var(--vle-gold) 60%,transparent)}",
  "html[data-vle-chrome='modern'] .vle-drift{background:color-mix(in srgb,var(--vi) 5%,transparent);border-radius:12px}",
  "html[data-vle-chrome='modern'] .vle-drift-k{color:var(--vi2);opacity:.6}",
  ".vle-director{display:flex;flex-direction:column;gap:8px}",
  ".vle-dir-col{margin:0 0 10px}",
  ".vle-dir-col-h{font:600 11px/1 var(--vmono);letter-spacing:.6px;text-transform:uppercase;color:var(--vle-gold);opacity:.8;margin:0 0 5px;padding-bottom:3px;border-bottom:1px solid rgba(var(--vg-rgb),.16)}",
  ".vle-dir-card{display:flex;align-items:baseline;gap:8px;padding:6px 9px;margin:0 0 5px;border:1px solid rgba(var(--vg-rgb),.18);border-left:3px solid var(--v-warn);border-radius:8px;background:color-mix(in srgb,var(--vi) 3%,transparent)}",
  // G6 luminance lifecycle: scheduled dim (butter), active lit (mint) + glow,
  // done greyed + struck. The left-bar reads as a state gauge at a glance.
  ".vle-dir-armed{border-left-color:var(--v-pos);border-left-width:4px}",
  ".vle-dir-dormant{border-left-color:var(--v-warn);opacity:.72}",
  ".vle-dir-done{border-left-color:rgba(var(--vg-rgb),.3);opacity:.55}",
  ".vle-dir-done .vle-dir-text{text-decoration:line-through;text-decoration-color:color-mix(in srgb,var(--vi) 45%,transparent)}",
  ".vle-dir-glyph{flex:0 0 auto;color:var(--vle-gold)}",
  ".vle-dir-text{flex:1 1 auto;font-family:var(--vserif);font-size:calc(14px * var(--vscale));color:var(--vi)}",
  ".vle-dir-target{font-family:var(--vmono);font-size:11px;color:var(--vi2);opacity:.7}",
  ".vle-dir-when,.vle-dir-ttl{font-family:var(--vmono);font-size:10px;color:var(--vi2);opacity:.65}",
  ".vle-loc-grp{margin:0 0 10px}",
  ".vle-loc-grp-h{font:600 11px/1 var(--vmono);letter-spacing:.6px;text-transform:uppercase;color:var(--vle-gold);opacity:.8;margin:0 0 5px;padding-bottom:3px;border-bottom:1px solid rgba(var(--vg-rgb),.16)}",
  ".vle-loc-row{position:relative;display:flex;align-items:center;gap:8px;padding:6px 6px;border-radius:var(--vr1);transition:background .12s}",
  ".vle-loc-row:hover{background:rgba(var(--vg-rgb),.06)}",
  ".vle-loc-mark{flex:0 0 auto;color:var(--vle-gold)}",
  ".vle-loc-name{font-family:var(--vserif);font-size:calc(14.5px * var(--vscale));color:var(--vi);font-weight:600}",
  ".vle-loc-note{flex:1 1 auto;min-width:0;font-size:calc(12px * var(--vscale));color:var(--vi2);opacity:.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".vle-loc-tree{margin:0 0 6px}",
  ".vle-loc-node{position:relative}",
  // children indent under their parent; connectors are drawn PER child node so
  // nesting stays correct (classic file-tree CSS): a vertical segment + an elbow.
  ".vle-loc-kids{margin-left:9px;padding-left:16px}",
  // vertical rail: runs from the top of the node down to the child's dot centre;
  // non-last children extend it the full node height to reach the next sibling.
  ".vle-loc-kids>.vle-loc-node::before{content:'';position:absolute;left:-7px;top:0;height:16px;width:2px;background:rgba(var(--vg-rgb),.28)}",
  ".vle-loc-kids>.vle-loc-node:not(:last-child)::before{height:100%}",
  // elbow: from the rail across to the dot
  ".vle-loc-kids>.vle-loc-node>.vle-loc-row::before{content:'';position:absolute;left:-7px;top:15px;width:13px;height:2px;background:rgba(var(--vg-rgb),.28)}",
  ".vle-loc-dot{position:relative;flex:0 0 auto;display:inline-grid;place-items:center;width:19px;height:19px;font-size:calc(11px * var(--vscale));color:var(--vle-gold);background:var(--vsurf-1);border:1px solid rgba(var(--vg-rgb),.3);border-radius:50%;box-shadow:0 0 0 3px var(--vsurf-1)}",
  ".vle-loc-caret{flex:0 0 auto;width:16px;height:16px;display:inline-grid;place-items:center;padding:0;font-size:calc(10px * var(--vscale));line-height:1;color:var(--vle-gold);background:transparent;border:none;border-radius:4px;cursor:pointer;opacity:.7;transition:transform .12s,opacity .12s}",
  ".vle-loc-caret:hover{opacity:1;background:rgba(var(--vg-rgb),.14)}",
  ".vle-loc-caret.closed{transform:rotate(-90deg)}",
  ".vle-loc-caret.spacer{cursor:default;opacity:0;pointer-events:none}",
  ".vle-loc-count{flex:0 0 auto;font:600 9px/1 var(--vmono);color:var(--vle-gold);background:rgba(var(--vg-rgb),.14);border-radius:999px;padding:2px 6px}",
  ".vle-nextscene{border:1px solid color-mix(in srgb,var(--vle-gold) 30%,transparent);border-radius:10px;padding:11px 13px;background:color-mix(in srgb,var(--vle-gold) 6%,transparent)}",
  ".vle-ns-row{display:flex;gap:9px;margin:0 0 5px}",
  ".vle-ns-k{flex:0 0 48px;font:600 10px/1.5 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--vle-gold);opacity:.75}",
  ".vle-ns-v{flex:1 1 auto;font-family:var(--vserif);font-size:calc(14px * var(--vscale));color:var(--vi)}",
  ".vle-ns-ctl{display:flex;gap:6px;margin-top:8px}",
  // next-turn steering cross-link (Director tab → Tone modal)
  ".vle-ns-steer{margin-top:12px;padding-top:10px;border-top:1px solid rgba(var(--vg-rgb),.14);font-size:calc(12px * var(--vscale));color:var(--vi2);opacity:.85}",
  ".vle-link{background:none;border:none;cursor:pointer;font:inherit;color:var(--vle-gold);padding:0 2px;text-decoration:underline;text-decoration-color:rgba(var(--vg-rgb),.4)}",
  ".vle-link:hover{text-decoration-color:var(--vle-gold)}",
  ".vle-dir-log-row{display:flex;align-items:baseline;gap:8px;padding:5px 2px;border-bottom:1px solid rgba(var(--vg-rgb),.08)}",
  ".vle-dir-log-mark{flex:0 0 auto}",
  ".vle-dir-log-flag .vle-dir-log-mark{color:var(--v-neg)}",
  ".vle-dir-log-reveal .vle-dir-log-mark{color:var(--vle-gold)}",
  ".vle-dir-log-time .vle-dir-log-mark{color:var(--v-info)}",
  ".vle-dir-log-time{border-left:2px solid color-mix(in srgb,var(--v-info) 45%,transparent);padding-left:8px;background:color-mix(in srgb,var(--v-info) 5%,transparent)}",
  ".vle-dir-log-t{flex:1 1 auto;font-size:calc(13px * var(--vscale));color:var(--vi)}",
  ".vle-dir-log-turn{flex:0 0 auto;font:500 10px/1.4 var(--vmono);color:var(--vi2);opacity:.6}",
  "html[data-vle-chrome='futuristic'] .vle-dir-col-h,html[data-vle-chrome='futuristic'] .vle-loc-grp-h{font-family:var(--vmono);color:var(--vg)}",
  "html[data-vle-chrome='futuristic'] .vle-dir-card{border-radius:2px;background:rgba(var(--vg-rgb),.06)}",
  "html[data-vle-chrome='futuristic'] .vle-dir-text,html[data-vle-chrome='futuristic'] .vle-loc-name,html[data-vle-chrome='futuristic'] .vle-ns-v{font-family:var(--vmono);font-style:normal}",
  "html[data-vle-chrome='futuristic'] .vle-nextscene{border-radius:2px}",
  "html[data-vle-chrome='modern'] .vle-dir-col-h,html[data-vle-chrome='modern'] .vle-loc-grp-h{color:var(--vi2);opacity:.6}",
  "html[data-vle-chrome='modern'] .vle-dir-card{background:color-mix(in srgb,var(--vi) 5%,transparent);border-left-width:3px}",
  "html[data-vle-chrome='modern'] .vle-nextscene{border-radius:14px;background:color-mix(in srgb,var(--vi) 5%,transparent);border-color:rgba(var(--vg-rgb),.2)}",
  // ---- Items (possession tracker) — built on theme vars so it adapts per chrome ----
  ".vle-item-grp{margin:0 0 10px}",
  ".vle-item-grp-h{font:600 11px/1 var(--vmono);letter-spacing:.6px;text-transform:uppercase;color:var(--vle-gold);opacity:.8;margin:0 0 5px;padding-bottom:3px;border-bottom:1px solid rgba(var(--vg-rgb),.16)}",
  ".vle-item-row{display:flex;align-items:baseline;gap:8px;padding:5px 2px}",
  ".vle-item-name{font-family:var(--vserif);font-size:calc(14px * var(--vscale));color:var(--vi)}",
  ".vle-item-note{flex:1 1 auto;min-width:0;font-size:calc(12px * var(--vscale));color:var(--vi2);opacity:.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  // present-card carried-items chip strip (echo on the Now card)
  ".vld-pc-items{margin-top:4px;display:flex;flex-wrap:wrap;gap:4px}",
  ".vld-pc-item{font:500 10px/1.4 var(--vmono);color:var(--vle-gold);background:color-mix(in srgb,var(--vle-gold) 10%,transparent);border:1px solid color-mix(in srgb,var(--vle-gold) 28%,transparent);border-radius:12px;padding:2px 7px;max-width:100%;white-space:normal;overflow-wrap:anywhere;word-break:break-word}",
  // FUTURISTIC chrome: square, mono, accent edge — match the diary/HUD treatment
  "html[data-vle-chrome='futuristic'] .vle-item-grp-h{font-family:var(--vmono);color:var(--vg)}",
  "html[data-vle-chrome='futuristic'] .vle-item-name{font-family:var(--vmono);font-style:normal}",
  "html[data-vle-chrome='futuristic'] .vld-pc-item{border-radius:2px;background:rgba(var(--vg-rgb),.12)}",
  // MODERN chrome: flat, quieter accent, no manuscript gilt emphasis
  "html[data-vle-chrome='modern'] .vle-item-grp-h{color:var(--vi2);opacity:.6}",
  "html[data-vle-chrome='modern'] .vld-pc-item{border-radius:6px;color:var(--vi);background:color-mix(in srgb,var(--vi) 6%,transparent);border-color:rgba(var(--vg-rgb),.2)}",
  ".vle-mem.pickable{cursor:pointer}.vle-mem-pick{margin-right:6px;accent-color:var(--vle-gold);cursor:pointer}",
  ".vle-pickbar{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding:7px 10px;margin:4px 0 8px;border:1px solid color-mix(in srgb,var(--vle-gold) 35%,transparent);border-radius:8px;background:color-mix(in srgb,var(--vle-gold) 8%,transparent);font-size:12px}",
  ".vle-add.danger{color:var(--v-neg);border-color:color-mix(in srgb,var(--v-neg) 40%,transparent)}.vle-add.danger:hover{background:color-mix(in srgb,var(--v-neg) 14%,transparent)}",
  ".vle-tl-body{flex:1;display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;font-size:12px;line-height:1.5}",
  ".vle-tl-k{font:600 8px/1.4 var(--vmono);letter-spacing:.4px;text-transform:uppercase;color:var(--vi2);opacity:.7}",
  ".vle-tl-day{font:600 8px/1.4 var(--vmono);color:var(--vle-gold);opacity:.6}",
  ".vle-tl-x{flex:1 1 100%;opacity:.9}",
  ".vle-toolbar{display:flex;flex-wrap:wrap;gap:5px;margin:0 0 calc(12px * var(--vscale))}",
  ".vle-qol{font:600 calc(10px * var(--vscale))/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--vi2);background:transparent;border:1px solid var(--vle-gold-soft);border-radius:8px;padding:7px 11px;cursor:pointer;transition:background .15s,color .15s}",
  ".vle-qol:hover{background:rgba(var(--vg-rgb),.14);color:var(--vle-gold);border-color:rgba(var(--vg-rgb),.4)}",
  ".vle-qol.on{background:rgba(var(--vg-rgb),.28);color:var(--vle-gold);border-color:var(--vle-gold);box-shadow:inset 0 0 0 1px rgba(var(--vg-rgb),.35)}",
  ".vle-qol.on::before{content:'\\2713 ';opacity:.9}",
  ".vle-qol.busy{color:var(--vle-gold);border-color:rgba(var(--vg-rgb),.5);cursor:progress;opacity:.85}",
  ".vle-qol.busy::before{content:'\\21BB ';display:inline-block;animation:vle-spin 0.9s linear infinite}",
  "@keyframes vle-spin{to{transform:rotate(360deg)}}",
  // Actions menu (grouped overlay)
  ".vle-acts{gap:14px}",
  ".vle-act-grp{display:flex;flex-direction:column;gap:4px}",
  ".vle-act-h{font:600 calc(9px * var(--vscale))/1 var(--vmono);letter-spacing:1px;text-transform:uppercase;color:var(--vg);opacity:.7;margin-bottom:2px}",
  ".vle-act-item{display:flex;align-items:center;justify-content:space-between;gap:10px;font:600 calc(11px * var(--vscale))/1 var(--vmono);letter-spacing:.4px;text-transform:uppercase;color:var(--vi2);background:rgba(var(--vg-rgb),.06);border:1px solid var(--vle-gold-soft);border-radius:8px;padding:9px 12px;cursor:pointer;transition:background .15s,color .15s;text-align:left;width:100%}",
  ".vle-act-item .vi{opacity:.8;margin-right:-2px}",
  ".vle-act-item .vle-act-l{flex:1}",
  ".vle-act-item:hover{background:rgba(var(--vg-rgb),.18);color:var(--vle-gold);border-color:rgba(var(--vg-rgb),.4)}",
  ".vle-act-item.busy{cursor:progress;opacity:.8}",
  ".vle-act-st{font:600 calc(9px * var(--vscale))/1 var(--vmono);letter-spacing:.3px;text-transform:none;color:var(--vg);opacity:.85}",
  ".vle-act-item.danger{border-color:color-mix(in srgb,var(--v-neg) 35%,transparent)}",
  ".vle-act-item.danger:hover{color:var(--v-neg-i);border-color:color-mix(in srgb,var(--v-neg) 55%,transparent);background:color-mix(in srgb,var(--v-neg) 12%,transparent)}",
  // search palette
  ".vle-search-results{display:flex;flex-direction:column;gap:4px;max-height:50vh;overflow-y:auto;margin-top:9px}",
  ".vle-search-hit{display:flex;align-items:baseline;gap:8px;text-align:left;width:100%;background:rgba(var(--vg-rgb),.05);border:1px solid var(--vle-gold-soft);border-radius:8px;padding:8px 11px;cursor:pointer;transition:background .15s}",
  ".vle-search-hit:hover{background:rgba(var(--vg-rgb),.16)}",
  ".vle-search-k{flex:none;font:600 8px/1.4 var(--vmono);letter-spacing:.4px;text-transform:uppercase;color:var(--vle-gold);opacity:.8;min-width:62px}",
  ".vle-search-l{flex:none;font-family:var(--vserif);font-size:14px;color:var(--vi)}",
  ".vle-search-s{flex:1;font-size:11px;opacity:.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  // Plot Director panel
  ".vle-dir-list{display:flex;flex-direction:column;gap:5px;margin:6px 0}",
  ".vle-dir-row{display:flex;align-items:center;gap:8px;background:rgba(var(--vg-rgb),.06);border:1px solid var(--vle-gold-soft);border-radius:8px;padding:7px 10px}",
  ".vle-dir-k{flex:none;font:600 8px/1.3 var(--vmono);letter-spacing:.4px;text-transform:uppercase;color:var(--v-warn);min-width:88px}",
  ".vle-dir-t{flex:1;font-size:12px;line-height:1.4}",
  ".vle-dir-row.dormant{opacity:.7}",
  ".vle-dir-when{flex:none;font:600 8px/1.4 var(--vmono);letter-spacing:.4px;color:var(--v-info)}",
  ".vle-body{min-height:60px}",
  ".vle-empty{padding:28px 10px;text-align:center;opacity:.65;font-size:calc(15px * var(--vscale));line-height:1.6}",
  ".vle-empty.sm{padding:14px;font-size:calc(13px * var(--vscale))}",
  // section headers + counts
  ".vle-sec-h{font:600 calc(10px * var(--vscale))/1 var(--vmono);letter-spacing:1.2px;text-transform:uppercase;color:var(--vg);opacity:.7;margin:calc(15px * var(--vscale)) 0 calc(8px * var(--vscale));display:flex;align-items:center;gap:7px}",
  ".vle-n{font-size:calc(9px * var(--vscale));background:var(--vle-gold-soft);color:var(--vle-gold);border-radius:9px;padding:2px 7px}",
  // World scene banner: a framed "you are here" plate — location leads in serif,
  // tension reads as a 10-pip gauge that warms with the level. Accent tints hot.
  ".vle-scene{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:9px 12px;margin-bottom:8px;border:1px solid rgba(var(--vg-rgb),.22);border-left:3px solid var(--vg);border-radius:var(--vr2);background:linear-gradient(100deg,color-mix(in srgb,var(--vg) 9%,transparent),transparent 70%)}",
  ".vle-scene.warm{border-left-color:var(--v-press);background:linear-gradient(100deg,color-mix(in srgb,var(--v-press) 10%,transparent),transparent 72%)}",
  ".vle-scene.hot{border-left-color:var(--v-neg);background:linear-gradient(100deg,color-mix(in srgb,var(--v-neg) 12%,transparent),transparent 74%)}",
  ".vle-scene-pin{flex:0 0 auto;color:var(--vg);font-size:calc(13px * var(--vscale));opacity:.85}",
  ".vle-scene.warm .vle-scene-pin{color:var(--v-press)}.vle-scene.hot .vle-scene-pin{color:var(--v-neg)}",
  ".vle-scene-loc{flex:1 1 auto;min-width:0;font-family:var(--vserif);font-size:calc(16px * var(--vscale));font-style:italic;color:var(--vi);overflow-wrap:anywhere}",
  ".vle-scene-gauge{flex:0 0 auto;display:inline-flex;align-items:center;gap:2px}",
  ".vle-scene-gauge i{width:4px;height:11px;border-radius:1px;background:rgba(var(--vg-rgb),.18)}",
  ".vle-scene-gauge i.on{background:var(--vg)}",
  ".vle-scene-gauge.warm i.on{background:var(--v-press)}.vle-scene-gauge.hot i.on{background:var(--v-neg)}",
  ".vle-scene-gauge b{margin-left:5px;font:700 calc(11px * var(--vscale))/1 var(--vmono);color:var(--vg)}",
  ".vle-scene-gauge.warm b{color:var(--v-press)}.vle-scene-gauge.hot b{color:var(--v-neg)}",
  // legacy inline tension pill (still used elsewhere) kept minimal
  ".vle-tension{font:600 calc(10px * var(--vscale))/1 var(--vmono);color:var(--v-neg);letter-spacing:.5px;margin-left:6px}",
  // NOW plate: the authoritative clock, a compact companion to the scene banner.
  // Day leads in the mono face; the time reads as a soft pill; a night glyph tints
  // it cool, a day slot warm. The edit affordance stays quiet until hover.
  ".vle-now{display:flex;align-items:center;gap:8px;padding:5px 11px;margin-bottom:8px;border:1px solid rgba(var(--vg-rgb),.16);border-radius:999px;background:color-mix(in srgb,var(--vg) 5%,transparent);width:fit-content;max-width:100%}",
  ".vle-now-ico{flex:0 0 auto;color:var(--vg);font-size:calc(12px * var(--vscale));opacity:.8;filter:drop-shadow(0 0 4px color-mix(in srgb,var(--vg) 45%,transparent))}",
  ".vle-now.day .vle-now-ico{color:var(--v-press)}",
  ".vle-now-day{font:700 calc(11px * var(--vscale))/1 var(--vmono);letter-spacing:.4px;color:var(--vi);white-space:nowrap}",
  ".vle-now-sep{flex:0 0 auto;width:3px;height:3px;border-radius:50%;background:rgba(var(--vg-rgb),.5)}",
  ".vle-now-time{font:600 calc(9px * var(--vscale))/1 var(--vmono);text-transform:uppercase;letter-spacing:.7px;color:var(--vg);background:var(--vle-gold-soft);border-radius:999px;padding:3px 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:14ch}",
  ".vle-now-edit{flex:0 0 auto;margin-left:2px;border:none;background:transparent;color:var(--vg);opacity:0;cursor:pointer;font-size:calc(10px * var(--vscale));padding:2px 4px;border-radius:6px;transition:opacity .12s,background .12s}",
  ".vle-now:hover .vle-now-edit,.vle-now-edit:focus-visible{opacity:.75}",
  ".vle-now-edit:hover{opacity:1;background:var(--vle-gold-soft)}",
  // Time Sync desync inspector: lagging threads + advisory findings
  ".vle-desync{display:flex;flex-direction:column;gap:5px;margin:4px 0 6px}",
  // per-thread catch-up row: name · from-day · arrow · lag · jump-to button. The
  // mono "dN" + arrow read as a clear jump descriptor; the button is the primary
  // action, separated from the per-row text.
  ".vle-desync-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto auto auto;align-items:center;gap:8px;padding:7px 11px;border:1px solid rgba(var(--vg-rgb),.16);border-left:3px solid var(--v-warn);border-radius:var(--vr2);background:color-mix(in srgb,var(--v-warn) 6%,transparent)}",
  ".vle-desync-n{min-width:0;font-family:var(--vserif);font-size:calc(13px * var(--vscale));font-style:italic;color:var(--vi);overflow-wrap:anywhere;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".vle-desync-from{flex:0 0 auto;font:600 calc(9px * var(--vscale))/1 var(--vmono);color:var(--vi2);letter-spacing:.3px;opacity:.7}",
  ".vle-desync-arrow{flex:0 0 auto;color:var(--v-warn);opacity:.7;font-size:calc(10px * var(--vscale))}",
  ".vle-desync-lag{flex:0 0 auto;font:600 calc(9px * var(--vscale))/1 var(--vmono);color:var(--v-warn);letter-spacing:.4px;white-space:nowrap}",
  // stamped-forward-but-unauthored state: reads as a neutral "to do", not a warning
  ".vle-desync-lag.await{color:var(--vi2);opacity:.85;font-style:italic;text-transform:none;letter-spacing:.2px}",
  ".vle-desync-catch{flex:0 0 auto;font:600 calc(9px * var(--vscale))/1 var(--vmono);letter-spacing:.3px;color:var(--v-warn);background:color-mix(in srgb,var(--v-warn) 12%,transparent);border:1px solid color-mix(in srgb,var(--v-warn) 45%,transparent);border-radius:7px;padding:4px 9px;cursor:pointer;white-space:nowrap;transition:background .12s,color .12s}",
  ".vle-desync-catch:hover{background:color-mix(in srgb,var(--v-warn) 22%,transparent);color:var(--vi)}",
  // the "catch-up all" row action, slotted in the section header next to the title
  ".vle-desync-all{font:600 calc(9px * var(--vscale))/1 var(--vmono);letter-spacing:.4px;text-transform:uppercase;color:var(--v-warn);background:color-mix(in srgb,var(--v-warn) 12%,transparent);border:1px solid color-mix(in srgb,var(--v-warn) 42%,transparent);border-radius:8px;padding:5px 11px;cursor:pointer;white-space:nowrap;transition:background .12s,color .12s;max-width:42ch;overflow:hidden;text-overflow:ellipsis}",
  ".vle-desync-all:hover{background:color-mix(in srgb,var(--v-warn) 24%,transparent);color:var(--vi)}",
  // collapsible desync-advisory log beneath the rows: a count toggle + a tucked
  // body, so a standing warning never drowns the rows. Mono, muted, indented.
  ".vle-desync-log{margin-top:2px;border-top:1px solid rgba(var(--vg-rgb),.12);padding-top:5px}",
  ".vle-desync-log-toggle{display:flex;align-items:center;gap:6px;width:100%;text-align:left;background:none;border:1px solid rgba(var(--vg-rgb),.14);border-radius:7px;padding:5px 9px;font:500 calc(9px * var(--vscale))/1.3 var(--vmono);color:var(--vg);opacity:.85;cursor:pointer;transition:background .12s,opacity .12s}",
  ".vle-desync-log-toggle:hover{background:color-mix(in srgb,var(--v-info) 8%,transparent);opacity:1}",
  ".vle-desync-log-count{display:inline-grid;place-items:center;min-width:14px;height:14px;font-weight:700;color:var(--v-info);background:color-mix(in srgb,var(--v-info) 16%,transparent);border-radius:999px;padding:0 4px}",
  ".vle-desync-log-chev{margin-left:auto;color:var(--vi2);font-size:calc(8px * var(--vscale));transition:transform .12s}",
  ".vle-desync-log-toggle[aria-expanded='true'] .vle-desync-log-chev{transform:rotate(180deg)}",
  ".vle-desync-log-body{display:flex;flex-direction:column;gap:4px;margin-top:5px}",
  ".vle-desync-note{font-size:calc(10px * var(--vscale));line-height:1.45;color:var(--vg);opacity:.9;padding:5px 8px 5px 22px;text-indent:-14px;border-left:2px solid color-mix(in srgb,var(--v-info) 40%,transparent);background:color-mix(in srgb,var(--v-info) 4%,transparent);border-radius:0 var(--vr1) var(--vr1) 0}",
  ".vle-desync-note::before{content:'\\26A0';margin-right:5px;color:var(--v-info)}",
  // cast cards
  ".vle-cards{display:flex;flex-direction:column;gap:calc(7px * var(--vscale))}",
  ".vle-card{position:relative;display:flex;align-items:center;gap:11px;padding:calc(11px * var(--vscale)) calc(13px * var(--vscale));border:1px solid var(--vle-gold-soft);border-radius:var(--vr3);background:linear-gradient(170deg,var(--vsurf-1),var(--vsurf-2));border-left:4px solid var(--vle-gold-soft)}",
  // status carried by a colored left spine (visible without reading)
  ".vle-card--present{border-left-color:var(--v-pos)}",
  ".vle-card--active{border-left-color:var(--v-info)}",
  ".vle-card--mentioned{border-left-color:rgba(var(--vg-rgb),.5)}",
  ".vle-card--added{border-left-color:var(--v-warn)}",
  ".vle-card.on{border-color:var(--vle-gold);border-left-color:var(--v-pos);box-shadow:0 0 10px rgba(var(--vg-rgb),.18)}",
  ".vle-av{position:relative;flex:none;width:calc(34px * var(--vscale));height:calc(34px * var(--vscale));display:grid;place-items:center;border-radius:50%;background:rgba(var(--vg-rgb),.18);color:var(--vle-gold);font-weight:600;font-size:calc(13px * var(--vscale))}",
  // presence dot on the avatar (mockup): tinted by status, hidden unless present/active
  ".vle-av-dot{position:absolute;right:-1px;top:-1px;width:9px;height:9px;border-radius:50%;border:2px solid var(--vsurf-2);background:transparent}",
  ".vle-card--present .vle-av-dot{background:var(--v-pos)}",
  ".vle-card--active .vle-av-dot{background:var(--v-info)}",
  ".vle-card-main{display:flex;flex-direction:column;gap:3px;min-width:0}",
  ".vle-card-n{font-size:calc(16px * var(--vscale))}",
  // character name color / gradient (nameHtml). Solid uses inline color; gradient
  // clips a background to the text. Inherits weight/size from the surrounding name.
  ".vle-name{font:inherit}",
  ".vle-name--grad{background:linear-gradient(90deg,var(--c1),var(--c2));-webkit-background-clip:text;background-clip:text;color:transparent}",
  ".vle-name--lift{text-shadow:0 0 6px rgba(255,255,255,.35)}",
  ".vle-star{color:var(--vle-gold);font-size:calc(10px * var(--vscale))}",
  ".vle-deceased{opacity:.55;font-size:calc(11px * var(--vscale))}",
  ".vle-card-meta{font:600 calc(10px * var(--vscale))/1.2 var(--vmono);opacity:.6}",
  // density toggle (cards vs strip)
  ".vle-dens{display:inline-flex;gap:2px;margin-right:8px}",
  ".vle-dens-b{font:600 10px/1 var(--vmono);padding:4px 8px;border-radius:var(--vr1);border:1px solid rgba(var(--vg-rgb),.2);background:transparent;color:var(--vi2);cursor:pointer;opacity:.7}",
  ".vle-dens-b.on{background:rgba(var(--vg-rgb),.16);color:var(--vg);border-color:var(--vg);opacity:1}",
  // avatar is now a button (unfold); keep visuals, add cursor
  ".vle-av{cursor:pointer;border:none}",
  // expanded card detail
  ".vle-card.is-open{align-items:flex-start}",
  ".vle-card-detail{margin-top:8px;display:flex;flex-direction:column;gap:6px}",
  ".vle-card-app2{font-size:calc(13px * var(--vscale));opacity:.82;line-height:1.5}",
  ".vle-card-aka{font-size:calc(12px * var(--vscale));opacity:.7}",
  ".vle-card-aka-k{font:600 var(--vt-eyebrow)/1 var(--vmono);text-transform:uppercase;letter-spacing:1px;color:var(--vg);opacity:.7;margin-right:4px}",
  ".vle-card-bonds{display:flex;flex-wrap:wrap;gap:4px}",
  ".vle-bondchip{font:600 calc(10px * var(--vscale))/1 var(--vmono);padding:3px 7px;border-radius:var(--vr1);border:1px solid color-mix(in srgb,var(--v-chip-c,var(--vg)) 40%,transparent);color:var(--v-chip-c,var(--vi2))}",
  ".vle-bondchip--pos{--v-chip-c:var(--v-pos-i)}.vle-bondchip--neg{--v-chip-c:var(--v-neg-i)}.vle-bondchip--info{--v-chip-c:var(--v-info)}",
  ".vle-card-disp{font-size:calc(12.5px * var(--vscale));color:var(--vi2);line-height:1.45}",
  ".vle-card-traits{display:flex;flex-wrap:wrap;gap:4px}",
  ".vle-traitchip{font:600 calc(10px * var(--vscale))/1 var(--vmono);padding:3px 7px;border-radius:var(--vr1);border:1px solid color-mix(in srgb,var(--vg) 30%,transparent);color:var(--vi2);text-transform:lowercase}",
  ".vle-card-note{font-style:italic;font-size:calc(12.5px * var(--vscale));opacity:.7;line-height:1.5}",
  // compact strip rows (density mode for big casts)
  ".vle-strips{display:flex;flex-direction:column;gap:3px}",
  ".vle-strip{display:flex;align-items:center;gap:9px;padding:5px 10px;border-radius:var(--vr2);background:rgba(var(--vg-rgb),.04);border-left:3px solid var(--vle-gold-soft)}",
  ".vle-strip.vle-card--present{border-left-color:var(--v-pos)}.vle-strip.vle-card--active{border-left-color:var(--v-info)}.vle-strip.vle-card--mentioned{border-left-color:rgba(var(--vg-rgb),.5)}.vle-strip.vle-card--added{border-left-color:var(--v-warn)}",
  ".vle-strip-av{flex:none;width:22px;height:22px;display:grid;place-items:center;border-radius:50%;background:rgba(var(--vg-rgb),.18);color:var(--vg);font:600 9px/1 var(--vmono)}",
  ".vle-strip-n{font-family:var(--vserif);font-size:calc(14px * var(--vscale));color:var(--vi)}",
  ".vle-strip-st{font:600 calc(10px * var(--vscale))/1 var(--vmono);opacity:.6;font-style:italic}",
  ".vle-strip-role{font-size:calc(11px * var(--vscale));opacity:.55}",
  ".vle-strip-bonds{display:inline-flex;gap:3px;margin-left:auto;margin-right:4px}",
  ".vle-strip-dot{width:7px;height:7px;border-radius:50%;background:var(--vi2)}",
  ".vle-strip-dot--pos{background:var(--v-pos)}.vle-strip-dot--neg{background:var(--v-neg)}.vle-strip-dot--info{background:var(--v-info)}",
  // two-axis bond glyph: affection = fill (pos/neg/info), trust = the ring. A
  // confident ring (gold, solid) reads high trust; a wary ring (red, dashed via
  // a doubled box-shadow gap) reads low trust; mid trust wears no ring. This
  // restores the trust axis the old affection-only dot silently dropped.
  ".vle-bonddot{width:9px;height:9px;border-radius:50%;box-sizing:border-box;background:var(--vi2)}",
  ".vle-bonddot--pos{background:var(--v-pos)}.vle-bonddot--neg{background:var(--v-neg)}.vle-bonddot--info{background:var(--v-info)}",
  ".vle-bonddot--t-high{box-shadow:0 0 0 1.5px var(--vsurf-1),0 0 0 3px rgba(var(--vg-rgb),.85)}",
  ".vle-bonddot--t-low{box-shadow:0 0 0 1.5px var(--vsurf-1),0 0 0 3px color-mix(in srgb,var(--v-neg) 70%,transparent)}",

  ".vle-strip .vle-card-ctl{margin-left:0}",
  // sentence-case status+role line (cast redesign): serif, italic, calm
  ".vle-card-sub{font-family:var(--vserif);font-style:italic;font-size:calc(13px * var(--vscale));color:var(--v-pos-i);opacity:.85}",
  ".vle-card--mentioned .vle-card-sub,.vle-card--added .vle-card-sub{color:var(--vi2);opacity:.6}",
  ".vle-card-app{font-size:13px;opacity:.72;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  // tracks + memory
  // plot threads / arcs — cards in a responsive grid (was a cramped 1-row flex)
  ".vle-trk-grid{display:flex;flex-direction:column;gap:8px;margin-bottom:6px}",
  ".vle-trk{display:flex;flex-direction:column;gap:6px;padding:10px 11px;border:1px solid rgba(var(--vg-rgb),.18);border-left:3px solid var(--vle-gold-soft);border-radius:var(--vr2);background:color-mix(in srgb,var(--vi) 3%,transparent)}",
  ".vle-trk--done{opacity:.6;border-left-color:rgba(var(--vg-rgb),.3)}",
  // arcs (long story movements) read as gilt spine; threads (looser subplots) as
  // a cooler info spine with a dotted lead-in, so the two kinds glance apart.
  ".vle-trk--arc{border-left-color:var(--vg);background:linear-gradient(100deg,color-mix(in srgb,var(--vg) 6%,transparent),transparent 60%)}",
  ".vle-trk--thread{border-left-style:dashed;border-left-color:color-mix(in srgb,var(--v-info) 60%,transparent);background:color-mix(in srgb,var(--v-info) 4%,transparent)}",
  ".vle-trk--arc.vle-trk--done,.vle-trk--thread.vle-trk--done{border-left-color:rgba(var(--vg-rgb),.3)}",
  ".vle-trk-head{display:flex;flex-direction:column;align-items:flex-start;gap:6px}",
  ".vle-trk-n{font-family:var(--vserif);font-size:calc(14px * var(--vscale));line-height:1.3;color:var(--vi);overflow-wrap:anywhere}",
  ".vle-trk-pill{align-self:flex-start;font:600 8.5px/1.4 var(--vmono);letter-spacing:.3px;text-transform:uppercase;color:var(--vle-gold);background:color-mix(in srgb,var(--vle-gold) 12%,transparent);border:1px solid color-mix(in srgb,var(--vle-gold) 32%,transparent);border-radius:999px;padding:2px 8px;max-width:100%;overflow-wrap:break-word}",
  ".vle-trk-pill.done{color:var(--vi2);background:rgba(var(--vg-rgb),.1);border-color:rgba(var(--vg-rgb),.25)}",
  ".vle-trk-body{display:flex;flex-direction:column;gap:6px}",
  ".vle-trk-off{font-size:calc(11.5px * var(--vscale));line-height:1.45;color:var(--v-info);opacity:.92;overflow-wrap:anywhere}",
  ".vle-trk-hist{font-size:calc(11.5px * var(--vscale))}",
  ".vle-trk-hist summary{cursor:pointer;color:var(--vi2);opacity:.7;font:600 9px/1.4 var(--vmono);letter-spacing:.3px;text-transform:uppercase}",
  ".vle-trk-beat{margin-top:2px;color:var(--vi2);opacity:.85;line-height:1.45}",
  ".vle-trk-ctl{display:flex;gap:4px;justify-content:flex-end;margin-top:2px;padding-top:6px;border-top:1px solid rgba(var(--vg-rgb),.1)}",
  ".vle-os-link{font:600 9px/1.3 var(--vmono);color:var(--vle-gold);background:rgba(var(--vg-rgb),.12);border-radius:999px;padding:2px 7px;white-space:nowrap}",
  // off-screen subplots (the sim): a proper "meanwhile, elsewhere" card. A cool
  // info spine + faint wash reads as parallel/away-from-scene; the name leads in
  // serif with a small satellite glyph, the latest beat sits as a quiet gist.
  ".vle-os{position:relative;border:1px solid color-mix(in srgb,var(--v-info) 22%,transparent);border-left:3px solid color-mix(in srgb,var(--v-info) 60%,transparent);background:linear-gradient(100deg,color-mix(in srgb,var(--v-info) 7%,transparent),transparent 66%);border-radius:var(--vr2);padding:8px 11px;margin-bottom:6px}",
  ".vle-os::before{content:'\\2748';position:absolute;left:-1px;top:-1px;font-size:9px;color:color-mix(in srgb,var(--v-info) 80%,var(--vi));opacity:.5;transform:translate(-40%,-40%)}",
  ".vle-os--done{opacity:.6;border-left-color:rgba(var(--vg-rgb),.3);background:rgba(var(--vg-rgb),.03)}",
  ".vle-os--narr{border-left-color:var(--vle-gold-soft);background:rgba(var(--vg-rgb),.04)}",
  ".vle-os-top{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}",
  ".vle-os-n{font-family:var(--vserif);font-size:calc(14.5px * var(--vscale));color:var(--vi);font-weight:600}",
  ".vle-os-who{font:600 9px/1.3 var(--vmono);color:var(--v-info);background:color-mix(in srgb,var(--v-info) 12%,transparent);border-radius:999px;padding:2px 7px}",
  ".vle-os-w{font:600 9px/1.3 var(--vmono);opacity:.6}",
  ".vle-os-gist{font-family:var(--vserif);font-style:italic;font-size:calc(12.5px * var(--vscale));line-height:1.5;color:var(--vi2);opacity:.92;margin-top:3px}",
  ".vle-os-h{margin-top:5px;font-size:11px;opacity:.7}.vle-os-h summary{cursor:pointer;color:var(--vi2);font:600 9px/1.3 var(--vmono);text-transform:uppercase;letter-spacing:.4px}.vle-os-h div{padding:2px 0 0 10px;border-left:1px dotted rgba(var(--vg-rgb),.3);margin-left:2px;line-height:1.5}",
  // --- Establishing Shot hero (Chronicle > World) — a cinematic scene header:
  // day/time kicker, location as a serif title, present cast + tension as metadata.
  ".vle-hero{position:relative;padding:10px 13px;margin-bottom:10px;border:1px solid rgba(var(--vg-rgb),.2);border-radius:var(--vr2);background:linear-gradient(135deg,color-mix(in srgb,var(--v-neg) 10%,transparent),color-mix(in srgb,var(--vi) 4%,transparent) 60%);overflow:hidden}",
  ".vle-hero::before{content:'';position:absolute;inset:0;background:radial-gradient(120% 80% at 15% -10%,rgba(var(--vg-rgb),.08),transparent 60%);pointer-events:none}",
  ".vle-hero-kicker{display:flex;align-items:center;gap:6px;font:600 8.5px/1 var(--vmono);letter-spacing:1px;text-transform:uppercase;color:var(--vle-gold);opacity:.85;margin-bottom:5px}",
  ".vle-hero-sep{width:3px;height:3px;border-radius:50%;background:rgba(var(--vg-rgb),.5)}",
  ".vle-hero-title{font-family:var(--vserif);font-size:calc(18px * var(--vscale));line-height:1.15;color:var(--vi);margin:0 0 4px;font-weight:600;overflow-wrap:anywhere}",
  ".vle-hero-metas{display:flex;gap:14px;flex-wrap:wrap;margin-top:5px}",
  ".vle-hero-meta{font-size:calc(11.5px * var(--vscale));line-height:1.4}",
  ".vle-hero-label{font:600 8.5px/1.4 var(--vmono);letter-spacing:.4px;text-transform:uppercase;color:var(--vi2);opacity:.6;margin-right:4px}",
  ".vle-hero-val{font-family:var(--vserif);color:var(--vi)}",
  ".vle-hero-cast-name{font-weight:600}",
  ".vle-hero-tension{font-family:var(--vmono);font-weight:700;color:var(--vle-gold)}",
  ".vle-hero-tension.warm{color:var(--v-press)}.vle-hero-tension.hot{color:var(--v-neg)}",
  ".vle-hero-edit{flex:0 0 auto;margin-left:4px;border:none;background:transparent;color:var(--vle-gold);opacity:.5;cursor:pointer;font-size:calc(10px * var(--vscale));padding:2px 4px;transition:all .15s}",
  ".vle-hero-kicker:hover .vle-hero-edit,.vle-hero-edit:focus-visible{opacity:.75}",
  ".vle-hero-edit:hover{opacity:1;background:var(--vle-gold-soft)}",
  "html[data-vle-chrome='futuristic'] .vle-hero{border-radius:2px}html[data-vle-chrome='futuristic'] .vle-hero-title{font-family:var(--vmono);letter-spacing:.5px}",
  "html[data-vle-chrome='modern'] .vle-hero{border-radius:16px}",
  // --- Illuminated leaf (Chronicle > World arcs & threads) — one collapsible
  // card model shared by both tiers (Layout A). Thick gold rail + inner keyline
  // frame + corner-light wash; header toggles to reveal an inline beat rail,
  // meanwhile note, owned-thread chips (arcs), and CRUD actions. Threads are the
  // lesser tier via .is-thread (smaller title, thinner rail, arc-link kicker).
  ".vle-leaf-list{display:flex;flex-direction:column;gap:11px;margin-bottom:8px}",
  ".vle-leaf-list.threads{gap:9px}",
  ".vle-leaf{position:relative;border:1px solid rgba(var(--vg-rgb),.26);border-radius:6px;overflow:hidden;background:radial-gradient(120% 80% at 0% 0%,color-mix(in srgb,var(--vg) 10%,transparent),transparent 45%),linear-gradient(180deg,color-mix(in srgb,var(--vg) 6%,transparent),transparent 30%);transition:border-color .18s,box-shadow .18s}",
  ".vle-leaf:hover{border-color:rgba(var(--vg-rgb),.5);box-shadow:0 8px 26px rgba(0,0,0,.35)}",
  ".vle-leaf::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:linear-gradient(180deg,var(--vle-gold),color-mix(in srgb,var(--vle-gold) 55%,transparent));z-index:1}",
  ".vle-leaf::after{content:'';position:absolute;inset:5px;border:1px solid rgba(var(--vg-rgb),.14);border-radius:3px;pointer-events:none}",
  ".vle-leaf.is-thread::after{inset:4px}",
  ".vle-leaf.hot::before{background:linear-gradient(180deg,var(--v-neg-i),color-mix(in srgb,var(--v-neg) 70%,transparent))}",
  ".vle-leaf.done{opacity:.6}",
  ".vle-leaf.done::before{background:color-mix(in srgb,var(--vg-rgb) 45%,transparent);background:rgba(var(--vg-rgb),.35)}",
  // header (always visible; the whole strip toggles)
  ".vle-leaf-head{position:relative;display:flex;align-items:center;gap:11px;padding:13px 15px 13px 19px;cursor:pointer;user-select:none}",
  ".vle-leaf.is-thread .vle-leaf-head{padding:11px 13px 11px 17px}",
  ".vle-leaf-chev{flex:0 0 auto;font-size:9px;color:var(--vi2);opacity:.7;transition:color .15s}",
  ".vle-leaf.open .vle-leaf-chev,.vle-leaf-head:hover .vle-leaf-chev{color:var(--vle-gold);opacity:1}",
  ".vle-leaf-tw{flex:1;min-width:0}",
  ".vle-leaf-kicker{font:600 8.5px/1.4 var(--vmono);letter-spacing:.9px;text-transform:uppercase;color:var(--vi2);opacity:.7;margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".vle-leaf-kicker.arclink{color:var(--vle-gold);opacity:.95}",
  ".vle-leaf-title{font-family:var(--vserif);font-size:calc(16.5px * var(--vscale));line-height:1.2;color:var(--vi);font-weight:600;overflow-wrap:anywhere}",
  ".vle-leaf.is-thread .vle-leaf-title{font-size:calc(14.5px * var(--vscale))}",
  ".vle-leaf.done .vle-leaf-title{color:var(--vi2)}",
  ".vle-leaf-sub{font-family:var(--vserif);font-style:italic;font-size:calc(12px * var(--vscale));line-height:1.4;color:var(--vi2);opacity:.72;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".vle-leaf-cluster{flex:0 0 auto;display:flex;align-items:center;gap:6px}",
  ".vle-leaf-beats{font:600 9px/1.4 var(--vmono);letter-spacing:.4px;color:var(--vle-gold);background:color-mix(in srgb,var(--vle-gold) 12%,transparent);border:1px solid color-mix(in srgb,var(--vle-gold) 22%,transparent);border-radius:3px;padding:2px 8px}",
  // body (revealed on expand)
  ".vle-leaf-body{padding:0 15px 15px 19px}",
  ".vle-leaf.is-thread .vle-leaf-body{padding:0 13px 13px 17px}",
  ".vle-leaf-rule{height:1px;background:linear-gradient(90deg,rgba(var(--vg-rgb),.3),transparent);margin:0 0 12px}",
  ".vle-leaf-empty{font-family:var(--vserif);font-style:italic;font-size:calc(12px * var(--vscale));color:var(--vi2);opacity:.6}",
  // inline vertical beat rail
  ".vle-leaf-rail{position:relative}",
  ".vle-leaf-beat{position:relative;padding:0 0 12px 20px}",
  ".vle-leaf-beat:last-child{padding-bottom:0}",
  ".vle-leaf-beat::before{content:'';position:absolute;left:4px;top:9px;bottom:-3px;width:1px;background:linear-gradient(180deg,rgba(var(--vg-rgb),.3),rgba(var(--vg-rgb),.1))}",
  ".vle-leaf-beat:last-child::before{display:none}",
  ".vle-leaf-node{position:absolute;left:0;top:4px;width:9px;height:9px;border-radius:50%;background:var(--vsurf-1);border:1.5px solid color-mix(in srgb,var(--vle-gold) 55%,transparent)}",
  ".vle-leaf-beat.latest .vle-leaf-node{background:var(--vle-gold);border-color:var(--vle-gold);box-shadow:0 0 9px color-mix(in srgb,var(--vle-gold) 65%,transparent)}",
  ".vle-leaf.hot .vle-leaf-beat.latest .vle-leaf-node{background:var(--v-neg-i);border-color:var(--v-neg-i);box-shadow:0 0 9px color-mix(in srgb,var(--v-neg) 60%,transparent)}",
  ".vle-leaf-bmeta{font:600 8px/1.4 var(--vmono);letter-spacing:.9px;text-transform:uppercase;color:var(--vle-gold);margin-bottom:2px}",
  ".vle-leaf-btxt{font-family:var(--vserif);font-size:calc(13px * var(--vscale));line-height:1.5;color:var(--vi2)}",
  ".vle-leaf-beat.latest .vle-leaf-btxt{color:var(--vi)}",
  ".vle-leaf-more{cursor:pointer;font:600 9px/1.4 var(--vmono);letter-spacing:.4px;text-transform:uppercase;color:var(--vi2);opacity:.7;list-style:none;user-select:none;padding:0 0 10px 20px;position:relative}",
  ".vle-leaf-more::-webkit-details-marker{display:none}",
  ".vle-leaf-more::before{content:'\\25B8';display:inline-block;margin-right:6px;transition:transform .15s}",
  ".vle-leaf-rail details[open] .vle-leaf-more::before{transform:rotate(90deg)}",
  ".vle-leaf-more:hover{color:var(--vle-gold);opacity:1}",
  // meanwhile (off-screen reflection)
  ".vle-leaf-meanwhile{margin-top:10px;padding:8px 11px;border-left:2px solid color-mix(in srgb,var(--v-info) 60%,transparent);background:color-mix(in srgb,var(--v-info) 8%,transparent);border-radius:0 var(--vr1) var(--vr1) 0}",
  ".vle-leaf-mw-label{font:600 8px/1.4 var(--vmono);letter-spacing:.9px;text-transform:uppercase;color:var(--v-info);opacity:.9;margin-bottom:2px}",
  ".vle-leaf-mw-text{font-family:var(--vserif);font-style:italic;font-size:calc(12px * var(--vscale));line-height:1.45;color:var(--vi2);overflow-wrap:anywhere}",
  // owned-thread chips (arcs)
  ".vle-leaf-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}",
  ".vle-leaf-chip{display:inline-flex;align-items:center;gap:5px;font:500 9.5px/1.4 var(--vmono);color:var(--vi2);background:color-mix(in srgb,var(--vi) 5%,transparent);border:1px solid rgba(var(--vg-rgb),.22);border-radius:3px;padding:3px 5px 3px 9px;transition:border-color .15s}",
  ".vle-leaf-chip:hover{border-color:rgba(var(--vg-rgb),.45)}",
  ".vle-leaf-chip-lead{color:var(--vle-gold);opacity:.8}",
  ".vle-leaf-chip-x{width:16px;height:16px;border:none;background:transparent;color:var(--vi2);opacity:.6;cursor:pointer;font-size:12px;line-height:1;border-radius:50%}",
  ".vle-leaf-chip-x:hover{color:var(--v-neg-i);opacity:1}",
  ".vle-leaf-chip.more{color:var(--vi2);opacity:.6;padding:3px 9px}",
  ".vle-leaf-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}",
  "html[data-vle-chrome='futuristic'] .vle-leaf{border-radius:2px}html[data-vle-chrome='futuristic'] .vle-leaf::after{border-radius:0}",
  "html[data-vle-chrome='modern'] .vle-leaf{border-radius:14px}html[data-vle-chrome='modern'] .vle-leaf-beats{border-radius:999px}",
  // --- Elsewhere Feed (Director > Off-screen) — a vertical timeline of
  // "meanwhile" moments. Each item is a collapsible card: kicker + title + status
  // in the header, an expandable body with the latest beat, cast, and actions.
  ".vle-feed{display:flex;flex-direction:column;gap:0;border:1px solid rgba(var(--vg-rgb),.16);border-radius:var(--vr2);overflow:hidden}",
  ".vle-feed-item{position:relative;padding:14px 16px;border-bottom:1px solid rgba(var(--vg-rgb),.12);transition:background .18s}",
  ".vle-feed-item:last-child{border-bottom:none}",
  ".vle-feed-item:hover{background:color-mix(in srgb,var(--vi) 3%,transparent)}",
  ".vle-feed-item--expanded{background:linear-gradient(135deg,color-mix(in srgb,var(--v-info) 7%,transparent),transparent 70%)}",
  ".vle-feed-item--done{opacity:.6}",
  ".vle-feed-item--narrated{opacity:.85}",
  ".vle-feed-header{position:relative;display:grid;grid-template-columns:1fr auto auto;grid-template-areas:'kicker status toggle' 'title status toggle' 'meta status toggle';align-items:center;column-gap:10px}",
  ".vle-feed-kicker{grid-area:kicker;font:600 9px/1.4 var(--vmono);letter-spacing:.9px;text-transform:uppercase;color:var(--vle-gold);opacity:.8;margin-bottom:3px}",
  ".vle-feed-item--narrated .vle-feed-kicker{color:var(--v-info)}",
  ".vle-feed-title{grid-area:title;font-family:var(--vserif);font-size:calc(16px * var(--vscale));line-height:1.2;color:var(--vi);margin:0 0 3px;font-weight:600;overflow-wrap:anywhere}",
  ".vle-feed-meta{grid-area:meta;font:500 10px/1.4 var(--vmono);color:var(--vi2);opacity:.6}",
  ".vle-feed-status{grid-area:status;align-self:start;font:700 8.5px/1.4 var(--vmono);letter-spacing:.5px;text-transform:uppercase;padding:3px 8px;border-radius:999px;white-space:nowrap}",
  ".vle-feed-status--active{color:var(--vle-gold);background:color-mix(in srgb,var(--vle-gold) 14%,transparent);border:1px solid color-mix(in srgb,var(--vle-gold) 30%,transparent)}",
  ".vle-feed-status--ripe{color:var(--v-pos);background:color-mix(in srgb,var(--v-pos) 16%,transparent);border:1px solid color-mix(in srgb,var(--v-pos) 40%,transparent)}",
  ".vle-feed-status--done{color:var(--vi2);background:rgba(var(--vg-rgb),.1);border:1px solid rgba(var(--vg-rgb),.25)}",
  ".vle-feed-status--auto{color:var(--v-info);background:color-mix(in srgb,var(--v-info) 14%,transparent);border:1px solid color-mix(in srgb,var(--v-info) 32%,transparent)}",
  ".vle-feed-toggle{grid-area:toggle;align-self:start;flex:0 0 auto;border:1px solid rgba(var(--vg-rgb),.2);background:transparent;color:var(--vi2);border-radius:var(--vr1);padding:3px 7px;cursor:pointer;font-size:11px;line-height:1;transition:all .15s}",
  ".vle-feed-toggle:hover{color:var(--vle-gold);border-color:color-mix(in srgb,var(--vle-gold) 40%,transparent);background:var(--vle-gold-soft)}",
  ".vle-feed-who{font:600 9px/1.3 var(--vmono);color:var(--v-info);background:color-mix(in srgb,var(--v-info) 12%,transparent);border-radius:999px;padding:2px 7px;display:inline-block;margin-top:4px}",
  ".vle-feed-body{margin-top:12px;display:flex;flex-direction:column;gap:12px}",
  ".vle-feed-beat{padding:10px 12px;border-left:3px solid color-mix(in srgb,var(--v-pos) 55%,transparent);background:color-mix(in srgb,var(--vi) 4%,transparent);border-radius:var(--vr1)}",
  ".vle-feed-beat-label{font:600 8.5px/1.4 var(--vmono);letter-spacing:.6px;text-transform:uppercase;color:var(--v-pos);opacity:.85;margin-bottom:5px}",
  ".vle-feed-beat-text{font-family:var(--vserif);font-size:calc(13.5px * var(--vscale));line-height:1.55;color:var(--vi)}",
  ".vle-feed-hist{border-left:3px solid rgba(var(--vg-rgb),.2);padding-left:10px}",
  ".vle-feed-hist-toggle{cursor:pointer;font:600 9px/1.4 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--vi2);opacity:.7;list-style:none;user-select:none}",
  ".vle-feed-hist-toggle::-webkit-details-marker{display:none}",
  ".vle-feed-hist-toggle::before{content:'\\25B8';display:inline-block;margin-right:6px;transition:transform .15s}",
  ".vle-feed-hist[open] .vle-feed-hist-toggle::before{transform:rotate(90deg)}",
  ".vle-feed-hist-toggle:hover{color:var(--vle-gold);opacity:1}",
  ".vle-feed-hist-list{margin-top:8px;display:flex;flex-direction:column;gap:6px}",
  ".vle-feed-hist-item{font-family:var(--vserif);font-size:calc(12.5px * var(--vscale));line-height:1.5;color:var(--vi2);padding:2px 0}",
  ".vle-feed-hist-n{font:600 10px/1 var(--vmono);color:var(--vle-gold);opacity:.7;margin-right:4px}",
  ".vle-feed-details{display:flex;gap:20px;flex-wrap:wrap}",
  ".vle-feed-detail{font-size:calc(12px * var(--vscale));line-height:1.4}",
  ".vle-feed-label{font:600 9px/1.4 var(--vmono);letter-spacing:.4px;text-transform:uppercase;color:var(--vi2);opacity:.6;margin-right:5px}",
  ".vle-feed-val{color:var(--vi)}",
  ".vle-feed-linked{color:var(--vle-gold)}",
  ".vle-feed-actions{display:flex;gap:7px;flex-wrap:wrap}",
  ".vle-btn{font:700 9px/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;padding:7px 13px;border-radius:var(--vr1);cursor:pointer;border:1px solid transparent;transition:all .15s}",
  ".vle-btn--primary{background:var(--v-pos);color:var(--v-bg-deep,#181310);border-color:var(--v-pos)}",
  ".vle-btn--primary:hover{filter:brightness(1.1)}",
  ".vle-btn--secondary{background:transparent;color:var(--vi2);border-color:rgba(var(--vg-rgb),.25)}",
  ".vle-btn--secondary:hover{color:var(--vle-gold);border-color:color-mix(in srgb,var(--vle-gold) 45%,transparent)}",
  ".vle-btn--danger{background:transparent;color:var(--v-neg-i);border-color:color-mix(in srgb,var(--v-neg) 35%,transparent)}",
  ".vle-btn--danger:hover{background:color-mix(in srgb,var(--v-neg) 12%,transparent)}",
  "html[data-vle-chrome='futuristic'] .vle-feed{border-radius:2px}html[data-vle-chrome='futuristic'] .vle-btn,html[data-vle-chrome='futuristic'] .vle-feed-status{border-radius:2px}",
  "html[data-vle-chrome='modern'] .vle-feed{border-radius:14px}html[data-vle-chrome='modern'] .vle-feed-status{border-radius:999px}",
  ".vle-mem{display:flex;gap:7px;font-size:12px;padding:4px 0;line-height:1.45;align-items:baseline}",
  // per-type record identity: a colored left spine so Knowledge/Secrets/Scars/
  // Codex read as different kinds down a long list (not one flat texture).
  ".vle-mem--know,.vle-mem--secret,.vle-mem--scar,.vle-mem--codex{padding-left:13px;border-left:3px solid var(--vle-gold-soft)}",
  ".vle-mem--know{border-left-color:var(--v-info)}",
  ".vle-mem--secret{border-left-color:var(--v-neg)}",
  ".vle-mem--scar{border-left-color:var(--v-warn)}",
  ".vle-mem--codex{border-left-color:var(--vg)}",
  ".vle-mem-t{flex:1;min-width:0}",
  ".vle-mem-ctl{flex:none;display:inline-flex;gap:3px;align-self:flex-start}",
  ".vle-mem-tier{flex:none;font:600 9px/1 var(--vmono);text-transform:uppercase;letter-spacing:.5px;padding:2px 6px;border-radius:var(--vr1);opacity:.85}",
  ".vle-mem-tier.t-turn{color:#8c8478;border:1px solid rgba(140,132,120,.4)}",
  ".vle-mem-tier.t-chapter{color:var(--v-info);border:1px solid color-mix(in srgb,var(--v-info) 40%,transparent)}",
  ".vle-mem-tier.t-arc{color:var(--vle-gold);border:1px solid rgba(var(--vg-rgb),.4)}",
  // knowledge epistemic chips (reliability + truth)
  ".vle-krel{display:inline-block;font:600 9px/1 var(--vmono);text-transform:uppercase;letter-spacing:.4px;padding:2px 6px;border-radius:var(--vr1);margin-right:5px;vertical-align:middle;opacity:.9}",
  ".vle-krel-believes{color:#c8a24e;border:1px solid rgba(200,162,78,.4)}",
  ".vle-krel-suspects{color:var(--v-warn);border:1px solid color-mix(in srgb,var(--v-warn) 40%,transparent)}",
  ".vle-krel-wrong{color:var(--v-neg-i);border:1px solid color-mix(in srgb,var(--v-neg) 50%,transparent);background:color-mix(in srgb,var(--v-neg) 8%,transparent)}",
  ".vle-krel-unaware{color:#8c8478;border:1px solid rgba(140,132,120,.4)}",
  ".vle-kfalse{display:inline-block;font:600 9px/1 var(--vmono);color:var(--v-neg-i);margin-right:5px;opacity:.85}",
  // G2 dramatic-irony: a false belief gets a faint rose wash + an italic caption
  ".vle-mem--know.is-false{background:color-mix(in srgb,var(--v-neg) 7%,transparent)}",
  ".vle-kirony{display:block;margin-top:3px;font:italic 400 calc(10.5px * var(--vscale))/1.3 var(--vserif);color:var(--v-neg-i);opacity:.8}",
  // G3 secret left medallion: an avatar-sized seal at the row's left edge; intact
  // rose for sealed, dashed mint for revealed. Replaces the top-right corner pip
  // on the secrets surface (the generic .v-orn--seal pip is hidden here).
  ".vle-mem--secret{position:relative;padding-left:38px}",
  ".vle-mem--secret.v-orn--seal::after{display:none}",
  ".vle-mem--secret::before{content:'\\2680';position:absolute;left:8px;top:50%;transform:translateY(-50%);width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:13px;color:var(--v-neg-i);border:1.5px solid color-mix(in srgb,var(--v-neg) 60%,transparent);background:color-mix(in srgb,var(--v-neg) 12%,var(--vsurf-1));box-shadow:0 0 6px color-mix(in srgb,var(--v-neg) 25%,transparent)}",
  ".vle-mem--secret.is-broken::before{content:'\\2727';color:var(--v-pos-i);border:1.5px dashed color-mix(in srgb,var(--v-pos) 55%,transparent);background:transparent;box-shadow:none}",
  // relations
  ".vle-rel-grid{display:flex;flex-direction:column;gap:7px}",
  ".vle-rel-card{position:relative;border:1px solid var(--vle-gold-soft);border-radius:9px;padding:8px 10px;background:rgba(22,20,16,.4)}",
  ".vle-rel-top{display:flex;justify-content:space-between;align-items:center;gap:8px}",
  ".vle-rel-pair{font-family:var(--vserif);font-size:calc(15px * var(--vscale));font-weight:600;letter-spacing:.2px}",
  // elegant spaced connective between two names (A <-> B / A -> B). A hairline
  // serif glyph in the accent, generous side spacing, gently raised.
  ".vle-rel-arrow{font-family:var(--vserif);font-weight:400;color:var(--vg);opacity:.7;margin:0 .5em;font-size:.92em;vertical-align:.02em}",
  // category chips shown ONCE at the card foot (union of both directions)
  ".vle-rel-catfoot{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}",
  ".vle-rel-onesided{margin-top:7px;font:600 9px/1.4 var(--vmono);opacity:.5;font-style:italic}",
  ".vle-cat{font:600 9px/1 var(--vmono);text-transform:uppercase;letter-spacing:.5px;padding:2px 6px;border-radius:var(--vr1);color:var(--c);border:1px solid color-mix(in srgb,var(--c) 45%,transparent)}",
  ".vle-bars{display:flex;flex-direction:column;gap:3px;margin-top:4px}",
  ".vle-bar{display:flex;align-items:center;gap:6px}",
  ".vle-bar-l{flex:none;width:30px;font:600 9px/1 var(--vmono);opacity:.6}",
  ".vle-bar-t{position:relative;flex:1;height:5px;border-radius:3px;background:rgba(255,255,255,.06)}",
  ".vle-bar-mid{position:absolute;left:50%;top:-1px;width:1px;height:7px;background:rgba(255,255,255,.2)}",
  ".vle-bar-f{position:absolute;top:0;height:5px;border-radius:3px}",
  ".vle-bar-f.pos{background:var(--v-pos)}.vle-bar-f.neg{background:var(--v-neg)}",
  ".vle-bar-v{flex:none;width:30px;text-align:right;font:600 9px/1 var(--vmono)}",
  ".vle-bar-v.pos{color:var(--v-pos-i)}.vle-bar-v.neg{color:var(--v-neg-i)}",
  // ---- shared BOND CARD (relations refactor): one renderer, three densities ----
  // Outer class stays .vle-rel-card so the card-shape system (data-shape-bonds)
  // still applies. --spine carries the dominant-category warmth color.
  ".vle-bc{position:relative;padding-left:calc(10px + 4px)}",
  ".vle-bc-spine{position:absolute;left:0;top:0;bottom:0;width:4px;border-radius:var(--vr1) 0 0 var(--vr1);background:var(--spine,var(--vle-gold-soft));opacity:.85}",
  ".vle-bc-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
  ".vle-bc-pair{font-family:var(--vserif);font-size:calc(15px * var(--vscale));font-weight:600;letter-spacing:.2px}",
  ".vle-bc-reads{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap}",
  ".vle-bc-read{font:600 var(--vt-eyebrow)/1 var(--vmono);letter-spacing:.4px;text-transform:uppercase;color:var(--vi2);padding:2px 7px;border-radius:var(--vr1);border:1px solid rgba(var(--vg-rgb),.22)}",
  ".vle-bc-read b{color:var(--vi);font-weight:700;margin-right:3px}",
  ".vle-bc-read--a{border-left:3px solid var(--v-pos)}.vle-bc-read--b{border-left:3px solid var(--v-info)}",
  ".vle-bc-asym{font:600 var(--vt-eyebrow)/1 var(--vmono);letter-spacing:.4px;text-transform:uppercase;color:var(--v-warn);opacity:.85}",
  ".vle-bc-verdict{margin-left:auto;font:600 var(--vt-eyebrow)/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--vg);opacity:.8}",
  ".vle-bc .vle-rel-ctl{margin-left:auto}",
  // meters: one shared center-zero track per axis, a dot per direction, a
  // connector whose length reads as the asymmetry between the two directions.
  ".vle-bc-meters{display:flex;flex-direction:column;gap:calc(9px * var(--vscale));margin-top:8px}",
  ".vle-bc-axis{display:flex;align-items:center;gap:8px}",
  ".vle-bc-axl{flex:none;width:64px;font:600 var(--vt-eyebrow)/1 var(--vmono);letter-spacing:.6px;text-transform:uppercase;opacity:.55}",
  ".vle-bc-axl--aff{color:var(--v-pos-i)}.vle-bc-axl--trust{color:var(--v-info)}",
  ".vle-bc-track{position:relative;flex:1;height:6px;border-radius:4px;background:rgba(255,255,255,.06)}",
  ".vle-bc-zero{position:absolute;left:50%;top:-3px;bottom:-3px;width:1px;background:rgba(255,255,255,.24)}",
  ".vle-bc-conn{position:absolute;top:1px;height:4px;border-radius:3px;opacity:.5}",
  ".vle-bc-conn--aff{background:var(--v-pos)}.vle-bc-conn--trust{background:var(--v-info)}",
  // dots sit ON the track; translate -50% centers them over their % position.
  ".vle-bc-dot{position:absolute;top:50%;width:12px;height:12px;margin-left:-6px;transform:translateY(-50%);border-radius:50%;box-sizing:border-box;border:1.5px solid var(--vsurf-1);cursor:default}",
  ".vle-bc-dot--a{z-index:1}.vle-bc-dot--b{z-index:2}", // b on top so a full overlap still shows two rings
  ".vle-bc-dot--aff.vle-bc-dot--a{background:color-mix(in srgb,var(--v-pos) 70%,transparent)}.vle-bc-dot--aff.vle-bc-dot--b{background:var(--v-pos-i)}",
  ".vle-bc-dot--trust.vle-bc-dot--a{background:color-mix(in srgb,var(--v-info) 70%,transparent)}.vle-bc-dot--trust.vle-bc-dot--b{background:var(--v-info)}",
  // inline value chip (full density) floats just above its dot
  ".vle-bc-val{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);font:600 8.5px/1 var(--vmono);white-space:nowrap;color:var(--vi2);opacity:.8}",
  ".vle-bc-dot--b .vle-bc-val{top:14px;bottom:auto}", // second value drops below to avoid collision
  ".vle-bc-labels{margin-top:8px;font-family:var(--vserif);font-style:italic;font-size:calc(12.5px * var(--vscale));color:var(--vi2);opacity:.8;line-height:1.4}",
  // strip form: a single dense row (pair + two-axis dots + verdict)
  ".vle-bc--strip{display:flex;align-items:center;gap:8px;padding:5px 10px 5px 14px}",
  ".vle-bc--strip .vle-bc-pair{font-size:calc(13.5px * var(--vscale))}",
  ".vle-bc-dots{display:inline-flex;gap:5px;margin-left:4px}",
  ".vle-bc--strip .vle-bc-verdict{margin-left:auto}",
  ".vle-bc--full{padding-top:2px}",
  // full-density value chips need vertical room above/below the track
  ".vle-bc--full .vle-bc-meters{gap:calc(20px * var(--vscale));margin-top:14px}",
  // error boundary
  ".vlm-comp-error{padding:8px;font-size:11px;color:#e09090;border:1px solid rgba(201,106,106,.3);border-radius:8px;background:rgba(201,106,106,.08)}",
  ".vlm-comp-error span{opacity:.7;font-size:10px}",
  // ---- relationship graph ----
  ".vlg-wrap{display:flex;flex-direction:column;gap:8px}",
  ".vlg-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}",
  ".vlg-legend{display:flex;flex-wrap:wrap;gap:4px}",
  ".vlg-leg{display:inline-flex;align-items:center;gap:4px;font:600 9px/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--vi2);background:rgba(var(--vg-rgb),.08);border:1px solid var(--vle-gold-soft);border-radius:20px;padding:3px 9px;cursor:pointer;opacity:.6;transition:opacity .15s,background .15s}",
  ".vlg-leg:hover{opacity:.92}.vlg-leg.on{opacity:1;background:rgba(var(--vg-rgb),.2);border-color:rgba(var(--vg-rgb),.45)}",
  ".vlg-leg-dot{width:8px;height:8px;border-radius:50%;box-shadow:0 0 5px currentColor}",
  ".vlg-tools{display:flex;gap:4px}",
  ".vlg-tool{min-width:24px;height:24px;display:grid;place-items:center;font:600 13px/1 var(--vmono);color:var(--vle-gold);background:rgba(var(--vg-rgb),.1);border:1px solid rgba(var(--vg-rgb),.24);border-radius:6px;cursor:pointer}",
  ".vlg-tool:hover{background:rgba(var(--vg-rgb),.22)}.vlg-tool.wide{padding:0 9px;font-size:9px;letter-spacing:.5px;text-transform:uppercase}",
  ".vlg-tool.wide.on{background:rgba(var(--vg-rgb),.26);border-color:rgba(var(--vg-rgb),.5)}",
  ".vlg-stage{position:relative;border:1px solid var(--vle-gold-soft);border-radius:14px;overflow:hidden;background:radial-gradient(130% 100% at 50% 0%,rgba(var(--vg-rgb),.06),transparent 55%),linear-gradient(168deg,rgba(26,22,16,.97),rgba(15,13,10,.99));box-shadow:inset 0 1px 40px rgba(0,0,0,.5),0 2px 18px rgba(0,0,0,.35)}",
  ".vlg-svg{display:block;width:100%;height:auto;min-height:360px;max-height:64vh;cursor:grab;touch-action:none}",
  ".vlg-svg:active{cursor:grabbing}",
  "[data-graph-pan]{transition:transform .09s ease-out}",
  // hulls
  ".vlg-hull-fill{opacity:.08;transition:opacity .3s;pointer-events:none}",
  ".vlg-wrap:hover .vlg-hull-fill{opacity:.12}",
  ".vlg-hull-label{font:600 13px/1 var(--vserif);letter-spacing:2px;text-transform:uppercase;opacity:.5;pointer-events:none}",
  "[data-factions='off'] .vlg-hulls{display:none}",
  // edges
  ".vlg-edge-line{opacity:.6;transition:opacity .2s,stroke-width .2s;filter:drop-shadow(0 0 2px rgba(0,0,0,.55))}",
  ".vlg-edge:hover .vlg-edge-line{opacity:1;stroke-width:5.5}",
  ".vlg-edge-hit{cursor:pointer}",
  // nodes
  ".vlg-node{cursor:grab}.vlg-node.vlg-dragging{cursor:grabbing}",
  ".vlg-node-glow{fill:rgba(var(--vg-rgb),0);opacity:0;transition:opacity .25s}",
  ".vlg-node-c{fill:url(#vlgNode);stroke:#8c8478;stroke-width:2;transition:stroke .2s,stroke-width .2s}",
  ".vlg-node-i{fill:var(--vi);font:600 12px/1 var(--vserif);letter-spacing:.5px;pointer-events:none;user-select:none}",
  ".vlg-node-l{fill:var(--vi2);font:600 11px/1 var(--vmono);opacity:0;transition:opacity .2s;pointer-events:none;paint-order:stroke;stroke:rgba(12,10,8,.92);stroke-width:3.5px}",
  ".vlg-node.is-present .vlg-node-c{fill:#3a2f16;stroke:var(--vle-gold);stroke-width:2.6;filter:url(#vlgGlow)}",
  ".vlg-node.is-present .vlg-node-glow{fill:rgba(var(--vg-rgb),.3);opacity:.95}",
  ".vlg-node.is-present .vlg-node-l{opacity:1;fill:var(--vi)}",
  ".vlg-node.is-user .vlg-node-c{stroke:#e6c07a;stroke-width:3;stroke-dasharray:3 2}",
  ".vlg-node.is-mention .vlg-node-c{opacity:.5;stroke-dasharray:2 3}",
  ".vlg-node:hover .vlg-node-l{opacity:1}.vlg-node:hover .vlg-node-glow{opacity:.85;fill:rgba(var(--vg-rgb),.34)}",
  ".vlg-node:hover .vlg-node-c{stroke:var(--vle-gold);stroke-width:3}",
  // focus dimming
  ".vlg-focusing .vlg-edge.vlg-dim .vlg-edge-line{opacity:.08}",
  ".vlg-focusing .vlg-node.vlg-dim{opacity:.2}",
  ".vlg-focusing .vlg-node.vlg-hot .vlg-node-l{opacity:1}",
  ".vlg-node.vlg-hot .vlg-node-c{stroke:var(--vle-gold);stroke-width:3.2}",
  // tooltip
  ".vlg-tip{position:absolute;pointer-events:none;z-index:5;max-width:220px;background:rgba(18,15,11,.97);border:1px solid rgba(var(--vg-rgb),.34);border-radius:9px;padding:7px 11px;font:500 11px/1.5 var(--vmono);color:#d8c9a8;box-shadow:0 8px 26px rgba(0,0,0,.55)}",
  ".vlg-tip b{color:var(--vi);font-family:var(--vserif);font-size:14px;letter-spacing:.5px}.vlg-tip span{opacity:.6}",
  ".vlg-hint{font-size:9px;line-height:1.5;opacity:.45;text-align:center;letter-spacing:.3px}",
  // ---- floating window ----
  ".vlf{position:fixed;z-index:9999;opacity:0;transform:translateY(8px) scale(.985);transition:opacity .22s ease,transform .22s cubic-bezier(.2,.8,.2,1);pointer-events:none;font-family:var(--vserif)}",
  ".vlf.is-open{opacity:1;transform:none;pointer-events:auto}",
  ".vlf-frame{position:absolute;inset:0;display:flex;flex-direction:column;border-radius:var(--vradius,18px);overflow:hidden;color:var(--vle-ink);background:transparent;border:var(--vborder,1px) solid rgba(var(--vg-rgb),calc(.5 * var(--vai,1)));box-shadow:0 28px 80px rgba(0,0,0,.62),0 2px 0 rgba(var(--vg-rgb),.14),inset 0 0 0 1px rgba(var(--vg-rgb),calc(.1 * var(--vai,1))),inset 0 1px 60px rgba(var(--vg-rgb),.05);backdrop-filter:blur(var(--vblur,8px))}",
  ".vlf-tex{position:absolute;inset:0;z-index:0;background:var(--vglass,linear-gradient(168deg,rgba(26,22,16,.97),rgba(15,13,10,.985)));opacity:var(--vopacity,1);pointer-events:none}",
  ".vlf-scrim{position:absolute;inset:0;z-index:0;background-image:var(--vtexture,none);background-size:140px,16px 16px,16px 16px;opacity:.5;mix-blend-mode:overlay;pointer-events:none}",
  ".vlf-bar,.vlf-body,.vlf-grip{position:relative;z-index:1}",
  "[data-vle-chrome='illuminated'] .vlf-frame::before{content:'';position:absolute;z-index:1;inset:6px;border-radius:calc(var(--vradius,18px) - 5px);border:1px solid rgba(var(--vg-rgb),calc(.2 * var(--vai,1)));pointer-events:none}",
  "[data-vle-chrome='illuminated'] .vlf-frame::after{content:'';position:absolute;left:0;right:0;top:0;height:150px;background:radial-gradient(130% 90% at 50% -25%,rgba(var(--vg-rgb),.14),transparent 70%);pointer-events:none}",
  ".vlf-bar{position:relative;display:flex;align-items:center;gap:10px;padding:calc(13px * var(--vscale)) calc(16px * var(--vscale)) calc(11px * var(--vscale));cursor:grab;user-select:none;touch-action:none;border-bottom:1px solid rgba(var(--vg-rgb),.22);background:linear-gradient(180deg,rgba(var(--vg-rgb),.09),transparent)}",
  ".vlf-bar:active{cursor:grabbing}",
  ".vlf-mark{color:var(--vle-gold);font-size:calc(16px * var(--vscale));text-shadow:0 0 10px rgba(var(--vg-rgb),.55)}",
  ".vlf-title{font-family:var(--vserif);font-size:calc(20px * var(--vscale));letter-spacing:3px;text-transform:uppercase;color:var(--vi)}",
  ".vlf-actions{margin-left:auto;display:flex;gap:5px}",
  ".vlf-act{font:600 calc(10px * var(--vscale))/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--vi2);background:rgba(var(--vg-rgb),.1);border:1px solid rgba(var(--vg-rgb),.26);border-radius:8px;padding:6px 10px;cursor:pointer;transition:background .15s}",
  ".vlf-act:hover{background:rgba(var(--vg-rgb),.26);color:var(--vle-gold)}",
  ".vlf-x{width:calc(26px * var(--vscale));height:calc(26px * var(--vscale));display:grid;place-items:center;border-radius:8px;color:var(--vi2);background:transparent;border:1px solid transparent;cursor:pointer;font-size:calc(14px * var(--vscale))}",
  ".vlf-x:hover{color:#e09090;border-color:rgba(201,106,106,.4);background:rgba(201,106,106,.1)}",
  ".vlf-body{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;padding:0;scrollbar-width:thin;scrollbar-color:rgba(var(--vg-rgb),.4) transparent}",
  ".vlf-body::-webkit-scrollbar{width:9px}.vlf-body::-webkit-scrollbar-thumb{background:rgba(var(--vg-rgb),.3);border-radius:5px;border:2px solid transparent;background-clip:padding-box}",
  ".vlf-grip{position:absolute;right:3px;bottom:3px;width:18px;height:18px;cursor:nwse-resize;touch-action:none;background:linear-gradient(135deg,transparent 45%,rgba(var(--vg-rgb),.5) 45%,rgba(var(--vg-rgb),.5) 55%,transparent 55%,transparent 70%,rgba(var(--vg-rgb),.5) 70%,rgba(var(--vg-rgb),.5) 80%,transparent 80%);border-bottom-right-radius:12px}",
  // persistent launcher tab
  ".vlf-launch{position:fixed;right:0;top:var(--vlf-lpos,46%);z-index:9998;display:flex;align-items:center;gap:6px;padding:11px 11px 11px 13px;border-radius:13px 0 0 13px;cursor:pointer;color:var(--vi);font-family:var(--vserif);letter-spacing:1.5px;text-transform:uppercase;font-size:13px;background:var(--vglass,linear-gradient(180deg,rgba(34,28,19,.97),rgba(20,17,12,.98)));border:1px solid rgba(var(--vg-rgb),.5);border-right:none;box-shadow:-5px 4px 22px rgba(0,0,0,.5);transition:transform .18s,box-shadow .18s;writing-mode:vertical-rl}",
  ".vlf-launch:hover{transform:translateX(-3px);box-shadow:-7px 4px 24px rgba(0,0,0,.55)}",
  ".vlf-launch.is-hidden{display:none}",
  ".vlf-launch-mark{color:var(--vle-gold);font-size:14px;writing-mode:horizontal-tb;text-shadow:0 0 8px rgba(var(--vg-rgb),.5)}",
  ".vlf-launch-t{opacity:.85}",
  // ---- window chrome modes (orthogonal to skin; default = illuminated above) ----
  // MODERN — flat, quiet, sans title, no manuscript ornament
  "[data-vle-chrome='modern'] .vlf-frame{border-color:rgba(var(--vg-rgb),calc(.28 * var(--vai,1)));box-shadow:0 18px 50px rgba(0,0,0,.5),inset 0 0 0 1px rgba(var(--vg-rgb),.05)}",
  "[data-vle-chrome='modern'] .vlf-bar{background:rgba(var(--vg-rgb),.05);border-bottom-color:rgba(var(--vg-rgb),.14)}",
  "[data-vle-chrome='modern'] .vlf-title{font-family:var(--vserif);font-size:calc(16px * var(--vscale));letter-spacing:.5px;text-transform:none}",
  "[data-vle-chrome='modern'] .vlf-mark{text-shadow:none}",
  "[data-vle-chrome='modern'] .vlf-grip{background:none;border:none;right:5px;bottom:5px;width:12px;height:12px;border-right:2px solid rgba(var(--vg-rgb),.4);border-bottom:2px solid rgba(var(--vg-rgb),.4);border-bottom-right-radius:4px}",
  // FUTURISTIC — sharp, accent edge-glow, mono HUD title, corner ticks
  "[data-vle-chrome='futuristic'] .vlf-frame{border-color:rgba(var(--vg-rgb),calc(.7 * var(--vai,1)));box-shadow:0 0 0 1px rgba(var(--vg-rgb),.25),0 0 22px rgba(var(--vg-rgb),.22),0 18px 50px rgba(0,0,0,.6)}",
  "[data-vle-chrome='futuristic'] .vlf-bar{background:linear-gradient(180deg,rgba(var(--vg-rgb),.16),transparent);border-bottom-color:rgba(var(--vg-rgb),.45)}",
  "[data-vle-chrome='futuristic'] .vlf-title{font-family:var(--vmono);font-size:calc(14px * var(--vscale));font-weight:600;letter-spacing:2px;text-transform:uppercase}",
  "[data-vle-chrome='futuristic'] .vlf-frame::before{content:'';position:absolute;z-index:1;inset:4px;border-radius:2px;border:1px solid rgba(var(--vg-rgb),.18);pointer-events:none}",
  "[data-vle-chrome='futuristic'] .vlf-frame::after{content:'';position:absolute;z-index:1;inset:0;pointer-events:none;background:linear-gradient(90deg,var(--vg) 0 14px,transparent 14px) 0 0/100% 2px no-repeat,linear-gradient(90deg,var(--vg) 0 14px,transparent 14px) 100% 100%/100% 2px no-repeat;opacity:.55}",
  "[data-vle-chrome='futuristic'] .vlf-grip{background:none;border:none;right:4px;bottom:4px;width:12px;height:12px;border-right:2px solid var(--vg);border-bottom:2px solid var(--vg);opacity:.7;border-radius:0}",
  "[data-vle-chrome='futuristic'] .vlf-launch{border-radius:0;border-width:1px 0 1px 1px}",
  // BLOOM — soft pastel garden: pillowy rounded frame, blush glow, lace edge, script title
  "[data-vle-chrome='bloom'] .vlf-frame{border-radius:calc(var(--vradius) + 8px);border-color:color-mix(in srgb,var(--vg) 40%,transparent);box-shadow:0 10px 40px rgba(180,120,150,.28),0 0 0 6px rgba(var(--vg-rgb),.06),inset 0 0 0 1px rgba(255,255,255,.35)}",
  "[data-vle-chrome='bloom'] .vlf-bar{background:linear-gradient(180deg,rgba(var(--vg-rgb),.14),transparent);border-bottom:1px solid color-mix(in srgb,var(--vg) 22%,transparent)}",
  "[data-vle-chrome='bloom'] .vlf-title{font-family:var(--vserif);font-style:italic;font-weight:600;font-size:calc(18px * var(--vscale));letter-spacing:.5px;text-transform:none}",
  // scalloped-lace inner edge (dotted pastel arcs) hugging the frame
  "[data-vle-chrome='bloom'] .vlf-frame::before{content:'';position:absolute;z-index:1;inset:7px;border-radius:calc(var(--vradius) + 2px);border:1.5px dotted color-mix(in srgb,var(--vg) 35%,transparent);pointer-events:none}",
  "[data-vle-chrome='bloom'] .vlf-grip{background:none;border:none;right:7px;bottom:7px;width:12px;height:12px;border-right:2px solid color-mix(in srgb,var(--vg) 55%,transparent);border-bottom:2px solid color-mix(in srgb,var(--vg) 55%,transparent);border-radius:0 0 8px 0}",
  "[data-vle-chrome='bloom'] .vlf-launch{border-radius:16px 0 0 16px}",
  // EMBER (float frame) - starlit void: a rounded aurora frame with a soft
  // pastel edge-glow and an ethereal italic title. Distinct from every other
  // chrome: no hard brackets (futuristic), no parchment (fantasy), no flat
  // sans (modern), no lace (bloom). Its signature is glowing softness over
  // a deep indigo field; the fireflies/bubbles live on the body below.
  "[data-vle-chrome='ember'] .vlf-frame{border-radius:calc(var(--vradius) + 10px);border-color:color-mix(in srgb,var(--vg) 38%,transparent);box-shadow:0 0 24px rgba(var(--vg-rgb),.18),0 0 60px rgba(var(--vg2-rgb),.14),0 18px 60px rgba(8,8,24,.6),inset 0 0 0 1px rgba(255,255,255,.06)}",
  "[data-vle-chrome='ember'] .vlf-bar{background:linear-gradient(180deg,rgba(var(--vg-rgb),.1),transparent);border-bottom:1px solid color-mix(in srgb,var(--vg) 22%,transparent)}",
  "[data-vle-chrome='ember'] .vlf-title{font-family:var(--vserif);font-style:italic;font-weight:500;font-size:calc(17px * var(--vscale));letter-spacing:1px;text-transform:none;text-shadow:0 0 12px rgba(var(--vg-rgb),.4)}",
  // a soft inner halo - a diffuse glow ring, not a hard bracket or dotted lace
  "[data-vle-chrome='ember'] .vlf-frame::before{content:'';position:absolute;z-index:1;inset:6px;border-radius:calc(var(--vradius) + 4px);box-shadow:inset 0 0 22px rgba(var(--vg-rgb),.1),inset 0 0 40px rgba(var(--vg2-rgb),.07);pointer-events:none}",
  "[data-vle-chrome='ember'] .vlf-grip{background:none;border:none;right:7px;bottom:7px;width:12px;height:12px;border-right:2px solid color-mix(in srgb,var(--vg) 55%,transparent);border-bottom:2px solid color-mix(in srgb,var(--vg) 55%,transparent);border-radius:0 0 10px 0;opacity:.7}",
  "[data-vle-chrome='ember'] .vlf-launch{border-radius:18px 0 0 18px;box-shadow:-5px 4px 22px rgba(0,0,0,.5),0 0 18px rgba(var(--vg-rgb),.18)}",

  // ---- CRUD controls + pagination ----
  ".vle-sec-top{display:flex;flex-wrap:wrap;align-items:center;gap:6px;justify-content:flex-end;margin-bottom:8px}",
  ".vle-add{font:600 9px/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--vle-gold);background:rgba(var(--vg-rgb),.14);border:1px solid rgba(var(--vg-rgb),.34);border-radius:7px;padding:5px 11px;cursor:pointer}",
  ".vle-add:hover{background:rgba(var(--vg-rgb),.28)}",
  ".vle-add.sm{margin-left:auto;padding:2px 8px;font-size:11px;line-height:1}",
  ".vle-card-ctl,.vle-rel-ctl{display:inline-flex;gap:3px;margin-left:auto}",
  // controls fade in on hover/keyboard-focus; only hidden where hover exists, so
  // touch devices (hover:none) keep them tappable. Kept in DOM (not display:none).
  "@media (hover:hover){.vle-card .vle-card-ctl{opacity:.4;transition:opacity .15s}.vle-card:hover .vle-card-ctl,.vle-card:focus-within .vle-card-ctl{opacity:1}}",
  "html[data-vle-motion='off'] .vle-card .vle-card-ctl{opacity:1}",
  ".vle-mini{width:22px;height:22px;display:grid;place-items:center;border-radius:6px;font-size:11px;color:var(--vi2);background:rgba(var(--vg-rgb),.08);border:1px solid rgba(var(--vg-rgb),.2);cursor:pointer}",
  ".vle-mini:hover{background:rgba(var(--vg-rgb),.22);color:var(--vle-gold)}",
  ".vle-mini.del:hover{color:#e09090;border-color:rgba(201,106,106,.4);background:rgba(201,106,106,.1)}",
  ".vle-card{align-items:center}",
  ".vle-rel-sub{margin:2px 0;display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
  ".vle-mini.on{color:var(--vle-gold);background:rgba(var(--vg-rgb),.2)}",
  ".vle-rel-lockbadge{display:inline-flex;align-items:center;justify-content:center;gap:3px;text-align:center;font:600 8.5px/1.3 var(--vmono);letter-spacing:.4px;text-transform:uppercase;color:var(--v-warn);border:1px solid color-mix(in srgb,var(--v-warn) 40%,transparent);border-radius:var(--vr1);padding:3px 6px}",
  ".vle-mem{align-items:center;gap:7px}",
  ".vle-pager{display:flex;align-items:center;justify-content:center;gap:10px;margin:8px 0 4px}",
  ".vle-pg{width:26px;height:24px;border-radius:6px;font-size:13px;color:var(--vle-gold);background:rgba(var(--vg-rgb),.1);border:1px solid rgba(var(--vg-rgb),.24);cursor:pointer}",
  ".vle-pg:hover{background:rgba(var(--vg-rgb),.24)}.vle-pg[disabled]{opacity:.3;cursor:default}",
  ".vle-pg-n{font:600 9px/1 var(--vmono);opacity:.6;min-width:42px;text-align:center}",
  // ---- modal ----
  ".vlfm-overlay{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;background:rgba(8,7,5,.6);backdrop-filter:blur(3px)}",
  // self-owned toasts (the Lumiverse ctx has no toast API) — above overlays
  ".vle-toasts{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:10002;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}",
  ".vle-toast{pointer-events:auto;max-width:min(460px,90vw);padding:10px 16px;border-radius:10px;font:600 12px/1.4 var(--vmono);letter-spacing:.2px;color:var(--vle-ink);background:linear-gradient(168deg,rgba(28,24,17,.99),rgba(16,14,10,1));border:1px solid rgba(var(--vg-rgb),.45);box-shadow:0 12px 40px rgba(0,0,0,.6);opacity:0;transform:translateY(8px);transition:opacity .2s,transform .2s}",
  ".vle-toast.on{opacity:1;transform:translateY(0)}",
  ".vle-toast--success{border-color:color-mix(in srgb,var(--v-pos) 55%,transparent)}",
  ".vle-toast--warning{border-color:color-mix(in srgb,var(--v-warn) 60%,transparent)}",
  ".vle-toast--info{border-color:rgba(var(--vg-rgb),.45)}",
  ".vlfm{width:min(440px,92vw);max-height:86vh;display:flex;flex-direction:column;border-radius:14px;overflow:hidden;color:var(--vle-ink);background:linear-gradient(168deg,rgba(28,24,17,.99),rgba(16,14,10,1));border:1px solid rgba(var(--vg-rgb),.5);box-shadow:0 28px 80px rgba(0,0,0,.7)}",
  // Search / Customize / Actions carry .vle-root (to scope theme vars); the chrome
  // `.vle-root{background-image:...}` rules would otherwise beat .vlfm's opaque fill
  // and let the chat show through. Pin an opaque surface for these panels on every chrome.
  "html[data-vle-chrome] .vlfm.vle-root{background-color:#14110b;background-image:linear-gradient(168deg,rgba(28,24,17,.99),rgba(16,14,10,1))}",
  // user custom background color: paints the drawer fill (float reads --vglass via .vlf-tex).
  // Excludes .vlfm modals (they pin their own opaque surface) and clears chrome gradients so the color reads true.
  "html[data-vle-bg] .vle-root:not(.vlfm){background-color:var(--vle-bg-custom);background-image:none}",
  ".vlfm-head{display:flex;align-items:center;gap:8px;padding:13px 16px;font-family:var(--vserif);font-size:18px;letter-spacing:1.5px;text-transform:uppercase;color:var(--vi);border-bottom:1px solid rgba(var(--vg-rgb),.22)}",
  ".vlfm-mark{color:var(--vle-gold)}",
  ".vlfm-body{padding:14px 16px;overflow-y:auto;display:flex;flex-direction:column;gap:11px}",
  ".vlfm-l{display:flex;flex-direction:column;gap:5px;font:600 9px/1.3 var(--vmono);letter-spacing:.5px;text-transform:uppercase;opacity:.78}",
  ".vlfm-section{margin:12px 0 2px;font:600 9px/1 var(--vmono);letter-spacing:1.5px;text-transform:uppercase;color:var(--vg);opacity:.7;padding-bottom:4px;border-bottom:1px solid rgba(var(--vg-rgb),.16)}",
  ".vlfm-adv{margin-top:10px;border-top:1px solid rgba(var(--vg-rgb),.16);padding-top:4px}",
  ".vlfm-adv>summary{font:600 10px/1 var(--vmono);letter-spacing:1px;text-transform:uppercase;color:var(--vg);opacity:.75;cursor:pointer;padding:5px 0}",
  ".vlfm-adv[open]>summary{margin-bottom:6px}",
  ".vlfm-in{font-family:var(--vserif);font-size:15px;letter-spacing:0;text-transform:none;color:var(--vle-ink);background:rgba(12,10,8,.7);border:1px solid rgba(var(--vg-rgb),.26);border-radius:8px;padding:8px 10px;outline:none}",
  ".vlfm-in:focus{border-color:var(--vle-gold);box-shadow:0 0 0 2px rgba(var(--vg-rgb),.16)}",
  ".vlfm-ta{min-height:84px;resize:vertical;line-height:1.5}",
  // large editor (vault entries): wide dialog + tall content area, with a body that grows
  ".vlfm-large{width:min(860px,94vw);max-height:90vh}",
  ".vlfm-large .vlfm-body{flex:1 1 auto}",
  ".vlfm-l-grow{flex:1 1 auto;min-height:0}",
  ".vlfm-ta-big{min-height:min(58vh,520px);height:min(58vh,520px);resize:vertical;line-height:1.6;font-size:15px}",
  ".vlfm-chkrow{display:flex;flex-wrap:wrap;gap:8px 14px;padding:3px 0}",
  ".vlfm-chk{display:inline-flex;align-items:center;gap:5px;font:500 12px/1 var(--vmono);text-transform:none;letter-spacing:0;cursor:pointer}",
  ".vlfm-chk input{accent-color:var(--vle-gold);cursor:pointer}",
  // edit-character color field: space the color input from the 'none' toggle
  ".vlfm-colrow{display:flex;align-items:center;gap:14px;margin-top:4px}",
  ".vlfm-col{width:46px;height:28px;padding:0;border:1px solid rgba(var(--vg-rgb),.3);border-radius:6px;background:transparent;cursor:pointer}",
  // cast tab auto-color control
  ".vle-autoc{display:inline-flex;align-items:center;gap:4px;font:600 8.5px/1 var(--vmono);letter-spacing:.3px;text-transform:uppercase;color:var(--vle-dim);margin-right:8px}",
  ".vle-autoc-b{font:inherit;color:var(--vi2);background:rgba(var(--vg-rgb),.08);border:1px solid var(--vle-gold-soft);border-radius:6px;padding:4px 7px;cursor:pointer}",
  ".vle-autoc-b:hover{color:var(--vle-gold)}",
  ".vle-autoc-b.on{background:rgba(var(--vg-rgb),.22);color:var(--vle-gold);border-color:rgba(var(--vg-rgb),.45)}",
  ".vlfm-foot{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:11px 16px;border-top:1px solid rgba(var(--vg-rgb),.18)}",
  ".vlfm-foot-sp{flex:1 1 auto}",
  ".vlob-body{display:block;line-height:1.6;font-size:12.5px}",
  ".vlob-dots{display:flex;justify-content:center;gap:6px;padding:2px 0 4px}",
  ".vlob-dot{width:6px;height:6px;border-radius:50%;background:rgba(var(--vg-rgb),.25)}.vlob-dot.on{background:var(--vle-gold)}",
  ".vlfm-act{color:var(--vi2);opacity:.85}.vlfm-act:hover{background:rgba(255,255,255,.05);opacity:1}",
  ".vlfm-hint{font:500 10px/1.4 var(--vmono);letter-spacing:0;text-transform:none;opacity:.6;margin-top:-2px}",
  ".vlfm-btn{font:600 11px/1 var(--vmono);letter-spacing:.5px;border-radius:8px;padding:8px 16px;cursor:pointer;border:1px solid rgba(var(--vg-rgb),.3);background:transparent;color:var(--vi2)}",
  ".vlfm-save{background:rgba(var(--vg-rgb),.22);color:var(--vle-gold);border-color:rgba(var(--vg-rgb),.5)}",
  ".vlfm-save:hover{background:rgba(var(--vg-rgb),.36)}.vlfm-cancel:hover{background:rgba(255,255,255,.05)}",
  // ---- filter bar ----
  ".vle-fbar{display:flex;flex-wrap:wrap;gap:5px;margin:0 0 9px}",
  ".vle-fb-btn,.vle-fb-sel{font:600 9px/1 var(--vmono);letter-spacing:.4px;color:var(--vi2);background:rgba(var(--vg-rgb),.08);border:1px solid rgba(var(--vg-rgb),.22);border-radius:7px;padding:5px 9px;cursor:pointer}",
  ".vle-fb-btn:hover{background:rgba(var(--vg-rgb),.2);color:var(--vle-gold)}",
  ".vle-fb-btn.on{background:rgba(var(--vg-rgb),.2);color:var(--vle-gold);border-color:rgba(var(--vg-rgb),.45)}",
  ".vle-fb-sel{text-transform:none}",
  // ---- journal ----
  ".vle-jr-grid{display:flex;flex-direction:column;gap:7px}",
  ".vle-jr{border:1px solid rgba(var(--vg-rgb),.16);border-left:3px solid var(--c,#8c8478);border-radius:0 var(--vr2) var(--vr2) 0;background:rgba(22,20,16,.42);padding:8px 11px}",
  ".vle-jr-top{display:flex;align-items:center;gap:7px}",
  ".vle-jr-glyph{color:var(--c,var(--vg));font-size:14px}",
  ".vle-jr-who{font-family:var(--vserif);font-size:14px;color:var(--vi);flex:1}",
  ".vle-jr-ctl{display:inline-flex;gap:3px}",
  ".vle-jr-mem{font-size:12.5px;line-height:1.5;color:#cdc3ad;margin:5px 0 6px;font-style:italic}",
  ".vle-jr-tags{display:flex;flex-wrap:wrap;gap:4px;align-items:center}",
  ".vle-jr-tag{font:600 9px/1 var(--vmono);text-transform:uppercase;letter-spacing:.4px;padding:2px 6px;border-radius:5px;border:1px solid rgba(var(--vg-rgb),.2);opacity:.85}",
  ".vle-jr-tag.w-defining{border-color:rgba(var(--vg-rgb),.6);color:var(--vle-gold)}",
  ".vle-jr-tag.w-significant{border-color:rgba(var(--vg-rgb),.4)}",
  ".vle-jr-day{margin-left:auto;font:600 9px/1 var(--vmono);opacity:.5}",
  // sentiment → semantic token (drives left rule, glyph, and the sentiment tag)
  ".vle-jr--pos{--c:var(--v-pos-i)}.vle-jr--neg{--c:var(--v-neg-i)}.vle-jr--neu{--c:var(--vle-dim)}.vle-jr--cx{--c:var(--v-warn)}",
  ".vle-jr-sent{color:var(--c,var(--vle-dim))}",
  // ---- relation change history ----
  ".vle-hist{margin-top:7px;border-top:1px solid rgba(var(--vg-rgb),.14);padding-top:5px}",
  ".vle-hist>summary{cursor:pointer;list-style:none;font:600 9px/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;opacity:.5}",
  ".vle-hist>summary::-webkit-details-marker{display:none}.vle-hist>summary::before{content:'\u25B8 '}",
  ".vle-hist[open]>summary::before{content:'\u25BE '}",
  ".vle-hist-sec{font:600 9px/1 var(--vmono);text-transform:uppercase;opacity:.45;margin:6px 0 3px}",
  ".vle-hist-row{display:flex;gap:7px;align-items:baseline;font-size:11px;padding:1px 0}",
  ".vle-hist-t{flex:none;width:30px;font:600 9px/1 var(--vmono);opacity:.5}",
  ".vle-hist-ev{font:600 9px/1 var(--vmono);padding:1px 5px;border-radius:5px}",
  ".vle-hist-ev.add{color:var(--v-pos-i);border:1px solid color-mix(in srgb,var(--v-pos) 40%,transparent)}",
  ".vle-hist-ev.rm{color:var(--v-neg-i);border:1px solid color-mix(in srgb,var(--v-neg) 40%,transparent);text-decoration:line-through}",
  ".vle-hist-sc{font:600 9px/1.3 var(--vmono);color:var(--vi2)}",
  ".vle-hist-why{opacity:.55;font-style:italic;font-size:10px}",
  // ---- injection tab ----
  ".vle-inj-hint{font-size:10px;opacity:.55;margin-right:auto}",
  ".vle-inj-list{display:flex;flex-direction:column;gap:6px}",
  ".vle-inj{border:1px solid rgba(var(--vg-rgb),.18);border-radius:9px;overflow:hidden;background:rgba(20,18,14,.4)}",
  ".vle-inj-top{display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:pointer}",
  ".vle-inj-top:hover{background:rgba(var(--vg-rgb),.06)}",
  ".vle-inj-turn{font:600 9px/1 var(--vmono);color:var(--vle-gold);flex:none}",
  ".vle-inj-reasons{flex:1;display:flex;flex-wrap:wrap;gap:4px}",
  ".vle-inj-reason{font:600 9px/1 var(--vmono);text-transform:uppercase;letter-spacing:.4px;padding:2px 6px;border-radius:var(--vr1);background:rgba(var(--vg-rgb),.1);color:var(--vi2)}",
  ".vle-inj-chars{font:600 9px/1 var(--vmono);opacity:.45;flex:none}",
  ".vle-inj-body{display:none;margin:0;padding:9px 11px;border-top:1px solid rgba(var(--vg-rgb),.16);font:500 10.5px/1.5 var(--vmono);color:#bcb29c;white-space:pre-wrap;word-break:break-word;max-height:320px;overflow-y:auto;background:rgba(12,10,8,.5)}",
  ".vle-inj-body.open{display:block}",
  // ---- journal book / shelf ----
  ".vle-shelf{display:flex;flex-wrap:wrap;gap:5px;margin:0 0 9px}",
  ".vle-book{font:600 11px/1 var(--vserif);letter-spacing:.5px;color:var(--vi);background:linear-gradient(180deg,rgba(34,28,19,.9),rgba(20,17,12,.9));border:1px solid rgba(var(--vg-rgb),.3);border-radius:6px;padding:6px 10px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}",
  ".vle-book:hover{border-color:var(--vle-gold);background:rgba(var(--vg-rgb),.16)}",
  ".vle-book-n{font:600 9px/1 var(--vmono);background:rgba(var(--vg-rgb),.2);color:var(--vle-gold);border-radius:7px;padding:2px 6px}",
  ".vle-book-head{display:flex;align-items:center;gap:8px;margin-bottom:9px;padding-bottom:7px;border-bottom:1px solid rgba(var(--vg-rgb),.22)}",
  ".vle-book-title{font-family:var(--vserif);font-size:17px;letter-spacing:1px;color:var(--vi);flex:1}",
  // ---- Journal "Shelf": book spines standing on a plank (mockup 11A) ----
  ".vle-shelf-wrap{margin:0 0 14px}",
  ".vle-shelf-wrap .vle-shelf{display:flex;flex-wrap:nowrap;overflow-x:auto;align-items:flex-end;gap:6px;padding:6px 2px 0}",
  ".vle-shelf-plank{height:8px;border-radius:2px;background:linear-gradient(180deg,#2a2114,#1a140c);box-shadow:0 2px 6px rgba(0,0,0,.4)}",
  ".vle-jspine{flex:none;width:52px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:6px;padding:8px 4px;cursor:pointer;border:1px solid rgba(var(--vg-rgb),.35);border-bottom:none;border-radius:5px 5px 0 0;background:linear-gradient(180deg,#3a2f1a,#241c10);color:var(--vi);position:relative}",
  ".vle-jspine:hover{background:linear-gradient(180deg,#473921,#2c2213);transform:translateY(-3px);transition:transform .12s}",
  ".vle-jspine-av{width:30px;height:30px;display:grid;place-items:center;border-radius:50%;background:rgba(var(--vg-rgb),.2);border:1.5px solid rgba(var(--vg-rgb),.5);color:var(--vle-gold);font:600 11px/1 var(--vmono)}",
  ".vle-jspine-name{writing-mode:vertical-rl;transform:rotate(180deg);font-family:var(--vserif);font-style:italic;font-size:12px;letter-spacing:.5px;flex:1;max-height:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".vle-jspine-n{font:600 9px/1 var(--vmono);opacity:.7}",
  // foot band = dominant sentiment
  ".vle-jspine::after{content:'';position:absolute;left:0;right:0;bottom:0;height:5px}",
  ".vle-jspine--pos::after{background:var(--v-pos)}.vle-jspine--neg::after{background:var(--v-neg)}.vle-jspine--neu::after{background:rgba(var(--vg-rgb),.5)}.vle-jspine--cx::after{background:var(--v-warn)}",
  // ---- Journal "Diary": open two-page spread (mockup 11B) ----
  ".vle-diary-head{display:flex;align-items:center;gap:9px;margin-bottom:9px;padding-bottom:7px;border-bottom:1px solid rgba(var(--vg-rgb),.22)}",
  ".vle-diary-av{width:30px;height:30px;display:grid;place-items:center;border-radius:50%;background:rgba(var(--vg-rgb),.2);border:1.5px solid rgba(var(--vg-rgb),.5);color:var(--vle-gold);font:600 11px/1 var(--vmono)}",
  ".vle-diary{display:grid;grid-template-columns:1fr 1fr;gap:0;border-radius:var(--vr3);overflow:hidden;background:linear-gradient(90deg,var(--vsurf-1),var(--vsurf-2) 49%,rgba(0,0,0,.25) 50%,var(--vsurf-1) 51%,var(--vsurf-2))}",
  ".vle-diary-page{padding:14px 16px;display:flex;flex-direction:column;gap:10px;min-height:200px}",
  ".vle-leaf{padding-bottom:9px;border-bottom:1px solid rgba(var(--vg-rgb),.12)}",
  ".vle-leaf-meta{display:flex;align-items:baseline;gap:6px;font:600 calc(9.5px * var(--vscale))/1.3 var(--vmono);letter-spacing:.4px;color:var(--vg);opacity:.8;margin-bottom:4px}",
  ".vle-leaf-ctl{margin-left:auto;display:inline-flex;gap:3px;opacity:.5}",
  ".vle-leaf:hover .vle-leaf-ctl{opacity:1}",
  ".vle-leaf-mem{font-family:var(--vserif);font-style:italic;font-size:calc(14px * var(--vscale));line-height:1.55;color:var(--vi2)}",
  // sentiment inks the handwriting
  ".vle-leaf--pos .vle-leaf-mem{color:var(--v-pos-i)}.vle-leaf--neg .vle-leaf-mem{color:var(--v-neg-i)}.vle-leaf--cx .vle-leaf-mem{color:var(--v-warn)}",
  ".vle-diary-add{align-self:flex-start;margin-top:auto;font-family:var(--vserif);font-style:italic;font-size:13px;color:var(--vi2);background:none;border:none;cursor:pointer;opacity:.7}",
  ".vle-diary-add:hover{opacity:1;color:var(--vle-gold)}",
  "@container (max-width:460px){.vle-diary{grid-template-columns:1fr;background:var(--vsurf-1)}.vle-diary-page:first-child{border-bottom:1px solid rgba(var(--vg-rgb),.15)}}",
  // diary theme skins: futuristic = MEMORY_LOG (mono, no skeuomorph), modern = flat cards
  "html[data-vle-chrome='futuristic'] .vle-diary{background:#04121a;border:1px solid rgba(var(--vg-rgb),.4)}",
  "html[data-vle-chrome='futuristic'] .vle-leaf-mem{font-family:var(--vmono);font-style:normal;font-size:calc(12px * var(--vscale))}",
  "html[data-vle-chrome='futuristic'] .vle-leaf-mem::before{content:'\\00bb '}",
  "html[data-vle-chrome='modern'] .vle-diary{background:none;gap:8px}",
  "html[data-vle-chrome='modern'] .vle-diary-page{background:color-mix(in srgb,var(--vi) 4%,transparent);border-radius:16px}",
  "html[data-vle-chrome='modern'] .vle-leaf-mem{font-style:normal}",
  // ---- floating dashboard ----
  ".vld{display:flex;flex-direction:column;gap:calc(16px * var(--vscale))}",
  ".vld-sec{display:flex;flex-direction:column;gap:calc(11px * var(--vscale));padding:calc(13px * var(--vscale)) calc(14px * var(--vscale));border:1px solid rgba(var(--vg-rgb),.14);border-radius:var(--vr3);background:linear-gradient(168deg,var(--vsurf-1),var(--vsurf-2))}",
  // header sits apart from its body: own line + breathing room beneath the eyebrow
  ".vld-h{font:600 calc(10px * var(--vscale))/1 var(--vmono);letter-spacing:1.5px;text-transform:uppercase;color:var(--vg);opacity:.85;display:flex;align-items:center;gap:7px;margin-bottom:calc(3px * var(--vscale))}",
  ".vld-statbar{display:flex;flex-wrap:wrap;gap:7px}",
  ".vld-stat{font:600 calc(11px * var(--vscale))/1 var(--vmono);color:var(--vi2);background:rgba(var(--vg-rgb),.1);border:1px solid rgba(var(--vg-rgb),.24);border-radius:8px;padding:7px 11px;display:inline-flex;gap:6px}",
  ".vld-stat b{color:var(--vle-gold);font-weight:600;opacity:.85}",
  ".vld-loc{font-family:var(--vserif);font-size:calc(18px * var(--vscale));color:var(--vi);font-style:italic;line-height:1.3}",
  // redesigned hero scene block + single quiet meta line (replaces the 4 pills)
  ".vld-sec--hero{gap:calc(6px * var(--vscale));position:relative;overflow:hidden;isolation:isolate}",
  // hero text + meta ride ABOVE the illustrated band
  ".vld-sec--hero>*{position:relative;z-index:1}",
  ".vld-sec--hero>.vld-band{z-index:0}",

  // ===== illustrated, weather-reactive SCENE BAND (Story·Beauty·Memory: BEAUTY) =====
  // A layered picture behind the hero: sky (time of day) + light orb + weather
  // particles + a horizon line. Pure CSS; all motion honours --vmotion & reduced-motion.
  ".vld-band{position:absolute;inset:0;pointer-events:none;border-radius:inherit;opacity:.9}",
  ".vld-band>span{position:absolute;inset:0;display:block}",
  // --- SKY by time of day (default; chromes may tint via their own --sky vars) ---
  ".vld-band-sky{background:linear-gradient(180deg,var(--sky-top,#243244),var(--sky-mid,#1a2230) 55%,var(--sky-base,#12151c))}",
  ".vld-band[data-tod='dawn']{--sky-top:#3a3350;--sky-mid:#6b4a5a;--sky-base:#c98a6a}",
  ".vld-band[data-tod='day']{--sky-top:#3f6fa8;--sky-mid:#5a86bd;--sky-base:#9fb8d4}",
  ".vld-band[data-tod='dusk']{--sky-top:#2b2450;--sky-mid:#5a3f6a;--sky-base:#c07a5a}",
  ".vld-band[data-tod='night']{--sky-top:#141428;--sky-mid:#171a30;--sky-base:#0c0c18}",
  // --- LIGHT ORB (sun/moon) positioned by tod; a soft radial glow ---
  ".vld-band-orb{background:radial-gradient(circle at var(--orb-x,80%) var(--orb-y,28%),var(--orb-c,rgba(255,240,200,.5)) 0,transparent var(--orb-r,26%))}",
  ".vld-band[data-tod='dawn']{--orb-x:78%;--orb-y:62%;--orb-c:rgba(255,200,150,.55);--orb-r:30%}",
  ".vld-band[data-tod='day']{--orb-x:82%;--orb-y:24%;--orb-c:rgba(255,246,214,.6);--orb-r:24%}",
  ".vld-band[data-tod='dusk']{--orb-x:22%;--orb-y:64%;--orb-c:rgba(255,168,120,.5);--orb-r:32%}",
  ".vld-band[data-tod='night']{--orb-x:76%;--orb-y:26%;--orb-c:rgba(210,224,255,.4);--orb-r:18%}",
  // --- HORIZON: a faint ground/water line low in the band ---
  ".vld-band-horizon{top:auto;height:34%;background:linear-gradient(180deg,transparent,rgba(0,0,0,.28));box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}",
  // scrim so hero text always reads over the busiest sky
  ".vld-band::after{content:'';position:absolute;inset:0;background:linear-gradient(105deg,rgba(0,0,0,.42),rgba(0,0,0,.12) 60%,transparent);z-index:1}",
  ".vld-band>span{z-index:0}",

  // --- WEATHER PARTICLES on .vld-band-fx (repeating gradients; animated) ---
  // clear: a few faint stars/sparkles (mostly for night/dusk)
  ".vld-band[data-weather='clear'] .vld-band-fx{background-image:radial-gradient(1px 1px at 18% 30%,rgba(255,255,255,.5),transparent),radial-gradient(1px 1px at 62% 22%,rgba(255,255,255,.35),transparent),radial-gradient(1.5px 1.5px at 82% 44%,rgba(255,255,255,.4),transparent);opacity:.5}",
  // cloud: soft drifting light bands
  ".vld-band[data-weather='cloud'] .vld-band-fx{background:linear-gradient(100deg,transparent 0 40%,rgba(255,255,255,.06) 46%,transparent 54%),linear-gradient(100deg,transparent 0 60%,rgba(255,255,255,.05) 66%,transparent 74%);animation:vld-clouds 40s linear infinite}",
  // rain: diagonal streaks
  ".vld-band[data-weather='rain'] .vld-band-fx{background-image:repeating-linear-gradient(102deg,rgba(155,200,232,.28) 0 1px,transparent 1px 7px);background-size:auto 22px;animation:vld-rain .5s linear infinite}",
  // storm: denser rain + an occasional flash on the sky
  ".vld-band[data-weather='storm'] .vld-band-fx{background-image:repeating-linear-gradient(100deg,rgba(180,210,240,.36) 0 1.5px,transparent 1.5px 6px);background-size:auto 24px;animation:vld-rain .38s linear infinite}",
  ".vld-band[data-weather='storm'] .vld-band-sky{animation:vld-flash 7s steps(1) infinite}",
  // snow: slow drifting dots
  ".vld-band[data-weather='snow'] .vld-band-fx{background-image:radial-gradient(2px 2px at 20% 20%,rgba(255,255,255,.8),transparent),radial-gradient(1.5px 1.5px at 66% 40%,rgba(255,255,255,.7),transparent),radial-gradient(2px 2px at 44% 70%,rgba(255,255,255,.75),transparent),radial-gradient(1.5px 1.5px at 84% 84%,rgba(255,255,255,.65),transparent);background-size:120px 120px;animation:vld-snow 9s linear infinite}",
  // fog: soft horizontal haze bands
  ".vld-band[data-weather='fog'] .vld-band-fx{background:linear-gradient(0deg,rgba(200,205,215,.16),transparent 40%),linear-gradient(180deg,rgba(200,205,215,.12),transparent 50%);animation:vld-fog 26s ease-in-out infinite alternate}",

  "@keyframes vld-rain{0%{background-position:0 0}100%{background-position:0 22px}}",
  "@keyframes vld-snow{0%{background-position:0 0}100%{background-position:20px 120px}}",
  "@keyframes vld-clouds{0%{background-position:0 0,0 0}100%{background-position:300px 0,-260px 0}}",
  "@keyframes vld-fog{0%{opacity:.5;transform:translateX(-4%)}100%{opacity:.85;transform:translateX(4%)}}",
  "@keyframes vld-flash{0%,96%,100%{filter:none}97%,98%{filter:brightness(1.9)}}",
  // motion kill-switch: freeze every band animation
  "html[data-vle-motion='off'] .vld-band-fx,html[data-vle-motion='off'] .vld-band-sky{animation:none!important}",
  "@media (prefers-reduced-motion:reduce){.vld-band-fx,.vld-band-sky{animation:none!important}}",

  ".vld-hero{font-size:var(--vt-display);line-height:1.18}",
  ".vld-hero:not(.vld-loc--none)::before{content:'\\25C8 ';color:var(--vg);opacity:.7;font-style:normal}",
  ".vld-loc--none{opacity:.5}",
  ".vld-meta{font:600 var(--vt-meta)/1.4 var(--vmono);letter-spacing:.5px;color:var(--vi2);opacity:.7;text-transform:uppercase}",
  // world-calendar epoch token — reads as an occasion under the meta line
  ".vld-epoch{margin-top:calc(4px * var(--vscale));font-family:var(--vserif);font-style:italic;font-size:calc(14px * var(--vscale));color:var(--v-press-i);letter-spacing:.3px}",
  "html[data-vle-chrome='illuminated'] .vld-epoch{color:var(--v-neg-i);font-variant:small-caps;letter-spacing:1px}",
  "html[data-vle-chrome='futuristic'] .vld-epoch{font-family:var(--vmono);font-style:normal;text-transform:uppercase;letter-spacing:1.5px;font-size:calc(11px * var(--vscale))}",
  // amber tension dot-meter (semantic --v-press, no longer danger-red)
  ".vld-dots{display:flex;gap:4px;align-items:center;flex:1}",
  ".vld-dot{width:9px;height:9px;border-radius:50%;background:rgba(255,255,255,.1)}",
  ".vld-dot.on{background:var(--v-press);box-shadow:0 0 6px color-mix(in srgb,var(--v-press) 60%,transparent)}",
  // colored left spine per recent-event kind (scannable mixed feed)
  ".vld-rec--journal{border-left:3px solid var(--v-pos)}",
  ".vld-rec--knew{border-left:3px solid var(--v-info)}",
  ".vld-rec--secret{border-left:3px solid var(--v-neg)}",
  ".vld-rec--shift{border-left:3px solid var(--v-press)}",
  ".vld-tension-row{display:flex;align-items:center;gap:12px}",
  ".vld-tension{position:relative;flex:1;height:8px;border-radius:5px;background:rgba(255,255,255,.07);overflow:hidden}",
  ".vld-tension-f{position:absolute;left:0;top:0;height:8px;border-radius:5px;transition:width .3s;box-shadow:0 0 8px currentColor}",
  ".vld-tension-n{flex:none;min-width:38px;text-align:right;font:600 calc(11px * var(--vscale))/1 var(--vmono);opacity:.7}",
  // ===== tension EMBER GAUGE (default): motes that grow hotter as tension climbs =====
  ".vld-tension-read{font:600 calc(9.5px * var(--vscale))/1 var(--vmono);letter-spacing:.5px;opacity:.75;margin-left:8px;color:var(--v-press-i)}",
  ".vld-gauge{display:flex;align-items:center;gap:calc(5px * var(--vscale));min-height:16px;margin:calc(3px * var(--vscale)) 0}",
  // base mote = a cold, small ember; lit motes scale up and heat by index --i
  ".vld-gauge .vld-mote{width:calc(5px * var(--vscale));height:calc(5px * var(--vscale));border-radius:50%;background:rgba(255,255,255,.1);flex:none;transition:background .3s,box-shadow .3s,transform .3s}",
  // heat ramp: low index = press-amber, high index = danger-red (only when LIT).
  ".vld-gauge .vld-mote.on{--heat:calc(var(--i) / 9);background:color-mix(in srgb,var(--v-neg) calc(var(--heat) * 100%),var(--v-press));width:calc((5px + var(--i) * 0.7px) * var(--vscale));height:calc((5px + var(--i) * 0.7px) * var(--vscale));box-shadow:0 0 calc((5px + var(--i) * 1px)) color-mix(in srgb,var(--v-press) 70%,transparent);animation:vld-mote-pulse 2.4s ease-in-out infinite;animation-delay:calc(var(--i) * -0.18s)}",
  "@keyframes vld-mote-pulse{0%,100%{opacity:.82;transform:translateY(0)}50%{opacity:1;transform:translateY(-1px)}}",
  ".vld-tension-tr{margin-left:4px;font-size:calc(11px * var(--vscale));line-height:1}",
  ".vld-tension-tr.up{color:var(--v-neg-i)}.vld-tension-tr.down{color:var(--v-info)}",
  ".vld-tension-word{font-family:var(--vserif);font-style:italic;font-size:calc(12px * var(--vscale));color:var(--vi2);opacity:.72;margin-top:calc(2px * var(--vscale))}",
  "html[data-vle-motion='off'] .vld-gauge .vld-mote.on{animation:none!important}",
  "@media (prefers-reduced-motion:reduce){.vld-gauge .vld-mote.on{animation:none!important}}",
  ".vld-pc{display:flex;gap:11px;align-items:flex-start;border:1px solid rgba(var(--vg-rgb),.16);border-left:3px solid var(--v-pos);border-radius:0 var(--vr3) var(--vr3) 0;background:rgba(var(--vg-rgb),.05);padding:calc(10px * var(--vscale)) calc(12px * var(--vscale))}",
  ".vld-pc+.vld-pc{margin-top:7px}",
  // portrait medallion + presence dot (mockup 09)
  ".vld-pc-av{position:relative;flex:none;width:calc(38px * var(--vscale));height:calc(38px * var(--vscale));display:grid;place-items:center;border-radius:50%;background:rgba(var(--vg-rgb),.18);border:2px solid color-mix(in srgb,var(--v-pos) 60%,transparent);color:var(--vle-gold,var(--vg));font-weight:600;font-size:calc(14px * var(--vscale))}",
  ".vld-pc-dot{position:absolute;right:-1px;top:-1px;width:10px;height:10px;border-radius:50%;background:var(--v-pos);border:2px solid var(--vsurf-2)}",
  ".vld-pc-body{flex:1;min-width:0}",
  ".vld-pc-top{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}",
  ".vld-pc-n{font-family:var(--vserif);font-size:calc(18px * var(--vscale));color:var(--vi);font-weight:600}",
  // sentence-case sentiment status (no shouty mono pills)
  ".vld-pc-status{font-family:var(--vserif);font-style:italic;font-size:calc(13px * var(--vscale))}",
  ".vld-pc-mood{color:var(--v-pos-i)}.vld-pc-cond{color:var(--v-neg-i)}",
  ".vld-pc-sep{opacity:.4;margin:0 4px}",
  ".vld-doing{font-size:calc(13.5px * var(--vscale));opacity:.82;margin-top:5px;line-height:1.5}",
  // the inner thought = focal point: own quoted block, violet key
  ".vld-thought{margin-top:7px;padding-left:11px;border-left:2px solid color-mix(in srgb,var(--v-warn) 55%,transparent)}",
  ".vld-thought-k{display:block;font:600 var(--vt-eyebrow)/1 var(--vmono);letter-spacing:1px;text-transform:uppercase;color:var(--v-warn);opacity:.8;margin-bottom:2px}",
  ".vld-thought-q{font-family:var(--vserif);font-style:italic;font-size:calc(12.5px * var(--vscale));color:var(--vi2);line-height:1.5}",
  // narrow float reflow: smaller medallion, name+status share a line, thought truncates
  "@container (max-width:360px){.vld-pc{gap:9px}.vld-pc-av{width:calc(30px * var(--vscale));height:calc(30px * var(--vscale));font-size:calc(12px * var(--vscale))}.vld-pc-n{font-size:calc(15px * var(--vscale))}.vld-thought-q{font-size:calc(11.5px * var(--vscale))}}",

  // --- THREADS (redesigned): tone-colored cards with a status pip + latest beat.
  ".vld-threads{display:flex;flex-direction:column;gap:calc(9px * var(--vscale))}",
  ".vld-thr{position:relative;border:1px solid color-mix(in srgb,var(--vtc,var(--vg)) 22%,transparent);border-radius:var(--vr3,13px);background:linear-gradient(180deg,color-mix(in srgb,var(--vtc,var(--vg)) 7%,transparent),transparent 62%),var(--vsurf-1);overflow:hidden;transition:border-color .18s,transform .18s}",
  ".vld-thr:hover{border-color:color-mix(in srgb,var(--vtc,var(--vg)) 45%,transparent);transform:translateY(-1px)}",
  // momentum spine: a gradient rail that fades toward the 'cooling' end
  ".vld-thr-rail{position:absolute;left:0;top:0;bottom:0;width:4px;background:linear-gradient(180deg,var(--vtc,var(--vg)),color-mix(in srgb,var(--vtc,var(--vg)) 25%,transparent))}",
  ".vld-thr-in{padding:calc(11px * var(--vscale)) calc(13px * var(--vscale)) calc(12px * var(--vscale)) calc(16px * var(--vscale))}",
  ".vld-thr--rising{--vtc:var(--v-press)}",
  ".vld-thr--active{--vtc:var(--v-pos)}",
  ".vld-thr--stalled{--vtc:var(--vi2)}",
  ".vld-thr--open{--vtc:var(--vg)}",
  ".vld-thr-head{display:flex;align-items:flex-start;gap:calc(9px * var(--vscale))}",
  ".vld-thr-n{flex:1 1 auto;min-width:0;overflow-wrap:anywhere;font-family:var(--vserif);font-weight:600;font-size:calc(16px * var(--vscale));color:var(--vi);line-height:1.2}",
  // trajectory glyph reads momentum before any text — the sole status signal now
  // that the free-text badge is gone (the model over-verbose statuses overflowed).
  ".vld-thr-traj{flex:0 0 auto;font:600 calc(12px * var(--vscale))/1 var(--vmono);color:var(--vtc,var(--vg));opacity:.9;margin-top:calc(3px * var(--vscale))}",
  ".vld-thr--rising .vld-thr-traj{animation:vld-thr-pulse 1.8s ease-in-out infinite}",
  "@keyframes vld-thr-pulse{0%,100%{opacity:.9;transform:translateY(0)}50%{opacity:.5;transform:translateY(-1px)}}",
  "[data-vle-motion='off'] .vld-thr-traj{animation:none!important}",
  ".vld-thr-beat{margin-top:calc(7px * var(--vscale));font-size:calc(12.5px * var(--vscale));line-height:1.5;color:var(--vi2);display:flex;gap:7px}",
  ".vld-thr-beat::before{content:'';flex:0 0 auto;width:2px;margin:2px 0;border-radius:2px;background:color-mix(in srgb,var(--vtc,var(--vg)) 45%,transparent)}",
  // meta footer: beat-progress dots + freshness/cold stamp on one rail
  ".vld-thr-foot{display:flex;align-items:center;gap:calc(12px * var(--vscale));margin-top:calc(10px * var(--vscale));padding-top:calc(9px * var(--vscale));border-top:1px solid rgba(var(--vg-rgb),.1)}",
  ".vld-thr-beats{display:flex;align-items:center;gap:4px}",
  ".vld-thr-bdot{width:6px;height:6px;border-radius:50%;background:color-mix(in srgb,var(--vtc,var(--vg)) 55%,transparent)}",
  ".vld-thr-bdot.spent{background:transparent;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--vtc,var(--vg)) 40%,transparent)}",
  ".vld-thr-blbl{font:600 calc(8.5px * var(--vscale))/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--vi2);opacity:.6;margin-left:3px}",
  ".vld-thr-fresh{margin-left:auto;font:600 calc(8.5px * var(--vscale))/1 var(--vmono);letter-spacing:.4px;text-transform:uppercase;color:var(--vi2);opacity:.55}",
  ".vld-thr-fresh.hot{color:var(--vtc,var(--vg));opacity:.95}",
  ".vld-thr-fresh.cold{color:var(--vi2);opacity:.7}",
  // legacy thread classes retained (still referenced by the data-scale rule); mapped onto the new look
  ".vld-thread{display:flex;justify-content:space-between;gap:8px;font-size:calc(13px * var(--vscale));padding:4px 0 4px 9px;border-left:2px solid rgba(var(--vg-rgb),.3)}",
  ".vld-thread-s{font:600 calc(9px * var(--vscale))/1 var(--vmono);color:var(--vle-gold);opacity:.75}",
  // --- PARALLEL / off-screen (redesigned): a dim off-stage timeline — the node
  // medallion sits ON the connective rail (haloed by the surface) so the whole
  // reads as one distant thread turning away from the scene, not stacked cards.
  ".vld-pars{position:relative;display:flex;flex-direction:column;gap:2px;padding-left:calc(2px * var(--vscale))}",
  ".vld-pars::before{content:'';position:absolute;left:calc(2px * var(--vscale) + (38px * var(--vscale) / 2) - 1px);top:calc(16px * var(--vscale));bottom:calc(16px * var(--vscale));width:1px;background:linear-gradient(180deg,transparent,color-mix(in srgb,var(--v-info) 30%,transparent) 10%,color-mix(in srgb,var(--v-info) 30%,transparent) 90%,transparent)}",
  ".vld-par{position:relative;display:flex;gap:calc(12px * var(--vscale));align-items:flex-start;padding:calc(8px * var(--vscale)) 0}",
  ".vld-par-node{flex:0 0 auto;width:calc(38px * var(--vscale));height:calc(38px * var(--vscale));border-radius:50%;display:grid;place-items:center;background:radial-gradient(60% 60% at 50% 40%,color-mix(in srgb,var(--v-info) 26%,transparent),color-mix(in srgb,var(--v-info) 8%,var(--vle-bg-solid)));border:1px solid color-mix(in srgb,var(--v-info) 40%,transparent);box-shadow:0 0 0 4px var(--vle-bg-solid);color:var(--v-info);font-family:var(--vserif);font-size:calc(14px * var(--vscale));background-size:cover;background-position:center;z-index:1}",
  ".vld-par-node.has-img{color:transparent}",
  ".vld-par-node--none{font-size:calc(17px * var(--vscale));opacity:.85;color:color-mix(in srgb,var(--v-info) 85%,#fff)}",
  ".vld-par-body{flex:1 1 auto;min-width:0;padding-top:calc(1px * var(--vscale))}",
  ".vld-par-top{display:flex;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:3px}",
  ".vld-par-who{font-family:var(--vserif);font-weight:600;font-size:calc(15px * var(--vscale));color:var(--v-info)}",
  // location now reads as a pinned place, not an @handle
  ".vld-par-w{font:600 calc(9px * var(--vscale))/1 var(--vmono);letter-spacing:.3px;color:var(--vi2);opacity:.7}",
  ".vld-par-w::before{content:'\\25C8';margin-right:4px;opacity:.7}",
  ".vld-par-tags{display:inline-flex;gap:5px}",
  ".vld-par-turn{margin-left:auto;font:600 calc(8.5px * var(--vscale))/1 var(--vmono);letter-spacing:.4px;color:var(--vi2);opacity:.5}",
  ".vld-par-sim{font:600 calc(8px * var(--vscale))/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--v-info);border:1px solid color-mix(in srgb,var(--v-info) 35%,transparent);background:color-mix(in srgb,var(--v-info) 10%,transparent);border-radius:var(--vr1);padding:2px 5px;opacity:.85}",
  ".vld-par-act{font-size:calc(12.5px * var(--vscale));opacity:.86;line-height:1.55;color:var(--vi2)}",
  ".vld-par-act em{font-style:italic;color:var(--vi);opacity:.92}",
  ".vld-rec{font-size:calc(12.5px * var(--vscale));line-height:1.55;padding:6px 0 6px 14px;color:var(--vi2);border-top:1px solid rgba(var(--vg-rgb),.08)}",
  ".vld-rec:first-child{border-top:none}",
  ".vld-rec-k{font:600 calc(9px * var(--vscale))/1 var(--vmono);text-transform:uppercase;letter-spacing:.5px;color:var(--vle-gold);background:rgba(var(--vg-rgb),.14);border-radius:5px;padding:3px 6px;margin-right:7px}",
  // ---- Vault tab ----
  ".vlv-catbar{display:flex;flex-wrap:wrap;gap:5px;margin:0 0 10px}",
  ".vlv-chip{display:inline-flex;align-items:center;gap:5px;font:600 10px/1 var(--vmono);letter-spacing:.4px;color:var(--vi2);background:rgba(var(--vg-rgb),.07);border:1px solid var(--vle-gold-soft);border-radius:8px;padding:5px 9px;cursor:pointer;opacity:.78}",
  ".vlv-chip:hover{opacity:1}.vlv-chip.on{opacity:1;border-color:var(--c,rgba(var(--vg-rgb),.5));background:color-mix(in srgb,var(--c,var(--vg)) 18%,transparent);color:var(--vi)}",
  ".vlv-chip.add{color:var(--vle-gold);border-style:dashed}",
  ".vlv-glyph{color:var(--c,var(--vle-gold))}",
  ".vlv-cn{font-size:9px;background:rgba(var(--vg-rgb),.18);color:var(--vle-gold);border-radius:7px;padding:1px 5px}",
  ".vlv-chipwrap{display:inline-flex;align-items:center;gap:2px}",
  ".vlv-gear{opacity:.5;margin-left:0;background:none;border:0;cursor:pointer;color:inherit;font:inherit;padding:2px;line-height:1}.vlv-gear:hover{opacity:1;color:var(--vle-gold)}",
  ".vlv-grid{display:flex;flex-direction:column;gap:7px}",
  ".vlv-entry{border:1px solid rgba(var(--vg-rgb),.16);border-left:3px solid var(--c,#8c8478);border-radius:0 var(--vr2) var(--vr2) 0;background:rgba(22,20,16,.42);padding:8px 11px}",
  ".vlv-entry.off{opacity:.5}",
  ".vlv-entry-top{display:flex;align-items:center;gap:7px}",
  ".vlv-entry-cat{font:600 9px/1 var(--vmono);text-transform:uppercase;letter-spacing:.5px;color:var(--c,var(--vi2))}",
  ".vlv-firing{font:600 9px/1 var(--vmono);text-transform:uppercase;letter-spacing:.4px;color:var(--v-pos-i);background:color-mix(in srgb,var(--v-pos) 18%,transparent);border-radius:var(--vr1);padding:2px 6px}",
  ".vlv-entry-book{font:600 8px/1 var(--vmono);letter-spacing:.3px;color:var(--vi2);opacity:.7;border:1px solid var(--vle-gold-soft);border-radius:var(--vr1);padding:2px 5px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".vlv-entry-ctl{margin-left:auto;display:inline-flex;gap:3px}",
  ".vlv-keys{font:600 10px/1.3 var(--vmono);color:var(--vle-gold);margin-top:5px;opacity:.85}",
  ".vlv-content{font-size:12px;line-height:1.5;color:#cdc3ad;margin-top:4px;white-space:pre-wrap;word-break:break-word}",
  ".vlv-badge{font:600 9px/1 var(--vmono);text-transform:uppercase;letter-spacing:.4px;color:var(--v-info);margin-top:6px;opacity:.7;display:flex;align-items:center;gap:6px}",
  ".vlv-unlink{font:600 9px/1 var(--vmono);text-transform:uppercase;letter-spacing:.4px;color:var(--vi2);background:rgba(var(--vg-rgb),.08);border:1px solid rgba(var(--vg-rgb),.2);border-radius:5px;padding:2px 6px;cursor:pointer}",
  ".vlv-unlink:hover{color:var(--vle-gold);background:rgba(var(--vg-rgb),.2)}",
  ".vlv-title{font-family:var(--vserif);font-size:15px;color:var(--vi);margin-top:4px}",
  ".vlv-suggest{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 10px;padding:7px 9px;border:1px dashed rgba(var(--vg-rgb),.3);border-radius:9px;background:rgba(var(--vg-rgb),.05)}",
  ".vlv-suggest-h{font:600 9px/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--vle-gold);opacity:.8}",
  ".vlv-sug{display:inline-flex;align-items:center;gap:5px;font-size:11px;background:rgba(22,20,16,.5);border:1px solid var(--vle-gold-soft);border-radius:20px;padding:3px 5px 3px 9px}",
  ".vlv-sug-l{color:var(--vi)}.vlv-sug-r{font:600 9px/1 var(--vmono);opacity:.5}",
  ".vlv-sug-y,.vlv-sug-n{width:18px;height:18px;display:grid;place-items:center;border-radius:50%;border:none;cursor:pointer;font-size:11px}",
  ".vlv-sug-y{background:color-mix(in srgb,var(--v-pos) 25%,transparent);color:var(--v-pos-i)}.vlv-sug-y:hover{background:color-mix(in srgb,var(--v-pos) 45%,transparent)}",
  ".vlv-sug-n{background:rgba(255,255,255,.06);color:var(--vi2)}.vlv-sug-n:hover{background:color-mix(in srgb,var(--v-neg) 25%,transparent);color:var(--v-neg-i)}",
  ".vlv-bklist{display:flex;flex-direction:column;gap:5px;margin-bottom:4px}",
  ".vlv-bk{display:flex;align-items:center;gap:7px;padding:6px 9px;border:1px solid var(--vle-gold-soft);border-radius:8px;background:rgba(22,20,16,.4)}",
  ".vlv-bk-n{flex:1;font-family:var(--vserif);font-size:14px;color:var(--vi)}",
  ".vlv-bk-tag{font:600 9px/1 var(--vmono);text-transform:uppercase;color:var(--v-info);opacity:.7}",
  ".vlv-bk-ctl{display:inline-flex;align-items:center;gap:5px}",
  ".vlv-bk-att{font:600 9px/1 var(--vmono);letter-spacing:.4px;color:var(--vi2);background:rgba(var(--vg-rgb),.08);border:1px solid rgba(var(--vg-rgb),.22);border-radius:6px;padding:4px 8px;cursor:pointer}",
  ".vlv-bk-att.on{color:var(--v-pos-i);border-color:color-mix(in srgb,var(--v-pos) 40%,transparent);background:color-mix(in srgb,var(--v-pos) 16%,transparent)}",
  ".vlv-current{display:flex;align-items:center;gap:8px;margin:0 0 9px;padding:6px 10px;border:1px solid var(--vle-gold-soft);border-radius:8px;background:rgba(var(--vg-rgb),.05)}",
  ".vlv-current-l{font:600 9px/1 var(--vmono);letter-spacing:.6px;text-transform:uppercase;opacity:.5}",
  ".vlv-current-n{font-family:var(--vserif);font-size:14px;color:var(--vle-gold);cursor:pointer}",
  ".vlv-current-n:hover{text-decoration:underline}",
  ".vlv-scopebar{display:flex;gap:5px;margin:0 0 8px}",
  ".vlv-scope{flex:1;font:600 9.5px/1 var(--vmono);letter-spacing:.4px;color:var(--vi2);background:rgba(var(--vg-rgb),.06);border:1px solid var(--vle-gold-soft);border-radius:8px;padding:7px 10px;cursor:pointer;opacity:.7;display:inline-flex;align-items:center;justify-content:center;gap:6px}",
  ".vlv-scope:hover{opacity:.95}.vlv-scope.on{opacity:1;color:var(--vle-gold);border-color:rgba(var(--vg-rgb),.5);background:rgba(var(--vg-rgb),.16)}",
  ".vlv-pending{margin:0 0 10px;padding:8px 10px;border:1px solid rgba(180,142,208,.34);border-radius:9px;background:rgba(180,142,208,.07)}",
  ".vlv-pending-h{font:600 9px/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--v-warn);display:flex;align-items:center;gap:6px;margin-bottom:6px}",
  ".vlv-pend{border-top:1px solid rgba(180,142,208,.18);padding:6px 0}",
  ".vlv-pend:first-of-type{border-top:none}",
  ".vlv-pend-top{display:flex;align-items:center;gap:7px}",
  ".vlv-pend-n{flex:1;font-family:var(--vserif);font-size:14px;color:var(--vi)}",
  ".vlv-pend-ctl{display:inline-flex;gap:4px}",
  ".vlv-pend-y,.vlv-pend-e,.vlv-pend-n2{width:20px;height:20px;display:grid;place-items:center;border-radius:5px;border:none;cursor:pointer;font-size:11px}",
  ".vlv-pend-y{background:color-mix(in srgb,var(--v-pos) 25%,transparent);color:var(--v-pos-i)}.vlv-pend-y:hover{background:color-mix(in srgb,var(--v-pos) 45%,transparent)}",
  ".vlv-pend-e{background:rgba(var(--vg-rgb),.14);color:var(--vle-gold)}.vlv-pend-e:hover{background:rgba(var(--vg-rgb),.28)}",
  ".vlv-pend-n2{background:rgba(255,255,255,.06);color:var(--vi2)}.vlv-pend-n2:hover{background:color-mix(in srgb,var(--v-neg) 25%,transparent);color:var(--v-neg-i)}",
  ".vlv-pend-c{font-size:11.5px;line-height:1.45;opacity:.75;margin-top:3px}",
  // ---- Customize panel (theme) ----
  ".vle-cz{display:flex;flex-direction:column;gap:7px}",
  ".vle-cz-h{font:600 calc(9.5px * var(--vscale))/1 var(--vmono);letter-spacing:1px;text-transform:uppercase;color:var(--vg);opacity:.7;margin-top:6px}",
  ".vle-cz-row{display:flex;align-items:center;gap:9px}",
  ".vle-cz-color{width:42px;height:34px;padding:0;border:1px solid rgba(var(--vg-rgb),.4);border-radius:9px;background:transparent;cursor:pointer}",
  ".vle-cz-hex{flex:1;font:600 13px/1 var(--vmono);letter-spacing:1px;text-transform:uppercase;color:var(--vi);background:rgba(12,10,8,.6);border:1px solid rgba(var(--vg-rgb),.26);border-radius:8px;padding:9px 11px;outline:none}",
  ".vle-cz-hex:focus{border-color:var(--vg)}",
  ".vle-cz-sel{flex:1;font-family:var(--vserif);font-size:15px;color:var(--vi);background:rgba(12,10,8,.6);border:1px solid rgba(var(--vg-rgb),.26);border-radius:8px;padding:9px 11px;cursor:pointer}",
  ".vle-cz-range{flex:1;accent-color:var(--vg);cursor:pointer}",
  ".vle-cz-sv{flex:none;min-width:48px;text-align:right;font:600 12px/1 var(--vmono);color:var(--vg)}",
  ".vle-skins{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:7px}",
  ".vle-skin{display:flex;flex-direction:column;align-items:center;gap:6px;padding:9px 6px;border:1px solid rgba(var(--vg-rgb),.2);border-radius:11px;background:rgba(var(--vg-rgb),.05);cursor:pointer;transition:border-color .15s,background .15s}",
  ".vle-skin:hover{background:rgba(var(--vg-rgb),.12)}",
  ".vle-skin.on{border-color:var(--sw);background:color-mix(in srgb,var(--sw) 16%,transparent);box-shadow:0 0 10px color-mix(in srgb,var(--sw) 35%,transparent)}",
  ".vle-skin-sw{width:100%;height:14px;border-radius:5px;background:linear-gradient(90deg,var(--sw),color-mix(in srgb,var(--sw) 35%,transparent));box-shadow:0 0 6px color-mix(in srgb,var(--sw) 50%,transparent)}",
  ".vle-skin-n{font:600 9.5px/1.2 var(--vmono);letter-spacing:.3px;text-align:center;color:var(--vi2)}",
  // theme gallery (Mode tab): big cards with a tiny wireframe sketch
  ".vle-modes{display:flex;flex-direction:column;gap:8px}",
  ".vle-mode{display:grid;grid-template-columns:64px 1fr;grid-template-rows:auto auto;gap:2px 12px;align-items:center;text-align:left;padding:11px 13px;border:1px solid rgba(var(--vg-rgb),.2);border-radius:12px;background:rgba(var(--vg-rgb),.05);cursor:pointer;transition:border-color .15s,background .15s}",
  ".vle-mode:hover{background:rgba(var(--vg-rgb),.12)}",
  ".vle-mode.on{border-color:var(--vg);background:rgba(var(--vg-rgb),.16);box-shadow:0 0 12px rgba(var(--vg-rgb),.28)}",
  ".vle-mode-sk{grid-row:1 / 3;width:64px;height:48px;border-radius:6px;border:1px solid rgba(var(--vg-rgb),.35);background:rgba(0,0,0,.25);display:flex;gap:3px;padding:5px;overflow:hidden}",
  ".vle-mode-sk i{background:rgba(var(--vg-rgb),.4);border-radius:2px;display:block}",
  ".vle-mode-sk.sk-default{flex-direction:column;gap:4px}.vle-mode-sk.sk-default i{height:8px}.vle-mode-sk.sk-default i:first-child{height:12px}",
  ".vle-mode-sk.sk-codex i{flex:1}.vle-mode-sk.sk-codex i:first-child{border-right:1px solid rgba(var(--vg-rgb),.5)}",
  ".vle-mode-sk.sk-phone{flex-direction:column;gap:4px}.vle-mode-sk.sk-phone i{height:7px}.vle-mode-sk.sk-phone i:last-child{margin-top:auto;height:9px}",
  ".vle-mode-sk.sk-hud{flex-direction:column;gap:4px}.vle-mode-sk.sk-hud i{height:5px;width:70%}.vle-mode-sk.sk-hud i:last-child{width:45%}",
  ".vle-mode-sk.sk-bloom{flex-direction:column;gap:5px;background:linear-gradient(160deg,#fff4f8,#f0e2ea)}.vle-mode-sk.sk-bloom i{height:8px;border-radius:9px;background:linear-gradient(90deg,rgba(217,140,171,.5),rgba(143,191,127,.45))}.vle-mode-sk.sk-bloom i:first-child{height:11px}",
  ".vle-mode-sk.sk-ember{flex-direction:column;gap:4px;background:radial-gradient(80% 60% at 30% 20%,rgba(184,169,255,.18),transparent),linear-gradient(160deg,#141428,#0a0a18)}.vle-mode-sk.sk-ember i{height:6px;border-radius:5px;background:linear-gradient(90deg,rgba(184,169,255,.55),rgba(143,214,200,.45));box-shadow:0 0 4px rgba(184,169,255,.4)}.vle-mode-sk.sk-ember i:first-child{height:9px}.vle-mode-sk.sk-ember i:last-child{width:60%}",
  // faewild sketch: a twilight glade with a fairy-light dot-string across the top
  // and pastel sage/lilac vine-bars; the first bar domes like a toadstool cap.
  ".vle-mode-sk.sk-faewild{flex-direction:column;gap:4px;background:radial-gradient(70% 60% at 80% 15%,rgba(240,198,90,.16),transparent),linear-gradient(160deg,#1e2422,#101a18)}.vle-mode-sk.sk-faewild i{height:6px;border-radius:5px;background:linear-gradient(90deg,rgba(143,191,136,.6),rgba(201,182,240,.45));box-shadow:0 0 4px rgba(143,191,136,.4)}.vle-mode-sk.sk-faewild i:first-child{height:9px;border-radius:9px 9px 4px 4px}.vle-mode-sk.sk-faewild i:last-child{width:55%}",
  // gatsby sketch: art deco gold on midnight with geometric stepped cards
  ".vle-mode-sk.sk-gatsby{flex-direction:column;gap:4px;background:radial-gradient(70% 60% at 50% 0%,rgba(212,175,55,.15),transparent),linear-gradient(160deg,#1a1410,#0a0a0a)}.vle-mode-sk.sk-gatsby i{height:6px;border-radius:0;background:linear-gradient(90deg,rgba(212,175,55,.7),rgba(212,175,55,.5));border:1px solid rgba(212,175,55,.4);box-shadow:0 0 4px rgba(212,175,55,.3)}.vle-mode-sk.sk-gatsby i:first-child{height:9px;clip-path:polygon(0 3px,3px 3px,6px 0,50% 0,calc(100% - 6px) 0,calc(100% - 3px) 3px,100% 3px,100% 100%,0 100%)}.vle-mode-sk.sk-gatsby i:last-child{width:65%}",
  // sumi sketch: minimalist ink wash with asymmetric strokes
  ".vle-mode-sk.sk-sumi{flex-direction:column;gap:5px;background:linear-gradient(160deg,#f5ead8,#ebe0ca)}.vle-mode-sk.sk-sumi i{height:6px;border-radius:0;border-left:3px solid rgba(26,20,16,.7);background:linear-gradient(90deg,rgba(26,20,16,.12),transparent 60%);box-shadow:2px 2px 0 rgba(26,20,16,.08)}.vle-mode-sk.sk-sumi i:first-child{height:8px}.vle-mode-sk.sk-sumi i:last-child{width:70%}",

  ".vle-mode-n{font:600 13px/1 var(--vserif);letter-spacing:.5px;color:var(--vi);align-self:end}",
  ".vle-mode-b{font-size:10.5px;line-height:1.4;opacity:.6;align-self:start}",
  // ---- layout picker + dashboard layout modes ----
  ".vle-lays{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:7px}",
  ".vle-lay{display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 6px;border:1px solid rgba(var(--vg-rgb),.2);border-radius:11px;background:rgba(var(--vg-rgb),.05);cursor:pointer;color:var(--vi2);transition:border-color .15s,background .15s}",
  ".vle-lay:hover{background:rgba(var(--vg-rgb),.12)}",
  ".vle-lay.on{border-color:var(--vg);background:rgba(var(--vg-rgb),.16);box-shadow:0 0 10px rgba(var(--vg-rgb),.3)}",
  ".vle-lay-g{font-size:20px;color:var(--vg);line-height:1}",
  ".vle-lay-n{font:600 9px/1.2 var(--vmono);letter-spacing:.3px;text-align:center}",
  // dashboard density (scales the section gap + inner padding)
  ".vld-inner{display:flex;flex-direction:column;gap:calc(16px * var(--vscale) * var(--vdensity,1))}",
  ".vld-inner[data-density='compact']{gap:calc(9px * var(--vscale))}",
  ".vld-inner[data-density='compact'] .vld-sec{padding:calc(8px * var(--vscale)) calc(10px * var(--vscale));gap:calc(5px * var(--vscale));border-radius:10px}",
  ".vld-inner[data-density='roomy']{gap:calc(22px * var(--vscale))}",
  ".vld-inner[data-density='roomy'] .vld-sec{padding:calc(16px * var(--vscale)) calc(17px * var(--vscale));gap:calc(11px * var(--vscale))}",
  ".vld-inner[data-density='roomy'] .vld-thought-q,.vld-inner[data-density='roomy'] .vld-rec{font-size:calc(15px * var(--vscale));line-height:1.65}",
  // 2-column (Director) — masonry-ish via CSS columns; collapses under 380px
  ".vld-inner[data-cols='2']{display:block;column-count:2;column-gap:calc(14px * var(--vscale))}",
  ".vld-inner[data-cols='2'] .vld-sec,.vld-inner[data-cols='2'] .vld-fold{break-inside:avoid;margin-bottom:calc(14px * var(--vscale));display:inline-block;width:100%}",
  "@container (max-width:380px){.vld-inner[data-cols='2']{column-count:1}}",
  ".vld-stage,.vlf-body,.vlf-tabbody{container-type:inline-size}",
  // collapsed sections (accordion)
  ".vld-fold{border:1px solid rgba(var(--vg-rgb),.14);border-radius:var(--vr3);background:linear-gradient(168deg,var(--vsurf-1),var(--vsurf-2));overflow:hidden}",
  ".vld-fold>summary{cursor:pointer;list-style:none;padding:calc(9px * var(--vscale)) calc(13px * var(--vscale));font:600 calc(10px * var(--vscale))/1 var(--vmono);letter-spacing:1.5px;text-transform:uppercase;color:var(--vg);opacity:.85}",
  ".vld-fold>summary::-webkit-details-marker{display:none}.vld-fold>summary::before{content:'\u25B8 '}",
  ".vld-fold[open]>summary::before{content:'\u25BE '}",
  ".vld-fold[open]>summary{border-bottom:1px solid rgba(var(--vg-rgb),.12)}",
  ".vld-fold-b{padding:calc(10px * var(--vscale)) calc(13px * var(--vscale))}",
  ".vld-fold-b .vld-sec{border:none;background:none;padding:0}",

  // ============ "NOW" LAYOUTS (mockups 25/26/28) — data-layout keyed, chrome-agnostic ============
  // These style the existing sections into a composed page. Purely presentational
  // (order comes from the LayoutDef); they degrade to a plain stack if a rule is
  // unsupported, and all animation is already gated by the global motion switch.

  // ---- Living Page (25): an illuminated manuscript page ----
  // full-bleed scene header, tension as a gilt rule, thoughts as pull-quotes,
  // bonds as a center-zero meter, Latest as a colophon trail.
  ".vld-inner[data-layout='livingpage']{gap:calc(20px * var(--vscale))}",
  ".vld-inner[data-layout='livingpage'] .vld-sec--hero{border-radius:var(--vr3);padding:calc(20px * var(--vscale)) calc(20px * var(--vscale)) calc(16px * var(--vscale))}",
  // tension collapses to a single gilt rule under the header
  ".vld-inner[data-layout='livingpage'] .vld-sec--tension{border:none;background:none;padding:0}",
  ".vld-inner[data-layout='livingpage'] .vld-sec--tension .vld-h{font-size:var(--vt-eyebrow);opacity:.7}",
  // present thoughts read as centered pull-quotes with a hanging mark
  ".vld-inner[data-layout='livingpage'] .vld-thought{border-left:none;padding-left:0;text-align:center;margin-top:9px}",
  ".vld-inner[data-layout='livingpage'] .vld-thought-q{font-size:calc(16px * var(--vscale));line-height:1.6}",
  ".vld-inner[data-layout='livingpage'] .vld-thought-q::before{content:'\\201C';opacity:.4;margin-right:2px}",
  ".vld-inner[data-layout='livingpage'] .vld-thought-q::after{content:'\\201D';opacity:.4;margin-left:2px}",
  // Latest becomes marginalia: a slim ruled column
  ".vld-inner[data-layout='livingpage'] .vld-rec{padding-left:calc(16px * var(--vscale));border-left:2px solid rgba(var(--vg-rgb),.2)}",
  // stats read as a quiet colophon ribbon at the foot
  ".vld-inner[data-layout='livingpage'] .vld-sec:last-child{text-align:center;font-style:italic;opacity:.8}",

  // ---- Orrery HUD (26): a living-system readout ----
  // v1 (bounded): scene = the core panel, present cast = an orbit ring, tension =
  // a corona rule, telemetry (threads/parallel/recent/stats) stacks beneath. Bond
  // arcs are intentionally NOT drawn here (no JS layout engine); the radial ring
  // is pure CSS and falls back to a stack on narrow widths.
  ".vld-inner[data-layout='orrery'] .vld-sec--hero{text-align:center;border-radius:calc(24px * var(--vscale))}",
  ".vld-inner[data-layout='orrery'] .vld-sec--tension{border:none;background:none;padding:0;position:relative}",
  ".vld-inner[data-layout='orrery'] .vld-sec--tension .vld-tension{border-radius:var(--rpill)}",
  // present cast as a wrap of orbiting medallions (chips of avatar+name)
  "@container (min-width:440px){.vld-inner[data-layout='orrery'] .vld-sec--present .vld-pcs{display:flex;flex-wrap:wrap;justify-content:center;gap:calc(10px * var(--vscale))}}",
  "@container (min-width:440px){.vld-inner[data-layout='orrery'] .vld-sec--present .vld-pc{flex-direction:column;align-items:center;text-align:center;width:calc(128px * var(--vscale));background:radial-gradient(60% 60% at 50% 30%,rgba(var(--vg-rgb),.1),transparent);border-left-width:1px;border-radius:calc(18px * var(--vscale))}}",
  "@container (min-width:440px){.vld-inner[data-layout='orrery'] .vld-sec--present .vld-thought{border-left:none;padding-left:0;text-align:center}}",

  // ---- Open Book (28): a two-leaf spread ----
  // reuses the 2-col engine; the center gutter + page shadow read like a bound
  // book. World facts sit on the left leaf, players on the right (LayoutDef order).
  ".vld-inner[data-layout='openbook']{position:relative;column-gap:calc(30px * var(--vscale));padding:0 calc(6px * var(--vscale))}",
  ".vld-inner[data-layout='openbook']::before{content:'';position:absolute;top:0;bottom:0;left:50%;width:2px;transform:translateX(-50%);background:linear-gradient(180deg,transparent,rgba(var(--vg-rgb),.35) 12%,rgba(var(--vg-rgb),.35) 88%,transparent);pointer-events:none}",
  "@container (max-width:380px){.vld-inner[data-layout='openbook']::before{display:none}}",

  // ============ FLOAT FORM FACTORS (chrome-scoped; .vlf only, drawer untouched) ============
  // ---- FANTASY · Codex (illuminated + 2-col): an open book with a center gutter ----
  "html[data-vle-chrome='illuminated'] .vlf .vld-inner[data-cols='2']{position:relative;column-gap:calc(26px * var(--vscale));padding:0 calc(4px * var(--vscale))}",
  "html[data-vle-chrome='illuminated'] .vlf .vld-inner[data-cols='2']::before{content:'';position:absolute;top:0;bottom:0;left:50%;width:2px;transform:translateX(-50%);background:linear-gradient(180deg,transparent,rgba(var(--vg-rgb),.4) 12%,rgba(var(--vg-rgb),.4) 88%,transparent);box-shadow:0 0 10px rgba(var(--vg-rgb),.25);pointer-events:none}",
  "html[data-vle-chrome='illuminated'] .vlf .vld-inner[data-cols='2']::after{content:'';position:absolute;bottom:0;left:0;right:0;height:18px;background:radial-gradient(60% 100% at 0% 100%,rgba(0,0,0,.22),transparent 70%),radial-gradient(60% 100% at 100% 100%,rgba(0,0,0,.22),transparent 70%);pointer-events:none}",
  // illuminated tension → gilded vine fill
  "html[data-vle-chrome='illuminated'] .vlf .vld-tension{background:rgba(var(--vg-rgb),.1)}",
  "html[data-vle-chrome='illuminated'] .vlf .vld-tension-f{background:repeating-linear-gradient(90deg,var(--vg) 0 5px,rgba(var(--vg-rgb),.5) 5px 10px)!important;box-shadow:0 0 8px rgba(var(--vg-rgb),.45)}",
  // ---- FANTASY · Scroll (illuminated + 1-col 'scroll' layout): unfurled parchment ----
  "html[data-vle-chrome='illuminated'] .vlf .vld-inner[data-layout='scroll']{-webkit-mask-image:linear-gradient(180deg,transparent,#000 14px,#000 calc(100% - 14px),transparent);mask-image:linear-gradient(180deg,transparent,#000 14px,#000 calc(100% - 14px),transparent)}",
  "html[data-vle-chrome='illuminated'] .vlf .vld-inner[data-layout='scroll'] .vld-sec{border:none;background:none;padding-left:calc(6px * var(--vscale));padding-right:calc(6px * var(--vscale))}",
  "html[data-vle-chrome='illuminated'] .vlf .vld-inner[data-layout='scroll'] .vld-sec+.vld-sec{border-top:1px dotted rgba(var(--vg-rgb),.4);margin-top:calc(10px * var(--vscale));padding-top:calc(12px * var(--vscale))}",

  // ---- MODERN · Phone (modern chrome + 'switch' layout): a device ----
  "html[data-vle-chrome='modern'] .vlf .vld-phone{display:flex;flex-direction:column;min-height:100%;max-width:440px;margin:0 auto}",
  ".vld-phone-body{flex:1;display:flex;flex-direction:column;gap:calc(8px * var(--vscale));padding-bottom:calc(8px * var(--vscale))}",
  // bottom dock — app-style section switcher
  ".vld-dock{position:sticky;bottom:0;display:flex;gap:2px;justify-content:space-around;padding:6px 4px;margin-top:auto;background:linear-gradient(180deg,transparent,var(--vsurf-2));backdrop-filter:blur(6px);border-top:1px solid rgba(var(--vg-rgb),.16)}",
  ".vld-dock-b{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;background:none;border:0;border-radius:10px;padding:6px 2px;cursor:pointer;color:var(--vi2);opacity:.6;transition:opacity .15s,background .15s}",
  ".vld-dock-b:hover{opacity:.9}",
  ".vld-dock-b.on{opacity:1;color:var(--vg);background:rgba(var(--vg-rgb),.14)}",
  ".vld-dock-g{font-size:calc(15px * var(--vscale));line-height:1}",
  ".vld-dock-l{font:600 7.5px/1 var(--vmono);letter-spacing:.4px;text-transform:uppercase}",
  // modern present-cast → notification cards
  "html[data-vle-chrome='modern'] .vlf .vld-pc{border:none;border-radius:14px;background:rgba(255,255,255,.05);box-shadow:0 1px 3px rgba(0,0,0,.25)}",
  // phone status strip (status section as the 'lock screen' header)
  "html[data-vle-chrome='modern'] .vlf .vld-phone .vld-statbar{justify-content:center;gap:14px}",

  // ---- FUTURISTIC · Oracle HUD (futuristic chrome): tactical telemetry ----
  "html[data-vle-chrome='futuristic'] .vlf .vld-sec{border:none;background:none;border-left:2px solid rgba(var(--vg-rgb),.5);border-radius:0;padding-left:calc(10px * var(--vscale))}",
  "html[data-vle-chrome='futuristic'] .vlf .vld-h{position:relative;padding-left:14px}",
  "html[data-vle-chrome='futuristic'] .vlf .vld-h::before{content:'\u25B7';position:absolute;left:0;color:var(--vg);font-size:9px;top:1px}",
  "html[data-vle-chrome='futuristic'] .vlf .vld-pc{border:none;border-radius:0;border-left:2px solid rgba(var(--vg-rgb),.45);background:linear-gradient(90deg,rgba(var(--vg-rgb),.06),transparent)}",
  "html[data-vle-chrome='futuristic'] .vlf .vld-loc{font-family:var(--vmono);letter-spacing:1px;text-transform:uppercase}",
  "html[data-vle-chrome='futuristic'] .vlf .vld-thread-s{font-family:var(--vmono);text-transform:uppercase;letter-spacing:.5px}",
  // HUD system footer (recall mode + injection chars), rendered by dashboard
  ".vld-sysfoot{margin-top:calc(10px * var(--vscale));padding-top:8px;border-top:1px solid rgba(var(--vg-rgb),.25);font:600 8.5px/1.4 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--vg);opacity:.7;display:flex;gap:14px;flex-wrap:wrap}",
  "html:not([data-vle-chrome='futuristic']) .vlf .vld-sysfoot{display:none}",

  // ---- Customize panel: tabs, sliders, reset, custom-layout editor ----
  ".vle-czt-bar{display:flex;gap:3px;flex-wrap:wrap;margin-bottom:10px;border-bottom:1px solid rgba(var(--vg-rgb),.18);padding-bottom:8px}",
  ".vle-czt{font:600 9.5px/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--vi2);background:transparent;border:1px solid transparent;border-radius:7px;padding:6px 10px;cursor:pointer;opacity:.7}",
  ".vle-czt:hover{opacity:1}.vle-czt.on{opacity:1;color:var(--vg);background:rgba(var(--vg-rgb),.14);border-color:rgba(var(--vg-rgb),.35)}",
  // 'advanced' divider in the customize tab strip (separates Look from the cockpit)
  ".vle-czt-sep{align-self:center;font:600 8px/1 var(--vmono);letter-spacing:1.5px;text-transform:uppercase;color:var(--vi2);opacity:.4;padding:0 4px 0 8px;margin-left:4px;border-left:1px solid rgba(var(--vg-rgb),.2)}",
  ".vle-cz-rst{margin-left:auto;cursor:pointer;opacity:.5;font-size:13px}.vle-cz-rst:hover{opacity:1;color:var(--vg)}",
  ".vle-cz-h{display:flex;align-items:center}",
  ".vle-cz-btn{font:600 9.5px/1 var(--vmono);letter-spacing:.4px;text-transform:uppercase;color:var(--vi2);background:rgba(var(--vg-rgb),.08);border:1px solid rgba(var(--vg-rgb),.24);border-radius:8px;padding:7px 11px;cursor:pointer}",
  ".vle-cz-btn:hover{background:rgba(var(--vg-rgb),.2);color:var(--vg)}",
  ".vle-cz-btn.danger:hover{color:#e09090;border-color:rgba(201,106,106,.4);background:rgba(201,106,106,.1)}",
  ".vle-cz-chk{display:inline-flex;align-items:center;gap:6px;font:500 12px/1 var(--vmono);color:var(--vi2);cursor:pointer}",
  ".vle-cz-chk input{accent-color:var(--vg);cursor:pointer}",
  ".vle-cz-mini{font:600 9px/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;opacity:.6}",
  ".vle-cz-note{font-size:11px;line-height:1.5;opacity:.6;padding:4px 0}",
  // custom layout editor
  ".vle-clays{display:flex;flex-direction:column;gap:4px;margin-bottom:8px}",
  ".vle-clr{display:flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid rgba(var(--vg-rgb),.16);border-radius:8px;background:rgba(var(--vg-rgb),.05)}",
  ".vle-clr.off{opacity:.5}",
  ".vle-clr-up,.vle-clr-dn{cursor:pointer;color:var(--vg);opacity:.7;font-size:12px;width:16px;text-align:center}",
  ".vle-clr-up:hover,.vle-clr-dn:hover{opacity:1}.vle-clr-up[data-dis],.vle-clr-dn[data-dis]{opacity:.2;pointer-events:none}",
  ".vle-clr-n{flex:1;font-family:var(--vserif);font-size:14px;color:var(--vi)}",
  ".vle-clr-b{font:600 9px/1 var(--vmono);text-transform:uppercase;letter-spacing:.4px;color:var(--vi2);background:rgba(var(--vg-rgb),.08);border:1px solid rgba(var(--vg-rgb),.2);border-radius:6px;padding:4px 7px;cursor:pointer}",
  ".vle-clr-b.on{color:var(--vg);border-color:rgba(var(--vg-rgb),.45);background:rgba(var(--vg-rgb),.18)}",
  // controller-traversal trace (flat + tree drill)
  ".vle-inj-trace{margin:4px 0 2px;padding:6px 8px;border-left:2px solid rgba(var(--vg-rgb),.35);background:rgba(var(--vg-rgb),.05);border-radius:0 6px 6px 0;font:500 10px/1.5 var(--vmono)}",
  ".vle-inj-scene{color:var(--vle-dim);font-style:italic;margin-bottom:4px}",
  ".vle-inj-cands{color:var(--vle-dim);margin-top:3px}",
  ".vle-inj-cand{display:inline-block;margin:2px 4px 0 0;padding:1px 5px;border-radius:3px;border:1px solid rgba(255,255,255,.12);color:var(--vle-dim);font-size:9px}",
  ".vle-inj-cand.on{color:var(--vle-gold);border-color:rgba(var(--vg-rgb),.5);background:rgba(var(--vg-rgb),.12)}",
  ".vle-inj-cand.exp{color:#8fb0c9;border-color:rgba(143,176,201,.4)}",
  ".vle-inj-step{display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:3px 0;border-top:1px dashed rgba(255,255,255,.08)}",
  ".vle-inj-stepn{color:var(--vle-gold);font-weight:600;margin-right:4px}",
  ".vle-inj-stepf{color:var(--vle-dim);margin-right:6px;font-size:9px}",
  ".vle-inj-tree{border-left-color:rgba(var(--vg-rgb),.5)}",
  // keyboard focus ring (a11y): one rule for the whole shell + graph nodes
  ".vle-root :focus-visible,.vlf :focus-visible,.vlfm :focus-visible{outline:2px solid var(--vg);outline-offset:2px;border-radius:var(--vr1)}",
  ".vlf-launch:focus-visible{outline:2px solid var(--vg);outline-offset:2px}",
  ".vlg-node:focus-visible{outline:none}.vlg-node:focus-visible .vlg-node-c{stroke:var(--vg);stroke-width:3.4}.vlg-node:focus-visible .vlg-node-l{opacity:1}",
  // factions
  ".vle-sec-title{font:600 11px/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--vle-gold);opacity:.85;margin-right:auto}",
  ".vle-sec-gap{margin-top:14px}",
  ".vle-fac-av{background:rgba(var(--vg-rgb),.16);color:var(--vle-gold)}",
  ".vle-fac-stand{font:600 9px/1 var(--vmono);text-transform:uppercase;letter-spacing:.4px}",
  ".vle-fac-stand.warm{color:var(--v-pos-i)}", ".vle-fac-stand.cool{color:var(--v-neg-i)}", ".vle-fac-stand.neu{color:var(--vle-dim)}",
  ".vle-fac-meter{display:block;flex:1;max-width:160px}",
  ".vle-fac-standrow{display:flex;align-items:center;gap:10px;margin-top:6px}",
  ".vle-fac-standrow .vle-fac-stand{flex:none}",
  ".vle-fac-standrow .vle-bar-l{display:none}",
  ".vle-fac-mems{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}",
  ".vle-fac-mem{display:inline-flex;align-items:center;gap:3px;font:500 9px/1.4 var(--vmono);padding:2px 4px;border-radius:var(--vr1);border:1px solid rgba(255,255,255,.12);color:var(--vle-dim)}",
  ".vle-fac-x{background:none;border:0;color:var(--vle-dim);cursor:pointer;font-size:11px;line-height:1;padding:0 0 0 2px;opacity:.6}",
  ".vle-fac-x:hover{opacity:1;color:var(--v-neg-i)}",
  ".vle-fac-more{font:500 9px/1.4 var(--vmono);color:var(--vle-dim);opacity:.7}",
  ".vle-dim{opacity:.6}",
  // status-on-avatar: cards self-describe presence (signal lands where the eye does)
  ".vle-card--present .vle-av{box-shadow:0 0 0 2px var(--vg),0 0 9px rgba(var(--vg-rgb),.5)}",
  ".vle-card--active .vle-av{box-shadow:0 0 0 2px rgba(var(--vg-rgb),.45)}",
  ".vle-card--mentioned .vle-av{box-shadow:inset 0 0 0 1px rgba(var(--vg-rgb),.3);opacity:.8}",
  ".vle-card--added .vle-av{opacity:.55}",
  ".vle-card--mentioned,.vle-card--added{opacity:.92}",

  // ================= THEME: MODERN ("The App") — float + drawer =================
  // Calm, flat, sans, rounded. Drawer (.vle-root) gets equal treatment to the float.
  "html[data-vle-chrome='modern'] .vle-root{font-family:var(--vserif)}",
  // head → app title, no glow; tab bar → flat pills with an accent underline
  // H3 modern nav panel: a clean flat card, no wash, soft shadow like the app.
  "html[data-vle-chrome='modern'] .vle-navpanel{background:color-mix(in srgb,var(--vi) 3%,transparent);border-color:color-mix(in srgb,var(--vi) 12%,transparent);box-shadow:0 1px 3px rgba(0,0,0,.12)}",
  "html[data-vle-chrome='modern'] .vle-navpanel .vle-head{border-bottom:none}",
  "html[data-vle-chrome='modern'] .vle-head{border-bottom:none;font-weight:700;letter-spacing:0}",
  "html[data-vle-chrome='modern'] .vle-mark{text-shadow:none}",
  "html[data-vle-chrome='modern'] .vle-tabbtn{border-radius:var(--rpill);text-transform:none;letter-spacing:.2px;font-family:var(--vserif);font-size:calc(13px * var(--vscale));font-weight:600}",
  "html[data-vle-chrome='modern'] .vle-tabbtn.on{background:color-mix(in srgb,var(--vg) 16%,transparent);border-color:transparent;position:relative}",
  "html[data-vle-chrome='modern'] .vle-tabbtn.on::after{content:'';position:absolute;left:18%;right:18%;bottom:-3px;height:2px;border-radius:2px;background:var(--vg);transition:left .2s,right .2s}",
  // cards → soft, rounded, flat shadow (no gold hairline shouting)
  "html[data-vle-chrome='modern'] .vle-card,html[data-vle-chrome='modern'] .vle-rel-card{border-color:color-mix(in srgb,var(--vg) 10%,transparent);border-radius:18px;box-shadow:0 1px 3px rgba(0,0,0,.25)}",
  // hero scene + soft top glow (recolor the bloom to the cool accent)
  "html[data-vle-chrome='modern'] .vlf-frame::after{background:radial-gradient(120% 80% at 50% -20%,rgba(var(--vg-rgb),.16),transparent 70%)}",
  // === MODERN = a continuous card-app scroll (no chopped one-section switch) ===
  // sections are TRANSPARENT groups; the label floats above; only the items are
  // cards. This is what fixes the 'disjointed boxes' look.
  "html[data-vle-chrome='modern'] .vld{gap:calc(20px * var(--vscale))}",
  "html[data-vle-chrome='modern'] .vld-inner{display:flex;flex-direction:column;gap:calc(20px * var(--vscale))}",
  "html[data-vle-chrome='modern'] .vld-sec{border:none!important;background:none!important;box-shadow:none!important;padding:0!important;gap:calc(10px * var(--vscale))}",
  // section label = a quiet heading above the group (not a chip inside a box)
  "html[data-vle-chrome='modern'] .vld-h{font:700 calc(13px * var(--vscale))/1.2 var(--vserif);letter-spacing:1px;text-transform:uppercase;color:var(--vi);opacity:1;padding:0 calc(4px * var(--vscale));margin-bottom:calc(2px * var(--vscale))}",
  "html[data-vle-chrome='modern'] .vld-h::before{display:none!important}",
  "html[data-vle-chrome='modern'] .vld-n{font:700 calc(13px * var(--vscale))/1 var(--vserif);color:var(--vg);background:none;padding:0;margin-left:6px}",
  // the HERO is itself a real card (the only section that is a box)
  "html[data-vle-chrome='modern'] .vld-sec--hero{position:relative;background:linear-gradient(180deg,color-mix(in srgb,var(--vi) 6%,transparent),color-mix(in srgb,var(--vi) 3%,transparent))!important;border:1px solid color-mix(in srgb,var(--vg) 12%,transparent)!important;border-radius:22px!important;box-shadow:0 1px 3px rgba(0,0,0,.25)!important;padding:calc(16px * var(--vscale)) calc(18px * var(--vscale))!important}",
  "html[data-vle-chrome='modern'] .vld-hero-eyebrow{font:700 calc(10.5px * var(--vscale))/1 var(--vmono);letter-spacing:1.5px;text-transform:uppercase;color:var(--vi2);opacity:.7;margin-bottom:calc(8px * var(--vscale))}",
  "html[data-vle-chrome='modern'] .vld-sec--hero .vld-hero{font-weight:700;letter-spacing:-.3px;font-size:calc(23px * var(--vscale))}",
  "html[data-vle-chrome='modern'] .vld-sec--hero .vld-hero::before{display:none}",
  "html[data-vle-chrome='modern'] .vld-meta{margin-top:calc(6px * var(--vscale));opacity:.8}",
  // tension pill, top-right of the hero card
  "html[data-vle-chrome='modern'] .vld-hero-tension{position:absolute;top:calc(16px * var(--vscale));right:calc(16px * var(--vscale));display:inline-flex;align-items:center;gap:6px;font:600 calc(12px * var(--vscale))/1 var(--vserif);color:var(--v-press-i);background:color-mix(in srgb,var(--v-press) 16%,transparent);border-radius:var(--rpill);padding:6px 11px}",
  "html[data-vle-chrome='modern'] .vld-hero-tdot{width:6px;height:6px;border-radius:50%;background:var(--v-press)}",
  // present cast → notification cards; avatars fully round with presence ring
  "html[data-vle-chrome='modern'] .vld-pc{border:none;border-radius:18px;background:color-mix(in srgb,var(--vi) 5%,transparent);box-shadow:0 1px 3px rgba(0,0,0,.22);padding:calc(13px * var(--vscale)) calc(15px * var(--vscale))}",
  "html[data-vle-chrome='modern'] .vld-pc+.vld-pc{margin-top:calc(10px * var(--vscale))}",
  // threads → soft filled cards; parallel stays a bare on-rail timeline (no re-box)
  "html[data-vle-chrome='modern'] .vld-thr{border-radius:16px;background:color-mix(in srgb,var(--vi) 4%,transparent);border-color:color-mix(in srgb,var(--vi) 8%,transparent)}",
  // 'Latest' → a real activity feed: a connector line + colored nodes
  "html[data-vle-chrome='modern'] .vld-sec--recent,html[data-vle-chrome='modern'] .vld-rec{position:relative}",
  "html[data-vle-chrome='modern'] .vld-rec{margin-left:calc(7px * var(--vscale));padding:calc(2px * var(--vscale)) 0 calc(12px * var(--vscale)) calc(18px * var(--vscale));border-left:2px solid color-mix(in srgb,var(--vg) 18%,transparent)}",
  "html[data-vle-chrome='modern'] .vld-rec:last-child{border-left-color:transparent;padding-bottom:0}",
  "html[data-vle-chrome='modern'] .vld-rec::before{content:'';position:absolute;left:-6px;top:calc(3px * var(--vscale));width:10px;height:10px;border-radius:50%;background:currentColor;box-shadow:0 0 0 3px var(--vsurf-1)}",
  "html[data-vle-chrome='modern'] .vld-rec--journal::before{color:var(--v-pos-i)}html[data-vle-chrome='modern'] .vld-rec--knew::before{color:var(--v-info)}html[data-vle-chrome='modern'] .vld-rec--secret::before{color:var(--v-neg-i)}html[data-vle-chrome='modern'] .vld-rec--shift::before{color:var(--v-press-i)}",
  "html[data-vle-chrome='modern'] .vld-rec-k{display:block;font:700 calc(10px * var(--vscale))/1 var(--vmono);letter-spacing:.6px;text-transform:uppercase;color:var(--vi2);opacity:.7;margin-bottom:3px}",
  // float frame already flat (existing rules); round the drawer launcher too
  "html[data-vle-chrome='modern'] .vlf-title{font-weight:700}",
  // bond card axis labels take the illuminated rubric treatment
  "html[data-vle-chrome='illuminated'] .vle-bc-axl{font-variant:small-caps;letter-spacing:1.5px;opacity:.8}",
  // present-card avatar theme skins (shared structure, themed material)
  "html[data-vle-chrome='illuminated'] .vld-pc-av{border-radius:50%;background:radial-gradient(40% 35% at 40% 35%,#b8403a,#6e1f1c);border-color:#4a1513;color:#f0c4c0}",
  "html[data-vle-chrome='modern'] .vld-pc-av{border-width:2px}",
  "html[data-vle-chrome='futuristic'] .vld-pc-av{background:transparent;border:1.5px solid var(--vg);box-shadow:0 0 8px rgba(var(--vg-rgb),.4);border-radius:50%;color:var(--vg);position:relative}",
  "html[data-vle-chrome='futuristic'] .vld-pc-av::before{content:'';position:absolute;left:-3px;right:-3px;top:50%;height:1px;background:var(--vg)}",
  "html[data-vle-chrome='futuristic'] .vld-pc-av::after{content:'';position:absolute;top:-3px;bottom:-3px;left:50%;width:1px;background:var(--vg)}",
  "html[data-vle-chrome='futuristic'] .vld-pc-n{font-family:var(--vmono);text-transform:uppercase;letter-spacing:1px;font-size:calc(14px * var(--vscale))}",
  "html[data-vle-chrome='futuristic'] .vld-thought-q,html[data-vle-chrome='futuristic'] .vld-pc-status{font-family:var(--vmono);font-style:normal}",

  // ================= THEME: FANTASY ("The Codex") — float + drawer =================
  // Deepens the illuminated chrome. Float keeps BOTH Codex (2-col) + Scroll (1-col)
  // forms (rules above); these add ornament, drop-caps, rubrics, heraldry, seal.
  // --- drop-cap on the hero scene line (float dashboard + drawer Now share it) ---
  "html[data-vle-chrome='illuminated'] .vld-hero::before{content:none}",
  "html[data-vle-chrome='illuminated'] .vld-hero::first-letter{font-size:2.6em;line-height:.8;float:left;margin:4px 8px 0 0;padding:4px 8px;color:var(--v-neg-i);background:color-mix(in srgb,var(--v-neg) 14%,transparent);border:1px solid color-mix(in srgb,var(--v-neg) 30%,transparent);border-radius:var(--vr1);font-family:'Cinzel',var(--vserif);font-style:normal}",
  // --- rubric section eyebrows: small-caps, red, hairline rule + fleurons ---
  "html[data-vle-chrome='illuminated'] .vld-h,html[data-vle-chrome='illuminated'] .vle-sec-h{color:var(--v-neg-i);font-variant:normal;text-transform:uppercase;letter-spacing:2px}",
  "html[data-vle-chrome='illuminated'] .vld-h::before,html[data-vle-chrome='illuminated'] .vle-sec-h::before{content:'\\2766 ';opacity:.7}",
  // --- portrait medallions: present-cast avatars round, double-gilt, haloed ---
  "html[data-vle-chrome='illuminated'] .vle-av{border-radius:50%;box-shadow:0 0 0 1px rgba(var(--vg-rgb),.6),0 0 0 4px rgba(0,0,0,.25),0 0 0 5px rgba(var(--vg-rgb),.3)}",
  "html[data-vle-chrome='illuminated'] .vle-card--present .vle-av{box-shadow:0 0 0 2px var(--vg),0 0 0 5px rgba(var(--vg-rgb),.35),0 0 12px rgba(var(--vg-rgb),.5)}",
  // --- heraldic bond card: split-shield tint + gilded base ---
  "html[data-vle-chrome='illuminated'] .vle-rel-card{background:linear-gradient(180deg,rgba(var(--vg-rgb),.07),transparent 60%),var(--vsurf-1);border-color:rgba(var(--vg-rgb),.35);border-bottom-width:2px;position:relative}",
  "html[data-vle-chrome='illuminated'] .vle-rel-pair{font-variant:small-caps;letter-spacing:1px}",
  // --- wax-seal close button (float only; the drawer has no frame) ---
  "html[data-vle-chrome='illuminated'] .vlf-x{border-radius:50%;background:radial-gradient(40% 35% at 40% 35%,#b8403a,#6e1f1c);border:1px solid #4a1513;color:#f0c4c0;box-shadow:0 2px 6px rgba(0,0,0,.5),inset 0 1px 2px rgba(255,200,190,.3);text-shadow:0 1px 1px rgba(0,0,0,.5)}",
  "html[data-vle-chrome='illuminated'] .vlf-x:hover{background:radial-gradient(40% 35% at 40% 35%,#c84a44,#7e2622);color:#ffd8d2;border-color:#4a1513}",
  // --- drawer 'binding': a gilt top rule + parchment already via texture default ---
  "html[data-vle-chrome='illuminated'] .vlf-title{font-family:var(--vserif);font-style:italic;letter-spacing:1px}",
  "html[data-vle-chrome='illuminated'] .vle-navpanel{border:2px solid rgba(var(--vg-rgb),.35);border-radius:6px;background:radial-gradient(120% 140% at 0% 0%,rgba(var(--vg-rgb),.1),transparent 62%);box-shadow:inset 0 0 0 1px rgba(var(--vg-rgb),.15)}",
  "html[data-vle-chrome='illuminated'] .vle-head{border-bottom:2px solid rgba(var(--vg-rgb),.3);box-shadow:0 1px 0 rgba(var(--vg-rgb),.15);font-family:var(--vserif);font-style:italic}",
  "html[data-vle-chrome='illuminated'] .vle-stats{font-family:var(--vserif);font-style:italic;font-variant:small-caps;letter-spacing:1px;text-transform:lowercase;opacity:.7}",
  "html[data-vle-chrome='modern'] .vle-stats{font-family:var(--vserif);font-weight:600;letter-spacing:0;opacity:.65}",
  // --- ribbon-bookmark tabs (both surfaces' nav): notched bottom ---
  "html[data-vle-chrome='illuminated'] .vle-tabbtn.on{border-radius:3px 3px 0 0;position:relative}",
  "html[data-vle-chrome='illuminated'] .vle-tabbtn.on::after{content:'';position:absolute;left:0;right:0;bottom:-1px;height:0;border-left:5px solid transparent;border-right:5px solid transparent}",
  // --- corner flourishes on the float frame (additive to the existing double-rule) ---
  "html[data-vle-chrome='illuminated'] .vlf-bar::before{content:'\\2766';position:absolute;left:calc(16px * var(--vscale));top:50%;transform:translateY(-50%);color:var(--vg);opacity:.4;font-size:11px;pointer-events:none}",

  // ================= THEME: FUTURISTIC ("Oracle HUD") — float + drawer =================
  // Deepens the futuristic chrome (sharp corners/edge-glow/mono caps already exist).
  // grid void backdrop on both roots
  "html[data-vle-chrome='futuristic'] .vle-root{background-image:linear-gradient(rgba(var(--vg-rgb),.05) 1px,transparent 1px),linear-gradient(90deg,rgba(var(--vg-rgb),.05) 1px,transparent 1px);background-size:22px 22px}",
  // drawer head → telemetry bar
  "html[data-vle-chrome='futuristic'] .vle-navpanel{border-radius:2px;border-color:rgba(var(--vg-rgb),.35);background:linear-gradient(rgba(var(--vg-rgb),.05),transparent),repeating-linear-gradient(0deg,rgba(var(--vg-rgb),.05) 0 1px,transparent 1px 14px),repeating-linear-gradient(90deg,rgba(var(--vg-rgb),.05) 0 1px,transparent 1px 14px);box-shadow:inset 0 0 0 1px rgba(var(--vg-rgb),.12)}",
  "html[data-vle-chrome='futuristic'] .vle-head{font-family:'Orbitron',var(--vmono);text-transform:uppercase;letter-spacing:3px;border-bottom:1px solid rgba(var(--vg-rgb),.4);font-size:calc(16px * var(--vscale))}",
  "html[data-vle-chrome='futuristic'] .vle-head::before{content:'\\25E4 ';color:var(--vg)}",
  "html[data-vle-chrome='futuristic'] .vle-stats{color:var(--vg);opacity:.8}",
  // tab bar → segmented HUD buttons with bracket corners
  "html[data-vle-chrome='futuristic'] .vle-tabbtn{border-radius:0;border-color:rgba(var(--vg-rgb),.25);letter-spacing:2px}",
  "html[data-vle-chrome='futuristic'] .vle-tabbtn.on{border-color:var(--vg);box-shadow:inset 0 0 0 1px rgba(var(--vg-rgb),.4),0 0 10px rgba(var(--vg-rgb),.25);background:rgba(var(--vg-rgb),.12)}",
  "html[data-vle-chrome='futuristic'] .vle-tabbtn.on::before{content:'\\25B7 '}",
  // cards → bracketed, sharp, edge-lit
  "html[data-vle-chrome='futuristic'] .vle-card,html[data-vle-chrome='futuristic'] .vld-sec,html[data-vle-chrome='futuristic'] .vle-rel-card{border-radius:0;border-color:rgba(var(--vg-rgb),.3);border-left:2px solid var(--vg);background:linear-gradient(90deg,rgba(var(--vg-rgb),.06),transparent)}",
  "html[data-vle-chrome='futuristic'] .vld-h{font-family:var(--vmono);text-transform:uppercase;letter-spacing:2px}",
  "html[data-vle-chrome='futuristic'] .vld-h::before{content:'\\25B7 ';color:var(--vg);font-size:9px}",
  // hero → mono caps telemetry
  "html[data-vle-chrome='futuristic'] .vlf-title{font-family:'Orbitron',var(--vmono)}",
  "html[data-vle-chrome='futuristic'] .vld-hero{font-family:'Orbitron',var(--vmono);text-transform:uppercase;letter-spacing:1px;font-size:calc(20px * var(--vscale));text-shadow:0 0 8px rgba(var(--vg-rgb),.4)}",
  "html[data-vle-chrome='futuristic'] .vld-hero::before{content:'\\25B7 '}",
  // targeting-reticle avatars: transparent center, crosshair ticks, ring
  "html[data-vle-chrome='futuristic'] .vle-av{border-radius:50%;background:transparent;border:1.5px solid var(--vg);box-shadow:0 0 8px rgba(var(--vg-rgb),.4),inset 0 0 6px rgba(var(--vg-rgb),.2);position:relative;color:var(--vg)}",
  "html[data-vle-chrome='futuristic'] .vle-av::before,html[data-vle-chrome='futuristic'] .vle-av::after{content:'';position:absolute;background:var(--vg)}",
  "html[data-vle-chrome='futuristic'] .vle-av::before{left:-3px;right:-3px;top:50%;height:1px}",
  "html[data-vle-chrome='futuristic'] .vle-av::after{top:-3px;bottom:-3px;left:50%;width:1px}",
  // tension → segmented notched amber→red bar (dots become ticks)
  "html[data-vle-chrome='futuristic'] .vld-dot{border-radius:0;width:100%;height:10px;flex:1}",
  "html[data-vle-chrome='futuristic'] .vld-dot.on{background:linear-gradient(180deg,var(--v-press),var(--v-neg));box-shadow:0 0 6px rgba(var(--vg-rgb),.4)}",
  // scanline shimmer over the float body (motion-gated by the global kill-switch)
  "html[data-vle-chrome='futuristic'] .vlf-body::after{content:'';position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(180deg,transparent 0 3px,rgba(var(--vg-rgb),.025) 3px 4px);z-index:2}",
  "html[data-vle-chrome='futuristic'] .vlf-body{position:relative}",
  // Phase 5.1: the HUD signature also asserts on the DRAWER (surface-independent,
  // skin-independent) — scanlines over the body so 'Futuristic' always reads HUD.
  "html[data-vle-chrome='futuristic'] .vle-body{position:relative}",
  "html[data-vle-chrome='futuristic'] .vle-body::after{content:'';position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(180deg,transparent 0 3px,rgba(var(--vg-rgb),.022) 3px 4px);z-index:0}",
  "html[data-vle-chrome='futuristic'] .vle-body>*{position:relative;z-index:1}",
  // bond radar block
  ".vle-radar{display:block;margin:8px auto 4px;max-width:240px}",
  ".vle-radar-ring{fill:none;stroke:rgba(var(--vg-rgb),.2)}",
  ".vle-radar-axis{stroke:rgba(var(--vg-rgb),.3)}",
  ".vle-radar-axl{fill:var(--vg);font:600 7px/1 var(--vmono);letter-spacing:.5px;opacity:.7}",
  ".vle-radar-a{fill:color-mix(in srgb,var(--v-info) 22%,transparent);stroke:var(--v-info);stroke-width:1.5}",
  ".vle-radar-b{fill:color-mix(in srgb,var(--v-warn) 18%,transparent);stroke:var(--v-warn);stroke-width:1.5}",
  ".vle-radar-dot{fill:var(--vi)}",
  ".vle-radar-leg{display:flex;justify-content:center;gap:14px;font:600 9px/1 var(--vmono);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}",
  ".vle-radar-leg i{font-style:normal;opacity:.7}",

  // ================= THEME: BLOOM ("Pressed-Flower Garden") — float + drawer =================
  // A soft, cozy, romantic pastel look (blush pink + sage). Light surfaces, rounded
  // everything, dashed lace rules, fleuron dividers, petal accents. All chrome-scoped
  // so it re-skins BOTH the floating window (.vlf) and the drawer (.vle-root).
  // --- shared: warm the whole surface with a faint blush→sage wash + petals ---
  "html[data-vle-chrome='bloom'] .vle-root{font-family:var(--vserif);background-image:radial-gradient(120% 90% at 0% 0%,rgba(var(--vg-rgb),.08),transparent 55%),radial-gradient(120% 90% at 100% 100%,rgba(var(--vg2-rgb),.08),transparent 55%)}",
  "html[data-vle-chrome='bloom'] .vlf-body{background-image:radial-gradient(120% 80% at 0% 0%,rgba(var(--vg-rgb),.06),transparent 55%),radial-gradient(120% 80% at 100% 100%,rgba(var(--vg2-rgb),.06),transparent 55%)}",
  // --- drawer head → a lace-hemmed garland with a script title + bloom mark ---
  "html[data-vle-chrome='bloom'] .vle-navpanel{border-radius:calc(var(--vradius) + 6px);border-color:color-mix(in srgb,var(--vg) 30%,transparent);background:radial-gradient(140% 160% at 100% 0%,color-mix(in srgb,var(--vg) 10%,transparent),transparent 60%)}",
  "html[data-vle-chrome='bloom'] .vle-head{font-family:var(--vserif);font-style:italic;font-weight:600;letter-spacing:.5px;border-bottom:1.5px dashed color-mix(in srgb,var(--vg) 34%,transparent)}",
  "html[data-vle-chrome='bloom'] .vle-mark{text-shadow:0 0 10px rgba(var(--vg-rgb),.45)}",
  "html[data-vle-chrome='bloom'] .vle-mark::after{content:'\\2740';margin-left:6px;color:var(--vg2);opacity:.7;font-size:.8em}",
  "html[data-vle-chrome='bloom'] .vle-stats{font-family:var(--vserif);font-style:italic;font-variant:small-caps;letter-spacing:1px;text-transform:lowercase;opacity:.7}",
  // --- tab bar → soft rounded petal-pills with a two-tone active bloom ---
  "html[data-vle-chrome='bloom'] .vle-tabbtn{border-radius:var(--rpill);text-transform:none;letter-spacing:.3px;font-family:var(--vserif);font-size:calc(13px * var(--vscale));font-weight:600}",
  "html[data-vle-chrome='bloom'] .vle-tabbtn:hover{background:color-mix(in srgb,var(--vg) 10%,transparent)}",
  "html[data-vle-chrome='bloom'] .vle-tabbtn.on{color:var(--vg);border-color:transparent;background:linear-gradient(120deg,color-mix(in srgb,var(--vg) 18%,transparent),color-mix(in srgb,var(--vg2) 16%,transparent))}",
  "html[data-vle-chrome='bloom'] .vle-tabicon.on{color:var(--vg);border-color:color-mix(in srgb,var(--vg) 40%,transparent);background:color-mix(in srgb,var(--vg) 14%,transparent)}",
  // --- cards → pillowy, light, softly shadowed; hairlines become blush ---
  "html[data-vle-chrome='bloom'] .vle-card,html[data-vle-chrome='bloom'] .vle-rel-card,html[data-vle-chrome='bloom'] .vld-sec,html[data-vle-chrome='bloom'] .vld-pc{border-radius:18px;border-color:color-mix(in srgb,var(--vg) 20%,transparent);box-shadow:0 2px 10px rgba(180,120,150,.14)}",
  // --- section eyebrows → romantic script small-caps with a fleuron ---
  "html[data-vle-chrome='bloom'] .vld-h,html[data-vle-chrome='bloom'] .vle-sec-h{font-family:var(--vserif);font-style:italic;font-variant:normal;letter-spacing:1.5px;color:var(--vg);text-transform:uppercase}",
  "html[data-vle-chrome='bloom'] .vld-h::before,html[data-vle-chrome='bloom'] .vle-sec-h::before{content:'\\2740 ';color:var(--vg2);opacity:.75}",
  // --- hero scene line → dreamy italic serif with a soft rosy glow ---
  "html[data-vle-chrome='bloom'] .vld-hero{font-family:var(--vserif);font-style:italic;font-weight:600;letter-spacing:.2px;text-shadow:0 1px 10px rgba(var(--vg-rgb),.3)}",
  "html[data-vle-chrome='bloom'] .vld-hero::before{content:'\\275B ';color:var(--vg2);opacity:.6;font-style:normal}",
  "html[data-vle-chrome='bloom'] .vld-sec--hero{background:linear-gradient(160deg,color-mix(in srgb,var(--vg) 10%,transparent),color-mix(in srgb,var(--vg2) 8%,transparent))!important;border-color:color-mix(in srgb,var(--vg) 22%,transparent)!important;border-radius:22px!important}",
  // --- tension → soft rounded pink→sage dots (calm, not alarming) ---
  "html[data-vle-chrome='bloom'] .vld-dot{border-radius:50%}",
  "html[data-vle-chrome='bloom'] .vld-dot.on{background:linear-gradient(120deg,var(--vg),var(--vg2));box-shadow:0 0 6px rgba(var(--vg-rgb),.4)}",
  // --- avatars → soft-ringed flower medallions with a petal halo when present ---
  "html[data-vle-chrome='bloom'] .vle-av,html[data-vle-chrome='bloom'] .vld-pc-av{border-radius:50%;background:radial-gradient(60% 55% at 40% 35%,color-mix(in srgb,var(--vg) 30%,transparent),color-mix(in srgb,var(--vg2) 22%,transparent));border:2px solid color-mix(in srgb,var(--vg) 45%,transparent);color:var(--vi)}",
  "html[data-vle-chrome='bloom'] .vle-card--present .vle-av{box-shadow:0 0 0 2px var(--vg),0 0 0 5px rgba(var(--vg-rgb),.22),0 0 12px rgba(var(--vg-rgb),.4)}",
  // --- twin bond meters → fully rounded, pink (affection) & sage (trust) ---
  // bond card: bloom recolors the two axes to its blush/sage accents
  "html[data-vle-chrome='bloom'] .vle-bc-dot--aff.vle-bc-dot--b,html[data-vle-chrome='bloom'] .vle-bc-conn--aff{background:var(--vg)}",
  "html[data-vle-chrome='bloom'] .vle-bc-dot--trust.vle-bc-dot--b,html[data-vle-chrome='bloom'] .vle-bc-conn--trust{background:var(--vg2)}",
  // --- 'Latest' feed → a garland: dashed blush stem with petal nodes ---
  "html[data-vle-chrome='bloom'] .vld-rec{position:relative;margin-left:calc(7px * var(--vscale));padding:calc(2px * var(--vscale)) 0 calc(11px * var(--vscale)) calc(18px * var(--vscale));border-left:2px dashed color-mix(in srgb,var(--vg) 26%,transparent)}",
  "html[data-vle-chrome='bloom'] .vld-rec:last-child{border-left-color:transparent}",
  "html[data-vle-chrome='bloom'] .vld-rec::before{content:'\\2740';position:absolute;left:-8px;top:calc(1px * var(--vscale));font-size:11px;color:var(--vg2)}",
  "html[data-vle-chrome='bloom'] .vld-rec--journal::before{color:var(--v-pos-i)}html[data-vle-chrome='bloom'] .vld-rec--knew::before{color:var(--v-info)}html[data-vle-chrome='bloom'] .vld-rec--secret::before{color:var(--v-neg-i)}html[data-vle-chrome='bloom'] .vld-rec--shift::before{color:var(--v-press-i)}",
  // --- chips soften to fully-rounded pastel lozenges ---
  "html[data-vle-chrome='bloom'] .v-chip{border-radius:var(--rpill)}",
  // --- modal + toasts pick up the rounded pastel treatment (read document attr) ---
  "html[data-vle-chrome='bloom'] .vlfm{border-radius:22px;border-color:color-mix(in srgb,var(--vg) 34%,transparent);box-shadow:0 24px 70px rgba(180,120,150,.35)}",
  "html[data-vle-chrome='bloom'] .vlfm-head{font-family:var(--vserif);font-style:italic;text-transform:none;letter-spacing:.5px;border-bottom:1.5px dashed color-mix(in srgb,var(--vg) 30%,transparent)}",
  // --- float-only: petal 'confetti' close button + fleuron flanking the title ---
  "html[data-vle-chrome='bloom'] .vlf-x{border-radius:50%;background:radial-gradient(50% 45% at 40% 35%,var(--vg),color-mix(in srgb,var(--vg) 60%,#fff));border:1px solid color-mix(in srgb,var(--vg) 55%,transparent);color:#fff;box-shadow:0 2px 6px rgba(180,120,150,.4)}",
  "html[data-vle-chrome='bloom'] .vlf-x:hover{background:radial-gradient(50% 45% at 40% 35%,var(--vg2),color-mix(in srgb,var(--vg2) 60%,#fff));border-color:color-mix(in srgb,var(--vg2) 55%,transparent);color:#fff}",
  "html[data-vle-chrome='bloom'] .vlf-bar::before{content:'\\2740';position:absolute;left:calc(16px * var(--vscale));top:50%;transform:translateY(-50%);color:var(--vg2);opacity:.55;font-size:12px;pointer-events:none}",

  // ================= THEME: EMBER ("Starlit Night Dreaming") - float + drawer =================
  // A dark, ethereal, animated pastel look (lilac & mint glow on indigo void).
  // Signature: drifting fireflies + slow-rising bubbles + a faint nebula wash.
  // Soft-edged glowing cards, pillowy radius, dotted-stardust rules. Distinct
  // from Bloom (light/cozy, static) and Futuristic (hard/telemetry, scanlines).
  // All chrome-scoped so it re-skins BOTH the floating window and the drawer.
  // Animations honor html[data-vle-motion='off'] + prefers-reduced-motion.
  // --- shared: indigo nebula wash + the starfall texture (set by the mode) ---
  "html[data-vle-chrome='ember'] .vle-root{font-family:var(--vserif);background-image:radial-gradient(120% 90% at 20% 10%,rgba(var(--vg-rgb),.1),transparent 50%),radial-gradient(120% 90% at 80% 90%,rgba(var(--vg2-rgb),.08),transparent 50%)}",
  "html[data-vle-chrome='ember'] .vlf-body{background-image:radial-gradient(120% 80% at 20% 10%,rgba(var(--vg-rgb),.07),transparent 50%),radial-gradient(120% 80% at 80% 90%,rgba(var(--vg2-rgb),.06),transparent 50%)}",
  // --- the signature: drifting fireflies + slow-rising bubbles (motion-gated) ---
  "html[data-vle-chrome='ember'] .vle-body{position:relative}",
  "html[data-vle-chrome='ember'] .vlf-body{position:relative}",
  "html[data-vle-chrome='ember'] .vle-body::after,html[data-vle-chrome='ember'] .vlf-body::after{content:'';position:absolute;inset:0;pointer-events:none;z-index:0;background-image:radial-gradient(1.5px 1.5px at 12% 18%,rgba(var(--vg-rgb),.6),transparent),radial-gradient(1px 1px at 70% 32%,rgba(var(--vg2-rgb),.5),transparent),radial-gradient(2px 2px at 38% 68%,rgba(var(--vg-rgb),.45),transparent),radial-gradient(1px 1px at 84% 78%,rgba(var(--vg2-rgb),.55),transparent),radial-gradient(1.5px 1.5px at 52% 12%,rgba(240,184,208,.4),transparent),radial-gradient(1px 1px at 24% 88%,rgba(245,217,138,.4),transparent);background-repeat:no-repeat;opacity:.6;animation:vle-ember-drift 18s linear infinite}",
  "html[data-vle-chrome='ember'] .vle-body>*,html[data-vle-chrome='ember'] .vlf-body>*{position:relative;z-index:1}",
  // rising bubbles - a second layer of hollow pastel rings floating up
  "html[data-vle-chrome='ember'] .vle-body::before,html[data-vle-chrome='ember'] .vlf-body::before{content:'';position:absolute;inset:0;pointer-events:none;z-index:0;background-image:radial-gradient(circle at 18% 100%,transparent 4px,rgba(var(--vg-rgb),.12) 4.5px,transparent 6px),radial-gradient(circle at 62% 100%,transparent 5px,rgba(var(--vg2-rgb),.1) 5.5px,transparent 7px),radial-gradient(circle at 88% 100%,transparent 3px,rgba(240,184,208,.12) 3.5px,transparent 5px);background-repeat:no-repeat;animation:vle-ember-rise 22s linear infinite;opacity:.5}",
  "@keyframes vle-ember-drift{0%{transform:translateY(0);opacity:.6} 50%{opacity:.35} 100%{transform:translateY(-12px);opacity:.6}}",
  "@keyframes vle-ember-rise{0%{transform:translateY(0);opacity:0} 10%{opacity:.5} 90%{opacity:.4} 100%{transform:translateY(-160px);opacity:0}}",
  "html[data-vle-chrome='ember'][data-vle-motion='off'] .vle-body::after,html[data-vle-chrome='ember'][data-vle-motion='off'] .vlf-body::after,html[data-vle-chrome='ember'][data-vle-motion='off'] .vle-body::before,html[data-vle-chrome='ember'][data-vle-motion='off'] .vlf-body::before{animation:none;opacity:.4}",
  "@media (prefers-reduced-motion:reduce){html[data-vle-chrome='ember'] .vle-body::after,html[data-vle-chrome='ember'] .vlf-body::after,html[data-vle-chrome='ember'] .vle-body::before,html[data-vle-chrome='ember'] .vlf-body::before{animation:none;opacity:.4}}",
  // --- drawer head -> a luminous script title with a soft starlight glow ---
  "html[data-vle-chrome='ember'] .vle-navpanel{border-radius:calc(var(--vradius) + 6px);border-color:color-mix(in srgb,var(--vg) 26%,transparent);background:radial-gradient(140% 160% at 50% 0%,color-mix(in srgb,var(--vg) 12%,transparent),transparent 62%);box-shadow:0 0 20px color-mix(in srgb,var(--vg) 12%,transparent)}",
  "html[data-vle-chrome='ember'] .vle-head{font-family:var(--vserif);font-style:italic;font-weight:500;letter-spacing:1px;border-bottom:1px solid color-mix(in srgb,var(--vg) 26%,transparent)}",
  "html[data-vle-chrome='ember'] .vle-mark{text-shadow:0 0 14px rgba(var(--vg-rgb),.55)}",
  "html[data-vle-chrome='ember'] .vle-mark::after{content:'\\2726';margin-left:7px;color:var(--vg2);opacity:.75;font-size:.78em;text-shadow:0 0 8px rgba(var(--vg2-rgb),.5)}",
  "html[data-vle-chrome='ember'] .vle-stats{font-family:var(--vserif);font-style:italic;font-variant:small-caps;letter-spacing:1px;text-transform:lowercase;opacity:.65}",
  // --- tab bar -> rounded glow-pills; active = a luminous two-tone aurora ---
  "html[data-vle-chrome='ember'] .vle-tabbtn{border-radius:var(--rpill);text-transform:none;letter-spacing:.4px;font-family:var(--vserif);font-size:calc(13px * var(--vscale));font-weight:500}",
  "html[data-vle-chrome='ember'] .vle-tabbtn:hover{background:color-mix(in srgb,var(--vg) 10%,transparent);color:var(--vi)}",
  "html[data-vle-chrome='ember'] .vle-tabbtn.on{color:var(--vg);border-color:transparent;background:linear-gradient(120deg,color-mix(in srgb,var(--vg) 20%,transparent),color-mix(in srgb,var(--vg2) 18%,transparent));box-shadow:0 0 14px rgba(var(--vg-rgb),.22)}",
  "html[data-vle-chrome='ember'] .vle-tabicon.on{color:var(--vg);border-color:color-mix(in srgb,var(--vg) 40%,transparent);background:color-mix(in srgb,var(--vg) 16%,transparent);box-shadow:0 0 12px rgba(var(--vg-rgb),.2)}",
  // --- cards -> pillowy, soft-edged, with a faint pastel glow halo ---
  "html[data-vle-chrome='ember'] .vle-card,html[data-vle-chrome='ember'] .vle-rel-card,html[data-vle-chrome='ember'] .vld-sec,html[data-vle-chrome='ember'] .vld-pc{border-radius:18px;border-color:color-mix(in srgb,var(--vg) 22%,transparent);background:linear-gradient(168deg,rgba(24,24,40,.62),rgba(15,15,28,.58));box-shadow:0 0 18px rgba(var(--vg-rgb),.06),0 4px 18px rgba(0,0,0,.3)}",
  "html[data-vle-chrome='ember'] .vle-card:hover,html[data-vle-chrome='ember'] .vle-rel-card:hover{box-shadow:0 0 26px rgba(var(--vg-rgb),.14),0 6px 22px rgba(0,0,0,.36)}",
  // --- section eyebrows -> ethereal italic small-caps with a four-point star ---
  "html[data-vle-chrome='ember'] .vld-h,html[data-vle-chrome='ember'] .vle-sec-h{font-family:var(--vserif);font-style:italic;font-variant:normal;letter-spacing:1.5px;color:var(--vg);text-transform:uppercase;text-shadow:0 0 10px rgba(var(--vg-rgb),.3)}",
  "html[data-vle-chrome='ember'] .vld-h::before,html[data-vle-chrome='ember'] .vle-sec-h::before{content:'\\2726 ';color:var(--vg2);opacity:.8}",
  // --- hero scene line -> dreamy italic serif wreathed in soft starlight ---
  "html[data-vle-chrome='ember'] .vld-hero{font-family:var(--vserif);font-style:italic;font-weight:600;letter-spacing:.3px;text-shadow:0 0 16px rgba(var(--vg-rgb),.32),0 0 32px rgba(var(--vg2-rgb),.18)}",
  "html[data-vle-chrome='ember'] .vld-hero::before{content:'\\275B ';color:var(--vg2);opacity:.7;font-style:normal}",
  "html[data-vle-chrome='ember'] .vld-sec--hero{background:linear-gradient(160deg,rgba(var(--vg-rgb),.12),rgba(var(--vg2-rgb),.1))!important;border-color:color-mix(in srgb,var(--vg) 26%,transparent)!important;border-radius:22px!important;box-shadow:0 0 30px rgba(var(--vg-rgb),.1)!important}",
  // --- tension -> glowing pastel orbs (lilac->mint), not alarming dots ---
  "html[data-vle-chrome='ember'] .vld-dot{border-radius:50%}",
  "html[data-vle-chrome='ember'] .vld-dot.on{background:radial-gradient(circle at 40% 35%,var(--vg),color-mix(in srgb,var(--vg) 50%,transparent));box-shadow:0 0 8px rgba(var(--vg-rgb),.55)}",
  // --- avatars -> luminous moon-medallions with a starlight halo when present ---
  "html[data-vle-chrome='ember'] .vle-av,html[data-vle-chrome='ember'] .vld-pc-av{border-radius:50%;background:radial-gradient(60% 55% at 40% 35%,color-mix(in srgb,var(--vg) 28%,transparent),color-mix(in srgb,var(--vg2) 20%,transparent));border:2px solid color-mix(in srgb,var(--vg) 42%,transparent);color:var(--vi);box-shadow:0 0 12px rgba(var(--vg-rgb),.2)}",
  "html[data-vle-chrome='ember'] .vle-card--present .vle-av{box-shadow:0 0 0 2px var(--vg),0 0 0 5px rgba(var(--vg-rgb),.2),0 0 18px rgba(var(--vg-rgb),.5)}",
  // --- twin bond meters -> glowing pastel strands (lilac affection, mint trust) ---
  // bond card: ember's dots glow softly, matching its luminous aesthetic
  "html[data-vle-chrome='ember'] .vle-bc-dot--aff.vle-bc-dot--b,html[data-vle-chrome='ember'] .vle-bc-conn--aff{background:var(--vg);box-shadow:0 0 8px rgba(var(--vg-rgb),.4)}",
  "html[data-vle-chrome='ember'] .vle-bc-dot--trust.vle-bc-dot--b,html[data-vle-chrome='ember'] .vle-bc-conn--trust{background:var(--vg2);box-shadow:0 0 8px rgba(var(--vg2-rgb),.35)}",
  // --- 'Latest' feed -> a stardust trail: dotted lilac stem with star nodes ---
  "html[data-vle-chrome='ember'] .vld-rec{position:relative;margin-left:calc(7px * var(--vscale));padding:calc(2px * var(--vscale)) 0 calc(11px * var(--vscale)) calc(18px * var(--vscale));border-left:2px dotted color-mix(in srgb,var(--vg) 28%,transparent)}",
  "html[data-vle-chrome='ember'] .vld-rec:last-child{border-left-color:transparent}",
  "html[data-vle-chrome='ember'] .vld-rec::before{content:'\\2726';position:absolute;left:-8px;top:calc(1px * var(--vscale));font-size:11px;color:var(--vg2);text-shadow:0 0 6px rgba(var(--vg2-rgb),.5)}",
  "html[data-vle-chrome='ember'] .vld-rec--journal::before{color:var(--v-pos-i)}html[data-vle-chrome='ember'] .vld-rec--knew::before{color:var(--v-info)}html[data-vle-chrome='ember'] .vld-rec--secret::before{color:var(--v-neg-i)}html[data-vle-chrome='ember'] .vld-rec--shift::before{color:var(--v-press-i)}",
  // --- chips soften to fully-rounded pastel lozenges with a faint glow ---
  "html[data-vle-chrome='ember'] .v-chip{border-radius:var(--rpill);box-shadow:0 0 8px rgba(var(--vg-rgb),.1)}",
  // --- modal + toasts pick up the luminous pastel treatment (read document attr) ---
  "html[data-vle-chrome='ember'] .vlfm{border-radius:22px;border-color:color-mix(in srgb,var(--vg) 34%,transparent);box-shadow:0 0 40px rgba(var(--vg-rgb),.18),0 24px 70px rgba(0,0,0,.6)}",
  "html[data-vle-chrome='ember'] .vlfm-head{font-family:var(--vserif);font-style:italic;text-transform:none;letter-spacing:1px;border-bottom:1px solid color-mix(in srgb,var(--vg) 28%,transparent)}",
  // --- float-only: a glowing star 'ember' close button + star flanking the title ---
  "html[data-vle-chrome='ember'] .vlf-x{border-radius:50%;background:radial-gradient(50% 45% at 40% 35%,var(--vg),color-mix(in srgb,var(--vg) 55%,#1a1a30));border:1px solid color-mix(in srgb,var(--vg) 55%,transparent);color:#1a1a30;box-shadow:0 0 12px rgba(var(--vg-rgb),.45)}",
  "html[data-vle-chrome='ember'] .vlf-x:hover{background:radial-gradient(50% 45% at 40% 35%,var(--vg2),color-mix(in srgb,var(--vg2) 55%,#1a1a30));border-color:color-mix(in srgb,var(--vg2) 55%,transparent);color:#1a1a30;box-shadow:0 0 14px rgba(var(--vg2-rgb),.5)}",
  "html[data-vle-chrome='ember'] .vlf-bar::before{content:'\\2726';position:absolute;left:calc(16px * var(--vscale));top:50%;transform:translateY(-50%);color:var(--vg2);opacity:.6;font-size:12px;pointer-events:none;text-shadow:0 0 8px rgba(var(--vg2-rgb),.5)}",

  // ================= THEME: FAEWILD ("Twilight Storybook Glade") - float + drawer =================
  // A fairy-tale wood at dusk: pastel sage & lilac on a deep blue-green glade,
  // climbing-vine borders, and fairy-light garlands that catch in the dark
  // (presence & tension read as warm bulbs). Signature: drifting fireflies + a
  // faint glade wash + a leaf/bulb-dressed shell. Distinct from Bloom (indoor
  // cozy garden, static) and Ember (indigo night sky): Faewild is green-led,
  // vined, storybook. All chrome-scoped so it re-skins BOTH the float and drawer;
  // animations honor html[data-vle-motion='off'] + prefers-reduced-motion.
  // --- shared: a soft glade wash (sage/lilac) behind both surfaces ---
  "html[data-vle-chrome='faewild'] .vle-root{font-family:var(--vserif);background-image:radial-gradient(120% 90% at 15% 8%,rgba(var(--vg-rgb),.1),transparent 52%),radial-gradient(120% 90% at 85% 92%,rgba(var(--vg2-rgb),.09),transparent 52%)}",
  "html[data-vle-chrome='faewild'] .vlf-body{background-image:radial-gradient(120% 80% at 15% 8%,rgba(var(--vg-rgb),.07),transparent 52%),radial-gradient(120% 80% at 85% 92%,rgba(var(--vg2-rgb),.06),transparent 52%)}",
  // --- the signature: drifting fireflies (warm butter + sage motes), motion-gated ---
  "html[data-vle-chrome='faewild'] .vle-body{position:relative}",
  "html[data-vle-chrome='faewild'] .vlf-body{position:relative}",
  "html[data-vle-chrome='faewild'] .vle-body::after,html[data-vle-chrome='faewild'] .vlf-body::after{content:'';position:absolute;inset:0;pointer-events:none;z-index:0;background-image:radial-gradient(1.6px 1.6px at 14% 20%,rgba(240,198,90,.6),transparent),radial-gradient(1px 1px at 72% 30%,rgba(var(--vg-rgb),.5),transparent),radial-gradient(2px 2px at 40% 66%,rgba(240,198,90,.45),transparent),radial-gradient(1px 1px at 86% 76%,rgba(var(--vg2-rgb),.5),transparent),radial-gradient(1.5px 1.5px at 54% 14%,rgba(var(--vg-rgb),.4),transparent),radial-gradient(1px 1px at 26% 86%,rgba(240,198,90,.4),transparent);background-repeat:no-repeat;opacity:.6;animation:vle-fae-flit 20s ease-in-out infinite}",
  "html[data-vle-chrome='faewild'] .vle-body>*,html[data-vle-chrome='faewild'] .vlf-body>*{position:relative;z-index:1}",
  // a faint climbing-vine wash rising from the bottom (a second, slow layer)
  "html[data-vle-chrome='faewild'] .vle-body::before,html[data-vle-chrome='faewild'] .vlf-body::before{content:'';position:absolute;inset:0;pointer-events:none;z-index:0;background-image:radial-gradient(circle at 20% 100%,transparent 4px,rgba(var(--vg-rgb),.12) 4.5px,transparent 6px),radial-gradient(circle at 64% 100%,transparent 5px,rgba(var(--vg2-rgb),.1) 5.5px,transparent 7px),radial-gradient(circle at 90% 100%,transparent 3px,rgba(240,198,90,.12) 3.5px,transparent 5px);background-repeat:no-repeat;animation:vle-fae-rise 24s linear infinite;opacity:.45}",
  "@keyframes vle-fae-flit{0%{transform:translate(0,0);opacity:.6} 33%{transform:translate(6px,-8px);opacity:.4} 66%{transform:translate(-5px,-4px);opacity:.55} 100%{transform:translate(0,0);opacity:.6}}",
  "@keyframes vle-fae-rise{0%{transform:translateY(0);opacity:0} 12%{opacity:.45} 88%{opacity:.35} 100%{transform:translateY(-150px);opacity:0}}",
  "html[data-vle-chrome='faewild'][data-vle-motion='off'] .vle-body::after,html[data-vle-chrome='faewild'][data-vle-motion='off'] .vlf-body::after,html[data-vle-chrome='faewild'][data-vle-motion='off'] .vle-body::before,html[data-vle-chrome='faewild'][data-vle-motion='off'] .vlf-body::before{animation:none;opacity:.4}",
  "@media (prefers-reduced-motion:reduce){html[data-vle-chrome='faewild'] .vle-body::after,html[data-vle-chrome='faewild'] .vlf-body::after,html[data-vle-chrome='faewild'] .vle-body::before,html[data-vle-chrome='faewild'] .vlf-body::before{animation:none;opacity:.4}}",
  // --- drawer head -> a storybook title with a soft glade glow + a leaf mark ---
  "html[data-vle-chrome='faewild'] .vle-navpanel{border-radius:calc(var(--vradius) + 6px);border-color:color-mix(in srgb,var(--vg) 28%,transparent);background:radial-gradient(140% 160% at 50% 0%,color-mix(in srgb,var(--vg) 12%,transparent),transparent 62%);box-shadow:0 0 20px color-mix(in srgb,var(--vg) 12%,transparent)}",
  "html[data-vle-chrome='faewild'] .vle-head{font-family:var(--vserif);font-style:italic;font-weight:500;letter-spacing:1px;border-bottom:1.5px dashed color-mix(in srgb,var(--vg) 30%,transparent)}",
  "html[data-vle-chrome='faewild'] .vle-mark{text-shadow:0 0 14px rgba(var(--vg-rgb),.5)}",
  "html[data-vle-chrome='faewild'] .vle-mark::after{content:'\\1F343';margin-left:7px;color:var(--vg);opacity:.8;font-size:.78em}",
  "html[data-vle-chrome='faewild'] .vle-stats{font-family:var(--vserif);font-style:italic;font-variant:small-caps;letter-spacing:1px;text-transform:lowercase;opacity:.65}",
  // --- tab bar -> toadstool-cap pills; active = a luminous sage/lilac glow ---
  "html[data-vle-chrome='faewild'] .vle-tabbtn{border-radius:calc(var(--rpill)) calc(var(--rpill)) 8px 8px;text-transform:none;letter-spacing:.4px;font-family:var(--vserif);font-size:calc(13px * var(--vscale));font-weight:500}",
  "html[data-vle-chrome='faewild'] .vle-tabbtn:hover{background:color-mix(in srgb,var(--vg) 10%,transparent);color:var(--vi)}",
  "html[data-vle-chrome='faewild'] .vle-tabbtn.on{color:var(--vg);border-color:transparent;background:linear-gradient(120deg,color-mix(in srgb,var(--vg) 20%,transparent),color-mix(in srgb,var(--vg2) 18%,transparent));box-shadow:0 0 14px rgba(var(--vg-rgb),.22)}",
  "html[data-vle-chrome='faewild'] .vle-tabicon.on{color:var(--vg);border-color:color-mix(in srgb,var(--vg) 40%,transparent);background:color-mix(in srgb,var(--vg) 16%,transparent);box-shadow:0 0 12px rgba(var(--vg-rgb),.2)}",
  // --- cards -> soft-edged glade panels with a faint pastel glow ---
  "html[data-vle-chrome='faewild'] .vle-card,html[data-vle-chrome='faewild'] .vle-rel-card,html[data-vle-chrome='faewild'] .vld-sec,html[data-vle-chrome='faewild'] .vld-pc{border-radius:18px;border-color:color-mix(in srgb,var(--vg) 24%,transparent);background:linear-gradient(168deg,rgba(30,36,34,.62),rgba(20,26,26,.58));box-shadow:0 0 18px rgba(var(--vg-rgb),.06),0 4px 18px rgba(0,0,0,.28)}",
  "html[data-vle-chrome='faewild'] .vle-card:hover,html[data-vle-chrome='faewild'] .vle-rel-card:hover{box-shadow:0 0 26px rgba(var(--vg-rgb),.14),0 6px 22px rgba(0,0,0,.34)}",
  // --- section eyebrows -> storybook italic small-caps with a leaf fleuron ---
  "html[data-vle-chrome='faewild'] .vld-h,html[data-vle-chrome='faewild'] .vle-sec-h{font-family:var(--vserif);font-style:italic;font-variant:normal;letter-spacing:1.5px;color:var(--vg);text-transform:uppercase;text-shadow:0 0 10px rgba(var(--vg-rgb),.28)}",
  "html[data-vle-chrome='faewild'] .vld-h::before,html[data-vle-chrome='faewild'] .vle-sec-h::before{content:'\\1F33F ';color:var(--vg);opacity:.8}",
  // --- hero scene line -> dreamy italic serif wreathed in a soft glade glow ---
  "html[data-vle-chrome='faewild'] .vld-hero{font-family:var(--vserif);font-style:italic;font-weight:600;letter-spacing:.3px;text-shadow:0 0 16px rgba(var(--vg-rgb),.3),0 0 32px rgba(var(--vg2-rgb),.16)}",
  "html[data-vle-chrome='faewild'] .vld-hero::before{content:'\\275B ';color:var(--vg2);opacity:.7;font-style:normal}",
  "html[data-vle-chrome='faewild'] .vld-sec--hero{background:linear-gradient(160deg,rgba(var(--vg-rgb),.12),rgba(var(--vg2-rgb),.1))!important;border-color:color-mix(in srgb,var(--vg) 26%,transparent)!important;border-radius:22px!important;box-shadow:0 0 30px rgba(var(--vg-rgb),.1)!important}",
  // --- tension -> warm fairy-light bulbs (butter glow), not alarming dots ---
  "html[data-vle-chrome='faewild'] .vld-dot{border-radius:50%}",
  "html[data-vle-chrome='faewild'] .vld-dot.on{background:radial-gradient(circle at 40% 35%,#ffe6a0,color-mix(in srgb,var(--v-press) 60%,transparent));box-shadow:0 0 8px rgba(240,200,120,.6)}",
  // --- avatars -> luminous glade medallions with a sage halo when present ---
  "html[data-vle-chrome='faewild'] .vle-av,html[data-vle-chrome='faewild'] .vld-pc-av{border-radius:50%;background:radial-gradient(60% 55% at 40% 35%,color-mix(in srgb,var(--vg) 28%,transparent),color-mix(in srgb,var(--vg2) 20%,transparent));border:2px solid color-mix(in srgb,var(--vg) 42%,transparent);color:var(--vi);box-shadow:0 0 12px rgba(var(--vg-rgb),.2)}",
  "html[data-vle-chrome='faewild'] .vle-card--present .vle-av{box-shadow:0 0 0 2px var(--vg),0 0 0 5px rgba(var(--vg-rgb),.2),0 0 18px rgba(var(--vg-rgb),.5)}",
  // --- twin bond meters -> vine strands (sage affection, lilac trust) ---
  // bond card: faewild's dots glow softly, matching its luminous aesthetic
  "html[data-vle-chrome='faewild'] .vle-bc-dot--aff.vle-bc-dot--b,html[data-vle-chrome='faewild'] .vle-bc-conn--aff{background:var(--vg);box-shadow:0 0 8px rgba(var(--vg-rgb),.4)}",
  "html[data-vle-chrome='faewild'] .vle-bc-dot--trust.vle-bc-dot--b,html[data-vle-chrome='faewild'] .vle-bc-conn--trust{background:var(--vg2);box-shadow:0 0 8px rgba(var(--vg2-rgb),.35)}",
  // --- 'Latest' feed -> a climbing-vine trail: dashed sage stem with leaf nodes ---
  "html[data-vle-chrome='faewild'] .vld-rec{position:relative;margin-left:calc(7px * var(--vscale));padding:calc(2px * var(--vscale)) 0 calc(11px * var(--vscale)) calc(18px * var(--vscale));border-left:2px dashed color-mix(in srgb,var(--vg) 30%,transparent)}",
  "html[data-vle-chrome='faewild'] .vld-rec:last-child{border-left-color:transparent}",
  "html[data-vle-chrome='faewild'] .vld-rec::before{content:'\\1F343';position:absolute;left:-9px;top:calc(1px * var(--vscale));font-size:11px;color:var(--vg)}",
  "html[data-vle-chrome='faewild'] .vld-rec--journal::before{color:var(--v-pos-i)}html[data-vle-chrome='faewild'] .vld-rec--knew::before{color:var(--v-info)}html[data-vle-chrome='faewild'] .vld-rec--secret::before{color:var(--v-neg-i)}html[data-vle-chrome='faewild'] .vld-rec--shift::before{color:var(--v-press-i)}",
  // --- chips soften to fully-rounded pastel lozenges with a faint glow ---
  "html[data-vle-chrome='faewild'] .v-chip{border-radius:var(--rpill);box-shadow:0 0 8px rgba(var(--vg-rgb),.1)}",
  // --- modal + toasts pick up the luminous glade treatment (read document attr) ---
  "html[data-vle-chrome='faewild'] .vlfm{border-radius:22px;border-color:color-mix(in srgb,var(--vg) 34%,transparent);box-shadow:0 0 40px rgba(var(--vg-rgb),.16),0 24px 70px rgba(0,0,0,.55)}",
  "html[data-vle-chrome='faewild'] .vlfm-head{font-family:var(--vserif);font-style:italic;text-transform:none;letter-spacing:1px;border-bottom:1.5px dashed color-mix(in srgb,var(--vg) 30%,transparent)}",
  // --- float-only: a glowing fairy-lantern close button + a leaf flanking the title ---
  "html[data-vle-chrome='faewild'] .vlf-frame{border-radius:calc(var(--vradius) + 10px);border-color:color-mix(in srgb,var(--vg) 38%,transparent);box-shadow:0 0 24px rgba(var(--vg-rgb),.16),0 0 60px rgba(var(--vg2-rgb),.12),0 18px 60px rgba(8,20,16,.55),inset 0 0 0 1px rgba(255,255,255,.05)}",
  "html[data-vle-chrome='faewild'] .vlf-bar{background:linear-gradient(180deg,rgba(var(--vg-rgb),.1),transparent);border-bottom:1.5px dashed color-mix(in srgb,var(--vg) 24%,transparent)}",
  "html[data-vle-chrome='faewild'] .vlf-title{font-family:var(--vserif);font-style:italic;font-weight:500;font-size:calc(17px * var(--vscale));letter-spacing:1px;text-transform:none;text-shadow:0 0 12px rgba(var(--vg-rgb),.35)}",
  "html[data-vle-chrome='faewild'] .vlf-frame::before{content:'';position:absolute;z-index:1;inset:6px;border-radius:calc(var(--vradius) + 4px);box-shadow:inset 0 0 22px rgba(var(--vg-rgb),.09),inset 0 0 40px rgba(var(--vg2-rgb),.06);pointer-events:none}",
  "html[data-vle-chrome='faewild'] .vlf-grip{background:none;border:none;right:7px;bottom:7px;width:12px;height:12px;border-right:2px solid color-mix(in srgb,var(--vg) 55%,transparent);border-bottom:2px solid color-mix(in srgb,var(--vg) 55%,transparent);border-radius:0 0 10px 0;opacity:.7}",
  "html[data-vle-chrome='faewild'] .vlf-launch{border-radius:18px 0 0 18px;box-shadow:-5px 4px 22px rgba(0,0,0,.45),0 0 18px rgba(var(--vg-rgb),.18)}",
  "html[data-vle-chrome='faewild'] .vlf-x{border-radius:50%;background:radial-gradient(50% 45% at 40% 35%,#ffe6a0,color-mix(in srgb,var(--v-press) 55%,#1a2018));border:1px solid color-mix(in srgb,var(--vg) 55%,transparent);color:#1a2018;box-shadow:0 0 12px rgba(240,200,120,.5)}",
  "html[data-vle-chrome='faewild'] .vlf-x:hover{background:radial-gradient(50% 45% at 40% 35%,#fff2c4,color-mix(in srgb,var(--v-press) 40%,#1a2018));border-color:color-mix(in srgb,var(--v-press) 55%,transparent);color:#1a2018;box-shadow:0 0 14px rgba(240,200,120,.6)}",
  "html[data-vle-chrome='faewild'] .vlf-bar::before{content:'\\1F343';position:absolute;left:calc(16px * var(--vscale));top:50%;transform:translateY(-50%);color:var(--vg);opacity:.7;font-size:12px;pointer-events:none}",

  // ============================================================================
  // GATSBY / ART DECO CHROME — geometric opulence, gilt on midnight, sharp edges
  // ============================================================================
  "html[data-vle-chrome='gatsby'] .vle-root{font-family:var(--vserif);background-image:radial-gradient(600px 400px at 50% 0%,rgba(var(--vg-rgb),.15),transparent 60%)}",
  "html[data-vle-chrome='gatsby'] .vle-navpanel{border-radius:0;border:2px solid var(--vg);background:linear-gradient(180deg,rgba(var(--vg-rgb),.12),transparent),var(--vsurf-1);box-shadow:inset 0 2px 0 rgba(var(--vg-rgb),.3),inset 0 -2px 0 rgba(var(--vg-rgb),.3),0 0 30px rgba(var(--vg-rgb),.2)}",
  "html[data-vle-chrome='gatsby'] .vle-navpanel::before{content:'';position:absolute;top:0;left:50%;transform:translateX(-50%);width:200px;height:200px;background:radial-gradient(circle at 50% 0%,rgba(var(--vg-rgb),.15),transparent 70%);pointer-events:none}",
  "html[data-vle-chrome='gatsby'] .vle-head{font-family:var(--vserif);font-weight:700;letter-spacing:0.15em;text-transform:uppercase;border-bottom:3px solid var(--vg);font-size:calc(15px * var(--vscale));text-align:center;padding-bottom:calc(8px * var(--vscale))}",
  "html[data-vle-chrome='gatsby'] .vle-head::before{content:'\\2726';color:var(--vg);font-size:1.5em;display:block;margin-bottom:calc(6px * var(--vscale));text-shadow:0 0 16px rgba(var(--vg-rgb),.5)}",
  "html[data-vle-chrome='gatsby'] .vle-stats{font-family:var(--mono);letter-spacing:0.12em;text-transform:uppercase;opacity:.75}",
  "html[data-vle-chrome='gatsby'] .vle-tabbtn{border-radius:0;border:1px solid rgba(var(--vg-rgb),.3);letter-spacing:0.1em;text-transform:uppercase;font-family:var(--mono);font-size:calc(12px * var(--vscale));font-weight:700}",
  "html[data-vle-chrome='gatsby'] .vle-tabbtn:hover{background:rgba(var(--vg-rgb),.08)}",
  "html[data-vle-chrome='gatsby'] .vle-tabbtn.on{color:var(--vg);border-color:var(--vg);background:linear-gradient(180deg,rgba(var(--vg-rgb),.15),rgba(var(--vg-rgb),.05));box-shadow:inset 0 0 12px rgba(var(--vg-rgb),.2)}",
  "html[data-vle-chrome='gatsby'] .vle-card,html[data-vle-chrome='gatsby'] .vle-rel-card,html[data-vle-chrome='gatsby'] .vld-sec{border-radius:0;border:1px solid rgba(var(--vg-rgb),.35);border-top:3px solid var(--vg);border-bottom:3px solid var(--vg);background:var(--vsurf-1);position:relative}",
  "html[data-vle-chrome='gatsby'] .vle-card::before,html[data-vle-chrome='gatsby'] .vle-rel-card::before{content:'';position:absolute;top:0;left:0;width:40px;height:3px;background:var(--vg)}",
  "html[data-vle-chrome='gatsby'] .vle-card::after,html[data-vle-chrome='gatsby'] .vle-rel-card::after{content:'';position:absolute;top:0;right:0;width:40px;height:3px;background:var(--vg)}",
  "html[data-vle-chrome='gatsby'] .vld-h,html[data-vle-chrome='gatsby'] .vle-sec-h{font-family:var(--mono);font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:var(--vg)}",
  "html[data-vle-chrome='gatsby'] .vld-h::before,html[data-vle-chrome='gatsby'] .vle-sec-h::before{content:'\\25C6 ';color:var(--vg);font-size:1.2em;text-shadow:0 0 8px rgba(var(--vg-rgb),.4)}",
  "html[data-vle-chrome='gatsby'] .vld-hero{font-family:var(--vserif);font-weight:700;letter-spacing:0.15em;text-transform:uppercase;font-size:calc(22px * var(--vscale));text-align:center;text-shadow:0 2px 8px rgba(var(--vg-rgb),.3)}",
  "html[data-vle-chrome='gatsby'] .vle-av{clip-path:polygon(30% 0%,70% 0%,100% 30%,100% 70%,70% 100%,30% 100%,0% 70%,0% 30%);background:radial-gradient(circle at 35% 30%,var(--vg),color-mix(in srgb,var(--vg) 60%,#000));border:2px solid var(--vg);box-shadow:0 0 16px rgba(var(--vg-rgb),.4)}",
  "html[data-vle-chrome='gatsby'] .vlfm{border-radius:0;border:2px solid var(--vg);box-shadow:0 0 40px rgba(var(--vg-rgb),.25),0 24px 70px rgba(0,0,0,.7),inset 0 2px 0 rgba(var(--vg-rgb),.3)}",
  "html[data-vle-chrome='gatsby'] .vlf-x{border-radius:0;clip-path:polygon(30% 0%,70% 0%,100% 30%,100% 70%,70% 100%,30% 100%,0% 70%,0% 30%);background:radial-gradient(50% 45% at 40% 35%,var(--vg),color-mix(in srgb,var(--vg) 50%,#000));border:none;color:#000;box-shadow:0 2px 8px rgba(var(--vg-rgb),.5)}",
  "html[data-vle-chrome='gatsby'] .vlf-x:hover{background:radial-gradient(50% 45% at 40% 35%,var(--vg2),color-mix(in srgb,var(--vg2) 50%,#000));box-shadow:0 2px 10px rgba(var(--vg2-rgb),.6)}",
  // --- Gatsby animations: slow gold shimmer/pulse on accent elements ---
  "html[data-vle-chrome='gatsby'] .vle-head::before{animation:vle-gatsby-shimmer 4s ease-in-out infinite}",
  "html[data-vle-chrome='gatsby'] .vle-card::before,html[data-vle-chrome='gatsby'] .vle-card::after,html[data-vle-chrome='gatsby'] .vle-rel-card::before,html[data-vle-chrome='gatsby'] .vle-rel-card::after{animation:vle-gatsby-pulse 3s ease-in-out infinite}",
  "@keyframes vle-gatsby-shimmer{0%,100%{opacity:.4;text-shadow:0 0 16px rgba(var(--vg-rgb),.5)} 50%{opacity:.7;text-shadow:0 0 24px rgba(var(--vg-rgb),.8)}}",
  "@keyframes vle-gatsby-pulse{0%,100%{opacity:1} 50%{opacity:.7}}",
  "html[data-vle-chrome='gatsby'][data-vle-motion='off'] .vle-head::before,html[data-vle-chrome='gatsby'][data-vle-motion='off'] .vle-card::before,html[data-vle-chrome='gatsby'][data-vle-motion='off'] .vle-card::after{animation:none;opacity:1}",
  "@media (prefers-reduced-motion:reduce){html[data-vle-chrome='gatsby'] .vle-head::before,html[data-vle-chrome='gatsby'] .vle-card::before,html[data-vle-chrome='gatsby'] .vle-card::after{animation:none;opacity:1}}",

  // ============================================================================
  // SUMI / INK WASH CHROME — minimalist japanese aesthetics, asymmetric space
  // ============================================================================
  "html[data-vle-chrome='sumi'] .vle-root{font-family:var(--vserif)}",
  "html[data-vle-chrome='sumi'] .vle-navpanel{border-radius:0;border:none;border-bottom:1px solid rgba(var(--vi),.15);background:var(--vsurf-1);box-shadow:inset 0 0 0 1px rgba(var(--vi),.08)}",
  "html[data-vle-chrome='sumi'] .vle-head{font-family:var(--vserif);font-weight:700;letter-spacing:0.08em;border-bottom:1px solid rgba(var(--vi),.15);font-size:calc(16px * var(--vscale));position:relative}",
  "html[data-vle-chrome='sumi'] .vle-stats{font-family:var(--vserif);font-style:italic;opacity:.65;letter-spacing:0.05em}",
  "html[data-vle-chrome='sumi'] .vle-tabbtn{border-radius:0;border:none;border-left:4px solid transparent;letter-spacing:0.02em;font-family:var(--vserif);font-size:calc(13px * var(--vscale))}",
  "html[data-vle-chrome='sumi'] .vle-tabbtn.on{border-left-color:var(--vi);background:rgba(var(--vi),.05)}",
  "html[data-vle-chrome='sumi'] .vle-card,html[data-vle-chrome='sumi'] .vle-rel-card,html[data-vle-chrome='sumi'] .vld-sec{border-radius:0;border:none;border-left:4px solid var(--vi);background:var(--vsurf-1);box-shadow:3px 3px 0 rgba(var(--vi),.08);position:relative}",
  "html[data-vle-chrome='sumi'] .vle-card::after,html[data-vle-chrome='sumi'] .vle-rel-card::after{content:'';position:absolute;top:0;right:0;bottom:0;width:80px;background:linear-gradient(90deg,transparent,rgba(var(--vi),.04));pointer-events:none}",
  "html[data-vle-chrome='sumi'] .vld-h,html[data-vle-chrome='sumi'] .vle-sec-h{font-family:var(--vserif);font-weight:700;letter-spacing:0.02em;color:var(--vi)}",
  "html[data-vle-chrome='sumi'] .vld-hero{font-family:var(--vserif);font-weight:700;letter-spacing:0.08em;font-size:calc(20px * var(--vscale))}",
  "html[data-vle-chrome='sumi'] .vle-av{border-radius:50%;background:radial-gradient(circle at 45% 40%,var(--vg),color-mix(in srgb,var(--vg) 70%,#000));border:none;box-shadow:0 2px 8px rgba(var(--vg-rgb),.35);position:relative}",
  "html[data-vle-chrome='sumi'] .vlfm{border-radius:0;border:none;box-shadow:0 12px 40px rgba(0,0,0,.15),inset 0 0 0 1px rgba(var(--vi),.08)}",
  "html[data-vle-chrome='sumi'] .vlf-x{border-radius:50%;background:radial-gradient(circle at 45% 40%,var(--vg),color-mix(in srgb,var(--vg) 60%,transparent));border:none;box-shadow:0 2px 8px rgba(var(--vg-rgb),.4)}",
  "html[data-vle-chrome='sumi'] .vlf-x:hover{background:radial-gradient(circle at 45% 40%,color-mix(in srgb,var(--vg) 120%,#fff),var(--vg));box-shadow:0 2px 10px rgba(var(--vg-rgb),.5)}",
  // --- Sumi animations: slow ink-wash fade-in for cards ---
  "html[data-vle-chrome='sumi'] .vle-card,html[data-vle-chrome='sumi'] .vle-rel-card,html[data-vle-chrome='sumi'] .vld-sec{animation:vle-sumi-ink-fade 0.6s ease-out}",
  "@keyframes vle-sumi-ink-fade{0%{opacity:0;transform:translateX(-8px)} 100%{opacity:1;transform:translateX(0)}}",
  "html[data-vle-chrome='sumi'][data-vle-motion='off'] .vle-card,html[data-vle-chrome='sumi'][data-vle-motion='off'] .vle-rel-card,html[data-vle-chrome='sumi'][data-vle-motion='off'] .vld-sec{animation:none}",
  "@media (prefers-reduced-motion:reduce){html[data-vle-chrome='sumi'] .vle-card,html[data-vle-chrome='sumi'] .vle-rel-card,html[data-vle-chrome='sumi'] .vld-sec{animation:none}}",

  // ============================================================================
  // CARD SHAPE PRIMITIVES + per-surface overrides (mockup 24 / 30-35).
  // Both are generated from the single SHAPE_GEOM map above (geometry only, never
  // color/type). Primitives (.v-shape--<id>) are used directly by renderers;
  // overrides (html[data-shape-<surface>='<id>'] <root>) are emitted last so a
  // customizer override wins over the base + chrome rules. cardShapes:{} emits no
  // attribute, so the default theme is byte-identical to today.
  // Ornaments (.v-orn--*) are separate opt-in classes so a card can compose any
  // shape with any state ornament (presence glow / harm ring / secret seal).
  // ============================================================================
  ...shapePrimitives(),
  ...shapeOverrides(),
  // --- state ornaments (compose with any shape) ---
  // glow: a soft presence/ground-truth halo (motion-free; pure box-shadow).
  ".v-orn--glow{box-shadow:0 0 0 1px color-mix(in srgb,var(--vg) 40%,transparent),0 0 16px rgba(var(--vg-rgb),.28)}",
  // glow-neg: the dramatic-irony tell -- a red halo on a belief that is false.
  ".v-orn--glow-neg{box-shadow:0 0 0 1px color-mix(in srgb,var(--v-neg) 45%,transparent),0 0 14px color-mix(in srgb,var(--v-neg) 30%,transparent)}",
  // ring-harm: a dashed rose ring marking a harmed / at-risk subject.
  ".v-orn--ring-harm{box-shadow:0 0 0 2px color-mix(in srgb,var(--v-neg) 60%,transparent)}",
  ".v-orn--ring-harm{outline:1px dashed color-mix(in srgb,var(--v-neg) 55%,transparent);outline-offset:2px}",
  // seal: a wax seal dot at the top-right; --v-orn-seal-broken cracks it open.
  ".v-orn--seal{position:relative}",
  ".v-orn--seal::after{content:'';position:absolute;top:-6px;right:-6px;width:14px;height:14px;border-radius:50%;background:radial-gradient(circle at 40% 35%,color-mix(in srgb,var(--v-neg) 80%,#fff) 10%,var(--v-neg));box-shadow:0 0 6px rgba(0,0,0,.4)}",
  ".v-orn--seal.is-broken::after{background:radial-gradient(circle at 40% 35%,color-mix(in srgb,var(--v-neg) 40%,transparent),transparent 70%);box-shadow:none;border:1px dashed color-mix(in srgb,var(--v-neg) 55%,transparent)}",

  // ============================================================================
  // CARD SHAPE ORNAMENT LAYER (mockups 30-35). Two mechanisms, both keyed off the
  // data-shape-<surface> attribute (which the DEFAULT chrome never emits, so the
  // default theme stays byte-identical):
  //   1. .v-ornlayer / .v-ornsvg   -> an appended inline-SVG detail (folio fold,
  //      gem facets, ember constellation, scar seam) from ornament.ts.
  //   2. pseudo-element details    -> ticket perforation, futuristic reticle,
  //      modern accent bar, tarot/inset inner frame; pure CSS, no markup.
  // The card roots are position:relative already (or made so here) so the layer
  // pins to the card. All are pointer-events:none and motion-free.
  // ============================================================================
  // the overlay pins to the card, clips to its rounded box, never takes clicks.
  // (Kept for the scar-strikethrough helper; shape details are now pure CSS.)
  ".v-ornlayer{position:absolute;inset:0;pointer-events:none;overflow:hidden;border-radius:inherit;z-index:1}",
  ".v-ornsvg{position:absolute;overflow:visible}",

  // --- pseudo-element shape details (no markup; the card root carries them) ---
  // Each new v3 silhouette keeps its decoration in the card PADDING (reserved in
  // SHAPE_GEOM) so text/avatars never touch it. A shared per-surface selector
  // helper (built below via SD()) applies each detail to whatever surface resolves
  // to that shape.
  // ensure the shape-driven roots can host absolute children.
  "html[data-shape-present] .vld-pc,html[data-shape-bonds] .vle-rel-card,html[data-shape-cast] .vle-card:not(.vle-fac),html[data-shape-beats] .vle-mem--beat,html[data-shape-factions] .vle-fac,html[data-shape-items] .vle-item-row,html[data-shape-secrets] .vle-mem--secret{position:relative}",
  // notched: four corner crosshair ticks (reticle) — sits inside the fixed clip.
  ...shapeDetail('notched', "content:'';position:absolute;inset:3px;pointer-events:none;z-index:1;background:linear-gradient(var(--vg),var(--vg)) 0 0/8px 1px no-repeat,linear-gradient(var(--vg),var(--vg)) 0 0/1px 8px no-repeat,linear-gradient(var(--vg),var(--vg)) 100% 0/8px 1px no-repeat,linear-gradient(var(--vg),var(--vg)) 100% 0/1px 8px no-repeat,linear-gradient(var(--vg),var(--vg)) 0 100%/8px 1px no-repeat,linear-gradient(var(--vg),var(--vg)) 0 100%/1px 8px no-repeat,linear-gradient(var(--vg),var(--vg)) 100% 100%/8px 1px no-repeat,linear-gradient(var(--vg),var(--vg)) 100% 100%/1px 8px no-repeat;opacity:.5", '::before'),
  // tarot: inset hairline frame for the portrait-card feel (sits in the padding).
  ...shapeDetail('tarot', "content:'';position:absolute;inset:4px;border:1px solid color-mix(in srgb,var(--vg) 25%,transparent);border-radius:inherit;pointer-events:none;z-index:1", '::before'),
  // aperture: four L-shaped viewfinder brackets pinned to the corners (in padding).
  ...shapeDetail('aperture', "content:'';position:absolute;inset:5px;pointer-events:none;z-index:1;background:linear-gradient(var(--vg),var(--vg)) 0 0/11px 2px no-repeat,linear-gradient(var(--vg),var(--vg)) 0 0/2px 11px no-repeat,linear-gradient(var(--vg),var(--vg)) 100% 0/11px 2px no-repeat,linear-gradient(var(--vg),var(--vg)) 100% 0/2px 11px no-repeat,linear-gradient(var(--vg),var(--vg)) 0 100%/11px 2px no-repeat,linear-gradient(var(--vg),var(--vg)) 0 100%/2px 11px no-repeat,linear-gradient(var(--vg),var(--vg)) 100% 100%/11px 2px no-repeat,linear-gradient(var(--vg),var(--vg)) 100% 100%/2px 11px no-repeat;opacity:.55", '::before'),
  // stitch: an inset dashed 'stitched' border sitting inside the reserved padding.
  ...shapeDetail('stitch', "content:'';position:absolute;inset:5px;pointer-events:none;z-index:1;border:1.5px dashed color-mix(in srgb,var(--vg) 42%,transparent);border-radius:calc(var(--v-shape-radius) * .7)", '::before'),
  // gilt-edge: a thin keyline hugging all four sides, just inside the padding.
  ...shapeDetail('gilt-edge', "content:'';position:absolute;inset:3px;pointer-events:none;z-index:1;border:1px solid color-mix(in srgb,var(--vg) 40%,transparent);border-radius:calc(var(--v-shape-radius) * .8)", '::before'),
  // studs: four small registration dots pinned inside the corners (in padding).
  ...shapeDetail('studs', "content:'';position:absolute;inset:6px;pointer-events:none;z-index:1;background:radial-gradient(circle 2.4px at 0 0,var(--vg) 98%,transparent) 0 0/6px 6px no-repeat,radial-gradient(circle 2.4px at 100% 0,var(--vg) 98%,transparent) 100% 0/6px 6px no-repeat,radial-gradient(circle 2.4px at 0 100%,var(--vg) 98%,transparent) 0 100%/6px 6px no-repeat,radial-gradient(circle 2.4px at 100% 100%,var(--vg) 98%,transparent) 100% 100%/6px 6px no-repeat;opacity:.7", '::before'),
  // bracket: square [ ] brackets on the two vertical ends (in the side padding).
  ...shapeDetail('bracket', "content:'';position:absolute;top:9px;bottom:9px;left:5px;right:5px;pointer-events:none;z-index:1;background:linear-gradient(var(--vg),var(--vg)) 0 0/2px 100% no-repeat,linear-gradient(var(--vg),var(--vg)) 0 0/8px 2px no-repeat,linear-gradient(var(--vg),var(--vg)) 0 100%/8px 2px no-repeat,linear-gradient(var(--vg),var(--vg)) 100% 0/2px 100% no-repeat,linear-gradient(var(--vg),var(--vg)) 100% 0/8px 2px no-repeat,linear-gradient(var(--vg),var(--vg)) 100% 100%/8px 2px no-repeat;opacity:.6", '::before'),
  // binding: three ledger binding holes down the left edge (in the left padding).
  ...shapeDetail('binding', "content:'';position:absolute;left:7px;top:0;bottom:0;width:5px;pointer-events:none;z-index:1;background:radial-gradient(circle 2.6px at 50% 50%,color-mix(in srgb,var(--vg) 55%,transparent) 98%,transparent);background-size:5px 33.33%;background-repeat:repeat-y;opacity:.8", '::before'),
  // --- FAEWILD shape details (mockup 39). Nature ornaments in reserved padding. ---
  // toadstool: a spotted cap band arcs across the reserved top padding (dots =
  // toadstool speckles), tinted with the 2nd accent so the dome reads as a cap.
  ...shapeDetail('toadstool', "content:'';position:absolute;top:5px;left:12px;right:12px;height:6px;pointer-events:none;z-index:1;border-radius:0 0 60% 60%/0 0 100% 100%;background:radial-gradient(circle 1.5px at 30% 60%,color-mix(in srgb,var(--vsurf-1,#fff) 70%,var(--vg2)) 98%,transparent),radial-gradient(circle 1.5px at 62% 40%,color-mix(in srgb,var(--vsurf-1,#fff) 70%,var(--vg2)) 98%,transparent);background-repeat:no-repeat;border-top:2px solid color-mix(in srgb,var(--vg2) 55%,transparent);opacity:.7", '::before'),
  // trellis: a climbing vine — a wavy stem down the left rail with two leaf nubs,
  // sitting in the reserved left padding so it never crosses content.
  ...shapeDetail('trellis', "content:'';position:absolute;left:8px;top:6px;bottom:6px;width:8px;pointer-events:none;z-index:1;background:linear-gradient(color-mix(in srgb,var(--vg) 60%,transparent),color-mix(in srgb,var(--vg) 60%,transparent)) 3px 0/2px 100% no-repeat,radial-gradient(circle 3px at 100% 22%,color-mix(in srgb,var(--vg) 55%,transparent) 96%,transparent),radial-gradient(circle 3px at 0 58%,color-mix(in srgb,var(--vg) 55%,transparent) 96%,transparent),radial-gradient(circle 3px at 100% 86%,color-mix(in srgb,var(--vg) 55%,transparent) 96%,transparent);background-repeat:no-repeat;opacity:.8", '::before'),
  // bramble: a leafy sprig tucked into the top-left & bottom-right corners (in pad).
  ...shapeDetail('bramble', "content:'';position:absolute;inset:5px;pointer-events:none;z-index:1;background:radial-gradient(circle 3px at 0 0,color-mix(in srgb,var(--vg) 55%,transparent) 96%,transparent),radial-gradient(circle 2px at 9px 4px,color-mix(in srgb,var(--vg) 45%,transparent) 96%,transparent),radial-gradient(circle 2px at 4px 9px,color-mix(in srgb,var(--vg) 45%,transparent) 96%,transparent),radial-gradient(circle 3px at 100% 100%,color-mix(in srgb,var(--vg) 55%,transparent) 96%,transparent),radial-gradient(circle 2px at calc(100% - 9px) calc(100% - 4px),color-mix(in srgb,var(--vg) 45%,transparent) 96%,transparent),radial-gradient(circle 2px at calc(100% - 4px) calc(100% - 9px),color-mix(in srgb,var(--vg) 45%,transparent) 96%,transparent);background-repeat:no-repeat;opacity:.75", '::before'),
  // lantern: a warm bulb glow gathered at the top-center + a little hanging hook
  // drawn just inside the top padding (the '::after' hook rides above the glow).
  ...shapeDetail('lantern', "content:'';position:absolute;top:0;left:0;right:0;height:16px;pointer-events:none;z-index:1;background:radial-gradient(ellipse 40% 120% at 50% 0,color-mix(in srgb,var(--vg2) 40%,transparent),transparent 70%);opacity:.7", '::before'),
  ...shapeDetail('lantern', "content:'';position:absolute;top:2px;left:calc(50% - 4px);width:8px;height:5px;pointer-events:none;z-index:1;border:1.5px solid color-mix(in srgb,var(--vg2) 60%,transparent);border-bottom:none;border-radius:5px 5px 0 0;opacity:.8", '::after'),
  // hanko: vermillion seal stamp at top-right corner (sumi chrome)
  ...shapeDetail('hanko', "content:'';position:absolute;top:-6px;right:-6px;width:36px;height:36px;pointer-events:none;z-index:1;background:radial-gradient(circle at 45% 40%,var(--vg),color-mix(in srgb,var(--vg) 70%,#000));border-radius:4px;box-shadow:0 3px 10px rgba(var(--vg-rgb),.4);transform:rotate(-3deg);opacity:.9", '::after'),
  // --- GATSBY shapes ---
  // sunburst: a keystone triangle + starburst glyph centered in the reserved top pad.
  ...shapeDetail('sunburst', "content:'';position:absolute;top:2px;left:50%;transform:translateX(-50%);width:0;height:0;border-left:14px solid transparent;border-right:14px solid transparent;border-top:9px solid color-mix(in srgb,var(--vg) 80%,transparent);pointer-events:none;z-index:1", '::before'),
  ...shapeDetail('sunburst', "content:'\\2726';position:absolute;top:1px;left:50%;transform:translateX(-50%);color:var(--vg);font-size:.8rem;line-height:1;text-shadow:0 0 10px rgba(var(--vg-rgb),.7);pointer-events:none;z-index:2", '::after'),
  // marquee: dotted theater-light strips inside the reserved top & bottom padding.
  ...shapeDetail('marquee', "content:'';position:absolute;top:4px;left:8px;right:8px;height:3px;pointer-events:none;z-index:1;background:repeating-linear-gradient(90deg,var(--vg) 0,var(--vg) 3px,transparent 3px,transparent 9px);opacity:.7", '::before'),
  ...shapeDetail('marquee', "content:'';position:absolute;bottom:4px;left:8px;right:8px;height:3px;pointer-events:none;z-index:1;background:repeating-linear-gradient(90deg,transparent 0,transparent 3px,var(--vg) 3px,var(--vg) 9px);opacity:.7", '::after'),
  // stepped: a nested ziggurat corner frame — two inset L-corners drawn in padding.
  ...shapeDetail('stepped', "content:'';position:absolute;inset:4px;pointer-events:none;z-index:1;background:linear-gradient(var(--vg),var(--vg)) 0 0/14px 2px no-repeat,linear-gradient(var(--vg),var(--vg)) 0 0/2px 14px no-repeat,linear-gradient(var(--vg),var(--vg)) 100% 100%/14px 2px no-repeat,linear-gradient(var(--vg),var(--vg)) 100% 100%/2px 14px no-repeat;opacity:.6", '::before'),
  ...shapeDetail('stepped', "content:'';position:absolute;inset:8px;pointer-events:none;z-index:1;background:linear-gradient(var(--vg),var(--vg)) 0 0/8px 2px no-repeat,linear-gradient(var(--vg),var(--vg)) 0 0/2px 8px no-repeat,linear-gradient(var(--vg),var(--vg)) 100% 100%/8px 2px no-repeat,linear-gradient(var(--vg),var(--vg)) 100% 100%/2px 8px no-repeat;opacity:.4", '::after'),
  // --- SUMI shapes ---
  // washi-fold: a folded-paper corner triangle at the top-right, in the reserved pad.
  ...shapeDetail('washi-fold', "content:'';position:absolute;top:0;right:0;width:0;height:0;pointer-events:none;z-index:1;border-top:16px solid color-mix(in srgb,var(--vi) 12%,transparent);border-left:16px solid transparent;filter:drop-shadow(-1px 1px 1px rgba(var(--vi),.18))", '::before'),
  // --- F2 modern shape-suppression (mockup 32): non-hero surfaces are flat slabs
  // differentiated by a LEFT ACCENT BAR + faint fill tint, not a silhouette. The
  // hero (present) stays frosted glass. Scoped to the modern chrome only.
  "html[data-vle-chrome='modern'] .vle-mem--beat,html[data-vle-chrome='modern'] .vle-fac,html[data-vle-chrome='modern'] .vle-card:not(.vle-fac),html[data-vle-chrome='modern'] .vle-item-row{position:relative;background:color-mix(in srgb,var(--vg) 4%,var(--vsurf1,transparent))}",
  "html[data-vle-chrome='modern'] .vle-mem--beat::before,html[data-vle-chrome='modern'] .vle-fac::before,html[data-vle-chrome='modern'] .vle-card:not(.vle-fac)::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;border-radius:3px 0 0 3px;background:var(--vg);opacity:.8;pointer-events:none;z-index:1}",
  "html[data-vle-chrome='modern'] .vle-fac::before{background:var(--v-info)}",
  // --- avatar reshape: tarot + hanko => taller portrait medallion ---
  "[data-shape-cast='tarot'] .vle-card:not(.vle-fac) .vle-av,[data-shape-present='tarot'] .vld-pc .vld-pc-av,[data-shape-cast='hanko'] .vle-card:not(.vle-fac) .vle-av,[data-shape-present='hanko'] .vld-pc .vld-pc-av{border-radius:44% / 40%}",

  // --- Preset Editor Tab styles ---
  ".vle-pt-root{padding:12px;font-size:12px;line-height:1.5;color:var(--lumiverse-text,#cdbfa0);display:flex;flex-direction:column;gap:16px}",
  ".vle-pt-sec{background:color-mix(in srgb,var(--vg,#d4af37) 6%,transparent);border-left:2px solid color-mix(in srgb,var(--vg,#d4af37) 40%,transparent);border-radius:4px;padding:10px;display:flex;flex-direction:column;gap:8px}",
  ".vle-pt-head{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--vg,#d4af37);opacity:0.9}",
  ".vle-pt-badge{display:flex;align-items:center;gap:6px;font-size:12px}",
  ".vle-pt-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}",
  ".vle-pt-dot.linked{background:var(--v-ok,#90ee90)}",
  ".vle-pt-dot.unlinked{background:color-mix(in srgb,var(--lumiverse-text,#cdbfa0) 30%,transparent)}",
  ".vle-pt-dot.ok{background:var(--v-ok,#90ee90)}",
  ".vle-pt-dot.warn{background:var(--v-warn,#f4a460)}",
  ".vle-pt-dot.err{background:var(--v-err,#cd5c5c)}",
  ".vle-pt-btn{background:color-mix(in srgb,var(--vg,#d4af37) 12%,transparent);border:1px solid color-mix(in srgb,var(--vg,#d4af37) 30%,transparent);color:var(--lumiverse-text,#cdbfa0);border-radius:4px;padding:5px 10px;font-size:11px;cursor:pointer;transition:all 0.15s;margin-top:4px}",
  ".vle-pt-btn:hover{background:color-mix(in srgb,var(--vg,#d4af37) 20%,transparent);border-color:var(--vg,#d4af37)}",
  ".vle-pt-btn:active{transform:translateY(1px)}",
  ".vle-pt-line{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:11px;color:color-mix(in srgb,var(--lumiverse-text,#cdbfa0) 80%,transparent)}",
  ".vle-pt-line strong{color:var(--lumiverse-text,#cdbfa0);font-weight:600}",
  ".vle-pt-preview{background:color-mix(in srgb,var(--lumiverse-text,#cdbfa0) 4%,transparent);border:1px solid color-mix(in srgb,var(--lumiverse-text,#cdbfa0) 15%,transparent);border-radius:4px;padding:8px;font-family:ui-monospace,'Cascadia Code',Consolas,monospace;font-size:10px;line-height:1.4;color:color-mix(in srgb,var(--lumiverse-text,#cdbfa0) 85%,transparent);max-height:140px;overflow-y:auto;white-space:pre-wrap;word-break:break-word;margin-top:6px}",
  ".vle-pt-toggle{cursor:pointer;user-select:none;color:var(--vg,#d4af37);font-size:11px;font-weight:600;display:inline-flex;align-items:center;gap:4px;margin-top:4px}",
  ".vle-pt-toggle:hover{opacity:0.8}",
  ".vle-pt-coll{display:none}",
  ".vle-pt-coll.open{display:block}",

  // ===== CHRONICLE REDESIGN — Memory / Knowledge / Secrets / Scars / Codex =====
  // MEMORY — Arc spine covers
  ".vle-m-arc{display:flex;gap:0;margin-bottom:0.5rem;border-radius:6px;overflow:hidden;border:1px solid var(--vle-keyline);background:linear-gradient(135deg,color-mix(in srgb,var(--vg) 8%,transparent),color-mix(in srgb,var(--vsurf-2) 55%,transparent));transition:border-color .18s,box-shadow .18s}",
  ".vle-m-arc:hover{border-color:var(--vle-keyline-strong);box-shadow:0 6px 22px rgba(0,0,0,0.35)}",
  ".vle-m-arc.done{opacity:0.52}",
  ".vle-m-arc-bar{width:4px;flex-shrink:0;background:linear-gradient(180deg,var(--vle-gold-bright),var(--vle-gold-dim))}",
  ".vle-m-arc.done .vle-m-arc-bar{background:var(--vle-gold-dim);opacity:0.5}",
  ".vle-m-arc-body{flex:1;padding:0.65rem 0.8rem}",
  ".vle-m-arc-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:0.35rem}",
  ".vle-m-arc-tier{font-family:var(--mono);font-size:0.52rem;letter-spacing:0.14em;text-transform:uppercase;color:var(--vg);background:color-mix(in srgb,var(--vg) 13%,transparent);border:1px solid color-mix(in srgb,var(--vg) 25%,transparent);border-radius:3px;padding:1px 6px}",
  ".vle-m-arc-span{font-family:var(--mono);font-size:0.56rem;color:var(--vink-faint);letter-spacing:0.04em}",
  ".vle-m-arc-text{font-size:0.85rem;color:var(--vink-dim);line-height:1.5;margin-bottom:0.5rem}",
  ".vle-m-arc-foot{display:flex;justify-content:space-between;align-items:center}",
  ".vle-m-arc-covers{font-family:var(--mono);font-size:0.54rem;color:var(--vink-faint);letter-spacing:0.04em}",
  // MEMORY — Chapter cards
  ".vle-m-chap{border-radius:6px;border:1px solid var(--vle-keyline);overflow:hidden;background:var(--vsurf-2);margin-bottom:0.4rem;transition:border-color .15s}",
  ".vle-m-chap:hover{border-color:var(--vle-keyline-strong)}",
  ".vle-m-chap-head{display:flex;align-items:center;gap:0.5rem;padding:0.55rem 0.75rem;cursor:pointer;user-select:none}",
  ".vle-m-chap-chev{color:var(--vle-gold-dim);font-size:0.56rem;transition:transform .18s;flex-shrink:0}",
  ".vle-m-chap.open .vle-m-chap-chev{transform:rotate(90deg);color:var(--vg)}",
  ".vle-m-chap-tw{flex:1;display:flex;align-items:baseline;gap:0.5rem;min-width:0}",
  ".vle-m-chap-tier{font-family:var(--mono);font-size:0.5rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--vink-faint);background:color-mix(in srgb,var(--vg) 7%,transparent);border:1px solid var(--vle-keyline);border-radius:3px;padding:1px 5px;flex-shrink:0}",
  ".vle-m-chap-title{font-size:0.87rem;color:var(--vink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".vle-m-chap-span{font-family:var(--mono);font-size:0.54rem;color:var(--vink-faint);flex-shrink:0;margin-left:auto}",
  ".vle-m-chap-body{display:none;padding:0 0.75rem 0.75rem;border-top:1px solid var(--vle-keyline)}",
  ".vle-m-chap.open .vle-m-chap-body{display:block}",
  ".vle-m-chap-text{font-size:0.83rem;color:var(--vink-dim);line-height:1.5;padding-top:0.55rem;margin-bottom:0.5rem}",
  ".vle-m-chap-turns{background:color-mix(in srgb,var(--vg) 4%,transparent);border:1px solid var(--vle-keyline);border-radius:5px;padding:0.5rem 0.65rem}",
  ".vle-m-chap-turns-label{font-family:var(--mono);font-size:0.52rem;color:var(--vle-gold-dim);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:0.4rem}",
  ".vle-m-turn-chip{font-family:var(--mono);font-size:0.58rem;color:var(--vink-faint);padding:0.18rem 0;border-bottom:1px solid color-mix(in srgb,var(--vg) 10%,transparent);line-height:1.35}",
  ".vle-m-turn-chip:last-child{border-bottom:none}",
  // MEMORY — Raw uncovered turn rows
  ".vle-m-turns-label{font-family:var(--mono);font-size:0.54rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--vink-faint);margin-bottom:0.45rem;margin-top:0.6rem}",
  ".vle-m-turns-grid{display:grid;gap:0.3rem}",
  ".vle-m-turn-raw{display:flex;align-items:baseline;gap:0.5rem;background:color-mix(in srgb,var(--vg) 4%,transparent);border:1px solid var(--vle-keyline);border-radius:4px;padding:0.4rem 0.6rem;transition:border-color .15s}",
  ".vle-m-turn-raw:hover{border-color:color-mix(in srgb,var(--vg) 35%,transparent)}",
  ".vle-m-turn-raw-t{font-family:var(--mono);font-size:0.54rem;color:var(--vle-gold-dim);flex-shrink:0;letter-spacing:0.03em}",
  ".vle-m-turn-raw-x{font-size:0.8rem;color:var(--vink-faint);flex:1;line-height:1.35}",
  // KNOWLEDGE — Epistemic character cards
  ".vle-k-card{border:1px solid var(--vle-keyline);border-radius:6px;overflow:hidden;background:var(--vsurf-2);margin-bottom:0.55rem}",
  ".vle-k-card.collapsed-k{opacity:0.65}",
  ".vle-k-card-head{display:flex;align-items:center;justify-content:space-between;padding:0.5rem 0.75rem;border-bottom:1px solid var(--vle-keyline);background:linear-gradient(90deg,color-mix(in srgb,var(--vg) 6%,transparent),transparent)}",
  ".vle-k-card-name{font-size:0.88rem;font-weight:600;color:var(--vink);letter-spacing:0.01em}",
  ".vle-k-card-count{font-family:var(--mono);font-size:0.52rem;color:var(--vle-gold-dim);letter-spacing:0.07em;text-transform:uppercase}",
  ".vle-k-rows{padding:0.25rem 0}",
  ".vle-k-row{display:flex;align-items:baseline;gap:0.5rem;padding:0.35rem 0.75rem;transition:background .12s}",
  ".vle-k-row:hover{background:color-mix(in srgb,var(--vg) 4%,transparent)}",
  ".vle-k-row.believes{background:color-mix(in srgb,var(--v-warn) 7%,transparent)}",
  ".vle-k-row.believes:hover{background:color-mix(in srgb,var(--v-warn) 11%,transparent)}",
  ".vle-k-row.suspects{background:color-mix(in srgb,var(--v-warn) 3%,transparent)}",
  ".vle-k-row.irony{background:color-mix(in srgb,var(--v-neg) 12%,transparent);border-left:3px solid color-mix(in srgb,var(--v-neg) 60%,transparent)}",
  ".vle-k-row.irony:hover{background:color-mix(in srgb,var(--v-neg) 16%,transparent)}",
  ".vle-k-rel{flex-shrink:0;width:14px;text-align:center;font-size:0.85rem}",
  ".vle-k-rel.knows{color:var(--vink-faint);font-size:1rem}",
  ".vle-k-rel.believes{color:var(--v-warn);font-size:0.72rem}",
  ".vle-k-rel.suspects{color:var(--v-warn-i);opacity:0.6;font-size:0.8rem}",
  ".vle-k-rel.irony{color:var(--v-neg-i);font-size:0.8rem}",
  ".vle-k-fact{flex:1;font-size:0.83rem;color:var(--vink-dim);line-height:1.45;min-width:0}",
  ".vle-k-irony-label{display:inline-block;font-family:var(--mono);font-size:0.52rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--v-neg-i);background:color-mix(in srgb,var(--v-neg) 18%,transparent);border:1px solid color-mix(in srgb,var(--v-neg) 35%,transparent);border-radius:3px;padding:1px 5px;margin-right:0.4rem;vertical-align:middle}",
  ".vle-k-about{font-family:var(--mono);font-size:0.52rem;color:var(--vink-faint);flex-shrink:0;white-space:nowrap;letter-spacing:0.03em}",
  // SECRETS — Danger-coded sealed envelopes
  ".vle-sec-card{display:flex;border-radius:6px;overflow:hidden;border:1px solid var(--vle-keyline);margin-bottom:0.5rem;transition:border-color .18s,box-shadow .15s;position:relative}",
  ".vle-sec-card:hover{box-shadow:0 4px 14px rgba(0,0,0,0.25)}",
  ".vle-sec-danger-bar{width:3px;flex-shrink:0}",
  ".vle-sec-card.minor{background:var(--vsurf-2)}",
  ".vle-sec-card.minor .vle-sec-danger-bar{background:linear-gradient(180deg,var(--v-info-i),var(--v-info))}",
  ".vle-sec-card.minor:hover{border-color:color-mix(in srgb,var(--v-info) 55%,transparent)}",
  ".vle-sec-card.major{background:color-mix(in srgb,var(--v-warn) 6%,var(--vsurf-2))}",
  ".vle-sec-card.major .vle-sec-danger-bar{background:linear-gradient(180deg,var(--v-warn-i),var(--v-warn))}",
  ".vle-sec-card.major:hover{border-color:color-mix(in srgb,var(--v-warn) 55%,transparent)}",
  ".vle-sec-card.explosive{background:color-mix(in srgb,var(--v-neg) 6%,var(--vsurf-2))}",
  ".vle-sec-card.explosive .vle-sec-danger-bar{background:linear-gradient(180deg,var(--v-neg-i),var(--v-neg))}",
  ".vle-sec-card.explosive:hover{border-color:color-mix(in srgb,var(--v-neg) 60%,transparent)}",
  ".vle-sec-card.revealed{opacity:0.52;border-style:dashed}",
  ".vle-sec-card.revealed .vle-sec-danger-bar{opacity:0.4}",
  ".vle-sec-body{flex:1;padding:0.6rem 0.75rem;position:relative;overflow:hidden}",
  ".vle-sec-watermark{position:absolute;top:50%;right:0.75rem;transform:translateY(-50%) rotate(-12deg);font-family:var(--mono);font-size:1.4rem;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:var(--v-neg);opacity:0.13;pointer-events:none;white-space:nowrap}",
  ".vle-sec-head-row{display:flex;align-items:center;gap:0.45rem;margin-bottom:0.45rem;flex-wrap:wrap}",
  ".vle-sec-keeper{font-weight:600;font-size:0.87rem;color:var(--vink)}",
  ".vle-sec-danger{font-family:var(--mono);font-size:0.52rem;letter-spacing:0.08em;text-transform:uppercase;padding:1px 6px;border-radius:999px;border:1px solid transparent}",
  ".vle-sec-danger.explosive{color:var(--v-neg-i);border-color:color-mix(in srgb,var(--v-neg) 40%,transparent);background:color-mix(in srgb,var(--v-neg) 14%,transparent)}",
  ".vle-sec-danger.major{color:var(--v-warn-i);border-color:color-mix(in srgb,var(--v-warn) 40%,transparent);background:color-mix(in srgb,var(--v-warn) 14%,transparent)}",
  ".vle-sec-danger.minor{color:var(--v-info-i);border-color:color-mix(in srgb,var(--v-info) 40%,transparent);background:color-mix(in srgb,var(--v-info) 14%,transparent)}",
  ".vle-sec-from-label{font-family:var(--mono);font-size:0.52rem;color:var(--vink-faint);letter-spacing:0.05em}",
  ".vle-sec-from-chip{font-family:var(--mono);font-size:0.54rem;color:var(--vink-dim);background:var(--vsurf-3);border:1px solid var(--vle-keyline);border-radius:999px;padding:1px 7px}",
  ".vle-sec-text{font-size:0.83rem;color:var(--vink-dim);line-height:1.5;margin-bottom:0.5rem}",
  ".vle-sec-foot{display:flex;justify-content:space-between;align-items:center}",
  ".vle-sec-turn{font-family:var(--mono);font-size:0.52rem;color:var(--vink-faint);letter-spacing:0.04em}",
  // SCARS — Palimpsest wound cards
  ".vle-scar-group{margin-bottom:0.9rem}",
  ".vle-scar-group-head{font-family:var(--mono);font-size:0.54rem;letter-spacing:0.18em;text-transform:uppercase;color:var(--vle-gold-dim);padding:0.3rem 0;border-bottom:1px solid var(--vle-keyline);margin-bottom:0.4rem}",
  ".vle-scar-card{border-radius:6px;overflow:hidden;border:1px solid color-mix(in srgb,var(--v-neg) 28%,transparent);background:linear-gradient(160deg,color-mix(in srgb,var(--v-neg) 8%,var(--vsurf-2)),var(--vsurf-2));padding:0.6rem 0.75rem;position:relative;transition:border-color .15s,box-shadow .15s;margin-bottom:0.4rem}",
  ".vle-scar-card::before{content:'';position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 80% 60% at 0% 50%,color-mix(in srgb,var(--v-neg) 7%,transparent),transparent 70%)}",
  ".vle-scar-card:hover{border-color:color-mix(in srgb,var(--v-neg) 50%,transparent);box-shadow:0 3px 12px rgba(0,0,0,0.25)}",
  ".vle-scar-head{display:flex;align-items:baseline;gap:0.5rem;margin-bottom:0.45rem;position:relative}",
  ".vle-scar-who{font-weight:600;font-size:0.87rem;color:var(--vink)}",
  ".vle-scar-turn{font-family:var(--mono);font-size:0.52rem;color:var(--vink-faint);letter-spacing:0.05em}",
  ".vle-scar-was{font-size:0.83rem;color:color-mix(in srgb,var(--vink-dim) 65%,transparent);text-decoration:line-through;text-decoration-color:color-mix(in srgb,var(--v-neg) 55%,transparent);text-decoration-thickness:1.5px;line-height:1.45;margin-bottom:0.45rem;position:relative}",
  ".vle-scar-about{display:inline-block;font-family:var(--mono);font-size:0.52rem;color:var(--vink-faint);margin-left:0.4rem;text-decoration:none}",
  ".vle-scar-divider{height:1px;background:repeating-linear-gradient(90deg,color-mix(in srgb,var(--v-neg) 35%,transparent) 0,color-mix(in srgb,var(--v-neg) 35%,transparent) 4px,transparent 4px,transparent 8px);margin-bottom:0.45rem}",
  ".vle-scar-now{font-size:0.8rem;color:var(--vink-faint);font-style:italic;line-height:1.45;position:relative}",
  ".vle-scar-now-label{display:inline-block;font-family:var(--mono);font-size:0.5rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--v-neg-i);font-style:normal;background:color-mix(in srgb,var(--v-neg) 14%,transparent);border:1px solid color-mix(in srgb,var(--v-neg) 30%,transparent);border-radius:3px;padding:1px 5px;margin-right:0.4rem;vertical-align:middle}",
  // CODEX — Tag-grouped canon index
  ".vle-lore-group{margin-bottom:0.9rem}",
  ".vle-lore-group-head{font-family:var(--mono);font-size:0.54rem;letter-spacing:0.18em;text-transform:uppercase;color:var(--vle-gold-dim);padding:0.3rem 0;border-bottom:1px solid var(--vle-keyline);margin-bottom:0.4rem}",
  ".vle-lore-row{display:flex;align-items:baseline;gap:0.55rem;padding:0.38rem 0.4rem 0.38rem 0.75rem;border-left:2px solid color-mix(in srgb,var(--vg) 30%,transparent);margin-bottom:0.28rem;border-radius:0 4px 4px 0;transition:border-left-color .15s,background .12s}",
  ".vle-lore-row:hover{border-left-color:var(--vg);background:color-mix(in srgb,var(--vg) 4%,transparent)}",
  ".vle-lore-fact{flex:1;font-size:0.83rem;color:var(--vink-dim);line-height:1.45}",
  ".vle-lore-turn{font-family:var(--mono);font-size:0.52rem;color:var(--vink-faint);flex-shrink:0;letter-spacing:0.03em}",

].join('\n');


