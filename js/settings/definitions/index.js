/* Settings definitions — single export surface for the config-driven inspector. */

export {
  PIXEL_FS_STYLES,
  getStyleById,
  getStyleLabel,
  getStyleSegmentOptions,
} from './styles.js';

export {
  SETTINGS_CATEGORIES,
  SETTINGS,
  EMPTY_SETTINGS_MESSAGE,
  getSettingsForCategory,
  resetSettingsToDefaults,
} from './settings.js';

export {
  definePreset,
  createSettingsTemplate,
  BUILTIN_PRESETS,
  getBuiltinPresetOptions,
  createPresetManager,
  resolvePresetSettings,
  PRESET_CUSTOM_ID,
  settingsExactlyMatch,
} from '../presets/index.js';

export {
  PIXEL_UI_SCALE,
  createUiScale,
  scaledSliderSetting,
  snapToStep,
} from '../scale.js';
