/* Boot status — "Booting…" built from lattice cells beneath the loading ring.
   Same brightness path as the indicator: red Pixel FS LEDs, not a DOM overlay. */

import { clamp01, smoothstep } from './math.js';
import { BOOT_TIMING } from './constants.js';

const CELL_PX = 5;
const LABEL = 'Booting';
/* Full ellipsis cycle (0→1→2→3 dots). ~500ms per state — calm OS boot pace. */
const ELLIPSIS_PERIOD_MS = 2000;
const GLOW = 0.26;

/*
  Independent idle breaths — word and each dot float on their own clock.
  Amplitudes stay small so the line still reads as one status phrase.
*/
const WORD_BOB = Object.freeze({ periodMs: 1480, ampPx: 2.6, phase: 0 });
const DOT_BOB = Object.freeze([
  { periodMs: 1180, ampPx: 2.1, phase: 0.18 },
  { periodMs: 1320, ampPx: 2.5, phase: 0.47 },
  { periodMs: 1260, ampPx: 1.9, phase: 0.71 },
]);

/**
 * Pixel-rendered boot status under the calibration ring.
 * Word stays fixed; only trailing dots cycle. Word + each ellipsis LED
 * breathe on independent vertical phases (Pixel FS idle float language).
 */
export function createBootStatus() {
  let armed = false;
  let originMs = 0;
  let dissolveStartMs = 0;
  /* on | dissolve | off */
  let mode = 'off';
  let bakedCols = 0;
  let bakedRows = 0;

  /** @type {{ x: number, y: number, level: number }[]} */
  let labelCells = [];
  /** @type {{ x: number, y: number, level: number }[][]} */
  let dotGlyphs = [[], [], []];
  let anchorX = 0;
  let anchorY = 0;

  const prefersReduced =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function reset() {
    armed = false;
    originMs = 0;
    dissolveStartMs = 0;
    mode = 'off';
    bakedCols = 0;
    bakedRows = 0;
    labelCells = [];
    dotGlyphs = [[], [], []];
    anchorX = 0;
    anchorY = 0;
  }

  /**
   * @param {number} now
   */
  function start(now) {
    armed = true;
    mode = 'on';
    originMs = now;
    dissolveStartMs = 0;
  }

  /**
   * Fade out with the sealed ring dissolve.
   * @param {number} now
   */
  function beginDissolve(now) {
    if (!armed || mode === 'off') return;
    if (mode === 'dissolve') return;
    mode = 'dissolve';
    dissolveStartMs = now;
  }

  function dismiss() {
    armed = false;
    mode = 'off';
  }

  function isArmed() {
    return armed && mode !== 'off';
  }

  /**
   * Ring radius — must match indicator.js FACE_RADIUS / scale.
   * @param {number} cols
   * @param {number} rows
   */
  function indicatorRadius(cols, rows) {
    return Math.max(5, Math.min(cols, rows) * 0.09);
  }

  /**
   * Sample solid white glyphs from an offscreen canvas sized to the lattice.
   * @param {number} cols
   * @param {number} rows
   * @param {string} text
   * @param {number} fontPx
   * @param {number} cx
   * @param {number} cy
   * @param {'left'|'center'} align
   */
  function sampleGlyphs(cols, rows, text, fontPx, cx, cy, align) {
    const off = document.createElement('canvas');
    off.width = cols;
    off.height = rows;
    const octx = off.getContext('2d', { alpha: false });
    if (!octx) return [];

    octx.fillStyle = '#000';
    octx.fillRect(0, 0, cols, rows);
    octx.fillStyle = '#fff';
    octx.font = `600 ${fontPx}px "Josefin Sans", system-ui, sans-serif`;
    octx.textAlign = align;
    octx.textBaseline = 'middle';
    octx.fillText(text, cx, cy);

    /* Periods often fall below the LED threshold — stamp a solid pixel block. */
    if (text === '.') {
      const mx = Math.round(cx);
      const my = Math.round(cy + fontPx * 0.28);
      octx.fillRect(mx, my, Math.max(1, Math.round(fontPx * 0.18)), Math.max(1, Math.round(fontPx * 0.18)));
    }

    const data = octx.getImageData(0, 0, cols, rows).data;
    /** @type {{ x: number, y: number, level: number }[]} */
    const cells = [];
    for (let i = 0, n = cols * rows; i < n; i++) {
      const lum = data[i * 4];
      if (lum <= 140) continue;
      cells.push({
        x: i % cols,
        y: (i / cols) | 0,
        level: 0.42 + (lum / 255) * 0.58,
      });
    }
    return cells;
  }

  /**
   * Bounds of a glyph cell list.
   * @param {{ x: number, y: number }[]} cells
   */
  function boundsOf(cells) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c.x < minX) minX = c.x;
      if (c.x > maxX) maxX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.y > maxY) maxY = c.y;
    }
    if (!cells.length) {
      return { minX: 0, maxX: 0, minY: 0, maxY: 0, w: 0, h: 0 };
    }
    return {
      minX,
      maxX,
      minY,
      maxY,
      w: maxX - minX + 1,
      h: maxY - minY + 1,
    };
  }

  /**
   * Translate absolute glyph cells into local coords relative to (ox, oy).
   * @param {{ x: number, y: number, level: number }[]} cells
   * @param {number} ox
   * @param {number} oy
   */
  function toLocal(cells, ox, oy) {
    const out = [];
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      out.push({ x: c.x - ox, y: c.y - oy, level: c.level });
    }
    return out;
  }

  /**
   * Bake label + three dot glyphs for the current lattice size.
   * Layout reserves a fixed 3-dot slot so only the trailing dots animate.
   * @param {number} cols
   * @param {number} rows
   */
  function bake(cols, rows) {
    if (cols < 16 || rows < 12) {
      labelCells = [];
      dotGlyphs = [[], [], []];
      bakedCols = cols;
      bakedRows = rows;
      return;
    }

    const radius = indicatorRadius(cols, rows);
    const cx = (cols - 1) * 0.5;
    const cy = (rows - 1) * 0.5;

    /*
      Larger lattice type — more cells per glyph (not a scaled bitmap) so the
      word stays crisp and immediately readable under the ring.
    */
    let fontPx = Math.max(8, Math.round(Math.min(cols, rows) * 0.088));
    fontPx = Math.min(fontPx, Math.max(8, Math.round(rows * 0.095)));

    /* Probe widths in a temporary canvas */
    const probe = document.createElement('canvas').getContext('2d');
    if (!probe) return;
    probe.font = `600 ${fontPx}px "Josefin Sans", system-ui, sans-serif`;
    let labelW = probe.measureText(LABEL).width;
    let dotW = Math.max(probe.measureText('.').width, fontPx * 0.35);
    let gap = Math.max(1, Math.round(fontPx * 0.12));
    let ellipsisW = dotW * 3 + gap * 2;
    let totalW = labelW + gap + ellipsisW;

    /* Fit within the lattice; prefer shrinking type over clipping */
    const maxW = cols * 0.82;
    let guard = 0;
    while (totalW > maxW && fontPx > 7 && guard < 14) {
      fontPx -= 1;
      probe.font = `600 ${fontPx}px "Josefin Sans", system-ui, sans-serif`;
      labelW = probe.measureText(LABEL).width;
      dotW = Math.max(probe.measureText('.').width, fontPx * 0.35);
      gap = Math.max(1, Math.round(fontPx * 0.12));
      ellipsisW = dotW * 3 + gap * 2;
      totalW = labelW + gap + ellipsisW;
      guard += 1;
    }

    const textH = fontPx;
    /*
      Clear air under the ring: ring bottom + intentional gap + half the glyph.
      Farther than the old HTML overlay so ring and status never share space.
    */
    const ringBottom = cy + radius;
    const clearance = Math.max(8, Math.round(radius * 1.15 + rows * 0.02));
    let textCy = Math.round(ringBottom + clearance + textH * 0.5);
    const maxCy = rows - Math.ceil(textH * 0.65) - 1;
    if (textCy > maxCy) textCy = maxCy;
    /* If the stage is short, still keep at least a few rows under the ring. */
    const minCy = Math.round(ringBottom + Math.max(5, radius * 0.55) + textH * 0.4);
    if (textCy < minCy && minCy <= maxCy) textCy = minCy;

    const blockLeft = Math.round(cx - totalW * 0.5);
    const labelCx = blockLeft + labelW * 0.5;
    const dotsStart = blockLeft + labelW + gap;

    const labelAbs = sampleGlyphs(cols, rows, LABEL, fontPx, labelCx, textCy, 'center');
    if (!labelAbs.length) {
      labelCells = [];
      dotGlyphs = [[], [], []];
      bakedCols = cols;
      bakedRows = rows;
      return;
    }
    const labelBounds = boundsOf(labelAbs);
    anchorX = labelBounds.minX;
    anchorY = labelBounds.minY;
    labelCells = toLocal(labelAbs, anchorX, anchorY);

    /* Sample each dot at its reserved slot so spacing stays monospace-stable. */
    const nextDots = [];
    for (let d = 0; d < 3; d++) {
      const dx = dotsStart + d * (dotW + gap) + dotW * 0.5;
      const abs = sampleGlyphs(cols, rows, '.', fontPx, dx, textCy, 'center');
      nextDots.push(toLocal(abs, anchorX, anchorY));
    }
    dotGlyphs = nextDots;

    bakedCols = cols;
    bakedRows = rows;
  }

  /**
   * Soft cosine bob for one element. Phase is a 0..1 cycle offset.
   * @param {number} now
   * @param {{ periodMs: number, ampPx: number, phase: number }} motion
   */
  function bobShiftPx(now, motion) {
    if (prefersReduced || !armed || !motion) return 0;
    const period = Math.max(1, motion.periodMs);
    const u = ((now - originMs) / period + (motion.phase || 0)) % 1;
    /* Cosine ease — idle breath, never a hard bounce. */
    return -motion.ampPx * (0.5 - 0.5 * Math.cos(u * Math.PI * 2));
  }

  /**
   * Ellipsis step 0..3 — same cadence as the former CSS width steps.
   * @param {number} now
   */
  function ellipsisCount(now) {
    if (prefersReduced) return 3;
    const phase = ((now - originMs) % ELLIPSIS_PERIOD_MS) / ELLIPSIS_PERIOD_MS;
    if (phase < 0.25) return 0;
    if (phase < 0.5) return 1;
    if (phase < 0.75) return 2;
    return 3;
  }

  /**
   * Write a cell + soft glow into the brightness buffer, scattering by bob.
   * @param {Float32Array} brightness
   * @param {number} cols
   * @param {number} rows
   * @param {number} px
   * @param {number} py
   * @param {number} level
   * @param {number} shiftPx
   */
  function writeBobbed(brightness, cols, rows, px, py, level, shiftPx) {
    if (level <= 0.001) return;
    const dest = py + shiftPx / CELL_PX;
    const yFloor = Math.floor(dest);
    const f = dest - yFloor;
    const y1 = yFloor + 1;

    writeCell(brightness, cols, rows, px, yFloor, level * (1 - f));
    if (f > 1e-5) {
      writeCell(brightness, cols, rows, px, y1, level * f);
    }
  }

  function writeCell(brightness, cols, rows, px, py, level) {
    if (px < 0 || py < 0 || px >= cols || py >= rows || level <= 0.001) return;
    const i = py * cols + px;
    if (level > brightness[i]) brightness[i] = level;
    const glow = level * GLOW;
    if (glow > 0.02) {
      if (px > 0 && glow > brightness[i - 1]) brightness[i - 1] = glow;
      if (px < cols - 1 && glow > brightness[i + 1]) brightness[i + 1] = glow;
      if (py > 0 && glow > brightness[i - cols]) brightness[i - cols] = glow;
      if (py < rows - 1 && glow > brightness[i + cols]) brightness[i + cols] = glow;
    }
  }

  /**
   * @param {{ x: number, y: number, level: number }[]} cells
   * @param {Float32Array} brightness
   * @param {number} cols
   * @param {number} rows
   * @param {number} shiftPx
   * @param {number} alpha
   */
  function paintCells(cells, brightness, cols, rows, shiftPx, alpha) {
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const level = c.level * alpha;
      writeBobbed(
        brightness,
        cols,
        rows,
        anchorX + c.x,
        anchorY + c.y,
        level,
        shiftPx
      );
    }
  }

  /**
   * Composite status into the shared boot brightness buffer.
   * @param {ReturnType<import('./boot-field.js').createBootField>} field
   * @param {number} now
   * @param {number} [alpha]
   */
  function paint(field, now, alpha) {
    const brightness = field && field.brightness;
    if (!brightness || !armed || mode === 'off') return;

    const cols = field.cols;
    const rows = field.rows;
    if (cols < 16 || rows < 12) return;

    if (cols !== bakedCols || rows !== bakedRows || !labelCells.length) {
      bake(cols, rows);
    }
    if (!labelCells.length) return;

    let a = alpha == null ? 1 : clamp01(alpha);
    if (mode === 'dissolve') {
      const u = clamp01((now - dissolveStartMs) / BOOT_TIMING.RING_DISSOLVE_MS);
      a *= 1 - smoothstep(u);
      if (a <= 0.001) {
        armed = false;
        mode = 'off';
        return;
      }
    }
    if (a <= 0.001) return;

    const dots = ellipsisCount(now);

    paintCells(labelCells, brightness, cols, rows, bobShiftPx(now, WORD_BOB), a);
    for (let d = 0; d < dots; d++) {
      paintCells(
        dotGlyphs[d] || [],
        brightness,
        cols,
        rows,
        bobShiftPx(now, DOT_BOB[d]),
        a
      );
    }
  }

  return {
    reset,
    start,
    beginDissolve,
    dismiss,
    isArmed,
    paint,
  };
}
