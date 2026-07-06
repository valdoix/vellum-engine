import type { VellumEvent, Category } from '../core/events.js';
import { canonId, nextSeq } from '../core/ids.js';
import { isCategory } from '../domain/category.js';
import { resolveCastId, notAName, resolveFactionId, isNameMash } from '../domain/identity.js';
import { adjustBond, DEFAULT_TONE, seedFactionStanding, type Tone } from '../domain/tone.js';
import type { ChronicleState } from '../domain/types.js';
import { internalGenerate } from '../host/generation.js';
import { has } from '../host/capability.js';

declare const spindle: any;

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
  + '"secrets":[{"secret":"one clause","keeper":"Name","from":"Name(s) comma-sep or omit","danger":"minor|major|explosive"}],'
  + '"journal":[{"who":"Name","about":"Name or omit","memory":"one vivid sentence from WHO\'S point of view","kind":"interaction|promise|betrayal|gift|shared|wound|observation","weight":"trivial|minor|significant|defining","sentiment":"positive|negative|neutral|complex"}],'
  + '"bonds":[{"a":"Name","b":"Name","aff":<int -40..40>,"trust":<int -40..40>,"cat":["familial|romantic|alliance|rivalry|social"],"why":"one clause"}],"factions":[{"name":"Group name","kind":"household|house|guild|order","members":["Name"],"standing":<int -40..40 toward the player, optional>}]}. '
  + 'RULES: use ONLY real character names that LITERALLY APPEAR in the prose excerpt below (the persona/player and the characters named in it), never placeholders or unnamed figures (a guard, a servant). '
  + 'NEVER invent a name, and NEVER substitute a different or more-famous name for the one written — if the prose says "Daeron", attribute to Daeron, never to "Rhaegar" or any other character, even if they seem related or similar. Copy the name EXACTLY as it appears. If you are unsure who acted, OMIT the entry rather than guess. '
  + 'EVERY NAMED CHARACTER COUNTS — not just the lead or the player. Attribute knowledge, secrets, and journal entries to side characters, rivals, family, and minor figures too whenever the prose gives them a real name; the chronicle tracks them all equally. '
  + 'KNOWLEDGE is the engine of dramatic irony — track the INFORMATION STATE. Extract when ANY character (including the player) learns, realizes, infers, overhears, confesses, or comes to wrongly believe something — e.g. "Cersei revealed her father beat her" => {who:"<listener>",fact:"<speaker>\'s father beat <speaker>"} AND a secret if it was hidden. '
  + 'reliability = the knower\'s stance (wrong = they believe something untrue); truth = the ACTUAL state regardless of belief (a mistaken belief is reliability:"wrong",truth:"false"); source = how they came to it. '
  + 'PREFER facts that create tension, irony, or asymmetric knowledge (someone believes a falsehood, someone hides something, one party knows what another does not). OMIT routine perceptions everyone present already shares ("the door was open", "it was cold") — those are not knowledge. '
  + 'SECRETS: extract when someone conceals something OR a hidden thing is revealed this excerpt (a confessed abuse, a hidden parentage, a lie). '
  + 'JOURNAL: extract genuine TURNING POINTS a character would personally carry — a confession, promise, betrayal, gift, wound, first kiss, a moment of being truly seen — written from that character\'s POV; the PLAYER can and should hold journal entries too. '
  + 'BONDS: aff/trust are the CHANGE this excerpt caused to how A feels toward B; omit pairs that did not move; cat only when the bond\'s nature changed. '
  + 'FACTIONS: name a GROUP (household staff, a house, a guild) when it acts, is referenced as a bloc, or a character belongs to one; list known members and the group\'s standing toward the player if it shifted. Capture every real reveal/turning-point that carries dramatic weight, invent nothing the prose does not support. Empty arrays are fine. '
  + 'PRESENT + INNER THOUGHT: for EACH individually-named character on-stage in this excerpt, emit a present[] entry with their current mood and what they are doing, and — this is the point — their `thought`: the genuine, unspoken first-person inner voice they carry through this beat, framed by ONLY what THAT character knows (never omniscient, never the narrator\'s summary). If the prose already renders a character\'s interiority (a line of free-indirect thought, a private fear, what they don\'t say aloud), capture it as `thought` in their own voice. Do NOT invent interiority the prose gives no basis for; omit `thought` when the character is a cipher this beat. NEVER emit a present entry for the player/persona ({{user}}) — their inner state is authored only by the player; and never for a group. '
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
 * Anti-hallucination / anti-misattribution gate for SUBJECT names (the knower,
 * keeper, journaller, bond endpoints, faction members). A character can only
 * LEARN/HOLD/ACT if they are actually in THIS turn's prose — so a subject name
 * is accepted only when it (or its first/last token) appears in the prose, OR is
 * the persona/{{char}}. This kills two failure classes at once:
 *   - pure hallucination (the model invents "Aegon" who isn't in the text)
 *   - misattribution to an off-scene cast member (writes "Rhaegar" for a Daeron
 *     scene — Rhaegar isn't in this prose, so it's dropped)
 *   - same-surname misfiling (writes "Tywin Lannister" when only "Cersei
 *     Lannister" is in the prose — a trailing SHARED token like "lannister" must
 *     not admit Tywin; require the given name, or a surname unique to one cast)
 * OBJECT slots (about / secret `from` / faction name) are NOT gated here: you can
 * learn a fact ABOUT someone absent. `proseTokens` is the lowercased word set of
 * the turn's narration. */
function buildProseTokens(prose: string): ProseTokens {
  // Scan the ORIGINAL text (not a lowercased copy) so casing survives: `all` is
  // every word seen (lowercased for lookup); `caps` is the subset that appeared
  // with an uppercase initial AT LEAST ONCE. A word in `all` but not in `caps`
  // occurred exclusively in lowercase — a common noun/adverb, never a name part.
  const all = new Set<string>();
  const caps = new Set<string>();
  for (const w of String(prose || '').match(/[A-Za-z][A-Za-z'-]{1,}/g) ?? []) {
    const lw = w.toLowerCase();
    all.add(lw);
    if (w[0] !== w[0]!.toLowerCase()) caps.add(lw); // uppercase initial
  }
  return { all, caps };
}
interface ProseTokens { all: Set<string>; caps: Set<string> }
const ARTICLE = new Set(['the', 'a', 'an']);
function inProse(name: string, prose: ProseTokens, userCanon: string, charCanon: string, cast?: Record<string, { id: string }>): boolean {
  const id = canonId(name);
  if (!id) return false;
  if (id === userCanon || id === charCanon) return true; // persona always counts
  const toks = id.split('_').filter((t) => t.length > 1 && !ARTICLE.has(t));
  if (!toks.length) return false;
  // POSITIVE NAME VALIDATOR (turns the blocklist into a whitelist for the shape
  // of a name): a real proper name is written in the prose with its words
  // capitalized. If ANY word of the candidate occurs in the prose but ONLY ever
  // lowercase, this candidate is a mis-segmented common-noun run the extractor
  // handed back as a name — "Daeron Partially" (partially), "The Research Box"
  // (research/box), "The Castle Morning" (castle) — and is rejected wholesale. A
  // word ABSENT from the prose (a fuller surname the extractor supplied, e.g.
  // "Targaryen" for a "Daeron" scene) carries no casing signal and is allowed.
  for (const t of toks) {
    if (prose.all.has(t) && !prose.caps.has(t)) return false;
  }
  const hit = toks.filter((t) => prose.all.has(t));
  if (!hit.length) return false;
  // the GIVEN name (first significant token) present = a confident match
  // ("Daeron" lands "Daeron Targaryen"; "Cersei" lands "Cersei Lannister").
  if (prose.all.has(toks[0]!)) return true;
  // otherwise ONLY a trailing token matched — typically a shared SURNAME. That is
  // the misattribution trap: "lannister" (from Cersei in the prose) must not admit
  // an off-scene "Tywin Lannister". Accept a surname-only match ONLY when no OTHER
  // cast member shares that token (so "Baelish" alone is fine, but a contested
  // surname is rejected and the entry is dropped rather than misfiled).
  if (!cast) return true; // no cast supplied (older callers/tests) → keep lenient
  const contested = Object.values(cast).some((c) => c.id !== id && hit.some((t) => c.id.split('_').includes(t)));
  return !contested;
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
  // resolve a raw name onto an existing cast id (merges "Cersei" with a known
  // "Cersei Lannister") so knowledge/secrets/journal don't split a character.
  const rid = (name: string): string => (state ? resolveCastId(state, name) : canonId(name));
  // local name-quality guard: junk (pronoun/group/abstraction) OR a mash of two
  // already-known people ("Daeron Cersei"). Shadows the module `bad` so the
  // extractor path gets the same mash protection as the block path.
  const knownPeople = state ? Object.keys(state.cast) : [];
  const badN = (name: string): boolean => bad(name) || (knownPeople.length > 0 && isNameMash(name, knownPeople));
  const userCanon = names.user ? canonId(names.user) : '';
  const charCanon = names.char ? canonId(names.char) : '';
  // subject-name gate: a knower/holder/actor must be in THIS prose (or persona).
  // When no prose is supplied (older callers/tests), the gate is a no-op so
  // behaviour is unchanged. OBJECT names (about/from/faction) bypass it.
  const tokens = prose ? buildProseTokens(prose) : null;
  const present = (name: string): boolean => !tokens || inProse(name, tokens, userCanon, charCanon, state?.cast);

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
    if (badN(who) || !present(who)) continue;
    const id = rid(who);
    if (id === userCanon) continue; // never author the player's inner state
    if (seenPres.has(id)) continue;
    seenPres.add(id);
    presIds.push(id);
    const mood = String(p?.mood || '').trim().slice(0, 80) || undefined;
    const doing = String(p?.doing || '').trim().slice(0, 160) || undefined;
    const condition = String(p?.condition || '').trim().slice(0, 80) || undefined;
    const thought = String(p?.thought || '').trim().slice(0, 300) || undefined;
    presDetail.push({ id, ...(mood ? { mood } : {}), ...(doing ? { doing } : {}), ...(condition ? { condition } : {}), ...(thought ? { thought } : {}) });
    // seed/refresh the cast card so a first-seen on-stage character exists
    out.push({ ...base(), kind: 'cast.seen', id, name: who, status: 'present' } as VellumEvent);
  }
  if (presDetail.some((d) => d.mood || d.doing || d.condition || d.thought) || presIds.length) {
    out.push({ ...base(), kind: 'scene.set', present: presIds, detail: presDetail, mergeDetail: true } as VellumEvent);
  }

  for (const k of Array.isArray(obj.knowledge) ? obj.knowledge : []) {
    const who = realName(k?.who, names); const fact = String(k?.fact || '').trim();
    if (badN(who) || !fact || !present(who)) continue;
    const about = realName(k?.about, names);
    const reliability = REL.has(String(k?.reliability)) ? k.reliability : undefined;
    const truth = TRU.has(String(k?.truth)) ? k.truth : undefined;
    const source = String(k?.source || '').trim().slice(0, 120) || undefined;
    out.push({ ...base(), kind: 'knowledge.learn', who: rid(who), fact, ...(about && !badN(about) ? { about: rid(about) } : {}), ...(reliability ? { reliability } : {}), ...(truth ? { truth } : {}), ...(source ? { source } : {}) } as VellumEvent);
  }
  let si = 0;
  for (const s of Array.isArray(obj.secrets) ? obj.secrets : []) {
    const keeper = realName(s?.keeper, names); const text = String(s?.secret || s?.text || '').trim();
    if (badN(keeper) || !text || !present(keeper)) continue;
    const from = String(s?.from || '').split(',').map((x: string) => realName(x, names)).filter((x: string) => x && !badN(x)).map(rid);
    out.push({ ...base(), kind: 'secret.form', id: 'sec_' + turn + '_' + (si++), keeper: rid(keeper), from, text } as VellumEvent);
  }
  let ji = 0;
  for (const j of Array.isArray(obj.journal) ? obj.journal : []) {
    const who = realName(j?.who, names); const memory = String(j?.memory || '').trim();
    if (badN(who) || !memory || !present(who)) continue;
    const about = realName(j?.about, names);
    out.push({ ...base(), kind: 'journal.entry', id: 'mj_' + rid(who) + '_' + turn + '_' + (ji++), who: rid(who), ...(about && !badN(about) ? { about: rid(about) } : {}), memory, jkind: jk(j?.kind), weight: jw(j?.weight), sentiment: js(j?.sentiment) } as VellumEvent);
  }
  for (const b of Array.isArray(obj.bonds) ? obj.bonds : []) {
    const a = realName(b?.a, names), bb = realName(b?.b, names);
    if (badN(a) || badN(bb) || rid(a) === rid(bb) || !present(a) || !present(bb)) continue;
    const cats = (Array.isArray(b?.cat) ? b.cat : []).map((c: string) => String(c).toLowerCase()).filter(isCategory) as Category[];
    const aff = clamp(b?.aff), trust = clamp(b?.trust);
    if (!aff && !trust && !cats.length) continue;
    const ra = rid(a), rb = rid(bb);
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
    for (const mn of members) { const m = realName(mn, names); if (m && !badN(m) && present(m)) out.push({ ...base(), kind: 'faction.member', char: rid(m), faction: fid, op: 'add' } as VellumEvent); }
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
  const gen = await internalGenerate(
    [{ role: 'system', content: EXTRACT_SYS }, { role: 'user', content: prose.slice(0, 8000) }],
    { temperature: 0.2, max_tokens: 900 },
    userId,
    { reasoningOff: true, responseFormat: EXTRACT_SCHEMA, timeoutMs: 45000 },
  );
  if (!gen.ok) return [];
  const obj = parseJson(gen.value);
  return mapExtracted(obj, turn, day, names, nextSeq, state, tone, prose);
}

// JSON-schema for the extractor output. Best-effort: the host enforces it only
// when generation_parameters is granted (else it's stripped and we still parse
// defensively). Guarantees the prose fallback yields parseable JSON so a turn
// that omitted its <vellum> block still mines knowledge/secrets/bonds/journal.
const EXTRACT_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'vellum_extract',
    strict: false,
    schema: {
      type: 'object',
      properties: {
        present: { type: 'array', items: { type: 'object', properties: {
          who: { type: 'string' }, mood: { type: 'string' }, doing: { type: 'string' },
          condition: { type: 'string' }, thought: { type: 'string' },
        }, required: ['who'] } },
        knowledge: { type: 'array', items: { type: 'object', properties: {
          who: { type: 'string' }, fact: { type: 'string' }, about: { type: 'string' },
          reliability: { type: 'string', enum: ['knows', 'believes', 'suspects', 'wrong', 'unaware'] },
          truth: { type: 'string', enum: ['true', 'false', 'unknown'] }, source: { type: 'string' },
        }, required: ['who', 'fact'] } },
        secrets: { type: 'array', items: { type: 'object', properties: {
          keeper: { type: 'string' }, secret: { type: 'string' }, from: { type: 'string' }, danger: { type: 'string' },
        }, required: ['keeper', 'secret'] } },
        journal: { type: 'array', items: { type: 'object', properties: {
          who: { type: 'string' }, about: { type: 'string' }, memory: { type: 'string' },
          kind: { type: 'string' }, weight: { type: 'string' }, sentiment: { type: 'string' },
        }, required: ['who', 'memory'] } },
        bonds: { type: 'array', items: { type: 'object', properties: {
          a: { type: 'string' }, b: { type: 'string' }, aff: { type: 'number' }, trust: { type: 'number' },
          cat: { type: 'array', items: { type: 'string' } }, why: { type: 'string' },
        }, required: ['a', 'b'] } },
        factions: { type: 'array', items: { type: 'object', properties: {
          name: { type: 'string' }, kind: { type: 'string' },
          members: { type: 'array', items: { type: 'string' } }, standing: { type: 'number' },
        }, required: ['name'] } },
      },
    },
  },
} as const;

const clamp = (v: unknown): number => Math.max(-40, Math.min(40, Math.round(Number(v) || 0)));
const REL = new Set(['knows', 'believes', 'suspects', 'wrong', 'unaware']);
const TRU = new Set(['true', 'false', 'unknown']);
const jk = (v: unknown): any => (['interaction', 'promise', 'betrayal', 'gift', 'shared', 'wound', 'observation'].includes(String(v)) ? v : 'interaction');
const jw = (v: unknown): any => (['trivial', 'minor', 'significant', 'defining'].includes(String(v)) ? v : 'minor');
const js = (v: unknown): any => (['positive', 'negative', 'neutral', 'complex'].includes(String(v)) ? v : 'neutral');
