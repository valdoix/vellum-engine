# Custom Google Font URL — Implementation Plan

Let users paste a **Google Fonts URL** in the extension's Customize → **Type** tab to
drive the display (serif) and/or data (mono) font, beyond the fixed `FONT_CHOICES`
whitelist. This is a **presentation-only** change scoped to the VELLUM extension's own
theme engine (`src/ui/theme.ts`). It does **not** touch Lumiverse host themes or
`lumithemes/` (that folder is Lumiverse's own theme packs and is subject to the host
CSS sanitizer — a different subsystem, out of scope here).

---

## Why this is small

The extension already loads Google Fonts at runtime and applies them:

- `loadGoogleFontByName` (theme.ts:405) injects a `<link rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=…">` into `document.head` and dedups
  via `_loadedFonts` (theme.ts:382).
- `applyTheme` writes the chosen stack to `--vserif` / `--vmono` (theme.ts:450-451).
- This already ships for whitelisted picker fonts (Playfair, Crimson Text, Lora, Fira
  Code, IBM Plex Mono) and the Gatsby/Sumi chrome loaders (theme.ts:383-402).

The only limitation: `loadGoogleFontByName` resolves through a **hardcoded name→URL
map** (theme.ts:406-414), so arbitrary families never render. This plan generalizes
that into a **URL-driven loader** plus one persisted field, reusing the in-panel
texture-URL input pattern (`data-cz-textureurl`, theme.ts:647/691) as precedent.

---

## Design decisions

**D1 — Allowlist the host, hard.** Accept only URLs matching
`^https://fonts\.googleapis\.com/` (the CSS endpoint). Reject arbitrary `https://` and
all `data:` URLs, even though `texture` is more permissive. Injecting an arbitrary
remote stylesheet is a CSS-exfiltration/injection vector; the font endpoint is the
only thing we need. `fonts.gstatic.com` (the actual font binaries) is pulled
transitively by the Google CSS and needs no separate handling — it's already reachable
today for Gatsby/Sumi.

**D2 — Parse the family from the URL; no separate name field.** A Google Fonts URL
carries the family: `…/css2?family=Playfair+Display:wght@400;700` → `Playfair
Display`. Read the `family=` param, take the first family, `decodeURIComponent`,
replace `+`→space, strip the `:ital,wght@…` axis suffix at the first `:`. One input is
enough for the user.

**D3 — Persist the URL, re-inject every session.** Bundled fonts (`fonts.ts`
`FONT_FACES`, base64) are added once and are always present. A user URL font is NOT
bundled, so it must be re-added to `document.head` on every load. Add optional
`serifUrl` / `monoUrl` to `Theme` and re-inject from `applyTheme`.

**D4 — Reuse, don't duplicate, the loader.** Factor the `<link>` injection +
`_loadedFonts` dedup out of `loadGoogleFontByName` into a private
`injectFontLink(url)`, and have both `loadGoogleFontByName` and the new
`loadGoogleFontByUrl` call it. Keeps one code path for CSP behavior.

**D5 — Stack references the parsed family.** When a URL is set, patch
`serif`/`mono` to `'<ParsedFamily>',Georgia,serif` (mono → `,Consolas,monospace`) so
the CSS var actually points at the loaded family. `safeFont` (theme.ts:343) already
sanitizes the resulting stack; the parsed family is additionally stripped of quotes.

**D6 — Silent, graceful fallback.** If the CDN is blocked/offline the font simply
falls back to `,Georgia,serif`. No load callback exists today; we won't add one. The
UI carries a short note instead.

---

## Part A — Types & sanitize (theme.ts)

**A1.** Extend the `Theme` interface (theme.ts:17-50):
```ts
serifUrl?: string; // '' | validated https://fonts.googleapis.com/... ; re-injected each load
monoUrl?: string;
```
Both optional so existing saved themes and `DEFAULT` (theme.ts:323) stay valid.

**A2.** Add a validator near `safeFont`/`safeTexture` (theme.ts:343-350):
```ts
function safeFontUrl(u: string): string {
  const s = String(u || '').trim();
  return /^https:\/\/fonts\.googleapis\.com\/[^\s"'<>]+$/i.test(s) ? s : '';
}
function familyFromFontUrl(u: string): string {
  const m = /[?&]family=([^&]+)/.exec(u); if (!m) return '';
  const raw = decodeURIComponent(m[1]!.split(':')[0]!).replace(/\+/g, ' ').trim();
  return raw.replace(/["<>{}]/g, '').slice(0, 80);
}
```

