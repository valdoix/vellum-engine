# Implementation Plan — Director Locations: "The Atlas" (Concept I)

Rebuild the Director's Locations view as **The Atlas** (each place a gazetteer plate
with region-colored spine, containment breadcrumb, recency pulse, and a "You are
here" marker for the live scene) — and, along the way, fix the provenance/pin model
so the three requested clarity notes are actually representable.

---

## The core problem the notes expose

Today a single `Location.auto?: boolean` field is doing **two unrelated jobs at
once**, and that conflation is exactly why the notes can't be satisfied as-is:

| `auto` value | What it means for provenance | What it means for injection |
| --- | --- | --- |
| `true`  | model-collected from a visited scene | recency-capped (only if fresh) |
| `false` | **user-created OR user-pinned** (indistinguishable) | always injected |

So:
- A user-created place and a user-pinned auto place are **byte-identical** (`auto:false`) — the UI can't show them differently (breaks note 1 & 3).
- "Editing an auto place should drop the auto tag" has nowhere to record that it happened without also flipping its injection behavior (breaks note 1).
- Pinning a model place (`auto:false`) makes it look user-created (breaks note 3).

**Provenance (who made it) and pin-state (how it's injected) are orthogonal and must
be two fields.** This is a model change — I'm flagging it up front because it's the
crux, not optional polish. It mirrors the existing `Faction`/`CastCard` pattern
(`source: 'auto' | 'user'`), so it's consistent with the codebase, not novel.

---

## PART A — Data model: split `auto` into `source` + `pinned`

**File:** `src/domain/types.ts` — `Location`

```ts
export interface Location {
  id: string;
  name: string;
  note?: string;
  source?: 'auto' | 'user'; // provenance: model-collected vs user-made/edited
  pinned?: boolean;         // injection: always-inject (true) vs recency-keyed (false)
  auto?: boolean;           // DEPRECATED — kept only so old events still read (see D)
  parent?: string;
  firstTurn: number;
  lastTurn: number;
}
```

### The three states the notes want (derived, not stored redundantly)
| State | `source` | `pinned` | Icon | Injection |
| --- | --- | --- | --- | --- |
| Model-added, untouched | `auto` | `false` | ○ auto | recency-keyed |
| Pinned (any origin) | either | `true` | ⚑ pin | **always** |
| User-made or user-edited, unpinned | `user` | `false` | *(none)* | recency-keyed |

Icon priority: **pinned ⚑ wins**; else `source==='auto'` → ○; else no icon.

---

## PART B — Events + reducer

**File:** `src/core/events.ts` — extend `EvLocationSet` (keep `auto` for back-compat):
```ts
export const EvLocationSet = z.object({ ...base, kind: z.literal('location.set'),
  id: z.string(), name: z.string(), note: z.string().optional(),
  source: z.enum(['auto','user']).optional(),
  pinned: z.boolean().optional(),
  auto: z.boolean().optional(),        // legacy field, still parsed
  parent: z.string().optional() });
```

**File:** `src/core/reduce.ts` — `case 'location.set'`. This is the delicate part
(locations are event-sourced; the log has historical events that only carry `auto`).
The reducer must accept BOTH shapes:

- **Legacy compat (event has `auto`, no `source`/`pinned`):**
  - `auto:true`  → `{ source:'auto', pinned:false }`
  - `auto:false` → `{ source:'user', pinned:true }` (old "pinned" semantics preserved)
- **New events (`source`/`pinned` present):** apply directly.
- **Edit-flips-provenance (note 1):** when `e.src === 'user'` and this is a content
  edit (name/note/parent), set `source:'user'` on the existing record. The auto
  origin is intentionally dropped — that's the requested behavior.
- **Pin/unpin does NOT change `source`** — only `pinned`. So unpinning a model place
  reverts it to showing the ○ auto icon (its `source` was never lost by pinning).
- Auto-refresh from a later scene visit must **never** un-pin or overwrite a user's
  `source:'user'`/`pinned` — mirror today's "auto never downgrades a pin" guard.

No forced schema migration: state is derived fresh from the log each load, so the
reducer's legacy-compat branch is sufficient and safer than rewriting history. (An
optional `migrate.ts` v18→v19 pass could normalize stored events, but it's not
required and adds risk — recommend skipping.)

---

## PART C — Injection logic + honest "keyed" wording

**File:** `src/domain/locations.ts` — `injectableLocations`
```ts
const pinned = list.filter((l) => l.pinned === true);        // was: auto !== true
const rest   = list.filter((l) => l.pinned !== true).sort(byRecent);
```
Everything else (cap, current-place children resurfacing) stays.

**Behavior change to call out:** under the old model user-created places were
`auto:false` → **always injected**. Under the new model a user-created place defaults
to `pinned:false` → recency-keyed. Legacy always-injected places survive because the
reducer maps old `auto:false → pinned:true`. New user-made places start keyed and the
user pins them to force always-injection. This is consistent with the notes (pinned =
always; unpinned = keyed) but it IS a default-behavior change for newly created
places — worth confirming.

**Honesty on "keyed":** the notes say unpinned places are "keyed." The actual
mechanism is **recency-cap + current-place-children resurfacing**, not keyword
matching like a worldbook. The plan uses "keyed" in UI copy per the request, but the
tooltip must describe the real behavior accurately, e.g.:
> *Unpinned: injected when recently visited or when you're in/near it. Pin to always
> include it.*

