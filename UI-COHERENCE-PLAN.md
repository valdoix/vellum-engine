# VELLUM II — UI Coherence & Polish Plan ("tame the surface")

A fresh-eyes pass found the architecture is strong (orthogonal skin/chrome/layout
axes, shared section registry, error boundaries, 448 tests) but the **feature
surface has outgrown its navigation and visual language**. This plan fixes
coherence, discoverability, and restraint — not the engine.

Principles (unchanged): no schema/backend changes; per-panel error boundaries
stay; HTML escaping stays; `data-vle-motion='off'` + reduced-motion honored;
gate each phase on `bun run typecheck && bun run test && bun run build`; one
commit per phase; every visual change verified across the 4 chromes + key skins.

Phases are ordered **cheap-high-impact first**, rewrites last.

---

## Phase M — Modern "Now" remade as a card-app scroll ✅ DONE

The Modern theme looked disjointed: it defaulted to the **phone `switch` layout**
(one section at a time behind a dock) AND styled every `.vld-sec` as a heavy
bordered box — so content was both *chopped* between sections and *walled* into
competing cards. Remade to match `design-review/mode-2-modern-app.svg`:

- **Default form `phone` → `dashboard`** (`theme.ts` MODES): one continuous
  vertical scroll instead of one-section-at-a-time switching.
- **Sections become transparent groups** under Modern: `.vld-sec` loses its
  border/background/padding; the `.vld-h` label floats *above* the group as a
  serif heading. Only the meaningful **items** are cards.
- **Hero = a real scene card** with an eyebrow ("Current scene") and an inline
  amber **tension pill** top-right (tension folds into the hero, so the standalone
  Tension section is skipped under Modern — no near-empty card).
- Present-cast = rounded notification cards; relations = spotlight cards; threads/
  parallel = soft pill rows; **"Latest" = a true activity feed** (connector line +
  colored nodes).
- Applies to BOTH surfaces (drawer Now tab + floating window share `.vld`).

Gate green (448 tests, typecheck, build). Files: `dashboard.ts` (hero eyebrow/pill
+ modern tension skip), `theme.ts` (form), `styles.ts` (modern theme block).

---

## Phase 0 — Quick wins & latent-bug fixes (low risk, do first)

Small, independent, mostly self-evident. One commit.

