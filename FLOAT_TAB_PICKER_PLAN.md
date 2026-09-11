# Float Tab Picker — Choose Which Tabs Show in the Floating Window

Implementation plan for making the floating window's tab strip user-configurable:
let the user choose **which** tabs appear and **in what order**, and allow the
four `tools` tabs (Journal / Graph / Vault / Context) into the float alongside the
five `primary` tabs (Now / Cast / Bonds / Chronicle / Director).

This is a **UI + prefs** change only. No backend, reducer, domain, or
persisted-story-state changes. Persistence rides the existing prefs blob (which
already mirrors to the backend), exactly like `floatTab` does today.

---

## Goals

1. The float can show any subset of the nine `TABS`, in a user-defined order — not
   the hardcoded five-primary filter it uses now.
2. The four `tools` tabs become eligible for the float.
3. Selection + order persist across reload (localStorage + backend mirror).
4. Safe degradation: an empty/stale/invalid selection never breaks the float; the
   active tab always resolves to something valid.
5. A small editor UI, slotted into the existing Customize modal, reusing the
   established `data-cz-*` wiring pattern.

---

## Current state (what exists today)

- **One tab registry.** `TABS` (app.ts:134) is the single source of truth. Each
  entry is `{ id, label, icon, comp, group }`, `group` is `'primary' | 'tools'`.
  Five primary + four tools = nine total.
- **The float hardcodes primary-only.** `FLOAT_TABS = TABS.filter((t) => t.group === 'primary')`
  (app.ts:1271). The tab strip is built by `floatTabStrip()` (app.ts:1275) mapping
  over `FLOAT_TABS`; the body mounts `def.comp` by id (app.ts:1299-1305).
- **Active tab already persists** as a single string pref `floatTab`
  (app.ts:1272 / prefs.ts:26), read/written through `getPref`/`setPref`.
- **Active-tab fallback already exists**: `FLOAT_TABS.find((t) => t.id === floatTab) ?? FLOAT_TABS[0]!`
  (app.ts:1299) — hiding the current tab degrades to the first available.
- **Prefs are durable.** `prefs.ts` keeps one JSON blob cached in localStorage and
  mirrored to the backend; `hydratePrefs` merges the backend copy on the first
  state broadcast and the app re-reads `floatTab` then (app.ts:1370-1371).
- **Customize modal.** `openCustomize` (app.ts:273) mounts `customizePanel(tab)`
  (theme.ts:715) and wires it with `wireCustomize(host, onChange, rerender)`
  (theme.ts:842). The panel is a left rail (`ALL_TABS`, theme.ts:719) + a right
  canvas; each tab's body is a block of `data-cz-*` controls. The `window` tab
  (theme.ts:801-814) already hosts float-related settings (launcher edge, opacity,
  blur, etc.), so it is the natural home for a tab picker.

Key implication: the render path is already fully data-driven off an array. The
only thing hardcoded is *which* array. So the change is: **derive that array from a
new pref, validated against `TABS`, with a safe default.**

---

## Design

### New pref: `floatTabs: string[]`

- An ordered allow-list of tab ids. Absent/empty ⇒ fall back to the current
  behavior (the five primary tabs, in registry order).
- Lives in the same prefs blob; add one migration row so it hydrates from the
  backend like the others.
- `floatTab` (the *active* tab) stays a separate string pref, unchanged.

### Deriving the visible set

Replace the constant with a resolver that reads the pref, validates ids against the
live `TABS`, dedupes, preserves the user's order, and falls back safely.

```ts
// app.ts — near the float setup
const DEFAULT_FLOAT_TABS = TABS.filter((t) => t.group === 'primary').map((t) => t.id);

function resolveFloatTabs(): typeof TABS[number][] {
  const saved = getPref<string[]>('floatTabs', DEFAULT_FLOAT_TABS);
  const valid = Array.isArray(saved) ? saved : DEFAULT_FLOAT_TABS;
  // map ids -> tab defs, dropping unknown/duplicate ids, preserving order
  const seen = new Set<string>();
  const picked = valid
    .filter((id) => !seen.has(id) && (seen.add(id), true))
    .map((id) => TABS.find((t) => t.id === id))
    .filter((t): t is typeof TABS[number] => !!t);
  return picked.length ? picked : TABS.filter((t) => t.group === 'primary');
}
```

