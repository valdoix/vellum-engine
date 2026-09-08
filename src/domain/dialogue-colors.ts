import { autoHue } from '../core/palette.js';

/**
 * Dialogue coloring (display-only). The preset's `[spk=Name]` display regex wraps
 * each attributed quote in a `.v-spk` span carrying `--vle-spk-color`; this module
 * builds the ONE stylesheet the extension injects to resolve that variable from
 * the cast. Coloring never touches stored text or model context — it is pure CSS
 * over host-rendered spans, so it applies to both the backlog and every future
 * turn without the extension ever touching chat DOM.
 */

const HEX = /^#[0-9a-f]{3,8}$/i;
const HEX6 = /^#[0-9a-f]{6}$/i;

/** Canonical display-regex replacement shared by VELLUM and ARGENT LOOM.
 *
 * Lumiverse's current renderer gives authored colors precedence inside its own
 * nested dialogue/emphasis spans when an ancestor span has an inline `color`
 * declaration. The value stays indirect so the extension can update cast colors
 * for both old and newly rendered messages by changing one stylesheet. Without
 * the extension, `inherit` keeps the prose readable.
 */
export const SPEAKER_SPAN_REPLACEMENT = '<span class="v-spk" data-spk="$1" style="color:var(--vle-spk-color,inherit)">$2</span>';

export interface SpeakerColor { name: string; aka: string[]; color: string; }

export interface DialogueIdentity { name: string; aka?: readonly string[]; }

interface CastLike {
  id: string;
  name: string;
  aka?: string[];
  color?: string;        // name color (#hex)
  colorTo?: string;      // name gradient end (#hex) — collapsed for dialogue
  dialogueColor?: string; // dedicated dialogue color (#hex) — wins when set
}

/** Blend two #rrggbb hexes at the midpoint into one #rrggbb. Used to COLLAPSE a
 *  gradient name (color + colorTo) into a single readable dialogue color, since a
 *  gradient on inline wrapping text renders inconsistently and risks invisibility. */
export function collapseGradient(a: string, b: string): string {
  if (!HEX6.test(a)) return HEX6.test(b) ? b : a;
  if (!HEX6.test(b)) return a;
  const ch = (h: string, i: number): number => parseInt(h.slice(i, i + 2), 16);
  const mix = (i: number): string => Math.round((ch(a, i) + ch(b, i)) / 2).toString(16).padStart(2, '0');
  return '#' + mix(1) + mix(3) + mix(5);
}

/** Resolve one character's dialogue color. Priority:
 *   1. dedicated `dialogueColor` (if a valid hex)
 *   2. name `color` — solid as-is, or gradient (color + colorTo) COLLAPSED to one
 *   3. deterministic `autoHue(id)` slot hue (matches the panel's default name hue) */
export function resolveDialogueColor(c: CastLike): string {
  if (c.dialogueColor && HEX.test(c.dialogueColor)) return c.dialogueColor;
  if (c.color && HEX6.test(c.color)) {
    return (c.colorTo && HEX6.test(c.colorTo)) ? collapseGradient(c.color, c.colorTo) : c.color;
  }
  if (c.color && HEX.test(c.color)) return c.color; // #rgb / #rrggbbaa — use as-is, no collapse
  return autoHue(c.id);
}

/** Build the speaker→color list from cast. */
export function buildSpeakerColors(cast: Record<string, CastLike> | undefined): SpeakerColor[] {
  if (!cast) return [];
  const out: SpeakerColor[] = [];
  for (const c of Object.values(cast)) {
    if (!c?.name) continue;
    out.push({ name: c.name, aka: (c.aka ?? []).filter(Boolean), color: resolveDialogueColor(c) });
  }
  return out;
}

/**
 * A short, concrete turn-local reminder for prose models. The static ARGENT
 * contract can explain the grammar, but models comply more reliably when the
 * exact names they may put in `[spk=...]` are adjacent to the live scene.
 */
