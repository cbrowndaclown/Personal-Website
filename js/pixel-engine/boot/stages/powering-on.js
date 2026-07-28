/* POWERING_ON — dormant black field receives power: BLACK → DARK GRAY.
   Pixels initialize individually with organic L→R order. */

import { BOOT_TIMING, BOOT_ENERGY } from '../constants.js';
import { clamp01 } from '../math.js';
import { applyOrganicEnergyReveal, lockEnergy } from '../energy.js';

const REVEAL_OPTS = Object.freeze({
  scatter: 0.3,
  soft: 0.028,
  seed: 0xa11e,
});

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

      const settled = applyOrganicEnergyReveal(
        field,
        BOOT_ENERGY.BLACK,
        BOOT_ENERGY.DARK,
        u,
        REVEAL_OPTS
      );

      field.clearBrightness();
      if (ctx.indicator) ctx.indicator.paint(field, ctx.now);

      /* Advance only after every pixel has flipped — never force-fill */
      if (elapsed >= BOOT_TIMING.POWERING_ON_MS && settled) {
        return { done: true };
      }
      return { done: false };
    },

    exit(ctx) {
      /* Final procedural frame at u=1 — no bulk lockEnergy snap */
      applyOrganicEnergyReveal(
        ctx.field,
        BOOT_ENERGY.BLACK,
        BOOT_ENERGY.DARK,
        1,
        REVEAL_OPTS
      );
      ctx.field.clearBrightness();
    },
  };
}
