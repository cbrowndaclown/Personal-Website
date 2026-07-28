/* POWERING_ON — dormant black field receives power: BLACK → DARK GRAY, L→R. */

import { BOOT_TIMING, BOOT_ENERGY } from '../constants.js';
import { clamp01 } from '../math.js';
import { applyEnergySweep, lockEnergy } from '../energy.js';

export function createPoweringOnStage() {
  let startMs = 0;

  return {
    id: 'powering_on',
    durationMs: BOOT_TIMING.POWERING_ON_MS,
    overlapMs: BOOT_TIMING.POWERING_OVERLAP_MS,

    enter(ctx) {
      startMs = ctx.now;
      const field = ctx.field;
      field.clear();
      lockEnergy(field, BOOT_ENERGY.BLACK);
      if (ctx.indicator) ctx.indicator.start(ctx.now);
    },

    update(ctx) {
      const field = ctx.field;
      if (!field.presence) return { done: true };

      const elapsed = ctx.now - startMs;
      const u = clamp01(elapsed / BOOT_TIMING.POWERING_ON_MS);

      applyEnergySweep(
        field,
        BOOT_ENERGY.BLACK,
        BOOT_ENERGY.DARK,
        u,
        BOOT_TIMING.SWEEP_FEATHER
      );

      field.clearBrightness();
      if (ctx.indicator) ctx.indicator.paint(field, ctx.now);

      if (elapsed >= BOOT_TIMING.POWERING_ON_MS) {
        lockEnergy(field, BOOT_ENERGY.DARK);
        return { done: true };
      }
      return { done: false };
    },

    exit(ctx) {
      lockEnergy(ctx.field, BOOT_ENERGY.DARK);
      ctx.field.clearBrightness();
    },
  };
}
