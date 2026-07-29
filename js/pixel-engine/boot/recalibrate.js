/* Pixel Grid Recalibration — center-out sync that brings a rebuilt lattice online.
   After Pixel Density changes, every cell starts inactive (presence 0) over the
   already-powered gray backlit panel. The sync wave is the activation mechanism:
   cells only join Pixel FS as the front reaches them. Presence 0 means “not yet
   claimed,” not a black cold-boot clear — styles keep painting FIELD gray beneath.
   Related to boot energy reveals, but radial / network-like rather than L→R. */

import { BOOT_ENERGY } from './constants.js';
import { lockEnergy } from './energy.js';
import {
  cellRadialOrder,
  applyOrganicRadialReveal,
} from './organic-radial.js';

/** Timing + energy for density recalibration / generation (ops, not first boot). */
export const RECALIBRATION = Object.freeze({
  /** Nominal front duration — trailing cells may settle slightly after. */
  DURATION_MS: 1680,
  /** Inactive / dormant — hidden until the sync wave claims the cell.
   *  Visual layer stays the gray panel (not a black startup clear). */
  FROM_ENERGY: BOOT_ENERGY.BLACK,
  /** Fully synchronized resting state. */
  TO_ENERGY: BOOT_ENERGY.WHITE,
  /** Peak brightness when a cell first activates. */
  ENERGIZE: 0.42,
  /** Brightness decay after energize (ms). */
  ENERGIZE_DECAY_MS: 380,
  /** Sticky settle tolerance. */
  EPS: 0.0015,
  /** Presence at/above which cursor forces may affect the cell. */
  INTERACT_PRESENCE: 0.72,
  /** Organic irregularity of the sync front. */
  SCATTER: 0.34,
  /** Soft edge of the sync front (order-space) — boot-like stickiness. */
  SOFT: 0.026,
});

/** @deprecated Prefer cellRadialOrder from organic-radial.js */
export const cellSyncOrder = cellRadialOrder;

/**
 * Center-out sticky activation. Cells only advance from inactive → synced;
 * already-synced cells are never rewritten. Progress may exceed 1 until every
 * cell settles (same contract as boot organic reveals).
 *
 * @param {ReturnType<import('./boot-field.js').createBootField>} field
 * @param {number} fromEnergy
 * @param {number} toEnergy
 * @param {number} u — progress (may exceed 1 until settled)
 * @param {{ scatter?: number, soft?: number, seed?: number, energize?: number }} [opts]
 * @returns {boolean} true when every cell has reached toEnergy
 */
export function applyOrganicSyncReveal(field, fromEnergy, toEnergy, u, opts) {
  return applyOrganicRadialReveal(field, fromEnergy, toEnergy, u, {
    scatter: opts && opts.scatter != null ? opts.scatter : RECALIBRATION.SCATTER,
    soft: opts && opts.soft != null ? opts.soft : RECALIBRATION.SOFT,
    seed: (opts && opts.seed) || 0xc41b,
    energize:
      opts && opts.energize != null ? opts.energize : RECALIBRATION.ENERGIZE,
    eps: RECALIBRATION.EPS,
    breatheRate: 7.1,
    breatheAmp: 0.55,
    frontierWobble: 0.08,
  });
}

/**
 * Ease recalibration brightness spikes back to 0 after activation.
 * @param {ReturnType<import('./boot-field.js').createBootField>} field
 * @param {number} dtMs
 * @param {number} [decayMs]
 */
export function decaySyncEnergize(field, dtMs, decayMs) {
  const brightness = field && field.brightness;
  if (!brightness || !(dtMs > 0)) return;
  const tau = Math.max(
    60,
    decayMs != null ? decayMs : RECALIBRATION.ENERGIZE_DECAY_MS,
  );
  const keep = Math.exp(-dtMs / tau);
  for (let i = 0; i < brightness.length; i++) {
    const b = brightness[i];
    if (b <= 0.0008) {
      brightness[i] = 0;
      continue;
    }
    brightness[i] = b * keep;
  }
}

/**
 * Force every cell inactive before the sync wave (presence = 0).
 * @param {ReturnType<import('./boot-field.js').createBootField>} field
 */
export function beginInactiveLattice(field) {
  lockEnergy(field, RECALIBRATION.FROM_ENERGY);
  if (field && field.brightness) field.brightness.fill(0);
  if (field && typeof field.clearMotion === 'function') field.clearMotion();
}

/**
 * Snap lattice to fully synchronized rest.
 * @param {ReturnType<import('./boot-field.js').createBootField>} field
 */
export function finishSyncLattice(field) {
  lockEnergy(field, RECALIBRATION.TO_ENERGY);
  if (field && field.brightness) field.brightness.fill(0);
  if (field && typeof field.clearMotion === 'function') field.clearMotion();
}
