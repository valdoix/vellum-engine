import type { VellumEvent, Category } from '../core/events.js';
import { canonId, nextSeq } from '../core/ids.js';
import { isCategory } from '../domain/category.js';
import { resolveCastId, notAName, resolveFactionId, isNameMash } from '../domain/identity.js';
import { adjustBond, DEFAULT_TONE, seedFactionStanding, type Tone } from '../domain/tone.js';
import type { ChronicleState } from '../domain/types.js';
import { internalGenerate } from '../host/generation.js';
import { has } from '../host/capability.js';

declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

/**
 * PROSE-DRIVEN EXTRACTOR (the legacy LIVING_SYS pass, rebuilt). The model writes
 * scene/bonds in its <vellum> block, but knowledge, secrets, and the per-
 * character memory journal are best mined from the PROSE — not hand-authored.
 * This reads the turn's narrative (state block stripped) and surfaces what it
 * newly establishes, attributing to REAL names (incl. the player's persona), so
 * {{user}} gets journal entries and quiet reveals ("his father beat him") are
 * captured even when the model never put them in the block.
 *
 * Capability-gated on `generation`; degrades to nothing if unavailable. Pure
 * mapping of the LLM's JSON → events; the LLM call is the only I/O.
 */

const EXTRACT_SYS =
  'You are the LIVING-STATE EXTRACTOR for a roleplay. Read the RECENT NARRATIVE PROSE and surface what it newly '
  + 'establishes. Output STRICT JSON only, no prose outside it: '
  + '{"present":[{"who":"Name","mood":"one-word emotion or short phrase","doing":"what they are physically doing right now","condition":"physical state e.g. wounded|exhausted, or omit","thought":"their genuine first-person INNER VOICE this beat, under what THEY know, or omit"}],'
  + '"knowledge":[{"who":"Name","fact":"one clause","reliability":"knows|believes|suspects|wrong|unaware","truth":"true|false|unknown","source":"how they learned it, brief or omit","about":"Name or omit"}],'
  + '"secrets":[{"secret":"one clause","keeper":"Name","from":["Name"],"danger":"minor|major|explosive"}],'
  + '"journal":[{"who":"Name","about":"Name or omit","memory":"one vivid sentence from WHO\'S point of view","kind":"interaction|promise|betrayal|gift|shared|wound|observation","weight":"trivial|minor|significant|defining","sentiment":"positive|negative|neutral|complex"}],'
  + '"bonds":[{"a":"Name","b":"Name","aff":<int -40..40>,"trust":<int -40..40>,"cat":["familial|romantic|alliance|rivalry|social"],"why":"one clause"}],"factions":[{"name":"Group name","kind":"household|house|guild|order","members":["Name"],"standing":<int -40..40 toward the player, optional>}]}. '
  + 'RULES: every character-valued slot (who, about, keeper, from, a, b, and faction members) may contain ONLY one exact label copied from the KNOWN CHARACTERS roster. Do not expand, shorten, combine, infer, translate, title, or normalize a roster label. A capitalized object, place, time, event, title, role, group, descriptor, or narrative phrase is NOT a character. If the exact character label is absent from the roster, OMIT that field or entry; the canonical state pass, not this supplemental prose pass, creates new cast identities. '
  + 'For subjects/actors, that exact roster label must also LITERALLY APPEAR as a complete name in the prose excerpt (except the persona/player). A substring or shared surname is not a match. Never use placeholders, pronouns, or unnamed figures (a guard, a servant). '
  + 'NEVER invent a name, and NEVER substitute a different or more-famous name for the one written — if the prose says "Daeron", attribute to Daeron, never to "Rhaegar" or any other character, even if they seem related or similar. Copy the name EXACTLY as it appears. If you are unsure who acted, OMIT the entry rather than guess. '
  + 'EVERY ROSTERED NAMED CHARACTER COUNTS — not just the lead or the player. Attribute knowledge, secrets, and journal entries to side characters, rivals, family, and minor figures too whenever the prose uses their rostered name; the chronicle tracks them all equally. '
  + 'KNOWLEDGE is the engine of dramatic irony — track the INFORMATION STATE. Extract when ANY character (including the player) learns, realizes, infers, overhears, confesses, or comes to wrongly believe something — e.g. "Cersei revealed her father beat her" => {who:"<listener>",fact:"<speaker>\'s father beat <speaker>"} AND a secret if it was hidden. '
  + 'reliability = the knower\'s stance (wrong = they believe something untrue); truth = the ACTUAL state regardless of belief (a mistaken belief is reliability:"wrong",truth:"false"); source = how they came to it. '
  + 'PREFER facts that create tension, irony, or asymmetric knowledge (someone believes a falsehood, someone hides something, one party knows what another does not). OMIT routine perceptions everyone present already shares ("the door was open", "it was cold") — those are not knowledge. '
  + 'SECRETS: extract when someone conceals something OR a hidden thing is revealed this excerpt (a confessed abuse, a hidden parentage, a lie). '
  + 'JOURNAL: extract genuine TURNING POINTS a character would personally carry — a confession, promise, betrayal, gift, wound, first kiss, a moment of being truly seen — written from that character\'s POV; the PLAYER can and should hold journal entries too. '
  + 'BONDS: aff/trust are the CHANGE this excerpt caused to how A feels toward B; omit pairs that did not move; cat only when the bond\'s nature changed. '
  + 'FACTIONS: name a GROUP (household staff, a house, a guild) when it acts, is referenced as a bloc, or a character belongs to one; list known members and the group\'s standing toward the player if it shifted. Capture every real reveal/turning-point that carries dramatic weight, invent nothing the prose does not support. Empty arrays are fine. '
  + 'PRESENT + INNER THOUGHT: for EACH rostered, individually-named character on-stage in this excerpt, emit a present[] entry with their current mood and what they are doing, and — this is the point — their `thought`: the genuine, unspoken first-person inner voice they carry through this beat, framed by ONLY what THAT character knows (never omniscient, never the narrator\'s summary). If the prose already renders a character\'s interiority (a line of free-indirect thought, a private fear, what they don\'t say aloud), capture it as `thought` in their own voice. Do NOT invent interiority the prose gives no basis for; omit `thought` when the character is a cipher this beat. NEVER emit a present entry for the player/persona ({{user}}) — their inner state is authored only by the player; and never for a group. '
  + 'CRITICAL: a COLLECTIVE or GROUP is a FACTION, never a character. "The household staff", "the court", "the Kingsguard", "the guards", "the council", "House Lannister" are GROUPS — put them ONLY in factions[].name (with members), NEVER in a who/a/b/keeper/present character slot. Those slots take individual named people only. If a group already exists (see the FACTIONS list in context), reuse its EXACT name; do not coin a synonym.';

