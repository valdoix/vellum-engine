import { describe, it, expect } from 'vitest';
import { sanitizeDirectives, directiveInjection, reconcileDirectives, pruneDone, type Directive } from '../src/domain/directive.js';
import type { VellumEvent } from '../src/core/events.js';

const armed = (over: Partial<Directive> = {}): Directive => ({ id: 'd1', kind: 'reveal_secret', text: 'Reveal the poison plot', target: 'sec1', status: 'armed', createdTurn: 1, ttl: 6, ...over });

describe('directive — sanitize', () => {
  it('keeps valid, drops invalid kind / empty text / self', () => {
    const out = sanitizeDirectives([
      { kind: 'reveal_secret', text: 'x', target: 'sec1' },
      { kind: 'bogus', text: 'y' },
      { kind: 'note', text: '' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('reveal_secret');
    expect(out[0]!.status).toBe('armed'); // default
  });
});

describe('directive — injection', () => {
  it('renders only armed directives, empty when none armed', () => {
    expect(directiveInjection([armed(), armed({ id: 'd2', status: 'done' })])).toContain('Reveal the poison plot');
    expect(directiveInjection([armed({ status: 'done' })])).toBe('');
  });
});

describe('directive — self-clear + TTL', () => {
  it('clears a reveal_secret when the matching secret.reveal fires', () => {
    const events = [{ kind: 'secret.reveal', id: 'sec1', to: [] }] as unknown as VellumEvent[];
    const { directives, changed } = reconcileDirectives([armed()], events, 2);
    expect(changed).toBe(true);
    expect(directives[0]!.status).toBe('done');
  });

  it('clears an advance_thread on a matching thread.op advance (case-insensitive)', () => {
    const d = armed({ kind: 'advance_thread', target: 'The Siege', id: 'd3' });
    const events = [{ kind: 'thread.op', op: 'advance', name: 'the siege' }] as unknown as VellumEvent[];
    const { directives } = reconcileDirectives([d], events, 2);
    expect(directives[0]!.status).toBe('done');
  });

  it('does not clear when an unrelated event fires', () => {
    const events = [{ kind: 'secret.reveal', id: 'other', to: [] }] as unknown as VellumEvent[];
    const { directives, changed } = reconcileDirectives([armed()], events, 2);
    expect(changed).toBe(false);
    expect(directives[0]!.status).toBe('armed');
  });

  it('expires an armed directive past its TTL', () => {
    const { directives, changed } = reconcileDirectives([armed({ createdTurn: 1, ttl: 3 })], [], 4);
    expect(changed).toBe(true);
    expect(directives[0]!.status).toBe('done');
  });

  it('pruneDone keeps only armed', () => {
    expect(pruneDone([armed(), armed({ id: 'd2', status: 'done' })])).toHaveLength(1);
  });
});
