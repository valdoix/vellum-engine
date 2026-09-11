# Implementation Plan — Colored Character Dialogue (v2, CSS-injection rebuild)

## Why the last attempt failed (root cause, confirmed by the code)

The symptom was decisive: **past turns colored, new turns didn't.** That proves
attribution worked (the `[spk=Name]` tags were present and matched) — the failure
was in the **rendering lifecycle**, not attribution.

The reason is baked into the extension's capabilities. `ctx.dom` exposes **only**:

```ts
dom: { addStyle(css: string): { remove(): void }; cleanup(): void }
```

There is **no** message-DOM access — no `listMessageElements`, no per-message render
hook, no observer. So any approach that writes `<span>`s into chat bubbles from the
extension can only touch nodes that already exist at the moment it runs. It paints
the backlog once, then never sees a newly streamed/settled turn. That is *exactly*
"old turns colored, new turns not."

**Conclusion:** the extension must never touch chat-message DOM. The only robust
division of labor is:

| Concern | Owner | Mechanism |
| --- | --- | --- |
| Attribution + wrapping quotes in a span | **preset** | one static `display` regex → `<span data-spk="Name">` |
| Coloring those spans | **extension** | one injected `<style>` via `ctx.dom.addStyle` |

The preset regex rides Lumiverse's own render pipeline, so it fires on every render
including the post-stream settle. CSS rules re-apply automatically on every
re-render — a re-render cannot "lose" a stylesheet the way it loses injected DOM.
This is what structurally fixes the new-turn bug.

---

## Architecture

```
model emits:        [spk=Elara]"Hello."[/spk]
                          │
preset display regex ─────┤  (static, never regenerated)
  →  <span class="v-spk" data-spk="Elara">"Hello."</span>
                          │
preset context-strip regex (existing) removes [spk=…] from model context
                          │
extension injects ONE stylesheet:
  .v-spk[data-spk="Elara"]{color:#e0736b}
  .v-spk[data-spk="Kael"]{color:#5ab0d0}
  .v-spk{color:var(--vle-spk-default,inherit)}   /* fallback */
```

- Coloring is **display-only** — never mutates stored text or model context.
- Colors come from each cast card's existing `color` field (already in the schema
  and the edit form), falling back to the deterministic `autoHue(id)` slot color.
- The stylesheet is rewritten whenever the cast/colors change — a plain string swap,
  no regex regeneration, no script-ordering, no host DOM.

---

## What already exists (reuse, don't rebuild)

- **Cast color field:** `Character.color` / `colorTo` (`src/domain/types.ts:25-26`) and
  the color-picker rows in the edit form (`src/ui/tabs/cast.ts:175-176`). We reuse
  `color` as the dialogue color — no new schema field, no new picker.
- **Deterministic hue:** `autoHue(seed, shift)` (`src/core/palette.ts:101`) and
  `castSlotColors()` — the same hues the panel already uses for names, so dialogue
  colors match the cast list by default.
- **Style injection:** `ctx.dom.addStyle()` (already used once at `app.ts:732`).
- **Preset dialogue regexes:** the display + context-strip pair already exist in
  `presets/vellum-ii-regex.json` (entries 27/28, `vellum2-spk-display` /
  `vellum2-spk-strip`) and are embedded in `vellum-ii.json`. We change entry 27's
  replace string from a `{{switch}}` letter-hash into a stable `data-spk` span.
- **State stream:** `vellum_state` carries `s.cast` to the frontend every turn
  (`app.ts:1031`), so the extension always has current cast ids/names/colors.

---

## Phase 1 — Preset: static span wrap (replaces letter-hash coloring)

**File:** `presets/vellum-ii-regex.json` (and mirror into `vellum-ii.json`
`extensions.regex_scripts`).

**Entry 27 `vellum2-spk-display`** — change `replace_string` from the current
`<span style="color:{{switch::…letter…}}">` to a class + data-attribute span:

```
find_regex (unchanged, already strengthened):
\[\s*spk\s*=\s*["']?\s*([^"'\]\r\n]{1,40}?)\s*["']?\s*\]([\s\S]*?)(?:\[\s*/\s*spk\s*\]|(?=\[\s*spk\b)|$)

replace_string (new):
<span class="v-spk" data-spk="$1">$2</span>
```

- `substitute_macros: none` (no macros needed anymore — simpler and faster).
- Keep `flags: gi`, `placement: ai_output`, `target: display`.
- Do **not** inline any color here. Color is 100% the extension's job so it can be
  user-driven and live-updated. If the extension is absent/disabled, spans simply
  inherit normal text color (graceful, not broken).

**Entry 28 `vellum2-spk-strip`** — unchanged. It already removes `[spk=…]` /`[/spk]`
from the model-facing context so tags never pollute prompt or chronicle.

> Migration note for the README: the preset no longer colors dialogue by itself.
> With the extension installed, colors come from cast cards. Without it, dialogue is
> wrapped but uncolored (inherits text color). This is intentional.

---

## Phase 2 — Extension: deterministic dialogue-color map (pure module)

**New file:** `src/domain/dialogue-colors.ts`

