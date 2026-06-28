# VELLUM II — Shell & tab-system redesign (implementation plan)

The leaf level (cards, chips, tokens, dashboard sections) is well designed. The
**shell** — tab bar + 12-button toolbar — is the weak layer and the first thing
every user sees: ~5 rows of chrome, 19 gold pills, destructive actions inline,
two unrelated surfaces (tabbed drawer vs dashboard float). This plan pushes the
existing design discipline *upward* into navigation, and fixes the consistency
drift the leaf work left behind.

Files: `app.ts`, `styles.ts`, `dashboard.ts`, `journal.ts`, `chronicle.ts`,
tabs, `format.ts`. Reuse existing infra (filter/pagination, dashboard section
engine, theme tokens). No new deps. Gate every phase:
`bun run typecheck && bun run test && bun run build`.

Order = leverage × safety. Phases 1–3 are shell/navigation (high leverage, the
leaf components are untouched). Phases 4–6 are consistency fixes (low risk).
Phase 7 is the bigger "unify surfaces" idea (do last, after the shell is calm).

---

## Phase 1 — Collapse the QOL toolbar into a grouped Actions menu
The 12 always-on pills (`app.ts:49-62`) are the worst offender: a wall that mixes
one-shots, toggles, and destructive data ops at equal weight.

- Replace the `vle-toolbar` row with a single **Actions** button (gear/⋯) opening
  a menu (reuse the modal/overlay pattern, not a new lib), grouped:
  - **Maintenance** (one-shots): Summarize, Rescan, Rebuild, Tidy threads
  - **Toggles** (stateful): Hide filed, Traverse, Tone — rendered with an
    on/off affordance so they read as *states*, with current value shown
  - **Data**: Export, Import
  - **Danger**: Clear — visually separated (own group, red treatment), never on
    the happy path.
- Keep **Customize** inline as its own button (it's the most-used, non-dangerous).
- Busy/active state (`setQolBusy`, the `.on` toggles in the message handler) must
  keep working — the menu items reuse the same `data-qol` ids so existing wiring
  in `app.ts` is untouched; only the container changes.
- Result: reclaims an entire wrapping row of chrome; destructive Clear quarantined.

## Phase 2 — Tier the tab bar (narrative vs tools vs diagnostics)
Chronicle/Cast/Relations/Journal/Graph are narrative views; Vault is authoring;
Injection is diagnostics. They're equal siblings today (`app.ts:39-47`).

- Primary tab row: **Chronicle · Cast · Relations · Journal · Graph**.
- Secondary/overflow group (smaller, after a divider, or under a "More"): **Vault**,
  **Context** (renamed from Injection).
- Rename `injection` label → **"Context"** (keep the id/component; only the label
  changes, so backend messages are unaffected). Update the tab `description`/
  keywords copy in `registerDrawerTab` accordingly.
- TABS array gains a `group: 'primary' | 'tools'` field; `createShell` renders two
  runs with a divider. Default active tab stays first primary.

## Phase 3 — Ration the accent + quiet the shell (designer)
Gold currently marks 19 things (every tab, every QOL pill, stats, headers).

- Reserve gold for **active tab** and the **single primary action** only.
- Demote inactive tab pills + the Actions/Customize buttons to neutral ink
  (`--vi2`), gold on hover/active — same "reserve accent for state" move already
  applied to cards/borders.
- `vle-stats` line: drop to muted; it's ambient, not a control.
- Tighten chrome rhythm: the serif header + one tab row + (now) one action button
  should sit in a consistent vertical scale (reuse `--v*` spacing tokens).

## Phase 4 — Consistency: semantic-token drift
- **`journal.ts:25` `SENT_CLR`** hardcodes `#8fa67e/#c96a6a/#8c8478/#b48ed0` —
  route to `--v-pos/--v-neg/--vle-dim/--v-warn` so journal follows the skin like
  cast/relations now do. The inline `style="color:${clr}"` becomes a class
  (`vle-jr-sent--pos|neg|neu|complex`) so no hex reaches the DOM.
- Audit remaining hardcoded semantic hex in tabs/dashboard (e.g. dashboard
  `CAT_COLORS` is category identity = legitimately fixed; sentiment/standing are
  semantic = tokenize). Tokenize only the semantic ones; leave identity hues.

## Phase 5 — Consistency: empty states, glyphs, voice
- **Empty states:** one shared helper `emptyState(msg, hint?)` in `format.ts`
  returning the `vle-empty` markup; replace the bare `—` (`chronicle.ts:93,106`),
  the terse ones, and the `<br><span>` ones so voice + shape match. Pattern: one
  short sentence + optional muted hint line.
- **Glyph roles:** stop reusing ❖ (brand mark) for functional controls. Define a
  tiny role map (promote, edit ✎, delete ✕, add +, member, refresh ⟳) and apply
  consistently across cast/relations/journal/vault. Brand ❖ only in the header +
  launcher. (Cast promote already moved ❖→⤴; extend that pass.)
- Tab/section headers: pick one header component. Today `vle-sec-top`,
  `vle-sec-h`, `vle-sec-title` coexist with different spacing — normalize to one
  with an optional count + optional action slot.

## Phase 6 — Consistency: reading position on tab switch
`showTab` destroys + rebuilds (`app.ts:101-104`), losing scroll + open `<details>`.

- Preserve scroll per tab: stash `bodyEl.scrollTop` keyed by tab id before
  destroy, restore after mount (UI-only state map, same spirit as the
  filter/pager maps in bridge.ts).
- Low risk, pure quality-of-life; no component API change.

## Phase 7 — Unify the two surfaces ("Now" vs "Record")
The float = dashboard, the drawer = tabs; they share no language (`app.ts:246`).
The dashboard's composable-section engine (`dashboard.ts`) is the best design in
the codebase and should be reused, not walled off.

- Add the dashboard as a first **"Now"** view in the drawer tab row (a Component
  wrapper around `dashboardHtml`), so the same live-scene panel appears in both
  the float and the drawer. Drawer = Now + the archive tabs; float = Now alone.
- Optional follow-on (defer unless it proves out): let Chronicle reuse the
  section-compose pattern or gain light sub-nav (World · Memory · Knowledge) so
  it stops being a 6-deep heterogeneous scroll (`chronicle.ts:15`). Scope this as
  its own phase if Phase 7a lands well.

## Phase 8 (stretch, optional) — Search/command palette
No free-text find exists across the growing chronicle. A single input matching
cast/relations/journal/knowledge by name, jumping to the right tab + filter.
Sits on top of the existing filter infra. Defer until the shell is settled; only
build if play demands it (YAGNI gate).

---

## Verify (each phase)
typecheck → test → build → reload in Lumiverse. Manual smoke: toolbar collapses
to one action entry; Clear is not on the happy path; toggles show state; tab
tiers render; only active tab is gold; journal sentiment follows skin; empty
states match; scroll survives tab switch; dashboard appears in the drawer.

## Explicitly out of scope (YAGNI)
- No graph-tab interaction changes (it's excellent as-is).
- No new component framework; reuse Component + the overlay/modal patterns.
- No backend/message-shape changes — Injection→Context is a label-only rename.
- Search palette (Phase 8) only if needed.

## Risk notes
- Phases 1–3 touch `app.ts` shell markup + `styles.ts` only; leaf components and
  their `data-*` contracts are untouched (menu reuses existing `data-qol` ids).
- Phase 7a adds a tab; it's additive. The Chronicle re-architecture (7b) is the
  one place that could disrupt a working view — gated behind its own phase and
  optional.
