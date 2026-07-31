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
 * @property {number} hitW — interactive band width (Pixel FS Screen 1)
 * @property {number} hitH — interactive band height (Pixel FS Screen 1)
 * @property {number} contentRows — lattice rows covering the interactive band
 * @property {DOMRect} rect
 * @property {boolean} changed — true when cols/rows changed this update
 */

/**
 * Compute lattice size that fully covers a viewport.
 *
 * Uses the raw (possibly fractional) CSS box — never Math.round-then-ceil,
 * which under-counts by a full row/column when the fractional part is in
 * (0, 0.5) and the rounded edge lands on a cell boundary.
 *
 * viewW/viewH are ceil'd so the canvas backing never sits short of the stage.
 *
 * @param {number} width
 * @param {number} height
 * @param {number} cell
 * @returns {{ cols: number, rows: number, viewW: number, viewH: number, cell: number }}
 */
export function computeGridLayout(width, height, cell) {
  const c = cell > 0 && Number.isFinite(cell) ? cell : CELL;
  const w = Math.max(0, Number(width) || 0);
  const h = Math.max(0, Number(height) || 0);
  /* Epsilon keeps exact multiples from floating one step past an integer. */
  let cols = Math.max(1, Math.ceil(w / c - 1e-9));
  let rows = Math.max(1, Math.ceil(h / c - 1e-9));
  /* Hard coverage guarantee against float dust / adverse rounding. */
  while (cols * c < w) cols += 1;
  while (rows * c < h) rows += 1;
  const viewW = Math.max(1, Math.ceil(w - 1e-9));
  const viewH = Math.max(1, Math.ceil(h - 1e-9));
  return { cols, rows, viewW, viewH, cell: c };
}

/**
 * True when the lattice completely covers the measured viewport box.
 * @param {{ cols: number, rows: number, cell: number, viewW?: number, viewH?: number }} layout
 * @param {{ width: number, height: number }} box
 * @returns {boolean}
 */
export function gridCoversViewport(layout, box) {
  if (!layout || !box) return false;
  const cell = layout.cell > 0 ? layout.cell : CELL;
  const w = Math.max(0, Number(box.width) || 0);
  const h = Math.max(0, Number(box.height) || 0);
  const cols = layout.cols | 0;
  const rows = layout.rows | 0;
  if (cols < 1 || rows < 1 || !(cell > 0)) return false;
  if (cols * cell + 1e-6 < w) return false;
  if (rows * cell + 1e-6 < h) return false;
  if (layout.viewW != null && layout.viewW + 1e-6 < w) return false;
  if (layout.viewH != null && layout.viewH + 1e-6 < h) return false;
  return true;
}

/**
 * @param {object} options
 * @param {HTMLElement} options.stage
 * @param {HTMLElement} [options.hitBounds] — interactive / content band (defaults to stage)
 * @param {import('./events.js').EventSystem} options.events
 * @param {number} [options.cell]
 * @returns {object}
 */
