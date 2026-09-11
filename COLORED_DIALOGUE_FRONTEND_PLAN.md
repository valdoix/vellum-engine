# Colored Dialogue — Frontend Display Transform (Rewrite Plan)

## Why this replaces the regex-script approach

The `regex_scripts` path failed at the host level: chat-scoped scripts created via
`spindle.regex_scripts.create` are rejected as "already exists" yet never returned by
`list()` or `getActive()` — they exist but never activate. That's a Lumiverse-side
limitation we can't fix from the extension.

The frontend already has everything needed to color dialogue itself:
- The cast (with each character's `dialogueColor`) is broadcast every turn in `vellum_state`.
- The color palette math lives in `src/core/palette.ts` (pure, already shared).
- The preset already emits `[spk=Name]…[/spk]` tags into message text (confirmed: tags
  reach the DOM when the context-strip script is off).
- Lumiverse's frontend `ctx.dom` + `CHARACTER_MESSAGE_RENDERED` event are a documented,
  supported way to decorate message bubbles.

So: **color the dialogue in the browser, in our own frontend module.** No permission,
no script CRUD, no orphans, no `getActive`.

---

## Confirmed host API (from lumiverse-spindle-types + docs)

Frontend `ctx`:
- `ctx.dom.findMessageElement(id): Element | null` — bubble for a message id (virtualized).
- `ctx.dom.listMessageElements(): { messageId, element }[]` — currently-mounted bubbles.
- `ctx.dom.getMessageId(el): string | null` — resolve a bubble's id.
- `ctx.dom.addStyle(css): { remove() }` — already used by the module.
- `ctx.messages.getLatestMessageId()`, `listMessageIds()`.
- `ctx.events.on(name, fn)` — already used for `CHAT_SWITCHED`.

Events (from `CoreEventType`):
- `CHARACTER_MESSAGE_RENDERED` — fires when an assistant bubble renders (the key hook).
- `MESSAGE_EDITED`, `MESSAGE_SWIPED` — content changed in place → recolor.
- `CHAT_SWITCHED` — new chat → recolor all mounted bubbles.

The module's local `Ctx` interface (`src/ui/app.ts:36`) is a hand-rolled minimal subset
and MUST be widened to include `dom.findMessageElement`, `dom.listMessageElements`,
`dom.getMessageId`, and `messages`. (These already exist on the real host object; we're
just declaring them.)

---

## Design

### Source of truth for colors
On every `vellum_state` broadcast, `app.ts` already stores the reduced `state` (with
`state.cast`). We build a **speaker→color map** from that cast:
- explicit `dialogueColor` (`#hex`) wins;
- else the deterministic slot color from `castSlotColors(castIds)` in `palette.ts`;
- keyed by BOTH canonical name and `aka`, lower-cased for case-insensitive match.

This reuses the exact palette logic the panel already uses, so dialogue colors match the
cast cards.

### The transform
For a given bubble element, find the rendered text container and replace every
`[spk=Name]…[/spk]` occurrence with `<span class="vle-spk" style="color:…">…</span>`,
matching speaker names case-insensitively against the map (unknown speaker → skip/ink).

Two safeguards against React clobbering our edits:
1. **Re-apply on every render event** (`CHARACTER_MESSAGE_RENDERED`, edited, swiped).
2. **Idempotency guard**: stamp the bubble with `data-vle-spk-done="<contentHash>"`. Skip
   if the hash is unchanged; re-run when content changes (swipe/edit/stream-finalize).

We operate only on already-rendered assistant bubbles (post-stream), so we're not
fighting the token stream.

### Enable/disable
Reuse the existing per-chat toggle `vellum_colored_dialogue` (already wired end-to-end in
the backend + Actions menu). The frontend reads it from the `vellum_state` broadcast
(add `coloredDialogue` boolean to the payload — already present) and only transforms when on.

### Context stripping (unchanged, not our job)
Keeping `[spk=]` out of what the model sees stays with the **preset's own**
`vellum2-spk-strip` (prompt-target) script, which the user enables in the preset. Our
frontend transform is display-only. We document this clearly.

---

## File changes

### 1. `src/ui/spk-color.ts` (NEW) — the transform engine
Pure-ish DOM helper, no backend calls:
```ts
// buildSpeakerColorMap(state): Map<string,string>   // name/aka(lower) → #hex
// colorizeBubble(el, map): void                     // regex-replace [spk] → span
// hashContent(text): string                         // cheap change-detector
```
- Regex: `/\[spk=([^\]]{0,40})\]([\s\S]*?)\[\/spk\]/gi` (same contract as the preset).
- Escapes replacement text; validates hex with `HEX6` from `palette.ts` before styling.
- Skips a bubble whose `data-vle-spk-done` matches the current content hash.
- If a speaker isn't in the map, leave the inner text but strip the tag markers (so the
  reader never sees raw `[spk=]`), matching the preset's "reads normally" fallback.

