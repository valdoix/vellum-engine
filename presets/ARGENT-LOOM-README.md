# VELLUM II — ARGENT LOOM

ARGENT LOOM is a VELLUM-native roleplay preset for long-running, causally coherent fiction. It combines strict player agency, limited character knowledge, physical and temporal continuity, durable relationships, living-world simulation, configurable prose craft, and an engine-owned state compiler that folds completed prose into the Chronicle only after validation.

This guide covers all 62 user-facing controls in ARGENT LOOM 1.3.0, the 18-script Lumiverse regex layer, useful control combinations, and common failure modes. The generated control catalog is in `ARGENT-CONTROLS.md`.

## Included files

- `argent-loom.json` — the complete Lumiverse preset, including its regex scripts.
- `argent-loom-regex.json` — the same regex suite as a standalone Lumiverse regex export.
- `ARGENT-LOOM-README.md` — this guide.
- `scripts/build-argent-loom.mjs` — the repository-local deterministic generator and contract validator (`bun run build:argent`).
- `presets/ARGENT-CONTROLS.md` — generated from the actual variables, defaults, options, version, and regex count.
- `scripts/eval-argent.ts` — behavioral provider evaluation harness (`bun run eval:argent`).

ARGENT LOOM is designed for the VELLUM II extension. With the default **Engine Second Pass**, the narrative model writes the story and VELLUM separately compiles and validates state. **Inline Compatibility** retains the older model-written `<vellum>` route for hosts without the updated extension.

Version 1.3 resolves the full output and agency contract from the assembled prompt on every generation. Engine mode never sends inline-state instructions to the narrative model. Changing Player Agency between **Forbidden (Strict)**, **Minor Continuity**, and **Director** applies to that turn only; the next turn resolves its own selected mode and the second-pass compiler receives the same exact contract and latest user input.

## Installation

1. Install or update the VELLUM II extension in Lumiverse.
2. Open **Reasoning → Presets** or the preset selector in a chat.
3. Import `argent-loom.json`.
4. Select **VELLUM II — ARGENT LOOM** for the chat or character.
5. Link the selected preset from the VELLUM panel or its chat Actions menu if VELLUM reports that the preset is not linked.
6. Open the preset's sliders/settings control, or its VELLUM tab, to configure the variables below.

The main preset already contains the regex scripts. Do **not** also import `argent-loom-regex.json` unless the embedded scripts were not imported or you deliberately removed them. Two copies will produce doubled cards and repeated transformations. To install only the standalone pack, open **Regex Scripts → Import** and choose `argent-loom-regex.json`.

If variables are changed through VELLUM's preset tab, Lumiverse's native variable modal may need a page reload before it reflects those changes. The saved preset itself is already updated.

## Recommended first run

For most capable models, begin with the shipped defaults:

- `agency`: **Forbidden (Strict)**
- `length`: **Standard**
- `prose`: **Lucid Literary**
- `stakes`: **Grounded**
- `reasoning_route`: **Compact Reverie**
- `state_on`: **On**
- `state_compiler`: **Engine Second Pass**
- `state_verbosity`: **Lean**
- `living_world`: **Active**
- `worldgen`: **On**
- `dialogue_color`: **On**
- `craft_anchor`: **On**
- `agency_reminder`: **On**
- `adherence_target`: **Balanced**

If extraction misses a supported detail, temporarily use **Full** state verbosity. The engine still applies the same strict validator and atomic commit rules.

For a provider with reliable private reasoning, use `reasoning_route: Native` and either `model_adapter: Auto` or `Reasoning Model`. For ordinary chat-completion models, the default Compact Reverie is the safer route.

Use **Verbose Reverie** when diagnosing weak planning, complex group scenes, knowledge partitions, or difficult causal transitions. It emits a bounded 250–500 word, eight-section audit before prose, so it is more reliable but costs more output and visible scaffolding than Compact.

## Important dependency rules

- Keep **Emit State Block** on when using the VELLUM extension. Turning it off stops new structured Chronicle updates.
- **State Compilation: Engine Second Pass** requires VELLUM generation permission. If compilation fails, the accepted Chronicle remains unchanged and the warning can be retried with Rescan.
- **State Spec Verbosity: Full** makes the second pass audit every schema family and raises its output budget. Lean keeps complete scene/presence data plus material deltas.
- **Slop Proofreader** needs **Anti-Slop** on. The proofreader only renders phrases the Anti-Slop block marked.
- **World Broadsheet** needs **VTK Card Library** on.
- **VTK Spectacle** needs **VTK Card Library** on.
- **Colored Dialogue** needs the ARGENT speaker regex. VELLUM supplies stable cast colors when available. Its three Response-stage recovery transforms resolve only while ARGENT is the active preset and this control is on.
- **Lumiverse Native Memory** only contributes when Lumiverse Memory or Cortex is enabled. VELLUM remains the authoritative continuity source.
- **Loom Style Only** is useful only when a Loom style is actually active. Without one, select another Voice Lens.
- ARGENT 1.3 uses declarative `<artifact>` JSON rendered by a host-managed sandbox. Titles and bodies are escaped, the schema is closed, and executable markup and resource URLs are unavailable.

## All binary switches at a glance

