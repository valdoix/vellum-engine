import { z } from 'zod';
import { ParsedState } from '../parse/parsed.js';
import { canonId, hashStr } from '../core/ids.js';
import type { ChronicleState } from './types.js';

/** Compilation rejects malformed data. The legacy parser remains a separate salvage lane. */
function strict(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodCatch) return strict(schema.removeCatch());
  if (schema instanceof z.ZodOptional) return strict(schema.unwrap()).optional();
  if (schema instanceof z.ZodObject) return z.object(Object.fromEntries(Object.entries(schema.shape).map(([k, v]) => [k, strict(v as z.ZodTypeAny)]))).strict();
  if (schema instanceof z.ZodArray) return z.array(strict(schema.element)).max(200);
  if (schema instanceof z.ZodString) return schema.max(4000);
  return schema;
}
const text = z.string().trim().min(1).max(4000);
const name = z.string().trim().min(1).max(120);
const item = (shape: z.ZodRawShape) => z.array(z.object(shape).strict()).max(100);
const Delta = strict(ParsedState.shape.delta.removeCatch().unwrap()) as z.ZodObject<any>;
export const CompilerState = z.object({
  turn: z.number().int().nonnegative(), day: z.number().int().nonnegative(),
  scene: z.object({ loc: text, time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), clock: z.number().int().min(0).max(1439), tension: z.number().min(0).max(10).optional(), weather: z.string().max(500).optional() }).strict(),
  present: item({ id: name, mood: z.string().max(500).optional(), doing: z.string().max(500).optional(), condition: z.string().max(500).optional(), thought: z.string().max(1200), traits: z.array(name).max(12).optional() }),
  delta: Delta.omit({ parallel: true }),
  ext: z.object({
    scars: item({ who: name, was: text, about: name.optional() }).optional(),
    codex: item({ fact: text, tag: name.optional() }).optional(),
    inventory: item({ who: name, item: text, op: z.enum(['gain', 'lose', 'give', 'scene', 'note']), to: name.optional(), note: text.optional() }).optional(),
    plant: item({ what: text }).optional(), payoff: item({ what: text }).optional(),
  }).strict(),
}).strict();
export const CompilerCandidate = z.object({
  state: CompilerState,
  parallelOps: item({ op: z.enum(['start', 'advance', 'move', 'resolve']), who: name, where: text.optional(), activity: text.optional(), evidence: text }),
  // Every prior row must be accounted for. A forgotten actor cannot silently disappear.
  parallelReviewed: z.array(name).max(200),
  evidence: item({ path: text, quote: text }),
  genesis: z.boolean(),
}).strict();
export type StateCandidate = z.infer<typeof CompilerCandidate>;
export type CompilerInput = { prior: ChronicleState; turn: number; prose: string; userName: string; genesisAllowed: boolean; verbosity?: 'lean' | 'full'; codexAllowed?: boolean; inventoryAllowed?: boolean };
export type Compilation = { ok: true; block: string; candidate: StateCandidate; baseHash: string } | { ok: false; errors: string[] };
export const stateRevision = (state: ChronicleState): string => hashStr(JSON.stringify(state));