Then `FLOAT_TABS` becomes a `let` recomputed on change instead of a `const`:

```ts
let FLOAT_TABS = resolveFloatTabs();
```

`floatTabStrip()` and the `render()` body already map over `FLOAT_TABS`, so they
need no structural change beyond referencing the mutable binding.

### Reacting to changes

Two entry points must recompute `FLOAT_TABS` and refresh:

1. **Local edit** (user toggles a tab in the picker): after `setPref('floatTabs', …)`,
   call a small `refreshFloatTabs()` that does `FLOAT_TABS = resolveFloatTabs();`
   then guards the active tab and calls `float.refresh()`.
2. **Backend hydrate** (app.ts:1365 block, inside the `hydratePrefs` branch):
   recompute `FLOAT_TABS = resolveFloatTabs();` alongside the existing
   `floatTab` re-read at app.ts:1370-1371, so a reload that restored prefs from the
   backend reflects the saved tab set.

Active-tab guard (used by both paths and safe to centralize):

```ts
function refreshFloatTabs(): void {
  FLOAT_TABS = resolveFloatTabs();
  if (!FLOAT_TABS.some((t) => t.id === floatTab)) {
    floatTab = FLOAT_TABS[0]!.id;
    setPref('floatTab', floatTab);
  }
  float.refresh();
}
```

The existing `?? FLOAT_TABS[0]!` at app.ts:1299 remains as a second safety net.

### Editor UI (in the Customize `window` tab)

Add a "Floating window tabs" control group to the `window` branch of
`customizePanel` (theme.ts:801). Because `TABS` lives in app.ts and `theme.ts`
must not import from app.ts (layering — theme.ts is imported *by* app.ts), the tab
list is passed in rather than imported.

Two clean options; **Option A recommended** for the smallest, lowest-risk diff:

- **Option A — render the picker in app.ts, not theme.ts.** Keep the theme
  customizer as-is and add the float-tab picker to the *float window itself* (a
  small "⋯ Tabs" affordance in the float title bar, or a section appended to the
  Customize modal body after `customizePanel` output). app.ts owns `TABS`, so it
  can render checkboxes + up/down reorder buttons directly and wire them without any
  new cross-module data flow. This avoids threading `TABS` into theme.ts.

- **Option B — parameterize `customizePanel`.** Add an optional
  `floatTabsCfg?: { all: {id,label,icon,group}[]; selected: string[] }` argument to
  `customizePanel` and a matching `data-cz-floattab` wiring branch in
  `wireCustomize`. More "native" to the existing customizer, but requires passing
  the tab registry (label/icon/group) from app.ts into every `customizePanel` call
  and rerender. Heavier, touches theme.ts's public signature.

Recommended: **Option A.** Render a compact panel in app.ts, reusing existing modal
styles. Minimal surface area, no layering change, no new theme.ts params.

Picker markup (app.ts, built from `TABS`):

- One row per tab: a checkbox (visible on/off) + label + icon + a subtle
  `primary`/`tools` group hint.
- Reorder: up/down buttons per selected row (drag is nicer but adds pointer-handling
  code; up/down is a smaller, accessible first cut and matches the codebase's
  restraint). Order is stored as the `floatTabs` array order.
- A "Reset to default" link that clears the pref (`setPref('floatTabs', null)`).
- Enforce **minimum one** selected: disable the last remaining checkbox's un-check,
  or silently re-add the first tab in `refreshFloatTabs` (the guard already does the
  active-tab half; add an empty-selection guard that writes `DEFAULT_FLOAT_TABS`).

### Styling

Reuse existing modal/customizer classes (`vle-cz-h`, `vle-cz-row`, `vle-cz-chk`,
`vle-cz-note`, `vle-fb-btn`). If a dedicated list is wanted, add one small block to
`styles.ts` (e.g. `.vlf-tabpick-row{display:flex;align-items:center;gap:8px}` plus
the up/down button sizing). No new keyframes or chrome-scoped rules.

