/* Pixel font — hand-built 5×7 LED glyphs for small Pixel FS type.

   Small text rasterized from Josefin Sans smears into blobs once its strokes
   are thinner than one LED cell ("Clears screen" → "Clean scmm"). Below
   PIXEL_FONT_MAX_PX the offscreen raster canvas draws these glyphs instead:
   one-cell strokes snapped to the lattice, so every letter keeps its shape
   with far fewer lit pixels.

   Metrics (in LED cells): cap height 7 (rows 0–6), x-height 5 (rows 2–6),
   descenders 2 (rows 7–8). Glyphs are variable width with one blank column
   of tracking. Characters without a glyph fall back to the native font.

   Larger type uses the same glyphs drawn as scaled line art: each glyph
   point lands s cells apart and neighbouring points are joined with thin
   strokes (diagonal steps become clean diagonals, so bowls round off).
   Stems are two cells wide and horizontals one cell tall — bold enough to
   read solid, while counters open up, so "e", "o" and "a" never
   clog the way thick outlines do on a coarse LED grid. */

/** Font sizes (grid px) at or below this use the unscaled 5×7 glyphs. */
export const PIXEL_FONT_MAX_PX = 13;

/** Native font size whose letters read about as large as the 5×7 glyphs —
    companion marks (directory arrows) size against this instead. */
export const PIXEL_FONT_VISUAL_PX = 9;

/**
 * Size that marks drawn beside text should match.
 * @param {number} fontPx
 */
export function visualFontPx(fontPx) {
  if (!(fontPx > 0)) return fontPx;
  const s = glyphScale(fontPx);
  if (s === 1) return PIXEL_FONT_VISUAL_PX;
  return Math.round((capCells(s) * PIXEL_FONT_VISUAL_PX) / CAP_H);
}

const CAP_H = 7;
const TRACKING = 1;
const SPACE_W = 3;

/** Native cap height ≈ this × font px (Josefin Sans, as the LEDs read it). */
const NATIVE_CAP_RATIO = 0.78;

/**
 * Glyph point spacing in cells for a font size: 1 for small type, else the
 * scale whose cap height best matches the native font at that size.
 * @param {number} fontPx
 */
function glyphScale(fontPx) {
  if (fontPx <= PIXEL_FONT_MAX_PX) return 1;
  return Math.max(2, Math.round((fontPx * NATIVE_CAP_RATIO - 1) / (CAP_H - 1)));
}

/** Stroke height in cells — thin, thickening only at very large sizes. */
function strokeOf(s) {
  return s >= 4 ? Math.floor(s / 2) : 1;
}

/** Stroke width in cells — one wider than its height (pixel-font bold), so
    stems read solid while horizontal strokes stay thin and counters open. */
function strokeWOf(s) {
  return strokeOf(s) + 1;
}

/** Blank cells between letters, and the extra advance of a space, at scale s. */
function letterGapOf(s) {
  return s;
}
function spaceOf(s) {
  return 2 * s;
}

/** Cap height in cells at scale s. */
function capCells(s) {
  return s === 1 ? CAP_H : (CAP_H - 1) * s + strokeOf(s);
}

