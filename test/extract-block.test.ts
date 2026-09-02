import { describe, it, expect } from 'vitest';
import { extractVellumBlock } from '../src/parse/state-block.js';

const VALID_BODY = '{ "turn": 5, "scene": { "loc": "hall" }, "present": [{ "id": "Aria" }] }';

describe('extractVellumBlock', () => {
  it('extracts a well-formed <vellum> block including the fence', () => {
    const raw = 'She watched the door.\n<vellum>\n' + VALID_BODY + '\n</vellum>';
    const block = extractVellumBlock(raw);
    expect(block).not.toBeNull();
    expect(block!).toContain('<vellum>');
    expect(block!).toContain('"turn": 5');
  });

  it('returns null for prose with no block', () => {
    expect(extractVellumBlock('Just narrative prose, nothing structured here.')).toBeNull();
  });

  it('returns null for empty / whitespace input', () => {
    expect(extractVellumBlock('')).toBeNull();
    expect(extractVellumBlock('   ')).toBeNull();
  });

  it('returns null when the trailing object carries no real state keys', () => {
    // a schema-less object must not be surfaced as a "block example"
    const raw = 'Prose.\n<vellum>\n{ "foo": "bar" }\n</vellum>';
    expect(extractVellumBlock(raw)).toBeNull();
  });

  it('extracts a bare trailing JSON block when the fence tag drifted (block in the tail)', () => {
    // the model emitted the JSON but the fence tag drifted — parser-consistent
    // suffix detection finds a schema-keyed trailing object when it sits in the
    // final portion of the message (where a real state block always lives).
    const prose = 'She turned away and the door closed behind her, the corridor swallowing the last of the lamplight. ';
    const raw = prose + prose + '\n\n' + VALID_BODY;
    const block = extractVellumBlock(raw);
    expect(block).not.toBeNull();
    expect(block!).toContain('"turn": 5');
  });

  it('does not include the prose before the block', () => {
    const raw = 'A long paragraph of story prose that must not leak into the example.\n<vellum>\n' + VALID_BODY + '\n</vellum>';
    const block = extractVellumBlock(raw);
    expect(block).not.toBeNull();
    expect(block!).not.toContain('long paragraph of story prose');
  });
});
