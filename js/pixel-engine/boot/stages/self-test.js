/* SELF_TEST — closed red arc reorganizes into a minimal LED smile,
   holds briefly, then hands those pixels to typography construction. */

import { BOOT_TIMING, BOOT_ENERGY } from '../constants.js';
import { lockEnergy } from '../energy.js';

export function createSelfTestStage() {
  let phase = 'morph'; /* morph | hold */

  return {
    id: 'self_test',
    durationMs: BOOT_TIMING.SELF_TEST_MS,
    overlapMs: BOOT_TIMING.SELF_TEST_OVERLAP_MS,

    enter(ctx) {
      phase = 'morph';
      lockEnergy(ctx.field, BOOT_ENERGY.BLACK);
      ctx.field.clearBrightness();
      ctx.field.clearMotion();
      if (ctx.indicator) ctx.indicator.beginSmile(ctx.now, ctx.field);
    },

    update(ctx) {
      const field = ctx.field;
      if (!field.presence) return { done: true };

      lockEnergy(field, BOOT_ENERGY.BLACK);
      field.clearBrightness();
      field.clearMotion();

      if (!ctx.indicator) return { done: true };

      if (phase === 'morph') {
        ctx.indicator.paint(field, ctx.now);
        if (ctx.indicator.isSmileReady(ctx.now)) {
          ctx.indicator.beginHold(ctx.now);
          phase = 'hold';
        }
        return { done: false };
      }

      ctx.indicator.paint(field, ctx.now);
      if (ctx.indicator.isHoldDone(ctx.now)) {
        return { done: true };
      }
      return { done: false };
    },

    exit(ctx) {
      lockEnergy(ctx.field, BOOT_ENERGY.BLACK);
      ctx.field.clearBrightness();
      ctx.field.clearMotion();
      /* Leave smile painted one last frame for the typography handoff */
      if (ctx.indicator) ctx.indicator.paint(ctx.field, ctx.now);
    },
  };
}
