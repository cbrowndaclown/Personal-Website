/* GRID_GENERATION — power settles into calibration band: DARK → LIGHT GRAY.
   Pixels initialize individually with organic L→R order. */

import { BOOT_TIMING, BOOT_ENERGY } from '../constants.js';
import { applyOrganicEnergyReveal, lockEnergy } from '../energy.js';

const REVEAL_OPTS = Object.freeze({
  scatter: 0.3,
  soft: 0.028,
  seed: 0xb22f,
});

export function createGridGenerationStage() {
  let startMs = 0;

  return {
    id: 'grid_generation',
    durationMs: BOOT_TIMING.GRID_GENERATION_MS,
    overlapMs: BOOT_TIMING.GRID_OVERLAP_MS,

    enter(ctx) {
      startMs = ctx.now;
      /* Baseline only — prior stage already settled every cell to DARK */
      lockEnergy(ctx.field, BOOT_ENERGY.DARK);
      ctx.field.clearBrightness();
      ctx.field.clearMotion();
    },

    update(ctx) {
      const field = ctx.field;
      if (!field.presence) return { done: true };

      const elapsed = ctx.now - startMs;
      const u = elapsed / BOOT_TIMING.GRID_GENERATION_MS;

      const settled = applyOrganicEnergyReveal(
        field,
        BOOT_ENERGY.DARK,
        BOOT_ENERGY.LIGHT,
        u,
        REVEAL_OPTS
      );

      field.clearBrightness();
      if (ctx.indicator) ctx.indicator.paint(field, ctx.now);

      if (settled && elapsed >= BOOT_TIMING.GRID_GENERATION_MS) {
        return { done: true };
      }
      return { done: false };
    },

    exit(ctx) {
      ctx.field.clearBrightness();
    },
  };
}
