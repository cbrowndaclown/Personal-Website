/* Center boot indicator — thin pixel arc that rotates in place,
   then closes cleanly and reorganizes into a minimal LED smile.
   Built entirely from lattice cells (no vector curves / SVG / emoji). */

import { bootEnergyDurationMs, BOOT_TIMING } from './constants.js';
import { clamp01, smoothstep, easeOutCubic, easeInOutCubic } from './math.js';

const TWO_PI = Math.PI * 2;

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

  /* spin | closing | smile | hold | dissolve | off */
  let mode = 'off';
  let closeTargetAngle = 0;
  let smileStartMs = 0;
  let holdStartMs = 0;
  let dissolveStartMs = 0;

  /** @type {{ x: number, y: number, level: number }[]} */
  let morphFrom = [];
  /** @type {{ x: number, y: number, level: number }[]} */
  let morphTo = [];
  /** @type {{ x: number, y: number }[]} */
  let smileCells = [];

  function reset() {
    originMs = 0;
    energyMs = 0;
    revolutions = BOOT_TIMING.INDICATOR_REVOLUTIONS;
    omega = 0;
    opacity = 1;
    armed = false;
    mode = 'off';
    closeTargetAngle = 0;
    smileStartMs = 0;
    holdStartMs = 0;
    dissolveStartMs = 0;
    morphFrom = [];
    morphTo = [];
    smileCells = [];
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
    if (!armed || mode === 'closing' || mode === 'smile' || mode === 'hold') {
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
    if (mode === 'smile' || mode === 'hold' || mode === 'dissolve') return true;
    if (mode !== 'closing') return false;
    return (now - originMs) * omega >= closeTargetAngle - 1e-4;
  }

  function snapClosed(now) {
    if (mode === 'closing' && isClosed(now)) {
      closeTargetAngle = Math.round(closeTargetAngle / TWO_PI) * TWO_PI;
    }
  }

  /**
   * Minimal LED-matrix smile offsets (cell units from center).
   * Eyes + shallow smile — restrained, not cartoonish.
   */
  function smileOffsets() {
    return [
      { x: -3, y: -2, level: 1 },
      { x: 3, y: -2, level: 1 },
      { x: -4, y: 1, level: 0.82 },
      { x: -3, y: 2, level: 0.92 },
      { x: -2, y: 3, level: 1 },
      { x: -1, y: 3, level: 1 },
      { x: 0, y: 3, level: 1 },
      { x: 1, y: 3, level: 1 },
      { x: 2, y: 3, level: 1 },
      { x: 3, y: 2, level: 0.92 },
      { x: 4, y: 1, level: 0.82 },
    ];
  }

  /**
   * Sample the current arc into discrete pixel particles.
   * @param {number} cols
   * @param {number} rows
   * @param {number} now
   */
  function sampleArcParticles(cols, rows, now) {
    const angle = angleAt(now);
    const cx = (cols - 1) * 0.5;
    const cy = (rows - 1) * 0.5;
    const radius = Math.max(5, Math.min(cols, rows) * 0.09);
    const arcSpan = Math.PI * 0.72;
    const steps = Math.max(10, Math.round(radius * arcSpan * 1.15));
    const out = [];
    const seen = new Set();

    for (let s = 0; s < steps; s++) {
      const frac = s / Math.max(1, steps - 1);
      const a = angle - frac * arcSpan;
      const px = Math.round(cx + Math.cos(a) * radius);
      const py = Math.round(cy + Math.sin(a) * radius);
      if (px < 0 || py < 0 || px >= cols || py >= rows) continue;
      const key = py * cols + px;
      if (seen.has(key)) continue;
      seen.add(key);
      const head = 1 - frac * 0.78;
      out.push({
        x: px,
        y: py,
        level: 0.42 + head * 0.58,
      });
    }
    return out;
  }

  /**
   * Start morphing the closed arc into the LED smile.
   * @param {number} now
   * @param {ReturnType<import('./boot-field.js').createBootField>} field
   */
  function beginSmile(now, field) {
    if (!armed || !field) return;
    snapClosed(now);
    const cols = field.cols;
    const rows = field.rows;
    if (cols < 8 || rows < 8) return;

    const cx = Math.round((cols - 1) * 0.5);
    const cy = Math.round((rows - 1) * 0.5);
    const offsets = smileOffsets();

    smileCells = [];
    morphTo = [];
    for (let i = 0; i < offsets.length; i++) {
      const o = offsets[i];
      const x = cx + o.x;
      const y = cy + o.y;
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      smileCells.push({ x, y });
      morphTo.push({ x, y, level: o.level });
    }

    morphFrom = sampleArcParticles(cols, rows, now);
    if (!morphFrom.length && morphTo.length) {
      /* Fallback — seed from smile itself so morph still reads */
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
    return smileCells.slice();
  }

  function getMode() {
    return mode;
  }

  /**
   * Write arc / smile into the brightness buffer (additive over a cleared field).
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
      paintArc(brightness, cols, rows, now, 1);
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

  function paintArc(brightness, cols, rows, now, alpha) {
    const angle = angleAt(now);
    const cx = (cols - 1) * 0.5;
    const cy = (rows - 1) * 0.5;
    const radius = Math.max(5, Math.min(cols, rows) * 0.09);
    const arcSpan = Math.PI * 0.72;
    const steps = Math.max(10, Math.round(radius * arcSpan * 1.15));

    for (let s = 0; s < steps; s++) {
      const frac = s / Math.max(1, steps - 1);
      const a = angle - frac * arcSpan;
      const px = Math.round(cx + Math.cos(a) * radius);
      const py = Math.round(cy + Math.sin(a) * radius);
      if (px < 0 || py < 0 || px >= cols || py >= rows) continue;

      const i = py * cols + px;
      const head = 1 - frac * 0.78;
      const level = alpha * (0.42 + head * 0.58);

      if (level > brightness[i]) brightness[i] = level;

      const glow = level * 0.28;
      if (glow > 0.02) {
        if (px > 0 && glow > brightness[i - 1]) brightness[i - 1] = glow;
        if (px < cols - 1 && glow > brightness[i + 1]) brightness[i + 1] = glow;
        if (py > 0 && glow > brightness[i - cols]) brightness[i - cols] = glow;
        if (py < rows - 1 && glow > brightness[i + cols]) brightness[i + cols] = glow;
      }
    }
  }

  function paintMorph(brightness, cols, rows, now) {
    const u = smileMorphProgress(now);
    /* Ease the arc slowdown — particles settle into the smile */
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

    /* Eyes resolve slightly ahead of the smile curve */
    if (u > 0.35) {
      const eyeGain = smoothstep((u - 0.35) / 0.35);
      paintSmileSubset(brightness, cols, rows, eyeGain, true);
    }
    if (u > 0.55) {
      const mouthGain = smoothstep((u - 0.55) / 0.45);
      paintSmileSubset(brightness, cols, rows, mouthGain, false);
    }
  }

  function paintSmileSubset(brightness, cols, rows, alpha, eyesOnly) {
    for (let i = 0; i < smileCells.length; i++) {
      const isEye = i < 2;
      if (eyesOnly ? !isEye : isEye) continue;
      const cell = smileCells[i];
      const level = alpha * (isEye ? 1 : 0.9);
      writeCell(brightness, cols, rows, cell.x, cell.y, level);
    }
  }

  function paintSmileSolid(brightness, cols, rows, alpha) {
    for (let i = 0; i < smileCells.length; i++) {
      const cell = smileCells[i];
      const isEye = i < 2;
      writeCell(brightness, cols, rows, cell.x, cell.y, alpha * (isEye ? 1 : 0.92));
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
