/* GRID_GENERATION — power settles into calibration band: DARK → LIGHT GRAY, L→R. */

import { BOOT_TIMING, BOOT_ENERGY } from '../constants.js';
import { clamp01 } from '../math.js';
import { applyEnergySweep, lockEnergy } from '../energy.js';

export function createGridGenerationStage() {
  let startMs = 0;

  return {
    id: 'grid_generation',
    durationMs: BOOT_TIMING.GRID_GENERATION_MS,
    overlapMs: BOOT_TIMING.GRID_OVERLAP_MS,

    enter(ctx) {
      startMs = ctx.now;
      lockEnergy(ctx.field, BOOT_ENERGY.DARK);
      ctx.field.clearBrightness();
      ctx.field.clearMotion();
    },

    update(ctx) {
      const field = ctx.field;
      if (!field.presence) return { done: true };

      const elapsed = ctx.now - startMs;
      const u = clamp01(elapsed / BOOT_TIMING.GRID_GENERATION_MS);

      applyEnergySweep(
        field,
        BOOT_ENERGY.DARK,
        BOOT_ENERGY.LIGHT,
        u,
        BOOT_TIMING.SWEEP_FEATHER
      );

      field.clearBrightness();
      if (ctx.indicator) ctx.indicator.paint(field, ctx.now);

      if (elapsed >= BOOT_TIMING.GRID_GENERATION_MS) {
        lockEnergy(field, BOOT_ENERGY.LIGHT);
        return { done: true };
      }
      return { done: false };
    },

    exit(ctx) {
      lockEnergy(ctx.field, BOOT_ENERGY.LIGHT);
      ctx.field.clearBrightness();
    },
  };
}
