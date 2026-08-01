/* Pixel FS Preset System — core settings architecture surface. */

export { definePreset } from './define.js';
export { createSettingsTemplate } from './template.js';
export {
  BUILTIN_PRESETS,
  getBuiltinPresetOptions,
} from './builtins.js';
export {
  createPresetManager,
  resolvePresetSettings,
  PRESET_CUSTOM_ID,
} from './manager.js';

export {
  createPresetTransition,
  interpolatePresetSettings,
  writeSettingsInPlace,
  PRESET_TRANSITION_MS,
} from './transition.js';

export {
  normalizeSettingsForMatch,
  settingsMatchFingerprint,
  settingsExactlyMatch,
} from './match.js';
