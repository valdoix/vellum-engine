# VELLUM II — Tab Shell & Navigation Plan ("tame the three rows")

A fresh-eyes pass on the dashboard tabs (after the Director tab + personality
drift + "tool icons to their own row" landed) found the shell grew a **third
navigation row** and the primary/tool split stopped tracking importance. This
plan fixes navigation coherence and cleans up the debt the new features left.
It does NOT touch any feature logic, backend, or data.

Principles (unchanged): no schema/backend changes; per-panel error boundaries
stay; HTML escaping stays; `data-vle-motion='off'` honored; gate each phase on
`bun run typecheck && bun run test && bun run build`; one commit per phase; every
visual change verified across the 4 chromes (default/fantasy/modern/futuristic)
and on the narrow floating window.

Ordered cheap-and-safe first.

---

## The problem, precisely

Current shell stacks three control rows before any content (`app.ts:134-147`):
1. `.vle-tabbar` — 4 primary **text pills**: Now / Cast / Bonds / Chronicle
2. `.vle-tabicons` — 5 bare **icon buttons**: Journal / Graph / Director / Vault / Context
3. `.vle-toolbar` — Search / Customize / Actions

Then the active tab may add its own sub-nav (Chronicle: 9 views in 2 groups;
Director: 4 views). Consequences:
- **Vertical chrome weight** — three rows + sub-nav above the scene, worst on the
  float and small drawers.
- **Primary/tool split no longer tracks importance** — it tracks *age*. Director
  (a full 4-view feature) and Journal (the book/diary) are heavy features stuck
  as tiny **unlabeled** icons, while lighter surfaces keep labeled pills.
- **Icon-only tools rely on glyph legibility** — Director-as-star (★) and
  Context-as-⧉ aren't self-evident, and there are no text fallbacks.

---

## Phase 0 — Dead code & stale comments (trivial, zero risk)

0.1 **Delete the dead legacy Director modal.** `openDirector()` (`app.ts:325`) and
its `row()` helper are **never called** — the toolbar Director button was removed
when the Director tab landed (commit 78228ad). Remove `openDirector` and any
now-unused helpers it alone used (`DIR_KIND_LABEL` if unreferenced elsewhere —
verify with grep first). ~70 lines of unreachable code that still dispatches
`vellum_set_directives` and will rot.

0.2 **Fix the stale tool-set comments.** `app.ts:131-132` still names tools as
"Journal/Graph/Vault/Context" (omits Director); `app.ts:590` / `app.ts:603`
assert "4 primary tabs" for the float — that one is still true, leave it, but the
tool comment is wrong. Update to reflect the 5 tools incl. Director.

0.3 **Grep guard.** Confirm nothing else references the removed symbols; run the
gate. One commit.

---

## Phase 1 — A labeled tool dock (the highest-impact fix)

Turn `.vle-tabicons` from bare icons into **icon + label chips** so the tool row
reads as a legitimate second tier, not second-class afterthoughts. This fixes the
legibility problem without breaking the clean 4 primary pills.

1.1 **Add labels under/after each tool icon.** Mirror the primary `tabBtn`
structure: `icon + <span class="vle-tabicon-l">label</span>`, styled compact.
Keep `title`/`aria-label` for redundancy. (`toolBtn`, `app.ts:133`.)

1.2 **Re-sort tools by importance, not age:** Director / Journal / Graph / Vault /
Context. (Reorder the `tools` group entries in `TABS`, `app.ts:78-82`.)

1.3 **Responsive collapse.** On the narrow float / small width, the labels hide
(icon-only) via a container/media query so the dock never wraps to two lines —
labels are the enhancement, icons the floor. Reuse the existing `.vlf-tab-l`
hide pattern from the float tabs.

1.4 **Keep it one row.** `.vle-tabicons` already `flex-wrap:wrap` (`styles.ts:42`);
with labels, cap it to a single scrollable row on narrow instead of wrapping, so
the "three stacked rows" problem doesn't get worse.

**Exit:** the tool row is legible and ordered by importance; still icon-only when
cramped. Commit.

---

## Phase 2 — Reconcile the primary/tool tiering (decision-gated)

