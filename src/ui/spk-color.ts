import type { ChronicleState, CastCard } from '../domain/types.js';
import { HEX6, castSlotColors } from '../core/palette.js';

/**
 * Frontend dialogue colorizer. Colors `[spk=Name]…[/spk]` speaker tags emitted
 * by the companion preset directly in the rendered message DOM — no host regex
 * scripts, no permission, no backend round-trip. The color source is the cast
 * broadcast in `vellum_state`: an explicit per-character `dialogueColor` wins,
 * else a deterministic collision-free slot color (the same palette the panel
 * uses), so dialogue tint matches the cast cards.
 *
 * Display-only: we never touch stored content. Keeping `[spk=]` out of the
 * MODEL's context stays with the preset's own prompt-target strip script.
 */

/** The speaker-tag contract emitted by the preset's Colored Dialogue block. */
const SPK_RE = /\[spk=([^\]]{0,40})\]([\s\S]*?)\[\/spk\]/gi;

const DEFAULT_INK = '#b9ad92'; // unknown speaker → skin ink (never show raw tag)

/** Marker attribute: the content hash we last colorized a bubble at. Lets us
 * skip re-work when nothing changed and re-run when a swipe/edit changes text. */
const DONE_ATTR = 'data-vle-spk-done';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** Cheap, stable string hash (djb2) for change detection. */
export function hashContent(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Build a speaker→#hex map from the cast. Keyed by BOTH canonical name and every
 * `aka`, lower-cased for case-insensitive matching against the tag's name. An
 * explicit valid `dialogueColor` wins; otherwise the deterministic slot color.
 */
export function buildSpeakerColorMap(state: ChronicleState | null | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!state || !state.cast) return map;
  const cast: CastCard[] = Object.values(state.cast);
  const slotColors = castSlotColors(cast.map((c) => c.id));
  for (const c of cast) {
    const explicit = c.dialogueColor && HEX6.test(c.dialogueColor) ? c.dialogueColor : '';
    const color = explicit || slotColors.get(c.id) || DEFAULT_INK;
    if (c.name && c.name.trim()) map.set(c.name.trim().toLowerCase(), color);
    for (const aka of c.aka ?? []) if (aka && aka.trim()) map.set(aka.trim().toLowerCase(), color);
  }
  return map;
}

/**
 * Transform a raw HTML/text string: replace every `[spk=Name]…[/spk]` with a
 * colored span. Unknown speakers keep their text but lose the tag markers (so a
 * reader never sees a raw `[spk=]`), matching the preset's "reads normally"
 * fallback. Pure — unit-testable without a DOM.
 */
export function colorizeText(html: string, map: Map<string, string>): string {
  return html.replace(SPK_RE, (_m, rawName: string, inner: string) => {
    const name = String(rawName ?? '').trim();
    const color = map.get(name.toLowerCase());
    if (!color) return inner; // unknown speaker: drop the tag, keep the line
    return `<span class="vle-spk" style="color:${color}" title="${esc(name)}">${inner}</span>`;
  });
}

/** True if the given HTML still contains at least one speaker tag. */
export function hasSpkTags(html: string): boolean {
  SPK_RE.lastIndex = 0;
  return SPK_RE.test(html);
}

/**
 * Colorize one message bubble in place. Idempotent: stamps the bubble with the
 * content hash and skips if unchanged. Safe to call repeatedly (on render, edit,
 * swipe, or a cast-color change sweep). No-op if the bubble has no speaker tags.
 */
export function colorizeBubble(el: Element, map: Map<string, string>): void {
  const html = el.innerHTML;
  if (!html || html.indexOf('[spk=') === -1) return; // fast bail: no tags at all
  const stamp = hashContent(html);
  if (el.getAttribute(DONE_ATTR) === stamp) return; // already colorized this content
  const next = colorizeText(html, map);
  if (next !== html) {
    el.innerHTML = next;
    // re-stamp with the hash of the NEW html so a later identical pass short-circuits
    el.setAttribute(DONE_ATTR, hashContent(next));
  } else {
    el.setAttribute(DONE_ATTR, stamp); // nothing to do, but record we checked
  }
}

/**
 * Remove our colored spans from a bubble, restoring the original text (tags are
 * gone, but the visible words are unchanged). Used when the feature is toggled
 * off so display reverts cleanly without a reload. Clears the done-stamp so a
 * later re-enable re-colorizes.
 */
export function unwrapBubble(el: Element): void {
  const spans = el.querySelectorAll('span.vle-spk');
  if (!spans.length) { el.removeAttribute(DONE_ATTR); return; }
  spans.forEach((s) => {
    const parent = s.parentNode;
    if (!parent) return;
    while (s.firstChild) parent.insertBefore(s.firstChild, s);
    parent.removeChild(s);
  });
  el.removeAttribute(DONE_ATTR);
}

/** CSS for the colored spans. Color only — inherit host bubble typography. */
export const SPK_STYLES = '.vle-spk{color:inherit}'; // color set inline; class is a hook/marker
