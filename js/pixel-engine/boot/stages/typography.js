/* TYPOGRAPHY_CONSTRUCTION — hero glyph LEDs construct on the completed
   white Pixel FS. The boot lattice is preserved — never cleared to black. */

import { BOOT_TIMING, BOOT_ENERGY } from '../constants.js';
import { applyOrganicEnergyReveal } from '../energy.js';

const WHITE_SETTLE = Object.freeze({
  scatter: 0.3,
  soft: 0.028,
  seed: 0xc41b,
});

/**
 * Delegates glyph bake / migration to the intro content service.
 * @param {object} [options]
 * @param {object} options.intro — intro controller content API
 */
export function createTypographyStage(options) {
  const intro = options.intro;
  let startMs = 0;
  let completeAt = 0;

  function preserveWhiteLattice(field) {
    if (!field || !field.presence) return;
    /* Idempotent procedural settle — keeps the completed boot display */
    applyOrganicEnergyReveal(
      field,
      BOOT_ENERGY.LIGHT,
      BOOT_ENERGY.WHITE,
      1,
      WHITE_SETTLE
    );
  }

  return {
    id: 'typography_construction',
    durationMs: null, /* driven by intro bake */
    overlapMs: BOOT_TIMING.TYPOGRAPHY_OVERLAP_MS,

    enter(ctx) {
      startMs = ctx.now;
      /* Keep the fully generated white lattice — do not fade/clear to black */
      preserveWhiteLattice(ctx.field);
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
      /* White Pixel FS remains the base; glyphs construct via intro LEDs */
      preserveWhiteLattice(ctx.field);
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
      preserveWhiteLattice(ctx.field);
      ctx.field.clearBrightness();
      ctx.field.clearMotion();
      /* Interactions unlock only after hero construction has settled */
      if (ctx && typeof ctx.setInteractive === 'function') {
        ctx.setInteractive(true);
      }
    },
  };
}
