import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chronicleTab } from '../src/ui/tabs/chronicle.js';
import { freshState } from '../src/domain/types.js';
import { nextSeq, observeSeq } from '../src/core/ids.js';
import { STATE_COMPILER_SYSTEM } from '../src/bus/state-compiler.js';

const backend = readFileSync(new URL('../src/backend.ts', import.meta.url), 'utf8');

function switchChronicleTo(view: string): void {
  let handler: ((event: unknown) => void) | null = null;
  const host = { addEventListener: (_type: string, next: (event: unknown) => void) => { handler = next; } } as unknown as HTMLElement;
  chronicleTab.mount!(host);
  const target = { closest: (selector: string) => selector === '[data-cview]' ? { getAttribute: () => view } : null };
  handler!({ target });
}

describe('repaired Chronicle state delivery', () => {
  it('snapshots state after settings and suppresses superseded broadcasts', () => {
    const fnAt = backend.indexOf('async function broadcastState');
    const settingsAt = backend.indexOf('await Promise.all([', fnAt);
    const stateAt = backend.indexOf('const state = await loadState(chatId);', settingsAt);
    const sendAt = backend.indexOf("spindle.sendToFrontend?.({ type: 'vellum_state'", stateAt);
    const body = backend.slice(fnAt, sendAt);

    expect(settingsAt).toBeGreaterThan(fnAt);
    expect(stateAt).toBeGreaterThan(settingsAt);
    expect(sendAt).toBeGreaterThan(stateAt);
    expect(body.match(/_latestStateBroadcast\.get\(deliveryKey\) !== deliverySeq/g)).toHaveLength(2);
  });

  it('counts only rendered arcs and threads in the Chronicle World badge', () => {
    const state = freshState();
    state.offscreen = [
      { id: 'off-1', name: 'Elsewhere', gist: 'waiting', status: 'active', beats: [], lastTurn: 1, firstTurn: 1 },
      { id: 'off-2', name: 'Beyond', gist: 'watching', status: 'active', beats: [], lastTurn: 1, firstTurn: 1 },
    ];
    state.parallel = Array.from({ length: 8 }, (_, index) => ({ activity: `event ${index}`, turn: 1, day: 0 }));
    switchChronicleTo('world');
    const html = chronicleTab.render(state);

    expect(html).toContain('data-cview="world">World</button>');
    expect(html).not.toContain('data-cview="world">World <span class="vle-n">10</span>');
  });

  it('continues opening the plot ledger when an existing Chronicle has no tracks', () => {
    expect(STATE_COMPILER_SYSTEM).toContain('If prior has zero open threads');
    expect(STATE_COMPILER_SYSTEM).toContain('If prior has zero open arcs');
  });

  it('raises the event sequence floor from persisted history', () => {
    const before = nextSeq();
    observeSeq(before + 1000);
    expect(nextSeq()).toBe(before + 1001);
  });
});
