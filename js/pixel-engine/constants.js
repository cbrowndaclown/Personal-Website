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
  heat:         { implemented: true,  label: 'Magnetic' },
  wave:         { implemented: true,  label: 'Wave' },
  lightning:    { implemented: true,  label: 'Lightning' },
  experimental: { implemented: false, label: 'Experimental' },
});

/** Named events used across the Pixel Engine. */
export const PixelEvents = Object.freeze({
  GridInitialized: 'GridInitialized',
  GridResized: 'GridResized',
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
