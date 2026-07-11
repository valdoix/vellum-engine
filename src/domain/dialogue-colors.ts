import { autoHue } from '../core/palette.js';

/**
 * Dialogue coloring (display-only). The preset's `[spk=Name]` display regex wraps
 * each attributed quote in `<span class="v-spk" data-spk="Name">`; this module
 * builds the ONE stylesheet the extension injects to color those spans. Coloring
 * never touches stored text or model context — it is pure CSS over host-rendered
 * spans, so it applies to both the backlog and every future turn without the
 * extension ever touching chat DOM.
 */

const HEX = /^#[0-9a-f]{3,8}$/i;
const HEX6 = /^#[0-9a-f]{6}$/i;

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

/** Emit the stylesheet. Matches on data-spk by name AND every alias, case-
 *  insensitively (the `i` flag), so "elara"/"Elara" and any aka all color. */
export function speakerColorCss(speakers: SpeakerColor[], fallback = 'inherit'): string {
  const rules: string[] = [`.v-spk{color:var(--vle-spk-default,${fallback})}`];
  const seen = new Set<string>();
  for (const s of speakers) {
    for (const key of [s.name, ...s.aka]) {
      const k = key.trim();
      if (!k) continue;
      const dedupe = k.toLowerCase() + '\u0000' + s.color;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      rules.push(`.v-spk[data-spk="${cssAttr(k)}" i]{color:${s.color}}`);
    }
  }
  return rules.join('\n');
}

/** Cheap change key so we skip redundant stylesheet rewrites. */
export function speakerSig(speakers: SpeakerColor[]): string {
  return speakers.map((s) => s.name + '|' + s.aka.join(',') + '|' + s.color).sort().join(';');
}
