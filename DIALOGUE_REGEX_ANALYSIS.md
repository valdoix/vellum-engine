# Dialogue Color Regex — Analysis & Strengthening

## Current Pattern (vellum-ii-regex.json script 27)

```regex
\[spk=([^\]]{0,40})\]([\s\S]*?)\[/spk\]
```

**Flags:** `gi`  
**Placement:** `ai_output` / `display`  
**Substitute macros:** `after`

### What it matches

- `[spk=Name]"Hello"[/spk]` ✅
- `[spk=Alice]"Multi\nline"[/spk]` ✅
- `[spk=Bob (nervous)]"text"[/spk]` ✅ (up to 40 chars)

### What it misses or breaks

1. **Whitespace variations:**
   - `[spk= Name ]` (spaces around name) — ❌ captures ` Name ` with spaces
   - `[ spk=Name]` (space before spk) — ❌ no match
   - `[spk =Name]` (space before =) — ❌ no match

2. **Case variations:**
   - Flags include `i`, so `[SPK=Name]` or `[Spk=Name]` DO match ✅

3. **Missing equals:**
   - `[spkName]` — ❌ no match (correct — this is malformed)

4. **Empty name:**
   - `[spk=]"text"[/spk]` — ✅ matches (name capture is empty string)

5. **Nested tags:**
   - `[spk=A]"Hello [spk=B]nested[/spk]"[/spk]` — ⚠️ lazy `*?` stops at first `[/spk]`, so outer tag closes early. This is a pathological case — the preset's instruction never nests tags.

6. **Unclosed tags:**
   - `[spk=Name]"text` (no closing) — ❌ no match (correct — incomplete)

7. **Model typos:**
   - `[speak=Name]` — ❌ (different tag)
   - `[spk=Name"text"[/spk]` (missing `]`) — ❌ (malformed)
   - `[spk=Name]text[spk/]` (wrong close) — ❌ (malformed close)

8. **Long names:**
   - `[spk=A very long character name that exceeds forty characters here]` — ⚠️ `{0,40}` caps at 40, so if the name is 50 chars the match fails entirely (not truncated — the whole pattern fails because `]` is at position 51+).

### Root cause of model failures

The pattern is **syntactically strict** — it requires:
- Exact `[spk=` opening (case-insensitive due to `i` flag)
- A closing `]` within 40 chars of the `=`
- A closing `[/spk]`

If a model:
- Adds whitespace: `[ spk=Name]` or `[spk= Name ]`
- Omits the closing bracket: `[spk=Name"text"[/spk]`
- Uses a variant tag: `[speaker=Name]` or `[say=Name]`
- Exceeds 40 chars in the name slot

...the entire match fails and the dialogue stays uncolored.

---

## Strengthened Pattern (Option A — Flexible Whitespace, Longer Names)

```regex
\[\s*spk\s*=\s*([^\]]{0,80}?)\s*\]([\s\S]*?)\[/spk\]
```

**Changes:**
- `\[\s*` — allows leading whitespace inside the bracket
- `spk\s*=\s*` — allows whitespace around the `=`
- `([^\]]{0,80}?)` — bumps name cap to 80 chars, uses lazy `?` to stop at first `]`
- `\s*\]` — allows trailing whitespace before the closing bracket

**Now matches:**
- `[ spk = Name ]"text"[/spk]` ✅
- `[spk=A character with a very long name including (parenthetical notes)]"text"[/spk]` ✅ (up to 80)

**Still rejects:**
- `[speaker=Name]` ❌ (different tag — would require alternate union like `(?:spk|speaker)`)
- `[spk=Name"text"[/spk]` ❌ (malformed — missing middle `]`)

---

## Strengthened Pattern (Option B — Alias Support)

If models sometimes emit `[speaker=Name]` or `[say=Name]` instead of `[spk=Name]`, add alternation:

```regex
\[\s*(?:spk|speaker|say)\s*=\s*([^\]]{0,80}?)\s*\]([\s\S]*?)\[/(?:spk|speaker|say)\]
```

**Matches:**
- `[spk=Name]"text"[/spk]` ✅
- `[speaker=Alice]"text"[/speaker]` ✅
- `[say=Bob]"text"[/say]` ✅
- `[ speaker = Name ]"text"[/speaker]` ✅