```ts
import { autoHue } from '../core/palette.js';

export interface SpeakerColor { name: string; aka: string[]; color: string; }

/** Build the speaker→color list from cast. Uses the card's chosen `color`,
 *  else the deterministic slot hue (same as the name in the panel). */
export function buildSpeakerColors(
  cast: Record<string, { id: string; name: string; aka?: string[]; color?: string }>,
): SpeakerColor[] {
  const out: SpeakerColor[] = [];
  for (const c of Object.values(cast)) {
    if (!c?.name) continue;
    const color = (c.color && /^#[0-9a-f]{3,8}$/i.test(c.color)) ? c.color : autoHue(c.id);
    out.push({ name: c.name, aka: (c.aka ?? []).filter(Boolean), color });
  }
  return out;
}

/** Emit the stylesheet. Matches on data-spk by name AND every alias, so
 *  "Mad King" and "Elara" both color if the model tags either. */
export function speakerColorCss(speakers: SpeakerColor[], fallback = 'inherit'): string {
  const esc = (s: string) => s.replace(/["\\]/g, '\\$&'); // CSS attr-selector safe
  const rules: string[] = [`.v-spk{color:var(--vle-spk-default,${fallback})}`];
  for (const s of speakers) {
    const keys = [s.name, ...s.aka];
    for (const k of keys) {
      rules.push(`.v-spk[data-spk="${esc(k)}" i]{color:${s.color}}`);
    }
  }
  return rules.join('\n');
}
```

- `[data-spk="…" i]` — the `i` flag makes matching **case-insensitive**, covering the
  common "elara" vs "Elara" drift that broke exact-match `{{switch}}` before.
- Pure and unit-testable. No DOM, no host calls.

---

## Phase 3 — Extension: inject + live-update the stylesheet

**File:** `src/ui/app.ts`

1. Hold a dedicated style handle (separate from the main stylesheet at line 732)
   and a signature to skip redundant rewrites:

```ts
let _spkStyle: { remove(): void } | null = null;
let _spkSig = '';
```

2. Add an updater, called whenever cast/colors may have changed:

```ts
function updateDialogueColors(cast: Record<string, any> | undefined): void {
  if (!cast) return;
  const speakers = buildSpeakerColors(cast);
  const css = speakerColorCss(speakers);
  const sig = css.length + ':' + speakers.length; // cheap change key
  if (sig === _spkSig) return;                     // no-op if unchanged
  _spkSig = sig;
  try { _spkStyle?.remove(); } catch { /* ignore */ }
  _spkStyle = ctx.dom.addStyle(css);
}
```

3. Call it from the existing `vellum_state` handler (`app.ts:1031`), where `s.cast`
   already arrives every turn — so a newly-introduced character or an edited color is
   reflected on the next state broadcast:

```ts
} else if (p?.type === 'vellum_state') {
  // …existing handling…
  updateDialogueColors(p?.cast ?? p?.state?.cast);
}
```

4. Also call once after initial mount (first `vellum_state`) so existing chats color
   immediately. No separate backlog pass is needed — CSS applies to all `.v-spk`
   spans already in the DOM the instant the stylesheet is added, **and** to every
   future turn, because the preset regex keeps producing `.v-spk` spans. This is the
   crux of the fix.

5. Teardown: `_spkStyle?.remove()` in the extension's cleanup path (near the existing
   `ctx.dom.cleanup()` at `app.ts:1326`).

---

## Phase 4 — Optional: a real color picker on the cast card

The edit form already has a **Name color** row (`cast.ts:175`). Two options:

- **A (recommended, zero new UI):** reuse `color` for both name and dialogue. One
  color per character, matches the panel. Ship this first.
- **B (later, if requested):** add a separate `dialogueColor` field + form row and a
  `buildSpeakerColors` preference for it over `color`. Only worth it if users ask to
  decouple name color from speech color. Not in scope for the first cut.

This plan implements **A**.

---

## Phase 5 — Tests

**New file:** `test/dialogue-colors.test.ts`

- `buildSpeakerColors`: uses card `color` when valid hex; falls back to `autoHue(id)`
  when missing/invalid; includes aliases.
- `speakerColorCss`: emits one rule per name + per alias; includes the `.v-spk`
  fallback; escapes quotes/backslashes in names; applies the `i` (case-insensitive)
  flag.
- Regex behavior (guard against regressions): the Phase-1 `find_regex` still wraps
  canonical, spaced, quoted, missing-close, and multiline tag forms (reuse the cases
  already proven in the earlier regex analysis), and the new replace produces
  `<span class="v-spk" data-spk="NAME">…</span>`.

---

## Phase 6 — Docs

- README "What's New": dialogue coloring now driven by cast-card colors (with the
  extension) and gracefully uncolored without it.
- Onboarding guide: one line under the Cast slide — "the character's color also tints
  their spoken dialogue in chat."

---

## Build / verify checklist

- [ ] `npm run build` emits both bundles
- [ ] `npm run typecheck` clean
- [ ] `npm test` green (new dialogue-colors tests + existing suite)
- [ ] Both regex files (`vellum-ii-regex.json` + embedded `vellum-ii.json`) updated
      and all entries compile
- [ ] Manual: play a NEW turn after install → dialogue colors (the exact case that
      failed before)

---

## Honest feasibility statement (read before building)

**What this reliably delivers:** stable, user-chosen, case-insensitive per-character
dialogue colors that apply to **both** backlog and newly generated turns, with no DOM
racing — because coloring rides the host render pipeline (preset regex) + CSS, never
extension DOM injection. This directly fixes the observed failure.

**The hard ceiling that remains (unchanged, unfixable here):** coloring only happens
on dialogue the **model actually tagged** with `[spk=Name]`. The preset instructs it
to, and strong models comply on most lines; weaker/reasoning models will occasionally
drop a tag and that line simply stays uncolored (graceful degradation, not breakage).
Regex/CSS cannot attribute untagged literary prose — that is a coreference problem, not
a styling one. So this is **"colors tagged dialogue reliably,"** not **"colors every
line on every model."** No recent Lumiverse staging commit changes this.

**Recommendation:** worth building now. The failure you hit was the fixable
rendering-lifecycle half, and this architecture removes that failure by construction.
Set expectations at "reliable for tagged dialogue," not "universal."
