import type { ChronicleState } from './types.js';
import type { VellumEvent } from '../core/events.js';
import { simEvents, type ParsedSim, type SimEventsOpts } from './offscreen.js';
import type { ParsedState } from '../parse/parsed.js';
import { canonId } from '../core/ids.js';
import { sameTrack } from '../core/reduce.js';

const PARALLEL_LINE = /(?:^|\r?\n)[ \t]*(?:OOC\s*:?\s*)?\(\(\s*parallel\s*\)\)[ \t]*(?=$|\r?\n)/iu;
const PARALLEL_LINE_GLOBAL = /(?:^|\r?\n)[ \t]*(?:OOC\s*:?\s*)?\(\(\s*parallel\s*\)\)[ \t]*(?=$|\r?\n)/gimu;

export type ParallelPresentation = 'plain' | 'vtk' | 'artifact';

interface PromptMessageLike {
  role?: unknown;
  content?: unknown;
  __isChatHistory?: unknown;
  __isWorldInfoEntry?: unknown;
}

function messageText(message: PromptMessageLike): string {
  if (typeof message?.content === 'string') return message.content;
  if (!Array.isArray(message?.content)) return '';
  return message.content.map((part: any) => typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : typeof part?.content === 'string' ? part.content : '').filter(Boolean).join('\n');
}

export function hasParallelCommand(text: unknown): boolean {
  return PARALLEL_LINE.test(String(text ?? ''));
}

