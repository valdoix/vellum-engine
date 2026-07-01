# VELLUM II — UI Catch-Up Plan ("the features outran the UI")

A fresh survey after the big feature wave (portraits, story stats, calendar,
Turn Inspector, foreshadow, off-screen threads, context budget, arcs sparkline)
found two outright bugs, real crowding, and scattered ownership. This plan lands
the fixes you chose. No engine/schema changes except where noted; per-panel error
boundaries + escaping stay; gate each phase on
`bun run typecheck && bun run test && bun run build`; one commit per phase.

Ordered bug-fixes → crowding → the bigger off-screen re-home.

Explicitly NOT in scope (confirmed preset-only, no UI wanted): OOC channel,
narrative distance, pacing, prose register, genre, group scene.

---

## Phase 1 — Reachability & portrait bugs (small, high-value)

### 1.1 Turn Inspector reachable (req "turns")
`turns` is a fully-built Chronicle sub-view (per-turn digests + undo) but it's in
**neither** sub-nav group (`chronicle.ts:72-73` render Story + Records only), so
there's no button. Add `turns` to the **Story** group:
`inGroup(['timeline','world','beats','turns'])`. Label already "Turns"
(`chronicle.ts:19`); count already wired (`counts.turns=_turnMax`). One line.
**Guard:** grep every tab's VIEWS/SECTIONS vs its nav render to catch any other
orphan (this is the 2nd orphan after Items — worth a standing check).

### 1.2 Portraits everywhere (req "portraits, wire it everywhere")
`CastCard.imageUrl` renders **only** on Cast cards (`cast.ts:242`). Wire it into
every medallion that currently shows initials-only:
- **Dashboard present-card** (`dashboard.ts:167` `.vld-pc-av`): if the char has
  `imageUrl`, render it as a `background-image` (same technique as `cast.ts:242`)
  with initials as fallback. This is the highest-value surface — faces on "Now".
- **Cast strip view** (`cast.ts:266`): strip avatar is initials-only; add the
  image.
- **Journal shelf spines** (`journal.ts:61` `.vle-jspine-av`): use the journal
  owner's `imageUrl` when present.
- **Present-card in the float** inherits the dashboard fix automatically.
- Add a shared tiny helper `avatarStyle(imageUrl)` (or a class + inline bg) so all
  four sites use ONE portrait convention (round, cover, `has-img` class, initials
  fallback). CSS: ensure `has-img` hides the initials text at every site.
**Data:** read-only use of existing `imageUrl`; no schema change.

**Exit:** Turn Inspector has a button; a character's portrait shows on Now, Cast
(card+strip), Journal, and the float. Commit.

---

## Phase 2 — Story Stats on by default + discoverable (req 4)

`stats`/`statsBlock` exists (`dashboard.ts:230`) but is **not in the default
layout order** (`layout-defs.ts:29`) — invisible unless a user builds a custom
layout.
- Add `'stats'` to the default order (`layout-defs.ts`) — put it **last**
  (after `recent`) so it reads as a "story so far" footer, not competing with the
  live scene up top.
- Add it to the relevant preset layouts' orders too (codex/phone/hud/etc.) so it
  shows across chromes; verify it's in `ALL` (it is, `layout-defs.ts:24`).
- De-dupe with the header line: the always-on header (T/D/cast/bonds,
  `app.ts:229`) overlaps the stats chips. Keep the header as the glance; make the
  `stats` section the richer "most-connected / biggest-swings" view so they're
  complementary, not identical. (Trim the section's leading turns/days/cast/bonds
  chips if they duplicate the header, OR keep them — decide by eye; low stakes.)
- Sections are user-toggleable in Customize → sections, so opting out stays easy.

**Exit:** "Story so far" shows by default at the bottom of Now (+ float). Commit.

---

## Phase 3 — Calendar on the dashboard + float (req: add calendar to Now)

Today the calendar/epoch is set via an Actions modal (`openCalendarModal`,
`app.ts:150`) and stored in `_calendar`, but never **displayed** on the scene.
- Surface the epoch in the **status/hero block** (`statusBar`, `dashboard.ts:99`):
  when a calendar string is set, show it in the meta line, e.g.
  `Day 12 · dusk · rain · ✦ Feast of Ash` — so "Day 47" reads as an occasion.
