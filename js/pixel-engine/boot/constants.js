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
 * Opening wave — on page load a thin line, a few pixels wide, glides across
 * the lattice left → right. Pixels under the line pop toward the viewer —
 * they grow, lift slightly and dim to a muted gray — and once it passes
 * they fall back, overshoot below rest and spring-settle into place. The
 * front is irregular: it wobbles, surges and swells unevenly like water.
 * Styles skip their resting "ghost" dot while the wave runs.
 */
export const OPENING_BOUNCE = Object.freeze({
  /** Left edge → right edge travel time of the wave line */
  SPREAD_MS: 1500,
  /** Width of the wave line, in lattice cells — the pop lives here */
  BAND_CELLS: 7,
  /** Peak growth at the line — 0.5 → dots reach ~1.5× their size */
  POP_SCALE: 0.5,
  /** Peak lift at the line, in lattice cells */
  LIFT_CELLS: 0.5,
  /** Settle behind the line — each pixel drops back past rest, springs up,
      and rings down like a damped spring: squash on the drop, a little
      sway in the wave's direction, slightly different timing per pixel. */
  BOUNCE_SCALE: 0.2,
  /** Total settle time after the line passes (pixel is exactly at rest by then) */
  BOUNCE_MS: 900,
  /** Spring half-period — time between the drop and the rebound */
  BOUNCE_HALF_MS: 130,
  /** Spring damping — lower decays faster */
  SETTLE_DAMP_MS: 240,
  /** How far below rest a pixel overshoots on the drop, in lattice cells */
  SETTLE_DROP_CELLS: 0.3,
  /** Sideways sway in the wave's direction, in lattice cells */
  SETTLE_SWAY_CELLS: 0.12,
  /** Per-pixel spring variance (0–1) so the field settles organically */
  SETTLE_VARY: 0.3,
  /** Popped pixels fade toward this muted gray instead of bright white */
  SHADE_RGB: Object.freeze([168, 168, 168]),
  /** How far (0–1) a fully popped pixel moves toward SHADE_RGB */
  SHADE: 0.85,
  /** Irregular front — the line wobbles up to ± this many ms along its
      length (a few overlapping slow ripples, re-rolled every page load) */
  FRONT_WOBBLE_MS: 120,
  /** Uneven speed — the wave surges and eases as it travels (0–0.1) */
  SPEED_WOBBLE: 0.05,
  /** Uneven height — swell strength varies across the field by ± this */
  AMP_VARY: 0.35,
  /** Per-pixel timing scatter */
  JITTER_MS: 18,
});

/** Opening hero typography → directory hand-off timing. */
export const OPENING_INTRO = Object.freeze({
  /* Typography duration is driven by LED bake; these are floor / settle pads */
  TYPOGRAPHY_MIN_MS: 1800,
  TYPOGRAPHY_SETTLE_PAD_MS: 420,
  /* Glyphs rest in place before dissolving into the directory menu */
  HOLD_MS: 900,
});