0.1 **Fix the orphaned Items sub-view.** `chronicle.ts` lists `items` in `VIEWS`
but the sub-nav `inGroup` calls only render World/Timeline/Beats +
Memory/Knowledge/Secrets/Scars/Codex — **Items is unreachable except as the
fallthrough `else`**. Add `items` to a group (see 3.x; interim: append to "Known
& kept"). Verify the count badge shows.

0.2 **Two "disposition" names collide.** Character temperament (`cast.ts`
"Disposition") and the world dial (`app.ts` Tone "World Disposition") share the
word. Rename the world one to **"World bias"** (or "Lean") in the Tone modal label
only — no data/key change, display string swap.

0.3 **Theme the stats header.** `T·D·cast·bonds·weather` is raw mono on every
chrome, clashing with Fantasy's manuscript voice. Add per-chrome `.vle-stats`
skins (serif small-caps under illuminated; mono telemetry under futuristic; clean
under modern/default). CSS-only.

0.4 **Duplicate-glyph audit (interim).** Until the icon system (Phase 2), fix the
two outright collisions: Traverse and Off-screen both use `✴`; Rebuild and
Re-summarize both use `⟳`. Give each a distinct glyph so the Actions menu reads
unambiguously. One-line edits in `QOL` (`app.ts`).

0.5 **Empty-state teaching pattern.** The Items empty state teaches ("enable the
Inventory block"). Extend the same one-sentence "what fills this / how" hint to
the bare "Nothing yet" states (knowledge, secrets, scars, codex, journal). Pure
copy.

**Exit:** no dead views, no name/glyph collisions, themed header. Commit.

---

## Phase 1 — Two-tier Customize ("just make it nice" up front)

The panel is a 7-tab cockpit (skin/mode/layout/color/type/window/sections) where
the one approachable control (the 4 theme cards) is buried as tab 2. Restructure
so 90% of users never see the cockpit.

1.1 **New default tab: "Look".** A first `CzTab = 'look'` that shows:
- the 4 **theme cards** (reuse the `mode` gallery markup verbatim),
- **interface size** slider (reuse `scale`),
- a **light/dark hint** if feasible (skins already imply it; otherwise omit),
- one line: "Want more control? → Advanced".

1.2 **Collapse the rest under "Advanced".** Keep all existing tabs
(skin/layout/color/type/window/sections) but group them behind an Advanced
disclosure/section in the tab strip (a visual divider + dimmer styling), default
collapsed. No tab is removed — power users lose nothing; newcomers see two things.

1.3 **Wire & test.** Extend `CzTab` type, `customizePanel(tab)`, the tab strip
render, and the click routing. Add a tiny assert that `customizePanel('look')`
returns the theme cards + size slider. Keep `mode` reachable (Advanced) for
back-compat.

**Exit:** opening Customize shows Look (themes + size); everything else is one
click away. Commit. *This is the single biggest approachability win.*

---

## Phase 2 — A real icon language (kills "glyph soup")

Tab icons (◉☻⚚☷✎⚹❖⧉), section glyphs, and ~17 Action glyphs are arbitrary
Unicode with no family, several unrecognizable (⚚=Bonds, ☷=Chronicle, ⧉=Context)
and (after 0.4) no longer colliding but still inconsistent.

2.1 **Adopt one inline-SVG icon set** (no new runtime dep; bundle ~20 tiny
24×24 path icons as a `src/ui/icons.ts` map `icon(name)→<svg>`). Cover: the 8
tabs, the toolbar (search/director/customize/actions), and the Action verbs
(summarize/rescan/undo/rebuild/tidy/export/import/recover/clear/toggles).
- Monochrome, `currentColor`, so they theme for free.
- Keep them boundary-safe strings (no framework).

2.2 **Replace tab-icon glyphs** (`app.ts` `toolBtn`) and **toolbar glyphs** with
`icon()`. Tool tabs stop feeling like "a lesser app" than the text-pill primaries.

2.3 **Replace Action-menu glyphs** with `icon()`; keep the text labels.

2.4 **Section/sub-nav glyphs**: replace the dashboard `SECTION_GLYPH` and
Chronicle sub-view markers with the set where one exists; leave semantic marks
(spine ⚑, irony ✗, scar strike-through) as-is — those are *content* signals, not
nav chrome.

2.5 Accessibility: every icon button keeps its `title`/`aria-label`. Assert the
icon map has an entry for every tab id + action id (fail loudly if one's missing).

**Exit:** one coherent icon family across nav + actions; tool tabs feel first-class.
Commit. (Medium effort, high polish payoff.)

---

## Phase 3 — Chronicle: resolve the Spine-vs-lists duplication (the meaty one)

Today Chronicle has BOTH the **Timeline "Spine"** (which already aggregates
memory/knowledge/secrets/scars/journal/beats onto one rail) AND four separate
list views (Memory/Knowledge/Secrets/Scars) plus Beats/Codex/Items/World. That's
the river and the filing cabinet side by side — the biggest coherence cost.

Decision baked in (matches the original Spine promise 10D): **the Spine becomes
the primary "story" surface with inline type filters + inline edit; the
standalone list views become filtered modes of it, not separate destinations.**

3.1 **Collapse the sub-nav from 9 to ~5.** New top-level views:
- **World** (scene/arcs/threads/offscreen) — unchanged, it's structural not record-stream.
- **Story** (the Spine) — the unified river, with a **type-filter chip row**
  (all / beats / memory / knowledge / secrets / scars / journal / codex) replacing
  the old kind filter, plus the day filter. This subsumes Timeline + the 4 lists.
- **Beats** — kept as its own view: it's *authoring* (reorder, spine-toggle,
  suggest), a different interaction than reading the river.
- **Codex** — kept (canon authoring, ownerless, distinct).
- **Items** — kept (possession tracker, distinct shape) AND fixed (0.1).

3.2 **Inline edit/CRUD on Spine cards.** The reason the lists existed was
edit/delete/reveal. Add per-card controls to the Spine card (edit/delete, and
secret-reveal for secret rows) so removing the standalone lists loses no
capability. Each card already knows its kind + id.

3.3 **Retire Memory/Knowledge/Secrets/Scars as separate sub-nav buttons** once
the Spine's filter+edit reaches parity. Keep the render fns available behind the
filter (Story filtered to one type renders that type's richer affordances — e.g.
Memory's fold-pick mode appears only when the Story filter = memory). This keeps
the powerful manual-fold/pick workflow without a separate tab.

3.4 **Width honesty (also serves 5.x).** The L/R branching river is for wide
drawer only; below the container breakpoint it's already a single column — keep
that, and when filtered to one type at narrow width, render the clean list
(reuse the existing list renderers) instead of a one-sided rail. One component,
two widths.

3.5 Preserve everything shipped: beat reorder, irony `✗ false`, scar
strikethrough, secret "keeps from", per-type spines, manual fold. Build the new
filtered Spine **behind the existing view switch first**, parity-check, then flip
the sub-nav. Reversible.

**Exit:** Chronicle is 5 coherent views; the Spine is the one place the story
lives; no capability lost. Commit (may split 3.1–3.2 / 3.3–3.4).

---

## Phase 4 — Float gets the 4 primary tabs (fix its reason to exist)

The float renders **only "Now"** — beautiful frame, drag/resize, persisted
geometry, and one screen. A float-preferring user can't reach Cast/Bonds/Chronicle.

4.1 **Add a compact tab row to the float** (`float.ts`): the 4 primary tabs
(Now/Cast/Bonds/Chronicle) as the icon row (using Phase 2 icons), under the title
bar. The section registry + tab components are already shared; the float just
needs to mount the active tab's component into its body instead of always
`dashboardHtml`.

4.2 **Reuse the shell's mount machinery.** Factor the drawer's
`mount(comp)`/active-tab logic so the float can host any tab component (it already
imports `dashboardHtml`; generalize to "render active tab"). Keep the float's
error fallback per tab.

4.3 **Respect width.** The float is narrow; tabs must render their narrow
presentation (container queries already exist for present cards, the Spine, the
diary). Verify each of the 4 tabs is usable at min float width (280px).

4.4 **Persist the float's active tab** in `vellum2.float.geo` (or a sibling key)
so it reopens where you left it.

**Exit:** the float is a real mini-app, not a single panel. Commit. *Cheapest
high-impact unlock per the critique.*

---

## Phase 5 — Theme distinctiveness & the color contract (coherence guardrails)

Two recurring risks: themes blur together (default≈fantasy), and semantic colors
have crept (violet = scars AND thoughts AND complex-sentiment AND romance).

5.1 **One unmistakable structural signature per chrome, skin-independent.**
Document and enforce that each chrome *always* asserts one structural tell
regardless of skin:
- Fantasy: drop-cap + rubric headers + page-edge — always on.
- Modern: bottom dock + pill tabs + soft shadow — always on.
- Futuristic: scanlines + reticle avatars + telemetry footer — always on.
- Default: deliberately flat/quiet (the "no costume" baseline).
Audit where these currently depend on skin palette and make them structural.

5.2 **Write the semantic color contract** (a comment block + a short doc): sage
= positive/affection/journal; blue = knowledge/trust/info; amber = pressure/
tension/bond-shift; red = harm/danger/destructive; violet = **the internal/
ambiguous register** (thoughts, scars, complex sentiment, romance) — *if* we
accept that grouping, make it deliberate and consistent; otherwise split romance
off. Audit every surface; fix the incidental violets.

5.3 **Unify "importance/status" encodings.** `userEdited ★`, beat spine `⚑`,
faction standing bars, present-dot — several different encodings for "this is
notable/curated." Pick a consistent treatment (e.g. a gold accent = user-curated
everywhere). Small, cohering.

**Exit:** any skin×chrome combo is recognizably its theme; color means one thing.
Commit.

---

## Phase 6 — Search & smaller wins (optional, low risk)

6.1 **Scoped search.** Flat free-text search → add type filter chips (cast /
bonds / journal / knowledge / secrets) so results are narrowable. Reuse the
existing index; add a filter row to the search overlay.

6.2 **Vault recency (the one real `ponytail`).** `vault.ts:150` sorts
newest/oldest by insertion order because `VEntry` has no timestamp. This is a
latent bug for users who reorder. Add a `created`/`updated` turn to `VEntry`
(this DOES touch a type — scope it as its own small, tested change, or defer).

6.3 **Density audit on the designed surfaces.** Re-check the Journal diary and
Spine at drawer + float widths after Phase 3/4; ensure skeuomorphism (page fold,
rail) degrades to clean lists when cramped rather than squeezing.

**Exit:** search is precise, vault sort is true, no cramped surfaces. Commit(s).

---

## Sequencing & rationale

1. **Phase 0** — quick wins, fixes a real dead-view bug; unblocks nothing but cheap.
2. **Phase 1** — two-tier Customize; biggest approachability win, self-contained.
3. **Phase 2** — icon system; unifies nav, prerequisite for Phase 4's float tabs.
4. **Phase 4** — float tabs (needs Phase 2 icons); high impact, contained.
5. **Phase 3** — Chronicle de-duplication; the rewrite, most risk, do when the
   cheaper wins are banked and reversibility is set up.
6. **Phase 5** — theme/color guardrails; ongoing-discipline, lands well after the
   structural churn settles.
7. **Phase 6** — optional polish; Vault recency may spin out as its own typed change.

### Files (no schema except optional 6.2)
- `app.ts` — Actions glyphs (0.4), stats header hook (0.3), Customize routing
  (1.x), tab/toolbar icons (2.x).
- `theme.ts` — `CzTab` + `customizePanel` two-tier (1.x), color-contract comment
  (5.2).
- `styles.ts` — themed stats header (0.3), Advanced styling (1.2), per-chrome
  structural signatures (5.1), spine inline-edit + narrow list fallback (3.x).
- `tabs/chronicle.ts` — orphaned Items (0.1), Spine filter+edit, sub-nav collapse
  (3.x).
- `float.ts` + a small shared `mountTab` factor-out — float tabs (4.x).
- NEW `src/ui/icons.ts` — the inline-SVG icon map (2.1).
- `tabs/vault.ts` + `domain/types.ts` — optional VEntry timestamp (6.2).

### Guardrails
Escaping; error boundaries (every new render path degrades to a list/empty);
reduced-motion; focus ring; per-chrome × per-skin contrast spot-check (esp.
Parchment/Aged Vellum light-on-dark inversions, Noir). Each non-trivial phase
leaves one runnable assert (icon-map completeness; `customizePanel('look')`;
Spine returns '' for empty; Items reachable).

### Explicitly out of scope
Engine/event-log/message shapes; the Graph interaction model (excellent as-is);
adding heavyweight deps (icons are hand-authored SVG); changing the skin/chrome/
layout axis model (it's the strength — we're taming its surface, not replacing it).

### The three highest-value changes (if only three ship)
1. **Phase 1** two-tier Customize — approachability.
2. **Phase 4** float tabs — fixes the float's purpose.
3. **Phase 3** Chronicle Spine-vs-lists — the core coherence cost.
