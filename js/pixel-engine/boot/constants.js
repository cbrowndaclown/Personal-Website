/* Boot lifecycle constants. The startup animation was removed — page load
   lands directly on READY; density ops reuse the same lattice + energy scale. */

export const BootPhase = Object.freeze({
  OFF: 'off',
  READY: 'ready',
  SKIPPED: 'skipped',
});

/**
 * Pixel energy scale — presence drives the live Pixel FS resting formula
 * (FIELD → COOL); retired cells sit at BLACK over the gray panel.
 */
export const BOOT_ENERGY = Object.freeze({
  BLACK: 0,
  WHITE: 1,
});

/**
 * Opening bounce — on page load the lattice pops in from the centre outward,
 * each pixel landing with a small damped hop before the intro menu assembles.
 * HOP_PX stays under the 2.5px glyph-drift threshold the styles use, so the
 * bounce moves the dot itself instead of leaving a resting ghost behind.
 */
export const OPENING_BOUNCE = Object.freeze({
  /** Centre → farthest corner reveal delay */
  SPREAD_MS: 650,
  /** Per-pixel pop + bounce duration */
  POP_MS: 700,
  /** Peak upward hop (CSS px) */
  HOP_PX: 2.4,
  /** Number of half-bounces within POP_MS */
  BOUNCES: 2.5,
});

/** Opening hero typography → directory hand-off timing. */
export const OPENING_INTRO = Object.freeze({
  /* Typography duration is driven by LED bake; these are floor / settle pads */
  TYPOGRAPHY_MIN_MS: 1800,
  TYPOGRAPHY_SETTLE_PAD_MS: 420,
  /* Glyphs rest in place before dissolving into the directory menu */
  HOLD_MS: 900,
});
