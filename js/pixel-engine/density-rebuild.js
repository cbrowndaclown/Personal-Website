/* Pixel Density rebuild — full Pixel FS reinitialization.

   Changing density creates an entirely new display. After teardown finishes,
   nothing from the previous grid survives except the user's settings.

   Pipeline order (each stage depends only on the newly created grid):

     1. Destroy previous grid   (release BootField, menu maps, sim hooks)
     2. Create new grid         (commit density + ensureCoverage + authority)
     3. Initialize simulation   (styles remount from the new GridInfo)
     4. Rasterize menu          (bake LED map on the new grid; keep locked)
     5. Generate rebuild anim   (center-out sync on the new inactive lattice)
     6. Begin interaction       (reveal menu + unlock — after sync settles)

   The frozen authority snapshot is the only lattice description consumers
   may read during a density transition. */

import { PixelEvents } from './constants.js';
import { computeGridLayout, gridCoversViewport } from './grid-manager.js';

/**
 * Freeze a complete lattice description. Callers must not mutate.
 * @param {object} info
 * @returns {Readonly<{
 *   cols: number,
 *   rows: number,
 *   cell: number,
 *   viewW: number,
 *   viewH: number,
 *   dpr: number,
 *   n: number,
 *   covers: boolean,
 *   changed: boolean,
 *   reason: string,
 * }>}
 */
export function snapshotGridAuthority(info) {
  const cols = (info && info.cols) | 0;
  const rows = (info && info.rows) | 0;
  const cell = info && info.cell > 0 ? Number(info.cell) : 0;
  const viewW =
    info && info.viewW > 0 ? info.viewW | 0 : Math.ceil(cols * cell);
  const viewH =
    info && info.viewH > 0 ? info.viewH | 0 : Math.ceil(rows * cell);
  const dpr =
    info && info.dpr > 0
      ? Number(info.dpr)
      : Math.min(
          (typeof window !== 'undefined' && window.devicePixelRatio) || 1,
          2,
        );
  return Object.freeze({
    cols,
    rows,
    cell,
    viewW,
    viewH,
    dpr,
    n: Math.max(0, cols * rows),
    covers: !!(info && info.covers),
    changed: true,
    reason: 'density',
  });
}

/**
 * True when the layout is a complete, coverable lattice.
 * @param {ReturnType<typeof snapshotGridAuthority>} authority
 * @param {{ width: number, height: number }|null} [box]
 * @returns {boolean}
 */
export function validateGridAuthority(authority, box) {
  if (!authority) return false;
  if (!(authority.cols >= 1) || !(authority.rows >= 1)) return false;
  if (!(authority.cell > 0)) return false;
  if (authority.n !== authority.cols * authority.rows) return false;
  if (box) {
    if (
      !gridCoversViewport(
        {
          cols: authority.cols,
          rows: authority.rows,
          cell: authority.cell,
          viewW: authority.viewW,
          viewH: authority.viewH,
        },
        box,
      )
    ) {
      return false;
    }
  } else if (authority.covers === false) {
    return false;
  }
  return true;
}

/**
 * BootField must match the authority exactly — no short presence buffer.
 * @param {object} field
 * @param {ReturnType<typeof snapshotGridAuthority>} authority
 * @returns {boolean}
 */
export function fieldMatchesAuthority(field, authority) {
  if (!field || !authority) return false;
  if ((field.cols | 0) !== authority.cols) return false;
  if ((field.rows | 0) !== authority.rows) return false;
  const size =
    typeof field.size === 'number'
      ? field.size
      : field.presence
        ? field.presence.length
        : -1;
  return size === authority.n;
}

/**
 * @param {object} options
 * @param {ReturnType<import('./grid-manager.js').createGridManager>} options.grid
 * @param {ReturnType<import('./performance-manager.js').createPerformanceManager>} options.performance
 * @param {import('./events.js').EventSystem} options.events
 * @param {object} options.bootController
 * @param {object} options.introController
 */
