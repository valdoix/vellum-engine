import { describe, it, expect } from 'vitest';
import { cmdEvents } from '../src/domain/commands.js';
import { reduce } from '../src/core/reduce.js';
import { freshState, type ChronicleState } from '../src/domain/types.js';

const ctx = { turn: 5, day: 2 };

function seed(): ChronicleState {
  return reduce(cmdEvents('cast_upsert', { entry: { name: 'Cersei Lannister', role: 'Queen' } }, freshState(), ctx));
}

describe('command layer (CRUD → events)', () => {
  it('upserts a cast member with metadata (user source)', () => {
    const s = seed();
    const c = s.cast.cersei_lannister;
    expect(c?.name).toBe('Cersei Lannister');
    expect(c?.role).toBe('Queen');
    expect(c?.userEdited).toBe(true);
  });

  it('creates and deletes a relation', () => {
    let s = freshState();
    s = reduce(cmdEvents('relation_upsert', { entry: { a: 'Cersei', b: 'Jaime', categories: 'familial,romantic', aff: 80, trust: 60 } }, s, ctx), s, 0);
    expect(s.relations).toHaveLength(1);
    expect(s.relations[0]!.categories).toContain('romantic');
    expect(s.relations[0]!.affection).toBe(80);
    const del = cmdEvents('relation_delete', { entry: { a: 'Cersei', b: 'Jaime' } }, s, ctx);
    s = reduce(del, s, 0);
    expect(s.relations).toHaveLength(0);
  });

  it('both-sides add creates A→B and B→A as distinct directed edges', () => {
    let s = freshState();
    const evs = cmdEvents('relation_upsert', { entry: { a: 'Cersei', b: 'Jaime', categories: 'familial', aff: 80, both: 'yes', blabel: 'twin sister', bcategories: 'familial', baff: 40, btrust: 30 } }, s, ctx);
    expect(evs.filter((e: any) => e.kind === 'bond.delta')).toHaveLength(2);
    s = reduce(evs, s, 0);
    const ab = s.relations.find((r) => r.a === 'cersei' && r.b === 'jaime')!;
    const ba = s.relations.find((r) => r.a === 'jaime' && r.b === 'cersei')!;
    expect(ab.affection).toBe(80);
    expect(ba.affection).toBe(40); // independent reverse score
    expect(ba.label).toBe('twin sister');
  });

  it('both:yes with an empty reciprocal adds only A→B (no blank reverse)', () => {
    const evs = cmdEvents('relation_upsert', { entry: { a: 'A', b: 'B', categories: 'social', both: 'yes' } }, freshState(), ctx);
    expect(evs.filter((e: any) => e.kind === 'bond.delta')).toHaveLength(1);
  });

  it('both omitted → one edge (unchanged)', () => {
    const evs = cmdEvents('relation_upsert', { entry: { a: 'A', b: 'B', aff: 10 } }, freshState(), ctx);
    expect(evs.filter((e: any) => e.kind === 'bond.delta')).toHaveLength(1);
  });

  it('user edit sets categories absolutely (removes dropped facets)', () => {
    let s = freshState();
    s = reduce(cmdEvents('relation_upsert', { entry: { a: 'A', b: 'B', categories: 'familial,rivalry' } }, s, ctx), s, 0);
    s = reduce(cmdEvents('relation_upsert', { entry: { a: 'A', b: 'B', categories: 'familial' } }, s, ctx), s, 0);
    expect(s.relations[0]!.categories).toEqual(['familial']);
  });

  it('adds knowledge, secrets, memories, threads; deletes memory', () => {
    let s = freshState();
    s = reduce(cmdEvents('knowledge_add', { entry: { who: 'Ned', fact: 'the truth' } }, s, ctx), s, 0);
    s = reduce(cmdEvents('secret_add', { entry: { keeper: 'Cersei', text: 'incest', from: 'Robert' } }, s, ctx), s, 0);
    s = reduce(cmdEvents('memory_add', { entry: { text: 'the tourney', keys: 'tourney' } }, s, ctx), s, 0);
    s = reduce(cmdEvents('thread_op', { entry: { op: 'new', name: 'succession' } }, s, ctx), s, 0);
    expect(s.knowledge).toHaveLength(1);
    expect(s.secrets[0]!.keeper).toBe('cersei');
    expect(s.memories).toHaveLength(1);
    expect(s.threads.find((t) => t.name === 'succession')).toBeTruthy();
    const memId = s.memories[0]!.id;
    s = reduce(cmdEvents('memory_delete', { entry: { id: memId } }, s, ctx), s, 0);
    expect(s.memories).toHaveLength(0);
  });

  it('ignores empty / invalid input', () => {
    expect(cmdEvents('cast_upsert', { entry: { name: '' } }, freshState(), ctx)).toHaveLength(0);
    expect(cmdEvents('relation_upsert', { entry: { a: 'X', b: 'X' } }, freshState(), ctx)).toHaveLength(0);
    expect(cmdEvents('bogus', {}, freshState(), ctx)).toHaveLength(0);
  });

  it('adds & deletes journal entries with categories', () => {
    let s = freshState();
    s = reduce(cmdEvents('journal_add', { entry: { who: 'Cersei', about: 'Jaime', memory: 'the look across the hall', kind: 'shared', weight: 'defining', sentiment: 'complex' } }, s, ctx), s, 0);
    expect(s.journal).toHaveLength(1);
    expect(s.journal[0]!.kind).toBe('shared');
    expect(s.journal[0]!.weight).toBe('defining');
    expect(s.journal[0]!.who).toBe('cersei');
    const id = s.journal[0]!.id;
    s = reduce(cmdEvents('journal_delete', { entry: { id } }, s, ctx), s, 0);
    expect(s.journal).toHaveLength(0);
  });

  it('Fix 4: deletes knowledge and secrets by id', () => {
    let s = freshState();
    s = reduce(cmdEvents('knowledge_add', { entry: { who: 'Ned', fact: 'the truth' } }, s, ctx), s, 0);
    s = reduce(cmdEvents('secret_add', { entry: { keeper: 'Cersei', text: 'incest' } }, s, ctx), s, 0);
    const kId = s.knowledge[0]!.id, sId = s.secrets[0]!.id;
    s = reduce(cmdEvents('knowledge_delete', { entry: { id: kId } }, s, ctx), s, 0);
    s = reduce(cmdEvents('secret_delete', { entry: { id: sId } }, s, ctx), s, 0);
    expect(s.knowledge).toHaveLength(0);
    expect(s.secrets).toHaveLength(0);
  });

  it('Fix 14: journal_edit preserves identity, updates memory', () => {
    let s = freshState();
    s = reduce(cmdEvents('journal_add', { entry: { who: 'Cersei', memory: 'first draft' } }, s, ctx), s, 0);
    const { id, turn, day, who } = s.journal[0]!;
    s = reduce(cmdEvents('journal_edit', { entry: { id, memory: 'revised', weight: 'defining' } }, s, ctx), s, 0);
    expect(s.journal).toHaveLength(1);
    expect(s.journal[0]!.id).toBe(id);
    expect(s.journal[0]!.turn).toBe(turn);
    expect(s.journal[0]!.day).toBe(day);
    expect(s.journal[0]!.who).toBe(who);
    expect(s.journal[0]!.memory).toBe('revised');
    expect(s.journal[0]!.weight).toBe('defining');
  });
});
