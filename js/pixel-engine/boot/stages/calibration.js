/* CALIBRATION — final wake: LIGHT GRAY → WHITE L→R.
   Indicator keeps rotating through white arrival, then completes
   one final full revolution before the display-clear stage. */

import { BOOT_TIMING, BOOT_ENERGY } from '../constants.js';
import { clamp01 } from '../math.js';
import { applyEnergySweep, lockEnergy } from '../energy.js';

export function createCalibrationStage() {
  let startMs = 0;
  let phase = 'sweep'; /* sweep | closing | hold */
  let closeArmed = false;

  return {
    id: 'calibration',
    durationMs: BOOT_TIMING.CALIBRATION_MS,
    overlapMs: BOOT_TIMING.CALIBRATION_OVERLAP_MS,

    enter(ctx) {
      startMs = ctx.now;
      phase = 'sweep';
      closeArmed = false;
      lockEnergy(ctx.field, BOOT_ENERGY.LIGHT);
      ctx.field.clearBrightness();
      ctx.field.clearMotion();
    },

    update(ctx) {
      const field = ctx.field;
      if (!field.presence) return { done: true };

      const elapsed = ctx.now - startMs;
      const sweepMs = BOOT_TIMING.CALIBRATION_SWEEP_MS;
      const holdMs = BOOT_TIMING.WHITE_HOLD_MS;

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
          if (ctx.indicator && !closeArmed) {
            ctx.indicator.beginClose(ctx.now);
            closeArmed = true;
          }
          phase = 'closing';
        }
        return { done: false };
      }

      /* Fully white while the arc finishes one clean closing revolution */
      lockEnergy(field, BOOT_ENERGY.WHITE);
      if (ctx.indicator) ctx.indicator.paint(field, ctx.now);

      if (phase === 'closing') {
        const closed = !ctx.indicator || ctx.indicator.isClosed(ctx.now);
        if (closed) {
          phase = 'hold';
          startMs = ctx.now; /* reuse for white hold beat */
        }
        return { done: false };
      }

      /* Brief hold of the completed white display before clearing */
      const holdElapsed = ctx.now - startMs;
      if (holdElapsed >= holdMs) {
        return { done: true };
      }
      return { done: false };
    },

    exit(ctx) {
      lockEnergy(ctx.field, BOOT_ENERGY.WHITE);
      ctx.field.clearBrightness();
      ctx.field.clearMotion();
      if (ctx.indicator) ctx.indicator.paint(ctx.field, ctx.now);
    },
  };
}
