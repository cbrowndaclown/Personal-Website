/* CALIBRATION — final wake: LIGHT GRAY → WHITE as individual pixels L→R.
   While the last whites arrive, the red arc completes one full closing
   revolution, then disappears. The lattice stays fully initialized. */

import { BOOT_TIMING, BOOT_ENERGY, bootEnergyDurationMs } from '../constants.js';
import { clamp01 } from '../math.js';
import { applyOrganicEnergyReveal, lockEnergy } from '../energy.js';

export function createCalibrationStage() {
  let startMs = 0;
  let phase = 'sweep'; /* sweep | closing | hold */
  let closeArmed = false;
  let dismissed = false;

  return {
    id: 'calibration',
    durationMs: BOOT_TIMING.CALIBRATION_MS,
    overlapMs: BOOT_TIMING.CALIBRATION_OVERLAP_MS,

    enter(ctx) {
      startMs = ctx.now;
      phase = 'sweep';
      closeArmed = false;
      dismissed = false;
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

        if (
          ctx.indicator &&
          closeArmed &&
          !dismissed &&
          ctx.indicator.isClosed(ctx.now)
        ) {
          ctx.indicator.dismiss();
          dismissed = true;
        }

        if (ctx.indicator && !dismissed) ctx.indicator.paint(field, ctx.now);

        if (elapsed >= sweepMs) {
          lockEnergy(field, BOOT_ENERGY.WHITE);
          if (ctx.indicator && !closeArmed) {
            ctx.indicator.beginClose(ctx.now);
            closeArmed = true;
          }
          phase = dismissed ? 'hold' : 'closing';
          if (phase === 'hold') startMs = ctx.now;
        }
        return { done: false };
      }

      /* Fully white while the arc finishes its closing revolution */
      lockEnergy(field, BOOT_ENERGY.WHITE);

      if (phase === 'closing') {
        const closed = !ctx.indicator || ctx.indicator.isClosed(ctx.now);
        if (closed) {
          if (ctx.indicator && typeof ctx.indicator.dismiss === 'function') {
            ctx.indicator.dismiss();
          }
          dismissed = true;
          field.clearBrightness();
          phase = 'hold';
          startMs = ctx.now;
        } else if (ctx.indicator) {
          ctx.indicator.paint(field, ctx.now);
        }
        return { done: false };
      }

      /* Brief hold of the completed white display — no fade-to-black */
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
      if (
        ctx.indicator &&
        !dismissed &&
        typeof ctx.indicator.dismiss === 'function'
      ) {
        ctx.indicator.dismiss();
      }
    },
  };
}
