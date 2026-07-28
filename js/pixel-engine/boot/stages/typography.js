/* TYPOGRAPHY_CONSTRUCTION — hero glyph LEDs construct on the existing
   Pixel FS presence buffer. Boot already populated that buffer; this stage
   must not clear, refill, or swap it. */

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
      /*
        Presence is left exactly as calibration generated it.
        Only clear boot-indicator brightness — intro LEDs live in intro buffers.
      */
      ctx.field.clearMotion();
      ctx.field.clearBrightness();

      if (ctx.indicator && typeof ctx.indicator.dismiss === 'function') {
        ctx.indicator.dismiss();
      }
      if (ctx.status && typeof ctx.status.dismiss === 'function') {
        ctx.status.dismiss();
      }

      intro.beginTypographyConstruction({ seedCells: null });
      const ledMs = intro.getTypographyDurationMs();
      completeAt =
        startMs +
        Math.max(BOOT_TIMING.TYPOGRAPHY_MIN_MS, ledMs) +
        BOOT_TIMING.TYPOGRAPHY_SETTLE_PAD_MS;
    },

    update(ctx) {
      /* Never touch presence — glyphs composite via intro brightness/offsets */
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
      if (ctx.status && typeof ctx.status.reset === 'function') {
        ctx.status.reset();
      }
      ctx.field.clearBrightness();
      ctx.field.clearMotion();
      if (ctx && typeof ctx.setInteractive === 'function') {
        ctx.setInteractive(true);
      }
    },
  };
}
