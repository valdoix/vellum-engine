# VELLUM Engine — Lumiverse Spindle Capability Upgrade

Implementation plan for adopting six new Lumiverse spindle capabilities in `vellum-engine`
(v2.0.0-beta.1). All work is **additive and opt-in**: every new call is capability-gated, and
absence of a permission or host API must degrade to today's behavior with no regression.

**Guiding rules for the implementer**
- Never remove an existing fallback. New host APIs are probed, cached, and gated exactly like
  `has('generation')` in `src/host/capability.ts`.
- Preserve the interceptor hot-path deadline discipline (`INTERCEPTOR_DEADLINE_MS = 5000`,
  `backend.ts:1005`). No new blocking calls on that path without a bounded timeout.
- Match the existing style: typed `Result` returns (`src/core/result.js`), lazy cached probes,
  visible-reason degradation over silent catches.
- After each item: `npm run build` (or the project's tsc/bundle step) and confirm `dist/backend.js`
  and `dist/frontend.js` still emit. Add/extend tests where a test harness exists.

Order below is by ROI/risk. Items 1–2 are backend-only and highest value. Items 3–5 are UI/context.
Item 6 is the most speculative.

---

## Item 1 — `generation_parameters` permission + enforced structured output (HIGH / LOW RISK)

### Problem
`internalGenerate` passes `response_format: EXTRACT_SCHEMA` best-effort, but the host **silently
strips** it without the `generation_parameters` permission (`src/host/generation.ts:66-68`;
`src/bus/extract.ts:261-264`). So the extractor's JSON schema is never actually enforced — we rely
entirely on defensive parsing (`parseJson`, `extract.ts:46-52`). Granting the permission lets the
host enforce `json_schema`, cutting malformed-JSON extraction failures.

### Changes

**1a. Manifest** — `spindle.json:9`
```jsonc
"permissions": ["interceptor", "chats", "chat_mutation", "generation",
  "generation_parameters", "ui_panels", "world_books", "memories", "presets"]
```
(`presets` is for Items 2–3; add both now so there is one permission-prompt change.)

**1b. Capability type** — `src/host/capability.ts:10`
```ts
export type Capability =
  | 'generation' | 'generation_parameters' | 'world_books' | 'memories'
  | 'chats' | 'chat_mutation' | 'interceptor' | 'presets';
```
Add `'generation_parameters'` and `'presets'` to the `has()` fallback probe list at
`capability.ts:23`.

**1c. Gate the response_format on the permission** — `src/host/generation.ts`
`internalGenerate` currently always attaches `response_format` when `opts.responseFormat` is set.
Make it conditional so we only send it when the host will honor it, and keep defensive parsing as
the fallback path:
```ts
const wantSchema = !!opts?.responseFormat && (await has('generation_parameters'));
const params2 = wantSchema
  ? { ...(params || {}), response_format: opts!.responseFormat }
  : (params || {});
```
Update the comment block at lines 61-68 to state the schema is now **enforced** when granted,
best-effort otherwise. Do the same conditional in any other caller that sets a response format.

**1d. Interceptor parameter injection (the second half of this capability).**
The host accepts an `InterceptorResultDTO` that can carry a `parameters` object merged into the
outgoing request with precedence `preset < interceptor < request`. Extend the interceptor return at
`src/backend.ts:1093-1094` to optionally inject generation parameters (e.g. nudging `temperature`
or attaching a `response_format` for the *user-facing* turn so the `<vellum>` state block stays
parseable). Gate strictly on `generation_parameters`:
```ts
const result: any = { messages: [head, ...out],
  breakdown: [{ messageIndex: 0, name: 'VELLUM Recall' }] };
if (await has('generation_parameters')) {
  const injected = buildParamInjection(chatId, state); // returns {} when nothing to inject
  if (injected && Object.keys(injected).length) result.parameters = injected;
}
return result;
```
Keep `buildParamInjection` conservative and opt-in per chat (read a `vellum_param_injection` chat
var, default off) so it never surprises users. When the permission is absent, the return shape is
byte-for-byte identical to today.

### Verify
- Build passes.
- With permission denied: extraction still runs, still parses defensively (unchanged behavior).
- With permission granted: confirm host no longer strips `response_format` (log the request or
  inspect a turn). Malformed-JSON extraction rate should drop.
- Interceptor return without `parameters` key when injection disabled/ungranted.

---

## Item 2 — Companion-preset metadata passthrough (HIGH / LOW RISK)

### Problem
The companion preset `vellum-ii.json` and the extension have **no handshake**. Today VELLUM is
detected only by parsing a `<vellum>` block out of prose. With the `presets` permission we can stamp
structured metadata onto the active/companion preset so the two halves recognize each other and
share version/config without prose sniffing.

### Changes

**2a.** Reuse the `presets` permission added in 1a.

**2b.** Add a small host wrapper — new file `src/host/presets.ts` (mirror `generation.ts` shape):
```ts
declare const spindle: any;
import { has } from './capability.js';
import { type Result, Ok, Err, tryCatchAsync } from '../core/result.js';

export async function stampPresetMetadata(
  presetId: string, meta: Record<string, unknown>, userId: string | null,
): Promise<Result<void, string>> {
  if (!(await has('presets'))) return Err('no_presets_permission');
  if (!spindle.presets?.updateMetadata && !spindle.presets?.update) return Err('no_presets_api');
  return tryCatchAsync(async () => {
    // Prefer a metadata-only merge API if the host exposes one; else read-modify-write
    // the preset's metadata object WITHOUT touching prompt content.
    if (spindle.presets.updateMetadata) {
      await spindle.presets.updateMetadata(presetId, { vellum_engine: meta }, userId);
    } else {
      const p = await spindle.presets.get(presetId, userId);
      const metadata = { ...(p?.metadata ?? {}), vellum_engine: meta };
      await spindle.presets.update(presetId, { metadata }, userId);
    }
  });
}
```
Key constraint from the analysis: **attach metadata without marshalling prompt content back out** —
never round-trip the preset's prompt fields. If only a full `update` exists, send just the
`metadata` field and rely on the host to merge, or read-modify-write the metadata object alone.

**2c.** Stamp on activation. Where the extension detects/activates the companion preset (find the
current `<vellum>`-block detection path), after successful detection call `stampPresetMetadata`
with e.g. `{ version: '2.0.0-beta.1', identifier: 'vellum_engine', linkedAt: Date.now() }`.
Idempotent: skip the write if the stamped version already matches.

**2d.** Detection upgrade (optional, additive): where presets are read, prefer
`metadata.vellum_engine` when present and fall back to prose sniffing when absent. Do not remove the
prose path — older presets won't carry metadata.

### Verify
- Build passes.
- Permission denied: stamping is a no-op, prose detection unchanged.
- Permission granted: after one turn the companion preset carries `metadata.vellum_engine`;
  confirm prompt/prompt-order fields are untouched (diff the preset before/after).

---

## Item 3 — Preset Editor tab (`registerPresetEditorTab`) (MEDIUM / MEDIUM RISK)

### Problem
VELLUM config lives only in the extension drawer/float window. A Preset Editor tab surfaces the
VELLUM panel where users author the companion preset, using
`ctx.ui.presetEditor.updatePreset(...)` to write config through the editor.

### Changes

**3a.** Reuse `presets` + `ui_panels` permissions.

**3b.** Registration — in the frontend entry (`src/ui/app.ts`, near the existing drawer-tab / float
registration). Probe for the API first; register only when present and permission granted:
```ts
if (spindle.ui?.registerPresetEditorTab && await hasFront('presets')) {
  spindle.ui.registerPresetEditorTab({
    id: 'vellum_engine',
    label: 'VELLUM',
    icon: '\u2756',
    render: (ctx: any, mount: HTMLElement) => renderPresetEditorPanel(ctx, mount),
  });
}
```
(`hasFront` = the frontend-side permission check; if the frontend has no `has()` helper, gate on
API presence plus a message round-trip to the backend `has('presets')`.)

**3c.** `renderPresetEditorPanel(ctx, mount)` — a **compact** panel (editor tabs are narrow). Reuse
`formModal`/existing render helpers where possible. Writes go through
`ctx.ui.presetEditor.updatePreset(patch)` — patch only VELLUM-owned fields; never clobber unrelated
preset content. Read current values from `ctx.preset` (or equivalent) to pre-fill.

**3d.** Keep the drawer/float UI as-is. This is an additional surface, not a replacement.

### Verify
- Build passes; `dist/frontend.js` emits.
- Host without `registerPresetEditorTab`: nothing registers, no errors (older Lumiverse).
- In editor: tab appears, edits persist via `updatePreset`, unrelated preset fields unchanged.

---

## Item 4 — Migrate confirms to host `showConfirm` / `showModal` (LOW / LOW RISK)

### Problem
`src/ui/modal.ts` hand-rolls overlays (`formModal`, `confirmModal`) with a manual focus trap
(`makeFocusTrap`, `modal.ts:37-47`). The host now offers `ctx.ui.showModal` / `ctx.ui.showConfirm`
(no permission required), which are visually consistent with Lumiverse and get a11y for free.

### Changes

**4a.** Wrap, don't rip out. In `src/ui/modal.ts`, make `confirmModal` prefer the host API and fall
back to the existing DOM implementation:
```ts
export function confirmModal(message: string, onConfirm: () => void): void {
  const s: any = (globalThis as any).spindle;
  if (s?.ui?.showConfirm) {
    Promise.resolve(s.ui.showConfirm({ message, title: 'Confirm' }))
      .then((ok: boolean) => { if (ok) onConfirm(); })
      .catch(() => confirmModalDom(message, onConfirm)); // fall back on API error
    return;
  }
  confirmModalDom(message, onConfirm);
}
```
Rename the current body to `confirmModalDom` (unchanged code). All existing call sites keep calling
`confirmModal` — zero call-site churn.

**4b.** Leave `formModal` on the DOM implementation for now (it has rich custom field types:
`checks`, `color`, `section`, footer actions). Only migrate simple text/confirm dialogs. If the host
`showModal` supports comparable fields, a later pass can migrate `formModal`; do **not** attempt it
in this item.

### Verify
- Build passes.
- Host with `showConfirm`: destructive confirms use the native dialog.
- Host without it: identical behavior to today (DOM overlay + focus trap).

---

## Item 5 — Sharpen `sceneQuery(out)` with interceptor context flags (MEDIUM / LOW RISK)

### Problem
`sceneQuery(out)` (`backend.ts:1059`) derives the retrieval query from the raw messages array,
without distinguishing chat history from injected world-info. The host now tags messages with
`__isChatHistory`, `__isWorldInfoEntry`, and provides `context.activatedWorldInfo`. Using these
lets `sceneQuery` weight the *actual* latest user/char turns and avoid polluting the query with
world-info boilerplate.

### Changes

**5a.** No new permission (part of the existing `interceptor` context payload).

**5b.** Locate `sceneQuery` (find its definition; called at `backend.ts:1059`). Add an optional
second argument carrying the flags, defaulting to today's behavior when they're absent:
```ts
function sceneQuery(messages: any[], ctx?: {
  activatedWorldInfo?: any[];
}): string {
  const history = messages.filter(m => m?.__isChatHistory !== false && !m?.__isWorldInfoEntry);
  const base = messages; // existing derivation, unchanged
  const source = history.length ? history : base; // fall back if flags absent
  // ... existing query construction over `source` ...
}
```
Only prefer the filtered `history` when the flags actually appear on messages; if no message carries
`__isChatHistory`/`__isWorldInfoEntry` (older host), `source === base` and behavior is identical.

**5c.** At the call site (`backend.ts:1059`), pass context:
```ts
sceneQuery(out, { activatedWorldInfo: context?.activatedWorldInfo })
```
Optionally fold `activatedWorldInfo` entries into the query as low-weight hints. Keep it additive.

### Verify
- Build passes.
- Older host (no flags): query string identical to today for a fixed messages array (add a unit test
  asserting this if a test harness exists).
- Newer host: world-info entries excluded from the primary query; retrieval relevance improves on a
  chat with heavy world-info.

---

## Item 6 — Interceptor "halt generation momentarily" (LOW / HIGHER RISK)

### Problem
The interceptor is synchronous on the prompt hot path with a hard 5s self-deadline
(`INTERCEPTOR_DEADLINE_MS`, `backend.ts:1005`). The new capability lets an interceptor **halt
generation momentarily** — e.g. to finish a critical precompute/warm before the turn proceeds. This
is powerful but risks user-perceived stalls, so it must be strictly opt-in and tightly bounded.

### Changes

**6a.** No new permission (interceptor capability), but treat as experimental.

**6b.** Gate behind a per-chat opt-in var (`vellum_halt_on_warm`, default off) AND a short cap far
below the host budget (e.g. 1500ms), independent of `INTERCEPTOR_DEADLINE_MS`. Only halt for a
concrete, bounded reason — e.g. a first-turn cold-cache warm that materially improves the very next
injection. Use the host's documented halt/resume mechanism from the interceptor result/context
(confirm the exact API in the generation docs before wiring).

**6c.** Always resume. Wrap the halt in the same `withTimeout` discipline
(`src/host/generation.ts:42`) so a stalled warm can never wedge the turn — on timeout, resume
immediately and ship messages as-is (identical to today's catch at `backend.ts:1098-1102`).

**6d.** Telemetry: log each halt with duration via `spindle.log?.info?.` so stalls are visible.

### Verify
- Build passes.
- Opt-in off (default): no halt ever; behavior identical to today.
- Opt-in on: halt occurs only on the intended condition, always resumes within the cap, and a forced
  slow warm still resumes at the timeout (no hang).

**Recommendation:** ship Items 1–5 first; land Item 6 last, behind its opt-in, after real-world
latency testing. If halt semantics in the docs are ambiguous, defer 6 rather than risk hot-path
stalls.

---

## Cross-cutting checklist
- [ ] `spindle.json` permissions updated once (Item 1a) — `generation_parameters`, `presets`.
- [ ] `Capability` type + `has()` fallback list extended (Item 1b).
- [ ] Every new host call probed + cached + gated; degrades with a visible reason.
- [ ] No existing fallback removed; behavior byte-identical when permissions/APIs absent.
- [ ] Interceptor hot path keeps its bounded deadlines; no unbounded new awaits.
- [ ] `invalidatePermissions()` (`capability.ts:33`) still clears the cache on `PERMISSION_CHANGED`
      so newly granted `generation_parameters`/`presets` wire in without reload.
- [ ] `npm run build`; both `dist/backend.js` and `dist/frontend.js` emit.
- [ ] `minimum_lumiverse_version` — bump only if any adopted API is hard-required; since all are
      probed/optional, it can stay `1.0.0`.

## Key source references
- `spindle.json:9` — permissions array (target for 1a).
- `src/host/capability.ts:10,23,33` — `Capability` type, `has()` fallback list, cache invalidation.
- `src/host/generation.ts:66-68,80` — best-effort `response_format`, request assembly (Item 1c).
- `src/bus/extract.ts:248-259,261-264` — extractor call + `EXTRACT_SCHEMA` best-effort note.
- `src/backend.ts:1005,1015,1059,1093-1094,1098-1102` — deadline, interceptor fn, `sceneQuery` call,
  return shape, timeout catch (Items 1d, 5, 6).
- `src/ui/modal.ts:49,135` — `formModal`, `confirmModal` (Item 4).
- `src/ui/app.ts` — frontend registration surface (Item 3).