I recommend that accurate phrasing over implying keyword triggers that don't exist.

---

## PART D — Backend handlers

**File:** `src/backend.ts`
- `vellum_location_set` (create/edit): emit `source:'user'` (drop `auto:false`). New
  places default `pinned:false` (keyed). This is the "edit flips to user + no forced
  pin" behavior. Keep name/note/parent handling as-is.
- `vellum_location_pin`: emit `location.set` with only `pinned` toggled, **preserving
  `source`** (read `cur.source`). Rename the payload semantics from `auto` to `pinned`.
- `core-feature.ts:167` (auto-collect during fold): emit `source:'auto', pinned:false`
  instead of `auto:true`.
- `turnlog.ts:31`: update the `location.set` predicate (`a.auto ? null : …`) to
  `a.source === 'auto' ? null : …` so auto-collected places still don't spam the log.

---

## PART E — UI: "The Atlas" view (`src/ui/tabs/director.ts` + `styles.ts`)

Rebuild `locationsView` per the mockup (`design-mockups/locations-redesign.html`,
Concept I). Each location renders as a **plate**, not a tree row:

- **Region-colored left spine** — hashed hue per top-level region so places in the
  same region share a spine color (visual grouping without deep indentation).
- **Containment breadcrumb** — `Region › Site › Room` resolved from the `parent`
  chain (reuse the existing `byId` map + a parent-walk, cycle-guarded like `walk`).
- **Recency pulse** — a small dot/bar whose opacity fades as `turns - lastTurn`
  grows (fresh = bright gold, stale = dim). Compute against `s.turns`.
- **"You are here"** — the plate whose normalized name equals `s.scene.location`
  gets a gold glow + "You are here" tag (reuse `currentPlaceChildren`'s match logic).
- **Provenance/pin chips** — the three-state icon from Part A, each with a clear
  tooltip:
  - ○ **auto** → "Added by the model from a visited scene."
  - ⚑ **pinned** → "Always injected into the prompt."
  - *(no icon)* → user-made/edited, keyed.
- **Controls on hover** — pin/unpin, edit, delete (same `data-loc-*` attributes as
  today, so the click handlers in the tab's mount need only the pin-payload rename).

Keep the containment relationship **visible** (breadcrumb) but drop the rail/elbow
indentation tree in favor of flat, region-grouped plates — the mockup's whole point is
"located, not listed," and flat plates degrade better at 42vw than deep nesting.

New CSS classes under a `.vle-atlas-*` namespace (plate, spine, breadcrumb, pulse,
here, chips), reusing existing theme vars. Remove/replace the `.vle-loc-tree/-node/
-kids/-caret` rules only after the new view is in (or leave them; they're small).

Retire the `_locCollapsed` caret state (flat plates don't collapse) — or repurpose it
to collapse a whole region group if region grouping needs it.

---

## PART F — Tests

- `test/locations.test.ts` (new or extend): `injectableLocations` keeps all `pinned`,
  recency-caps the rest; legacy `auto:true/false` events map correctly through the
  reducer; an edit event flips `source:'auto' → 'user'`; pin/unpin toggles `pinned`
  without touching `source`; auto-refresh never un-pins.
- Reducer back-compat: replay a log mixing old (`auto`) and new (`source`/`pinned`)
  `location.set` events → correct final `Location` shape.
- No-regression: a chat with only legacy `auto:false` places still injects them all
  (they migrate to `pinned:true`).

---

## Verify checklist
- [ ] `npm run build` emits both bundles
- [ ] `npm run typecheck` clean (Location field change ripples to reduce/locations/backend/turnlog)
- [ ] `npm test` green incl. new location cases
- [ ] preset/regex files untouched
- [ ] manual: model-added place shows ○; edit it → ○ disappears; pin any → ⚑ +
      "always injected"; user-created starts icon-less; "You are here" marks the
      live scene; breadcrumb shows containment

---

## Honest notes / risks
1. **This is a model change, not just a reskin.** The three notes are impossible with
   the single `auto` boolean; splitting into `source` + `pinned` is the minimum. That
   ripples through events, reducer, injection, two backend handlers, `core-feature`,
   and `turnlog`. Scoped and mechanical, but not tiny.
2. **Default-behavior change:** new user-created places become *keyed* rather than
   *always-injected*. Legacy pinned places are preserved via reducer mapping. Confirm
   this default is what you want before I build it.
3. **"Keyed" is a simplification.** The real mechanism is recency + current-place
   resurfacing, not keyword matching. UI copy should describe that honestly; I'd avoid
   language that promises worldbook-style keying that isn't there.
4. **Provenance is dropped on edit (by design, per note 1).** If you'd rather *keep*
   provenance and only hide the icon, use the faction pattern (`source` stays `auto`
   + a `userEdited` flag; icon shows when `source==='auto' && !userEdited`). Both meet
   the notes; flipping `source` is simpler, `userEdited` preserves history. Say which.

## Sequencing
A (types) → B (events/reducer + back-compat) → C (injection) → D (backend/feature/
turnlog) → E (Atlas UI) → F (tests) throughout. A–D are the model spine and should
land + test green before the UI (E) so the view renders correct data.