/* Rows top → bottom; '#' lit. Rows past 6 are descenders. */
const GLYPHS = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],

  a: ['.....', '.....', '.###.', '....#', '.####', '#...#', '.####'],
  b: ['#....', '#....', '####.', '#...#', '#...#', '#...#', '####.'],
  c: ['....', '....', '.###', '#...', '#...', '#...', '.###'],
  d: ['....#', '....#', '.####', '#...#', '#...#', '#...#', '.####'],
  e: ['.....', '.....', '.###.', '#...#', '#####', '#....', '.###.'],
  f: ['..##', '.#..', '###.', '.#..', '.#..', '.#..', '.#..'],
  g: ['.....', '.....', '.####', '#...#', '#...#', '#...#', '.####', '....#', '.###.'],
  h: ['#....', '#....', '#.##.', '##..#', '#...#', '#...#', '#...#'],
  i: ['#', '.', '#', '#', '#', '#', '#'],
  j: ['..#', '...', '..#', '..#', '..#', '..#', '..#', '#.#', '.#.'],
  k: ['#...', '#...', '#..#', '#.#.', '##..', '#.#.', '#..#'],
  l: ['#.', '#.', '#.', '#.', '#.', '#.', '.#'],
  m: ['.....', '.....', '##.#.', '#.#.#', '#.#.#', '#.#.#', '#.#.#'],
  n: ['.....', '.....', '#.##.', '##..#', '#...#', '#...#', '#...#'],
  o: ['.....', '.....', '.###.', '#...#', '#...#', '#...#', '.###.'],
  p: ['.....', '.....', '####.', '#...#', '#...#', '#...#', '####.', '#....', '#....'],
  q: ['.....', '.....', '.####', '#...#', '#...#', '#...#', '.####', '....#', '....#'],
  r: ['....', '....', '#.##', '##..', '#...', '#...', '#...'],
  s: ['....', '....', '.###', '#...', '.##.', '...#', '###.'],
  t: ['.#..', '.#..', '####', '.#..', '.#..', '.#..', '..##'],
  u: ['.....', '.....', '#...#', '#...#', '#...#', '#..##', '.##.#'],
  v: ['.....', '.....', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  w: ['.....', '.....', '#...#', '#...#', '#.#.#', '#.#.#', '.#.#.'],
  x: ['.....', '.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  y: ['.....', '.....', '#...#', '#...#', '#...#', '#...#', '.####', '....#', '.###.'],
  z: ['.....', '.....', '#####', '...#.', '..#..', '.#...', '#####'],

  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['.#.', '##.', '.#.', '.#.', '.#.', '.#.', '###'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],

  '.': ['.', '.', '.', '.', '.', '.', '#'],
  ',': ['..', '..', '..', '..', '..', '.#', '.#', '#.'],
  '!': ['#', '#', '#', '#', '#', '.', '#'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  "'": ['#', '#'],
  '"': ['#.#', '#.#'],
  '-': ['...', '...', '...', '###'],
  '_': ['....', '....', '....', '....', '....', '....', '####'],
  ':': ['.', '.', '#', '.', '.', '#', '.'],
  ';': ['..', '..', '.#', '..', '..', '.#', '.#', '#.'],
  '/': ['....#', '...#.', '...#.', '..#..', '.#...', '.#...', '#....'],
  '\\': ['#....', '.#...', '.#...', '..#..', '...#.', '...#.', '....#'],
  '|': ['#', '#', '#', '#', '#', '#', '#'],
  '(': ['..#', '.#.', '#..', '#..', '#..', '.#.', '..#'],
  ')': ['#..', '.#.', '..#', '..#', '..#', '.#.', '#..'],
  '[': ['###', '#..', '#..', '#..', '#..', '#..', '###'],
  ']': ['###', '..#', '..#', '..#', '..#', '..#', '###'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..'],
  '=': ['....', '....', '####', '....', '####'],
  '*': ['.....', '..#..', '#.#.#', '.###.', '#.#.#', '..#..'],
  '<': ['...#', '..#.', '.#..', '#...', '.#..', '..#.', '...#'],
  '>': ['#...', '.#..', '..#.', '...#', '..#.', '.#..', '#...'],
  '&': ['.##..', '#..#.', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'],
  '@': ['.###.', '#...#', '#.###', '#.#.#', '#.###', '#....', '.####'],
  '#': ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.'],
  '%': ['##..#', '##..#', '...#.', '..#..', '.#...', '#..##', '#..##'],
  $: ['..#..', '.####', '#.#..', '.###.', '..#.#', '####.', '..#..'],
  '^': ['..#..', '.#.#.', '#...#'],
  '~': ['.....', '.....', '.....', '.#..#', '#.##.'],
};

/** @param {string} font  CanvasRenderingContext2D.font */
function fontPxOf(font) {
  const m = /(\d+(?:\.\d+)?)px/.exec(font || '');
  return m ? Number(m[1]) : 0;
}

/**
 * True when text at this canvas font should use the pixel font.
 * @param {string} font
 */
export function usesPixelFont(font) {
  return fontPxOf(font) > 0;
}

function glyphWidth(glyph) {
  let w = 0;
  for (let r = 0; r < glyph.length; r++) {
    if (glyph[r].length > w) w = glyph[r].length;
  }
  return w;
}

/**
 * Per-character advance in cells (glyph + tracking).
 * @param {string} ch
 * @param {(t: string) => TextMetrics} nativeMeasure
 */
function advanceOf(ch, nativeMeasure, s) {
  if (s === 1) {
    if (ch === ' ') return SPACE_W + TRACKING;
    const glyph = GLYPHS[ch];
    if (glyph) return glyphWidth(glyph) + TRACKING;
    return Math.max(1, Math.round(nativeMeasure(ch).width)) + TRACKING;
  }
  /* Scaled type — ink width + a tight gap, so words stay compact */
  if (ch === ' ') return spaceOf(s);
  const glyph = GLYPHS[ch];
  if (glyph) return (glyphWidth(glyph) - 1) * s + strokeWOf(s) + letterGapOf(s);
  return Math.max(1, Math.round(nativeMeasure(ch).width)) + letterGapOf(s);
}

/** @type {Map<string, Int16Array>} scaled glyph cells, keyed by scale + char */
const scaledCache = new Map();

/**
 * Lit cells (x, y pairs, relative to the glyph's top-left) for a glyph drawn
 * as line art at point spacing s. Orthogonal neighbours join with straight
 * strokes; diagonal neighbours join with a diagonal only when no orthogonal
 * path already links them, so corners round off instead of thickening.
 * @param {string} ch
 * @param {string[]} glyph
 * @param {number} s
 */
function scaledCells(ch, glyph, s) {
  const key = s + ':' + ch;
  const hit = scaledCache.get(key);
  if (hit) return hit;
  const lit = (c, r) =>
    r >= 0 && r < glyph.length && c >= 0 && glyph[r].charCodeAt(c) === 35;
  const seen = new Set();
  const pts = [];
  const plot = (x, y) => {
    const k = x * 4096 + y;
    if (seen.has(k)) return;
    seen.add(k);
    pts.push(x, y);
  };
  for (let r = 0; r < glyph.length; r++) {
    for (let c = 0; c < glyph[r].length; c++) {
      if (!lit(c, r)) continue;
      plot(c * s, r * s);
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) {
        if (!lit(c + dx, r + dy)) continue;
        if (dx !== 0 && dy !== 0 && (lit(c + dx, r) || lit(c, r + dy))) continue;
        for (let k = 1; k < s; k++) plot(c * s + k * dx, r * s + k * dy);
      }
    }
  }
  const out = Int16Array.from(pts);
  scaledCache.set(key, out);
  return out;
}

/**
 * Patch one raster context so small-font fillText / measureText use the
 * pixel font. Callers keep setting `font`, `textAlign` and `textBaseline`
 * exactly as before; sizes above PIXEL_FONT_MAX_PX pass straight through.
 * The context's transform must map one unit to one LED cell.
 * @param {CanvasRenderingContext2D} ctx
 */
export function installPixelFont(ctx) {
  const nativeFill = ctx.fillText.bind(ctx);
  const nativeMeasure = ctx.measureText.bind(ctx);

  function textWidth(text, s) {
    let w = 0;
    for (const ch of text) w += advanceOf(ch, nativeMeasure, s);
    return w;
  }

  ctx.measureText = function (text) {
    if (!usesPixelFont(ctx.font)) return nativeMeasure(text);
    return { width: textWidth(String(text), glyphScale(fontPxOf(ctx.font))) };
  };

  ctx.fillText = function (text, x, y, maxWidth) {
    if (!usesPixelFont(ctx.font)) {
      return maxWidth != null
        ? nativeFill(text, x, y, maxWidth)
        : nativeFill(text, x, y);
    }
    const str = String(text);
    const s = glyphScale(fontPxOf(ctx.font));
    const stroke = strokeOf(s);
    const strokeW = strokeWOf(s);
    const capH = capCells(s);
    const width = textWidth(str, s);
    let left = x;
    if (ctx.textAlign === 'center') left = x - width * 0.5;
    else if (ctx.textAlign === 'right' || ctx.textAlign === 'end') left = x - width;

    let top;
    switch (ctx.textBaseline) {
      case 'top':
      case 'hanging':
        top = y;
        break;
      case 'bottom':
      case 'ideographic':
        top = y - (capH + 2 * s);
        break;
      case 'alphabetic':
        top = y - capH;
        break;
      default: /* middle — centre the cap height on y */
        top = y - capH * 0.5;
    }
    /* Snap to whole cells so one-cell strokes never straddle two LEDs. */
    let cx = Math.round(left);
    const cy = Math.round(top);

    for (const ch of str) {
      const glyph = GLYPHS[ch];
      if (glyph && s > 1) {
        const cells = scaledCells(ch, glyph, s);
        for (let k = 0; k < cells.length; k += 2) {
          ctx.fillRect(cx + cells[k], cy + cells[k + 1], strokeW, stroke);
        }
      } else if (glyph) {
        for (let r = 0; r < glyph.length; r++) {
          const row = glyph[r];
          for (let c = 0; c < row.length; c++) {
            if (row.charCodeAt(c) === 35 /* # */) ctx.fillRect(cx + c, cy + r, 1, 1);
          }
        }
      } else if (ch !== ' ') {
        /* No pixel glyph — draw this one character with the native font. */
        const align = ctx.textAlign;
        ctx.textAlign = 'left';
        nativeFill(ch, cx, y);
        ctx.textAlign = align;
      }
      cx += advanceOf(ch, nativeMeasure, s);
    }
  };
}
