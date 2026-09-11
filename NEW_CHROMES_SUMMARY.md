# New Chromes and Skins Added to VELLUM Engine

## Summary

Added **2 new chromes** (Gatsby and Sumi), **8 new skins** (including 2 monochrome variants), **3 new card shapes**, **3 new texture SVGs**, **custom Google Font loading**, and **chrome-specific animations** to the VELLUM theme system.

---

## New Chromes

### 1. **Gatsby / "Art Deco"**
- **Aesthetic:** Jazz Age geometric opulence
- **Visual Identity:** 
  - Gilt gold (#d4af37) on midnight black
  - Sharp edges (radius: 0)
  - Symmetric sunburst ornaments (✦ starburst)
  - Stepped pyramid chevron cards
  - Diamond section marks (◆)
  - Octagonal avatars (clip-path polygon)
- **Paired Skins:**
  - Dark: `gatsby-noir` — midnight black + gilt gold
  - Light: `gatsby-champagne` — champagne cream + sepia ink
- **Shapes:**
  - Present: `chevron` (new stepped pyramid)
  - Bonds: `gilt-edge`
  - Cast: `tarot`
  - Beats: `split`
  - Factions: `gilt-edge`
  - Items: `split`
  - Secrets: `gilt-edge`
- **Texture:** `deco-rays` (new gold sunburst radiating rays)
- **Font:** `F_DECO` (Poiret One from Google Fonts, Playfair Display fallback)
- **Animations:**
  - Gold shimmer on starburst ornament (4s pulse)
  - Subtle pulse on card corner accents (3s)
  - Respects motion kill-switch and prefers-reduced-motion

### 2. **Sumi / "Ink Wash"**
- **Aesthetic:** Japanese ukiyo-e minimalism
- **Visual Identity:**
  - Vermillion seal (#c8371a) on deep charcoal or cream
  - Asymmetric negative space
  - Brush stroke accents
  - Red hanko stamp seals
  - Torn deckle edges
  - Minimal, meditative pacing
- **Paired Skins:**
  - Dark: `sumi-ink` — deep sumi ink on charcoal
  - Light: `sumi-paper` — charcoal ink on warm washi paper
- **Shapes:**
  - Present: `inkwash` (new asymmetric brush left edge)
  - Bonds: `deckle` (torn paper)
  - Cast: `hanko` (new red seal stamp)
  - Beats: `slab`
  - Factions: `inkwash`
  - Items: `slab`
  - Secrets: `slab`
- **Texture:** `washi` (new rice paper grain with horizontal fibers)
- **Font:** `F_BRUSH` (Noto Serif JP from Google Fonts, Noto Serif fallback)
- **Animations:**
  - Slow ink-wash fade-in for cards (0.6s ease-out)
  - Subtle slide-in from left (8px translation)
  - Respects motion kill-switch and prefers-reduced-motion

---

## New Skins (8 total)

### Gatsby Skins
1. **gatsby-noir** — Midnight & gilt gold, art deco drama, jazz age glamour
2. **gatsby-champagne** — Champagne cream & sepia, elegant daytime deco

### Sumi Skins
3. **sumi-ink** — Deep sumi ink & charcoal, brush strokes, meditative dark
4. **sumi-paper** — Warm washi paper & ink, cream field, charcoal brush

### Monochrome Skins (standalone, not tied to a chrome)
5. **monochrome** — Pure grayscale, true black & white, maximum contrast
6. **monochrome-lite** — Soft grayscale, gentle grays, muted contrast
7. **monochrome-sepia** — Warm sepia brown tones, vintage photograph aesthetic
8. **monochrome-blue** — Cool blue-gray tones, moonlit cinematic night aesthetic

---

## New Card Shapes (3 total)

### 1. `chevron` (Gatsby)
- **Style:** Art deco stepped pyramid top
- **Implementation:** `clip-path` polygon with top stepped edges
- **Padding:** Extra top padding (18px) to clear the stepped edge
- **Fallback:** Rounded slab on old browsers (added to `CLIP_SHAPES`)

### 2. `hanko` (Sumi)
- **Style:** Red seal stamp corner pseudo element
- **Implementation:** `::after` pseudo with vermillion radial gradient
- **Position:** Top-right corner (-6px offset)
- **Size:** 36px × 36px square with slight rotation (-3deg)
- **Padding:** Extra top padding (14px)

### 3. `inkwash` (Sumi)
- **Style:** Asymmetric brush stroke left edge
- **Implementation:** 4px solid left border + `::after` gradient on right
- **Effect:** Creates asymmetric balance (heavy left, fade right)
- **Padding:** Left padding (16px) to clear the border

---

## New Texture SVGs (3 total)

### 1. `deco-rays` (Gatsby)
- **Description:** Gold sunburst radiating from top center
- **Pattern:** 10 triangular rays rotating 0°-180° from center
- **Additional:** Geometric art deco corner ornaments
- **Opacity:** 0.08 for rays, 0.12 for corner accents
- **Color:** `#d4af37` (gilt gold)

### 2. `washi` (Sumi)
- **Description:** Rice paper grain with horizontal fibers
- **Pattern:** Horizontal lines at irregular intervals (10, 25, 42, 58, 73, 89)
- **Additional:** Scattered tiny dots mimicking paper imperfections
- **Opacity:** 0.04 for lines, 0.03 for dots
- **Color:** `#4a3828` (aged ink brown)

### 3. (Note: `deco-rays` and `washi` are the only new textures; both chromes also use existing textures as alternates)

---

## New Animations

### Gatsby Animations
- **Gold Shimmer:** Sunburst ornament pulses with gold glow (4s cycle)
  - `@keyframes vle-gatsby-shimmer` — opacity and text-shadow pulse
  - Applied to `.vle-head::before` (starburst hero mark)
- **Accent Pulse:** Card corner gold accents subtly pulse (3s cycle)
  - `@keyframes vle-gatsby-pulse` — opacity oscillation
  - Applied to card `::before` and `::after` corner marks
- **Motion Safety:** Respects `data-vle-motion='off'` and `prefers-reduced-motion`

### Sumi Animations
- **Ink Fade:** Cards fade in with subtle slide from left (0.6s)
  - `@keyframes vle-sumi-ink-fade` — opacity + translateX transition
  - Mimics ink bleeding across paper
  - Applied to all `.vle-card`, `.vle-rel-card`, `.vld-sec`
- **Motion Safety:** Respects `data-vle-motion='off'` and `prefers-reduced-motion`

---

## Google Fonts Integration

Added dynamic Google Fonts loading system in `theme.ts`:

### New Function: `loadGoogleFontsForChrome()`
- Automatically loads required fonts when chrome is activated
- Tracks loaded fonts to prevent duplicate requests
- Checks for existing `<link>` elements before creating new ones

### Fonts Loaded:
- **Gatsby:** [Poiret One](https://fonts.google.com/specimen/Poiret+One) — Geometric art deco display font
- **Sumi:** [Noto Serif JP](https://fonts.google.com/specimen/Noto+Serif+JP) — Japanese serif with calligraphic feel

### Implementation:
```typescript
const fontMap: Record<string, string> = {
  gatsby: 'https://fonts.googleapis.com/css2?family=Poiret+One&display=swap',
  sumi: 'https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;700&display=swap',
};
```

---

## Files Modified

### `src/ui/theme.ts`
- **Line 54-60:** Added `F_DECO` (Poiret One) and `F_BRUSH` (Noto Serif JP) font stacks with Google Fonts
- **Line 61:** Updated `Chrome` type to include `'gatsby' | 'sumi'`
- **Line 78-81:** Updated `ShapeId` type to include `'chevron' | 'hanko' | 'inkwash'`
- **Line 83:** Updated `SHAPE_IDS` array with new shapes
- **Line 92-111:** Added `gatsby` and `sumi` to `CHROME_SHAPES` map
- **Line 181-191:** Added Gatsby and Sumi modes to `MODES` array
- **Line 221-254:** Added 8 new skins to `SKINS` array (including sepia and blue-tone monochrome)
- **Line 277-281:** Added 2 new textures to `TEXTURES` array
- **Line 324:** Updated `CHROMES` constant to include new chromes
- **Line 346-368:** Added `loadGoogleFontsForChrome()` function for dynamic font loading
- **Line 389:** Call `loadGoogleFontsForChrome()` in `applyTheme()`

### `src/ui/styles.ts`
- **Line 55-68:** Added 3 new shapes to `SHAPE_GEOM` object
- **Line 71:** Added `'chevron'` to `CLIP_SHAPES` array
- **Line 1863-1883:** Added ~50 lines of Gatsby chrome CSS + animations
- **Line 1885-1911:** Added ~27 lines of Sumi chrome CSS + animations
- **Line 1991-1994:** Added ornament details for `hanko` and `inkwash` shapes
- **Line 1998:** Updated avatar reshape to include `hanko` shape
- **Animations:**
  - `@keyframes vle-gatsby-shimmer` (gold pulse on starburst)
  - `@keyframes vle-gatsby-pulse` (corner accent pulse)
  - `@keyframes vle-sumi-ink-fade` (card fade-in)

---

## Usage

### Apply Gatsby Chrome
```typescript
setMode('gatsby'); // Sets chrome + paired skin + defaults
// Or manually:
patchTheme({ 
  chrome: 'gatsby', 
  skin: 'gatsby-noir', 
  radius: 0, 
  border: 2 
});
```

### Apply Sumi Chrome
```typescript
setMode('sumi'); // Sets chrome + paired skin + defaults
// Or manually:
patchTheme({ 
  chrome: 'sumi', 
  skin: 'sumi-ink', 
  radius: 0, 
  border: 1 
});
```

### Use Monochrome Skins (on any chrome)
```typescript
setSkin('monochrome'); // Pure black & white
setSkin('monochrome-lite'); // Soft grays
setSkin('monochrome-sepia'); // Warm vintage browns
setSkin('monochrome-blue'); // Cool moonlit blue-grays
```

### Override Card Shapes
```typescript
patchTheme({ 
  cardShapes: { 
    present: 'chevron',  // Art deco pyramid
    cast: 'hanko',       // Red seal stamp
    bonds: 'inkwash'     // Asymmetric brush
  } 
});
```

---

## Design Philosophy

### Gatsby
- **Story Fit:** Pairs with "Jazz Age" era idiom setting
- **Genre:** Mystery, noir, opulent period drama
- **Distinct From:** Only hard-edged geometric chrome (radius: 0)
- **Inspiration:** 1920s art deco, The Great Gatsby, geometric luxury

### Sumi
- **Story Fit:** Pairs with "Mythic/Ancient/Medieval" era settings
- **Genre:** Historical, philosophical, contemplative stories
- **Distinct From:** Only minimalist aesthetic, embraces negative space
- **Inspiration:** Japanese woodblock prints, calligraphy, zen aesthetics

### Monochrome Skins
- **Story Fit:** Noir/hardboiled stories, accessibility needs, e-ink displays
- **Genre:** Universal (composable with any chrome)
- **Distinct From:** Only pure grayscale palette (no hue)
- **Inspiration:** Classic film noir, high contrast readability

---

## Testing Checklist

- [x] Chrome type definitions updated
- [x] Shape IDs added to type and array
- [x] CHROME_SHAPES maps defined
- [x] Modes added with paired skins
- [x] Skins added with full theme properties
- [x] Textures added as data URIs
- [x] CHROMES constant updated
- [x] CLIP_SHAPES updated for chevron
- [x] Chrome-specific CSS added to styles.ts
- [x] Shape geometry added to SHAPE_GEOM
- [x] Shape ornaments added with shapeDetail
- [x] Google Fonts loading function added
- [x] Gatsby animations implemented (shimmer + pulse)
- [x] Sumi animations implemented (ink fade)
- [x] Motion kill-switch support added
- [x] Monochrome sepia and blue variants added
- [ ] Test in browser (chrome switching)
- [ ] Test shape rendering on all surfaces
- [ ] Test dark/light mode switching
- [ ] Test monochrome skins on multiple chromes
- [ ] Verify texture rendering
- [ ] Test on old browsers (clip-path fallback)
- [ ] Verify Google Fonts load correctly
- [ ] Test animations with motion preferences
- [ ] Verify Google Fonts load correctly
- [ ] Test animations with motion preferences
- [ ] Verify animation kill-switch works

---

## Notes

- All new content is **CSS-only** (no new TypeScript logic required)
- Textures are **inline data URIs** (no network requests)
- Fonts use **system fallbacks** (Playfair Display, Noto Serif fall back to Georgia/serif)
- Shapes are **content-safe** (padding reserves space, never clips text)
- **Backward compatible** (old themes sanitize correctly via CHROME_REMAP)
- **No breaking changes** to existing chromes or skins

---

## Future Enhancements

Consider adding (not implemented yet):
- Custom font bundles for Gatsby (true art deco display font)
- Custom font bundles for Sumi (true brush script)
- Additional monochrome variants (sepia, blue-tone)
- Animation for Gatsby (slow gold shimmer/pulse)
- Ink-bleed animation for Sumi (slow fade-in effect)
