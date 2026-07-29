/* Pixel Grid Teardown — center-out collapse that retires a live lattice.
   Reverse of density sync / generation: the front begins near the display
   center and expands outward, deactivating cells procedurally. */

import { BOOT_ENERGY } from './constants.js';
import { lockEnergy } from './energy.js';
import { applyOrganicRadialReveal } from './organic-radial.js';

/** Timing + energy for density teardown (ops, not first boot). */
export const TEARDOWN = Object.freeze({
  /** Nominal front duration — lingering cells may settle slightly after. */
  DURATION_MS: 1480,
  /** Fully lit resting lattice. */
  FROM_ENERGY: BOOT_ENERGY.WHITE,
  /** Fully retired — gray backlit panel shows through. */
  TO_ENERGY: BOOT_ENERGY.BLACK,
  /** Sticky settle tolerance. */
  EPS: 0.0015,
  /** Presence at/above which cursor forces may still affect the cell. */
  INTERACT_PRESENCE: 0.55,
  /** Organic irregularity of the collapse front. */
  SCATTER: 0.36,
  /** Soft edge of the teardown front (order-space). */
  SOFT: 0.028,
});

/**
 * Center-out sticky deactivation. Cells only fall toward inactive; already-
 * retired cells are never rewritten. Progress may exceed 1 until every cell
 * settles.
 *
 * @param {ReturnType<import('./boot-field.js').createBootField>} field
 * @param {number} fromEnergy
 * @param {number} toEnergy
 * @param {number} u — progress (may exceed 1 until settled)
 * @param {{ scatter?: number, soft?: number, seed?: number }} [opts]
 * @returns {boolean} true when every cell has reached toEnergy
 */
export function applyOrganicTeardown(field, fromEnergy, toEnergy, u, opts) {
  return applyOrganicRadialReveal(field, fromEnergy, toEnergy, u, {
    scatter: opts && opts.scatter != null ? opts.scatter : TEARDOWN.SCATTER,
    soft: opts && opts.soft != null ? opts.soft : TEARDOWN.SOFT,
    seed: (opts && opts.seed) || 0xd04e,
    energize: 0,
    eps: TEARDOWN.EPS,
    breatheRate: 6.4,
    breatheAmp: 0.5,
    frontierWobble: 0.1,
    extraLag: 0.18,
  });
}

/**
 * Snap lattice fully inactive and clear accents / motion.
 * Final teardown frame — gray backlit panel only.
 * @param {ReturnType<import('./boot-field.js').createBootField>} field
 */
export function finishTeardownLattice(field) {
  lockEnergy(field, TEARDOWN.TO_ENERGY);
  if (field && field.brightness) field.brightness.fill(0);
  if (field && typeof field.clearMotion === 'function') field.clearMotion();
}
