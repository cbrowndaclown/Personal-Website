/* Grid Manager — dimensions, resize, density hook points.
   Does not render or animate; exposes grid info to the rest of the engine. */

import { CELL, PixelEvents } from './constants.js';

/**
 * @typedef {object} GridInfo
 * @property {number} cols
 * @property {number} rows
 * @property {number} cell
 * @property {number} viewW
 * @property {number} viewH
 * @property {number} dpr
 * @property {number} stageLeft
 * @property {number} stageTop
 * @property {DOMRect} rect
 * @property {boolean} changed — true when cols/rows changed this update
 */

/**
 * @param {object} options
 * @param {HTMLElement} options.stage
 * @param {import('./events.js').EventSystem} options.events
 * @param {number} [options.cell]
 * @returns {object}
 */
export function createGridManager(options) {
  const stage = options.stage;
  const events = options.events;
  let cell = options.cell != null ? options.cell : CELL;

  let cols = 0;
  let rows = 0;
  let viewW = 0;
  let viewH = 0;
  let dpr = 1;
  let stageLeft = 0;
  let stageTop = 0;
  let started = false;
  /** @type {ResizeObserver|null} */
  let ro = null;

  function syncStageRect() {
    const rect = stage.getBoundingClientRect();
    stageLeft = rect.left;
    stageTop = rect.top;
    return rect;
  }

  /**
   * Recompute grid from the stage box. Emits GridResized when dimensions change.
   * @returns {GridInfo}
   */
  function measure() {
    const rect = syncStageRect();
    viewW = Math.max(1, Math.round(rect.width));
    viewH = Math.max(1, Math.round(rect.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    const nextCols = Math.ceil(viewW / cell);
    const nextRows = Math.ceil(viewH / cell);
    const changed = nextCols !== cols || nextRows !== rows;

    cols = nextCols;
    rows = nextRows;

    /** @type {GridInfo} */
    const info = {
      cols,
      rows,
      cell,
      viewW,
      viewH,
      dpr,
      stageLeft,
      stageTop,
      rect,
      changed,
    };

    if (changed) {
      events.emit(PixelEvents.GridResized, info);
    }

    return info;
  }

  /**
   * Future density control — cell size change reallocates the grid.
   * @param {number} nextCell
   */
  function setCellSize(nextCell) {
    const n = Math.max(1, nextCell | 0);
    if (n === cell) return getInfo();
    cell = n;
    /* Force changed=true path by clearing dims */
    cols = 0;
    rows = 0;
    return measure();
  }

  function getInfo() {
    return {
      cols,
      rows,
      cell,
      viewW,
      viewH,
      dpr,
      stageLeft,
      stageTop,
      rect: stage.getBoundingClientRect(),
      changed: false,
    };
  }

  function start() {
    if (started) return getInfo();
    started = true;

    const info = measure();
    events.emit(PixelEvents.GridInitialized, info);

    window.addEventListener('resize', measure, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => measure());
      ro.observe(stage);
    }

    return info;
  }

  function destroy() {
    window.removeEventListener('resize', measure);
    if (ro) {
      ro.disconnect();
      ro = null;
    }
    started = false;
  }

  return {
    start,
    destroy,
    measure,
    syncStageRect,
    setCellSize,
    getInfo,
    get cols() { return cols; },
    get rows() { return rows; },
    get cell() { return cell; },
    get viewW() { return viewW; },
    get viewH() { return viewH; },
    get dpr() { return dpr; },
    get stageLeft() { return stageLeft; },
    get stageTop() { return stageTop; },
  };
}
