# VELLUM Vault — Implementation Plan

The Vault is VELLUM II's **story-aware authoring layer over Lumiverse world books**. It never re-implements the host's World Info activation engine (keywords, sticky/cooldown/delay, groups, recursion, vectorization, budgets are all excellent and stay native). The Vault delegates activation to the host (`world_books` API + `getActivated`) and wins on the four things native can't do: **categorize, auto-configure per category, auto-update from the living chronicle, and add story-aware intelligence.**

Sits on the event-log spine. Uses the established operator-scoped `userId` resolution (`host/user.ts`) and capability gating (`host/capability.ts`). All host mutation is permission-gated on `world_books` (+ `chats` to attach).

---

## 0. Principles / guardrails

- **Delegate activation.** Write entries through `spindle.world_books.*`; read what fired via `getActivated`. Do not score or inject lore ourselves (that would double-inject — the host already injects WI).
- **Own only what we create.** Every Vault-managed entry is tagged `extensions.vellum = true` with `extensions.vellumCategory`, `extensions.vellumSource` (`promote|sync|auto|manual`), and `extensions.vellumLink` (chronicle id it mirrors, if any). Auto-update NEVER touches an entry without the vellum tag, and converting to "hand-owned" simply drops the tag.
- **Capability-degrade.** No `world_books` permission → the Vault tab shows a clear banner and disables writes, never crashes (the v1 Vault failure pattern is already solved).
- **Provenance + reversibility.** Auto-created entries land in a `pending` state the user accepts/edits/rejects; auto-synced entries show an "auto-managed" badge with an "unlink" button.

---

## 1. Data model

### 1.1 Category (config, persisted per chat in the event log or a dedicated store)
```ts
interface VaultCategory {
  id: string;            // 'characters' | 'locations' | ... | 'custom_<n>'
  label: string;         // "Characters"
  glyph: string;         // a unicode mark for the card
  color: string;         // accent
  builtin: boolean;
  hidden: boolean;       // user can hide unused defaults
  // auto-settings preset applied to NEW entries of this category (overridable per entry)
  defaults: EntrySettings;
  // sync policy for auto-update (§3)
  sync: 'off' | 'promote' | 'sync' | 'auto';
  // which chronicle source feeds auto-update, if any
  source?: 'cast' | 'relations' | 'secrets' | 'memories' | 'threads' | null;
}

interface EntrySettings {
  position: 'before_main' | 'after_main' | 'before_an' | 'after_an' | 'at_depth' | 'before_examples' | 'after_examples';
  depth?: number;        // when position = at_depth
  role: 'system' | 'user' | 'assistant';
  order: number;
  priority?: number;
  constant?: boolean;
  sticky?: number;
  cooldown?: number;
  delay?: number;
}
```

### 1.2 Default categories + auto-settings (the §4 table, encoded)
| id | label | glyph | position | depth | order | sticky | source | sync default |
|---|---|---|---|---|---|---|---|---|
| `characters` | Characters | ☒ | at_depth | 4 | 100 | 2 | cast | promote |
| `locations` | Locations | ⌂ | before_main | — | 50 | 3 | — | off |
| `factions` | Factions | ⚑ | before_main | — | 60 | 0 | — | off |
| `creatures` | Creatures | �​✦ | at_depth | 4 | 100 | 1 | — | off |
| `items` | Items & Artifacts | ✶ | at_depth | 2 | 120 | 4 | — | off |
| `concepts` | Concepts & Lore | ❡ | before_main | — | 30 | 0 | — | off |
| `systems` | Systems & Rules | ⚙ | after_main | — | 40 | 0 (constant) | — | off |
| `events` | Events & Timeline | ⧖ | at_depth | 1 | 200 | 0 | threads | off |
| `relationships` | Relationships | ⚯ | at_depth | 3 | 90 | 2 | relations | off |
| `custom` | (user-named) | ✧ | user | user | user | user | — | user |

Encode as a `DEFAULT_CATEGORIES` constant in `domain/vault.ts`. Categories live in a `vault.config` store keyed per chat (or global with per-chat overrides). A `category.set` / `category.del` event keeps it in the log so it's portable + migratable.

### 1.3 The entry mirror
We don't store entries ourselves — they live in the host. The Vault keeps a **lightweight cache** (`vaultSnapshot`, like v1) of `{ books, entries }` with the `extensions.vellum*` fields decoded, refreshed on demand and after each write.

---

## 2. Categories + per-category auto-settings (Phase 1)

- **Category bar** in the Vault tab: chips per non-hidden category (color + glyph + count), an "All" chip, and a "+ Category" button (opens a creator: name, glyph picker, color, and the `EntrySettings` form → a `custom_*` category).
- **Per-category Settings editor**: a gear on each chip opens the `EntrySettings` form; saving updates `category.defaults`. New entries created under that category inherit these; existing entries are untouched (with an optional "apply to all in category" bulk action).
- **Add Entry** form: pick category first → the form pre-fills position/depth/role/order/sticky from `category.defaults` (collapsed under "Advanced"), so the user normally just types **keywords + content**. Power users expand Advanced to override.
- Backend writes via `world_books.entries.create` with `extensions: { vellum:true, vellumCategory:id, vellumSource:'manual' }` and the resolved settings mapped to the host's field names (position code 0–6, depth, role, order, priority, constant, sticky, cooldown, delay).

**Deliverable:** categorize, color, filter, and create entries with zero field-tuning. Immediate UX win over the flat native table.

---

## 3. Auto-update (Phase 2) — the killer feature

Three tiers, per-category via `category.sync`:

