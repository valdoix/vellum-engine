import type { ChronicleState } from './types.js';
import { arcLine } from './drift.js';

/**
 * Render the chronicle to a readable Markdown document — the shareable form of
 * the story (vs. the JSON export, which is a backup). PURE. Sections: Story So
 * Far (beats + chapter/arc gists), Cast (with drift arcs), Relationships, Codex,
 * Timeline landmarks. Omits empty sections.
 */
export function toMarkdown(state: ChronicleState, title = 'Chronicle'): string {
  const nm = (id: string): string => state.cast[id]?.name ?? id;
  const out: string[] = [];
  out.push('# ' + title, '');
  out.push(`*Day ${state.day ?? 0} · turn ${state.turns ?? 0} · ${Object.keys(state.cast).length} characters*`, '');

  // --- Story So Far: arcs, then chapters, then the beat spine, in order ---
  const arcs = state.memories.filter((m) => m.tier === 'arc').sort((a, b) => (a.covers?.[0] ?? a.turn) - (b.covers?.[0] ?? b.turn));
  const chapters = state.memories.filter((m) => m.tier === 'chapter').sort((a, b) => (a.covers?.[0] ?? a.turn) - (b.covers?.[0] ?? b.turn));
  const beats = state.memories.filter((m) => m.tier === 'beat').sort((a, b) => ((a.beatDay ?? 0) * 1e5 + a.turn) - ((b.beatDay ?? 0) * 1e5 + b.turn));
  if (arcs.length || chapters.length) {
    out.push('## Story So Far', '');
    for (const a of arcs) out.push('### Arc' + (a.covers ? ` (turns ${a.covers[0]}–${a.covers[1]})` : ''), '', a.text, '');
    for (const c of chapters) out.push('### Chapter' + (c.covers ? ` (turns ${c.covers[0]}–${c.covers[1]})` : ''), '', c.text, '');
  }
  if (beats.length) {
    out.push('## Landmarks', '');
    for (const b of beats) out.push('- ' + (b.beatDay !== undefined ? `**Day ${b.beatDay}${b.beatTime ? ', ' + b.beatTime : ''}** — ` : '') + b.text);
    out.push('');
  }

  // --- Cast ---
  const cast = Object.values(state.cast).filter((c) => c.status !== 'mentioned').sort((a, b) => a.name.localeCompare(b.name));
  if (cast.length) {
    out.push('## Cast', '');
    for (const c of cast) {
      out.push('### ' + c.name);
      const meta = [c.role, c.age, c.disposition].filter(Boolean).join(' · ');
      if (meta) out.push('*' + meta + '*');
      if (c.appearance) out.push(c.appearance);
      if (c.traits?.length) out.push('**Traits:** ' + c.traits.join(', '));
      const arc = arcLine(state, c.id, c.name);
      if (arc && arc !== c.name + ' — .') out.push('**Arc:** ' + arc.replace(/^[^—]*—\s*/, ''));
      // key bonds for this character
      const bonds = state.relations.filter((r) => r.a === c.id).sort((a, b) => Math.abs(b.affection) - Math.abs(a.affection)).slice(0, 4);
      if (bonds.length) out.push('**Bonds:** ' + bonds.map((r) => `${nm(r.b)} (${r.category}, aff ${r.affection > 0 ? '+' : ''}${r.affection})`).join('; '));
      if (c.note) out.push(c.note);
      out.push('');
    }
  }

  // --- Codex / lore ---
  if ((state.lore ?? []).length) {
    out.push('## Codex', '');
    for (const l of state.lore) out.push('- ' + (l.tag ? `*(${l.tag})* ` : '') + l.fact);
    out.push('');
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