function parseJson(text: string): any | null {
  let t = String(text || '').replace(/<think[\s\S]*?<\/think>/gi, '').replace(/```[a-z]*\n?|```/gi, '').trim();
  try { return JSON.parse(t); } catch { /* try substring */ }
  const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { return null; } }
  return null;
}

/** Replace {{user}}/{{char}}/you with real names so attribution lands. */
function realName(raw: string, names: { user: string; char: string }): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^\{\{?\s*user\s*\}?\}$|^you$/i.test(s)) return names.user || s;
  if (/^\{\{?\s*char\s*\}?\}$/i.test(s)) return names.char || s;
  return s;
}
function bad(name: string): boolean {
  // shared name-quality guard: rejects empty, placeholders, pronouns/deixis,
  // and bare lowercase generics. "The Stranger"/"Anne" pass; "she"/"a guard" fail.
  return notAName(name);
}

/**
 * Anti-hallucination / anti-misattribution gate for character references. A
 * character can only LEARN/HOLD/ACT if they are actually in THIS turn's prose,
 * and the supplemental prose pass may only refer to a cast identity already
 * established by the canonical state pass (plus the persona/{{char}}). This
 * kills three failure classes at once:
 *   - pure hallucination (the model invents "Aegon" who isn't in the text)
 *   - misattribution to an off-scene cast member (writes "Rhaegar" for a Daeron
 *     scene — Rhaegar isn't in this prose, so it's dropped)
 *   - capitalized non-characters ("Morning", "The Letter", a location) that
 *     happen to occur literally and previously passed the casing-only filter
 *   - same-surname misfiling (writes "Tywin Lannister" when only "Cersei
 *     Lannister" is in the prose — a trailing token like "lannister" must not
 *     admit Tywin; surnames are never synthesized as roster labels)
 * An OBJECT character slot (about / secret `from`) may still name someone absent
 * from this turn, but only when it resolves to that established cast. Faction
 * names use their separate identity namespace. */
