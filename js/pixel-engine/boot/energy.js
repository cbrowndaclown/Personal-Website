/* Shared energy helpers for density teardown / recalibration. */

/**
 * Snap every cell to an exact energy level.
 * Baseline / skip paths only — never use to finish a reveal early.
 * @param {ReturnType<import('./boot-field.js').createBootField>} field
 * @param {number} energy
 */
export function lockEnergy(field, energy) {
  if (field && field.presence) field.presence.fill(energy);
}