### 2. `src/ui/spk-color.ts` styling
One CSS rule injected via the existing `ctx.dom.addStyle` bundle in `app.ts`
(add to the `STYLES` string or a small appended block): `.vle-spk{…}` (color only;
inherit everything else so it blends with host bubble typography).

### 3. `src/ui/app.ts` — wire it up
- **Widen `Ctx`** (line ~36): add
  ```ts
  dom: { …; findMessageElement(id:string):Element|null;
         listMessageElements():{messageId:string;element:Element}[];
         getMessageId(el:Element):string|null };
  messages?: { getLatestMessageId():string|null; listMessageIds():string[] };
  ```
- **State**: keep the latest `state.cast`-derived color map + `_coloredDialogueOn`
  (already exists). Rebuild the map whenever `vellum_state` arrives.
- **In `setup(ctx)`**: subscribe to
  - `CHARACTER_MESSAGE_RENDERED` → colorize that message's bubble (by id, else latest).
  - `MESSAGE_EDITED` / `MESSAGE_SWIPED` → recolor the affected bubble.
  - `CHAT_SWITCHED` → sweep `listMessageElements()` and recolor all.
  - Existing `vellum_state` handler → after storing state, rebuild the color map and
    sweep all mounted bubbles (so a color change in a cast card recolors immediately).
- **Guard**: all colorize calls no-op when `!_coloredDialogueOn`. When toggled OFF,
  sweep mounted bubbles and remove our spans (unwrap) so display reverts cleanly.
- Register the event unsubs in the returned teardown alongside the existing `unsub`.

### 4. Backend cleanup (remove the regex-script machinery)
- Delete `src/host/regex.ts` and `src/domain/dialogue-color.ts`.
- Remove `maybeColorSync` + its calls in `foldChatInner`, `vellum_cmd`, and the
  `vellum_set_colored_dialogue` / `vellum_clear` handlers.
- Simplify `vellum_set_colored_dialogue` to just persist the chat var + broadcast
  (no script create/delete, no force-delete scan).
- Remove `regex_scripts` from `spindle.json` permissions and from `Capability`
  in `src/host/capability.ts`.
- Keep the `dialogueColor` cast field + picker + `palette.ts` (all reused by the frontend).
- Update `test/dialogue-color.test.ts`: drop the script-generation assertions; keep/add
  tests for `buildSpeakerColorMap` + the tag→span transform (pure, DOM-free where possible
  via a string transform function).

### 5. One-time orphan purge (ship once)
Add a tiny dev-only backend action `vellum_purge_regex` that paginates ALL scripts
(offset 0,200,400,…) and deletes any whose `script_id` contains `vellum-engine-spk`.
Wire a hidden trigger (or run it automatically once on boot if the permission is still
granted, then it becomes a no-op after permission removal). This cleans the mess my
earlier debugging created. Remove in a follow-up once confirmed clean.

> Note: because we're removing the `regex_scripts` permission, the purge must run BEFORE
> the permission is dropped, or be a manual one-shot the user runs before updating. Simplest:
> ship the purge in the same build, run it on boot if `regex_scripts` is still granted,
> then the user removes the permission on the next update prompt.

---

## Risks & mitigations
- **React re-render clobbering** → re-apply on every render/edit/swipe event + content-hash
  idempotency. This is the documented pattern for per-message decoration.
- **Bubble markup changes** → we query the bubble root from `findMessageElement` and only
  touch text within it; if the text container selector drifts, we fall back to operating on
  the bubble root's `innerHTML`. Keep the selector logic in one place (`spk-color.ts`).
- **Streaming** → only colorize on `CHARACTER_MESSAGE_RENDERED` (post-finalize) and
  edit/swipe, never mid-stream, so we don't fight token updates.
- **Unknown/renamed speakers** → strip tag markers, leave text (never show raw `[spk=]`).

---

## Verification
1. `bun run typecheck` + `bun run test` + `bun run build`.
2. Manual: preset Colored Dialogue ON, extension toggle ON, set a cast `dialogueColor`,
   generate a turn → the character's quoted lines render in that color; other speakers get
   distinct slot colors; narration untouched.
3. Change a color in the cast card → existing visible bubbles recolor on the next
   `vellum_state` sweep.
4. Toggle OFF → spans removed, text plain, no raw tags.
5. Scroll away/back → color persists (or re-applies on remount via render event).
6. Confirm no `regex_scripts` permission is requested after update.

---

## Sequenced work
1. Add `spk-color.ts` (map builder + string/DOM transform) + unit tests.
2. Widen `Ctx`, wire events + `vellum_state` sweep + toggle guard in `app.ts`; add CSS.
3. Rip out backend regex machinery; simplify toggle handler; drop permission/capability.
4. Ship one-time orphan purge; update tests; typecheck/test/build.
5. Manual verification pass, then commit + push (incl. `dist/`).