### Tier A — Promote (manual, `sync: 'promote'` enables buttons)
- On a cast card / secret / chapter-memory / relation: a "→ Vault" action.
- `buildPromotion(kind, id)` (from v1, extended): seeds keywords from name+aka (cast) / keeper (secret) / keywords (memory); content from the structured record; category inferred (cast→characters, secret→characters hidden, memory→events/concepts).
- Creates one host entry tagged `vellumSource:'promote'`, `vellumLink:<chronicleId>`.

### Tier B — Sync (semi-auto, `sync: 'sync'`)
- On each fold (debounced, off the hot path via the write queue), `reconcileCategory(cat)`:
  1. Gather chronicle source items (e.g. all cast for `characters`).
  2. For each, find the Vault-owned entry with matching `vellumLink`.
  3. If the source changed (role/appearance/aka, or relationship scores/categories), **regenerate the content** and `entries.update` — keywords re-harvested from current aka.
  4. Never create/delete here (that's Tier C); never touch untagged entries.
- A diff guard: only update when a content hash differs, so we don't rewrite every turn.

### Tier C — Auto-author (full, `sync: 'auto'`, opt-in + gated)
- When a new named entity crosses a **salience threshold** (appears ≥N turns, or the existing knowledge/cast extractor flags it), create a **draft** entry in `pending` state (`extensions.vellumPending:true`), keyworded, in the right category.
- **Dedupe with embeddings** (reuse `retrieval/embed.ts`): before creating, cosine-check the new content against existing entries; if too similar, update instead of duplicate.
- The Vault tab surfaces a "Pending (N)" tray: Accept / Edit / Reject. Accepting clears the pending flag; rejecting tombstones so it isn't re-suggested.

**Guardrails:** write-queue serialization (already built), content-hash debounce, provenance tags, visible "auto-managed" badge + unlink, all permission/capability gated.

---

## 4. Story-aware intelligence (Phase 3) — what native can't do

1. **Live activation mirror.** Call `getActivated(chatId)` each turn; in the Vault tab and the floating dashboard, mark entries **firing now** (with why: keyword / sticky / constant) vs dormant. Ambient + pretty, tied to the scene.
2. **Scene-scoped suggestions.** "Selene is present but has no Character entry — create one?" driven from the present cast vs Vault coverage.
3. **Relationship-aware recursion seeding.** When promoting two bonded characters, auto-insert each other's keywords into their content so the host's recursion links them — wiring native recursion from the relations graph.
4. **Contradiction / duplicate guard.** Embedding similarity flags a new entry that duplicates or contradicts an existing one before saving.
5. **Scheduled reveals (Events).** Entry extension `revealAtDay` / `revealAfterThread`; the Vault enables/disables the host entry (`disabled` toggle) when the chronicle's day counter / thread state reaches it — a *time-driven* lorebook.
6. **Keyword harvesting.** Suggest keywords by scanning the chronicle for how an entity is actually referred to (nicknames/titles).
7. **Adopt & classify.** Point the Vault at an existing native book → LLM-classify its loose entries into categories (tags them vellum-managed, non-destructive).
8. **Per-category token-budget visualizer** from the host's budget data.
9. **Pack export by category** (a category → a native world book others import).

Phase 3 items are independently shippable; ship the cheap deterministic ones first (1, 2, 3, 6, 9), then the embedding ones (4), then the scheduled/LLM ones (5, 7).

---

## 5. Backend surface (message types)

```
get_vault                  → vellum_vault { books, entries(+vellum fields), categories, activated }
vault_category_upsert      (id?, label, glyph, color, defaults, sync, source)
vault_category_delete
vault_category_apply       (id)                      // bulk-apply defaults to existing entries
vault_book_create/update/delete
vault_book_attach          (bookId, attach)          // chat.metadata.chat_world_book_ids
vault_entry_create/update/delete   (category resolves settings)
vault_promote              (kind, id, category?, bookId?)
vault_sync                 (categoryId | 'all')      // run reconcile now
vault_pending_resolve      (entryId, 'accept'|'reject')
vault_adopt                (bookId)                  // classify loose entries  [Phase 3]
```
All gated on `world_books`; reuse v1's `vaultSnapshot`, `setBookAttached`, `buildPromotion` (extended). Auto-sync hooks into `foldChat` after broadcast (debounced), behind each category's `sync` setting.

---

## 6. Frontend surface

- **Vault tab** (new): category bar (chips + counts + gear + "+"), entry grid grouped/filtered by category, per-entry edit/delete, Add Entry (category-prefilled settings), Pending tray, book selector + attach-to-chat toggle, activation-mirror badges.
- **Dashboard hook:** an optional "Lore firing now" mini-section from `getActivated`.
- Reuse the existing modal (`ui/modal.ts`), filter bar, pagination, and component error boundary. New CSS in the gilt palette.

---

## 7. Tests

- Pure: category → host-field settings mapping; `buildPromotion` seeding; `reconcileCategory` diff (change → update, no-change → noop, untagged → never touched); pending dedupe decision.
- The host API is mocked; reducers/mappers are pure and unit-tested as usual.

---

## 8. Phasing (each shippable)

- **P1 — Categories + auto-settings + CRUD + attach** (the immediate win; no auto-update yet).
- **P2 — Auto-update tiers A (promote) + B (sync)** with provenance + unlink.
- **P3 — Intelligence:** activation mirror, scene suggestions, recursion seeding, then embeddings (contradiction guard, dedupe), then scheduled Events + adopt/classify.

Start: **P1**, since it delivers the categorize + zero-tuning authoring that most differentiates the Vault, with the lowest risk.
