/* DISPLAY_CLEAR — after calibration white, clear the lattice back to black.
   Reads as a successful calibration wipe, not a power-off. */

import { BOOT_TIMING, BOOT_ENERGY } from '../constants.js';
import { clamp01, smootherstep } from '../math.js';
import { lockEnergy } from '../energy.js';

export function createDisplayClearStage() {
  let startMs = 0;

  return {
    id: 'display_clear',
    durationMs: BOOT_TIMING.DISPLAY_CLEAR_MS,
    overlapMs: BOOT_TIMING.DISPLAY_CLEAR_OVERLAP_MS,

    enter(ctx) {
      startMs = ctx.now;
      lockEnergy(ctx.field, BOOT_ENERGY.WHITE);
      ctx.field.clearBrightness();
      ctx.field.clearMotion();
    },

    update(ctx) {
      const field = ctx.field;
      if (!field.presence) return { done: true };

      const elapsed = ctx.now - startMs;
      const u = smootherstep(clamp01(elapsed / BOOT_TIMING.DISPLAY_CLEAR_MS));

      /* Unified clear — every cell fades together, soft and deliberate */
      const level = BOOT_ENERGY.WHITE * (1 - u);
      lockEnergy(field, level);

      field.clearBrightness();
      field.clearMotion();
      /* Closed red indicator remains centered through the clear */
      if (ctx.indicator) ctx.indicator.paint(field, ctx.now);

      if (elapsed >= BOOT_TIMING.DISPLAY_CLEAR_MS) {
        lockEnergy(field, BOOT_ENERGY.BLACK);
        return { done: true };
      }
      return { done: false };
    },

    exit(ctx) {
      lockEnergy(ctx.field, BOOT_ENERGY.BLACK);
      ctx.field.clearBrightness();
      ctx.field.clearMotion();
      if (ctx.indicator) ctx.indicator.paint(ctx.field, ctx.now);
    },
  };
}
