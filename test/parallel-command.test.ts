import { describe, expect, it } from 'vitest';
import { embedParallelCommand, hasParallelCommand, materializeParallelBatch, parallelCommandInjection, scrubParallelCommands } from '../src/domain/parallel-command.js';
import { readyToIntersect } from '../src/domain/offscreen.js';
import { parseState } from '../src/parse/state-block.js';
import { freshState, type ChronicleState } from '../src/domain/types.js';
import { reduce } from '../src/core/reduce.js';
import { resolveTurnContract } from '../src/domain/preset-runtime.js';
import { VellumEvent } from '../src/core/events.js';

function world(): ChronicleState {
  const s = freshState();
  s.day = 4; s.turns = 8;
  s.scene = { location: 'Hall', time: '21:00', clock: 1260, tension: 2, weather: '', present: ['mara'], detail: [] };
  s.cast = {
    mara: { id: 'mara', name: 'Mara', aka: [], status: 'present', source: 'auto', firstTurn: 1, lastTurn: 8, userEdited: false },
    ada: { id: 'ada', name: 'Ada', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 7, lastLocation: 'Gate', lastLocationTurn: 7, userEdited: false },
    ivo: { id: 'ivo', name: 'Ivo', aka: [], status: 'active', source: 'auto', firstTurn: 1, lastTurn: 6, lastLocation: 'Archive', lastLocationTurn: 6, userEdited: false },
  } as any;
  s.locations = [
    { id: 'gate', name: 'Gate', source: 'user', pinned: true, firstTurn: 1, lastTurn: 7 },
    { id: 'archive', name: 'Archive', source: 'user', pinned: true, firstTurn: 1, lastTurn: 6 },
    { id: 'harbor', name: 'Harbor', source: 'user', pinned: true, firstTurn: 1, lastTurn: 5 },
  ];
  return s;
}

describe('parallel command lifecycle', () => {
  it('detects the active VTK CODEX regex instead of assuming visual support', () => {
    const preset = {
      blocks: [{ id: 'controls', variables: [{ name: 'state_on', defaultValue: 1 }] }],
      extensions: { regex_scripts: [{ script_id: 'vellum2-card-codex', disabled: false }] },
    } as any;
    expect(resolveTurnContract(preset)?.vtkCards).toBe(true);
    preset.extensions.regex_scripts[0].disabled = true;
    expect(resolveTurnContract(preset)?.vtkCards).toBe(false);
  });

  it('fires only as a standalone control and scrubs old invocations', () => {
    expect(hasParallelCommand('OOC: ((parallel))')).toBe(true);
    expect(hasParallelCommand('What does ((parallel)) do?')).toBe(false);
    const messages = [
      { role: 'user', content: '((parallel))', __isChatHistory: true },
      { role: 'assistant', content: 'old', __isChatHistory: true },
      { role: 'user', content: 'continue', __isChatHistory: true },
    ];
    const scrubbed = scrubParallelCommands(messages);
    expect(String(scrubbed[0]!.content)).toContain('already consumed');
    expect(parallelCommandInjection(messages, world(), 'plain')).toBe('');
  });

  it('selects VTK or typed artifact presentation without weakening the batch contract', () => {
    const messages = [{ role: 'user', content: '((parallel))', __isChatHistory: true }];
    const vtk = parallelCommandInjection(messages, world(), 'vtk');
    expect(vtk).toContain('[CODEX|Meanwhile, Elsewhere|BODY]');
    expect(vtk).toContain('<vellum>');
    expect(vtk).toContain('delta.offscreen');
    expect(vtk).not.toContain('VELLUM_PARALLEL_BATCH');
    expect(parallelCommandInjection(messages, world(), 'artifact')).toContain('<artifact> JSON card');
    expect(parallelCommandInjection(messages, world(), 'plain')).toContain('3 to 7 simultaneous');
  });

  it('embeds the command in the preset final output block so engine prose-only rules cannot override it', () => {
    const messages = [
      { role: 'system', content: '[ENGINE SECOND PASS] prose only' },
      { role: 'user', content: '((parallel))', __isChatHistory: true },
      { role: 'system', content: '[OUTPUT — FOLLOW EXACTLY]\nDo not emit state.' },
    ];
    const embedded = embedParallelCommand(messages, '[PARALLEL EVENTS — ONE-SHOT COMMAND]\nEmit <vellum>.');
    expect(embedded.embeddedAt).toBe(2);
    expect(String(embedded.messages[2]!.content)).toContain('replaces the ordinary reply shape');
    expect(String(embedded.messages[2]!.content)).toContain('Emit <vellum>.');
  });
});

