/* Center boot indicator — thin pixel arc that rotates in place,
   closes cleanly, expands into a full circle, then reorganizes into
   a readable LED-matrix smiley (ring + eyes + curved mouth).
   Built entirely from lattice cells (no vector curves / SVG / emoji). */

import { bootEnergyDurationMs, BOOT_TIMING } from './constants.js';
import { clamp01, smoothstep, easeOutCubic, easeInOutCubic } from './math.js';

const TWO_PI = Math.PI * 2;
const ARC_SPAN = Math.PI * 0.72;
const FACE_RADIUS = 5;

/**
 * Stationary calibration ring: a short glowing red chain of pixels
 * chasing its own tail around the grid center, then a self-test smile.
 */
export function createBootIndicator() {
  let originMs = 0;
  let energyMs = 0;
  let revolutions = BOOT_TIMING.INDICATOR_REVOLUTIONS;
  let omega = 0; /* rad / ms — constant through spin + close */
  let opacity = 1;
  let armed = false;

  /* spin | closing | completing | circle_hold | smile | hold | dissolve | off */
  let mode = 'off';
  let closeTargetAngle = 0;
  let completeStartMs = 0;
  let circleHoldStartMs = 0;
  let smileStartMs = 0;
  let holdStartMs = 0;
  let dissolveStartMs = 0;

  /** @type {{ x: number, y: number, level: number }[]} */
  let morphFrom = [];
  /** @type {{ x: number, y: number, level: number }[]} */
  let morphTo = [];
  /** @type {{ x: number, y: number, part: string }[]} */
  let smileCells = [];
  /** @type {{ x: number, y: number, level: number }[]} */
  let circleCells = [];

  function reset() {
    originMs = 0;
    energyMs = 0;
    revolutions = BOOT_TIMING.INDICATOR_REVOLUTIONS;
    omega = 0;
    opacity = 1;
    armed = false;
    mode = 'off';
    closeTargetAngle = 0;
    completeStartMs = 0;
    circleHoldStartMs = 0;
    smileStartMs = 0;
    holdStartMs = 0;
    dissolveStartMs = 0;
    morphFrom = [];
    morphTo = [];
    smileCells = [];
    circleCells = [];
  }

  /**
   * Arm the indicator at the start of the energy boot window.
   * @param {number} now
   */
  function start(now) {
    originMs = now;
    energyMs = bootEnergyDurationMs();
    revolutions = BOOT_TIMING.INDICATOR_REVOLUTIONS;
    omega = energyMs > 0 ? (revolutions * TWO_PI) / energyMs : 0;
    opacity = 1;
    armed = true;
    mode = 'spin';
    closeTargetAngle = 0;
    morphFrom = [];
    morphTo = [];
    smileCells = [];
    circleCells = [];
  }

  /**
   * Continuous rotation angle. Never clamps during spin —
   * during close it advances until the target boundary, then holds.
   * @param {number} now
   */
  function angleAt(now) {
    if (!armed || omega <= 0) return 0;
    if (mode === 'spin') {
      return (now - originMs) * omega;
    }
    if (mode === 'closing') {
      const a = (now - originMs) * omega;
      return Math.min(a, closeTargetAngle);
    }
    return closeTargetAngle;
  }

  /**
   * Begin the final closing revolution. Rotation is not interrupted —
   * the arc continues at the same rate until it lands on a clean 2π boundary.
   * @param {number} now
   */
  function beginClose(now) {
    if (
      !armed ||
      mode === 'closing' ||
      mode === 'completing' ||
      mode === 'circle_hold' ||
      mode === 'smile' ||
      mode === 'hold'
    ) {
      return;
    }
    const a = angleAt(now);
    /* One full revolution past the last completed turn */
    let target = Math.floor(a / TWO_PI) * TWO_PI + TWO_PI;
    if (target <= a + 0.02) target += TWO_PI;
    closeTargetAngle = target;
    mode = 'closing';
  }

  function isClosing() {
    return mode === 'closing';
  }

  function isClosed(now) {
    if (!armed) return true;
    if (
      mode === 'completing' ||
      mode === 'circle_hold' ||
      mode === 'smile' ||
      mode === 'hold' ||
      mode === 'dissolve'
    ) {
      return true;
    }
    if (mode !== 'closing') return false;
    return (now - originMs) * omega >= closeTargetAngle - 1e-4;
  }

  function snapClosed(now) {
    if (mode === 'closing' && isClosed(now)) {
      closeTargetAngle = Math.round(closeTargetAngle / TWO_PI) * TWO_PI;
    }
  }

  /**
   * Arc span for the current mode — grows from a chase-tail to a full ring.
   * @param {number} now
   */
  function spanAt(now) {
    if (mode === 'completing') {
      const u = easeInOutCubic(
        clamp01((now - completeStartMs) / BOOT_TIMING.CIRCLE_COMPLETE_MS)
      );
      return ARC_SPAN + (TWO_PI - ARC_SPAN) * u;
    }
    if (
      mode === 'circle_hold' ||
      mode === 'smile' ||
      mode === 'hold' ||
      mode === 'dissolve'
    ) {
      return TWO_PI;
    }
    return ARC_SPAN;
  }

  function indicatorRadius(cols, rows) {
    return Math.max(FACE_RADIUS, Math.min(cols, rows) * 0.09);
  }

  /**
   * Build discrete ring cell list at the indicator radius.
   * @param {number} cols
   * @param {number} rows
   */
  function buildCircleCells(cols, rows) {
    const cx = Math.round((cols - 1) * 0.5);
    const cy = Math.round((rows - 1) * 0.5);
    const radius = indicatorRadius(cols, rows);
    const steps = Math.max(28, Math.round(radius * TWO_PI * 1.35));
    const out = [];
    const seen = new Set();

    for (let s = 0; s < steps; s++) {
      const a = (s / steps) * TWO_PI - Math.PI / 2;
      const px = Math.round(cx + Math.cos(a) * radius);
      const py = Math.round(cy + Math.sin(a) * radius);
      if (px < 0 || py < 0 || px >= cols || py >= rows) continue;
      const key = py * cols + px;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ x: px, y: py, level: 0.92 });
    }
    return out;
  }

  /**
   * Readable pixel-art face: complete ring + eyes + curved mouth.
   * Offsets are in cell units from grid center; ring matches indicator radius.
   * @param {number} radius
   */
  function faceOffsets(radius) {
    const R = Math.max(FACE_RADIUS, Math.round(radius));
    const cells = [];
    const seen = new Set();

    function add(x, y, level, part) {
      const key = x + ',' + y;
      if (seen.has(key)) return;
      seen.add(key);
      cells.push({ x, y, level, part });
    }

    /* Complete circular outline — same radius as the closing ring */
    const ringSteps = Math.max(28, Math.round(R * TWO_PI * 1.4));
    for (let s = 0; s < ringSteps; s++) {
      const a = (s / ringSteps) * TWO_PI - Math.PI / 2;
      add(Math.round(Math.cos(a) * R), Math.round(Math.sin(a) * R), 0.94, 'ring');
    }

    /* Eyes — upper half, inset from the ring */
    const eyeX = Math.max(2, Math.round(R * 0.4));
    const eyeY = -Math.max(2, Math.round(R * 0.35));
    add(-eyeX, eyeY, 1, 'eye');
    add(eyeX, eyeY, 1, 'eye');

    /* Curved smile / mouth in the lower half */
    const mouthY = Math.max(1, Math.round(R * 0.35));
    const mouthSpread = Math.max(3, Math.round(R * 0.55));
    for (let x = -mouthSpread; x <= mouthSpread; x++) {
      const t = x / mouthSpread;
      const y = mouthY + Math.round((1 - t * t) * Math.max(1, Math.round(R * 0.2)));
      const edge = Math.abs(t) > 0.85;
      add(x, edge ? mouthY : y, edge ? 0.86 : 1, 'mouth');
    }

    return cells;
  }

  /**
   * Sample the current arc / ring into discrete pixel particles.
   * @param {number} cols
   * @param {number} rows
   * @param {number} now
   * @param {number} [spanOverride]
   */
  function sampleArcParticles(cols, rows, now, spanOverride) {
    const angle = angleAt(now);
    const cx = (cols - 1) * 0.5;
    const cy = (rows - 1) * 0.5;
    const radius = indicatorRadius(cols, rows);
    const arcSpan = spanOverride != null ? spanOverride : spanAt(now);
    const full = arcSpan >= TWO_PI - 0.05;
    const steps = Math.max(
      full ? 28 : 10,
      Math.round(radius * arcSpan * (full ? 1.35 : 1.15))
    );
    const out = [];
    const seen = new Set();

    for (let s = 0; s < steps; s++) {
      const frac = s / Math.max(1, steps - 1);
      const a = full
        ? angle - frac * TWO_PI
        : angle - frac * arcSpan;
      const px = Math.round(cx + Math.cos(a) * radius);
      const py = Math.round(cy + Math.sin(a) * radius);
      if (px < 0 || py < 0 || px >= cols || py >= rows) continue;
      const key = py * cols + px;
      if (seen.has(key)) continue;
      seen.add(key);
      const head = full ? 0.88 : 1 - frac * 0.78;
      out.push({
        x: px,
        y: py,
        level: full ? 0.9 : 0.42 + head * 0.58,
      });
    }
    return out;
  }

  /**
   * Expand the closed chase-tail into a complete circular outline.
   * @param {number} now
   * @param {ReturnType<import('./boot-field.js').createBootField>} field
   */
  function beginComplete(now, field) {
    if (!armed || !field) return;
    if (
      mode === 'completing' ||
      mode === 'circle_hold' ||
      mode === 'smile' ||
      mode === 'hold' ||
      mode === 'dissolve'
    ) {
      return;
    }
    snapClosed(now);
    if (mode === 'closing' || mode === 'spin') {
      /* Snap to closed boundary so completion expands in place */
      closeTargetAngle =
        Math.round(angleAt(now) / TWO_PI) * TWO_PI || closeTargetAngle;
    }
    circleCells = buildCircleCells(field.cols, field.rows);
    mode = 'completing';
    completeStartMs = now;
    opacity = 1;
  }

  function isCircleComplete(now) {
    if (
      mode === 'circle_hold' ||
      mode === 'smile' ||
      mode === 'hold' ||
      mode === 'dissolve'
    ) {
      return true;
    }
    if (mode !== 'completing') return false;
    return now - completeStartMs >= BOOT_TIMING.CIRCLE_COMPLETE_MS;
  }

  function beginCircleHold(now) {
    if (mode !== 'completing' && mode !== 'circle_hold') return;
    mode = 'circle_hold';
    circleHoldStartMs = now;
  }

  function isCircleHoldDone(now) {
    if (mode === 'smile' || mode === 'hold' || mode === 'dissolve') return true;
    if (mode !== 'circle_hold') return false;
    return now - circleHoldStartMs >= BOOT_TIMING.CIRCLE_HOLD_MS;
  }

  /**
   * Start morphing the completed circle into the LED smiley face.
   * @param {number} now
   * @param {ReturnType<import('./boot-field.js').createBootField>} field
   */
  function beginSmile(now, field) {
    if (!armed || !field) return;
    if (mode === 'smile' || mode === 'hold' || mode === 'dissolve') return;

    const cols = field.cols;
    const rows = field.rows;
    if (cols < 8 || rows < 8) return;

    const cx = Math.round((cols - 1) * 0.5);
    const cy = Math.round((rows - 1) * 0.5);
    const radius = indicatorRadius(cols, rows);
    const offsets = faceOffsets(radius);

    smileCells = [];
    morphTo = [];
    for (let i = 0; i < offsets.length; i++) {
      const o = offsets[i];
      const x = cx + o.x;
      const y = cy + o.y;
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      smileCells.push({ x, y, part: o.part });
      morphTo.push({ x, y, level: o.level });
    }

    /* Prefer the settled full-circle cells as morph sources */
    morphFrom =
      circleCells.length > 0
        ? circleCells.map(function (p) {
            return { x: p.x, y: p.y, level: p.level };
          })
        : sampleArcParticles(cols, rows, now, TWO_PI);

    if (!morphFrom.length && morphTo.length) {
      morphFrom = morphTo.map(function (p) {
        return { x: p.x, y: p.y, level: p.level * 0.55 };
      });
    }

    /* Pair each source particle to a smile target (cycle if counts differ) */
    const pairedTo = [];
    const nTo = morphTo.length;
    for (let i = 0; i < morphFrom.length; i++) {
      if (!nTo) break;
      pairedTo.push(morphTo[i % nTo]);
    }
    morphTo = pairedTo;

    /* Ensure every smile cell has at least one incoming particle */
    for (let t = 0; t < smileCells.length; t++) {
      const cell = smileCells[t];
      let covered = false;
      for (let i = 0; i < morphTo.length; i++) {
        if (morphTo[i].x === cell.x && morphTo[i].y === cell.y) {
          covered = true;
          break;
        }
      }
      if (!covered) {
        const src = morphFrom[t % Math.max(1, morphFrom.length)] || {
          x: cx,
          y: cy,
          level: 0.7,
        };
        morphFrom.push({ x: src.x, y: src.y, level: src.level });
        morphTo.push({
          x: cell.x,
          y: cell.y,
          level: offsets[Math.min(t, offsets.length - 1)].level,
        });
      }
    }

    mode = 'smile';
    smileStartMs = now;
    opacity = 1;
  }

  function smileMorphProgress(now) {
    if (mode !== 'smile') return mode === 'hold' || mode === 'dissolve' ? 1 : 0;
    return easeInOutCubic(
      clamp01((now - smileStartMs) / BOOT_TIMING.SMILE_MORPH_MS)
    );
  }

  function isSmileReady(now) {
    if (mode === 'hold' || mode === 'dissolve') return true;
    if (mode !== 'smile') return false;
    return now - smileStartMs >= BOOT_TIMING.SMILE_MORPH_MS;
  }

  function beginHold(now) {
    if (mode !== 'smile' && mode !== 'hold') return;
    mode = 'hold';
    holdStartMs = now;
  }

  function isHoldDone(now) {
    if (mode !== 'hold') return mode === 'dissolve' || mode === 'off';
    return now - holdStartMs >= BOOT_TIMING.SMILE_HOLD_MS;
  }

  function beginDissolve(now) {
    if (!armed) return;
    if (mode === 'dissolve') return;
    mode = 'dissolve';
    dissolveStartMs = now;
  }

  function isDissolveDone(now) {
    if (mode !== 'dissolve') return mode === 'off';
    return now - dissolveStartMs >= BOOT_TIMING.SMILE_DISSOLVE_MS;
  }

  function getSmileCells() {
    return smileCells.map(function (c) {
      return { x: c.x, y: c.y };
    });
  }

  function getMode() {
    return mode;
  }

  /**
   * Write arc / circle / smile into the brightness buffer.
   * @param {ReturnType<import('./boot-field.js').createBootField>} field
   * @param {number} now
   */
  function paint(field, now) {
    const brightness = field && field.brightness;
    if (!brightness || !armed || mode === 'off') return;

    const cols = field.cols;
    const rows = field.rows;
    if (cols < 8 || rows < 8) return;

    if (mode === 'spin' || mode === 'closing') {
      paintArc(brightness, cols, rows, now, 1, spanAt(now));
      return;
    }

    if (mode === 'completing') {
      paintArc(brightness, cols, rows, now, 1, spanAt(now));
      return;
    }

    if (mode === 'circle_hold') {
      paintCircleSolid(brightness, cols, rows, 1);
      return;
    }

    if (mode === 'smile') {
      paintMorph(brightness, cols, rows, now);
      return;
    }

    if (mode === 'hold') {
      paintSmileSolid(brightness, cols, rows, 1);
      return;
    }

    if (mode === 'dissolve') {
      const u = clamp01((now - dissolveStartMs) / BOOT_TIMING.SMILE_DISSOLVE_MS);
      const alpha = 1 - smoothstep(u);
      if (alpha <= 0.001) return;
      paintSmileSolid(brightness, cols, rows, alpha);
    }
  }

  function paintArc(brightness, cols, rows, now, alpha, span) {
    const angle = angleAt(now);
    const cx = (cols - 1) * 0.5;
    const cy = (rows - 1) * 0.5;
    const radius = indicatorRadius(cols, rows);
    const arcSpan = span != null ? span : ARC_SPAN;
    const full = arcSpan >= TWO_PI - 0.05;
    const steps = Math.max(
      full ? 28 : 10,
      Math.round(radius * arcSpan * (full ? 1.35 : 1.15))
    );

    for (let s = 0; s < steps; s++) {
      const frac = s / Math.max(1, steps - 1);
      const a = full ? angle - frac * TWO_PI : angle - frac * arcSpan;
      const px = Math.round(cx + Math.cos(a) * radius);
      const py = Math.round(cy + Math.sin(a) * radius);
      if (px < 0 || py < 0 || px >= cols || py >= rows) continue;

      const i = py * cols + px;
      const head = full ? 0.92 : 1 - frac * 0.78;
      const level = alpha * (full ? 0.9 : 0.42 + head * 0.58);

      if (level > brightness[i]) brightness[i] = level;

      const glow = level * (full ? 0.22 : 0.28);
      if (glow > 0.02) {
        if (px > 0 && glow > brightness[i - 1]) brightness[i - 1] = glow;
        if (px < cols - 1 && glow > brightness[i + 1]) brightness[i + 1] = glow;
        if (py > 0 && glow > brightness[i - cols]) brightness[i - cols] = glow;
        if (py < rows - 1 && glow > brightness[i + cols]) brightness[i + cols] = glow;
      }
    }
  }

  function paintCircleSolid(brightness, cols, rows, alpha) {
    const cells =
      circleCells.length > 0
        ? circleCells
        : buildCircleCells(cols, rows);
    if (!circleCells.length) circleCells = cells;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      writeCell(brightness, cols, rows, cell.x, cell.y, alpha * (cell.level || 0.92));
    }
  }

  function paintMorph(brightness, cols, rows, now) {
    const u = smileMorphProgress(now);
    const settle = easeOutCubic(u);
    const n = Math.min(morphFrom.length, morphTo.length);

    for (let i = 0; i < n; i++) {
      const a = morphFrom[i];
      const b = morphTo[i];
      const x = Math.round(a.x + (b.x - a.x) * settle);
      const y = Math.round(a.y + (b.y - a.y) * settle);
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      const level = (a.level + (b.level - a.level) * settle) * (0.85 + settle * 0.15);
      const idx = y * cols + x;
      if (level > brightness[idx]) brightness[idx] = level;

      const glow = level * (0.18 + settle * 0.12);
      if (glow > 0.02) {
        if (x > 0 && glow > brightness[idx - 1]) brightness[idx - 1] = glow;
        if (x < cols - 1 && glow > brightness[idx + 1]) brightness[idx + 1] = glow;
        if (y > 0 && glow > brightness[idx - cols]) brightness[idx - cols] = glow;
        if (y < rows - 1 && glow > brightness[idx + cols]) brightness[idx + cols] = glow;
      }
    }

    /* Ring settles first, then eyes, then mouth — reads as a face forming */
    if (u > 0.2) {
      const ringGain = smoothstep((u - 0.2) / 0.35);
      paintSmileSubset(brightness, cols, rows, ringGain, 'ring');
    }
    if (u > 0.4) {
      const eyeGain = smoothstep((u - 0.4) / 0.3);
      paintSmileSubset(brightness, cols, rows, eyeGain, 'eye');
    }
    if (u > 0.55) {
      const mouthGain = smoothstep((u - 0.55) / 0.4);
      paintSmileSubset(brightness, cols, rows, mouthGain, 'mouth');
    }
  }

  function paintSmileSubset(brightness, cols, rows, alpha, part) {
    for (let i = 0; i < smileCells.length; i++) {
      const cell = smileCells[i];
      if (cell.part !== part) continue;
      const level =
        alpha * (part === 'eye' ? 1 : part === 'mouth' ? 0.92 : 0.94);
      writeCell(brightness, cols, rows, cell.x, cell.y, level);
    }
  }

  function paintSmileSolid(brightness, cols, rows, alpha) {
    for (let i = 0; i < smileCells.length; i++) {
      const cell = smileCells[i];
      const part = cell.part || 'ring';
      const level =
        alpha * (part === 'eye' ? 1 : part === 'mouth' ? 0.92 : 0.94);
      writeCell(brightness, cols, rows, cell.x, cell.y, level);
    }
  }

  function writeCell(brightness, cols, rows, px, py, level) {
    if (px < 0 || py < 0 || px >= cols || py >= rows || level <= 0.001) return;
    const i = py * cols + px;
    if (level > brightness[i]) brightness[i] = level;
    const glow = level * 0.26;
    if (glow > 0.02) {
      if (px > 0 && glow > brightness[i - 1]) brightness[i - 1] = glow;
      if (px < cols - 1 && glow > brightness[i + 1]) brightness[i + 1] = glow;
      if (py > 0 && glow > brightness[i - cols]) brightness[i - cols] = glow;
      if (py < rows - 1 && glow > brightness[i + cols]) brightness[i + cols] = glow;
    }
  }

  return {
    reset,
    start,
    beginClose,
    isClosing,
    isClosed,
    beginComplete,
    isCircleComplete,
    beginCircleHold,
    isCircleHoldDone,
    beginSmile,
    isSmileReady,
    beginHold,
    isHoldDone,
    beginDissolve,
    isDissolveDone,
    getSmileCells,
    getMode,
    paint,
    angleAt,
  };
}
