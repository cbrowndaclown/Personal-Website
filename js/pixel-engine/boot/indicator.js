/* Center boot indicator — thin pixel arc that rotates in place.
   Built entirely from lattice cells (no vector curves). */

import { bootEnergyDurationMs, BOOT_TIMING } from './constants.js';
import { clamp01, smoothstep } from './math.js';

/**
 * Stationary calibration ring: a short glowing red chain of pixels
 * chasing its own tail around the grid center.
 */
export function createBootIndicator() {
  let originMs = 0;
  let energyMs = 0;
  let revolutions = BOOT_TIMING.INDICATOR_REVOLUTIONS;
  let fadeStartMs = 0;
  let fading = false;
  let opacity = 1;
  let armed = false;

  function reset() {
    originMs = 0;
    energyMs = 0;
    revolutions = BOOT_TIMING.INDICATOR_REVOLUTIONS;
    fadeStartMs = 0;
    fading = false;
    opacity = 1;
    armed = false;
  }

  /**
   * Arm the indicator at the start of the energy boot window.
   * @param {number} now
   */
  function start(now) {
    originMs = now;
    energyMs = bootEnergyDurationMs();
    revolutions = BOOT_TIMING.INDICATOR_REVOLUTIONS;
    fadeStartMs = 0;
    fading = false;
    opacity = 1;
    armed = true;
  }

  /**
   * Begin the closing fade once the final white sweep completes.
   * @param {number} now
   */
  function beginFade(now) {
    if (!armed || fading) return;
    fading = true;
    fadeStartMs = now;
  }

  function isFading() {
    return fading;
  }

  function isDone(now) {
    if (!armed) return true;
    if (!fading) return false;
    return now - fadeStartMs >= BOOT_TIMING.INDICATOR_FADE_MS;
  }

  /**
   * Rotation angle (radians). Completes exactly `revolutions` turns
   * at the end of the energy-sweep window.
   * @param {number} now
   */
  function angleAt(now) {
    if (!armed || energyMs <= 0) return 0;
    const u = clamp01((now - originMs) / energyMs);
    return u * revolutions * Math.PI * 2;
  }

  function opacityAt(now) {
    if (!armed) return 0;
    if (!fading) return opacity;
    const fadeU = clamp01((now - fadeStartMs) / BOOT_TIMING.INDICATOR_FADE_MS);
    /* Ease out — linger briefly, then dissolve */
    opacity = 1 - smoothstep(fadeU);
    return opacity;
  }

  /**
   * Write the arc into the brightness buffer (additive over a cleared field).
   * @param {ReturnType<import('./boot-field.js').createBootField>} field
   * @param {number} now
   */
  function paint(field, now) {
    const brightness = field && field.brightness;
    if (!brightness || !armed) return;

    const cols = field.cols;
    const rows = field.rows;
    if (cols < 8 || rows < 8) return;

    const alpha = opacityAt(now);
    if (alpha <= 0.001) return;

    const angle = angleAt(now);
    const cx = (cols - 1) * 0.5;
    const cy = (rows - 1) * 0.5;
    /* Restrained radius — reads as a device, not a loader */
    const radius = Math.max(5, Math.min(cols, rows) * 0.09);
    /* Partial circle — short chain chasing its tail */
    const arcSpan = Math.PI * 0.72;
    const steps = Math.max(10, Math.round(radius * arcSpan * 1.15));

    for (let s = 0; s < steps; s++) {
      const frac = s / Math.max(1, steps - 1);
      /* Head at `angle`, trail trailing behind */
      const a = angle - frac * arcSpan;
      const px = Math.round(cx + Math.cos(a) * radius);
      const py = Math.round(cy + Math.sin(a) * radius);
      if (px < 0 || py < 0 || px >= cols || py >= rows) continue;

      const i = py * cols + px;
      /* Head brighter; tail softens — thin single-cell chain */
      const head = 1 - frac * 0.78;
      const level = alpha * (0.42 + head * 0.58);

      if (level > brightness[i]) brightness[i] = level;

      /* Whisper of neighbor glow — still pixel language, no soft circle */
      const glow = level * 0.28;
      if (glow > 0.02) {
        if (px > 0 && glow > brightness[i - 1]) brightness[i - 1] = glow;
        if (px < cols - 1 && glow > brightness[i + 1]) brightness[i + 1] = glow;
        if (py > 0 && glow > brightness[i - cols]) brightness[i - cols] = glow;
        if (py < rows - 1 && glow > brightness[i + cols]) brightness[i + cols] = glow;
      }
    }
  }

  return {
    reset,
    start,
    beginFade,
    isFading,
    isDone,
    paint,
    angleAt,
    opacityAt,
  };
}
