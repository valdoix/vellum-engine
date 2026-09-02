import { beforeEach, describe, expect, it } from 'vitest';
import { append, flush, invalidate } from '../src/store/chronicle.js';

const files = new Map<string, string>();
let mainWrites = 0;
let failMainWrite = false;
let firstWriteGate: Promise<void> | null = null;
let releaseFirstWrite: (() => void) | null = null;

function event(seq: number): any {
  return { seq, turn: seq, day: 0, src: 'model', kind: 'turn.fold', sig: `sig-${seq}` };
}

beforeEach(() => {
  files.clear();
  mainWrites = 0;
  failMainWrite = false;
  firstWriteGate = null;
  releaseFirstWrite = null;
  invalidate();
  (globalThis as any).spindle = {
    log: { warn: () => {} },
    storage: {
      exists: async (path: string) => files.has(path),
      read: async (path: string) => {
        const value = files.get(path);
        if (value === undefined) throw new Error('missing');
        return value;
      },
      write: async (path: string, data: string) => {
        if (path.endsWith('.bak.json')) { files.set(path, data); return; }
        mainWrites += 1;
        if (mainWrites === 1 && firstWriteGate) await firstWriteGate;
        if (failMainWrite) throw new Error('disk-full');
        files.set(path, data);
      },
    },
  };
});

describe('chronicle persistence serialization', () => {
  it('cannot let an older concurrent snapshot overwrite a newer append', async () => {
    const chatId = 'persist-race';
    firstWriteGate = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });

    const first = append(chatId, [event(1)]);
    while (mainWrites === 0) await Promise.resolve();
    const second = append(chatId, [event(2)]);
    releaseFirstWrite!();
    await Promise.all([first, second]);

    const saved = JSON.parse(files.get(`vellum/log-${chatId}.json`) ?? '{}');
    expect(saved.events.map((item: any) => item.seq)).toEqual([1, 2]);
    expect(mainWrites).toBe(2);
  });

  it('surfaces a failed write and keeps the log dirty for a later flush', async () => {
    const chatId = 'persist-retry';
    failMainWrite = true;
    await expect(append(chatId, [event(1)])).rejects.toThrow('disk-full');

    failMainWrite = false;
    await flush(chatId);

    const saved = JSON.parse(files.get(`vellum/log-${chatId}.json`) ?? '{}');
    expect(saved.events.map((item: any) => item.seq)).toEqual([1]);
    expect(mainWrites).toBe(2);
  });
});