- `_calendar` currently lives in `app.ts` module state; the dashboard needs it.
  Cleanest: pass it via the existing sysinfo/broadcast path the dashboard already
  reads, OR expose a small `getCalendar()` getter the dashboard imports (mirror
  how `getTheme()`/`getSysInfo()` are read). Pick the pattern already used for
  dashboard-visible app state to avoid a new channel.
- Float inherits it (shares `statusBar`). Style the epoch token per-chrome (a
  small gilt/rubric tag under illuminated; quiet mono under futuristic).

**Exit:** the named epoch appears on Now + the float whenever set. Commit.

---

## Phase 4 — Split the Actions menu: Verbs vs Settings (req 5)

The Actions menu is a 22-item junk drawer mixing persistent **settings** with
one-shot **verbs** (`QOL`, `app.ts:88-110`). Separate them.
- **Move settings out of Actions into a Settings home.** Candidates that are
  *configuration*, not verbs: Boundaries, Calendar, Context budget, Summarizer,
  Tone, Off-screen toggle, Traverse, Hide filed. Two options for their new home:
  - **(A, recommended)** a new **Customize → "Story" tab** (Customize is already
    the two-tier settings surface; add a tab holding these dials). Keeps all
    configuration in one place.
  - (B) a dedicated Settings modal. More new surface; only if Customize feels wrong.
- **Actions keeps only verbs:** Summarize, Rescan, Rebuild, Tidy threads, Tidy
  lore, Re-summarize, Export, Export MD, Import, Recover, Clear. (Undo leaves
  Actions entirely — see Phase 6.)
- Regroup the reduced Actions menu: `run` (summarize/rescan/rebuild/tidy×2/
  resummarize) · `data` (export/exportmd/import/recover) · `danger` (clear).
- **Icon consistency (req: every icon match):** the QOL items still use raw
  Unicode glyphs in their labels (`\u26D4`, `\u2637`, …) while the tabs/toolbar
  use the `icon()` SVG set. Convert QOL + the moved settings to `icon()` names
  (add any missing icons to `icons.ts`: boundaries, calendar, budget, tone,
  offscreen, traverse, hide, summarize, rescan, rebuild, tidy, export, import,
  recover, clear, undo). Assert coverage in the icon test.

**Exit:** Actions = verbs only, all `icon()`-based; settings live in Customize →
Story. Commit (may split the move vs the icon-ification).

---

## Phase 5 — Fix the Context Budget modal (req 6)

12 fields (preset + 11 numeric caps) in one `{large:true}` wall (`app.ts:113-148`).
Apply the same two-tier lesson as Customize:
- **Front:** the master preset select (small/medium/large/custom) + the single
  master dial. That's all most users touch.
- **Advanced (collapsed `<details>`):** the 11 per-injector caps + off-screen
  interval + convergence + summary cadence, revealed only when preset = custom or
  the user expands.
- Group the caps with sub-labels (Retrieval / Off-screen / Summaries) instead of a
  flat 11-row list.
- No behavior change — same fields, same messages; purely progressive disclosure.

**Exit:** Budget opens as preset + one dial; the spreadsheet is one fold away.
Commit.

---

## Phase 6 — Undo: Turn Inspector only (req 8)

Undo has two doors (Actions `app.ts:95` + Turn Inspector `chronicle.ts:362`).
- **Remove `undo` from the `QOL` Actions array.** Keep it solely as the per-turn
  Undo in the now-reachable Turn Inspector (Phase 1.1), where it has context
  (which turn, what changed).
- Verify no other caller depends on the Actions `undo` id (`onQol` branch); remove
  its handler branch if now dead.
- The Turn Inspector's undo already confirms + dispatches `vellum_undo`
  (`chronicle.ts:94-95`) — no new backend.

**Exit:** one undo, in context. Commit.

---

## Phase 7 — Off-screen threads: a real home + full history (req 7)

Two asks: a **better home**, and **show every off-screen thread ever** with
**advance / edit / delete per thread**.