export function stripParallelCommand(text: string): string {
  return String(text || '').replace(PARALLEL_LINE_GLOBAL, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

type PlotPlan = { id: string; name: string; existing: boolean; notes: string[]; milestones: string[]; dependsOn: string[]; blockedBy: string[]; deadlineDay?: number; deadlineClock?: number; arc?: string };

function planTrack(raw: string, existing: ChronicleState['threads'], planned: PlotPlan[]): PlotPlan | null {
  const label = String(raw || '').trim();
  if (!label) return null;
  const known = existing.find(track => track.id.toLocaleLowerCase() === label.toLocaleLowerCase() || sameTrack(track.name, label));
  if (known) {
    if (/resolv/i.test(known.status || '')) return null;
    let plan = planned.find(row => row.id === known.id);
    if (!plan) { plan = { id: known.id, name: known.name, existing: true, notes: [], milestones: [], dependsOn: [], blockedBy: [] }; planned.push(plan); }
    return plan;
  }
  let plan = planned.find(row => sameTrack(row.name, label));
  if (plan) return plan;
  const base = `thr_${canonId(label) || 'parallel'}`;
  const used = new Set([...existing.map(row => row.id), ...planned.map(row => row.id)]);
  let id = base; let suffix = 2;
  while (used.has(id)) id = `${base}_${suffix++}`;
  plan = { id, name: label, existing: false, notes: [], milestones: [], dependsOn: [], blockedBy: [] };
  planned.push(plan);
  return plan;
}

/** Validate and materialize a complete 3-7 event interlude from the ordinary
 * ParsedState seam. The commit is all-or-nothing: every visible development
 * must survive canon validation, own a durable subplot, and link to a plot
 * thread. New arcs are admitted only when at least two generated threads share
 * them; an exact existing arc may advance from one child-thread beat. */
export function materializeParallelBatch(parsed: ParsedState | null, state: ChronicleState, turn: number, day: number, seq: () => number, opts: SimEventsOpts = {}): { events: VellumEvent[]; count: number } | null {
  const rawRows = parsed?.delta?.offscreen;
  if (!rawRows || rawRows.length < 3 || rawRows.length > 7) return null;
  const rows = rawRows.map(row => ({ ...row, id: canonId(row.id) })).filter(row => row.id);
  if (rows.length !== rawRows.length || new Set(rows.map(row => row.id)).size !== rows.length) return null;
  // A parallel beat without a place or plot-thread bridge would be decorative
  // ephemera, which this command explicitly refuses to create.
  if (rows.some(row => !row.where?.trim() || !row.thread?.trim() || (row.op === 'new' && !row.name?.trim()))) return null;

  const sim: ParsedSim = {
    offscreen: rows.map(row => ({
      op: row.op, id: row.id, ...(row.name ? { name: row.name } : {}), ...(row.who ? { who: row.who } : {}),
      ...(row.where ? { where: row.where } : {}), gist: row.gist, ...(row.thread ? { thread: row.thread } : {}),
      ...(row.arc ? { arc: row.arc } : {}), ...(row.pressure !== undefined ? { pressure: row.pressure } : {}),
      ...(row.hooks?.length ? { hooks: row.hooks } : {}), ...(row.stakes ? { stakes: row.stakes } : {}),
      ...(row.autonomy ? { autonomy: row.autonomy } : {}),
      ...(row.nextTurn !== undefined ? { nextTurn: row.nextTurn } : {}), ...(row.nextDay !== undefined ? { nextDay: row.nextDay } : {}),
      ...(row.nextClock !== undefined ? { nextClock: row.nextClock } : {}), ...(row.deadlineDay !== undefined ? { deadlineDay: row.deadlineDay } : {}),
      ...(row.deadlineClock !== undefined ? { deadlineClock: row.deadlineClock } : {}), ...(row.dependsOn !== undefined ? { dependsOn: row.dependsOn } : {}),
      ...(row.blockedBy !== undefined ? { blockedBy: row.blockedBy } : {}), ...(row.trigger ? { trigger: row.trigger } : {}),
    })),
    ...(parsed?.delta?.bonds?.length ? { bonds: parsed.delta.bonds.map(row => ({
      a: row.a, b: row.b, ...(row.aff !== undefined ? { aff: row.aff } : {}), ...(row.trust !== undefined ? { trust: row.trust } : {}),
      ...(row.addCats?.find(cat => cat === 'social' || cat === 'rivalry' || cat === 'alliance') ? { cat: row.addCats.find(cat => cat === 'social' || cat === 'rivalry' || cat === 'alliance') } : {}),
      ...(row.why ? { why: row.why } : {}),
    })) } : {}),
    ...(parsed?.delta?.factionRelations?.length ? { factions: parsed.delta.factionRelations.map(row => ({
      a: row.a, b: row.b, ...(row.kind ? { kind: row.kind } : {}), ...(row.standing !== undefined ? { standing: row.standing } : {}), ...(row.why ? { why: row.why } : {}),
    })) } : {}),
  };
  const proposed = simEvents(sim, state, turn, day, seq, opts);
  const requested = new Set(rows.map(row => row.id));
  const primary = proposed.filter((event): event is Extract<VellumEvent, { kind: 'offscreen.op' }> => event.kind === 'offscreen.op' && requested.has(event.id));
  // Visible prose and canonical data must remain one-to-one. Reject the entire
  // response if even one row violates cast, place, movement or knowledge rules.
  if (primary.length !== rows.length) return null;

  const threadPlans: PlotPlan[] = [];
  const rowThreads = new Map<string, PlotPlan>();
  for (const row of rows) {
    const plan = planTrack(row.thread!, state.threads, threadPlans);
    if (!plan) return null;
    plan.notes.push(row.gist);
    if (row.hooks?.[0]) plan.milestones.push(row.hooks[0]);
    if (row.dependsOn?.length) plan.dependsOn.push(...row.dependsOn);
    if (row.blockedBy?.length) plan.blockedBy.push(...row.blockedBy);
    if (row.deadlineDay !== undefined && (plan.deadlineDay === undefined || row.deadlineDay < plan.deadlineDay)) {
      plan.deadlineDay = row.deadlineDay; plan.deadlineClock = row.deadlineClock;
    }
    rowThreads.set(row.id, plan);
  }

  const arcPlans: PlotPlan[] = [];
  const arcMembers = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.arc?.trim()) continue;
    const plan = planTrack(row.arc, state.arcs, arcPlans);
    if (!plan) continue;
    plan.notes.push(row.gist);
    if (row.hooks?.[0]) plan.milestones.push(row.hooks[0]);
    if (row.dependsOn?.length) plan.dependsOn.push(...row.dependsOn);
    if (row.blockedBy?.length) plan.blockedBy.push(...row.blockedBy);
    if (row.deadlineDay !== undefined && (plan.deadlineDay === undefined || row.deadlineDay < plan.deadlineDay)) {
      plan.deadlineDay = row.deadlineDay; plan.deadlineClock = row.deadlineClock;
    }
    const members = arcMembers.get(plan.id) ?? new Set<string>();
    members.add(rowThreads.get(row.id)!.id);
    arcMembers.set(plan.id, members);
  }
  // A freshly coined umbrella arc needs at least two distinct child threads.
  const admittedArcs = arcPlans.filter(plan => plan.existing || (arcMembers.get(plan.id)?.size ?? 0) >= 2);
  const admittedArcIds = new Set(admittedArcs.map(plan => plan.id));
  for (const row of rows) {
    if (!row.arc?.trim()) continue;
    const arc = arcPlans.find(plan => plan.id === state.arcs.find(track => track.id.toLocaleLowerCase() === row.arc!.toLocaleLowerCase() || sameTrack(track.name, row.arc!))?.id || sameTrack(plan.name, row.arc!));
    if (arc && admittedArcIds.has(arc.id)) {
      const thread = rowThreads.get(row.id)!;
      if (thread.arc && thread.arc !== arc.id) return null;
      thread.arc = arc.id;
    }
  }
  // An existing subplot cannot be silently re-parented to another plot thread.
  for (const row of rows) {
    const prior = state.offscreen.find(item => item.id === row.id);
    if (prior?.thread && prior.thread !== rowThreads.get(row.id)!.id) return null;
  }

  const base = () => ({ seq: seq(), turn, day, src: 'system' as const });
  const arcEvents: VellumEvent[] = admittedArcs.map(plan => ({
    ...base(), kind: 'arc.op', op: plan.existing ? 'advance' : 'new', name: plan.name,
    note: [...new Set(plan.notes)].join('; ').slice(0, 500),
    ...(plan.milestones.length ? { milestone: plan.milestones[0]!.slice(0, 500) } : {}),
    ...(plan.dependsOn.length ? { dependsOn: [...new Set(plan.dependsOn)].slice(0, 20) } : {}),
    ...(plan.blockedBy.length ? { blockedBy: [...new Set(plan.blockedBy)].slice(0, 20) } : {}),
    ...(plan.deadlineDay !== undefined ? { deadlineDay: plan.deadlineDay } : {}),
    ...(plan.deadlineClock !== undefined ? { deadlineClock: plan.deadlineClock } : {}),
  } as VellumEvent));
  const threadEvents: VellumEvent[] = [];
  for (const plan of threadPlans) {
    const note = [...new Set(plan.notes)].join('; ').slice(0, 500);
    threadEvents.push({ ...base(), kind: 'thread.op', op: plan.existing ? 'advance' : 'new', name: plan.name, note,
      ...(plan.milestones.length ? { milestone: plan.milestones[0]!.slice(0, 500) } : {}),
      ...(plan.dependsOn.length ? { dependsOn: [...new Set(plan.dependsOn)].slice(0, 20) } : {}),
      ...(plan.blockedBy.length ? { blockedBy: [...new Set(plan.blockedBy)].slice(0, 20) } : {}),
      ...(plan.deadlineDay !== undefined ? { deadlineDay: plan.deadlineDay } : {}),
      ...(plan.deadlineClock !== undefined ? { deadlineClock: plan.deadlineClock } : {}),
    } as VellumEvent);
    if (plan.arc) threadEvents.push({ ...base(), kind: 'thread.set', id: plan.id, name: plan.name, arc: plan.arc } as VellumEvent);
  }
  const durable = primary.map(event => ({ ...event, thread: rowThreads.get(event.id)!.id } as VellumEvent));
  // Relationship/faction deltas survived their autonomy/lock chokepoints. Their
  // simulator-generated news mirrors are redundant with the primary subplot
  // beats, so retain only the actual political/social mutations here.
  const autonomyEvents = proposed.filter(event => event.kind === 'bond.delta' || event.kind === 'factionrel.op');

  const changedActors = new Set(primary.map(event => event.who || state.offscreen.find(row => row.id === event.id)?.who).filter(Boolean).map(value => canonId(value!)));
  const changedSubplots = new Set(primary.map(event => `subplot:${event.id}`));
  const present = new Set(state.scene.present.map(canonId));
  const items = state.parallel
    .filter(item => (!item.who || !changedActors.has(canonId(item.who))) && (!item.note || !changedSubplots.has(item.note)))
    .filter(item => !item.who || !present.has(canonId(item.who)))
    .map(item => ({ ...(item.who ? { who: item.who } : {}), ...(item.where ? { where: item.where } : {}), activity: item.activity, ...(item.note ? { note: item.note } : {}), ...(item.src ? { src: item.src } : {}) }));
  for (const event of primary) {
    if (event.op === 'resolve') continue;
    const prior = state.offscreen.find(row => row.id === event.id);
    const who = event.who ?? prior?.who;
    const where = event.where ?? prior?.where;
    items.push({ ...(who ? { who } : {}), ...(where ? { where } : {}), activity: event.gist || prior?.gist || event.name || event.id, note: `subplot:${event.id}`, src: 'sim' as const });
  }
  return {
    events: [...arcEvents, ...threadEvents, ...durable, ...autonomyEvents, { ...base(), kind: 'parallel.set', items } as VellumEvent],
    count: primary.length,
  };
}

