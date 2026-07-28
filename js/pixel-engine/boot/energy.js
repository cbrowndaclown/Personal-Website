/* Shared left→right energy wipe used by boot stages. */

import { clamp01, smootherstep, easeInOutCubic, hash01 } from './math.js';

/**
 * Apply a soft left-to-right energy transition across the entire grid.
 * Every cell lerps from `fromEnergy` toward `toEnergy` as the front passes.
 *
 * @param {ReturnType<import('./boot-field.js').createBootField>} field
 * @param {number} fromEnergy
 * @param {number} toEnergy
 * @param {number} u — 0..1 stage progress
 * @param {number} feather — soft edge width as fraction of grid width
 */
export function applyEnergySweep(field, fromEnergy, toEnergy, u, feather) {
  const presence = field.presence;
  if (!presence) return;

  const cols = field.cols;
  const rows = field.rows;
  if (cols < 1 || rows < 1) return;

  const edge = Math.max(0.04, feather || 0.14);
  const progress = easeInOutCubic(clamp01(u));
  /* Front travels from just left of the grid to just past the right edge */
  const front = -edge + progress * (1 + 2 * edge);
  const denom = Math.max(1, cols - 1);

  for (let i = 0; i < presence.length; i++) {
    const x = i % cols;
    const xn = x / denom;
    const t = smootherstep(clamp01((front - xn) / edge));
    presence[i] = fromEnergy + (toEnergy - fromEnergy) * t;
  }
}

/**
 * Procedural left→right reveal: each cell flips individually with hashed
 * local order so the wake reads organic (like glyph construction) instead
 * of a soft feathered slab advancing in uniform columns.
 *
 * @param {ReturnType<import('./boot-field.js').createBootField>} field
 * @param {number} fromEnergy
 * @param {number} toEnergy
 * @param {number} u — 0..1 stage progress
 * @param {{ scatter?: number, soft?: number, seed?: number }} [opts]
 */
export function applyOrganicEnergyReveal(field, fromEnergy, toEnergy, u, opts) {
  const presence = field.presence;
  if (!presence) return;

  const cols = field.cols;
  const rows = field.rows;
  if (cols < 1 || rows < 1) return;

  const scatter = opts && opts.scatter != null ? opts.scatter : 0.28;
  const soft = Math.max(0.012, opts && opts.soft != null ? opts.soft : 0.03);
  const seed = (opts && opts.seed) || 0x51a7;
  /* Near-linear front so late columns keep initializing through the end */
  const progress = clamp01(u);
  /* Modest overshoot — just enough for trailing jittered cells to settle by u=1 */
  const pad = scatter * 0.35 + soft;
  const front = -pad + progress * (1 + 2 * pad);
  const xDenom = Math.max(1, cols - 1);
  const yDenom = Math.max(1, rows - 1);

  for (let i = 0; i < presence.length; i++) {
    const x = i % cols;
    const y = (i / cols) | 0;
    const xn = x / xDenom;
    const yn = y / yDenom;

    const h1 = hash01(i, seed);
    const h2 = hash01(i, seed ^ 0x9e3779b9);
    const h3 = hash01(i, seed + 0x85ebca6b);

    /*
      Primary drive is column position; per-cell hash + light y ripple break
      rows/columns without flipping overall left→right progression.
    */
    const yRipple = (yn - 0.5) * 0.06 * (0.4 + h2);
    const local =
      (h1 - 0.5) * scatter +
      (h2 - 0.5) * scatter * 0.42 +
      Math.sin(y * 1.73 + h3 * 6.1) * 0.018 +
      yRipple;
    const order = clamp01(xn + local);

    const raw = clamp01((front - order) / soft);
    /* Sharp pop — cells switch individually once their order is reached */
    const pop = raw <= 0 ? 0 : raw >= 1 ? 1 : smootherstep(raw);
    presence[i] = fromEnergy + (toEnergy - fromEnergy) * pop;
  }
}

/**
 * Snap every cell to an exact energy level (end-of-stage lock).
 * @param {ReturnType<import('./boot-field.js').createBootField>} field
 * @param {number} energy
 */
export function lockEnergy(field, energy) {
  if (field && field.presence) field.presence.fill(energy);
}