### 7.1 Re-home into the Director tab
Off-screen threads are parallel *plotting* — they belong with next-scene steering,
not buried in Chronicle → World. Add a Director sub-view **"Off-screen"**
(`DView` + VIEWS in `director.ts:20,29`), and **remove** `offscreenSection` from
Chronicle → World (`chronicle.ts:76,267`). Director becomes the single home;
the dashboard `parallel` feed stays (it's a read-only glance, not a control).
Move the off-screen click handlers from `chronicle.ts` into `director.ts`.

### 7.2 Show ALL threads, not just active
The board filters `status === 'active'` (`chronicle.ts:268`), hiding resolved
ones. In the new Director view, list **every** thread grouped:
- **Active** (current) and **Resolved** (dimmed, below).
Each row (both groups) gets three per-thread controls:
- **Advance** — append a beat. Note: `vellum_offthread_advance` is **global** (one
  AI sim tick for all). For true *per-thread* advance, wire the button to an
  **edit-a-beat** form (manual gist/beat via `vellum_offthread_set` with `id`,
  which the backend already supports — `backend.ts:1150-1151`). Label it
  "advance" (add a beat / update gist). Keep a board-level "✷ simulate all" for
  the AI tick. `ponytail:` a real per-thread AI advance needs a new backend arg;
  ship manual-advance now, flag the AI-per-thread as follow-up.
- **Edit** — name/who/where/gist via `formModal` → `vellum_offthread_set` +id
  (backend ready; just no UI form today).
- **Delete** — `vellum_offthread_drop` (exists).
- Resolved threads also get **Reopen** (re-`set` to active) instead of Resolve.
- Keep the ripe/idle markers + beats `<details>`.

### 7.3 Director sub-nav + counts
Add the view to Director's nav (`director.ts:51`), badge = active count. Update
the `version()` key to include offscreen ids/lastTurn so it re-renders.

**Exit:** off-screen lives in Director, shows all threads (active+resolved), each
with advance/edit/delete (+ reopen); Chronicle → World no longer carries it.
Commit (this is the biggest phase; may split 7.1 re-home from 7.2 controls).

---

## Sequencing & rationale
1. **Phase 1** — bugs (turns reachable, portraits). Cheapest, restores a feature.
2. **Phase 2** — stats on by default. One-line-ish.
3. **Phase 3** — calendar on Now/float.
4. **Phase 4** — Actions split + icon-ification (also fixes "every icon match").
5. **Phase 5** — Budget two-tier.
6. **Phase 6** — undo consolidation (depends on Phase 1 making Turn Inspector
   reachable — do AFTER 1).
7. **Phase 7** — off-screen re-home (largest; last).

### Files
- `tabs/chronicle.ts` — turns in nav (1.1), remove offscreen (7.1).
- `dashboard.ts` — portrait in present-card (1.2), calendar in status (3), stats
  order via layout-defs.
- `layout-defs.ts` — default order gains `stats` (2).
- `tabs/cast.ts` / `tabs/journal.ts` — portrait wiring (1.2).
- `app.ts` — Actions split + icon()-ify (4), remove undo (6), calendar getter (3).
- `theme.ts` — Customize → Story settings tab (4A).
- `tabs/director.ts` — off-screen sub-view + per-thread controls (7).
- `icons.ts` — add missing action/settings icons (4); + icons test.
- No schema changes; `vellum_offthread_set` edit path already exists.

### Guardrails
Escaping; error boundaries (every moved/added render degrades to a list); the
orphan-view grep (1.1) as a standing check; per-chrome × narrow-float verify for
portraits + calendar token + the moved settings; icon-completeness assert.

### Honest risks / caveats
- **Per-thread AI advance isn't supported** — `vellum_offthread_advance` is global.
  Phase 7 ships *manual* per-thread advance (add-beat, backend-ready) + a
  board-level "simulate all". True per-thread AI advance is flagged as a backend
  follow-up, not silently faked.
- **Calendar plumbing** (`_calendar` is app.ts module state) needs a getter/
  broadcast the dashboard can read; pick the existing app-state-to-dashboard
  pattern to avoid a new channel.
- All visual changes are **code/build-verified only** here (no live render); the
  portrait medallions, calendar token, and moved-settings layout will want an
  in-app pass, especially the light Parchment skin and the narrow float.

### The three highest-value if only three ship
1. **Phase 1** — Turn Inspector reachable + portraits on Now.
2. **Phase 4** — Actions split + consistent icons.
3. **Phase 7** — off-screen threads' real home with full history.