With Director and Journal being full features, "4 primary + 5 tools" is
arbitrary. Two coherent options — pick ONE (needs a call):

- **Option A — keep 4 primary, dock stays labeled (Phase 1 only).** Lowest risk;
  the labeled dock already fixes the worst of it. Director/Journal remain in the
  dock but now read clearly. *Recommended default.*
- **Option B — promote Director to a 5th primary pill.** It's arguably more
  central to play than Bonds. Breaks the clean 4, adds a pill, and the float
  (`FLOAT_TABS`, `app.ts:591`) would gain it too. More honest to importance, more
  chrome.

If B: update `TABS` group, the float comment, and verify the primary bar still
fits 5 labeled pills at min drawer width (likely wraps — may need a scroll strip).

This phase is a **design decision, not a mechanical change** — hold until chosen.

---

## Phase 3 — "Steer the next turn" is scattered (map, then consolidate)

Influencing the upcoming turn is now spread across: Director tab (Next Scene +
Directives + Locations), the Tone modal, the Genre dial, and the Actions menu.
No single mental model of "where do I go to shape what happens next."

3.1 **Audit & document** every entry point that biases the next generation
(Next Scene, Directives, Tone, Genre, Locations, off-screen sim). One short doc /
comment block — no behavior change.

3.2 **Cross-link, don't merge.** Lowest-risk consolidation: from the Director tab
add quiet links to Tone/Genre (they're modals) so the Director tab reads as the
hub for "next turn," even though the modals stay where they are. Avoid a big
re-home; just make the Director tab the obvious starting point.

3.3 (Optional, larger) Consider moving the Tone + Genre dials into a Director
sub-view ("Tone") so the whole "next-turn steering" set lives in one tab. Defer
unless 3.1 shows the scatter is genuinely confusing in use.

**Exit:** a documented map + soft cross-links; Director tab is the hub. Commit.

---

## Phase 4 — Vertical density relief (polish)

Three rows + sub-nav is heavy above the fold, especially on the float.

4.1 **Merge the toolbar into a tighter strip** — Search/Customize/Actions are
already icons+labels; consider collapsing to icons on narrow (like the tools),
or moving Search into the tab area as a leading affordance.

4.2 **Float chrome budget.** The float already shows only 4 primary tabs; ensure
the tool dock + toolbar don't also render there redundantly (verify
`createFloatWindow` scope, `app.ts:590`). The float should stay lean.

4.3 **Sub-nav visual weight.** Chronicle (9) and Director (4) sub-navs are the
2nd tier inside a tab; make sure their styling reads as *subordinate* to the tab
bar (smaller, quieter) so the hierarchy is legible when both are on screen.

**Exit:** less chrome above the scene; the float stays minimal. Commit.

---

## Sequencing & rationale

1. **Phase 0** — delete dead `openDirector` + fix comments. Trivial, do now.
2. **Phase 1** — labeled tool dock. The single highest-impact, self-contained win.
3. **Phase 2** — tiering decision (A recommended = nothing more to build).
4. **Phase 3** — map + cross-link next-turn steering.
5. **Phase 4** — density polish.

### Files touched
- `app.ts` — delete `openDirector` (0.1), comments (0.2), `toolBtn` labels +
  tool order (1.x), optional primary promotion (2B), toolbar strip (4.1).
- `styles.ts` — `.vle-tabicon` label styling + responsive hide (1.x), sub-nav
  weight (4.3).
- `tabs/director.ts` — cross-links to Tone/Genre (3.2), optional Tone sub-view (3.3).
- No new files; no schema/backend changes.

### Guardrails
Escaping; error boundaries; reduced-motion; per-chrome × narrow-float check for
the labeled dock (the main visual risk); confirm the removed `openDirector` has
no remaining callers before deleting.

### Explicitly out of scope
Director/drift/feature logic; backend or event shapes; the Chronicle Spine
rewrite (its own plan); adding deps.

### The two unambiguous wins if only two ship
1. **Phase 0** — delete dead `openDirector`, fix stale comments.
2. **Phase 1** — labeled, importance-sorted tool dock.