| Variable | Default | Turn it on for | Keep it off when |
|---|---:|---|---|
| `ooc` | On | `((direction))` and `OOC:` author instructions | You want those forms treated as ordinary in-world text |
| `antislop` | On | Active cliché, repetition, and machine-tell suppression | A highly stylized character voice is being flattened |
| `slop_proofreader` | Off | Display marks on phrases the model still flags as weak | You want clean display with no editorial marks |
| `time_continuity` | On | Exact `HH:MM` clock, elapsed-time, and time-skip discipline | Almost never; disable only for deliberately dreamlike time |
| `worldgen` | On | One-time world genesis at a new chat's opening | The supplied card/scenario already defines everything needed |
| `world_broadsheet` | Off | A public-events broadsheet during genesis or insistent world texture | You want pure prose or do not use VTK cards |
| `codex` | On | Small missing world facts minted as reviewable provisional lore | The model must never invent setting details |
| `inventory` | On | Named possessions and scene objects tracked across turns | Objects are irrelevant or state budget is extremely tight |
| `state_on` | On | VELLUM Chronicle updates | Running without VELLUM and wanting prose only |
| `nsfl` | Off | Unflinching dark or graphic fictional consequences | The story should remain non-graphic |
| `vtk_cards` | Off | Compact artifact tags rendered as illuminated cards | Plain prose only |
| `vtk_spectacle` | Off | Broadsheet, tarot, and playbill spectacle cards | You want restrained presentation |
| `dialogue_color` | On | Required exact-name speaker markup and VELLUM cast colors | Plain text or unsupported renderers |
| `native_memory` | Off | Lumiverse Memory/Cortex as a secondary recall lane | VELLUM alone should control recall |
| `craft_anchor` | On | A final compact prose-quality reminder | A strong model becomes overly constrained or repetitive |
| `agency_reminder` | On | A final player-authorship boundary | Only consider disabling outside Forbidden agency |

## Narrative and scene controls

| Control | Default | Options and effect |
|---|---|---|
| `pov` — Point of View | **Third Limited** | **First:** one first-person focal mind. **Second:** addresses the player as “you” without authoring them. **Third Limited:** one knowledge-bounded focal lens. **Third Omniscient:** may move between minds with explicit, clean transitions. |
| `length` — Length | **Standard** | **Micro:** one tight paragraph. **Brief:** 1–2 paragraphs. **Concise:** 2–3. **Standard:** 4–6. **Detailed:** 7–10. **Expansive:** 10–14. **Epic:** 15+ and a full scene arc. **Adaptive:** match the current beat. Length controls volume, not pace. |
| `tense` — Tense | **Past** | **Past** or **Present**. The selected tense is enforced across narration; direct speech and recalled events may naturally differ. |
| `prose` — Voice Lens | **Lucid Literary** | **Lucid Literary:** precise and restrained. **Gothic Intimate:** bodily unease, pressured architecture/weather. **Mythic Austere:** elemental and ceremonial. **Hardboiled Concrete:** clipped, gritty, leverage-heavy. **Quiet Spare:** plain exact words and omission. **Lush Controlled:** sensuous but disciplined. **Immediate Contemporary:** transparent modern prose. **Adaptive:** infer a register from scene and era. **Loom Style Only:** defer to the active Loom style. |
| `stakes` — Stakes | **Grounded** | **Cozy:** gentle and recoverable. **Grounded:** fair costs. **Harsh:** scarce safety and lasting consequences. **Brutal:** maximum jeopardy without plot armor. Stakes change consequence severity, not prose length. |
| `genre` — Primary Genre | **Off** | The main story grammar. Available: Off/character drama, Romance, Mystery, Horror, Thriller, Fantasy, Sci-Fi, Slice-of-Life, Adventure, Comedy, Drama/Literary, Tragedy, Noir, Coming-of-Age, Political/Intrigue, Western, Wuxia, and Xianxia. |
| `genre2` — Secondary Genre | **Off** | Uses the same genre list as `genre`, but only as a lighter inflection. Example: Mystery primary + Romance secondary. Avoid selecting the same genre twice. |
| `dialogue` — Dialogue Frequency | **Balanced** | **Sparse:** speech is rare and weighted. **Balanced:** dialogue and action share the scene. **Talkative:** conversation carries more beats. **Banter-heavy:** quick exchanges and verbal play. Established character voice always wins. |
| `npc_dialogue` — NPC-to-NPC Dialogue | **On** | Lets present NPCs initiate, answer, question, interrupt, coordinate, bargain, joke, comfort, accuse, conceal, refuse, and redirect one another when their motives intersect. Exchanges must move the scene rather than fill a turn quota; every speaker retains distinct voice, limited knowledge, physical access, and exact colored-dialogue identity. Off suppresses extended NPC-only exchanges but still permits a brief line required by immediate causality. |
| `agency` — Player Agency | **Forbidden (Strict)** | **Forbidden (Strict):** treats every unsupplied player predicate as forbidden—including automatic reactions, passive consequences, perception, sensation, injury, consent, resistance, and “obvious” follow-through. An attempted action licenses only the stated attempt. **Minor Continuity:** may finish only the mechanically inevitable tail of a trivial action the player unmistakably began. **Director:** co-authors the player within the latest stated intent or explicit direction, including plausible speech, action, reaction, perception, sensation, and interiority consistent with established characterization; it cannot contradict intent, invent consent, cross an explicit boundary, or make an unsupported major irreversible choice. The selected mode is stamped and consumed per turn, so changing it never retroactively alters another turn. |
| `distance` — Narrative Distance | **Intimate** | **Intimate:** inside the focal body's immediate experience. **Standard:** natural close narration with occasional step-back. **Cinematic:** external camera; behavior implies interiority. **Panoramic:** place, weather, and history frame the beat. **Adaptive:** distance changes with the scene. |
| `pacing` — Pacing | **Measured** | **Lingering:** dwell on one charged beat. **Measured:** natural tempo. **Propulsive:** cut transitions and maintain momentum. **Adaptive:** slow charged moments, accelerate connective action. This controls rhythm, not output size. |
| `ooc` — OOC Channel | **On** | On treats `((double parentheses))` and `OOC:` as author direction rather than scene dialogue. A direct OOC question receives a brief OOC answer; otherwise the instruction is applied silently. |

