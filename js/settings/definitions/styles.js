/* Pixel FS style registry — UI labels + availability.
   Runtime engines stay in main.js (PIXEL_FIELD_STYLES); this drives the inspector. */

/**
 * @typedef {object} PixelFsStyleDef
 * @property {string} id — matches animConfig.bgMode / engine keys
 * @property {string} label — display name in Style control + style settings header
 * @property {boolean} [disabled] — shown as unavailable placeholder in Style control
 * @property {boolean} [implemented]
 */

/** @type {PixelFsStyleDef[]} */
export const PIXEL_FS_STYLES = [
  { id: 'heat', label: 'Magnetic', implemented: true },
  { id: 'wave', label: 'Wave', implemented: true },
  { id: 'lightning', label: 'Lightning', implemented: true },
  { id: 'experimental', label: 'Experimental', implemented: false, disabled: true },
];

/**
 * @param {string} id
 * @returns {PixelFsStyleDef|undefined}
 */
export function getStyleById(id) {
  return PIXEL_FS_STYLES.find((s) => s.id === id);
}

/**
 * @param {string} id
 * @returns {string}
 */
export function getStyleLabel(id) {
  const style = getStyleById(id);
  return style ? style.label : id;
}

/**
 * Options for the Style segmented control (value/label/disabled).
 * @returns {Array<{ value: string, label: string, disabled?: boolean }>}
 */
export function getStyleSegmentOptions() {
  return PIXEL_FS_STYLES.map((s) => ({
    value: s.id,
    label: s.label,
    disabled: !!s.disabled,
  }));
}
