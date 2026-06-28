# VELLUM II — Hybrid traversal axis (implementation plan)

Add a third tree-traversal axis: **hybrid** — character-scoped at the top, then
time-ordered (arc→chapter→leaf) *within* each character. Answers "this is a
Cersei scene → walk Cersei's history in order" — the WHO of the character axis
with the WHEN structure of the temporal axis.

The two existing axes (`temporal` = `buildMemoryTree`, `character` =
`buildCharacterTree`) are spanning structures over one shared set of
`RetrievableItem` leaves; `traverseTree` walks whichever `opts.axis` picks. The
hybrid is purely another builder + one enum value threaded through the existing
chain. No new infra, no new deps.

Gate: `bun run typecheck && bun run test && bun run build`.

## What hybrid produces
4 tiers (char → arc → chapter → leaf), reusing the same leaf ids so selection
feeds the same assemble() path:
```
ROOT
├── ▣ Cersei — Queen Regent
│   ├── ARC "Siege of Harrenhal" (40–95)
│   │   ├── CH "Walls breach" (59–95)
│   │   │   └─ leaf: secret — the maester's poison
│   │   └── CH "Negotiations" (40–58)
│   │       └─ leaf: knows — the tunnel
│   └── (loose, arc-less leaves about Cersei, newest first)
└── ▣ Jaime — Lord Commander
    └── …
```
Each character's children are the SAME arc/chapter nodes the temporal tree
builds, but filtered to that character's leaves (an arc/chapter only appears
under a character if it contains ≥1 leaf concerning them). Empty branches pruned.

## Phase 1 — `buildHybridTree` (retrieval/tree.ts)
Reuse the existing two builders rather than reimplement nesting:
- Compute the per-character leaf map exactly like `buildCharacterTree` (knowledge
  who/about, secrets keeper, journal who/about) → `byChar: Map<charId, leafId[]>`.
- For each character with ≥1 leaf, build a *scoped temporal subtree*: run the
  same arc/chapter range-nesting as `buildMemoryTree`, but only over that
  character's leaves. Factor the temporal nesting into a small internal helper
  `nestTemporal(leafIds, state)` that both `buildMemoryTree` and the hybrid call,
  so the range logic lives once.
  - ponytail: if extracting the helper churns `buildMemoryTree` risk, v1 can
    instead build the full temporal tree once and, per character, walk it keeping
    only branches that contain that character's leaves (prune-by-membership). Pick
    whichever is the smaller diff after reading buildMemoryTree closely.
- Node ids MUST be unique per character (an arc can appear under several chars):
  prefix scoped nodes `h:<charId>:<arcId>` etc.; leaf ids stay bare (selection
  resolves by leaf id, so duplicates across branches are fine — dedup on select
  already happens in traverse-tree.ts:97).
- Character node = `kind:'arc'`-style top (like buildCharacterTree's `char:` node)
  OR a new label; keep `MemNodeKind` as-is to avoid depth-cap changes — map char
  node to depth 0 so the existing arc=1/chapter=2/leaf=3 depths still gate drill.
  Verify `depthOf` + `depthLimit` interplay: hybrid wants depthLimit 4 (char→arc→
  chapter→leaf). Add a depth for the char tier OR raise the default depthLimit
  for this axis only (opts already per-call).
- Pure + deterministic, same `clip`/range helpers. Leaves concerning no tracked
  character → ROOT (mirror the other builders, nothing unreachable).

## Phase 2 — wire the axis enum through the chain
Single new value `'hybrid'` everywhere the two existing axes appear:
- `traverse-tree.ts:39` — `axis?: 'temporal' | 'character' | 'hybrid'`.
- `traverse-tree.ts:73` — `opts.axis === 'character' ? buildCharacterTree :
  opts.axis === 'hybrid' ? buildHybridTree : buildMemoryTree`. Set depthLimit to
  4 when axis hybrid (char tier adds a level).
- `backend.ts:93,482,800` — the `=== 'character' ? 'character' : 'temporal'`
  guards become a 3-way validate (`['temporal','character','hybrid'].includes`).
- `backend.ts:797` — accept `p.axis === 'hybrid'` in the persisted set.
- `tree.ts` SYS prompt note: the controller prompt is axis-agnostic (it just sees
  "FRONTIER of nodes" with `[kind]` + gist), so no prompt change needed; a char
  node's gist already reads as the character name.

## Phase 3 — UI cycle + label (app.ts)
Extend the traverse QOL cycle: off → flat → tree·time → tree·char → **tree·hybrid**
→ off (app.ts:267-274). Update:
- the cycle conditionals (add the hybrid step after character).
- the Actions-menu toggle-state string (app.ts:185) + the toast (app.ts:445):
  add `hybrid` → "by character+time".
- `_traverseAxis` type comment.

## Phase 4 — tests (test/)
- tree: `buildHybridTree` — a leaf about Cersei in chapter C under arc A appears
  at `Cersei → A → C → leaf`; a leaf about two characters appears under both; a
  character with no leaves is absent; arc-less leaves hang at the character root;
  fully-unowned leaves at ROOT.
- determinism: same state → identical tree (ordering stable).
- traverse-tree: with `axis:'hybrid'` + a stub callModel that expands the char
  then the arc then selects a leaf, the selected id resolves and `summaryIds`
  picks up any selected arc/chapter scoped nodes (strip the `h:<char>:` prefix
  when classifying kind — verify summaryId resolution still works with prefixed
  ids; if the prefix breaks detail-lookup, store the underlying memoryId on the
  node and resolve via that).

## Verify
typecheck → test → build → reload; cycle Traverse to "by character+time", play a
turn with generation on, check the Context tab trace shows char→arc→chapter→leaf
drill steps.

## Risk / smaller-diff notes
- The one real subtlety is **summary detail resolution**: selecting a scoped
  chapter node must still find its detailed summary. The temporal tree uses the
  bare memory id as the node id; the hybrid prefixes it for uniqueness. Fix by
  giving `MemNode` an optional `sourceId` (the underlying memory id) and having
  the caller resolve detail from `sourceId ?? id`. Small, additive field.
- Keep `buildMemoryTree`/`buildCharacterTree` behavior byte-identical; the helper
  extraction (if taken) must not change their output — the existing tree tests
  guard that.

## Out of scope
- No change to flat traversal or deterministic recall.
- No new controller prompt; axis stays invisible to the model beyond node gists.
