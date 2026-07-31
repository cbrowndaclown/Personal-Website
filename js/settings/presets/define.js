/* Preset definition helper — future presets are data, not application logic. */

/**
 * @typedef {object} PixelPreset
 * @property {string} id — stable key used by the Preset Manager
 * @property {string} label — inspector / UI label
 * @property {string} [description]
 * @property {object} settings — animConfig-shaped values (partial OK; missing
 *   keys inherit from createSettingsTemplate via validateSettings)
 */

/**
 * Define a Pixel FS preset object. Does not register it — pass the result to
 * Preset Manager `register` / include it in BUILTIN_PRESETS.
 *
 * @param {object} spec
 * @param {string} spec.id
 * @param {string} spec.label
 * @param {string} [spec.description]
 * @param {object} [spec.settings] — partial or complete animConfig values
 * @returns {PixelPreset}
 */
export function definePreset(spec) {
  if (!spec || typeof spec.id !== 'string' || !spec.id) {
    throw new Error('[PixelFS:presets] definePreset requires a non-empty id');
  }
  if (typeof spec.label !== 'string' || !spec.label) {
    throw new Error('[PixelFS:presets] definePreset requires a label');
  }
  const settings =
    spec.settings && typeof spec.settings === 'object' && !Array.isArray(spec.settings)
      ? spec.settings
      : {};
  return {
    id: spec.id,
    label: spec.label,
    description: typeof spec.description === 'string' ? spec.description : '',
    settings,
  };
}
