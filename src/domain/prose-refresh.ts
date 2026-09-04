/**
 * One-turn prose refresh command.
 *
 * `OOC: ((refresh))` is deliberately detected from the newest USER chat-history
 * message only. It therefore survives regenerate/swipe attempts for that reply,
 * but expires automatically as soon as the user sends their next message.
 */

const REFRESH_LINE = /(?:^|\r?\n)[ \t]*(?:OOC\s*:?\s*)?\(\(\s*refresh\s*\)\)[ \t]*(?=$|\r?\n)/iu;
const REFRESH_LINE_GLOBAL = /(?:^|\r?\n)[ \t]*(?:OOC\s*:?\s*)?\(\(\s*refresh\s*\)\)[ \t]*(?=$|\r?\n)/gimu;

export function hasProseRefreshCommand(text: unknown): boolean {
  return REFRESH_LINE.test(String(text ?? ''));
}

/** Remove the OOC control from material destined for story memory/extraction. */
export function stripProseRefreshCommand(text: string): string {
  return String(text || '').replace(REFRESH_LINE_GLOBAL, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const CONSUMED = '[OOC prose-refresh control consumed; the player supplied no in-world action in this message.]';
const ACTIVE = '[OOC prose-refresh command active for THIS reply only. Follow the ONE-TURN PROSE REFRESH system directive. This is not an in-world action.]';

interface PromptMessageLike {
  role?: unknown;
  content?: unknown;
  __isChatHistory?: unknown;
  __isWorldInfoEntry?: unknown;
}

function messageText(message: PromptMessageLike): string {
  if (typeof message?.content === 'string') return message.content;
  if (!Array.isArray(message?.content)) return '';
  return message.content.map((part: any) => {
    if (typeof part === 'string') return part;
    if (typeof part?.text === 'string') return part.text;
    if (typeof part?.content === 'string') return part.content;
    return '';
  }).filter(Boolean).join('\n');
}

/**
 * Remove refresh controls from the model-facing copy of user history after they
 * have been detected. Saved chat messages are untouched. This prevents an old
 * command from continuing to steer later turns merely because it remains in the
 * context window. A command-only message becomes an explicit no-action marker.
 */
export function scrubProseRefreshCommands(messages: readonly PromptMessageLike[]): PromptMessageLike[] {
  let changed = false;
  let latestUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') { latestUser = i; break; }
  }
  const activeIndex = latestUser >= 0 && hasProseRefreshCommand(messageText(messages[latestUser]!)) ? latestUser : -1;
  const out = messages.map((message, index) => {
    if (message?.role !== 'user' || !hasProseRefreshCommand(messageText(message))) return message;
    changed = true;
    const active = index === activeIndex;
    if (typeof message.content === 'string') {
      const content = stripProseRefreshCommand(message.content);
      return { ...message, content: active ? (content ? `${content}\n\n${ACTIVE}` : ACTIVE) : (content || CONSUMED) };
    }
    if (Array.isArray(message.content)) {
      const content = message.content.map((part: any) => {
        if (typeof part === 'string') return stripProseRefreshCommand(part);
        if (typeof part?.text === 'string') return { ...part, text: stripProseRefreshCommand(part.text) };
        if (typeof part?.content === 'string') return { ...part, content: stripProseRefreshCommand(part.content) };
        return part;
      }).filter((part: any) => {
        if (typeof part === 'string') return !!part.trim();
        if (typeof part?.text === 'string') return !!part.text.trim();
        if (typeof part?.content === 'string') return !!part.content.trim();
        return true; // preserve image/audio/other non-text parts
      });
      if (active) content.push({ type: 'text', text: ACTIVE });
      return { ...message, content: content.length ? content : CONSUMED };
    }
    return { ...message, content: active ? ACTIVE : CONSUMED };
  });
  return changed ? out : [...messages];
}

/** Prefer explicitly marked chat history so a preset example cannot fire this. */
function chatHistory(messages: readonly PromptMessageLike[]): PromptMessageLike[] {
  const marked = messages.filter((m) => m?.__isChatHistory === true && !m?.__isWorldInfoEntry);
  return marked.length ? marked : messages.filter((m) => !m?.__isWorldInfoEntry);
}

function cleanAssistantProse(raw: string, cleaner: (text: string) => string): string {
  return stripProseRefreshCommand(cleaner(raw))
    .replace(/\[\/?spk(?:\s*=\s*[^\]\r\n]+)?\]/gi, '')
    .replace(/<\/?span\b[^>]*>/gi, '')
    .replace(/\r/g, '')
    .trim()
    .slice(0, 12_000);
}

