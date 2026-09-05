import type { ChronicleState, MemorySnapshot } from '../domain/types.js';
import { tokenize } from './tokenize.js';

/** One addressable continuity record. Metadata stays attached through ranking so
 * lexical, vector and controller retrieval all make the same identity-aware
 * decision and the rendered text never loses its epistemic frame. */
export interface RetrievableItem {
  id: string;
  kind: 'knowledge' | 'secret' | 'memory' | 'journal' | 'scar' | 'codex' | 'item' | 'timeline';
  text: string;
  turn: number;
  tokens: string[];
  tier?: 'turn' | 'chapter' | 'arc' | 'book' | 'beat';
  entityIds?: string[];
  knownBy?: string[];
  hiddenFrom?: string[];
  status?: string;
  parentIds?: string[];
}

/** Collect every durable record, including exact descendants retained inside a
 * chapter/arc/book. A Map prevents a current row and an archived snapshot of that row
 * from becoming two competing retrieval identities. */
export function collectItems(state: ChronicleState): RetrievableItem[] {
  const byId = new Map<string, RetrievableItem>();
  const nameOf = (id?: string): string => id ? (state.cast[id]?.name ?? id) : '';
  const namesFor = (ids: readonly string[]): string => ids.flatMap((id) => {
    const c = state.cast[id];
    return c ? [c.name, ...(c.aka ?? []), c.role ?? ''] : [id];
  }).filter(Boolean).join(' ');
  const castNeedles = Object.values(state.cast).map((c) => ({ id: c.id, labels: [c.name, ...(c.aka ?? [])].map((x) => x.normalize('NFKC').toLocaleLowerCase()).filter((x) => x.length >= 3) }));
  const mentionedEntities = (text: string): string[] => {
    const hay = text.normalize('NFKC').toLocaleLowerCase();
    return castNeedles.filter((c) => c.labels.some((label) => hay.includes(label))).map((c) => c.id);
  };
  const put = (item: Omit<RetrievableItem, 'tokens'>, searchText = item.text): void => {
    if (byId.has(item.id)) return;
    const entities = item.entityIds ?? [];
    byId.set(item.id, { ...item, tokens: tokenize(`${searchText} ${namesFor(entities)}`) });
  };

  for (const k of state.knowledge) {
    const holder = nameOf(k.who);
    const about = nameOf(k.about);
    const stance = k.reliability ?? 'knows';
    const truth = k.truth ?? 'unknown';
    const source = k.source ? ` Source: ${k.source}.` : '';
    const text = `Knowledge held by ${holder} (${stance}; actual truth ${truth}): ${k.fact}.${about ? ` About ${about}.` : ''}${source}`;
    put({ id: k.id, kind: 'knowledge', text, turn: k.turn, entityIds: [k.who, ...(k.about ? [k.about] : [])], knownBy: [k.who], status: `${stance}/${truth}` });
  }
  for (const s of state.secrets) {
    const known = [...new Set([s.keeper, ...(s.revealedTo ?? [])])];
    const hidden = (s.from ?? []).filter((id) => !known.includes(id));
    const publicLabel = s.revealed && hidden.length === 0 ? 'PUBLICLY REVEALED' : s.revealed ? 'PARTIALLY DISCLOSED' : 'STILL SECRET';
    const text = `Secret ${s.id} (${publicLabel}). Keeper: ${nameOf(s.keeper)}. Known by: ${known.map(nameOf).join(', ') || 'none'}. Hidden from: ${hidden.map(nameOf).join(', ') || (s.revealed ? 'no one' : 'unspecified')}. Fact: ${s.text}`;
    put({ id: s.id, kind: 'secret', text, turn: s.lastTurn ?? s.formedTurn, entityIds: [...new Set([...known, ...hidden])], knownBy: known, hiddenFrom: hidden, status: hidden.length ? (s.revealed ? 'partial' : 'hidden') : 'public' });
  }

  const visitMemory = (m: MemorySnapshot, parents: string[] = []): void => {
    const tier = m.tier ?? 'turn';
    const kind = tier === 'beat' ? 'timeline' : 'memory';
    const label = tier === 'beat' ? 'Timeline milestone' : `${tier[0]!.toUpperCase()}${tier.slice(1)} memory`;
    const text = `${label}: ${m.text}`;
    const keyedEntities = (m.keys ?? []).map((key) => {
      const canonical = Object.values(state.cast).find((c) => c.id === key || c.name.toLocaleLowerCase() === key.toLocaleLowerCase() || (c.aka ?? []).some((a) => a.toLocaleLowerCase() === key.toLocaleLowerCase()));
      return canonical?.id ?? '';
    }).filter(Boolean);
    const entityIds = [...new Set([...keyedEntities, ...mentionedEntities(`${m.text} ${m.detail ?? ''}`)])];
    put({ id: m.id, kind, text, turn: m.turn, tier, entityIds, parentIds: parents, status: m.status }, `${m.text} ${m.detail ?? ''} ${(m.keys ?? []).join(' ')}`);
    for (const child of m.subsumed ?? []) visitMemory(child, [...parents, m.id]);
  };
  for (const m of state.memories) visitMemory(m);

  for (const j of state.journal) {
    const entities = [j.who, ...(j.about ? [j.about] : [])];
    const text = `${nameOf(j.who)} remembers (${j.weight}, ${j.sentiment}): ${j.memory}${j.about ? ` About ${nameOf(j.about)}.` : ''}`;
    put({ id: j.id, kind: 'journal', text, turn: j.turn, entityIds: entities, knownBy: [j.who], status: j.kind });
  }
  for (const scar of state.scars ?? []) {
    const entities = [scar.who, ...(scar.about ? [scar.about] : [])];
    const text = `Scar carried by ${nameOf(scar.who)}: the disproven belief “${scar.was}” may resurface as doubt, never as fact.${scar.about ? ` About ${nameOf(scar.about)}.` : ''}`;
    put({ id: scar.id, kind: 'scar', text, turn: scar.turn, entityIds: entities, knownBy: [scar.who], status: 'disproven' });
  }
  for (const lore of state.lore ?? []) {
    if (lore.status === 'rejected') continue;
    const authority = lore.status === 'provisional' ? 'PROVISIONAL' : 'CONFIRMED';
    const text = `Codex ${lore.id} (${authority})${lore.tag ? ` [${lore.tag}]` : ''}: ${lore.fact}`;
    put({ id: lore.id, kind: 'codex', text, turn: lore.turn, status: lore.status ?? 'confirmed' }, `${text} ${(lore.revisions ?? []).map((r) => r.fact).join(' ')}`);
  }
  for (const item of state.items ?? []) {
    const holder = item.who === 'world' ? 'the current scene' : nameOf(item.who);
    const text = `Current item: ${item.item} is held by ${holder}.${item.note ? ` ${item.note}` : ''}`;
    put({ id: item.id, kind: 'item', text, turn: item.turn, entityIds: item.who === 'world' ? [] : [item.who], knownBy: item.who === 'world' ? [] : [item.who], status: item.scene ? 'scene' : 'held' });
  }
  for (const [i, step] of (state.itemHistory ?? []).entries()) {
    const from = step.from === 'world' ? 'the scene' : nameOf(step.from);
    const to = step.to === 'world' ? 'the scene' : nameOf(step.to);
    const movement = step.op === 'give' ? `${from} gave it to ${to}` : step.op === 'lose' ? `${from} lost it` : step.op === 'scene' ? 'it entered the scene' : step.op === 'gain' ? `${from} gained it` : `${from} updated it`;
    const text = `Item history: ${step.item} — ${movement}.${step.note ? ` ${step.note}` : ''}`;
    const entities = [step.from, step.to].filter((id): id is string => !!id && id !== 'world');
    put({ id: `item-history:${step.id}:${i}`, kind: 'item', text, turn: step.turn, entityIds: entities, status: step.op });
  }
  return [...byId.values()];
}

export interface InvertedIndex {
  postings: Map<string, Set<string>>;
  df: Map<string, number>;
  byId: Map<string, RetrievableItem>;
  n: number;
  avgLen: number;
}

export function buildIndex(items: RetrievableItem[]): InvertedIndex {
  const postings = new Map<string, Set<string>>();
  const df = new Map<string, number>();
  const byId = new Map<string, RetrievableItem>();
  let totalLen = 0;
  for (const it of items) {
    byId.set(it.id, it);
    totalLen += it.tokens.length;
    const seen = new Set<string>();
    for (const tok of it.tokens) {
      let set = postings.get(tok);
      if (!set) { set = new Set(); postings.set(tok, set); }
      set.add(it.id);
      if (!seen.has(tok)) { df.set(tok, (df.get(tok) ?? 0) + 1); seen.add(tok); }
    }
  }
  return { postings, df, byId, n: items.length, avgLen: items.length ? totalLen / items.length : 0 };
}