export function dialogueMarkupGuidance(enabled: boolean, speakers: readonly DialogueIdentity[]): string {
  if (!enabled) return '';
  const labels = [...new Set(speakers
    .map((speaker) => String(speaker?.name ?? '').replace(/[\r\n\[\]]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean))]
    .slice(0, 60);
  const roster = labels.length ? labels.join('; ') : '(use each established character\'s exact name)';
  return `[DIALOGUE OUTPUT MARKUP — ACTIVE THIS TURN]
Speaker labels: ${roster}.
For every live spoken quotation whose speaker is named or otherwise certain, write the opening wrapper before the first quote character and the matching close immediately after the passage: [spk=Canonical Name]"speech"[/spk]. These wrappers are mandatory parts of story prose, including Engine Second Pass mode. Never output an eligible named-speaker quotation bare. Keep narration, thought, documents, remembered speech, and uncertain speakers outside wrappers.`;
}

const EXPLICIT_NAME = String.raw`(?!(?:She|He|They|It|We|I|You|The|A|An|This|That|These|Those)\b)[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'’.-]*(?:[ \t]+(?:(?:de|del|van|von|da|di|la|le|al|bin)[ \t]+)?[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'’.-]*){0,3}`;
const SPEECH_VERB = String.raw`(?:said|says|asked|asks|replied|replies|answered|answers|whispered|whispers|murmured|murmurs|called|calls|shouted|shouts|yelled|yells|cried|cries|added|adds|warned|warns|insisted|insists|admitted|admits|promised|promises|ordered|orders|demanded|demands|observed|observes|remarked|remarks|continued|continues)`;
const DIRECT_QUOTE = String.raw`["“][^"“”\r\n]{1,4000}["”]`;
const LEADING_ATTRIBUTION_RE = new RegExp(String.raw`(^[ \t]*)(${EXPLICIT_NAME})([ \t]+${SPEECH_VERB}(?:[ \t]+[a-z]+ly)?[ \t]*[,—:-][ \t]*)(${DIRECT_QUOTE})`, 'gm');
const TRAILING_ATTRIBUTION_RE = new RegExp(String.raw`(^[ \t]*)(${DIRECT_QUOTE})([ \t]*(?:,|—|-)?[ \t]*)(${EXPLICIT_NAME})([ \t]+${SPEECH_VERB}\b)`, 'gm');
const INVERTED_ATTRIBUTION_RE = new RegExp(String.raw`(^[ \t]*)(${DIRECT_QUOTE})([ \t]*(?:,|—|-)?[ \t]*${SPEECH_VERB}(?:[ \t]+[a-z]+ly)?[ \t]+)(${EXPLICIT_NAME})(?=[.!?,;:\s]|$)`, 'gm');
const COLON_ATTRIBUTION_RE = new RegExp(String.raw`(^[ \t]*)(${EXPLICIT_NAME})([ \t]*:[ \t]*)(${DIRECT_QUOTE})`, 'gm');
const PROTECTED_DIALOGUE_REGION_RE = /<\s*reverie\b[\s\S]*?<\s*\/\s*reverie\s*>|<\s*vellum\s*>[\s\S]*?(?:<\s*\/\s*vellum\s*>|$)|‹\s*vellum\s*›[\s\S]*?(?:‹\s*\/\s*vellum\s*›|$)|```\s*vellum[\s\S]*?(?:```|$)|\[\s*VELLUM\s*\][\s\S]*?(?:\[\s*\/\s*VELLUM\s*\]|$)|<artifact\b[\s\S]*?<\s*\/\s*artifact\s*>|\[\s*spk\s*=\s*["']?[^\]\r\n]+["']?\s*\][\s\S]*?(?:\[\s*\/\s*spk\s*\]|(?=\[\s*spk\b|<\s*(?:vellum|reverie)\b|‹\s*vellum\s*›|$))/gi;

function speakerCanonicalizer(speakers: readonly DialogueIdentity[]): (value: string) => string {
  const owners = new Map<string, Set<string>>();
  for (const speaker of speakers) {
    const canonical = String(speaker?.name ?? '').trim();
    if (!canonical) continue;
    for (const label of [canonical, ...(speaker.aka ?? [])]) {
      const key = String(label).normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
      if (!key) continue;
      const set = owners.get(key) ?? new Set<string>();
      set.add(canonical);
      owners.set(key, set);
    }
  }
  return (value: string): string => {
    // Attribution patterns may capture sentence punctuation immediately after
    // a final name (for example: `said Mara.`). Keep that punctuation in the
    // prose replacement, but never let it become part of the speaker key.
    const raw = value.replace(/\s+/g, ' ').trim().replace(/[.!?,;:]+$/u, '');
    const candidates = owners.get(raw.normalize('NFKC').toLocaleLowerCase());
    return candidates?.size === 1 ? [...candidates][0]! : raw;
  };
}

/**
 * Repair only dialogue whose speaker is explicit in the prose. This is the
 * runtime backstop for models that miss ARGENT's markup instruction. It never
 * assigns pronoun-only or unattributed quotes, and it masks existing wrappers,
 * Reverie, artifacts, and VELLUM JSON before scanning so canonical content is
 * never double-wrapped or corrupted.
 */
export function repairDialogueSpeakerTags(content: string, speakers: readonly DialogueIdentity[] = []): string {
  if (!content || /\[\s*spk\s*=/i.test(content) && !/["“][^"“”\r\n]{1,4000}["”]/.test(content.replace(PROTECTED_DIALOGUE_REGION_RE, ''))) return content;
  const protectedRegions: string[] = [];
  let prose = content.replace(PROTECTED_DIALOGUE_REGION_RE, (match) => {
    const index = protectedRegions.push(match) - 1;
    return `\uE000VELLUM${index}\uE001`;
  });
  const canonical = speakerCanonicalizer(speakers);
  prose = prose.replace(LEADING_ATTRIBUTION_RE, (_whole, lead, name, attribution, quote) => `${lead}${name}${attribution}[spk=${canonical(name)}]${quote}[/spk]`);
  prose = prose.replace(TRAILING_ATTRIBUTION_RE, (_whole, lead, quote, join, name, attribution) => `${lead}[spk=${canonical(name)}]${quote}[/spk]${join}${name}${attribution}`);
  prose = prose.replace(INVERTED_ATTRIBUTION_RE, (_whole, lead, quote, attribution, name) => `${lead}[spk=${canonical(name)}]${quote}[/spk]${attribution}${name}`);
  prose = prose.replace(COLON_ATTRIBUTION_RE, (_whole, lead, name, join, quote) => `${lead}${name}${join}[spk=${canonical(name)}]${quote}[/spk]`);
  return prose.replace(/\uE000VELLUM(\d+)\uE001/g, (_whole, rawIndex) => protectedRegions[Number(rawIndex)] ?? '');
}

/** Escape a name for safe use inside a CSS attribute-selector string. */
function cssAttr(s: string): string { return s.replace(/["\\]/g, '\\$&'); }

const NAME_TITLES = new Set([
  'mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'doctor', 'prof', 'professor',
  'sir', 'dame', 'lady', 'lord', 'prince', 'princess', 'king', 'queen',
  'captain', 'commander', 'general', 'colonel', 'major', 'sergeant',
  'father', 'mother', 'sister', 'brother', 'saint', 'st',
]);

/** Conservative short forms the model commonly emits in `[spk=...]` even when
 *  CAST supplied a full formal name. They are installed only when exactly one
 *  cast member owns the form, so shared given names/surnames never pick a color
 *  by accident. Explicit aliases still participate in the same ambiguity gate. */
function implicitNameForms(name: string): string[] {
  const raw = name.trim();
  if (!raw) return [];
  const parts = raw.split(/\s+/);
  let start = 0;
  while (start < parts.length - 1 && NAME_TITLES.has(parts[start]!.replace(/\.$/, '').toLowerCase())) start++;
  const core = parts.slice(start);
  const out: string[] = [];
  const untitled = core.join(' ');
  if (untitled && untitled.toLowerCase() !== raw.toLowerCase()) out.push(untitled);
  if (core.length > 1) {
    out.push(core[0]!);
    out.push(core[core.length - 1]!);
  }
  return [...new Set(out.map((v) => v.trim()).filter((v) => v.length >= 2))];
}

/** Emit the stylesheet. Matches on data-spk by name AND every alias. Each
 *  spelling gets an exact selector, followed by one case-insensitive selector
 *  for hosts that support the CSS attribute-selector `i` flag. The exact rule
 *  is deliberately not replaced by the `i` rule: some host style bridges drop
 *  selectors with flags, which previously left a lower-case `[spk="alias"]`
 *  wrapped but uncoloured when it differed only by case from the cast name.
 *
 *  The inline color marker emitted by SPEAKER_SPAN_REPLACEMENT is the current
 *  Lumiverse renderer contract: its nested dialogue/emphasis spans inherit the
 *  authored color. We also retain an explicit outer/descendant fallback for old
 *  imported regex packs and older renderers that did not implement that rule. */
export function speakerColorCss(speakers: SpeakerColor[], fallback = 'inherit'): string {
  const rules: string[] = [
    `.v-spk{--vle-spk-color:var(--vle-spk-default,${fallback});color:var(--vle-spk-color)!important}`,
    `.v-spk *{color:inherit!important}`,
  ];
  const keysBySpeaker = speakers.map((s) => [...new Set([s.name, ...s.aka, ...implicitNameForms(s.name)].map((v) => v.trim()).filter(Boolean))]);
  const owners = new Map<string, Set<number>>();
  for (let i = 0; i < keysBySpeaker.length; i++) {
    for (const key of keysBySpeaker[i]!) {
      const normalized = key.toLowerCase();
      const set = owners.get(normalized) ?? new Set<number>();
      set.add(i);
      owners.set(normalized, set);
    }
  }
  const seenExact = new Set<string>();
  const seenFolded = new Set<string>();
  for (let i = 0; i < speakers.length; i++) {
    const s = speakers[i]!;
    for (const key of keysBySpeaker[i]!) {
      const k = key.trim();
      if (!k) continue;
      if ((owners.get(k.toLowerCase())?.size ?? 0) !== 1) continue;
      const exact = k + '\u0000' + s.color;
      if (!seenExact.has(exact)) {
        seenExact.add(exact);
        rules.push(`.v-spk[data-spk="${cssAttr(k)}"]{--vle-spk-color:${s.color}}`);
      }
      const folded = k.toLowerCase() + '\u0000' + s.color;
      if (!seenFolded.has(folded)) {
        seenFolded.add(folded);
        rules.push(`.v-spk[data-spk="${cssAttr(k)}" i]{--vle-spk-color:${s.color}}`);
      }
    }
  }
  return rules.join('\n');
}

/** Cheap change key so we skip redundant stylesheet rewrites. */
export function speakerSig(speakers: SpeakerColor[]): string {
  return speakers.map((s) => s.name + '|' + s.aka.join(',') + '|' + s.color).sort().join(';');
}