/** Only the newest user-history command stays active. Older invocations are
 * replaced in the transient model prompt so regeneration is stable but later
 * turns cannot accidentally re-run the batch. Saved chat content is untouched. */
export function scrubParallelCommands(messages: readonly PromptMessageLike[]): PromptMessageLike[] {
  let latestUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]?.role === 'user') { latestUser = i; break; }
  const active = latestUser >= 0 && hasParallelCommand(messageText(messages[latestUser]!)) ? latestUser : -1;
  let changed = false;
  const out = messages.map((message, index) => {
    if (message?.role !== 'user' || !hasParallelCommand(messageText(message))) return message;
    changed = true;
    const marker = index === active
      ? '[OOC PARALLEL command active for THIS reply only. This is not an in-world player action.]'
      : '[OOC PARALLEL command already consumed.]';
    if (typeof message.content === 'string') {
      const rest = stripParallelCommand(message.content);
      return { ...message, content: rest ? `${rest}\n\n${marker}` : marker };
    }
    return { ...message, content: marker };
  });
  return changed ? out : [...messages];
}

function activeCommand(messages: readonly PromptMessageLike[]): boolean {
  const history = messages.filter(m => m.__isChatHistory === true && !m.__isWorldInfoEntry);
  const source = history.length ? history : messages.filter(m => !m.__isWorldInfoEntry);
  for (let i = source.length - 1; i >= 0; i--) if (source[i]?.role === 'user') return hasParallelCommand(messageText(source[i]!));
  return false;
}

