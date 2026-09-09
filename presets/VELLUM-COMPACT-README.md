# VELLUM II — COMPACT

`vellum-compact.json` is a separate small-preset option for VELLUM. It does not replace VELLUM II — Engine or ARGENT LOOM.

The generated preset has a hard 5,000-token standing-prompt ceiling using VELLUM's conservative four-characters-per-token estimate. Its default assembled prompt is smaller because mutually exclusive controls are expanded to only their active branches. The completion allowance remains 12,000 tokens so long prose is not mistaken for prompt size and Inline Compatibility has room to close its state block.

## What it keeps

- Forbidden, Minor Continuity, and Director player agency, resolved per turn.
- Persona mood, condition, activity, private thought, and stable traits whenever Persona State is enabled, independently of the story-prose agency mode.
- A per-character knowledge firewall for secrets, private scenes, inference, and transmitted information.
- A monotonic minute clock and a canonical elapsed story-day count kept separate from calendar rendering, so October 17 cannot become narrative Day 17.
- Character-specific motives, voices, relationships, NPC-to-NPC dialogue, and limited-knowledge thoughts.
- Causal thread and arc movement that rejects unrelated progress.
- Grounded off-screen activity with a replace-all current T1 parallel snapshot, canonical location locks, explicit information channels, and attached chat lorebooks as objective world canon.
- VELLUM Codex refresh, secrets and secret reveals, knowledge, scars, items, timeline, plants, payoffs, bonds, factions, threads, and arcs.
- Engine Second Pass by default, with Inline Compatibility for hosts that need model-written `<vellum>` state.
- Dialogue speaker tags and the display, cleanup, and conservative attribution regex bridge.

## What it leaves to the larger presets

COMPACT intentionally omits ARGENT's extensive model adapters, profiles, artifact system, visual toolkit, genre stack, fine-grained prose dials, verbose Reverie, world genesis controls, and teaching-oriented full state schema. Use ARGENT LOOM or VELLUM II — Engine when those controls matter more than prompt size.

## Install

Import `presets/vellum-compact.json` in Lumiverse and select **VELLUM II — COMPACT** for the chat or connection. Keep **State Compiler** on **Engine Second Pass** when the extension supports it. The preset can coexist with `vellum-ii.json` and `argent-loom.json`.

The main preset already embeds its ten required display and cleanup scripts. `presets/vellum-compact-regex.json` is an optional standalone export for users who manage regex scripts separately.

## Build and verify

```sh
bun run build:compact
bun run check:compact
```

The generator fails if its conservative prompt estimate exceeds 5,000 tokens or if required markers, state blocks, output ordering, controls, or regex scripts are missing.
