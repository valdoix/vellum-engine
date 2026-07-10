import { hashStr } from '../core/ids.js';
import { castSlotColors, safeColor } from '../core/palette.js';
import type { ChronicleState } from './types.js';
import type { ScriptInput } from '../host/regex.js';

/**
 * Dialogue color script generator. Builds the display + prompt-strip regex
 * scripts that color character dialogue based on per-character `dialogueColor`
 * (explicit) or the collision-free slot palette (auto).
 * 
 * The core is a `{{switch}}` over every cast name (and `aka`) → its color,
 * injected into the display script's `replace_string`.
 */

const DEFAULT_INK = '#b9ad92'; // skin ink fallback for unknown speakers
const NAME_CAP = 100; // max names in the switch before fallback to first-letter

/** Escape a name for use as a switch key (basic sanitization). */
function escapeForSwitch(name: string): string {
  return name.replace(/::/g, '__').replace(/:/g, '_').trim();
}

/**
 * Build the `{{switch}}` replacement string that maps each speaker name to
 * their color. Explicit `dialogueColor` wins; unset → slot color; unknown → ink.
 * 
 * If the cast is huge (>NAME_CAP), falls back to a first-letter switch.
 */
export function buildColorReplaceString(state: ChronicleState): string {
  const cast = Object.values(state.cast);
  const slotColors = castSlotColors(cast.map((c) => c.id));
  
  // Gather all names (cast name + akas) → color
  const nameToColor = new Map<string, string>();
  for (const c of cast) {
    const color = c.dialogueColor && /^#[0-9a-fA-F]{6}$/.test(c.dialogueColor)
      ? c.dialogueColor
      : (slotColors.get(c.id) ?? DEFAULT_INK);
    nameToColor.set(c.name, color);
    for (const aka of c.aka ?? []) if (aka.trim()) nameToColor.set(aka.trim(), color);
  }
  
  // If too many names, fall back to first-letter switch (like the preset)
  if (nameToColor.size > NAME_CAP) {
    return buildFirstLetterSwitch();
  }
  
  // Build the switch: {{switch::$1::Name1::#hex1::Name2::#hex2::...::defaultInk}}
  const pairs: string[] = [];
  for (const [name, color] of nameToColor.entries()) {
    pairs.push(`${escapeForSwitch(name)}::${color}`);
  }
  const switchExpr = `{{switch::$1::${pairs.join('::')}::${DEFAULT_INK}}}`;
  
  return `<span style="color:${switchExpr}" title="$1">$2</span>`;
}

/** Fallback first-letter switch when the cast is huge (mirrors preset logic). */
function buildFirstLetterSwitch(): string {
  const hues = [
    '#e0736b', '#e0a24e', '#c9c14e', '#7ec46b', '#5bbfa0', '#5ab0d0',
    '#6f9be0', '#8f88e0', '#b57fe0', '#d977c4', '#d9738f', '#c98f6b', '#9ab04e',
  ];
  const pairs: string[] = [];
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(97 + i); // a-z
    const color = hues[i % hues.length]!;
    pairs.push(`${letter}::${color}`);
  }
  const switchExpr = `{{switch::{{lower::{{substr::$1::0::1}}}}::${pairs.join('::')}::${DEFAULT_INK}}}`;
  return `<span style="color:${switchExpr}" title="$1">$2</span>`;
}

/**
 * Hash the cast color assignment (sorted id → color) for idempotency.
 * Scripts are only regenerated when this hash changes.
 */
export function castColorHash(state: ChronicleState): string {
  const cast = Object.values(state.cast);
  const slotColors = castSlotColors(cast.map((c) => c.id));
  const pairs = [...cast]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((c) => {
      const color = c.dialogueColor ?? slotColors.get(c.id) ?? DEFAULT_INK;
      return `${c.id}:${color}`;
    });
  return hashStr(pairs.join('|'));
}

/**
 * Generate the two regex scripts VELLUM owns:
 * 1. Display script — colors `[spk=Name]"..."[/spk]` with per-character hues
 * 2. Strip script — removes tags from model context (prompt-target)
 * 
 * Both are chat-scoped (tied to `chatId`).
 */
export function colorScripts(chatId: string, state: ChronicleState): ScriptInput[] {
  const replaceString = buildColorReplaceString(state);
  const hash = castColorHash(state);
  
  const displayScript: ScriptInput = {
    script_id: `vellum-engine-spk-display-${chatId}`,
    name: 'VELLUM Engine — Colored dialogue (display)',
    find_regex: '\\[spk=([^\\]]{0,40})\\]([\\s\\S]*?)\\[/spk\\]',
    replace_string: replaceString,
    flags: 'gi',
    placement: ['ai_output'],
    scope: 'chat',
    scope_id: chatId,
    target: 'display',
    substitute_macros: 'after',
    run_on_edit: true,
    sort_order: 30,
    description: 'Extension-owned display script that colors each speaker dialogue per their cast card color (or deterministic slot color).',
    folder: 'VELLUM Engine',
    metadata: { vellum: true, castHash: hash },
  };
  
  const stripScript: ScriptInput = {
    script_id: `vellum-engine-spk-strip-${chatId}`,
    name: 'VELLUM Engine — Strip speaker tags (prompt)',
    find_regex: '\\[/?spk(?:=[^\\]]{0,40})?\\]',
    replace_string: '',
    flags: 'gi',
    placement: ['ai_output'],
    scope: 'chat',
    scope_id: chatId,
    target: 'prompt',
    run_on_edit: true,
    sort_order: 29,
    description: 'Removes [spk=...] tags from the model context so they never pollute the chronicle.',
    folder: 'VELLUM Engine',
    metadata: { vellum: true },
  };
  
  return [displayScript, stripScript];
}
