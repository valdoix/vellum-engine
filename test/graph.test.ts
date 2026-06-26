import { describe, it, expect } from 'vitest';
import { buildModel, layout, W, H } from '../src/ui/graph/layout.js';
import { freshState, type ChronicleState } from '../src/domain/types.js';

function gotState(): ChronicleState {
  const s = freshState();
  s.turns = 20;
  const mk = (id: string, name: string) => { s.cast[id] = { id, name, aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 20, userEdited: false }; };
  ['cersei', 'jaime', 'tywin', 'ned', 'jon', 'robert'].forEach((id) => mk(id, id[0]!.toUpperCase() + id.slice(1) + (['cersei', 'jaime', 'tywin'].includes(id) ? ' Lannister' : ['ned', 'jon'].includes(id) ? ' Stark' : ' Baratheon')));
  const rel = (a: string, b: string, cats: any[], aff: number, trust: number) => s.relations.push({ a, b, label: '', categories: cats, category: cats[0], affection: aff, trust, sentiment: 'neutral', status: 'active', source: 'auto', userEdited: false, firstTurn: 1, lastTurn: 20, firstDay: 1, history: [], categoryHistory: [] });
  rel('cersei', 'jaime', ['familial', 'romantic'], 80, 60);
  rel('tywin', 'cersei', ['familial'], 10, 40);
  rel('tywin', 'jaime', ['familial'], 20, 30);
  rel('ned', 'jon', ['familial'], 85, 80);
  rel('ned', 'robert', ['alliance'], 70, 75);
  rel('cersei', 'robert', ['romantic'], -40, -50);
  return s;
}

describe('graph layout', () => {
  it('builds nodes/edges and clusters factions by surname', () => {
    const m = buildModel(gotState());
    expect(m.nodes.length).toBe(6);
    expect(m.edges.length).toBe(6);
    const lan = m.factions.find((f) => f.label === 'Lannister');
    expect(lan?.members.length).toBe(3);
    // Ned+Jon (familial) + Robert (alliance) cluster together
    const stark = m.factions.find((f) => f.members.includes('ned'));
    expect(stark?.members.length).toBe(3);
    expect(m.factions.every((f) => f.color)).toBe(true);
  });

  it('lays out within bounds, separated, deterministic', () => {
    const m = buildModel(gotState());
    const a = layout(m);
    const ids = Object.keys(a.pos);
    let minD = Infinity, inBounds = true;
    for (const id of ids) { const p = a.pos[id]!; if (p.x < 40 || p.x > W - 40 || p.y < 40 || p.y > H - 40) inBounds = false; }
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const p = a.pos[ids[i]!]!, q = a.pos[ids[j]!]!; minD = Math.min(minD, Math.hypot(p.x - q.x, p.y - q.y)); }
    expect(inBounds).toBe(true);
    expect(minD).toBeGreaterThan(30);
    const b = layout(buildModel(gotState()));
    expect(b.pos[ids[0]!]!.x).toBeCloseTo(a.pos[ids[0]!]!.x, 1); // deterministic
  });

  it('excludes isolated, non-present characters (no lonely dots)', () => {
    const s = gotState();
    s.cast.hermit = { id: 'hermit', name: 'The Hermit', aka: [], status: 'mentioned', source: 'auto', firstTurn: 1, lastTurn: 1, userEdited: false };
    expect(buildModel(s).nodes.find((n) => n.id === 'hermit')).toBeUndefined();
  });
});