### Choosing genres

- **Romance** prioritizes attraction, obstacle, push/pull, and earned emotional payoff.
- **Mystery** prioritizes fair clues, inconsistencies, red herrings, and solvable revelation.
- **Horror** prioritizes dread, thresholds, wrongness, and payoff rather than empty fake-outs.
- **Thriller** prioritizes momentum, competence under pressure, escalation, and clocks.
- **Fantasy** prioritizes wonder governed by consistent costs and laws.
- **Sci-Fi** prioritizes an extrapolated idea and its human and social consequences.
- **Slice-of-Life** prioritizes ordinary texture and truthful small moments without manufactured crisis.
- **Adventure** prioritizes journey, discovery, obstacles, and forward movement.
- **Comedy** prioritizes timing, escalation, incongruity, and character-based payoff.
- **Drama/Literary** prioritizes contradiction, moral ambiguity, subtext, and resonance.
- **Tragedy** prioritizes an earned structural fall and tightening inevitability.
- **Noir** prioritizes corruption, compromise, debt, atmosphere, and costly truth.
- **Coming-of-Age** prioritizes thresholds, lost certainties, and change that leaves a scar.
- **Political/Intrigue** prioritizes factions, leverage, information, and rational schemes.
- **Western** prioritizes frontier law, personal codes, distance, violence, and its price.
- **Wuxia** prioritizes martial honor, sect obligations, mastery, and duels as moral argument.
- **Xianxia** prioritizes cultivation, tribulation, karma, hierarchy, and costly progression.

## Prose fine-tuning controls

| Control | Default | Options and effect |
|---|---|---|
| `doctrine_strictness` — Craft Floor | **Standard** | **Relaxed:** strong guidance with room for deliberate exceptions. **Standard:** normal ARGENT craft discipline. **Strict:** aggressively removes named-emotion shortcuts, loose thought verbs, comma splices, and uncontrolled run-ons. |
| `metaphor` — Figurative Density | **Default** | **Default:** follow the Voice Lens. **Literal:** almost no comparison. **Sparing:** rare, precise figures. **Rich:** layered figuration, still controlled. |
| `diction` — Vocabulary | **Natural** | **Default:** follow the Voice Lens. **Plain:** common concrete words. **Natural:** precise without strain. **Elevated:** cultured literary vocabulary. **Ornate:** rich and sonorous, still clear. |
| `sensory` — Sensory Bias | **None selected** | Multi-select Sight, Sound, Smell, Touch/texture, Taste, and Body/movement. It biases neutral detail selection; it does not require every selected sense in every paragraph. |
| `filter_words` — Saw/Heard/Felt | **Sparing** | **Default:** follow doctrine. **Cut:** render perception directly. **Sparing:** use filters only when noticing itself matters. **Allowed:** use them naturally. |
| `paragraph_shape` — Paragraph Shape | **Default/varied** | **Default:** mixed rhythm. **Short-driven:** punchier 1–3 sentence paragraphs. **Flowing:** fewer, more developed paragraphs. |
| `profanity` — Profanity | **Default/per character** | **Default:** character and world decide. **None:** no swearing. **Mild:** occasional light profanity. **Natural:** as voice and circumstance warrant. **Unfiltered:** coarse language where fitting, still bounded by Hard Limits. |
| `era` — Era/Idiom | **Off/follow world** | Mythic/Ancient, Medieval, Renaissance/Early-Modern, Regency, Victorian/Industrial, Belle Époque, Jazz Age, Mid-Century, Contemporary, Near-Future, Far-Future/Space Age, Post-Collapse, Timeless/Fairytale, or Random per turn. It colors diction, technology, references, and sensory furniture but yields to established canon. |
| `era_strictness` — Anachronisms | **Flavored** | **Authentic:** fully period-committed and least modern-readable. **Flavored:** readable modern prose with period tint and no glaring anachronisms. **Loose:** modern voice with period setting and props. |
| `cast` — Tonal Cast | **Adaptive** | **Off:** no wash. **Blue:** melancholy. **Amber:** warmth/nostalgia. **Ash:** numb/drained. **Violet:** feverish/dreamlike. **Crimson:** heat/appetite. **Verdigris:** rot/envy. **Adaptive:** follow each beat. **Random:** choose a new wash per turn. |
| `antislop` — Anti-Slop Forge | **On** | Hunts machine-like repetition and stock phrasing. Turn it off only when its corrective pressure flattens an intentionally unusual voice. |
| `antislop_focus` — Tells to Hunt | **All selected** | Multi-select: contrast scaffolds, stall openers, organ-weather emotion, named feelings, cosmic inflation, animalized voices, prestige adjectives, stock body tells, bow-tie endings, craft-talk/stage direction, and prose that comments on itself. Deselect a family when it is intentional to the voice. |
| `slop_proofreader` — Display Marks | **Off** | When on, surviving phrases explicitly marked `<slop>` are highlighted by the display regex. The mark is visual only; prompt and memory copies keep the prose but remove the tag. Requires Anti-Slop on. |
| `interiority` — Interiority Mode | **Adaptive** | **Adaptive:** choose per beat. **Embedded:** thought appears through association, attention, and syntax. **Filtered:** allows articulated reflection through character vocabulary. **Defensive:** emphasizes denial, rationalization, and displaced attention. **Sensory-first:** body and orientation precede explanation. This affects visible prose; VELLUM still records private on-stage NPC thoughts. |

