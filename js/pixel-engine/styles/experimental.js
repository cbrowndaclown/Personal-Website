/* Pixel FS — Experimental placeholder plugin (not implemented). */

/**
 * @param {object} [_deps]
 */
export function createExperimentalStyle(_deps) {
  return {
    id: 'experimental',
    implemented: false,
    mount() {},
    destroy() {},
    setEnabled() {},
    isEnabled() {
      return false;
    },
  };
}
