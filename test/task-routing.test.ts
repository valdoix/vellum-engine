import { describe, expect, it } from 'vitest';
import { resolveTaskRoute, sanitizeModelRoutes, sanitizeTaskRoute } from '../src/domain/task-routing.js';

describe('VELLUM task model routing', () => {
  it('lets chat routes override personal defaults and inherits related jobs', () => {
    const personal = sanitizeModelRoutes({ routes: { engine: { source: 'connection', connectionId: 'fast' }, summaryDetail: { source: 'connection', connectionId: 'writer' } } });
    const chat = sanitizeModelRoutes({ routes: { engine: { source: 'connection', connectionId: 'precise' } } });
    expect(resolveTaskRoute('engine', personal, chat).connectionId).toBe('precise');
    expect(resolveTaskRoute('engineRetry', personal, chat).connectionId).toBe('precise');
    expect(resolveTaskRoute('summaryGist', personal, chat).connectionId).toBe('writer');
  });

  it('clamps every user-tunable generation parameter and removes duplicates', () => {
    const route = sanitizeTaskRoute({ source: 'connection', connectionId: ' x ', fallbackIds: ['a', 'a', '', 'b'], maxTokens: 999999, timeoutMs: 2, temperature: 9, retries: 50, reasoning: 'high' });
    expect(route).toMatchObject({ connectionId: 'x', fallbackIds: ['a', 'b'], maxTokens: 128000, timeoutMs: 1000, temperature: 2, retries: 8, reasoning: 'high' });
  });

  it('never persists provider secrets or unknown route keys', () => {
    const config = sanitizeModelRoutes({ routes: { recall: { source: 'default', apiKey: 'secret' }, bogus: { source: 'connection', connectionId: 'bad' } } });
    expect(JSON.stringify(config)).not.toContain('secret');
    expect((config.routes as any).bogus).toBeUndefined();
  });
});