## World, knowledge, and simulation controls

| Control | Default | Options and effect |
|---|---|---|
| `epistemic` — Dramatic Irony | **Alongside** | **Behind:** reader knows less than characters. **Alongside:** reader discovers with the focal character. **Ahead:** reader knows more and the gap creates tension. **Dark:** neither character, narrator, nor reader is granted the answer yet. This never gives a character knowledge they lack. |
| `living_world` — Living World | **Active** | **Off:** render only on-page life. **Minimal:** off-screen time leaves small evidence but no independent subplot engine. **Active:** absent characters and threads pursue goals and later intersect the scene. **Sandbox:** the world advances autonomously and opportunities can expire. Under Engine Second Pass, the extractor emits `start`, `advance`, `move`, and `resolve` operations. VELLUM reviews every prior row, preserves unchanged actors, removes arrivals, and computes the final T1 snapshot. |
| `time_continuity` — Time Continuity | **On** | Requires every active-scene state snapshot to use zero-padded 24-hour `scene.time` such as `07:45` plus the matching minutes-after-midnight `scene.clock` (`465`). The preset compares `day × 1440 + clock` before and after every turn; even a one-minute regression is invalid. An earlier wall clock requires a narrated midnight crossing and a higher day. VELLUM also clamps invalid inline state, while the engine second pass rejects it. |
| `worldgen` — Cartographer | **On** | Runs during the opening and creates a bounded world frame: a few provisional facts, powers, currents, and adjacent places. Type `((worldgen))` later to request another pass. Genesis is marked consumed only in the same atomic event commit as a validated state candidate; failure, rejection, and regeneration cannot consume it. Existing scenario and lore always outrank it. |
| `world_premise` — Premise | **Blank** | Optional text seed such as “a drowned merchant city ruled by feuding houses.” Leave blank to infer the frame from the character card and scenario. It constrains genesis; it is not repeated as exposition. |
| `world_scale` — Scale | **Locale** | **Chamber:** one building/site. **Locale:** town, quarter, or holdfast. **Realm:** region, province, or city-state. **World:** civilization, kingdom, or planet. **Cosmos:** multiple worlds, realms, or eras. Larger scale establishes reach, not instant encyclopedic detail. |
| `world_texture` — Ambient Pressure | **Living** | **Backdrop:** world remains scenery. **Living:** occasional news, weather, prices, and distant motion. **Insistent:** the wider world regularly intrudes and demands response. |
| `world_broadsheet` — Broadsheet | **Off** | Allows one public-events broadsheet artifact during genesis and when world texture is insistent. Requires VTK Card Library. It presents already-established public events; it does not create canon by itself. |
| `codex` — Codex Minting | **On** | Allows a few missing but useful world facts to be proposed. VELLUM stores every model-minted Codex note as **provisional**; it cannot outrank user, scenario, worldbook, or confirmed canon. Chronicle → Codex can confirm, correct with revision history, reject, restore, or delete it. Turn off for a closed-canon setting. |
| `inventory` — Possession Tracker | **On** | Tracks named, continuity-relevant possessions and scene objects through `ext.inventory`. It is not a quantity, encumbrance, or loot system. Disable for object-light stories or the smallest possible state block. |
| `disposition` — World Disposition | **Fair** | **Kind, Warm, Fair, Harsh, Brutal.** Sets the prior stance of newly introduced, otherwise unmodeled people and factions. It does not overwrite established personalities or relationships. |
| `social` — NPC Social Autonomy | **Living** | **Off:** no off-screen relationship movement. **On-Screen Only:** relationships move through shown events. **Living:** small off-screen movement is possible. **Autonomous:** NPC relationships can evolve substantially through plausible independent activity. |
| `politics` — Faction Politics | **Living** | **Off:** faction relations change only on-page or by direction. **Living:** small off-screen political drift. **Autonomous:** alliances, rivalries, wars, vassalage, and trade may change through plausible maneuvers. |
| `failure_shape` — Failure Shape | **Progress With Cost** | **Clean Failure:** the attempt simply fails. **Progress With Cost:** advance, but pay. **New Complication:** failure opens another problem. **Adaptive Mix:** choose the most causal shape. This does not predetermine success; it shapes what failure tends to do. |
| `reveal_cadence` — Reveals | **Measured** | **Withheld:** explanations arrive late and indirectly. **Measured:** steady partial revelation. **Active:** clues and answers move more quickly. It cannot reveal information before a valid source exists. |
| `world_law` — Causality | **Coherent Speculative** | **Grounded:** ordinary physical realism. **Coherent Speculative:** extraordinary elements obey explicit costs and rules. **Mythic but Lawful:** symbolic or divine forces remain consistent. **Surreal Causality:** dreamlike relations are allowed, but established local patterns still matter. |
| `antagonist_pressure` — Opposition | **Adaptive** | **Low:** opponents leave breathing room. **Measured:** regular rational pressure. **Adaptive:** pressure follows available leverage and scene need. **Relentless:** opposition exploits openings aggressively. This does not grant omniscience or impossible resources. |
| `variance` — Narrative Variance | **Disciplined Surprise** | **Steady:** favor natural, expected continuations. **Disciplined Surprise:** reject the obvious when a better causal move exists. **High Variance:** seek unusual but still supported turns. High Variance never licenses random canon violations. |

