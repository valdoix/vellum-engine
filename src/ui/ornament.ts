/**
 * Card-shape ORNAMENT layer (mockups 30-35). A silhouette is more than a corner
 * radius: every gallery card layers a defining detail on top of its outline
 * (folio dog-ear fold, gem facet lines, ticket tear, futuristic reticle,
 * ember constellation, chronicle scar seam). This module returns that detail as
 * a small, self-contained HTML/SVG snippet a renderer appends ONCE inside a card
 * root. Everything here is:
 *   - PRESENTATION ONLY (no state, no engine) and pure given its inputs;
 *   - absolutely positioned + pointer-events:none (see .v-ornlayer in styles.ts);
 *   - default-safe: renderers gate on activeShape(surface) which is null on the
 *     default chrome, so the default theme emits NO ornament markup;
 *   - motion-safe: no inline animation; any motion lives in CSS behind --vmotion.
 *
 * Inline SVG is used where a pseudo-element cannot draw the form (folds, facets,
 * arcs, jagged seams). Simpler details (accent bar, reticle ticks, tear line,
 * inner frame, cameo/tarot avatar reshape) are pure CSS keyed off the same
 * data-shape-<surface> attribute and live in styles.ts instead.
 *
 * GROUNDED (mockup 36): cards are wide horizontal rows (ratio 1.2..6.7), so every
 * SVG ornament is FIXED-SIZE and corner/strip-anchored by CSS and never stretches
 * with the card. SVGs inherit color via the --vg accent token. XML comments must
 * never contain `--` (breaks the SVG parser); we use none.
 */
import type { ShapeId, Surface } from './theme.js';

// wrap a snippet in the shared, non-interactive ornament layer
const layer = (inner: string, extra = ''): string =>
  `<span class="v-ornlayer${extra}" aria-hidden="true">${inner}</span>`;

/**
 * A FIXED-SIZE, corner/edge-anchored SVG (mockup 36 rule 3). Ornaments are drawn
 * in their own px coordinate space and pinned by CSS to a corner or a strip, so
 * they NEVER stretch with the card's ratio (the v1 bug was preserveAspectRatio
 * =none on a full-bleed viewBox, which skewed the fold/facets on wide rows).
 */
const svgFixed = (w: number, h: number, body: string, cls: string): string =>
  `<svg class="v-ornsvg ${cls}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" focusable="false">${body}</svg>`;

/**
 * The ornament for a given resolved shape on a given surface, or '' when the
 * shape carries its detail purely in CSS. Callers pass the ACTIVE shape (see
 * activeShape) so the default chrome -> null -> no call and no markup.
 */
export function shapeOrnament(shape: ShapeId | null, _surface: Surface): string {
  switch (shape) {
    case 'folio':
      // turned-page dog-ear: a fixed 16px corner triangle pinned top-right, with
      // an accent underside + crease. Fixed box => never stretches.
      return layer(svgFixed(16, 16,
        '<path class="v-fold-back" d="M0 0 H16 V16 Z"/>' +
        '<path class="v-fold-crease" d="M16 0 L0 16"/>',
        'v-ornsvg--folio',
      ));
    case 'gem':
      // cut-stone facet sparks: four short accent hairlines just inside each
      // beveled corner. Drawn as pure CSS pseudo-elements (see .vle-*[data-shape]
      // gem rules in styles.ts) so no markup is needed; nothing to emit here.
      return '';
    case 'constellation':
      // ember bonds: a dotted arc + star nodes pinned to a FIXED 22px top strip
      // so it reads the same whether the card is short or tall.
      return layer(svgFixed(320, 22,
        '<path class="v-const-arc" fill="none" d="M14 16 Q90 3 160 10 T306 6"/>' +
        '<g class="v-const-star">' +
        '<circle cx="14" cy="16" r="2.2"/><circle cx="160" cy="10" r="2.6"/>' +
        '<circle cx="236" cy="7" r="1.8"/><circle cx="306" cy="6" r="2.2"/>' +
        '</g>',
        'v-ornsvg--const',
      ));
    default:
      return '';
  }
}

/**
 * Chronicle scar seam: a jagged torn polyline pinned to a FIXED-height mid strip
 * (solid=open, dotted+faded=healing). Fixed box, so it never stretches.
 */
export function scarSeam(healing: boolean): string {
  return layer(svgFixed(320, 20,
    `<path class="v-scar${healing ? ' v-scar--healing' : ''}" fill="none" ` +
    'd="M0 12 L28 6 L52 14 L80 4 L108 12 L150 3 L200 13 L260 5 L320 11"/>',
    'v-ornsvg--scar',
  ));
}
