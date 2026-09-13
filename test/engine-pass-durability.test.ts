import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const backend = readFileSync(new URL('../src/backend.ts', import.meta.url), 'utf8');

describe('Engine Pass durability boundary', () => {
  it('finishes successful windows only after Chronicle flush and state broadcast', () => {
    const queuedAt = backend.indexOf('pendingEngineRuns.push({ turn: turnNo, run: engineRun');
    const flushAt = backend.indexOf('await flush(chatId);', queuedAt);
    const broadcastAt = backend.indexOf('await broadcastState(chatId, userId);', flushAt);
    const completedAt = backend.indexOf('finishPendingEngineRuns(true);', broadcastAt);

    expect(queuedAt).toBeGreaterThan(-1);
    expect(flushAt).toBeGreaterThan(queuedAt);
    expect(broadcastAt).toBeGreaterThan(flushAt);
    expect(completedAt).toBeGreaterThan(broadcastAt);
    expect(backend.slice(queuedAt, flushAt)).not.toContain('engineRun.finish(true');
  });

  it('fails pending windows when the durable write or refresh fails', () => {
    const flushAt = backend.indexOf('await flush(chatId);', backend.indexOf('pendingEngineRuns.push'));
    const completedAt = backend.indexOf('finishPendingEngineRuns(true);', flushAt);
    const boundary = backend.slice(flushAt, completedAt);

    expect(boundary).toContain("finishPendingEngineRuns(false, { reason: 'commit_error'");
    expect(boundary).toContain('throw e;');
  });
});