### Off-scene conversation privacy

ARGENT 1.3.0 audits knowledge per character and per fact. If B and C talk while A is absent, out of earshot, blocked, inattentive, or unable to understand, A remains unaware of the subject, exact words, tone, admissions, plans, and private reactions. A later entrance does not retroactively grant the conversation.

A can learn afterward only through a concrete bridge established in the fiction: B or C tells A, A plausibly overhears, a delivered message or readable record reaches A, a public announcement occurs, or observable evidence supports a limited inference. Evidence does not reveal more than it contains; suspicious aftermath may justify `suspects`, but not knowledge of the hidden transcript. The same audit applies to prose, dialogue, thoughts, reactions, interruptions, `present.thought`, and `delta.knowledge`.

### Provisional Codex facts

Model-generated `ext.codex` facts and the legacy `who: "world"` knowledge route enter the Chronicle with a **provisional** badge. VELLUM feeds them back as visibly provisional working lore so names and details remain stable, but confirmed/user-authored material always wins. Chronicle → Codex provides confirm, correction, rejection, restoration, and deletion. Corrections retain the previous wording in an audit history. Rejected facts stop entering recall. User-created notes are confirmed immediately; older notes retain their confirmed behavior.

## Controller, state, and model controls

| Control | Default | Options and effect |
|---|---|---|
| `reasoning_route` — Planning Route | **Compact Reverie** | **Compact Reverie:** emits a six-line `<reverie>` audit. **Verbose Reverie:** emits a bounded 250–500 word audit with Authority, Reality, Gnosis, Embodiment, Narrative, Truthful deltas, Voice, and Final checks. **Native Private Reasoning:** relies on provider-private thinking and emits no Reverie. **Silent One-Pass:** performs only a brief implicit check; fastest and least expensive, but least reliable on weaker models. Visible Reveries are collapsed for display and removed from later prompt/memory copies. |
| `state_on` — Emit State Block | **On** | Enables structured Chronicle compilation. Off produces prose without new structured scene, relationship, knowledge, inventory, or world-state updates. |
| `state_compiler` — State Compilation | **Engine Second Pass** | **Engine Second Pass:** narrative generation ends with prose; VELLUM sends the completed prose and prior Chronicle state through a temperature-zero structured extraction, validates it, and atomically commits it. **Inline Compatibility:** asks the narrative model to append the legacy `<vellum>` block and keeps the repair path available. |
| `state_verbosity` — State Schema | **Lean** | **Lean:** the second pass emits the complete scene/present roster and only material supported changes. **Full:** separately instructs it to audit every schema family and supplies a larger output allowance. Inline Compatibility retains the distinct compact and six-stage prompt contracts. Both require a limited-knowledge private thought for every named on-stage NPC. |
| `native_memory` — Lumiverse Memory | **Off** | Adds Lumiverse Memory/Cortex retrieval as a secondary, non-authoritative lane. Use when those systems contain useful prose summaries or entities. Conflicts resolve in favor of VELLUM's current structured state. |
| `model_adapter` — Model Adapter | **Auto** | Selects the family-specific narrative guidance encoded in the effective policy. The runtime compiler resolves adapter, planning route, state mode, and presentation into one final output plan, avoiding contradictory endings. Engine state extraction always uses deterministic settings on the active main connection. |
| `craft_anchor` — Final Craft Anchor | **On** | Repeats a compact POV, tense, pacing, physical-continuity, and prose-quality reminder immediately before generation. Disable if a very obedient model begins sounding constrained or formulaic. |
| `agency_reminder` — Final Agency Anchor | **On** | Reasserts this turn's selected agency mode at the final instruction position. Under Forbidden agency, all model families receive a predicate-by-predicate audit that forbids completing a natural causal sequence through the player. Keep this on when a model tends to puppet the player. |
| `adherence_target` — Anchor Placement | **Balanced** | **Balanced:** final system instruction after history; use first. **Frontier/Weak Adherence:** puts the anchor in a recent user-role history slot for models that ignore distant system text. **Quiet/Over-Literal:** places it slightly deeper in system history to reduce repetition and over-compliance. |