---

## Files touched

1. **`src/ui/prefs.ts`** — add one `LEGACY` migration row so the key hydrates
   cleanly:
   ```ts
   { from: 'vellum2.float.tabs', key: 'floatTabs', json: true },
   ```
   (Also documents the new pref in the module header comment.) No other change —
   `getPref`/`setPref`/`hydratePrefs` are generic.

2. **`src/ui/app.ts`** — the bulk of the work:
   - Add `DEFAULT_FLOAT_TABS`, `resolveFloatTabs()`, and `refreshFloatTabs()`.
   - Change `const FLOAT_TABS = …` (app.ts:1271) to `let FLOAT_TABS = resolveFloatTabs();`.
   - In the `hydratePrefs` branch (app.ts:1365-1374), recompute `FLOAT_TABS` via
     `refreshFloatTabs()` (or inline the recompute + guard) after the `floatTab`
     re-read.
   - Add the picker UI + its click/change wiring (Option A), calling
     `refreshFloatTabs()` on every edit.

3. **`src/ui/styles.ts`** — optional: a small `.vlf-tabpick-*` block if not fully
   reusing customizer classes.

4. **`test/…`** — see below.

No changes to `float.ts` (it's a presentation shell that renders whatever
`hooks.render` draws), `theme.ts` (under Option A), or any backend/domain file.

---

## Edge cases & guards

- **Empty selection** → `resolveFloatTabs()` returns the primary default; the picker
  also prevents removing the last tab.
- **Stale ids** (a saved id no longer in `TABS`, e.g. a renamed/removed tab) →
  filtered out by the `TABS.find` map; if all are stale, default kicks in.
- **Duplicate ids** → deduped, first occurrence wins (preserves order).
- **Active tab hidden** → `refreshFloatTabs` resets `floatTab` to the first visible
  tab and persists it; the `?? FLOAT_TABS[0]!` at the mount site is the backstop.
- **Backend/local divergence** → `hydratePrefs` (backend wins on reload) already
  drives the recompute, matching how `floatTab` is handled today.
- **Tools-tab components** are already valid `Component<ChronicleState>` values
  mounted the same way in the drawer, so mounting them in the float needs no new
  code — the same `mount(bodyEl, def.comp, …)` path handles them.

---

## Step-by-step

1. Add the `floatTabs` migration row to `prefs.ts` and update the header comment.
2. In app.ts, add `DEFAULT_FLOAT_TABS`, `resolveFloatTabs()`, `refreshFloatTabs()`.
3. Convert `FLOAT_TABS` to a mutable `let` initialized from `resolveFloatTabs()`.
4. Hook `refreshFloatTabs()` into the `hydratePrefs` branch.
5. Build the picker UI (checkboxes + up/down + reset) from `TABS`; wire edits to
   `setPref('floatTabs', …)` + `refreshFloatTabs()`.
6. (Optional) add `.vlf-tabpick-*` styles.
7. Tests: assert `resolveFloatTabs` behavior (default, subset, order preserved,
   dedupe, stale-id drop, empty → default, tools tabs allowed). Follow the
   existing `test/theme.test.ts` / `test/layout-defs.test.ts` style. If
   `resolveFloatTabs` is defined inside the app closure, extract it to a small pure
   helper (e.g. `src/ui/float-tabs.ts`) so it's unit-testable without the DOM —
   recommended, mirrors how `layout-defs.ts` isolates pure layout logic.
8. `bun run typecheck`, `bun run test`, `bun run build`.

---

## Effort & risk

- **Effort:** ~half a day. Concentrated in app.ts; one-line prefs change; optional
  small CSS + one focused test file.
- **Risk:** low. Persistence, backend sync, per-tab mounting, and the active-tab
  fallback all already exist; this only changes which ids feed the existing
  data-driven strip. No schema or backend surface changes.

## Recommended follow-ups (out of scope)

- Drag-to-reorder in the picker (replace up/down) once the array-based ordering is
  proven.
- A matching picker for the *drawer* tab bar (same `TABS`, same pref pattern) if
  users want symmetric control — deliberately not included here.
