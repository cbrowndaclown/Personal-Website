/* TYPOGRAPHY_CONSTRUCTION — hero glyph LEDs migrate into place. */

import { BOOT_TIMING } from '../constants.js';

/**
 * Delegates glyph bake / migration to the intro content service.
 * @param {object} [options]
 * @param {object} options.intro — intro controller content API
 */
export function createTypographyStage(options) {
  const intro = options.intro;
  let startMs = 0;
  let completeAt = 0;

  return {
    id: 'typography_construction',
    durationMs: null, /* driven by intro bake */
    overlapMs: BOOT_TIMING.TYPOGRAPHY_OVERLAP_MS,

    enter(ctx) {
      startMs = ctx.now;
      ctx.field.fillPresence(1);
      ctx.field.clearBrightness();
      ctx.field.clearMotion();
      intro.beginTypographyConstruction();
      const ledMs = intro.getTypographyDurationMs();
      completeAt =
        startMs +
        Math.max(BOOT_TIMING.TYPOGRAPHY_MIN_MS, ledMs) +
        BOOT_TIMING.TYPOGRAPHY_SETTLE_PAD_MS;
    },

    update(ctx) {
      /* Intro LED update runs from the boot controller each frame */
      const settled = intro.isTypographySettled();
      const timedOut = ctx.now >= completeAt;
      return { done: settled || timedOut };
    },

    exit(ctx) {
      intro.holdTypography();
      /* Interactions unlock only after hero construction has settled */
      if (ctx && typeof ctx.setInteractive === 'function') {
        ctx.setInteractive(true);
      }
    },
  };
}
