/* TYPOGRAPHY_CONSTRUCTION — hero glyph LEDs construct after the loading ring. */

import { BOOT_TIMING, BOOT_ENERGY } from '../constants.js';
import { lockEnergy } from '../energy.js';

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
      lockEnergy(ctx.field, BOOT_ENERGY.BLACK);
      ctx.field.clearMotion();
      ctx.field.clearBrightness();

      if (ctx.indicator && typeof ctx.indicator.dismiss === 'function') {
        ctx.indicator.dismiss();
      }

      intro.beginTypographyConstruction({ seedCells: null });
      const ledMs = intro.getTypographyDurationMs();
      completeAt =
        startMs +
        Math.max(BOOT_TIMING.TYPOGRAPHY_MIN_MS, ledMs) +
        BOOT_TIMING.TYPOGRAPHY_SETTLE_PAD_MS;
    },

    update(ctx) {
      /* Keep the lattice dormant black while glyphs construct */
      lockEnergy(ctx.field, BOOT_ENERGY.BLACK);
      ctx.field.clearMotion();
      ctx.field.clearBrightness();

      const settled = intro.isTypographySettled();
      const timedOut = ctx.now >= completeAt;
      return { done: settled || timedOut };
    },

    exit(ctx) {
      intro.holdTypography();
      if (ctx.indicator && typeof ctx.indicator.reset === 'function') {
        ctx.indicator.reset();
      }
      ctx.field.clearBrightness();
      ctx.field.clearMotion();
      /* Field awakens to operational lattice as typography settles */
      ctx.field.fillPresence(1);
      /* Interactions unlock only after hero construction has settled */
      if (ctx && typeof ctx.setInteractive === 'function') {
        ctx.setInteractive(true);
      }
    },
  };
}
