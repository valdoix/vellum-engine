import { z } from 'zod';
export const Artifact = z.object({
  type: z.enum(['letter', 'codex', 'text', 'decree', 'portrait', 'map', 'item', 'title', 'verse', 'tarot', 'broadsheet', 'playbill']),
  title: z.string().max(160), body: z.string().max(8000), tone: z.enum(['neutral', 'warning', 'warm']).default('neutral'),
}).strict();
export const escapeArtifact = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const ARTIFACT_CSS = `:root{color-scheme:light dark}body{margin:0;font:16px/1.65 system-ui;color:var(--vle-text,CanvasText);background:transparent}.argent-artifact{padding:1rem 1.25rem;border:1px solid var(--vle-border,GrayText);border-radius:.6rem;overflow-wrap:anywhere;background:var(--vle-bg,Canvas)}.argent-artifact h2{font-size:1.15rem;margin:0 0 .65rem}.argent-artifact p{margin:0;white-space:pre-wrap}.argent-artifact small{font-size:.875rem;opacity:.8}.argent-artifact[data-tone=warning]{border-inline-start:4px solid #b77925}.argent-artifact[data-tone=warm]{border-inline-start:4px solid #a55864}@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}`;
/** Text fields are escaped, never used as HTML, CSS, URLs or attribute names. */
export function renderArtifact(raw: string): string | null {
  try {
    const a = Artifact.parse(JSON.parse(raw));
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>${ARTIFACT_CSS}</style></head><body><article class="argent-artifact" data-tone="${a.tone}" aria-label="${a.type}"><small>${a.type}</small><h2>${escapeArtifact(a.title)}</h2><p>${escapeArtifact(a.body)}</p></article></body></html>`;
  } catch { return null; }
}
export function artifactText(raw: string): string {
  try { const a = Artifact.parse(JSON.parse(raw)); return `${a.title}\n${a.body}`; } catch { return ''; }
}
