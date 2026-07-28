/* Boot lifecycle constants — Version 1 foundation.
   Stages are ordered in stages/index.js so they can be rearranged freely. */

export const BootPhase = Object.freeze({
  OFF: 'off',
  POWERING_ON: 'powering_on',
  GRID_GENERATION: 'grid_generation',
  CALIBRATION: 'calibration',
  DISPLAY_CLEAR: 'display_clear',
  SELF_TEST: 'self_test',
  TYPOGRAPHY_CONSTRUCTION: 'typography_construction',
  STABILIZING: 'stabilizing',
  READY: 'ready',
  SKIPPED: 'skipped',
});

/**
 * Pixel energy ladder — every cell walks this sequence in order.
 * Presence drives the live Pixel FS resting formula (FIELD → COOL);
 * ungenerated cells remain black until presence claims them.
 */
export const BOOT_ENERGY = Object.freeze({
  BLACK: 0,
  DARK: 0.18,
  LIGHT: 0.56,
  WHITE: 1,
});

/**
 * Soft timing defaults — energy stages run sequentially (no overlap).
 * Pacing favors a calm, deliberate power-on rather than a short intro sting.
 */
export const BOOT_TIMING = Object.freeze({
  /* BLACK → DARK GRAY */
  POWERING_ON_MS: 2600,
  POWERING_OVERLAP_MS: 0,

  /* DARK GRAY → LIGHT GRAY */
  GRID_GENERATION_MS: 2800,
  GRID_OVERLAP_MS: 0,

  /* LIGHT GRAY → WHITE (organic), ring seals with final pixels then dissolves */
  CALIBRATION_SWEEP_MS: 3000,
  WHITE_HOLD_MS: 420,
  /* Sweep + sealed-ring hold + dissolve + brief stillness */
  CALIBRATION_MS: 3000 + 300 + 480 + 420,
  CALIBRATION_OVERLAP_MS: 0,

  /* Soft wipe feather (legacy; energy stages use organic reveal) */
  SWEEP_FEATHER: 0.14,

  /* Indicator completes this many revolutions across the energy window;
     the final revolution is armed so it seals with the last pixel layer. */
  INDICATOR_REVOLUTIONS: 3,

  /* Legacy clear timing (stage removed — white lattice stays initialized) */
  DISPLAY_CLEAR_MS: 780,
  DISPLAY_CLEAR_OVERLAP_MS: 0,

  /* Sealed ring recognition beat, then natural fade-out */
  CIRCLE_HOLD_MS: 300,
  RING_DISSOLVE_MS: 480,

  /* Legacy self-test / smile timings (stage removed from pipeline) */
  CIRCLE_COMPLETE_MS: 560,
  SMILE_MORPH_MS: 780,
  SMILE_HOLD_MS: 780,
  SELF_TEST_MS: 560 + 300 + 780 + 780,
  SELF_TEST_OVERLAP_MS: 0,
  SMILE_DISSOLVE_MS: 480,

  /* Typography duration is driven by LED bake; these are floor / settle pads */
  TYPOGRAPHY_MIN_MS: 1800,
  TYPOGRAPHY_SETTLE_PAD_MS: 420,
  TYPOGRAPHY_OVERLAP_MS: 0,

  STABILIZING_MS: 420,
  READY_DIRECTORY_DELAY_MS: 480,
});

/** Total energy-sweep window used to sync the center indicator. */
export function bootEnergyDurationMs() {
  return (
    BOOT_TIMING.POWERING_ON_MS +
    BOOT_TIMING.GRID_GENERATION_MS +
    BOOT_TIMING.CALIBRATION_SWEEP_MS
  );
}

/**
 * Phases where the Pixel Engine lattice owns the canvas exclusively
 * (no hero type, directory, cursor heat, or other Pixel FS content).
 */
export function isExclusiveBootPhase(phase) {
  return (
    phase === BootPhase.POWERING_ON ||
    phase === BootPhase.GRID_GENERATION ||
    phase === BootPhase.CALIBRATION ||
    phase === BootPhase.DISPLAY_CLEAR ||
    phase === BootPhase.SELF_TEST
  );
}

/**
 * Phases that progressively initialize the live Pixel FS lattice.
 * Extends through typography + stabilizing so the completed FIELD + COOL
 * resting state is never abandoned for a black clear between boot and intro.
 */
export function isLatticeBootPhase(phase) {
  return (
    isExclusiveBootPhase(phase) ||
    phase === BootPhase.TYPOGRAPHY_CONSTRUCTION ||
    phase === BootPhase.STABILIZING ||
    phase === 'typography' ||
    phase === 'stabilizing'
  );
}

/** Red boot-indicator accent is active during these phases. */
export function isIndicatorAccentPhase(phase) {
  return isExclusiveBootPhase(phase);
}
