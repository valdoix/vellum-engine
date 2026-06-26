# VELLUM Engine

**VELLUM II — codename *Palimpsest*.** A living-narrative engine for [Lumiverse](https://lumiverse.chat): an append-only event-log chronicle, hybrid scene-aware recall, an evolving relationship graph, a dramatic-irony knowledge model, and an illuminated UI — driven by a token-lean, fully block-controllable preset.

> Successor to `vellum-tracker` (1.x, frozen). This is a ground-up rebuild in TypeScript with a real build, modules, and tests. See `VELLUM-II-PLAN.md` for the full architecture and roadmap.

[![status](https://img.shields.io/badge/status-alpha-d8a05a)](#) [![Lumiverse](https://img.shields.io/badge/Lumiverse-%E2%89%A5%200.5-d4a35a)](https://lumiverse.chat) [![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-bundle-fbf0df?logo=bun)](https://bun.sh)

---

## The bet

The legacy tracker fought the grain in four ways; VELLUM II flips each:

| Legacy | VELLUM II |
|---|---|
| Prose → brittle regex → structure | Model emits a **validated JSON state block** (regex fallback) |
| Bag-of-words recall | **Hybrid**: lexical ⊕ host embeddings ⊕ structured, fused by RRF |
| Mutable blobs, racing writes | **Append-only event log** + pure reducers + serialized writes |
| One file; one throw freezes a tab | **Modules + isolated UI components** with error boundaries |
| `userId` scattered, in-memory | One **persisted identity + capability** layer |
| `version:3` read by nothing | Real **schema + migrations** (zod) |
| No tests | Pure parsers/reducers/retrieval **unit-tested** |

**Continuity guardrail:** structured facts (bond scores, who-knows-what, the day counter, cast identity, relationship categories) are extension-owned and injected verbatim — *never* retrieved by similarity. Embeddings are additive to continuity, never subtractive.

---

## Architecture

```
src/
  core/      schema (zod), events, reduce (pure), migrate, ids, hash, result
  domain/    cast, relations (multi-category sets), knowledge, memory, threads
  retrieval/ inverted index, host embeddings, lexical, RRF fusion, budget   (Phase 2-3)
  store/     event-log load/save/migrate + serialized write queue
  host/      identity (persisted uid), capability probing
  bus/       events, pulse, lifecycle
  ui/        component model (+ error boundary), tabs, graph, styles
```

The **event log** is the single source of truth. Every change is an immutable event; `state = reduce(events)`. Time-scrub, undo, branching, and provenance-audit all fall out of the log as queries instead of bespoke subsystems.

---

## Develop

```sh
bun install
bun run typecheck   # tsc --noEmit (strict)
bun run test        # vitest
bun run build       # → dist/backend.js + dist/frontend.js
```

After source changes, run `bun run build` and reload the extension in Lumiverse.

## Install (when released)

1. Lumiverse → Extensions → Install, paste this repo URL.
2. Grant permissions (each justified below).
3. Pair with the VELLUM II preset (`presets/`).

### Permissions — what breaks without each

| Permission | Used for | Without it |
|---|---|---|
| `interceptor` | scene-aware recall injection | no recall into the prompt |
| `chats` | resolve active chat, attach world books | no chat context / vault attach |
| `chat_mutation` | read raw history, hide filed messages | no scan / hierarchical memory |
| `generation` | auto-summary, cast/knowledge extraction | no auto-extraction |
| `ui_panels` | the drawer tabs | no UI |
| `world_books` | the in-app Vault (lorebooks) | no vault |
| `memories` | host embeddings for semantic recall | lexical-only recall (still works) |

## License

AGPL-3.0 (matching the Lumiverse extension ecosystem).

## Credits

Influenced by the Lumiverse community — notably the AI-directed retrieval + activity-feed UX of LoreRecall, and the splice-in-place chapter/arc compression of LumiBooks — rebuilt natively here in our own engine and words.
