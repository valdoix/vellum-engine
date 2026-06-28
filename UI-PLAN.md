# VELLUM II — UI refinement plan

All work lands in `src/ui/styles.ts` + `src/ui/theme.ts` (+ small className swaps in
`ui/tabs/`, `dashboard.ts`, `ui/graph/`). No new files, no new deps. Gate every phase
on `bun run typecheck && bun run test && bun run build`.

The token layer + customize panel already shipped (skins, accent, fonts, scale, layout).
These phases *finish* that system rather than redo it.

## Phase 0 — Token foundation (`:root` + theme.ts)
4px spacing scale (`--v1..--v6`), radius scale (`--vr1/2/3` + `--rpill`), and
skin-tunable semantic colors (`--v-pos/--v-neg/--v-info/--v-warn`, each with an `-i`
ink variant). Add the four semantics to `Skin`, every `SKINS` entry, `DEFAULT`,
`sanitize` (hex-guarded), and the `applyTheme` `set()` block.

## Phase 1 — Unify the chip zoo
One `.v-chip` family with tone modifiers (`--gold/--pos/--neg/--info/--muted`).
Migrate `vle-cat/st/krel*/mem-tier/jr-tag/inj-reason`, `vlv-entry-cat/firing`,
`vld-cat/mood/cond` to it; delete the bespoke rules. ~60% of the visible win.

## Phase 2 — Make `--vradius` actually work
Repoint inner card/chip radii to `--vr*` so the corner-radius slider affects more than
just `.vlf-frame`. Keep the `0 X X 0` margin-rule shape via `0 var(--vr2) var(--vr2) 0`.

## Phase 3 — Quiet the borders
Content cards lean on `--vsurf-*`; gold hairline moves to `:hover`/`.on` only.
Structural dividers (tabbar, section headers, modal foot) keep borders.

## Phase 4 — Type floor + focus ring (a11y, do not skip)
Mono-label floor 9px (fix 7/7.5/8px labels), collapse to ~5 steps.
One `:focus-visible` ring across shell; graph nodes get `tabindex`/`role`/`aria-label`.

## Phase 5 — Chrome axis (floating-window "modes") — NEW
Not three monolithic modes: one orthogonal `chrome` axis, composable with all 6 skins.

- `theme.ts`: `chrome: 'illuminated' | 'modern' | 'futuristic'` on Theme/DEFAULT,
  enum-guarded in `sanitize`; `applyTheme` sets `data-vle-chrome` on documentElement.
  A `MODES` preset table (same shape as `SKINS`) where picking a mode `patchTheme`s a
  bundle (chrome + sensible radius/texture/glow/title-font defaults) the user can still
  override. New `mode` tab in the Customize panel reusing the skin-grid markup.
- `styles.ts`: scope the fantasy ornament (`.vlf-frame::before` double-rule,
  `.vlf-frame::after` gold bloom, `.vlf-grip` gilt hatch, `.vlf-title` serif/+3px)
  behind `[data-vle-chrome='illuminated']`; add `modern` (no inset rule, flat shadow,
  sans title, tighter radius) and `futuristic` (sharp corners, accent edge-glow, mono
  CAPS title, corner-tick grip) overrides that consume `--vr*` + semantic tokens.

Decisions:
- Mode ≠ skin. Orthogonal. "Crimson / Futuristic" must work.
- A "mode" is a preset macro over existing axes, not a new render path — zero new state
  beyond the one enum.
- v1 futuristic = sharp small radius + edge-glow + tick pseudo-elements, NOT `clip-path`
  notches (clip-path breaks `overflow:hidden` + `backdrop-filter` blur). Add notches only
  if asked, dropping blur on that chrome.

Order: ship Phase 5 first (the explicit ask), then 0–1 (biggest polish), then 2–4.