export function createDensityRebuildPipeline(options) {
  const grid = options.grid;
  const performance = options.performance;
  const events = options.events;
  const boot = options.bootController;
  const intro = options.introController;

  /** @type {ReturnType<typeof snapshotGridAuthority>|null} */
  let authority = null;
  let running = false;

  function getAuthority() {
    return authority;
  }

  function clearAuthority() {
    authority = null;
    running = false;
  }

  function resolveStageBox(info) {
    if (info && info.rect) {
      return { width: info.rect.width, height: info.rect.height };
    }
    if (grid && typeof grid.getInfo === 'function') {
      const g = grid.getInfo();
      if (g && g.rect) return { width: g.rect.width, height: g.rect.height };
    }
    return null;
  }

  function forceAuthorityFromStage(fallbackCell) {
    const cell =
      grid && grid.cell > 0
        ? grid.cell
        : fallbackCell > 0
          ? fallbackCell
          : 5;
    const stage =
      typeof document !== 'undefined'
        ? document.getElementById('stage')
        : null;
    if (!stage || !(cell > 0)) return null;
    const rect = stage.getBoundingClientRect();
    const layout = computeGridLayout(rect.width, rect.height, cell);
    return snapshotGridAuthority({
      ...layout,
      dpr: Math.min(window.devicePixelRatio || 1, 2),
      covers: true,
    });
  }

  /**
   * Stages 1–5 after teardown ends. Stage 6 (interaction) runs after the
   * rebuild animation settles via beginInteractionFromAuthority.
   * @returns {ReturnType<typeof snapshotGridAuthority>|null}
   */
  function runAfterTeardown() {
    if (
      !performance ||
      typeof performance.commitPendingDensity !== 'function'
    ) {
      return null;
    }

    running = true;

    /* ── 1. Destroy previous grid ─────────────────────────────────────── */
    if (typeof boot.destroyPreviousGrid === 'function') {
      boot.destroyPreviousGrid();
    }

    /* ── 2. Create new grid ───────────────────────────────────────────── */
    const committed = performance.commitPendingDensity({ silent: true });
    if (committed === false) {
      clearAuthority();
      return null;
    }

    let info =
      typeof grid.ensureCoverage === 'function'
        ? grid.ensureCoverage()
        : typeof grid.getInfo === 'function'
          ? grid.getInfo()
          : committed;

    const box = resolveStageBox(info);
    authority = snapshotGridAuthority(info);

    if (!validateGridAuthority(authority, box)) {
      if (typeof grid.ensureCoverage === 'function') {
        info = grid.ensureCoverage();
        authority = snapshotGridAuthority(info);
      }
      if (!validateGridAuthority(authority, box)) {
        const forced = forceAuthorityFromStage(authority && authority.cell);
        if (forced) authority = forced;
      }
    }

    if (!validateGridAuthority(authority, null)) {
      console.warn(
        '[DensityRebuild] abort — invalid grid authority',
        authority,
      );
      clearAuthority();
      return null;
    }

    if (typeof boot.setDensityAuthority === 'function') {
      boot.setDensityAuthority(authority);
    }

    if (typeof boot.createGridFromAuthority === 'function') {
      boot.createGridFromAuthority(authority);
    } else if (typeof boot.beginDensityGeneration === 'function') {
      /* Legacy path — allocate + anim together; still emit sim after. */
      boot.beginDensityGeneration(authority);
    }

    if (boot.field && !fieldMatchesAuthority(boot.field, authority)) {
      console.warn('[DensityRebuild] BootField mismatch after create', {
        fieldCols: boot.field.cols,
        fieldRows: boot.field.rows,
        fieldSize: boot.field.size,
        authority,
      });
    }

    /* ── 3. Initialize simulation (new buffers only) ──────────────────── */
    events.emit(PixelEvents.PixelDensityChanged, authority);
    events.emit(PixelEvents.GridResized, {
      ...authority,
      changed: true,
      reason: 'density',
    });

    /* ── 4. Rasterize menu on the new grid (locked until stage 6) ──────── */
    if (typeof intro.rasterizeMenuForGrid === 'function') {
      intro.rasterizeMenuForGrid(authority, { densityRebuild: true });
    } else if (typeof intro.adoptGrid === 'function') {
      intro.adoptGrid(authority);
    }

    /* ── 5. Generate rebuild animation on the new grid ────────────────── */
    if (typeof boot.beginRebuildAnimation === 'function') {
      boot.beginRebuildAnimation(authority);
    }

    return authority;
  }

  /**
   * Stage 6 — reveal the pre-rasterized menu and resume interaction.
   * Called by boot after the sync lattice settles.
   * @param {{ instant?: boolean }} [opts]
   * @returns {boolean}
   */
  function beginInteractionFromAuthority(opts) {
    opts = opts || {};
    const gridInfo = authority;
    if (!gridInfo || !validateGridAuthority(gridInfo, null)) {
      return false;
    }
    if (typeof intro.revealMenuAfterRebuild === 'function') {
      intro.revealMenuAfterRebuild(gridInfo, {
        fromDensityRebuild: true,
        instant: !!opts.instant,
      });
      return true;
    }
    /* Fallback: full menu rebuild if reveal API is missing. */
    if (typeof intro.rebuildMenuForGrid === 'function') {
      intro.rebuildMenuForGrid(gridInfo, {
        fromDensityRebuild: true,
        instant: !!opts.instant,
      });
      return true;
    }
    if (typeof intro.beginDirectorySequence === 'function') {
      intro.beginDirectorySequence({
        fromDensityRebuild: true,
        instant: !!opts.instant,
        grid: gridInfo,
      });
      return true;
    }
    return false;
  }

  /** @deprecated Prefer beginInteractionFromAuthority */
  function rebuildMenuFromAuthority(opts) {
    return beginInteractionFromAuthority(opts);
  }

  function isRunning() {
    return running;
  }

  function markComplete() {
    running = false;
    /* Drop authority so the next rebuild cannot read a stale snapshot. */
    authority = null;
    if (typeof boot.setDensityAuthority === 'function') {
      boot.setDensityAuthority(null);
    }
  }

  return {
    runAfterTeardown,
    beginInteractionFromAuthority,
    rebuildMenuFromAuthority,
    getAuthority,
    clearAuthority,
    markComplete,
    isRunning,
    snapshotGridAuthority,
    validateGridAuthority,
    fieldMatchesAuthority,
  };
}
