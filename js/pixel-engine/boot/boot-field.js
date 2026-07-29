/* Boot field — shared SoA presence buffer for Pixel FS energy + operational rest.
   Heat / Wave / Lightning sample this same presence via the Animation Manager.
   Boot populates it in place; density rebuilds release() then allocate fresh. */

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
   * Drop every buffer and geometry reference from the previous lattice.
   * Call before allocating a new grid on Pixel Density rebuild.
   */
  function release() {
    cols = 0;
    rows = 0;
    n = 0;
    presence = null;
    brightness = null;
    ox = null;
    oy = null;
  }

  /**
   * (Re)allocate buffers. When the grid size changes, copy overlapping
   * presence so a window resize never wipes a partially generated lattice
   * back to black. Pass `{ fresh: true }` for Pixel Density rebuilds so no
   * stale presence/indices survive from the previous cell size.
   * @param {number} nextCols
   * @param {number} nextRows
   * @param {{ fresh?: boolean }} [opts]
   */
  function allocate(nextCols, nextRows, opts) {
    const c = nextCols | 0;
    const r = nextRows | 0;
    const fresh = !!(opts && opts.fresh);
    if (c === cols && r === rows && presence && !fresh) return;

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

    if (!fresh && prevPresence && prevCols > 0 && prevRows > 0 && n > 0) {
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
    release,
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
