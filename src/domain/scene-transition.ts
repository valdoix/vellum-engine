import { hashStr } from '../core/ids.js';
import { parseClock } from './clock.js';
import type { ChronicleState } from './types.js';
import type { ParsedState } from '../parse/parsed.js';

export type SceneTransitionKind = 'scene' | 'time_skip';
export type SceneOpenReason = 'new_chat' | 'command' | 'prose' | 'time_skip';
export type SceneTitleSource = 'user' | 'model' | 'fallback';

export interface SceneIntent {
  kind: SceneTransitionKind;
  title?: string;
  location?: string;
  day?: number;
  time?: string;
  duration?: string;
  note?: string;
  source: 'command' | 'director';
}

export interface DetectedSceneTransition {
  id: string;
  reason: SceneOpenReason;
  title?: string;
  titleSource?: SceneTitleSource;
  elapsedMinutes?: number;
  reusePending: boolean;
}

const COMMAND = /(?:^|\n)\s*(?:OOC\s*:\s*)?\(\(\s*(next\s+scene|time\s*[- ]?skip)\b([^)]*)\)\)\s*(?=\n|$)/gim;

export function cleanSceneTitle(value: unknown): string | undefined {
  const title = String(value ?? '')
    .replace(/^[\s#*_`"'\u201c\u201d\u2018\u2019]+|[\s#*_`"'\u201c\u201d\u2018\u2019]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return title || undefined;
}

/** Parse a standalone author command. Examples:
 * ((next scene | title=Ash at Dawn | location=North Gate | time=06:10))
 * ((time skip: three days | title=The Long Return)) */
export function parseSceneCommand(text: string | undefined): SceneIntent | null {
  if (!text) return null;
  let match: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  COMMAND.lastIndex = 0;
  while ((match = COMMAND.exec(text)) !== null) last = match;
  if (!last) return null;
  const kind: SceneTransitionKind = /time/i.test(last[1]!) ? 'time_skip' : 'scene';
  const body = String(last[2] ?? '').replace(/^\s*[:|]\s*/, '').trim();
  const values: Record<string, string> = {};
  const loose: string[] = [];
  for (const part of body.split('|').map(value => value.trim()).filter(Boolean)) {
    const kv = part.match(/^([a-z][a-z _-]{0,24})\s*=\s*(.+)$/i);
    if (kv) values[kv[1]!.replace(/[\s-]+/g, '').toLocaleLowerCase()] = kv[2]!.trim();
    else loose.push(part);
  }
  const title = cleanSceneTitle(values.title ?? (kind === 'scene' ? loose[0] : undefined));
  const duration = String(values.duration ?? (kind === 'time_skip' ? loose[0] ?? '' : '')).trim().slice(0, 80) || undefined;
  const dayRaw = values.day;
  const dayNumber = dayRaw !== undefined ? Math.floor(Number(dayRaw)) : NaN;
  const location = String(values.location ?? values.loc ?? values.where ?? '').trim().slice(0, 120) || undefined;
  const time = String(values.time ?? values.when ?? '').trim().slice(0, 60) || undefined;
  const note = String(values.note ?? loose.slice(kind === 'scene' && title ? 1 : kind === 'time_skip' && duration ? 1 : 0).join(' | ')).trim().slice(0, 240) || undefined;
  return {
    kind,
    ...(title ? { title } : {}),
    ...(location ? { location } : {}),
    ...(Number.isFinite(dayNumber) && dayNumber >= 0 ? { day: dayNumber } : {}),
    ...(time ? { time } : {}),
    ...(duration ? { duration } : {}),
    ...(note ? { note } : {}),
    source: 'command',
  };
}

export function hasSceneCommand(text: string | undefined): boolean { return parseSceneCommand(text) !== null; }

export function stripSceneCommand(text: string): string {
  COMMAND.lastIndex = 0;
  return text.replace(COMMAND, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function scrubSceneCommands<T extends { content?: unknown }>(messages: readonly T[]): T[] {
  return messages.map(message => typeof message?.content === 'string'
    ? { ...message, content: stripSceneCommand(message.content) }
    : { ...message });
}

export function sceneIntentInjection(intent: SceneIntent | null, state: ChronicleState): string {
  if (!intent) return '';
  const fields = [
    intent.title ? `Title: ${intent.title}.` : 'Choose a concise, evocative title after writing the opening; keep it grounded in what the opening actually establishes.',
    intent.location ? `Location: ${intent.location}.` : '',
    intent.day !== undefined ? `Narrative day: ${intent.day}.` : '',
    intent.time ? `Time: ${intent.time}.` : '',
    intent.duration ? `Elapsed time: ${intent.duration}.` : '',
    intent.note ?? '',
  ].filter(Boolean).join(' ');
  const mode = intent.kind === 'time_skip' ? 'TIME-SKIP' : 'NEW SCENE';
  return `[${mode} — AUTHOR COMMAND. Open a distinct scene this turn. ${fields} The same elapsed time applies to the foreground, parallel events, off-screen subplots, deadlines, schedules, and Chronicle timestamps. Do not treat elapsed time alone as plot progress. In the VELLUM scene object emit transition:"${intent.kind}" and ${intent.title ? `title:"${intent.title}"` : 'a newly chosen title'}. Prior canonical NOW: day ${state.day || 0}${state.scene.time ? `, ${state.scene.time}` : ''}.]`;
}

const normalize = (value: unknown): string => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();

export function hasProseSceneCue(text: string | undefined): boolean {
  if (!text) return false;
  return /(?:^|\n)\s*(?:\[SCENE\|[^\]\r\n]+\]|\*\s*\*\s*\*|-{3,}|_{3,}|#{1,3}\s+[^\n]+)\s*(?:\n|$)/m.test(text)
    || /\b(?:meanwhile|elsewhere|hours? later|days? later|weeks? later|months? later|years? later|the next (?:morning|day|evening|night|week|month|year)|the following (?:morning|day|evening|night|week|month|year)|later that (?:day|evening|night|week|month|year)|after (?:a while|midnight)|by (?:dawn|morning|noon|dusk|evening|nightfall))\b/i.test(text);
}

function elapsedMinutes(prior: ChronicleState, day: number, parsed: ParsedState): number | undefined {
  const before = prior.scene.clock ?? parseClock(prior.scene.time);
  const after = parsed.scene?.clock ?? parseClock(parsed.scene?.time);
  if (before === undefined || after === undefined) return day > prior.day ? (day - prior.day) * 1440 : undefined;
  return Math.max(0, (day - prior.day) * 1440 + after - before);
}

/** Decide whether this validated turn opens a new scene. The model may propose a
 * boundary, but it becomes canonical only when current-turn prose/state changes
 * support it. User commands are authoritative. */
export function detectSceneTransition(input: {
  prior: ChronicleState;
  parsed: ParsedState;
  prose: string;
  userInput?: string;
  day: number;
  turn: number;
  intent?: SceneIntent | null;
}): DetectedSceneTransition | null {
  const { prior, parsed, prose, userInput, day, turn } = input;
  const intent = input.intent ?? parseSceneCommand(userInput);
  const proposed = parsed.scene?.transition;
  const cue = hasProseSceneCue(`${userInput ?? ''}\n${prose}`);
  const priorLoc = normalize(prior.scene.location);
  const nextLoc = normalize(parsed.scene?.loc);
  const locationChanged = !!nextLoc && !!priorLoc && nextLoc !== priorLoc;
  const title = cleanSceneTitle(intent?.title ?? parsed.scene?.title);
  const titleChanged = !!title && !!prior.scene.title && normalize(title) !== normalize(prior.scene.title);
  const elapsed = elapsedMinutes(prior, day, parsed);
  const skip = intent?.kind === 'time_skip' || proposed === 'time_skip' || day > prior.day || (cue && (elapsed ?? 0) >= 120);

  let reason: SceneOpenReason | null = null;
  if (intent) reason = intent.kind === 'time_skip' ? 'time_skip' : 'command';
  else if (!prior.scene.id || prior.scene.pending) reason = 'new_chat';
  else if (proposed && proposed !== 'continue' && (cue || locationChanged || titleChanged || day > prior.day)) reason = proposed === 'time_skip' ? 'time_skip' : 'prose';
  else if (day > prior.day || (cue && (locationChanged || titleChanged || (elapsed ?? 0) >= 120))) reason = skip ? 'time_skip' : 'prose';
  else if (locationChanged && cue) reason = 'prose';
  if (!reason) return null;

  const reusePending = prior.scene.pending === true;
  const id = reusePending && prior.scene.id
    ? prior.scene.id
    : `scn_${turn}_${hashStr(`${turn}\u0000${title ?? ''}\u0000${parsed.scene?.loc ?? ''}\u0000${day}\u0000${prose}`).slice(0, 8)}`;
  const source: SceneTitleSource | undefined = intent?.title ? 'user' : parsed.scene?.title ? 'model' : undefined;
  return {
    id,
    reason,
    ...(title ? { title } : {}),
    ...(source ? { titleSource: source } : {}),
    ...(elapsed !== undefined ? { elapsedMinutes: elapsed } : {}),
    reusePending,
  };
}