**Caveat:** the closing tag alternation `\[/(?:spk|speaker|say)\]` allows **mismatched** pairs like `[spk=Name]"text"[/speaker]`. If you need strict pairing, use a backreference (but that's complex and may not be necessary — the preset instruction is consistent).

---

## Strengthened Pattern (Option C — Ultra-Permissive, Any Tag with `=`)

If the goal is "any `[tagname=value]content[/tagname]` structure where the opening tag has an `=`":

```regex
\[\s*(\w+)\s*=\s*([^\]]{0,80}?)\s*\]([\s\S]*?)\[/\1\]
```

**Captures:**
- Group 1: tag name (e.g., `spk`, `speaker`, `say`)
- Group 2: speaker name
- Group 3: dialogue content

**Matches:**
- `[spk=Alice]"text"[/spk]` ✅
- `[speaker=Bob]"text"[/speaker]` ✅
- `[anytag=Value]content[/anytag]` ✅

**Risk:** too permissive — might color non-dialogue tags if the model emits other `[x=y]...[/x]` structures.

---

## Recommended: Option A (Flexible Whitespace + 80-char cap)

**Why:**
- Fixes the most common model slip: whitespace around `=` or inside brackets
- Handles longer character names (80 chars is generous without being pathological)
- Stays faithful to the `spk` convention the preset instructs
- Doesn't risk coloring unrelated tags

**New find_regex:**
```regex
\[\s*spk\s*=\s*([^\]]{0,80}?)\s*\]([\s\S]*?)\[/spk\]
```

**New replace_string (unchanged):**
```
<span style="color:{{switch::{{lower::{{substr::$1::0::1}}}}::a::#e0736b::b::#e0a24e::c::#c9c14e::d::#7ec46b::e::#5bbfa0::f::#5ab0d0::g::#6f9be0::h::#8f88e0::i::#b57fe0::j::#d977c4::k::#d9738f::l::#c98f6b::m::#9ab04e::n::#e0736b::o::#e0a24e::p::#c9c14e::q::#7ec46b::r::#5bbfa0::s::#5ab0d0::t::#6f9be0::u::#8f88e0::v::#b57fe0::w::#d977c4::x::#d9738f::y::#c98f6b::z::#9ab04e::#b9ad92}}" title="$1">$2</span>
```

**Context strip (script 28) also needs update:**
```regex
\[\s*/?\s*spk(?:\s*=\s*[^\]]{0,80})?\s*\]
```

This matches both `[spk=Name]` and `[/spk]` (and whitespace-variant forms) so they're cleanly stripped from the prompt.

---

## Testing the Pattern

### Test cases for the strengthened regex:

| Input | Current | Strengthened | Notes |
|-------|---------|--------------|-------|
| `[spk=Alice]"Hi"[/spk]` | ✅ | ✅ | baseline |
| `[ spk=Alice]"Hi"[/spk]` | ❌ | ✅ | leading space |
| `[spk =Alice]"Hi"[/spk]` | ❌ | ✅ | space before = |
| `[spk= Alice ]"Hi"[/spk]` | ⚠️ (captures ` Alice ` with spaces) | ✅ (trims) | spaces around name |
| `[spk=A character with a very long name (nervous)]"Hi"[/spk]` | ❌ (>40 chars) | ✅ | long name |
| `[SPK=Alice]"Hi"[/SPK]` | ✅ (case-insensitive flag) | ✅ | case variation |
| `[speaker=Alice]"Hi"[/speaker]` | ❌ | ❌ (stays strict to `spk`) | different tag |
| `[spk=Alice"Hi"[/spk]` | ❌ (malformed) | ❌ (correct rejection) | missing `]` |

---

## Implementation Path

1. **Update `presets/vellum-ii-regex.json` script 27 `find_regex`:**
   ```json
   "find_regex": "\\[\\s*spk\\s*=\\s*([^\\]]{0,80}?)\\s*\\]([\\s\\S]*?)\\[/spk\\]"
   ```

2. **Update script 28 (context strip) `find_regex`:**
   ```json
   "find_regex": "\\[\\s*/?\\s*spk(?:\\s*=\\s*[^\\]]{0,80})?\\s*\\]"
   ```

3. **Add test dialogue to a VELLUM chat with whitespace/long-name cases and verify coloring.**

---

## Why This Works Across Models

The root problem isn't that models "don't follow instructions" — it's that **minor whitespace/formatting slip** (which happens under low temp or when the model is uncertain about punctuation) breaks an overly-strict regex. By allowing `\s*` around delimiters and bumping the name cap, we absorb the 95th-percentile slip case without changing the semantic contract (the model still emits `[spk=Name]...[/spk]`, just with a space or a long name).

If a model consistently emits a **different tag** (`[speaker=...]` instead of `[spk=...]`), that's a preset-instruction failure (the Colored Dialogue block explicitly instructs `[spk=Name]`). In that case, Option B (alias union) or a model-specific fix-up script would be needed — but that's a separate issue from whitespace tolerance.

---

**End of Analysis**