**A3.** In `sanitize` (theme.ts:362-378) add:
```ts
serifUrl: safeFontUrl(t.serifUrl ?? ''),
monoUrl: safeFontUrl(t.monoUrl ?? ''),
```
So a tampered/import URL that isn't a Google Fonts URL is dropped to `''`.

---

## Part B — Loader (theme.ts)

**B1.** Refactor injection out of `loadGoogleFontByName` (theme.ts:405-434):
```ts
function injectFontLink(url: string, dedupKey: string): void {
  if (!url || _loadedFonts.has(dedupKey)) return;
  if (document.querySelector(`link[href="${url}"]`)) { _loadedFonts.add(dedupKey); return; }
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = url;
  document.head.appendChild(link);
  _loadedFonts.add(dedupKey);
}
```
Rewrite `loadGoogleFontByName` to call `injectFontLink(mappedUrl, fontName)`.

**B2.** New public-ish sibling:
```ts
function loadGoogleFontByUrl(url: string): void {
  const safe = safeFontUrl(url); if (!safe) return;
  injectFontLink(safe, 'url:' + safe);
}
```

**B3.** In `applyTheme` (theme.ts:438-496), after the existing
`loadGoogleFontsForChrome(t.chrome)` (theme.ts:483):
```ts
if (t.serifUrl) loadGoogleFontByUrl(t.serifUrl);
if (t.monoUrl) loadGoogleFontByUrl(t.monoUrl);
```
This is what makes a user URL font survive reload.

---

## Part C — Type tab UI (theme.ts)

**C1.** In the `tab === 'type'` body (theme.ts:631-637), after the Display font
`<select>`, add a URL row (mirrors the texture-URL field at theme.ts:647):
```
<div class="vle-cz-h">Display font URL <span class="vle-cz-rst" data-cz-reset="serifUrl">↺</span></div>
<div class="vle-cz-row"><input type="text" class="vle-cz-hex" data-cz-fonturl
  placeholder="https://fonts.googleapis.com/css2?family=…" value="${t.serifUrl || ''}"></div>
```
And a matching `data-cz-monourl` row under Data font.

**C2.** Add a note reusing `.vle-cz-note`:
> Paste a Google Fonts URL (fonts.google.com → Get font → "@import" or the CSS link).
> Loads from Google's servers when set; leave blank to use the picker above. Only
> `fonts.googleapis.com` links are accepted.

**C3.** The Display/Data `<select>` (theme.ts:632-635) keeps working; when a URL is
present it visually wins because `serif`/`mono` point at the parsed family. Optionally
prepend a disabled "— using custom URL —" option when `t.serifUrl` is set (cosmetic;
can defer).

---

## Part D — Wiring (theme.ts `wireCustomize`)

**D1.** In the `change`/`input` handlers (theme.ts:684-715), add — modeled on the
texture-url handler (theme.ts:691). Use `input` so it's live:
```ts
else if (el.matches('[data-cz-fonturl]')) {
  const safe = safeFontUrl(el.value.trim());
  if (el.value.trim() === '' ) { patchTheme({ serifUrl: '', serif: F_SERIF }); reapply(); }
  else if (safe) {
    const fam = familyFromFontUrl(safe);
    loadGoogleFontByUrl(safe);
    patchTheme({ serifUrl: safe, ...(fam ? { serif: `'${fam}',Georgia,serif` } : {}) });
    reapply();
  }
}
else if (el.matches('[data-cz-monourl]')) { /* same, mono → `'${fam}',Consolas,monospace`, empty resets to F_MONO */ }
```

**D2.** The generic reset handler (theme.ts:721) already resets any key from `DEFAULT`
via `data-cz-reset`. With `DEFAULT.serifUrl`/`monoUrl` implicitly `undefined`,
`sanitize` normalizes to `''`. Confirm the `↺` also restores `serif` to the picker
value — if not, handle `serifUrl`/`monoUrl` explicitly in the click handler to also
reset the stack (`patchTheme({serifUrl:'', serif:F_SERIF})`).

---

## Part E — Tests (test/theme.test.ts)

Runs in node, no DOM (theme.ts localStorage is try/catch-guarded), so test the **pure**
pieces — not the DOM injection.

**E1.** Add `safeFontUrl` / `familyFromFontUrl` to exports and assert:
- accepts `https://fonts.googleapis.com/css2?family=Lora:wght@400;700`
- rejects `https://evil.example/x.css`, `http://fonts.googleapis.com/…` (not https),
  `data:text/css,...`, and `javascript:` → all return `''`.
