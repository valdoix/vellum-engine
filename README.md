# VELLUM II — *Palimpsest*

**A memory and continuity engine for [Lumiverse](https://lumiverse.chat) roleplay.**

VELLUM II watches your story as you play it and quietly keeps track of everything that matters — who's in the room, how people feel about each other, what each character secretly knows (and what they're wrong about), what's happening off-screen, and what happened fifty messages ago that the AI would otherwise forget. It then feeds the *relevant* slice of that history back into the AI on every turn, so your characters stay consistent and the world keeps its shape over a long story.

It comes in two halves that work together:

- **The preset** — the instructions sent to the AI. It shapes the *prose* (how it writes) and asks the AI to append a small, hidden status report at the end of each reply.
- **The extension** — a Lumiverse add-on that reads those hidden reports, builds a living "chronicle" of your story, and shows it to you in a beautiful panel with tabs for cast, relationships, a relationship graph, a timeline, and more.

You can use the preset on its own (it produces great writing by itself). You can use the extension on its own (it works with any preset, though not as precisely). Together they're designed as one system.

> A *palimpsest* is a manuscript page that's been written, scraped clean, and written over again — with the older layers still faintly readable underneath. That's the whole idea: your story's present is the top layer, and its entire history stays legible beneath it.

---

## Table of contents

