import { describe, expect, it } from 'vitest';
import { formatDryRunMessages, visiblePreviewContent } from '../src/domain/preset-preview.js';

describe('preset preview output boundary', () => {
  it('returns visible prose and strips model-facing state scaffolding', () => {
    expect(visiblePreviewContent({
      content: '<reverie>plan</reverie>\nRain threaded the lamplight.\n<vellum>{"events":[]}</vellum>',
      reasoning: 'private chain of thought',
    })).toBe('Rain threaded the lamplight.');
  });

  it('never falls back to hidden reasoning when visible content is empty', () => {
    expect(visiblePreviewContent({ content: '', reasoning: 'I should ask what the user wants.' })).toBeNull();
    expect(visiblePreviewContent({ reasoning: 'private plan' })).toBeNull();
  });

  it('unwraps a plain prose fence without exposing separate reasoning fields', () => {
    expect(visiblePreviewContent({ content: '```text\nA train sighed into the station.\n```', reasoning: 'ignore me' }))
      .toBe('A train sighed into the station.');
  });

  it('formats exact dry-run message roles and applies an inspection bound', () => {
    const prompt = formatDryRunMessages([
      { role: 'system', content: 'System contract' },
      { role: 'user', content: 'Hello' },
    ], 28);
    expect(prompt).toBe('[system]\nSystem contract\n\n[u');
    expect(prompt).toHaveLength(28);
  });
});