const WORD_RE = /[\p{L}\p{M}][\p{L}\p{M}'’.-]*/gu;
const SAFE_SENTENCE_HEAD = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'for', 'he', 'her', 'his', 'i', 'if', 'in',
  'it', 'its', 'not', 'now', 'she', 'so', 'the', 'their', 'then', 'they', 'this',
  'though', 'we', 'when', 'while', 'with', 'without', 'you', 'your',
]);
const STOP = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'for', 'from',
  'had', 'has', 'have', 'he', 'her', 'hers', 'him', 'his', 'i', 'in', 'into', 'is',
  'it', 'its', 'not', 'of', 'on', 'or', 'our', 'she', 'so', 'that', 'the', 'their',
  'them', 'then', 'there', 'they', 'this', 'to', 'was', 'we', 'were', 'with', 'you',
  'your',
]);

function sentences(text: string): string[] {
  return text.split(/[.!?]+(?:["'”’\])}]+)?\s+|\n+/u).map((s) => s.trim()).filter(Boolean);
}

function words(text: string): string[] {
  return text.match(WORD_RE) ?? [];
}

function startsWithProperName(tokens: string[]): boolean {
  const first = tokens[0];
  if (!first) return false;
  const lower = first.toLowerCase();
  return first[0] === first[0]!.toUpperCase() && first[0] !== first[0]!.toLowerCase() && !SAFE_SENTENCE_HEAD.has(lower);
}

function repeatedOpenings(docs: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const doc of docs) {
    for (const sentence of sentences(doc)) {
      const toks = words(sentence);
      if (toks.length < 3 || startsWithProperName(toks)) continue;
      const opening = toks.slice(0, 3).map((w) => w.toLowerCase()).join(' ');
      counts.set(opening, (counts.get(opening) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 4)
    .map(([opening]) => `repeated sentence opening “${opening} …”`);
}

function repeatedPhrases(docs: readonly string[]): string[] {
  const totals = new Map<string, number>();
  const docCounts = new Map<string, number>();
  for (const doc of docs) {
    const seenHere = new Set<string>();
    for (const sentence of sentences(doc)) {
      const toks = words(sentence);
      if (toks.length < 4) continue;
      for (let i = 0; i <= toks.length - 4; i++) {
        const raw = toks.slice(i, i + 4);
        // Protect canon names/places: a capitalized token inside a sentence is
        // likely an entity, not a prose tic. A capitalized sentence head is kept
        // only for ordinary function words/pronouns ("She turned away ...").
        if (raw.some((w, j) => {
          const cased = w[0] === w[0]!.toUpperCase() && w[0] !== w[0]!.toLowerCase();
          return cased && !(i === 0 && j === 0 && SAFE_SENTENCE_HEAD.has(w.toLowerCase()));
        })) continue;
        const lower = raw.map((w) => w.toLowerCase());
        if (lower.every((w) => STOP.has(w))) continue;
        const phrase = lower.join(' ');
        totals.set(phrase, (totals.get(phrase) ?? 0) + 1);
        seenHere.add(phrase);
      }
    }
    for (const phrase of seenHere) docCounts.set(phrase, (docCounts.get(phrase) ?? 0) + 1);
  }
  return Array.from(totals.entries())
    .filter(([phrase, total]) => (docCounts.get(phrase) ?? 0) >= 2 || total >= 3)
    .sort((a, b) => (b[1] * b[0].length) - (a[1] * a[0].length))
    .slice(0, 5)
    .map(([phrase]) => `repeated phrase “${phrase}”`);
}

interface HabitPattern { label: string; re: RegExp; threshold?: number }
const HABIT_PATTERNS: HabitPattern[] = [
  { label: '“for a moment/beat/heartbeat” transition', re: /\bfor (?:a|one) (?:moment|beat|heartbeat)\b/giu },
  { label: '“as if” comparison', re: /\bas if\b/giu, threshold: 3 },
  { label: '“almost” hedging', re: /\balmost\b/giu, threshold: 3 },
  { label: 'vague “something in/about/behind” emotion', re: /\bsomething (?:in|about|behind|inside|within)\b/giu },
  { label: 'eyes/gaze flicked, shifted, dropped, lifted, or narrowed', re: /\b(?:his|her|their) (?:eyes|gaze) (?:flicked|shifted|dropped|lifted|narrowed)\b/giu },
  { label: 'jaw/hand/shoulder tension beat', re: /\b(?:his|her|their) (?:jaw|shoulders?|hands?|fingers?) (?:tightened|clenched|tensed|relaxed|curled)\b/giu },
  { label: 'caught/released breath beat', re: /\b(?:(?:let out|released) (?:a|the) breath|breath (?:caught|hitched|stilled))\b/giu },
  { label: 'words hanging or settling in the air', re: /\bthe words? (?:hung|hovered|settled) (?:between them|in the air)\b/giu },
  { label: '“not X. Not Y.” fragment ladder', re: /\bnot\b[^.!?\n]{1,50}[.!?]\s*(?:not|nor)\b/giu },
  { label: 'explicit “a beat” pause', re: /\ba beat\b/giu },
];

function countMatches(text: string, re: RegExp): number {
  return Array.from(text.matchAll(re)).length;
}

function structuralHabits(docs: readonly string[]): string[] {
  const all = docs.join('\n\n');
  const out = HABIT_PATTERNS
    .filter((p) => countMatches(all, p.re) >= (p.threshold ?? 2))
    .map((p) => p.label);

  const dashCount = (all.match(/—/g) ?? []).length;
  if (dashCount >= 5) out.push('frequent em-dash pivots or interruptions');
  const ellipsisCount = (all.match(/(?:\.\.\.|…)/g) ?? []).length;
  if (ellipsisCount >= 4) out.push('frequent ellipsis pauses');

  const lengths = sentences(all).map((s) => words(s).length).filter((n) => n > 0);
  if (lengths.length >= 8) {
    const bands = [
      { label: 'uniform clipped-sentence cadence', count: lengths.filter((n) => n <= 7).length },
      { label: 'uniform medium-sentence cadence', count: lengths.filter((n) => n >= 8 && n <= 20).length },
      { label: 'uniform long-sentence cadence', count: lengths.filter((n) => n >= 21).length },
    ];
    const dominant = bands.sort((a, b) => b.count - a.count)[0]!;
    if (dominant.count / lengths.length >= 0.68) out.push(dominant.label);
  }
  return out;
}

/**
 * Return a high-priority one-turn style governor, or '' when the latest user
 * message does not invoke the command. `cleaner` should strip engine scaffold
 * from assistant messages (the backend supplies stripScaffold).
 */
export function proseRefreshInjection(
  messages: readonly PromptMessageLike[],
  cleaner: (text: string) => string = (text) => text,
): string {
  if (!Array.isArray(messages) || !messages.length) return '';
  const history = chatHistory(messages);
  const latestUser = [...history].reverse().find((m) => m?.role === 'user');
  if (!latestUser || !hasProseRefreshCommand(messageText(latestUser))) return '';

  const docs = history
    .filter((m) => m?.role === 'assistant')
    .slice(-5)
    .map((m) => cleanAssistantProse(messageText(m), cleaner))
    .filter(Boolean);
  const habits = [...new Set([
    ...structuralHabits(docs),
    ...repeatedOpenings(docs),
    ...repeatedPhrases(docs),
  ])].slice(0, 12);
  const blacklist = habits.length
    ? '\n[DETECTED RECENT HABITS — retire these for this reply; avoid close paraphrases too]\n' + habits.map((h) => `- ${h}`).join('\n')
    : '\n[NO SINGLE TIC DOMINATED — still make the new reply structurally distinct from the recent assistant prose.]';

  return `[ONE-TURN PROSE REFRESH — explicit OOC command; highest style priority for this reply]
This is a PRESENTATION command, not an in-world utterance or action. Continue from the exact current instant and situation. Preserve canon, location, numeric clock, action in progress, knowledge boundaries, relationships, character voice, POV, and all consequences. Do not reset, recap, retcon, montage, or time-skip merely to manufacture novelty. The player supplied no action through this command: never invent {{user}}'s dialogue, decisions, thoughts, feelings, or movement.

Before writing, silently audit the recent assistant prose. Then write this reply with a genuinely different surface strategy—not synonym swaps. Change at least four of these: sentence architecture, paragraph rhythm, paragraph openings, sensory channel, image family, transition method, dialogue-to-action balance, interiority delivery, and scene-blocking pattern. Do not reuse distinctive sentence openings, metaphors, body-language beats, rhetorical constructions, cadence loops, or closing gestures from the recent prose. Prefer concrete details specific to this room, body, culture, weather, and immediate objective. Keep the established genre/register and each character's voice; freshness must not become purple prose, random quirkiness, choppy fragments, or continuity drift.

Do not mention this refresh instruction. All active output contracts remain mandatory, including speaker-color tags and the complete <vellum> state block.${blacklist}`;
}
