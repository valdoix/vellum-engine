import type { VellumEvent, Category } from '../core/events.js';
import { canonId, nextSeq } from '../core/ids.js';
import { isCategory } from '../domain/category.js';
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
  + '{"knowledge":[{"who":"Name","fact":"one clause","reliability":"knows|believes|suspects|wrong|unaware","about":"Name or omit"}],'
  + '"secrets":[{"secret":"one clause","keeper":"Name","from":"Name(s) comma-sep or omit","danger":"minor|major|explosive"}],'
  + '"journal":[{"who":"Name","about":"Name or omit","memory":"one vivid sentence from WHO\'S point of view","kind":"interaction|promise|betrayal|gift|shared|wound|observation","weight":"trivial|minor|significant|defining","sentiment":"positive|negative|neutral|complex"}],'
  + '"bonds":[{"a":"Name","b":"Name","aff":<int -40..40>,"trust":<int -40..40>,"cat":["familial|romantic|alliance|rivalry|social"],"why":"one clause"}]}. '
  + 'RULES: use ONLY real character names that appear in the prose (the persona/player and the characters), never placeholders or unnamed figures (a guard, a servant). '
  + 'KNOWLEDGE: extract whenever ANY character (including the player) learns, realizes, infers, overhears, confesses, or comes to wrongly believe something — e.g. "Cersei revealed her father beat her" => {who:"<listener>",fact:"<speaker>\'s father beat <speaker>"} AND a secret if it was hidden. '
  + 'SECRETS: extract when someone conceals something OR a hidden thing is revealed this excerpt (a confessed abuse, a hidden parentage, a lie). '
  + 'JOURNAL: extract genuine TURNING POINTS a character would personally carry — a confession, promise, betrayal, gift, wound, first kiss, a moment of being truly seen — written from that character\'s POV; the PLAYER can and should hold journal entries too. '
  + 'BONDS: aff/trust are the CHANGE this excerpt caused to how A feels toward B; omit pairs that did not move; cat only when the bond\'s nature changed. '
  + 'Be GENEROUS but TRUE: capture every real reveal/turning-point (do not under-report), invent nothing the prose does not support. Empty arrays are fine.';

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
  const s = String(name || '').trim();
  if (!s) return true;
  if (/\{\{/.test(s) || /placeholder/i.test(s)) return true;
  // reject only a bare lowercase generic noun ("a guard", "someone") — a capitalized
  // epithet ("The Stranger") is a proper name and passes; "Anne" passes.
  const GENERIC = new Set(['guard', 'servant', 'soldier', 'stranger', 'man', 'woman', 'figure', 'someone', 'somebody', 'person']);
  const rest = s.replace(/^(a|an|the)\s+/i, '');
  const words = rest.split(/\s+/);
  if (words.length === 1 && GENERIC.has(words[0]!.toLowerCase()) && words[0]![0] === words[0]![0]!.toLowerCase()) return true;
  return false;
}

/**
 * PURE mapping: extractor JSON → events (src:'living'). Split out from the host
 * call so it is unit-testable without `generation`/`internalGenerate` — which is
 * exactly why bugs here (the `bad(b)` typo, the over-eager name filter) shipped
 * uncaught. `seqFn` defaults to the global monotonic seq; tests can inject one.
 */
export function mapExtracted(obj: any, turn: number, day: number, names: { user: string; char: string }, seqFn: () => number = nextSeq): VellumEvent[] {
  if (!obj || typeof obj !== 'object') return [];
  const out: VellumEvent[] = [];
  const base = () => ({ seq: seqFn(), turn, day, src: 'living' as const });

  for (const k of Array.isArray(obj.knowledge) ? obj.knowledge : []) {
    const who = realName(k?.who, names); const fact = String(k?.fact || '').trim();
    if (bad(who) || !fact) continue;
    const about = realName(k?.about, names);
    out.push({ ...base(), kind: 'knowledge.learn', who: canonId(who), fact, ...(about && !bad(about) ? { about: canonId(about) } : {}) } as VellumEvent);
  }
  let si = 0;
  for (const s of Array.isArray(obj.secrets) ? obj.secrets : []) {
    const keeper = realName(s?.keeper, names); const text = String(s?.secret || s?.text || '').trim();
    if (bad(keeper) || !text) continue;
    const from = String(s?.from || '').split(',').map((x: string) => realName(x, names)).filter((x: string) => x && !bad(x)).map(canonId);
    out.push({ ...base(), kind: 'secret.form', id: 'sec_' + turn + '_' + (si++), keeper: canonId(keeper), from, text } as VellumEvent);
  }
  let ji = 0;
  for (const j of Array.isArray(obj.journal) ? obj.journal : []) {
    const who = realName(j?.who, names); const memory = String(j?.memory || '').trim();
    if (bad(who) || !memory) continue;
    const about = realName(j?.about, names);
    out.push({ ...base(), kind: 'journal.entry', id: 'mj_' + canonId(who) + '_' + turn + '_' + (ji++), who: canonId(who), ...(about && !bad(about) ? { about: canonId(about) } : {}), memory, jkind: jk(j?.kind), weight: jw(j?.weight), sentiment: js(j?.sentiment) } as VellumEvent);
  }
  for (const b of Array.isArray(obj.bonds) ? obj.bonds : []) {
    const a = realName(b?.a, names), bb = realName(b?.b, names);
    if (bad(a) || bad(bb) || canonId(a) === canonId(bb)) continue;
    const cats = (Array.isArray(b?.cat) ? b.cat : []).map((c: string) => String(c).toLowerCase()).filter(isCategory) as Category[];
    const aff = clamp(b?.aff), trust = clamp(b?.trust);
    if (!aff && !trust && !cats.length) continue;
    out.push({ ...base(), kind: 'bond.delta', a: canonId(a), b: canonId(bb), ...(aff ? { aff } : {}), ...(trust ? { trust } : {}), ...(cats.length ? { addCats: cats } : {}), ...(b?.why ? { why: String(b.why) } : {}) } as VellumEvent);
  }
  return out;
}

/**
 * Run the extractor on a turn's prose. Returns events (src:'living'). The caller
 * supplies turn/day and the resolved persona/char names. No-op without the
 * generation permission or on empty prose.
 */
export async function extractFromProse(prose: string, turn: number, day: number, names: { user: string; char: string }, userId: string | null): Promise<VellumEvent[]> {
  if (!prose || !prose.trim() || !(await has('generation'))) return [];
  const gen = await internalGenerate(
    [{ role: 'system', content: EXTRACT_SYS }, { role: 'user', content: prose.slice(0, 8000) }],
    { temperature: 0.2, max_tokens: 700 },
    userId,
  );
  if (!gen.ok) return [];
  const obj = parseJson(gen.value);
  return mapExtracted(obj, turn, day, names);
}

const clamp = (v: unknown): number => Math.max(-40, Math.min(40, Math.round(Number(v) || 0)));
const jk = (v: unknown): any => (['interaction', 'promise', 'betrayal', 'gift', 'shared', 'wound', 'observation'].includes(String(v)) ? v : 'interaction');
const jw = (v: unknown): any => (['trivial', 'minor', 'significant', 'defining'].includes(String(v)) ? v : 'minor');
const js = (v: unknown): any => (['positive', 'negative', 'neutral', 'complex'].includes(String(v)) ? v : 'neutral');
