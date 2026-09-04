import { autoHue } from '../core/palette.js';

/**
 * Dialogue coloring (display-only). The preset's `[spk=Name]` display regex wraps
 * each attributed quote in a `.v-spk` span carrying `--vle-spk-color`; this module
 * builds the ONE stylesheet the extension injects to resolve that variable from
 * the cast. Coloring never touches stored text or model context — it is pure CSS
 * over host-rendered spans, so it applies to both the backlog and every future
 * turn without the extension ever touching chat DOM.
 */

const HEX = /^#[0-9a-f]{3,8}$/i;
const HEX6 = /^#[0-9a-f]{6}$/i;

/** Canonical display-regex replacement shared by VELLUM and ARGENT LOOM.
 *
 * Lumiverse's current renderer gives authored colors precedence inside its own
 * nested dialogue/emphasis spans when an ancestor span has an inline `color`
 * declaration. The value stays indirect so the extension can update cast colors
 * for both old and newly rendered messages by changing one stylesheet. Without
 * the extension, `inherit` keeps the prose readable.
 */
export const SPEAKER_SPAN_REPLACEMENT = '<span class="v-spk" data-spk="$1" style="color:var(--vle-spk-color,inherit)">$2</span>';

export interface SpeakerColor { name: string; aka: string[]; color: string; }

interface CastLike {
  id: string;
  name: string;
  aka?: string[];
  color?: string;        // name color (#hex)
  colorTo?: string;      // name gradient end (#hex) — collapsed for dialogue
  dialogueColor?: string; // dedicated dialogue color (#hex) — wins when set
}

/** Blend two #rrggbb hexes at the midpoint into one #rrggbb. Used to COLLAPSE a
 *  gradient name (color + colorTo) into a single readable dialogue color, since a
 *  gradient on inline wrapping text renders inconsistently and risks invisibility. */
export function collapseGradient(a: string, b: string): string {
  if (!HEX6.test(a)) return HEX6.test(b) ? b : a;
  if (!HEX6.test(b)) return a;
  const ch = (h: string, i: number): number => parseInt(h.slice(i, i + 2), 16);
  const mix = (i: number): string => Math.round((ch(a, i) + ch(b, i)) / 2).toString(16).padStart(2, '0');
  return '#' + mix(1) + mix(3) + mix(5);
}

/** Resolve one character's dialogue color. Priority:
 *   1. dedicated `dialogueColor` (if a valid hex)
 *   2. name `color` — solid as-is, or gradient (color + colorTo) COLLAPSED to one
 *   3. deterministic `autoHue(id)` slot hue (matches the panel's default name hue) */
export function resolveDialogueColor(c: CastLike): string {
  if (c.dialogueColor && HEX.test(c.dialogueColor)) return c.dialogueColor;
  if (c.color && HEX6.test(c.color)) {
    return (c.colorTo && HEX6.test(c.colorTo)) ? collapseGradient(c.color, c.colorTo) : c.color;
  }
  if (c.color && HEX.test(c.color)) return c.color; // #rgb / #rrggbbaa — use as-is, no collapse
  return autoHue(c.id);
}

/** Build the speaker→color list from cast. */
export function buildSpeakerColors(cast: Record<string, CastLike> | undefined): SpeakerColor[] {
  if (!cast) return [];
  const out: SpeakerColor[] = [];
  for (const c of Object.values(cast)) {
    if (!c?.name) continue;
    out.push({ name: c.name, aka: (c.aka ?? []).filter(Boolean), color: resolveDialogueColor(c) });
  }
  return out;
}

/** Escape a name for safe use inside a CSS attribute-selector string. */
function cssAttr(s: string): string { return s.replace(/["\\]/g, '\\$&'); }

const NAME_TITLES = new Set([
  'mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'doctor', 'prof', 'professor',
  'sir', 'dame', 'lady', 'lord', 'prince', 'princess', 'king', 'queen',
  'captain', 'commander', 'general', 'colonel', 'major', 'sergeant',
  'father', 'mother', 'sister', 'brother', 'saint', 'st',
]);

/** Conservative short forms the model commonly emits in `[spk=...]` even when
 *  CAST supplied a full formal name. They are installed only when exactly one
 *  cast member owns the form, so shared given names/surnames never pick a color
 *  by accident. Explicit aliases still participate in the same ambiguity gate. */
function implicitNameForms(name: string): string[] {
  const raw = name.trim();
  if (!raw) return [];
  const parts = raw.split(/\s+/);
  let start = 0;
  while (start < parts.length - 1 && NAME_TITLES.has(parts[start]!.replace(/\.$/, '').toLowerCase())) start++;
  const core = parts.slice(start);
  const out: string[] = [];
  const untitled = core.join(' ');
  if (untitled && untitled.toLowerCase() !== raw.toLowerCase()) out.push(untitled);
  if (core.length > 1) {
    out.push(core[0]!);
    out.push(core[core.length - 1]!);
  }
  return [...new Set(out.map((v) => v.trim()).filter((v) => v.length >= 2))];
}

/** Emit the stylesheet. Matches on data-spk by name AND every alias, case-
 *  insensitively (the `i` flag), so "elara"/"Elara" and any aka all color.
 *
 *  The inline color marker emitted by SPEAKER_SPAN_REPLACEMENT is the current
 *  Lumiverse renderer contract: its nested dialogue/emphasis spans inherit the
 *  authored color. We also retain an explicit outer/descendant fallback for old
 *  imported regex packs and older renderers that did not implement that rule. */
export function speakerColorCss(speakers: SpeakerColor[], fallback = 'inherit'): string {
  const rules: string[] = [
    `.v-spk{--vle-spk-color:var(--vle-spk-default,${fallback});color:var(--vle-spk-color)!important}`,
    `.v-spk *{color:inherit!important}`,
  ];
  const keysBySpeaker = speakers.map((s) => [...new Set([s.name, ...s.aka, ...implicitNameForms(s.name)].map((v) => v.trim()).filter(Boolean))]);
  const owners = new Map<string, Set<number>>();
  for (let i = 0; i < keysBySpeaker.length; i++) {
    for (const key of keysBySpeaker[i]!) {
      const normalized = key.toLowerCase();
      const set = owners.get(normalized) ?? new Set<number>();
      set.add(i);
      owners.set(normalized, set);
    }
  }
  const seen = new Set<string>();
  for (let i = 0; i < speakers.length; i++) {
    const s = speakers[i]!;
    for (const key of keysBySpeaker[i]!) {
      const k = key.trim();
      if (!k) continue;
      if ((owners.get(k.toLowerCase())?.size ?? 0) !== 1) continue;
      const dedupe = k.toLowerCase() + '\u0000' + s.color;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      const sel = `.v-spk[data-spk="${cssAttr(k)}" i]`;
      rules.push(`${sel}{--vle-spk-color:${s.color}}`);
    }
  }
  return rules.join('\n');
}

/** Cheap change key so we skip redundant stylesheet rewrites. */
export function speakerSig(speakers: SpeakerColor[]): string {
  return speakers.map((s) => s.name + '|' + s.aka.join(',') + '|' + s.color).sort().join(';');
}
