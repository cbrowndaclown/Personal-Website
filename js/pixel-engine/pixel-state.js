/* Pixel State Manager — centralized per-pixel representation.
   Establishes a scalable SoA model. V1 styles may still keep private
   simulation buffers; this is the engine-level source of truth for
   shared properties future Pixel FS plugins can read/write. */

import { PixelEvents } from './constants.js';

/**
 * @param {object} options
 * @param {ReturnType<import('./grid-manager.js').createGridManager>} options.grid
 * @param {import('./events.js').EventSystem} options.events
 */
export function createPixelStateManager(options) {
  const grid = options.grid;
  const events = options.events;

  /** @type {Float32Array|null} home X in CSS px */
  let x = null;
  /** @type {Float32Array|null} home Y in CSS px */
  let y = null;
  /** @type {Float32Array|null} */
  let targetX = null;
  /** @type {Float32Array|null} */
  let targetY = null;
  /** @type {Float32Array|null} offset X (cells or px — style-defined) */
  let offsetX = null;
  /** @type {Float32Array|null} */
  let offsetY = null;
  /** @type {Float32Array|null} 0–1 brightness / energy */
  let brightness = null;
  /** @type {Float32Array|null} 0–1 opacity */
  let opacity = null;
  /** @type {Uint8Array|null} 0 inactive / 1 active */
  let active = null;
  /** @type {Float32Array|null} packed RGB as 0–1 channels (r,g,b interleaved) optional */
  let colorR = null;
  let colorG = null;
  let colorB = null;
  /** Future metadata slot — opaque per-style use */
  let meta = null;

  let count = 0;

  function allocate(cols, rows, cell) {
    const n = cols * rows;
    count = n;

    x = new Float32Array(n);
    y = new Float32Array(n);
    targetX = new Float32Array(n);
    targetY = new Float32Array(n);
    offsetX = new Float32Array(n);
    offsetY = new Float32Array(n);
    brightness = new Float32Array(n);
    opacity = new Float32Array(n);
    active = new Uint8Array(n);
    colorR = new Float32Array(n);
    colorG = new Float32Array(n);
    colorB = new Float32Array(n);
    meta = new Array(n);

    /* Seed home positions + resting visuals */
    for (let i = 0; i < n; i++) {
      const cx = i % cols;
      const cy = (i / cols) | 0;
      x[i] = cx * cell + cell * 0.5;
      y[i] = cy * cell + cell * 0.5;
      opacity[i] = 1;
      active[i] = 1;
      colorR[i] = 1;
      colorG[i] = 1;
      colorB[i] = 1;
      meta[i] = null;
    }
  }

  function clearMotion() {
    if (!count) return;
    targetX.fill(0);
    targetY.fill(0);
    offsetX.fill(0);
    offsetY.fill(0);
    brightness.fill(0);
  }

  function onGridResized(info) {
    if (!info || !info.changed) return;
    allocate(info.cols, info.rows, info.cell);
  }

  const unsub = events.on(PixelEvents.GridResized, onGridResized);
  events.on(PixelEvents.GridInitialized, (info) => {
    allocate(info.cols, info.rows, info.cell);
  });

  function getBuffers() {
    return {
      count,
      x,
      y,
      targetX,
      targetY,
      offsetX,
      offsetY,
      brightness,
      opacity,
      active,
      colorR,
      colorG,
      colorB,
      meta,
    };
  }

  function indexAt(col, row) {
    const cols = grid.cols;
    if (col < 0 || row < 0 || col >= cols || row >= grid.rows) return -1;
    return row * cols + col;
  }

  function destroy() {
    unsub();
    x = y = targetX = targetY = offsetX = offsetY = null;
    brightness = opacity = active = null;
    colorR = colorG = colorB = null;
    meta = null;
    count = 0;
  }

  return {
    allocate,
    clearMotion,
    getBuffers,
    indexAt,
    destroy,
    get count() { return count; },
  };
}
