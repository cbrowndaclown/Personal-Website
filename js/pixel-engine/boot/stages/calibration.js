/* CALIBRATION — final wake: LIGHT GRAY → WHITE as individual pixels L→R.
   While the last whites arrive, the red arc seals into a complete ring,
   holds briefly, then dissolves. The lattice stays fully initialized. */

import { BOOT_TIMING, BOOT_ENERGY, bootEnergyDurationMs } from '../constants.js';
import { clamp01 } from '../math.js';
import { applyOrganicEnergyReveal, lockEnergy } from '../energy.js';

export function createCalibrationStage() {
  let startMs = 0;
  let phase = 'sweep'; /* sweep | closing | ring_hold | dissolve | hold */
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
      /* One indicator revolution — arm close so it lands with the reveal */
      const closeLeadMs =
        bootEnergyDurationMs() / Math.max(1, BOOT_TIMING.INDICATOR_REVOLUTIONS);

      field.clearBrightness();
      field.clearMotion();

      if (phase === 'sweep') {
        const u = clamp01(elapsed / sweepMs);
        applyOrganicEnergyReveal(
          field,
          BOOT_ENERGY.LIGHT,
          BOOT_ENERGY.WHITE,
          u,
          {
            scatter: 0.3,
            soft: 0.028,
            seed: 0xc41b,
          }
        );

        if (ctx.indicator && !closeArmed && elapsed >= Math.max(0, sweepMs - closeLeadMs)) {
          ctx.indicator.beginClose(ctx.now);
          closeArmed = true;
        }

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

      /* Fully white while the ring seals, holds, and dissolves */
      lockEnergy(field, BOOT_ENERGY.WHITE);

      if (phase === 'closing') {
        const closed = !ctx.indicator || ctx.indicator.isClosed(ctx.now);
        if (closed) {
          if (ctx.indicator && typeof ctx.indicator.beginCircleHold === 'function') {
            ctx.indicator.beginCircleHold(ctx.now, field);
          }
          phase = 'ring_hold';
        }
        if (ctx.indicator) ctx.indicator.paint(field, ctx.now);
        return { done: false };
      }

      if (phase === 'ring_hold') {
        if (ctx.indicator) ctx.indicator.paint(field, ctx.now);
        const holdDone =
          !ctx.indicator ||
          (typeof ctx.indicator.isCircleHoldDone === 'function' &&
            ctx.indicator.isCircleHoldDone(ctx.now));
        if (holdDone) {
          if (ctx.indicator && typeof ctx.indicator.beginDissolve === 'function') {
            ctx.indicator.beginDissolve(ctx.now);
          }
          phase = 'dissolve';
        }
        return { done: false };
      }

      if (phase === 'dissolve') {
        if (ctx.indicator) ctx.indicator.paint(field, ctx.now);
        const gone =
          !ctx.indicator ||
          (typeof ctx.indicator.isDissolveDone === 'function' &&
            ctx.indicator.isDissolveDone(ctx.now));
        if (gone) {
          field.clearBrightness();
          if (ctx.indicator && typeof ctx.indicator.dismiss === 'function') {
            ctx.indicator.dismiss();
          }
          phase = 'hold';
          startMs = ctx.now;
        }
        return { done: false };
      }

      /* Brief hold of the completed white display after the ring is gone */
      field.clearBrightness();
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
      ctx.field.fillPresence(1);
      if (ctx.indicator && typeof ctx.indicator.dismiss === 'function') {
        ctx.indicator.dismiss();
      }
    },
  };
}