const HONORIFIC = new Set([
  'mr', 'mr.', 'mrs', 'mrs.', 'ms', 'ms.', 'miss', 'dr', 'dr.', 'sir', 'ser',
  'lady', 'lord', 'king', 'queen', 'prince', 'princess', 'duke', 'duchess',
  'count', 'countess', 'captain', 'commander', 'master', 'mistress', 'father',
  'mother', 'brother', 'sister', 'saint', 'st', 'st.',
]);

/** Case-insensitive, punctuation-preserving key for an exact roster label. */
function nameKey(raw: string): string {
  return String(raw || '').normalize('NFKC').replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
}

function firstNameForm(raw: string): string {
  const words = String(raw || '').normalize('NFKC').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length < 2) return '';
  while (words.length > 1 && HONORIFIC.has(words[0]!.toLowerCase())) words.shift();
  // Do not manufacture a shorthand from an article-led epithet ("The Hound")
  // or from a one-token remainder. Such forms must be explicit aliases.
  if (words.length < 2 || /^(a|an|the)$/i.test(words[0]!)) return '';
  const first = words[0]!;
  return bad(first) ? '' : first;
}

function literalNameInProse(label: string, prose: string): boolean {
  const normalized = String(prose || '').normalize('NFKC').replace(/[\u2018\u2019]/g, "'");
  const phrase = String(label || '').normalize('NFKC').replace(/[\u2018\u2019]/g, "'").trim()
    .split(/\s+/).filter(Boolean).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  if (!phrase) return false;
  // Unicode letter/number boundaries prevent "Ann" from matching "Anne" and
  // preserve non-Latin character names. Punctuation inside the label is exact.
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${phrase}(?=$|[^\\p{L}\\p{N}_])`, 'iu').test(normalized);
}

interface CharacterRoster {
  /** Exact normalized label -> candidate ids. More than one candidate is unsafe. */
  idsByLabel: Map<string, Set<string>>;
  /** Original-cased labels, including unambiguous derived first names. */
  displayByLabel: Map<string, string>;
  labelsById: Map<string, Set<string>>;
  canonicalById: Map<string, string>;
  userId: string;
  charId: string;
}

/**
 * Build the supplemental extractor's CLOSED character vocabulary. Canonical
 * cast names and declared aliases are accepted exactly. The sole derived form
 * is an unambiguous given name ("Daeron" for "Daeron Targaryen"); surnames,
 * prefixes, titles, and arbitrary token fragments are never derived.
 */
function buildCharacterRoster(state: ChronicleState | undefined, names: { user: string; char: string }): CharacterRoster {
  const idsByLabel = new Map<string, Set<string>>();
  const displayByLabel = new Map<string, string>();
  const labelsById = new Map<string, Set<string>>();
  const canonicalById = new Map<string, string>();
  const add = (labelRaw: string, idRaw: string, canonicalRaw?: string): void => {
    const label = String(labelRaw || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    const id = String(idRaw || '').trim();
    const key = nameKey(label);
    if (!label || !id || !key || bad(label)) return;
    const ids = idsByLabel.get(key) ?? new Set<string>();
    ids.add(id);
    idsByLabel.set(key, ids);
    if (!displayByLabel.has(key)) displayByLabel.set(key, label);
    const labels = labelsById.get(id) ?? new Set<string>();
    labels.add(label);
    labelsById.set(id, labels);
    if (canonicalRaw && !canonicalById.has(id)) canonicalById.set(id, canonicalRaw);
  };

  for (const [key, card] of Object.entries(state?.cast ?? {})) {
    const id = card.id || key;
    const canonical = String(card.name || '').trim() || id;
    canonicalById.set(id, canonical);
    add(canonical, id, canonical);
    for (const alias of card.aka ?? []) add(alias, id, canonical);
  }

  // Trusted roots may exist before a cast card does. They can use the normal
  // resolver only to bind onto a pre-existing card; no other extractor output
  // receives fuzzy resolution authority.
  const rootId = (label: string): string => {
    const exact = idsByLabel.get(nameKey(label));
    if (exact?.size === 1) return Array.from(exact)[0]!;
    const resolved = state ? resolveCastId(state, label) : canonId(label);
    return resolved && state?.cast[resolved] ? resolved : canonId(label);
  };
  const userId = names.user ? rootId(names.user) : '';
  const charId = names.char ? rootId(names.char) : '';
  if (names.user && userId) add(names.user, userId, state?.cast[userId]?.name || names.user);
  if (names.char && charId) add(names.char, charId, state?.cast[charId]?.name || names.char);

  // Snapshot explicit labels before adding derived forms, so derivation never
  // chains. Collisions stay in the map and are rejected at lookup time.
  const explicit = Array.from(labelsById.entries()).flatMap(([id, labels]) =>
    Array.from(labels).map((label) => ({ id, label })),
  );
  for (const { id, label } of explicit) {
    const first = firstNameForm(label);
    if (first) add(first, id, canonicalById.get(id) || label);
  }

  return { idsByLabel, displayByLabel, labelsById, canonicalById, userId, charId };
}

function rosterLabels(roster: CharacterRoster): string[] {
  const out: string[] = [];
  for (const [key, ids] of roster.idsByLabel) {
    if (ids.size === 1) out.push(roster.displayByLabel.get(key)!);
  }
  return out;
}

/**
 * PURE mapping: extractor JSON → events (src:'living'). Split out from the host
 * call so it is unit-testable without `generation`/`internalGenerate` — which is
 * exactly why bugs here (the `bad(b)` typo, the over-eager name filter) shipped
 * uncaught. `seqFn` defaults to the global monotonic seq; tests can inject one.
 */
export function mapExtracted(obj: any, turn: number, day: number, names: { user: string; char: string }, seqFn: () => number = nextSeq, state?: ChronicleState, tone: Tone = DEFAULT_TONE, prose = ''): VellumEvent[] {
  if (!obj || typeof obj !== 'object') return [];
  const out: VellumEvent[] = [];
  const base = () => ({ seq: seqFn(), turn, day, src: 'living' as const });
  // Legacy callers without prose keep the historical mapper. Production prose
  // extraction uses a closed roster and never gives model output fuzzy identity
  // resolution authority.
  const legacyId = (name: string): string => (state ? resolveCastId(state, name) : canonId(name));
  // local name-quality guard: junk (pronoun/group/abstraction) OR a mash of two
  // already-known people ("Daeron Cersei"). Shadows the module `bad` so the
  // extractor path gets the same mash protection as the block path.
  const knownPeople = state ? Object.keys(state.cast) : [];
  const badN = (name: string): boolean => bad(name) || (knownPeople.length > 0 && isNameMash(name, knownPeople));
  const strictRoster = prose ? buildCharacterRoster(state, names) : null;
  const userCanon = strictRoster?.userId || (names.user ? canonId(names.user) : '');
  const exactRosterId = (name: string): string | undefined => {
    if (!name || badN(name)) return undefined;
    if (!strictRoster) return legacyId(name);
    const ids = strictRoster.idsByLabel.get(nameKey(name));
    return ids?.size === 1 ? Array.from(ids)[0]! : undefined;
  };
  const mentioned = new Set<string>();
  if (strictRoster) {
    for (const [id, labels] of strictRoster.labelsById) {
      if (Array.from(labels).some((label) => literalNameInProse(label, prose))) mentioned.add(id);
    }
  }
  // A subject must be an exact roster label AND be named in this prose. Only the
  // player persona is exempt because first-person prose commonly omits its name;
  // {{char}} no longer receives that exemption.
  const subjectId = (name: string): string | undefined => {
    const id = exactRosterId(name);
    if (!id) return undefined;
    return !strictRoster || id === userCanon || mentioned.has(id) ? id : undefined;
  };
  // about/from can point at an off-scene character, but still require one exact,
  // unambiguous roster label and can never create a cast identity.
  const objectId = (name: string): string | undefined => exactRosterId(name);
  const canonicalName = (id: string, fallback: string): string =>
    strictRoster?.canonicalById.get(id) || state?.cast[id]?.name || fallback;

  // PRESENT + INNER THOUGHT recovery: rebuild the on-stage roster and per-
  // character detail (mood/doing/condition/thought) from prose so a dropped or
  // truncated <vellum> block doesn't lose interiority. Emitted as a NON-
  // authoritative scene.set (mergeDetail:true) that only fills gaps — never
  // demotes cast or overwrites the block's authored detail. The player is never
  // given interiority here (authored only by {{user}}); a group is never present.
  const presIds: string[] = [];
  const presDetail: Array<{ id: string; mood?: string; doing?: string; condition?: string; thought?: string }> = [];
  const seenPres = new Set<string>();
  for (const p of Array.isArray(obj.present) ? obj.present : []) {
    const who = realName(p?.who, names);
    const id = subjectId(who);
    if (!id) continue;
    if (id === userCanon) continue; // never author the player's inner state
    if (seenPres.has(id)) continue;
    seenPres.add(id);
    presIds.push(id);
    const mood = String(p?.mood || '').trim().slice(0, 80) || undefined;
    const doing = String(p?.doing || '').trim().slice(0, 160) || undefined;
    const condition = String(p?.condition || '').trim().slice(0, 80) || undefined;
    const thought = String(p?.thought || '').trim().slice(0, 300) || undefined;
    presDetail.push({ id, ...(mood ? { mood } : {}), ...(doing ? { doing } : {}), ...(condition ? { condition } : {}), ...(thought ? { thought } : {}) });
    // Refresh under the canonical cast label, never under model-returned casing
    // or a shorthand/alias. Trusted roots are the only possible first seeds.
    out.push({ ...base(), kind: 'cast.seen', id, name: canonicalName(id, who), status: 'present' } as VellumEvent);
  }
  if (presDetail.some((d) => d.mood || d.doing || d.condition || d.thought) || presIds.length) {
    out.push({ ...base(), kind: 'scene.set', present: presIds, detail: presDetail, mergeDetail: true } as VellumEvent);
  }

  for (const k of Array.isArray(obj.knowledge) ? obj.knowledge : []) {
    const who = realName(k?.who, names); const fact = String(k?.fact || '').trim();
    const whoId = subjectId(who);
    if (!whoId || !fact) continue;
    const about = realName(k?.about, names);
    const aboutId = objectId(about);
    const reliability = REL.has(String(k?.reliability)) ? k.reliability : undefined;
    const truth = TRU.has(String(k?.truth)) ? k.truth : undefined;
    const source = String(k?.source || '').trim().slice(0, 120) || undefined;
    out.push({ ...base(), kind: 'knowledge.learn', who: whoId, fact, ...(aboutId ? { about: aboutId } : {}), ...(reliability ? { reliability } : {}), ...(truth ? { truth } : {}), ...(source ? { source } : {}) } as VellumEvent);
  }
  let si = 0;
  for (const s of Array.isArray(obj.secrets) ? obj.secrets : []) {
    const keeper = realName(s?.keeper, names); const text = String(s?.secret || s?.text || '').trim();
    const keeperId = subjectId(keeper);
    if (!keeperId || !text) continue;
    const fromRaw: unknown[] = Array.isArray(s?.from) ? s.from : String(s?.from || '').split(',');
    const from = fromRaw.map((x: unknown) => objectId(realName(String(x || ''), names))).filter((x): x is string => !!x);
    out.push({ ...base(), kind: 'secret.form', id: 'sec_' + turn + '_' + (si++), keeper: keeperId, from, text } as VellumEvent);
  }
  let ji = 0;
  for (const j of Array.isArray(obj.journal) ? obj.journal : []) {
    const who = realName(j?.who, names); const memory = String(j?.memory || '').trim();
    const whoId = subjectId(who);
    if (!whoId || !memory) continue;
    const about = realName(j?.about, names);
    const aboutId = objectId(about);
    out.push({ ...base(), kind: 'journal.entry', id: 'mj_' + whoId + '_' + turn + '_' + (ji++), who: whoId, ...(aboutId ? { about: aboutId } : {}), memory, jkind: jk(j?.kind), weight: jw(j?.weight), sentiment: js(j?.sentiment) } as VellumEvent);
  }
  for (const b of Array.isArray(obj.bonds) ? obj.bonds : []) {
    const a = realName(b?.a, names), bb = realName(b?.b, names);
    const ra = subjectId(a), rb = subjectId(bb);
    if (!ra || !rb || ra === rb) continue;
    const cats = (Array.isArray(b?.cat) ? b.cat : []).map((c: string) => String(c).toLowerCase()).filter(isCategory) as Category[];
    const aff = clamp(b?.aff), trust = clamp(b?.trust);
    if (!aff && !trust && !cats.length) continue;
    const existing = state?.relations.find((r) => r.a === ra && r.b === rb);
    const romantic = cats.includes('romantic' as Category) || !!(existing?.categories?.includes('romantic'));
    const adj = adjustBond(
      { a: ra, b: rb, ...(aff ? { aff } : {}), ...(trust ? { trust } : {}), ...(cats.length ? { addCats: cats } : {}) },
      tone,
      { userId: userCanon, relExists: !!existing, romantic },
    );
    if (!adj) continue;
    out.push({ ...base(), kind: 'bond.delta', a: ra, b: rb, ...(typeof adj.aff === 'number' ? { aff: adj.aff } : {}), ...(typeof adj.trust === 'number' ? { trust: adj.trust } : {}), ...(adj.addCats?.length ? { addCats: adj.addCats as Category[] } : {}), ...(b?.why ? { why: String(b.why) } : {}) } as VellumEvent);
  }
  for (const fx of Array.isArray(obj.factions) ? obj.factions : []) {
    const name = String(fx?.name || '').trim();
    if (!name || notAName(name)) continue;
    const fid = state ? resolveFactionId(state, name) : ('fac:' + canonId(name));
    if (!fid) continue;
    const isNew = !state?.factions?.[fid];
    out.push({ ...base(), kind: 'faction.seen', id: fid, name, status: 'active' } as VellumEvent);
    if (fx?.kind) out.push({ ...base(), kind: 'faction.edit', id: fid, patch: { kind: String(fx.kind) } } as VellumEvent);
    const members = Array.isArray(fx?.members) ? fx.members : String(fx?.members || '').split(',');
    for (const mn of members) {
      const m = realName(String(mn || ''), names);
      const memberId = subjectId(m);
      if (memberId) out.push({ ...base(), kind: 'faction.member', char: memberId, faction: fid, op: 'add' } as VellumEvent);
    }
    const seed = isNew ? seedFactionStanding(tone) : 0;
    const delta = (Number.isFinite(fx?.standing) ? clamp(fx.standing) : 0) + seed;
    if (delta) out.push({ ...base(), kind: 'faction.standing', faction: fid, standing: Math.max(-100, Math.min(100, delta)) } as VellumEvent);
  }
  return out;
}

/**
 * Run the extractor on a turn's prose. Returns events (src:'living'). The caller
 * supplies turn/day, the resolved persona/char names, and the prior chronicle
 * state (for cast-id resolution). No-op without generation permission/empty prose.
 */
export async function extractFromProse(prose: string, turn: number, day: number, names: { user: string; char: string }, userId: string | null, state?: ChronicleState, tone: Tone = DEFAULT_TONE): Promise<VellumEvent[]> {
  if (!prose || !prose.trim() || !(await has('generation'))) return [];
  const roster = rosterLabels(buildCharacterRoster(state, names)).slice(0, 250);
  const factions = Object.values(state?.factions ?? {}).map((f) => f.name).filter(Boolean).slice(0, 100);
  const context = '[KNOWN CHARACTERS]\n' + (roster.length ? roster.join('\n') : '(none)')
    + '\n\n[KNOWN FACTIONS]\n' + (factions.length ? factions.join('\n') : '(none)')
    + '\n\n[RECENT NARRATIVE PROSE]\n' + prose.slice(0, 8000);
  const gen = await internalGenerate(
    [{ role: 'system', content: EXTRACT_SYS }, { role: 'user', content: context }],
    { temperature: 0.2, max_tokens: 900 },
    userId,
    { reasoningOff: true, responseFormat: extractSchema(roster), timeoutMs: 45000 },
  );
  if (!gen.ok) return [];
  const obj = parseJson(gen.value);
  return mapExtracted(obj, turn, day, names, nextSeq, state, tone, prose);
}

// JSON-schema for the extractor output. Best-effort: the host enforces it only
// when generation_parameters is granted (else it's stripped and we still parse
// defensively). Guarantees the prose fallback yields parseable JSON so a turn
// that omitted its <vellum> block still mines knowledge/secrets/bonds/journal.
function extractSchema(roster: string[]) {
  // Constrain character slots at generation time as well as at deterministic
  // mapping time. Providers that honor response_format cannot emit arbitrary
  // prose phrases into cast fields; providers that ignore it still hit the
  // closed-roster gate above.
  const allowed = roster.length ? roster : ['__NO_KNOWN_CHARACTER__'];
  const character = () => ({ type: 'string', enum: allowed });
  return {
    type: 'json_schema',
    json_schema: {
      name: 'vellum_extract',
      strict: false,
      schema: {
        type: 'object',
        properties: {
          present: { type: 'array', items: { type: 'object', properties: {
            who: character(), mood: { type: 'string' }, doing: { type: 'string' },
            condition: { type: 'string' }, thought: { type: 'string' },
          }, required: ['who'] } },
          knowledge: { type: 'array', items: { type: 'object', properties: {
            who: character(), fact: { type: 'string' }, about: character(),
            reliability: { type: 'string', enum: ['knows', 'believes', 'suspects', 'wrong', 'unaware'] },
            truth: { type: 'string', enum: ['true', 'false', 'unknown'] }, source: { type: 'string' },
          }, required: ['who', 'fact'] } },
          secrets: { type: 'array', items: { type: 'object', properties: {
            keeper: character(), secret: { type: 'string' }, from: { type: 'array', items: character() }, danger: { type: 'string' },
          }, required: ['keeper', 'secret'] } },
          journal: { type: 'array', items: { type: 'object', properties: {
            who: character(), about: character(), memory: { type: 'string' },
            kind: { type: 'string' }, weight: { type: 'string' }, sentiment: { type: 'string' },
          }, required: ['who', 'memory'] } },
          bonds: { type: 'array', items: { type: 'object', properties: {
            a: character(), b: character(), aff: { type: 'number' }, trust: { type: 'number' },
            cat: { type: 'array', items: { type: 'string' } }, why: { type: 'string' },
          }, required: ['a', 'b'] } },
          factions: { type: 'array', items: { type: 'object', properties: {
            name: { type: 'string' }, kind: { type: 'string' },
            members: { type: 'array', items: character() }, standing: { type: 'number' },
          }, required: ['name'] } },
        },
      },
    },
  } as const;
}

const clamp = (v: unknown): number => Math.max(-40, Math.min(40, Math.round(Number(v) || 0)));
const REL = new Set(['knows', 'believes', 'suspects', 'wrong', 'unaware']);
const TRU = new Set(['true', 'false', 'unknown']);
const jk = (v: unknown): any => (['interaction', 'promise', 'betrayal', 'gift', 'shared', 'wound', 'observation'].includes(String(v)) ? v : 'interaction');
const jw = (v: unknown): any => (['trivial', 'minor', 'significant', 'defining'].includes(String(v)) ? v : 'minor');
const js = (v: unknown): any => (['positive', 'negative', 'neutral', 'complex'].includes(String(v)) ? v : 'neutral');