/** Put the one-shot contract inside the preset's own final output block when
 * possible. This is essential for Engine Second Pass presets: their ordinary
 * last instruction says "prose only; no VELLUM block", so a leading command
 * would be contradicted and its durable payload omitted. Embedding retains the
 * preset's last-block invariant while making the exception explicit. */
export function embedParallelCommand(messages: readonly PromptMessageLike[], contract: string): { messages: PromptMessageLike[]; embeddedAt: number } {
  if (!contract) return { messages: [...messages], embeddedAt: -1 };
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role !== 'system' || message.__isChatHistory || typeof message.content !== 'string') continue;
    if (!/\[OUTPUT — FOLLOW EXACTLY\]|\[OUTPUT FORMAT|\[STATE BLOCK — MANDATORY|\[VELLUM STATE/i.test(message.content)) continue;
    const out = [...messages];
    out[i] = { ...message, content: `${message.content}\n\n[RUNTIME PARALLEL COMMAND — replaces the ordinary reply shape for this turn only]\n${contract}` };
    return { messages: out, embeddedAt: i };
  }
  return { messages: [...messages], embeddedAt: -1 };
}

function snapshot(state: ChronicleState): string {
  const data = {
    day: state.day, time: state.scene.time, foregroundLocation: state.scene.location,
    foregroundPresent: state.scene.present,
    cast: Object.values(state.cast).map(c => ({ id: c.id, name: c.name, aka: c.aka, role: c.role, traits: c.traits, status: c.status, deceased: c.deceased, lastLocation: c.lastLocation, intent: c.intent, affect: c.affect, introduction: c.introduction })),
    factions: Object.values(state.factions), factionRelations: state.factionRelations, memberships: state.memberships,
    relationships: state.relations, knowledge: state.knowledge, secrets: state.secrets,
    plotThreads: state.threads, arcs: state.arcs, currentParallel: state.parallel,
    offscreenSubplots: state.offscreen, locations: state.locations,
    directivesRelevantElsewhere: 'The runtime supplies armed directives and hard limits separately.',
    tone: state.tone,
  };
  const raw = JSON.stringify(data);
  return raw.length <= 28_000 ? raw : raw.slice(0, 28_000) + '...[snapshot capped; rely on the assembled chat, lorebooks, and VELLUM recall for omitted history]';
}

/** Special one-turn authoring contract. The visible interlude and its canonical
 * VELLUM delta describe the same events; the backend validates the batch
 * transactionally and makes durable subplot beats the source of truth. */
export function parallelCommandInjection(messages: readonly PromptMessageLike[], state: ChronicleState, presentation: ParallelPresentation): string {
  if (!activeCommand(messages)) return '';
  const visual = presentation === 'vtk'
    ? 'Render the entire visible response as exactly one VTK card: [CODEX|Meanwhile, Elsewhere|BODY]. BODY contains all 3-7 numbered vignettes. Do not put a closing square bracket inside BODY.'
    : presentation === 'artifact'
      ? 'Render the entire visible response as exactly one declarative <artifact> JSON card with type "codex", title "Meanwhile, Elsewhere", tone "neutral", and all 3-7 numbered vignettes in body.'
      : 'Render the visible response under the heading "Meanwhile, Elsewhere" with 3-7 compact numbered vignettes.';
  return `[PARALLEL EVENTS — ONE-SHOT COMMAND]
Freeze the foreground scene, its clock, its present cast, and every player action. Read the COMPLETE assembled chat history, activated lorebooks/world information, character and persona cards, VELLUM recall, Chronicle snapshot below, hard limits, directives, relationship locks, and current tone before authoring anything.

Create 3 to 7 simultaneous off-screen developments at the current story time (aim for 5). Every development MUST advance an existing off-screen subplot or seed a causally justified persistent subplot. Prefer established pressures over unrelated twists. Give each development its own location and causal reason. NPC choices arise from that NPC's goals, traits, relationships, authority, knowledge, and risk; they do not exist to serve the player. Faction acts require institutional authority, resources, information, and internal political plausibility.

ABSOLUTE SAFETY:
- Never speak, decide, move, feel, or form a relationship for the player.
- Never use a foreground-present actor as off-screen cast.
- Never mint a character or faction. Use exact canonical names and established places.
- No teleportation. Movement requires departure/travel/arrival evidence and enough elapsed time.
- An actor may use only their own recorded knowledge and their subplot history. Lorebooks constrain objective reality but grant no knowledge.
- Respect Social autonomy and Politics autonomy exactly. With Social off/reactive, emit no bonds. With Social living, only small aff/trust drift and no category flip. With Social autonomous, still take incremental steps and never mint romance/family. With Politics off, emit no faction relation changes. With Politics living, only small standing drift. With Politics autonomous, kind changes still require a believable institutional process.
- Do not kill, marry, overthrow, declare a war, resolve a major arc, or expose a secret merely to create drama.

Every development MUST become one durable off-screen subplot row and MUST link to a plot thread. Use thread as either an exact active plot-thread id/title or a concise new title literally grounded by that beat. Use arc only when it names an exact active arc or when at least two distinct generated threads genuinely belong to the same new umbrella arc; otherwise omit arc. The engine derives and records thread/arc operations from these links, so do not emit separate threads, arcs, or parallel arrays.

Each delta.offscreen row uses: op, id, name, who(optional only for an exact known NPC), where(required established place), gist, thread(required exact-or-new plot-thread id/title), arc(optional exact-or-shared title), pressure(0..5), stakes, hooks(1-2 concrete future bridges), autonomy(personal|social|faction|environment|mixed), plus its realistic next eligibility: nextTurn, nextDay with optional nextClock, or a concrete trigger. Add dependsOn/blockedBy and deadlineDay/deadlineClock when causal gates or pressure exist. Reuse an existing subplot id when continuing it. New ids are short snake_case. Give new subplots pressure 1-2; continuing danger may rise one step, never jump merely for drama. A subplot may tick next turn, on consecutive turns, after hours/days, or sleep until a trigger—never assign one shared cadence. Optional NPC-only bond shifts use delta.bonds with the ordinary VELLUM bond schema. Optional faction shifts use delta.factionRelations with the ordinary VELLUM faction-relation schema. The visible vignettes MUST state exactly the same beats as the structured rows.

${visual}

After the visible response, emit exactly one canonical raw-JSON VELLUM block:
<vellum>
{"v":3,"delta":{"offscreen":[...],"bonds":[...optional...],"factionRelations":[...optional...]}}
</vellum>
Use strict JSON with no comments, Markdown fence, nulls, trailing commas, unsupported keys, or text after </vellum>. Do not emit reverie, scene, present, foreground continuation, explanation, separate threads/arcs/parallel arrays, or any other scaffold. The command freezes the foreground; this block records only its off-screen transaction.

[CURRENT CANONICAL SNAPSHOT]
${snapshot(state)}`;
}
