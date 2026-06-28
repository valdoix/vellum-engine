# VELLUM II — Character name colors + gradient (implementation plan)

Let a character carry a name color (and optional gradient), applied everywhere
the name renders. Additive + keyed on the character `id`, so it's set once and
shows across cast/relations/journal/knowledge/secrets/timeline/search/director/
factions, plus the graph (solid only in v1).

Files: `domain/types.ts`, `domain/commands.ts` (cast_upsert), `core/events.ts` +
`core/reduce.ts` (carry the field), `ui/format.ts` (the render helper), `ui/styles.ts`,
the cast edit modal (`ui/tabs/cast.ts`), the ~name-render sites, `ui/graph/render.ts`.
No new deps. Gate: `bun run typecheck && bun run test && bun run build`.

## How names render today (the surfaces)
- ~15 `nameOf(state,id)` sites + ~19 `.name` renders → bare string `esc()`'d into
  HTML text. CSS `color`/clip-gradient works here.
- The graph renders names in SVG `<text fill>` (`render.ts:96-100`) — CSS gradient
  does NOT apply; needs a solid `fill` or an SVG `<linearGradient>` in `<defs>`.
- Default (no color) must look exactly as today (inherited ink).

## Phase 1 — Data: color on the character (additive, persisted)
- `CastCard` gains `color?: string` and `colorTo?: string` (gradient end; absent =
  solid). `domain/types.ts`.
- `cast_upsert` (commands.ts) accepts + canonicalizes `color`/`colorTo` (validate
  as #hex, drop otherwise — never store junk). Carry through the cast event
  (`core/events.ts` cast schema + `core/reduce.ts` apply), like `role`/`appearance`.
- Migration-safe: old cards simply lack the fields → no color.
- Tests: upsert with valid/invalid hex; reduce carries it; absent = undefined.

## Phase 2 — Render helper (the single seam)
- `nameHtml(state, id)` in `format.ts`:
  - no color → `esc(name)` (today's output, zero change).
  - solid → `<span class="vle-name" style="color:#hex">name</span>`.
  - gradient → `<span class="vle-name vle-name--grad" style="--c1:#a;--c2:#b">name</span>`
    where `.vle-name--grad` does the `background:linear-gradient(--c1,--c2);
    -webkit-background-clip:text;background-clip:text;color:transparent` combo.
  - always `esc()` the name; hex is validated at write-time but re-checked here
    (defense in depth) so no style-injection via a crafted color.
- Keep `nameOf` (raw string) for non-HTML uses: aria-labels, data-attributes,
  modal value prefills, the graph (it needs the raw string + its own coloring).

## Phase 3 — Swap HTML name sites to nameHtml
Mechanical: replace `esc(nameOf(...))` / `esc(c.name)` with `nameHtml(...)` at the
HTML render sites across cast, relations, journal, knowledge, secrets, timeline,
search, director, factions. Leave raw-string uses alone. The win: all key off the
one central color on the card.
- Cast card name also uses `nameHtml` (a character coloring its own card).

## Phase 4 — Cast edit modal: the picker
- Add to the cast form (`cast.ts` castForm): a `type:'color'` field "Name color"
  + a "Gradient" checkbox that reveals a second `type:'color'` "Gradient end".
  (formModal already supports `select`/`text`/`checks`; add a `color` field type
  to modal.ts if not present — small.)
- On save, send `color`/`colorTo` through `cast_upsert`. Empty = clear (back to
  inherited ink).
- ponytail: a tiny set of preset swatches could come later; v1 = two color inputs.

## Phase 5 — Graph (solid only in v1)
- Apply the character's `color` to the node label `fill` in `render.ts` (and
  optionally the initials), falling back to the current ink.
- Gradient in SVG is deferred: would need a `<linearGradient id="grad-<id>">` in
  `<defs>` + `fill="url(#grad-<id>)"`. ponytail: add when asked; the node is tiny
  and solid reads fine.

## Phase 6 — Guardrails (accessibility)
- Names are primary content, so a user color that fails contrast on the active
  skin is a real problem. Clamp: enforce a minimum luminance/contrast against the
  surface, OR show a subtle "low contrast" hint in the picker. Never silently
  render an unreadable name. (Compute relative luminance from the hex; nudge or
  warn.) Keep it advisory in v1 — warn, don't block — consistent with the rest of
  the extension's "advise not enforce" stance.

## Verify
typecheck → test → build → reload. Manual: set a solid color on a character →
shows in cast/relations/journal/graph; set a gradient → shows in HTML surfaces,
solid in graph; clear it → back to default; a low-contrast pick warns.

## Sequencing & risk
1. Phase 1 (data) + Phase 2 (helper) — the foundation; both testable, zero visual
   change until sites are swapped.
2. Phase 3 — the churn (many sites), but mechanical and low-risk (helper falls
   back to today's output).
3. Phase 4 (picker) makes it usable; Phase 5 (graph) + Phase 6 (contrast) are
   polish/safety.

## Out of scope (YAGNI)
- SVG text gradient in the graph (solid only; ponytail upgrade).
- Per-relation or per-faction name coloring beyond what the character's own color
  gives (factions get the same treatment via their name field if wanted, later).
- Preset palettes / theming integration — store the user's literal hex.
