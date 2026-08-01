/* Shared pixel-field constants — Version 1 visual language. */

/** CSS pixels per cell — finer grid (Heat / Wave / Lightning all share this). */
export const CELL = 5;

/** Dot size inside each cell. */
export const DOT = CELL - 2;

/** Flat field background behind the dots. */
export const FIELD = Object.freeze([210, 210, 210]);

/** Resting (cool) pixel color. */
export const COOL = Object.freeze([255, 255, 255]);

/** Pixel FS style registry — engine keys + availability. */
export const PIXEL_FIELD_STYLES = Object.freeze({
  heat:         { implemented: true,  label: 'Heat' },
  wave:         { implemented: true,  label: 'Wave' },
  lightning:    { implemented: true,  label: 'Lightning' },
  experimental: { implemented: false, label: 'Experimental' },
});

/** Named events used across the Pixel Engine. */
export const PixelEvents = Object.freeze({
  GridInitialized: 'GridInitialized',
  GridResized: 'GridResized',
  /** Pixel Density changed — full lattice rebuild (presence, LEDs, style sim). */
  PixelDensityChanged: 'PixelDensityChanged',
  /**
   * Density change requested — tear down the live lattice before any remount.
   * Grid cell size is NOT applied yet; rebuild follows in a later phase.
   */
  PixelDensityTeardownRequest: 'PixelDensityTeardownRequest',
  /** Center-out density teardown started / finished. */
  PixelDensityTeardownStart: 'PixelDensityTeardownStart',
  PixelDensityTeardownEnd: 'PixelDensityTeardownEnd',
  /** Full density transition finished (teardown + generate + menu hold). */
  PixelDensityTransitionEnd: 'PixelDensityTransitionEnd',
  /** Density recalibration sync started / finished (center-out presence wave). */
  PixelRecalibrationStart: 'PixelRecalibrationStart',
  PixelRecalibrationEnd: 'PixelRecalibrationEnd',
  /** Soft same-density preset refresh finished (settings applied behind sync). */
  PixelPresetRefreshEnd: 'PixelPresetRefreshEnd',
  PixelFSChanged: 'PixelFSChanged',
  SettingsUpdated: 'SettingsUpdated',
  InteractionDetected: 'InteractionDetected',
  AnimationFinished: 'AnimationFinished',
  MouseMoved: 'MouseMoved',
  PointerLeft: 'PointerLeft',
  /* Bridged / legacy window events (kept for settings + existing listeners) */
  AnimConfigChange: 'animconfigchange',
  BgModeChange: 'bgmodechange',
  MotionReenabled: 'motionreenabled',
  PixelIntroStart: 'pixelintrostart',
  PixelDirectoryStart: 'pixeldirectorystart',
  PixelDirectoryHold: 'pixeldirectoryhold',
  BootPhaseChanged: 'BootPhaseChanged',
  BootReady: 'BootReady',
  PixelBootReady: 'pixelbootready',
  LightningStrike: 'lightningstrike',
});