### Reasoning-route recommendations

| Model behavior | Planning Route | Model Adapter | State Verbosity | Anchor Placement |
|---|---|---|---|---|
| Ordinary strong chat model | Compact | Auto or matching family | Lean | Balanced |
| Provider with reliable hidden reasoning | Native | Reasoning Model or Auto | Lean | Balanced |
| Small/local model | Compact | Generic or matching family | Full initially | Frontier |
| Complex group scene needing an inspectable plan | Verbose | Auto or matching family | Lean | Balanced |
| Model leaks analysis or repeats instructions | Native if supported; otherwise Silent | Matching family | Lean | Quiet |
| Model omits or corrupts `<vellum>` | Compact | Matching family | Full | Frontier |

Do not combine a visible Compact or Verbose Reverie with expensive provider reasoning unless you specifically want both. It is usually redundant.

## Romance, mature content, and boundaries

| Control | Default | Options and effect |
|---|---|---|
| `romance` — Romance Pace | **Slow Burn** | **Off:** no engine-driven romantic movement. **Slow Burn:** small, earned shifts. **Measured:** moderate progression. **Fast:** relationships may advance quickly when supported. **Desire-Forward:** attraction and physical desire receive more salience. This is a pacing prior, not automatic attraction or consent. |
| `nsfw_level` — Intimacy | **Sensual/Implied** | **Off:** no intimacy instruction. **Clean:** romance with fade-to-black. **Sensual:** on-page but implicit. **Explicit/Tasteful:** explicit detail in a character-driven register. **Graphic:** fully graphic ordinary setting. **Depraved:** maximum fictional explicitness. Every level still obeys character truth, consent within the fiction, and Hard Limits. |
| `nsfl` — Dark Content | **Off** | On permits unflinching violence, death, and dark transgression when causally earned. It does not force darkness into unrelated scenes and never overrides Hard Limits. |
| `hard_limits` — Absolute Boundaries | **Blank** | Comma- or line-separated content the story must never depict, imply, approach, or replace with an adjacent substitute. This field outranks genre, mature settings, Sovereign Hand, character cards, and every other toggle. Be concrete. |

The mature controls are ceilings, not quotas. A high level allows detail when the story arrives there; it does not steer every scene toward sex or violence.

## Visual and interaction controls

| Control | Default | Options and effect |
|---|---|---|
| `vtk` — Raw Visual Toolkit | **Off** | Retained only so inherited/imported variable data remains compatible. The ARGENT editor disables it, its option text never enters the prompt, and its old display renderer is disabled. Use Card Library for typed host-rendered artifacts. |
| `vtk_cards` — Card Library | **Off** | Enables `<artifact>` JSON for letters, codex cards, texts, decrees, portraits, maps, items, titles, verse, tarot, broadsheets, and playbills. A closed Zod schema validates it; VELLUM escapes all text and renders the card in a host-managed opaque-origin frame with a restrictive content policy and reduced-motion CSS. |
| `vtk_spectacle` — Spectacle Cards | **Off** | Allows rarer broadsheet, tarot, and playbill artifacts. Requires Card Library. Dependency-aware controls explain and disable unavailable settings. |
| `dialogue_color` — Colored Dialogue | **On** | Requires every live directly spoken quotation by a named speaker to use one complete exact-name wrapper. The display regex bridges it to VELLUM's cast-color system; prompt and memory transforms remove wrappers while retaining dialogue. Three conservative Response-stage recovery scripts repair explicit proper-name forms (`Mara said, "…"`, `"…" Mara said`, or `Mara: "…"`). Their find patterns are macro-gated by the active ARGENT `dialogue_color` value, so they never rewrite another preset or an ARGENT response with the control off. Pronouns and generic titles are rejected. |

### Which visual system should I use?

- Use **Card Library** for host-rendered, escaped, accessible artifacts.
- Pre-1.2 raw VTK and bracket-card render scripts retain stable IDs but are disabled because regex substitution cannot safely sanitize model-authored HTML. New ARGENT output uses the declarative artifact contract.
- If presentation begins to dominate the fiction, leave cards off except for turns that contain a real document or object.

## Suggested configurations

### Balanced long-form roleplay

- Keep all shipped defaults.
- Add a primary genre only when the story needs a strong structural grammar.
- Leave visuals off until you know you want them.

### Strict player-authorship mode

- `agency`: Forbidden (Strict)
- `agency_reminder`: On
- `adherence_target`: Frontier if the model still puppets the player
- `pov`: Third Limited or Second

### Small or local model

- `length`: Brief or Concise
- `reasoning_route`: Compact
- `state_verbosity`: Full for early turns, then Lean
- `model_adapter`: Generic or matching family
- `adherence_target`: Frontier
- `living_world`: Minimal
- `vtk`: Off
- `vtk_cards`: Off
- `native_memory`: Off unless retrieval quality is verified

### Reasoning model