/** A provider-neutral JSON schema generated from the same strict validator. */
export function jsonSchema(s: z.ZodTypeAny): Record<string, unknown> {
  if (s instanceof z.ZodOptional) return jsonSchema(s.unwrap());
  if (s instanceof z.ZodDefault) return jsonSchema(s.removeDefault());
  if (s instanceof z.ZodCatch) return jsonSchema(s.removeCatch());
  if (s instanceof z.ZodNullable) return { anyOf: [jsonSchema(s.unwrap()), { type: 'null' }] };
  if (s instanceof z.ZodUnion) return { anyOf: s.options.map((option: z.ZodTypeAny) => jsonSchema(option)) };
  if (s instanceof z.ZodLiteral) return { const: s.value, type: typeof s.value };
  if (s instanceof z.ZodRecord) return { type: 'object', additionalProperties: jsonSchema(s.valueSchema) };
  if (s instanceof z.ZodObject) return { type: 'object', additionalProperties: false, properties: Object.fromEntries(Object.entries(s.shape).map(([k, v]) => [k, jsonSchema(v as z.ZodTypeAny)])), required: Object.entries(s.shape).filter(([, v]) => !(v instanceof z.ZodOptional)).map(([k]) => k) };
  if (s instanceof z.ZodArray) return { type: 'array', items: jsonSchema(s.element), maxItems: s._def.maxLength?.value };
  if (s instanceof z.ZodEnum) return { type: 'string', enum: s.options };
  if (s instanceof z.ZodBoolean) return { type: 'boolean' };
  if (s instanceof z.ZodNumber) return { type: s.isInt ? 'integer' : 'number', ...(s.minValue !== null ? { minimum: s.minValue } : {}), ...(s.maxValue !== null ? { maximum: s.maxValue } : {}) };
  if (s instanceof z.ZodString) return { type: 'string', ...(s.minLength ? { minLength: s.minLength } : {}), ...(s.maxLength ? { maxLength: s.maxLength } : {}), ...Object.assign({}, ...s._def.checks.filter(c => c.kind === 'regex').map(c => ({ pattern: (c as { regex: RegExp }).regex.source }))) };
  if (s instanceof z.ZodUnknown || s instanceof z.ZodAny) return {};
  throw new Error('Unsupported compiler schema: ' + s._def.typeName);
}

