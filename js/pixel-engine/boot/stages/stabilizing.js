/* STABILIZING — quiet handoff after typography; no competing field motion. */

import { BOOT_TIMING } from '../constants.js';
import { clamp01 } from '../math.js';

export function createStabilizingStage() {
  let startMs = 0;

  return {
    id: 'stabilizing',
    durationMs: BOOT_TIMING.STABILIZING_MS,
    overlapMs: 0,

    enter(ctx) {
      startMs = ctx.now;
      ctx.field.fillPresence(1);
      ctx.field.clearBrightness();
      ctx.field.clearMotion();
      if (ctx.intro && typeof ctx.intro.holdTypography === 'function') {
        ctx.intro.holdTypography();
      }
    },

    update(ctx) {
      const field = ctx.field;
      field.fillPresence(1);
      field.clearBrightness();
      field.clearMotion();

      const elapsed = ctx.now - startMs;
      return { done: clamp01(elapsed / BOOT_TIMING.STABILIZING_MS) >= 1 };
    },

    exit(ctx) {
      ctx.field.clearBrightness();
      ctx.field.clearMotion();
      ctx.field.fillPresence(1);
    },
  };
}