export function createGridManager(options) {
  const stage = options.stage;
  const hitBounds = options.hitBounds || stage;
  const events = options.events;
  let cell = options.cell != null ? options.cell : CELL;

  let cols = 0;
  let rows = 0;
  let viewW = 0;
  let viewH = 0;
  let hitW = 0;
  let hitH = 0;
  let contentRows = 0;
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

  function syncHitBounds() {
    const hit = hitBounds.getBoundingClientRect();
    hitW = Math.max(1, Math.ceil(hit.width - 1e-9));
    hitH = Math.max(1, Math.ceil(hit.height - 1e-9));
    const layout = computeGridLayout(hit.width, hit.height, cell);
    contentRows = layout.rows;
    return hit;
  }

  /**
   * Recompute grid from the stage box. Emits GridResized when dimensions change.
   * @param {{ silent?: boolean, reason?: string }} [opts]
   * @returns {GridInfo}
   */
  function measure(opts) {
    const silent = !!(opts && opts.silent);
    const reason = (opts && opts.reason) || null;
    const rect = syncStageRect();
    syncHitBounds();
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    const layout = computeGridLayout(rect.width, rect.height, cell);
    const nextCols = layout.cols;
    const nextRows = layout.rows;
    viewW = layout.viewW;
    viewH = layout.viewH;
    const changed = nextCols !== cols || nextRows !== rows;

    cols = nextCols;
    rows = nextRows;

    /** @type {GridInfo & { reason?: string|null, covers?: boolean }} */
    const info = {
      cols,
      rows,
      cell,
      viewW,
      viewH,
      hitW,
      hitH,
      contentRows,
      dpr,
      stageLeft,
      stageTop,
      rect,
      changed,
      reason,
      covers: gridCoversViewport(
        { cols, rows, cell, viewW, viewH },
        rect,
      ),
    };

    if (changed && !silent) {
      events.emit(PixelEvents.GridResized, info);
    }

    return info;
  }

  /**
   * Remeasure until the lattice covers the live stage box.
   * Call after density remounts before generation / paint begins.
   * @returns {GridInfo}
   */
  function ensureCoverage() {
    let info = measure({ silent: true, reason: 'coverage' });
    if (info.covers) return info;
    /* One forced remount of dims — clears stale cols/rows before remeasure. */
    cols = 0;
    rows = 0;
    info = measure({ silent: true, reason: 'coverage' });
    if (!info.covers) {
      const layout = computeGridLayout(
        info.rect.width,
        info.rect.height,
        cell,
      );
      cols = layout.cols;
      rows = layout.rows;
      viewW = layout.viewW;
      viewH = layout.viewH;
      syncHitBounds();
      info = {
        ...info,
        cols,
        rows,
        cell,
        viewW,
        viewH,
        hitW,
        hitH,
        contentRows,
        changed: true,
        covers: gridCoversViewport(
          { cols, rows, cell, viewW, viewH },
          info.rect,
        ),
      };
    }
    return info;
  }

  /**
   * Density control — cell size change reallocates the grid and emits
   * PixelDensityChanged so boot/styles can fully reinitialize (not soft-patch).
   * @param {number} nextCell
   * @param {{ silent?: boolean }} [opts] — silent skips GridResized + PixelDensityChanged
   *   (caller allocates the boot field first, then notifies styles).
   */
  function setCellSize(nextCell, opts) {
    const n = Math.max(1, Number(nextCell));
    if (!Number.isFinite(n) || n === cell) return getInfo();
    cell = n;
    /* Force remount of dims even when ceil(view/cell) is unchanged */
    cols = 0;
    rows = 0;
    const info = measure({ silent: true, reason: 'density' });
    info.changed = true;
    info.reason = 'density';
    if (!(opts && opts.silent)) {
      events.emit(PixelEvents.GridResized, info);
      events.emit(PixelEvents.PixelDensityChanged, info);
    }
    return info;
  }

  function getInfo() {
    syncHitBounds();
    return {
      cols,
      rows,
      cell,
      viewW,
      viewH,
      hitW,
      hitH,
      contentRows,
      dpr,
      stageLeft,
      stageTop,
      rect: stage.getBoundingClientRect(),
      changed: false,
      covers: gridCoversViewport(
        { cols, rows, cell, viewW, viewH },
        stage.getBoundingClientRect(),
      ),
    };
  }

  function start() {
    if (started) return;
    started = true;
    measure({ reason: 'init' });
    events.emit(PixelEvents.GridInitialized, getInfo());
    window.addEventListener('resize', onWindowResize, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        measure({ reason: 'observer' });
      });
      ro.observe(stage);
      if (hitBounds !== stage) ro.observe(hitBounds);
    }
  }

  function onWindowResize() {
    measure({ reason: 'resize' });
  }

  function destroy() {
    if (!started) return;
    window.removeEventListener('resize', onWindowResize);
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
    ensureCoverage,
    setCellSize,
    getInfo,
    syncStageRect,
    syncHitBounds,
    get stage() { return stage; },
    get hitBounds() { return hitBounds; },
    get cols() { return cols; },
    get rows() { return rows; },
    get cell() { return cell; },
    get viewW() { return viewW; },
    get viewH() { return viewH; },
    get hitW() { return hitW; },
    get hitH() { return hitH; },
    get contentRows() { return contentRows; },
    get dpr() { return dpr; },
    get stageLeft() { return stageLeft; },
    get stageTop() { return stageTop; },
  };
}