describe('parallel batch transaction', () => {
  it('commits subplot beats, pressure/hooks, and one replace-all parallel snapshot', () => {
    const s = world();
    const parsed = parseState(`<vellum>${JSON.stringify({ delta: { offscreen: [
      { op: 'new', id: 'gate_watch', name: 'Gate Watch', who: 'Ada', where: 'Gate', gist: 'Ada quietly doubles the watch', thread: 'The Guard Tightens', arc: 'Pressure on the City', pressure: 3, stakes: 'access to the city', hooks: ['an inspection delays a known courier'], autonomy: 'personal', nextTurn: 10, deadlineDay: 5, dependsOn: ['permit'] },
      { op: 'new', id: 'archive_lock', name: 'Archive Lock', who: 'Ivo', where: 'Archive', gist: 'Ivo finds the registry seal disturbed', thread: 'The Broken Registry Seal', arc: 'Pressure on the City', pressure: 2, hooks: ['the broken seal is reported'], autonomy: 'personal' },
      { op: 'new', id: 'harbor_prices', name: 'Harbor Prices', where: 'Harbor', gist: 'grain prices rise after two barges fail to dock', thread: 'The Rising Grain Price', pressure: 1, hooks: ['shortages reach the market'], autonomy: 'environment' },
    ] } })}</vellum>`).state!;
    let seq = 0;
    const batch = materializeParallelBatch(parsed, s, 9, 4, () => ++seq);
    expect(batch?.count).toBe(3);
    expect(batch!.events.every(event => VellumEvent.safeParse(event).success)).toBe(true);
    const next = reduce(batch!.events, s);
    expect(next.offscreen).toHaveLength(3);
    expect(next.parallel).toHaveLength(3);
    expect(next.threads).toHaveLength(3);
    expect(next.arcs).toHaveLength(1);
    expect(next.threads.filter(thread => thread.arc === next.arcs[0]!.id)).toHaveLength(2);
    expect(next.offscreen.every(subplot => !!subplot.thread && next.threads.some(thread => thread.id === subplot.thread))).toBe(true);
    expect(next.parallel).toContainEqual(expect.objectContaining({ note: 'subplot:gate_watch' }));
    expect(next.offscreen.find(o => o.id === 'gate_watch')).toMatchObject({ pressure: 3, stakes: 'access to the city', hooks: ['an inspection delays a known courier'], nextTurn: 10, deadlineDay: 5, dependsOn: ['permit'] });
    expect(next.threads.find(row => row.name === 'The Guard Tightens')).toMatchObject({ milestone: 'an inspection delays a known courier', deadlineDay: 5, dependsOn: ['permit'] });
    expect(readyToIntersect(next, next.offscreen.find(o => o.id === 'gate_watch')!)).toBe(true);
    expect(next.scene.location).toBe('Hall');
    expect(next.scene.present).toEqual(['mara']);
  });

  it('rejects the whole batch when fewer than three events survive canon validation', () => {
    const s = world();
    const parsed = parseState(`<vellum>${JSON.stringify({ delta: { offscreen: [
      { op: 'new', id: 'bad_present', name: 'Bad', who: 'Mara', where: 'Hall', gist: 'Mara acts elsewhere', thread: 'The False Elsewhere' },
      { op: 'new', id: 'bad_unknown', name: 'Bad 2', who: 'Nobody', where: 'Gate', gist: 'Nobody acts', thread: 'The Unknown Actor' },
      { op: 'new', id: 'good', name: 'Good', who: 'Ada', where: 'Gate', gist: 'Ada keeps watch', thread: 'The Gate Watch' },
    ] } })}</vellum>`).state!;
    let seq = 0;
    expect(materializeParallelBatch(parsed, s, 9, 4, () => ++seq)).toBeNull();
    expect(s.offscreen).toEqual([]);
    expect(s.parallel).toEqual([]);
  });

  it('advances the same subplot/thread/arc identities instead of fragmenting the long-running plot', () => {
    const s = world();
    const first = parseState(`<vellum>${JSON.stringify({ delta: { offscreen: [
      { op: 'new', id: 'gate_watch', name: 'Gate Watch', who: 'Ada', where: 'Gate', gist: 'Ada quietly doubles the watch', thread: 'The Guard Tightens', arc: 'Pressure on the City', pressure: 1 },
      { op: 'new', id: 'archive_lock', name: 'Archive Lock', who: 'Ivo', where: 'Archive', gist: 'Ivo finds the registry seal disturbed', thread: 'The Broken Registry Seal', arc: 'Pressure on the City', pressure: 1 },
      { op: 'new', id: 'harbor_prices', name: 'Harbor Prices', where: 'Harbor', gist: 'grain prices rise after two barges fail to dock', thread: 'The Rising Grain Price', pressure: 1 },
    ] } })}</vellum>`).state!;
    let seq = 0;
    const afterFirst = reduce(materializeParallelBatch(first, s, 9, 4, () => ++seq)!.events, s);
    const second = parseState(`<vellum>${JSON.stringify({ delta: { offscreen: [
      { op: 'advance', id: 'gate_watch', who: 'Ada', where: 'Gate', gist: 'Ada begins checking every courier seal', thread: 'The Guard Tightens', arc: 'Pressure on the City', pressure: 2 },
      { op: 'advance', id: 'archive_lock', who: 'Ivo', where: 'Archive', gist: 'Ivo compares the broken seal against the registry', thread: 'The Broken Registry Seal', arc: 'Pressure on the City', pressure: 2 },
      { op: 'advance', id: 'harbor_prices', where: 'Harbor', gist: 'the missing barges empty the grain stalls', thread: 'The Rising Grain Price', pressure: 2 },
    ] } })}</vellum>`).state!;
    const afterSecond = reduce(materializeParallelBatch(second, afterFirst, 10, 4, () => ++seq)!.events, afterFirst);
    expect(afterSecond.threads).toHaveLength(3);
    expect(afterSecond.arcs).toHaveLength(1);
    expect(afterSecond.offscreen).toHaveLength(3);
    expect(afterSecond.offscreen.find(row => row.id === 'gate_watch')?.beats).toHaveLength(2);
    expect(afterSecond.threads.find(row => row.name === 'The Guard Tightens')?.beats).toHaveLength(2);
    expect(afterSecond.parallel.find(row => row.note === 'subplot:gate_watch')?.activity).toContain('checking every courier seal');
  });
});