- `reasoning_route`: Native
- `model_adapter`: Reasoning Model
- `state_verbosity`: Lean
- `adherence_target`: Balanced
- Keep craft and agency anchors on initially; disable Craft Anchor only if prose becomes rigid.

### Autonomous sandbox

- `living_world`: Sandbox
- `social`: Autonomous
- `politics`: Autonomous
- `world_texture`: Insistent
- `antagonist_pressure`: Adaptive or Relentless
- `time_continuity`: On
- `world_scale`: Realm or larger
- `state_on`: On

This configuration consumes more state and can move the world beyond the player. Use Active/Living instead if you want the wider world to breathe without competing for narrative focus.

### Quiet character drama

- `genre`: Off or Drama/Literary
- `living_world`: Minimal
- `world_texture`: Backdrop
- `social`: On-Screen Only
- `politics`: Off
- `pacing`: Lingering or Measured
- `distance`: Intimate
- `vtk`: Off

### Mystery with dramatic irony

- `genre`: Mystery
- `epistemic`: Alongside for fair discovery, or Ahead for dread
- `reveal_cadence`: Withheld or Measured
- `world_law`: Grounded or Coherent Speculative
- `variance`: Disciplined Surprise
- `codex`: On only if the setting permits newly minted details

### Visual showcase

- `vtk_cards`: On
- `vtk_spectacle`: On
- `vtk`: Rare
- `world_broadsheet`: On
- `dialogue_color`: On

## How ARGENT's regex layer works

The 18 scripts are intentionally separated by Lumiverse pipeline surface:

- **Response scripts** conservatively recover missing `[spk=...]` wrappers when an adjacent proper name makes the speaker explicit. Their find-stage gate requires both ARGENT's unique Planning Route sentinel and Colored Dialogue, so a different preset with a same-named color control still compiles to never-match. They also reject pronouns, determiners, and generic titles.
- **Display scripts** render the Chronicle ledger, Reverie, colored speakers, and proofreader marks. The unsafe pre-1.2 raw-HTML and bracket-card renderers remain disabled; new `<artifact>` JSON uses VELLUM's typed host widget renderer.
- **Prompt scripts** retain only the newest useful state example, remove old planning and presentation wrappers, and normalize artifact text so future generations see meaning rather than UI syntax.
- **Memory scripts** prevent machine JSON, planning, and raw HTML from entering embeddings while preserving semantic artifact and dialogue content.

Inline Compatibility preserves a raw `<vellum>` block in the stored message. Under Engine Second Pass the accepted block lives in the append-only `state.compiled` audit event, while the visible assistant message remains narrative output. Do not change state-display regexes to Response target.

## Effective policy and prompt budget

ARGENT's imported blocks remain readable source doctrine. During live assembly, VELLUM removes only regions explicitly marked as ARGENT-owned and appends one compact effective-policy capsule after resolving current controls. Character cards, scenario, worldbooks, chat history, media, Sovereign Hand, Loom Retrofits, and VELLUM recall remain intact. The capsule has one final output plan for the selected planning route, state compiler, and dialogue mode.

The preset editor adds seven one-click profiles, setting search, per-section default restoration, dependency explanations, and an expandable effective-policy view. **Measure assembled prompt** runs Lumiverse's tokenizer for the current model and reports input, standing-prompt, history, reserved-output, and remaining-context values. The result identifies when Lumiverse used an approximate tokenizer.

## Build, drift checks, and behavioral evaluations

- `bun run build:argent` regenerates the preset, regex export, and control catalog from repository-relative sources.
- `bun run check:argent` fails if any generated artifact differs. CI runs it before tests.
- Generated preset metadata includes SHA-256 hashes for the generator source and inherited VELLUM preset.
- `bun run eval:argent` runs protected-agency, absent-knowledge, midnight, named-group, off-screen preservation/movement, color-on/off, state-off, and atomic-genesis scenarios against an OpenAI-compatible endpoint. Set `ARGENT_EVAL_URL`, `ARGENT_EVAL_MODEL`, and optionally `ARGENT_EVAL_KEY`; use comma-separated `ARGENT_EVAL_MODELS` for a provider matrix. Results are written under `eval/results/` and the command fails if any deterministic prose or compiled-state check fails.

## Troubleshooting

### Raw `<vellum>` or `<reverie>` text is visible

The display scripts are missing or disabled. Re-import `argent-loom.json`, or import `argent-loom-regex.json` once through **Regex Scripts → Import**. Confirm the scripts in the **ARGENT LOOM** folder are enabled.

### Cards appear twice

The embedded and standalone regex packs were both imported. Keep one copy of each ARGENT script ID and remove or disable the duplicate set.

### Dialogue is not receiving the character's VELLUM color

1. Confirm `dialogue_color` is on and `argent-speaker-display` is enabled with **AI Output → Display**.
2. Inspect the raw assistant message. Spoken lines should use `[spk=Exact Cast Name]"..."[/spk]`. ARGENT tolerates quoted names, extra tag whitespace, aliases, unambiguous short forms, and a missing close tag during streaming. A generic title such as `the captain` still cannot match unless it is recorded as that character's alias.
   The current preset repeats this as mandatory output markup in the actual last post-history block. Its GLM adapter tells the model to create the wrapper before writing each quotation. If a wrapper is omitted, the response recovery layer can repair only explicit proper-name attribution forms; pronoun-only or unattributed speech remains uncolored rather than risking the wrong character.