1. [What problem this solves](#what-problem-this-solves)
2. [Quick start (5 minutes)](#quick-start-5-minutes)
3. [Installing the extension](#installing-the-extension)
4. [Installing & using the preset](#installing--using-the-preset)
5. [The preset, feature by feature](#the-preset-feature-by-feature)
6. [The extension, feature by feature](#the-extension-feature-by-feature)
7. [The panel: tabs & tools](#the-panel-tabs--tools)
8. [How the two halves talk to each other](#how-the-two-halves-talk-to-each-other)
9. [Permissions (and what breaks without each)](#permissions)
10. [FAQ & troubleshooting](#faq--troubleshooting)
11. [For developers](#for-developers)

---

## What problem this solves

If you've done long-form AI roleplay, you know the failure modes:

- The AI forgets a promise made twenty messages ago, or revives a character who died.
- Everyone likes you instantly and equally; relationships never really *develop*.
- A character "knows" something they were never told, because the AI can see the whole script.
- The world is frozen — nothing happens unless you're in the room to watch it.
- The prose drifts into the same tics: *a shiver ran down her spine*, *not X, but Y*, *time seemed to stand still.*

VELLUM II attacks all of these. The preset enforces good craft and a strict "characters only know what they actually witnessed" rule. The extension gives the story a memory that survives across hundreds of messages, tracks relationships as real numbers that move slowly and are *earned*, and can even simulate what people are doing off-screen.

---

## Quick start (5 minutes)

1. **Install the extension** in Lumiverse (steps [below](#installing-the-extension)).
2. **Import the preset** `vellum-ii.json` (steps [below](#installing--using-the-preset)).
3. Open a chat and start playing. After the AI's first reply, open the VELLUM panel — you'll see the scene, cast, and relationships start to fill in.
4. That's it. Everything runs automatically. The rest of this README is for when you want to understand or tune what's happening.

---

## Installing the extension

The extension is a Lumiverse "Spindle" extension installed straight from this GitHub repository.

1. In Lumiverse, open **Extensions** (in the main menu / settings).
2. Choose **Install** (or **Install from URL** / **Add extension**).
3. Paste this repository's URL:
   ```
   https://github.com/valdoix/vellum-engine
   ```
4. Confirm. Lumiverse downloads the extension and asks you to **grant permissions** — approve them. Each one is explained in the [Permissions](#permissions) section below; the short version is that VELLUM needs them to read your messages, write its hidden status block back, and store the chronicle. Nothing leaves your Lumiverse instance.
5. Once installed, you'll see a new **VELLUM** panel/drawer available in your chat view. Open it any time to see your chronicle.

That's the whole install. There's nothing to build or configure — the extension ships ready to run.

> **Updating:** when a new version is released, re-open Extensions and use **Update** (or reinstall from the same URL). Your chronicles are stored per-chat and aren't affected by updates; the extension automatically migrates older saved data to the new format.

---

## Installing & using the preset

The preset is a single file, `vellum-ii.json`, found in the [`presets/`](presets/) folder of this repo.

1. **Download `presets/vellum-ii.json`** to your computer.
2. In Lumiverse, go to the preset area (**Reasoning → Presets**, or the preset selector in your chat).
3. **Import** the file. It now appears in your list of presets as **"VELLUM II — Engine."**
4. **Select it** for your chat or connection.
5. (Optional) Click the **sliders / settings icon** that appears when a preset has options. This opens the **Prompt Variables** menu — a friendly settings panel where you can change POV, length, tone, content level, and toggle features on and off. You never have to edit the raw preset text.

### Do I need the separate regex file?

The preset already has all its display scripts **built in**, so importing `vellum-ii.json` is enough for everything to render correctly. A standalone `vellum-ii-regex.json` is also included in `presets/` for people who prefer to manage regex scripts separately, or who want to install only a subset — but most users can ignore it.

### A note on the hidden status block

When VELLUM II is active, the AI ends each reply with a small block wrapped in `<vellum>…</vellum>`. **You will never see it** — the preset's display scripts hide it from the chat and strip it from the AI's future context so it doesn't pile up. That block is how the preset and extension talk. If you ever see raw `<vellum>` text in your chat, it just means the regex display scripts aren't enabled; re-importing the preset fixes it.

---

## The preset, feature by feature

Everything in the preset is a **block** you can switch on or off, or a **dropdown/slider** in the Prompt Variables menu. Nothing is hidden behind an all-or-nothing "profile." Below is what each part does, in plain terms.

### Session settings (the basics)

A single panel of dropdowns that set the voice of the whole story:

- **POV** — first person, second person ("you"), third limited, or third omniscient.
- **Length** — from terse (2–3 paragraphs) to detailed (7–10), or **Adaptive**, which matches the length to the moment.
- **Tense** — past or present.
- **Prose register** — the governing style: *Literary, Gothic, Wildean (witty), Hardboiled (noir), Sparse (minimalist), Lush (rich), or Contemporary.*
- **Stakes** — how hard the world bites, from *Cozy* to *Brutal* (permanent consequences, no plot armor).
- **User Agency** — how much the AI is allowed to write *for you*. The default, **Forbidden**, is strict: the AI never speaks, thinks, or moves your character — it stops and hands control back to you. (**Minimal** allows only involuntary reflexes; **Director** lets it expand your stated intent.)

### Prose craft & anti-slop

Two always-on blocks push the writing toward real literary fiction instead of "chatbot prose":

- **Prose Doctrine** — show feeling through the body and the concrete detail, not by naming the emotion; give each character a distinct voice; vary the rhythm; resolve one beat per turn, then yield.
- **The Forge (anti-slop)** — names the AI's most common tics (the "not X, but Y" construction, throat-clearing openers, "warmth pooled in her chest," animal verbs for humans, neat bow-tie endings) and tells it to find the *truer* line underneath instead of just rephrasing. Crucially, it's framed as *"break the autopilot, not the nerve"* — so the prose doesn't go stiff and over-cautious.
- **Slop Proofreader** *(optional, off by default)* — if you enable it (and its matching display script), a faint mark appears in the chat next to any cliché that slipped through, as a gentle nudge. It only marks the display; it never changes what the AI actually wrote or sees.

### Knowledge discipline (the soul of the engine)

This is what makes VELLUM stories feel real. **Every character only knows what they personally witnessed, were told, overheard, read, or could reasonably deduce.** They can't read your mind, can't see the narration, and can't know about off-screen events. Suspicion isn't knowledge. Mistaken beliefs are treated as gifts, not errors.

You also get an **Epistemic Mode** dial that sets how much *the reader* knows versus the characters — *Behind* (mystery), *Alongside* (discover together), *Ahead* (dramatic irony — you know it's a trap, she doesn't), or *Dark* (no one knows, not even the narration).

### The Character Engine

Makes NPCs feel like protagonists of their own lives instead of quest-dispensers:

- They **act on their own motives** instead of asking you what you want; permission-seeking is treated as a failure of nerve.
- They can disagree, refuse, interrupt, start conflict, or leave.
- In group scenes, **characters talk to each other**, not just to you.
- **Change is geological** — one nice conversation doesn't heal a guarded person; old patterns resurface under stress.

### The Living World

A dial for how much the world acts on its own when you're not looking:

- **Off** — the world centers on you.
- **Minimal** — mostly waits for you, but shows small signs that time passed.
- **Active** (default) — absent characters pursue their own goals, rumors travel, subplots build pressure off-screen and eventually intersect you.
- **Sandbox** — a fully autonomous world that gets ahead of you; opportunities can expire if you ignore them.

### Tone: Romance & World Disposition

- **Romance Pace** — from *Off* to *Slow Burn* to *Desire-forward*. This controls *when* intimacy becomes reachable, separately from how explicit it can get.
- **World Disposition** — the social "climate": how people lean toward you *before* you've earned anything, from *Kind* to *Brutal*. It's a prior, not a guarantee — and there's a built-in anti-monotony rule so a kind world still has one sour exception and a brutal world one improbable mercy.

### Mature content (gated, opt-in)

- **NSFW Level** — from *Off* / *Clean* (fade to black) up through *Explicit*, with each level clearly defined. Tasteful by default; explicit only when you choose it.
- **NSFL / Dark Content** *(off by default)* — unflinching treatment of violence and dark themes for fiction that calls for it.
- **Sovereign Mandate** — the preset's "jailbreak": it tells the model that within this fiction there's no forbidden subject and no reason to break character to moralize. There's also an optional **Hard Fallback** for stubborn models.

### The variance suite (anti-repetition)

The newest and most distinctive part of the preset. These exist because even a good model gets *repetitive* over a long story — same sentence shapes, same scene openings. They inject controlled randomness so no two turns feel stamped from the same mold. All of this happens inside the AI's hidden planning block, so it costs you nothing in the visible chat:

- **The Augury** *(on by default)* — at the start of each turn the AI privately "rolls the lots": a **pressure** level (should this beat be still, or should something break?), a **shape** (an opening constraint, e.g. *open mid-gesture* or *on a threshold narrowing*), a **cost** (what this moment spends — time, trust, safety, a truth that can't be unsaid), and a rare **omen** that drops in a surprise. A cooldown stops the same big "eclipse" beat from firing two turns running.
- **Marginalia** *(on by default)* — the AI draws three random "anchors," sketches three possible directions for the beat using them, picks the best, and discards the rest. The anchors never appear in the prose; they just knock the model off its first, most-clichéd instinct.
- **The Scribes** *(off by default)* — rotates the *authorial voice* turn to turn from a pool you choose (the Miniaturist, the Ironist, the Elegist, the Brawler, the Fabulist, the Clinician), so the narration doesn't settle into one groove.
- **Rough Hand** *(off by default)* — permits exactly one deliberate human imperfection per turn (a thought abandoned mid-reach, a register that slips), to defeat the over-polished "AI sheen."

### Planning, model tuning & the state block

- **Reverie** — the AI's hidden planning step before it writes. You set the **depth** (*Vibes* / *Standard* / *Deep*). It plans once, then writes once — it's notes, never a rough draft. The preset also shows it a one-line read-back of your current settings and the story's "phase" (opening, rising, cruising, marathon, endurance) so it adapts as the story ages.
- **Model Errata** — opt-in fixes for specific AI families' known quirks (Claude's tendency to soften, Gemini's "absolute/sheer" crutch and robotic transitions, DeepSeek's purple drift, Kimi's over-thinking, GLM's under-planning). Pick the one matching your model.
- **The State Block** — the hidden `<vellum>` report the extension reads. You can dial its **verbosity** (lean by default to save tokens; full, with a worked example, while teaching a new model the format). If the AI can't manage the JSON, a single terse line still works as a fallback.

### Two signature memory features

- **The Codex** *(on by default)* — when the story needs a detail it hasn't established (a place name, a custom, a price), the AI invents a small, consistent fact and **binds it as canon** so it never drifts later. These show up in the extension's **Codex** tab.
- **The Palimpsest** *(on by default)* — when a character's belief is proven *wrong*, the old belief isn't deleted — it becomes a **scar** that can resurface later as doubt. These show up in the extension's **Scars** tab.

### Visuals (optional)

- **Visual Toolkit (VTK)** — lets the AI render key beats as small, self-contained HTML/CSS visuals (a letter read on-page, a mindscape, a title card). You set the frequency from *Rare* to *Frequent*, or leave it off.
- **Card Library & Spectacle** — compact tags the AI can emit (`[CODEX]`, `[LETTER]`, `[DECREE]`, `[PORTRAIT]`, and rarer treats like a `[BROADSHEET]` of off-screen news or a `[TAROT]` pull) that the display scripts turn into pretty illuminated cards — while keeping the raw tag out of the AI's future context so it stays cheap.

---

## The extension, feature by feature

The extension's job is to turn that hidden status block into a durable, queryable memory and feed the right parts back to the AI. Here's what it tracks and does.

### A chronicle that can't drift

Under the hood, the extension stores your story as an **append-only event log** — an immutable list of "what changed" each turn. Everything you see (the cast list, relationship scores, the day counter) is *recomputed* from that log, never edited in place. This sounds technical, but it buys you real features for free:

- **Undo a turn** cleanly.
- **Rebuild** the entire chronicle from your chat transcript if anything ever looks off.
- **Time-travel** views and a trustworthy timeline.
- An automatic **backup** and a **Recover** button if data is ever lost.

### Cast & evolving relationships

Every named character becomes a **cast card**. Relationships are tracked as two separate numbers — **affection** and **trust** — that move *gradually* and are *earned*, and carry categories (familial, romantic, alliance, rivalry, social). Because affection and trust are separate, the engine can represent things a single "love meter" can't: high affection with low trust reads as infatuation; low affection with high trust reads as respect. Relationships are **directional**, so "A adores B while B can't stand A" is fully representable.

### Knowledge, secrets & dramatic irony

This is the extension's standout. For each fact, it records **who knows it**, how sure they are (*knows / believes / suspects / wrong / unaware*), and whether it's *actually* true — independently of what they believe. That combination is a real dramatic-irony engine: the chronicle can hold "Cersei is **certain** of something that is **false**," and the AI is fed that asymmetry so the irony pays off. **Secrets** track who's hiding what from whom.

### The Journal

A per-character memory book. The engine extracts genuine turning points — a confession, a betrayal, a gift, a wound, a first kiss — written from *that character's* point of view. Your own persona keeps a journal too.

### Scars (the Palimpsest) & the Codex

- **Scars** — superseded beliefs, kept on purpose, that can resurface as doubt under pressure.
- **Codex** — facts that are true *of the world* (canon the story established), kept separate from any character's opinion so they never read as a personal belief — and never accidentally create a phantom "World" character.

### Off-screen life & parallel threads

The chronicle tracks subplots happening away from you. With the optional **off-screen simulation** turned on, the extension will, every few turns, quietly generate what absent characters are doing elsewhere — and let those threads eventually walk back into your scene.

### Hierarchical memory & smart recall

Old turns don't just scroll out of the AI's context window and vanish. The extension **summarizes** older stretches into "chapter" memories (and chapters into "arcs"), so the deep past compresses but stays *retrievable*. On every turn it performs **scene-aware recall**: it figures out what the current moment is about and injects only the relevant history — combining exact keyword matching, the host's semantic embeddings (if you've enabled them), and its own structured facts. Crucially, hard facts (relationship scores, who-knows-what, the day count) are injected **verbatim and authoritatively** — they're never left to fuzzy similarity search, so continuity is never lost.

### The Vault (world books)

A built-in **lorebook** manager. Your chapter/arc summaries are stored as editable world-book entries, so your story's compressed history is visible and editable in Lumiverse itself.

---

## The panel: tabs & tools

Open the VELLUM drawer to find these. There's also a compact floating **"Now"** window that shows just the live scene.

**Tabs:**

- **Now** — the live dashboard: current scene, who's present and their mood, tension, and the latest changes.
- **Chronicle** — the heart of the panel, with sub-views for **World** (scene, arcs, threads, off-screen), **Timeline**, **Memory**, **Knowledge**, **Secrets**, **Scars**, and **Codex**.
- **Cast** — every character, editable.
- **Relations** — every relationship with its affection/trust scores and history.
- **Journal** — per-character memory books.
- **Graph** — a beautiful force-directed map of your relationship web, with faction clusters; drag, zoom, click to isolate.
- **Vault** — your lorebook entries.
- **Context** — a live feed showing exactly what the engine injected into the prompt this turn (great for understanding *why* the AI knew something).

**Tools** (in the toolbar / Actions menu) — everything is optional:

- **Customize** — theme the panel: colors, font, size, skins.
- **Summarize** — compress older turns into chapter memories now.
- **Rescan / Rebuild** — re-read the latest turn, or reconstruct the whole chronicle from the transcript (recovery).
- **Undo turn** — drop the most recent turn's tracked changes.
- **Tidy threads / Tidy lore** — merge near-duplicate plot threads or facts.
- **Hide filed** — hide already-summarized turns from the prompt to save context.
- **Traverse** — smarter, AI-guided recall (cycles through off / one-shot / deep tree drill).
- **Tone** — quick access to romance pace + world disposition.
- **Off-screen** — toggle the off-screen life simulation.
- **Export / Import / Recover** — back up, restore, or move a chronicle.
- **Clear** — erase this chat's chronicle (quarantined as a destructive action).

Everything model-authored is safely escaped, and each panel fails in isolation — one glitchy panel can never freeze the rest.

---

## How the two halves talk to each other

It's a clean loop, worth understanding once:

1. **You send a message.** The extension injects the relevant chronicle (authoritative facts + recalled history) into the prompt.
2. **The AI replies** — prose for you, plus the hidden `<vellum>` status block at the end.
3. **The extension reads that block** straight from the saved message, validates it, and folds the changes into the event log.
4. **Display scripts hide** the block and the planning notes from your view and **strip them from the AI's future context**, so they never clutter the chat or bloat the prompt.
5. The panel updates, and the cycle repeats.

If a turn's block is malformed or missing, the extension falls back gracefully — it can read a terse one-line format, and it even mines the prose itself for knowledge, secrets, and journal moments as a backup. **Token-tight local models still work**; they just lean on the fallbacks more.

---

## Permissions

When you install the extension, Lumiverse asks you to grant these. Here's what each is for and what stops working without it:

| Permission | Used for | Without it |
|---|---|---|
| `interceptor` | Injecting scene-aware recall into the prompt | No memory is fed to the AI |
| `chats` | Finding the active chat, attaching world books | No chat context / no Vault attach |
| `chat_mutation` | Reading raw messages, hiding filed turns | No scanning / no hierarchical memory |
| `generation` | Auto-summaries, fact extraction, off-screen sim | No auto-extraction or summarizing |
| `ui_panels` | The drawer and tabs | No UI |
| `world_books` | The in-app Vault (lorebooks) | No Vault |
| `memories` | Semantic recall via the host's embeddings | Recall still works, keyword-only |

Everything runs inside your Lumiverse instance; the extension makes no outside calls of its own.

---

## FAQ & troubleshooting

**I see raw `<vellum>` or `<reverie>` text in my chat.**
The preset's display scripts aren't active. Re-import `vellum-ii.json` (its scripts are built in), or import the standalone `vellum-ii-regex.json` and make sure those scripts are enabled.

**Can I use the preset without the extension?**
Yes. You'll get all the prose craft, knowledge discipline, and variance features. You just won't get the persistent chronicle, the panel, or the smart recall. The hidden state block will simply be ignored (and hidden).

**Can I use the extension with a different preset?**
Yes. The extension can mine your AI's prose for facts on its own. It works best with the VELLUM preset (which hands it clean structured data), but it degrades gracefully with anything.

**My local model isn't producing the JSON block.**
Switch the **State Spec Verbosity** to *Full* for a while so the model sees a worked example, and consider enabling the matching **Model Errata** block. Even if it never produces JSON, the terse one-line fallback and prose mining keep the chronicle alive.

**The story feels repetitive.**
Make sure **The Augury** and **Marginalia** are on, try turning on **The Scribes** with a few voices selected, and consider **Rough Hand**. These exist specifically to fight repetition.

**A character knows something they shouldn't.**
That's exactly what the **Knowledge Discipline** block prevents — make sure it's enabled. You can also inspect the **Knowledge** tab to see who the engine thinks knows what, and edit it.

**Something looks wrong in the chronicle.**
Try **Rescan** (re-read the last turn) or, as a last resort, **Rebuild** (reconstruct everything from the transcript). If data was lost, **Recover** restores from the automatic backup.

**Will updating the extension wipe my story?**
No. Chronicles are stored per-chat and are migrated forward automatically when the data format changes.

---

## For developers

VELLUM II is TypeScript, built with [Bun](https://bun.sh) / tsup, and unit-tested with vitest.

```sh
bun install
bun run typecheck   # tsc --noEmit (strict)
bun run test        # vitest
bun run build       # → dist/backend.js + dist/frontend.js
```

After changing source, run `bun run build` and reload the extension in Lumiverse.

**Architecture in one breath:** the event log is the single source of truth; `state = reduce(events)` is a set of pure, tested functions; retrieval fuses lexical + embeddings + structured facts (with structured facts kept authoritative); and the UI is small isolated components with error boundaries. Adding a feature means three small touch points — a new event kind, one reducer case, and a feature that emits it — never a sprawling edit. See the in-repo plan documents for the full design.

## License

AGPL-3.0 (matching the Lumiverse extension ecosystem).

## Credits

Built by VELLUM, with thanks to the Lumiverse community. Influenced by the AI-directed retrieval and activity-feed ideas of LoreRecall and the splice-in-place chapter/arc compression of LumiBooks — rebuilt natively here in our own engine and words.