export function validateCompilation(raw: unknown, input: CompilerInput): Compilation {
  const parsed = CompilerCandidate.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) };
  const c = parsed.data;
  const s = c.state;
  const errors: string[] = [];
  if (s.turn !== input.turn) errors.push('turn must equal the engine turn');
  const [h, m] = s.scene.time.split(':').map(Number);
  if (h! * 60 + m! !== s.scene.clock) errors.push('time and clock disagree');
  if (s.day * 1440 + s.scene.clock < input.prior.day * 1440 + (input.prior.scene.clock ?? 0)) errors.push('clock moves backward');
  const needsEvidence = (path: string, changed: boolean) => { if (changed && !c.evidence.some(e => e.path === path && input.prose.includes(e.quote))) errors.push(`missing evidence: ${path}`); };
  needsEvidence('scene.loc', s.scene.loc !== input.prior.scene.location);
  needsEvidence('scene.time', s.day !== input.prior.day || s.scene.clock !== input.prior.scene.clock);
  if (c.genesis && (!input.genesisAllowed || !(s.ext.codex?.length))) errors.push('genesis requires an eligible request and established world facts');
  if (s.ext.codex?.length && input.codexAllowed === false && !(input.genesisAllowed && c.genesis)) errors.push('codex output is disabled');
  if (s.ext.inventory?.length && input.inventoryAllowed === false) errors.push('inventory output is disabled');
  const present = new Set<string>();
  const allowed = new Set(Object.keys(input.prior.cast));
  const player = canonId(input.userName);
  if (player) allowed.add(player);
  const literalName = (n: string) => input.prose.toLocaleLowerCase().includes(n.toLocaleLowerCase());
  for (const p of s.present) {
    const id = canonId(p.id);
    if (present.has(id)) errors.push(`duplicate present actor: ${p.id}`);
    if (!allowed.has(id) && !literalName(p.id)) errors.push(`unsupported identity: ${p.id}`);
    present.add(id); allowed.add(id);
    if (id === player) {
      if (p.thought || p.mood || p.doing || p.condition || p.traits?.length) errors.push('player fields must be empty');
    } else if (!p.thought.trim()) errors.push(`missing NPC thought: ${p.id}`);
  }
  const priorPresent = new Set(input.prior.scene.present.map(canonId));
  for (const id of priorPresent) needsEvidence(`present.remove.${id}`, !present.has(id));
  for (const id of present) if (id !== player) needsEvidence(`present.add.${id}`, !priorPresent.has(id));
  const known = (n: string) => allowed.has(canonId(n)) || literalName(n);
  const evidence = new Map(c.evidence.map(e => [e.path, e.quote]));
  for (const e of c.evidence) if (!input.prose.includes(e.quote)) errors.push(`evidence is not a prose quote: ${e.path}`);
  for (const [section, rows] of Object.entries(s.delta)) {
    if (!Array.isArray(rows)) continue;
    rows.forEach((row: Record<string, any>, index: number) => {
      if (!evidence.has(`delta.${section}.${index}`)) errors.push(`missing evidence: delta.${section}.${index}`);
      for (const key of ['who', 'keeper', 'about']) if (row[key] && !known(row[key])) errors.push(`unknown ${key}: ${row[key]}`);
      if (section === 'bonds' && (!known(row.a) || !known(row.b) || canonId(row.a) === canonId(row.b))) errors.push('invalid bond identities');
      if (section === 'knowledge' && (!row.source?.trim() || !evidence.has(`delta.knowledge.${index}`))) errors.push('knowledge requires a transmission source and evidence');
      if (section === 'knowledge' && !input.prior.scene.present.map(canonId).includes(canonId(row.who)) && !/(told|heard|read|saw|witness|inferred|report|letter|message|broadcast)/i.test(row.source ?? '')) errors.push(`off-stage knowledge lacks an explicit transmission path: ${row.who}`);
    });
  }
  for (const [section, rows] of Object.entries(s.ext)) {
    if (!Array.isArray(rows)) continue;
    rows.forEach((row: any, i: number) => {
      if (!evidence.has(`ext.${section}.${i}`)) errors.push(`missing evidence: ext.${section}.${i}`);
      if (row.who && row.who !== 'world' && !known(row.who)) errors.push(`unknown owner: ${row.who}`);
      if (row.op === 'give' && (!row.to || !known(row.to))) errors.push('give requires a known recipient');
    });
  }
  const rows = new Map(input.prior.parallel.filter(p => p.who).map(p => [canonId(p.who!), { who: input.prior.cast[p.who!]?.name ?? p.who!, where: p.where ?? '', activity: p.activity, note: p.note }]));
  const reviewed = new Set(c.parallelReviewed.map(canonId));
  for (const id of rows.keys()) if (!reviewed.has(id)) errors.push(`parallel actor not reviewed: ${id}`);
  const operated = new Set<string>();
  for (const op of c.parallelOps) {
    const id = canonId(op.who);
    if (operated.has(id)) errors.push(`duplicate parallel operation: ${id}`);
    operated.add(id);
    if (!input.prose.includes(op.evidence)) errors.push(`parallel operation lacks prose evidence: ${id}`);
    if (!known(op.who)) errors.push(`unknown parallel actor: ${id}`);
    if (op.op === 'start' && rows.has(id)) errors.push(`parallel start already exists: ${id}`);
    if (op.op !== 'start' && !rows.has(id)) errors.push(`parallel operation has no prior row: ${id}`);
    if (op.op === 'resolve') rows.delete(id);
    else {
      if (!op.where?.trim() || !op.activity?.trim()) errors.push(`parallel ${op.op} requires where and activity`);
      rows.set(id, { who: op.who, where: op.where ?? '', activity: op.activity ?? '', note: undefined });
    }
  }
  // Arrivals are removed by the engine; unchanged off-stage actors survive omissions.
  for (const id of present) rows.delete(id);
  if (errors.length) return { ok: false, errors };
  const state = { ...s, delta: { ...s.delta, parallel: [...rows.values()] } };
  return { ok: true, candidate: c, baseHash: stateRevision(input.prior), block: `<vellum>\n${JSON.stringify(state)}\n</vellum>` };
}
