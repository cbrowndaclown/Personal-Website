/* Shared left→right energy wipe used by boot stages. */

import { clamp01, smootherstep, easeInOutCubic } from './math.js';

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
 * Snap every cell to an exact energy level (end-of-stage lock).
 * @param {ReturnType<import('./boot-field.js').createBootField>} field
 * @param {number} energy
 */
export function lockEnergy(field, energy) {
  if (field && field.presence) field.presence.fill(energy);
}
