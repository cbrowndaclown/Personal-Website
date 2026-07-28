/* SELF_TEST — closed red arc expands into a full circle, then reorganizes
   into a readable LED smiley (ring + eyes + mouth), holds for recognition,
   then hands those pixels to typography construction. */

import { BOOT_TIMING, BOOT_ENERGY } from '../constants.js';
import { lockEnergy } from '../energy.js';

export function createSelfTestStage() {
  let phase = 'complete'; /* complete | circle_hold | morph | hold */

  return {
    id: 'self_test',
    durationMs: BOOT_TIMING.SELF_TEST_MS,
    overlapMs: BOOT_TIMING.SELF_TEST_OVERLAP_MS,

    enter(ctx) {
      phase = 'complete';
      lockEnergy(ctx.field, BOOT_ENERGY.BLACK);
      ctx.field.clearBrightness();
      ctx.field.clearMotion();
      if (ctx.indicator && typeof ctx.indicator.beginComplete === 'function') {
        ctx.indicator.beginComplete(ctx.now, ctx.field);
      } else if (ctx.indicator) {
        /* Fallback for older indicator API */
        ctx.indicator.beginSmile(ctx.now, ctx.field);
        phase = 'morph';
      }
    },

    update(ctx) {
      const field = ctx.field;
      if (!field.presence) return { done: true };

      lockEnergy(field, BOOT_ENERGY.BLACK);
      field.clearBrightness();
      field.clearMotion();

      if (!ctx.indicator) return { done: true };

      if (phase === 'complete') {
        ctx.indicator.paint(field, ctx.now);
        if (
          typeof ctx.indicator.isCircleComplete === 'function' &&
          ctx.indicator.isCircleComplete(ctx.now)
        ) {
          ctx.indicator.beginCircleHold(ctx.now);
          phase = 'circle_hold';
        }
        return { done: false };
      }

      if (phase === 'circle_hold') {
        ctx.indicator.paint(field, ctx.now);
        if (
          typeof ctx.indicator.isCircleHoldDone === 'function' &&
          ctx.indicator.isCircleHoldDone(ctx.now)
        ) {
          ctx.indicator.beginSmile(ctx.now, field);
          phase = 'morph';
        }
        return { done: false };
      }

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
