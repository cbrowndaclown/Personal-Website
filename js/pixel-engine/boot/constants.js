/* Boot lifecycle constants — Version 1 foundation.
   Stages are ordered in stages/index.js so they can be rearranged freely. */

export const BootPhase = Object.freeze({
  OFF: 'off',
  POWERING_ON: 'powering_on',
  GRID_GENERATION: 'grid_generation',
  CALIBRATION: 'calibration',
  TYPOGRAPHY_CONSTRUCTION: 'typography_construction',
  STABILIZING: 'stabilizing',
  READY: 'ready',
  SKIPPED: 'skipped',
});

/**
 * Pixel energy ladder — every cell walks this sequence in order.
 * Values map to luminance during energy boot (0 = black, 1 = white).
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

  /* LIGHT GRAY → WHITE, then indicator fade + stillness before typography */
  CALIBRATION_SWEEP_MS: 3000,
  INDICATOR_FADE_MS: 480,
  BOOT_STILLNESS_MS: 620,
  CALIBRATION_MS: 3000 + 480 + 620,
  CALIBRATION_OVERLAP_MS: 0,

  /* Soft wipe feather as a fraction of grid width */
  SWEEP_FEATHER: 0.14,

  /* Indicator completes this many revolutions as the final white arrives */
  INDICATOR_REVOLUTIONS: 3,

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
