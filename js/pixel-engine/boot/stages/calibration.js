/* CALIBRATION — final wake: LIGHT GRAY → WHITE L→R,
   indicator completes its last revolution and fades, then brief stillness. */

import { BOOT_TIMING, BOOT_ENERGY } from '../constants.js';
import { clamp01 } from '../math.js';
import { applyEnergySweep, lockEnergy } from '../energy.js';

export function createCalibrationStage() {
  let startMs = 0;
  let phase = 'sweep'; /* sweep | fade | stillness */

  return {
    id: 'calibration',
    durationMs: BOOT_TIMING.CALIBRATION_MS,
    overlapMs: BOOT_TIMING.CALIBRATION_OVERLAP_MS,

    enter(ctx) {
      startMs = ctx.now;
      phase = 'sweep';
      lockEnergy(ctx.field, BOOT_ENERGY.LIGHT);
      ctx.field.clearBrightness();
      ctx.field.clearMotion();
    },

    update(ctx) {
      const field = ctx.field;
      if (!field.presence) return { done: true };

      const elapsed = ctx.now - startMs;
      const sweepMs = BOOT_TIMING.CALIBRATION_SWEEP_MS;
      const fadeMs = BOOT_TIMING.INDICATOR_FADE_MS;
      const stillMs = BOOT_TIMING.BOOT_STILLNESS_MS;

      field.clearBrightness();
      field.clearMotion();

      if (phase === 'sweep') {
        const u = clamp01(elapsed / sweepMs);
        applyEnergySweep(
          field,
          BOOT_ENERGY.LIGHT,
          BOOT_ENERGY.WHITE,
          u,
          BOOT_TIMING.SWEEP_FEATHER
        );

        if (ctx.indicator) ctx.indicator.paint(field, ctx.now);

        if (elapsed >= sweepMs) {
          lockEnergy(field, BOOT_ENERGY.WHITE);
          if (ctx.indicator) ctx.indicator.beginFade(ctx.now);
          phase = 'fade';
        }
        return { done: false };
      }

      /* Grid fully white while the arc closes and dissolves */
      lockEnergy(field, BOOT_ENERGY.WHITE);

      if (phase === 'fade') {
        if (ctx.indicator) ctx.indicator.paint(field, ctx.now);
        const fadeElapsed = elapsed - sweepMs;
        if (
          fadeElapsed >= fadeMs ||
          (ctx.indicator && ctx.indicator.isDone(ctx.now))
        ) {
          field.clearBrightness();
          phase = 'stillness';
        }
        return { done: false };
      }

      /* Quiet beat before typography construction */
      field.clearBrightness();
      const stillElapsed = elapsed - sweepMs - fadeMs;
      if (stillElapsed >= stillMs) {
        return { done: true };
      }
      return { done: false };
    },

    exit(ctx) {
      lockEnergy(ctx.field, BOOT_ENERGY.WHITE);
      ctx.field.clearBrightness();
      ctx.field.clearMotion();
      ctx.field.fillPresence(1);
    },
  };
}