3. Open the VELLUM Cast entry and confirm the character has the expected canonical name or alias. A dedicated Dialogue color wins; otherwise VELLUM uses the name color, collapses a name gradient, or assigns its deterministic automatic hue.
4. Re-import the updated ARGENT preset or standalone regex pack if the rendered HTML does not contain `<span class="v-spk" data-spk="Exact Cast Name" style="color:var(--vle-spk-color,inherit)">`. The inline color marker is required by current Lumiverse so its nested quote styling inherits VELLUM's cast color.
5. If every speaker keeps the normal host color, reload the extension so it rebuilds the cast-color stylesheet.

### Parallel events show an earlier location

ARGENT 1.3.0 compiles off-screen changes as operations against the prior T1 state. Every prior actor must be reviewed; unchanged rows survive, `move` changes the destination, `resolve` removes a row, and an actor entering `scene.present` is removed automatically. The resulting `delta.parallel` snapshot is computed by VELLUM at the final day and clock.

If a contradiction remains, inspect the raw final `<vellum>` block. Every character parallel item should contain an exact `who`, final `where`, and current `activity`; nobody listed in `present` may also appear in `parallel`. Re-import the complete preset for the prompt contract and rebuild/reload the VELLUM extension for the reducer guard.

### State compilation is held

1. Confirm `state_on` is on, State Compilation is **Engine Second Pass**, and VELLUM has generation permission.
2. Read the warning. VELLUM rejects unknown keys, malformed identities, time/clock disagreement, backward time, player inner-state fields, missing NPC thoughts, unsupported deltas, missing evidence, unsafe knowledge transmission, incomplete off-screen review, and ineligible genesis.
3. Correct the prose or provider behavior, then use Rescan. A bounded second extraction attempt already receives the first candidate's validation errors.
4. Use Full when a capable model omits supported state families. Return to Lean when it extracts reliably.

A rejected candidate never replaces accepted state. Edits and regeneration stage the entire affected tail and atomically replace it only after every replacement turn validates against the same Chronicle revision. A concurrent transcript or state change aborts the commit.

Inline Compatibility follows the older state-block behavior: the narrative model emits `<vellum>`, and ARGENT receives one bounded automatic repair attempt when it is missing. Other VELLUM presets retain their opt-in repair setting.

### VELLUM is not updating

- Confirm the ARGENT preset is selected and linked to the current chat.
- Open VELLUM's health/status view and check the most recent turn.
- Under Engine Second Pass, inspect the compiler warning and `state.compiled` event rather than expecting a block in the assistant message.
- Under Inline Compatibility, confirm the stored assistant message ends with a complete `<vellum>...</vellum>` block.

### The model authors the player

- Use Forbidden (Strict) agency.
- Keep Final Agency Anchor on.
- Move Adherence Placement to Frontier.
- Leave Model Adapter on Auto for a model whose runtime name contains `claude`, or choose Claude explicitly if the provider hides/renames the model.
- Avoid directorial instructions that themselves specify player behavior.
- If using Second Person, remember that “you” is grammatical perspective, not permission to invent the player's action. The Claude hard gate now audits every player-subject predicate, including actions smuggled through passive voice, reaction, sensation, injury, or state JSON.

### The world is too busy

- Change Living World to Minimal.
- Change Social Autonomy to On-Screen Only.
- Turn Faction Politics off.
- Change World Texture to Backdrop.
- Lower Antagonist Pressure.

### The prose is rigid or over-corrected

- Change Craft Floor to Relaxed.
- Disable Craft Anchor while leaving Agency Anchor on.
- Deselect Anti-Slop families that belong to the intended voice.
- Use Adaptive Voice or Loom Style Only.
- Move Adherence Placement to Quiet.

### The prose is repetitive

- Keep Anti-Slop on with its full focus list.
- Change Narrative Variance to High Variance.
- Use Adaptive tonal cast or a deliberate non-default cast.
- Check that the character card itself is not repeating signature phrases.
- Keep the previous assistant turn in context; ARGENT's anti-echo instructions compare against it.

### The Prompt Variables panel looks stale

Reload Lumiverse after saving through VELLUM's embedded variable editor. This refreshes Lumiverse's in-memory preset copy.

## Do not casually disable these blocks

The preset editor exposes individual prompt blocks as well as variables. Leave the following enabled unless you are deliberately rebuilding the architecture:

- Authority, agency, reality, knowledge, and continuity contracts.
- ARGENT source doctrine markers, context markers, and final source contract. The runtime policy compiler resolves them into one effective contract.
- Context markers for character, persona, scenario, examples, world info, and chat history.
- Final output and adherence blocks.

Optional behavior should normally be controlled through the variables in this guide instead of disabling internal blocks. That preserves ordering and model-family compatibility.

## Reference

- [Lumiverse preset guide](https://lumiverse.chat/guides/presets/)
- [Lumiverse regex scripts guide](https://lumiverse.chat/guides/customization/regex-scripts/)
- VELLUM extension documentation: `../README.md`
