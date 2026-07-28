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

/** Soft timing defaults — layered overlaps keep the sequence continuous. */
export const BOOT_TIMING = Object.freeze({
  POWERING_ON_MS: 1100,
  POWERING_OVERLAP_MS: 320,
  GRID_GENERATION_MS: 2400,
  GRID_OVERLAP_MS: 380,
  CALIBRATION_MS: 1400,
  CALIBRATION_OVERLAP_MS: 260,
  /* Typography duration is driven by LED bake; these are floor / settle pads */
  TYPOGRAPHY_MIN_MS: 1800,
  TYPOGRAPHY_SETTLE_PAD_MS: 420,
  TYPOGRAPHY_OVERLAP_MS: 200,
  STABILIZING_MS: 980,
  READY_DIRECTORY_DELAY_MS: 480,
});
