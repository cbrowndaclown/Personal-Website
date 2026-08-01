/* Center boot indicator — thin pixel arc that rotates in place.
   On the final revolution the leading edge extends forward until the
   open gap seals into a complete ring (trailing edge never reverses),
   holds briefly, then dissolves. Built entirely from lattice cells. */

import { bootEnergyDurationMs, BOOT_TIMING } from './constants.js';
import { clamp01, smoothstep } from './math.js';

const TWO_PI = Math.PI * 2;
const ARC_SPAN = Math.PI * 0.72;
const FACE_RADIUS = 5;

/**
 * Stationary calibration ring: a short glowing red chain of pixels
 * chasing its own tail, then sealing into a full ring and fading out.
 */
export function createBootIndicator() {
  let originMs = 0;
  let energyMs = 0;
  let revolutions = BOOT_TIMING.INDICATOR_REVOLUTIONS;
  let omega = 0; /* rad / ms — constant through spin + close */
  let opacity = 1;
  let armed = false;

  /* spin | closing | circle_hold | dissolve | off */
  let mode = 'off';
  let closeStartAngle = 0;
  let closeTargetAngle = 0;
  let circleHoldStartMs = 0;
  let dissolveStartMs = 0;

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
    closeStartAngle = 0;
    closeTargetAngle = 0;
    circleHoldStartMs = 0;
    dissolveStartMs = 0;
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
    closeStartAngle = 0;
    closeTargetAngle = 0;
    circleCells = [];
  }

  /**
   * Base spin angle — always advances forward at constant omega.
   * @param {number} now
   */
  function spinAngleAt(now) {
    if (!armed || omega <= 0) return 0;
    return (now - originMs) * omega;
  }

  /**
   * Leading-edge (head) angle for painting.
   * During close the head extends forward so the gap seals without
   * ever pulling the trailing edge backward.
   * @param {number} now
   */
  function angleAt(now) {
    if (!armed || omega <= 0) return 0;
    if (mode === 'spin') return spinAngleAt(now);
    if (mode === 'closing') {
      const spin = Math.min(spinAngleAt(now), closeTargetAngle);
      return spin - ARC_SPAN + spanAt(now);
    }
    /* Sealed: head sits one full span past the locked tail. */
    return closeTargetAngle - ARC_SPAN + TWO_PI;
  }

  /**
   * Begin the final closing revolution. Rotation continues forward at the
   * same rate for a full 360°. Span grows linearly with that forward travel
   * so the open gap seals without reversing or snapping.
   * Begin the final closing revolution. Always takes one full forward
   * turn from the current angle. The trailing edge keeps rotating at
   * omega; the leading edge extends forward until the gap seals.
   * @param {number} now
   */
  function beginClose(now) {
    if (
      !armed ||
      mode === 'closing' ||
      mode === 'circle_hold' ||
      mode === 'dissolve' ||
      mode === 'off'
    ) {
      return;
    }
    const a = angleAt(now);
    /* Always a full forward revolution — never the short backward path */
    let target = Math.floor(a / TWO_PI) * TWO_PI + TWO_PI;
    if (target <= a + 0.02) target += TWO_PI;
    const a = spinAngleAt(now);
    closeStartAngle = a;
    closeTargetAngle = a + TWO_PI;
    mode = 'closing';
  }

  function isClosing() {
    return mode === 'closing';
  }

  function closeProgress(now) {
    if (mode === 'circle_hold' || mode === 'dissolve' || mode === 'off') return 1;
    if (mode !== 'closing') return 0;
    const travel = closeTargetAngle - closeStartAngle;
    if (travel <= 1e-6) return 1;
    return clamp01((Math.min(spinAngleAt(now), closeTargetAngle) - closeStartAngle) / travel);
  }

  function isClosed(now) {
    if (!armed) return true;
    if (mode === 'off' || mode === 'circle_hold' || mode === 'dissolve') return true;
    if (mode !== 'closing') return false;
    return spinAngleAt(now) >= closeTargetAngle - 1e-4;
  }

  /**
   * Arc span — grows from chase-tail to a sealed ring during the close.
   * Linear with forward head travel so the trailing tip never reverses
   * (eased span growth outran omega and drove the gap the wrong way).
   * Growth is applied at the leading edge only (see angleAt).
   * @param {number} now
   */
  function spanAt(now) {
    if (mode === 'closing') {
      const u = closeProgress(now);
      return ARC_SPAN + (TWO_PI - ARC_SPAN) * u;
    }
    if (mode === 'circle_hold' || mode === 'dissolve') return TWO_PI;
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
   * Settle the sealed ring for a brief recognition beat.
   * @param {number} now
   * @param {ReturnType<import('./boot-field.js').createBootField>} [field]
   */
  function beginCircleHold(now, field) {
    if (!armed) return;
    if (mode === 'circle_hold' || mode === 'dissolve' || mode === 'off') return;
    if (field && field.cols && field.rows) {
      circleCells = buildCircleCells(field.cols, field.rows);
    }
    mode = 'circle_hold';
    circleHoldStartMs = now;
    opacity = 1;
  }

  function isCircleHoldDone(now) {
    if (mode === 'dissolve' || mode === 'off') return true;
    if (mode !== 'circle_hold') return false;
    return now - circleHoldStartMs >= BOOT_TIMING.CIRCLE_HOLD_MS;
  }

  /**
   * Fade the completed ring out of the lattice.
   * @param {number} now
   */
  function beginDissolve(now) {
    if (!armed) return;
    if (mode === 'dissolve' || mode === 'off') return;
    mode = 'dissolve';
    dissolveStartMs = now;
  }

  function isDissolveDone(now) {
    if (mode === 'off') return true;
    if (mode !== 'dissolve') return false;
    return now - dissolveStartMs >= BOOT_TIMING.RING_DISSOLVE_MS;
  }

  function dismiss() {
    if (!armed) return;
    mode = 'off';
    opacity = 0;
  }

  function getMode() {
    return mode;
  }

  /**
   * Write arc / ring into the brightness buffer.
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

    if (mode === 'circle_hold') {
      paintCircleSolid(brightness, cols, rows, 1);
      return;
    }

    if (mode === 'dissolve') {
      const u = clamp01((now - dissolveStartMs) / BOOT_TIMING.RING_DISSOLVE_MS);
      const alpha = 1 - smoothstep(u);
      if (alpha <= 0.001) {
        mode = 'off';
        opacity = 0;
        return;
      }
      paintCircleSolid(brightness, cols, rows, alpha);
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
    beginCircleHold,
    isCircleHoldDone,
    beginDissolve,
    isDissolveDone,
    dismiss,
    getMode,
    paint,
    angleAt,
  };
}
