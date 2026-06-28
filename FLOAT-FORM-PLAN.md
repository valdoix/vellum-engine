# VELLUM II — Float "form factor" redesign (implementation plan)

Make the floating window *embody its chrome* instead of being a themed box:
each chrome becomes an OBJECT — illuminated → book/parchment, modern → phone,
futuristic → Oracle HUD. Built on what exists: the `chrome` axis
(illuminated/modern/futuristic, set as `data-vle-chrome`), the dashboard's pure
section registry, and the `LayoutDef` engine (order/hidden/collapsed/density/
columns).

Two genuinely new primitives, everything else is presets:
1. **Form layer** — per-chrome frame skin (gutter / deckle / notch / brackets)
   as overlay pseudo-elements between `.vlf-frame` and the body, driven by
   `data-vle-chrome`. Pure CSS; decoration only, body stays inset (the
   futuristic corner-ticks already prove the pattern).
2. **Single-section + switcher layout mode** — "show one section, tab between
   them" (the phone dock; optional for HUD), a new `LayoutDef` shape riding the
   existing section registry.

Files: `styles.ts`, `float.ts`, `layout-defs.ts`, `dashboard.ts`, `theme.ts`.
No new deps. Gate each phase: `bun run typecheck && bun run test && bun run build`.

Width-safe: the float is freely resized, so 2-col/phone forms switch on a
container-query (book → parchment under ~360px), mirroring the dashboard's
existing `@container (max-width:380px)` 2→1 fallback. Decoration never eats
content height.

---

## Phase 1 — Form layer scaffolding (pure CSS, low risk)
- Add a form wrapper hook on the float body: `dashboard.ts` already wraps in
  `<div class="vld">`; add `data-vle-form` mirroring the active chrome onto the
  float root in `float.ts.applyTheme()` (it already calls `applyTheme`). One
  attribute, no markup churn.
- styles.ts: a `.vlf[data-vle-chrome='…']` block per form, all decoration via
  `::before/::after` + masks on `.vlf-frame`, body inset so nothing overlaps.
- Ship this phase with NO visual form yet beyond what exists — it's the plumbing
  + verifying the attribute flows. (Keeps the risky CSS isolated to Phase 2-4.)

## Phase 2 — Fantasy forms (illuminated chrome)
Two sub-forms gated by column count + width, so they reuse `cols`:
- **Book (cols=2)** — center gutter seam (vertical gradient pseudo-element on
  `.vld-inner[data-cols='2']` under illuminated), page-curl bottom corners,
  footer "folio" line (restyle `status` section when it's last), and a vine
  tension bar variant (❧/○ glyphs) — a CSS swap on `.vld-tension` under
  illuminated, not new markup.
- **Parchment (cols=1)** — deckle-edge mask (top/bottom `mask-image`), dotted
  rule dividers between sections (replace card borders with `::after` dotted
  separators under illuminated+cols1), parchment texture default.
- New layout presets in `layout-defs.ts`: `codex` (cols=2, scene-ish order) and
  `scroll` (cols=1, ledger-ish order) so the picker offers them by name.
- Container-query: `codex` collapses to single-column parchment under ~360px.
- ponytail: vine/deckle are decorative-only; if a skin's contrast makes them
  noisy, they sit under `[data-vle-chrome='illuminated']` so other skins are
  untouched.

## Phase 3 — Phone form (modern chrome) — the bold reframe
The structurally new one: a **single-section + bottom dock** layout.
- `layout-defs.ts`: add an optional `mode?: 'stack' | 'switch'` to `LayoutDef`
  (default 'stack' = today's behavior, fully back-compat). A `phone` preset uses
  `mode:'switch'`.
- `dashboard.ts`: when `mode==='switch'`, render ONE section (tracked by a module
  `_activeSection`, default first in `order`) + a **dock** of the `order` ids as
  tappable icons; clicking swaps the active section. Reuses the section registry
  verbatim — only the compose loop branches. Dock click is delegated like the
  existing pager/filter wiring; `refreshUI()` re-renders.
- styles.ts (modern chrome): notch/status-bar top strip (turn·day as "time", cast
  count + tension as "signal/battery"), present-cast rendered as notification
  cards (restyle `.vld-pc` under phone form), bottom dock bar, home-bar grip.
- Phone aspect: cap body width when phone form is active (`max-width` + center) so
  it reads as a device even when the float is dragged wide; under a tiny width it
  just fills. Container-query, not a fixed size.

## Phase 4 — Oracle HUD form (futuristic chrome)
- styles.ts (futuristic chrome): telemetry framing — corner brackets (extend the
  existing corner-ticks), `▷`-prefixed status rows, vital-bars on present cast
  (reuse the `bar()` meter shape), threads as "signals" with status flags, and a
  **system footer** showing live `recall mode` + injection char count.
- The system footer needs two values the float doesn't currently hold: the
  traversal mode label and the latest injection `chars`. Thread them in:
  - traversal mode: `app.ts` already tracks `_traverseMode/_traverseAxis`; pass a
    getter into the float dashboard render (or stash on a module read by
    dashboard.ts). Small, read-only.
  - inj chars: `injection.ts` holds `_log[0].chars`; expose a tiny getter.
  - ponytail: if wiring both is fussy, v1 HUD footer shows only `recall=…`
    (already in app state); add inj chars when the getter lands. Don't block the
    visual on it.
- HUD can optionally use `mode:'switch'` too, but default it to a dense `stack`
  (compact density) so it stays glanceable without taps.

## Phase 5 — Bind form to chrome + picker copy
- `theme.ts`: when a chrome is chosen via the Mode tab, default its companion
  layout (illuminated→codex, modern→phone, futuristic→hud) UNLESS the user has
  explicitly picked a layout — so chrome becomes a *form* choice, not just a
  palette, but the layout picker still overrides. (Reuse the MODES patch bundle;
  add a `layout` field to each mode's patch.)
- Update the Mode-tab blurbs to name the form ("Illuminated — an open codex").
- Layout picker keeps all presets selectable independent of chrome.

## Verify (each phase)
typecheck → test → build → reload. Manual: switch chrome in the Mode tab, open
the float — book has a gutter + folio; drag it narrow → parchment; modern shows
notch + dock and taps swap sections; futuristic shows brackets + telemetry
footer with the live recall mode. Confirm decoration never clips the body and
the drawer "Now" tab (same dashboard) still renders in plain stack form (forms
are float-scoped via `.vlf` selectors, so the drawer is unaffected — verify).

## Risk notes
- The ONE structural change is `mode:'switch'` in dashboard.ts; everything else
  is CSS under chrome-scoped selectors. Keep `mode` optional + default 'stack' so
  every existing layout and the drawer Now view are byte-identical.
- Form CSS is `.vlf`-scoped so it can't leak into the drawer shell or modals.
- Container-queries already used in styles.ts (`vld-stage,.vlf-body{container-
  type:inline-size}`) — reuse that container, don't add new ones.

## Out of scope (YAGNI)
- No new sections; forms re-skin/re-arrange the seven that exist.
- No physics/page-turn animation — page-curl is a static corner, not a transition.
- No per-form custom-editor UI; Custom layout stays stack-mode.