- `familyFromFontUrl` returns `Playfair Display` for
  `…family=Playfair+Display:ital,wght@0,400;1,700`.

**E2.** `patchTheme({serifUrl:'https://fonts.googleapis.com/…', serif:"'Lora',serif"})`
then `getTheme()` keeps the URL; `patchTheme({serifUrl:'javascript:alert(1)'})` →
sanitize drops it to `''`.

**E3.** `hydrateTheme(JSON.stringify({accent:'#fff', serifUrl:'https://evil/x'}))`
does not persist the bad URL (sanitize clears it).

**E4.** Add `serifUrl`/`monoUrl` to the `THEME_KEYS` set (theme.test.ts:12-17) so the
"MODES patch only sets known keys" guard stays green (MODES don't set them, but keep
the set complete).

**E5.** `customizePanel('type')` output contains `data-cz-fonturl` and
`data-cz-monourl`.

**E6.** `bun run typecheck`, `bun run test`, `bun run build` all green. Manual: live
Lumiverse — paste a Fonts URL, confirm the panel restyles and survives a reload.

---

## Part F — README updates

The README currently (a) points font customization at `lumithemes/CUSTOMIZING.md`,
which is host-theme guidance, and (b) states the extension "makes no outside calls of
its own" — which the new feature (and the existing Gatsby/Sumi loaders) contradict.
Update both, honestly.

**F1.** Customize tool line (README.md:409):
> - **Customize** — theme the panel: colors, fonts (including a **custom Google Fonts
>   URL**), size, skins.

**F2.** Add a short subsection under the extension's customize/panel docs (near
README.md:407-421) documenting the Type tab font URL: what to paste, that only
`fonts.googleapis.com` links are accepted, and that it loads from Google when set.
Keep it distinct from the `lumithemes/CUSTOMIZING.md` guidance (which is for Lumiverse
host themes, not the extension panel).

**F3.** Correct the outbound-calls claim (README.md:454). Change:
> Everything runs inside your Lumiverse instance; the extension makes no outside calls
> of its own.

to something accurate, e.g.:
> Everything runs inside your Lumiverse instance. The only optional outside request is
> loading a **web font** — the Gatsby and Sumi looks, and any Google Fonts URL you
> paste in Customize → Type, fetch from Google's font CDN. Leave those unset and the
> extension makes no outside calls at all.

**F4.** Also soften the two other "nothing leaves your instance" phrasings if present
in the install/permissions sections (README.md:132) so the doc is internally
consistent — scope the promise to *your data/code*, not web fonts.

**F5.** (Optional) In the "What's New" section, add a one-line note that Customize →
Type now accepts a Google Fonts URL.

---

## Files touched

- `src/ui/theme.ts` — `Theme` fields (`serifUrl`/`monoUrl`); `safeFontUrl` +
  `familyFromFontUrl`; sanitize additions; `injectFontLink` refactor +
  `loadGoogleFontByUrl`; `applyTheme` re-injection; Type-tab inputs + note;
  `wireCustomize` handlers; export the two pure helpers for tests.
- `test/theme.test.ts` — new URL/family/sanitize assertions; `THEME_KEYS` update;
  `customizePanel('type')` assertion.
- `README.md` — Customize line, new font-URL note, corrected outbound-calls claim,
  consistency fixes.

## Out of scope

- Lumiverse host themes / `lumithemes/` (host CSS sanitizer subsystem — unchanged).
- Non-Google font CDNs, arbitrary stylesheet URLs, `data:` fonts.
- Font-load success/failure UI (no callback today; silent fallback retained).
- Uploading local font files as extension assets (host has its own asset flow; the
  extension bundles fonts in `fonts.ts` at build time).

## Honest risks

- **CSP dependency.** Works because the extension already loads Google-hosted chromes;
  a future host CSP tightening would break the URL box *and* the existing Gatsby/Sumi
  loads together. Not introduced by this change, but newly user-facing.
- **Privacy.** A set URL leaks IP/referer to Google's CDN each session. Mitigated by
  making it opt-in, blank by default, allowlisted to one host, and documented in both
  the UI note and README.
- **Family-parse edge cases.** Multi-family URLs (`family=A&family=B`) or unusual axis
  syntax — we take the first family and strip at `:`; good enough for the picker use
  case, and a wrong family name just falls back to Georgia.
