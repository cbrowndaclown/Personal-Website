/* Boot field — shared SoA presence buffer for Pixel FS energy + operational rest.
   Heat / Wave / Lightning sample this same presence via the Animation Manager.
   Boot populates it in place; later phases must not swap to a different lattice. */

/**
 * @returns {object}
 */
export function createBootField() {
  let cols = 0;
  let rows = 0;
  let n = 0;

  /** @type {Float32Array|null} 0..1 grid cell visibility / energy */
  let presence = null;
  /** @type {Float32Array|null} 0..1 accent / flicker contribution */
  let brightness = null;
  /** @type {Float32Array|null} */
  let ox = null;
  /** @type {Float32Array|null} */
  let oy = null;

  /**
   * (Re)allocate buffers. When the grid size changes, copy overlapping
   * presence so a resize never wipes a partially or fully generated lattice
   * back to black.
   */
  function allocate(nextCols, nextRows) {
    const c = nextCols | 0;
    const r = nextRows | 0;
    if (c === cols && r === rows && presence) return;

    const prevPresence = presence;
    const prevBright = brightness;
    const prevCols = cols;
    const prevRows = rows;

    cols = c;
    rows = r;
    n = Math.max(0, cols * rows);
    presence = new Float32Array(n);
    brightness = new Float32Array(n);
    ox = new Float32Array(n);
    oy = new Float32Array(n);

    if (prevPresence && prevCols > 0 && prevRows > 0 && n > 0) {
      const copyCols = Math.min(prevCols, cols);
      const copyRows = Math.min(prevRows, rows);
      for (let y = 0; y < copyRows; y++) {
        const srcRow = y * prevCols;
        const dstRow = y * cols;
        for (let x = 0; x < copyCols; x++) {
          presence[dstRow + x] = prevPresence[srcRow + x];
          if (prevBright) brightness[dstRow + x] = prevBright[srcRow + x];
        }
      }
    }
  }

  function clear() {
    if (!presence) return;
    presence.fill(0);
    brightness.fill(0);
    ox.fill(0);
    oy.fill(0);
  }

  function fillPresence(value) {
    if (!presence) return;
    presence.fill(value);
  }

  function clearMotion() {
    if (!ox) return;
    ox.fill(0);
    oy.fill(0);
  }

  function clearBrightness() {
    if (!brightness) return;
    brightness.fill(0);
  }

  function getPresence(i) {
    return presence ? presence[i] || 0 : 0;
  }

  function getBrightness(i) {
    return brightness ? brightness[i] || 0 : 0;
  }

  function getOffsetX(i) {
    return ox ? ox[i] || 0 : 0;
  }

  function getOffsetY(i) {
    return oy ? oy[i] || 0 : 0;
  }

  return {
    allocate,
    clear,
    fillPresence,
    clearMotion,
    clearBrightness,
    getPresence,
    getBrightness,
    getOffsetX,
    getOffsetY,
    get cols() { return cols; },
    get rows() { return rows; },
    get size() { return n; },
    get presence() { return presence; },
    get brightness() { return brightness; },
    get ox() { return ox; },
    get oy() { return oy; },
  };
}
