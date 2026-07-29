/* Performance Manager — density, effect quality, frame pacing, adaptive scaling.
   Settings write animConfig.performance; this layer caches once per soft publish
   (revision gate). Modes read cell / quality / shouldRender without reallocating
   every frame. Defaults match pre-settings V1 (CELL=5, full quality, uncapped). */

import { CELL, PixelEvents } from './constants.js';

/** @typedef {'auto'|'30'|'60'|'120'|'unlimited'} FrameRateTarget */

/** Discrete Pixel Density levels (slider snaps to these only). */
export const PIXEL_DENSITY_MIN = 1;
export const PIXEL_DENSITY_MAX = 5;
/** Level that matches the original Pixel FS lattice (CELL). */
export const PIXEL_DENSITY_DEFAULT = 3;

export const PERFORMANCE_DEFAULTS = Object.freeze({
  /** UI 1–5 — discrete presets; 3 → CELL (current look). */
  pixelDensity: PIXEL_DENSITY_DEFAULT,
  /** UI 0–10 — 10 = full current fidelity. */
  effectQuality: 10,
  /** @type {FrameRateTarget} */
  frameRateTarget: 'auto',
  adaptivePerformance: true,
});

export const FRAME_RATE_OPTIONS = Object.freeze([
  { value: 'auto', label: 'Auto' },
  { value: '30', label: '30 FPS' },
  { value: '60', label: '60 FPS' },
  { value: '120', label: '120 FPS' },
  { value: 'unlimited', label: 'Unlimited' },
]);

const FRAME_RATE_SET = new Set(FRAME_RATE_OPTIONS.map((o) => o.value));

/**
 * Five curated cell sizes (CSS px) for density levels 1–5.
 * Adjacent steps are noticeable but mild (~0.5px). Level 3 is CELL.
 * Level 5 caps at 1.56× pixels — detail without extreme GPU cost.
 * Index 0 unused; levels are 1-based to match the UI.
 */
const DENSITY_CELL_PRESETS = Object.freeze({
  1: 6.5, /* lowest density — still readable / intentional */
  2: 5.5, /* between low and default */
  3: 5, /* default Pixel FS (CELL) */
  4: 4.5, /* between default and high */
  5: 4, /* highest controlled density (~1.56× pixels) */
});

/**
 * Clamp / snap to a valid discrete density level (1–5).
 * @param {number} value
 * @returns {number}
 */
export function normalizePixelDensity(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return PIXEL_DENSITY_DEFAULT;
  return Math.min(PIXEL_DENSITY_MAX, Math.max(PIXEL_DENSITY_MIN, n));
}

/**
 * @param {string} value
 * @returns {FrameRateTarget}
 */
export function normalizeFrameRateTarget(value) {
  const v = String(value || '');
  return FRAME_RATE_SET.has(v)
    ? /** @type {FrameRateTarget} */ (v)
    : PERFORMANCE_DEFAULTS.frameRateTarget;
}

/**
 * Discrete density level 1–5 → curated CSS cell size.
 * Level 3 returns CELL exactly (preserve current Pixel FS appearance).
 * @param {number} density
 * @returns {number}
 */
export function cellSizeFromDensity(density) {
  const d = normalizePixelDensity(density);
  if (d === PIXEL_DENSITY_DEFAULT) return CELL;
  const cell = DENSITY_CELL_PRESETS[d];
  return cell != null ? cell : CELL;
}

/**
 * @param {number} qualityUi 0–10
 * @returns {number} 0–1 fidelity scale (1 at default 10)
 */
export function qualityScaleFromUi(qualityUi) {
  const q = Math.max(0, Math.min(10, Number(qualityUi)));
  if (!Number.isFinite(q)) return 1;
  return q / 10;
}

/**
 * Resolve a numeric FPS cap, or null when uncapped (Auto / Unlimited).
 * @param {FrameRateTarget} target
 * @returns {number|null}
 */
export function fpsCapFromTarget(target) {
  const t = normalizeFrameRateTarget(target);
  if (t === 'auto' || t === 'unlimited') return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * @param {object} options
 * @param {object} options.animConfig
 * @param {import('./events.js').EventSystem} [options.events]
 * @param {{ setCellSize?: (n: number) => object, cell?: number }} [options.grid]
 */
export function createPerformanceManager(options = {}) {
  const animConfig = options.animConfig || null;
  const events = options.events || null;
  const grid = options.grid || null;

  const values = {
    pixelDensity: PERFORMANCE_DEFAULTS.pixelDensity,
    effectQuality: PERFORMANCE_DEFAULTS.effectQuality,
    frameRateTarget: PERFORMANCE_DEFAULTS.frameRateTarget,
    adaptivePerformance: PERFORMANCE_DEFAULTS.adaptivePerformance,
  };

  /** Derived — modes may keep a reference. */
  const derived = {
    cell: CELL,
    dot: Math.max(1, CELL - 2),
    /** Base quality from Effect Quality setting (0–1). */
    quality: 1,
    /** Adaptive multiplier 0.55–1; 1 when adaptive off or healthy. */
    adaptiveScale: 1,
    /** quality * adaptiveScale — what styles should read. */
    effectiveQuality: 1,
    /** FPS cap or null (uncapped). */
    fpsCap: null,
  };

  let revision = 0;
  let lastChanged = false;
  /** Density currently applied to the shared grid (drives derived.cell). */
  let _appliedDensity = NaN;
  /** Requested density from Settings while teardown/rebuild is in flight. */
  let _pendingDensity = null;
  let _density = NaN;
  let _qualityUi = NaN;
  let _frameTarget = '';
  let _adaptive = null;

  /* Frame pacing */
  let lastRenderTime = 0;
  let frameStart = 0;
  let emaFrameMs = 16.7;
  let adaptiveScale = 1;

  const ADAPTIVE_MIN = 0.55;
  const ADAPTIVE_UP = 0.012;
  const ADAPTIVE_DOWN = 0.02;
  const ADAPTIVE_SLOW_MS = 22; /* ~45 fps — start easing quality down */
  const ADAPTIVE_FAST_MS = 14; /* comfortable headroom — restore */

  /** @type {Set<(values: typeof values, derived: typeof derived, revision: number) => void>} */
  const listeners = new Set();

  function recomputeDerived() {
    /* Cell size tracks the applied lattice only — pending density must not
       resize style paint metrics mid-teardown. */
    const densityForCell = Number.isFinite(_appliedDensity)
      ? _appliedDensity
      : PERFORMANCE_DEFAULTS.pixelDensity;
    derived.cell = cellSizeFromDensity(densityForCell);
    derived.dot = Math.max(1, derived.cell - 2);
    derived.quality = qualityScaleFromUi(values.effectQuality);
    derived.adaptiveScale = values.adaptivePerformance ? adaptiveScale : 1;
    derived.effectiveQuality = Math.max(
      0,
      Math.min(1, derived.quality * derived.adaptiveScale),
    );
    derived.fpsCap = fpsCapFromTarget(values.frameRateTarget);
  }

  /**
   * @param {{ silent?: boolean }} [opts]
   * @returns {object|null} grid info when remounted, else null
   */
  function applyCellToGrid(opts) {
    if (!grid || typeof grid.setCellSize !== 'function') return null;
    if (grid.cell === derived.cell) return null;
    return grid.setCellSize(derived.cell, opts) || null;
  }

  function hasPendingDensity() {
    return _pendingDensity != null;
  }

  function getPendingDensity() {
    return _pendingDensity;
  }

  /**
   * Apply a previously deferred density remount (post-teardown rebuild).
   * Bumps revision before setCellSize so style PixelDensityChanged handlers
   * read the new cell size when they sync.
   *
   * Pass `{ silent: true }` to remount the shared grid without emitting
   * PixelDensityChanged — caller must allocate the boot field first, validate
   * coverage, then emit so styles never paint against a shorter lattice.
   *
   * @param {{ silent?: boolean }} [opts]
   * @returns {object|false} grid info when remounted, false when nothing pending
   */
  function commitPendingDensity(opts) {
    if (_pendingDensity == null) return false;
    const next = normalizePixelDensity(_pendingDensity);
    _pendingDensity = null;
    _appliedDensity = next;
    _density = next;
    values.pixelDensity = next;
    recomputeDerived();
    revision += 1;
    lastChanged = true;
    const info = applyCellToGrid(opts);
    notify();
    return info || (grid && typeof grid.getInfo === 'function' ? grid.getInfo() : true);
  }

  function notify() {
    if (listeners.size === 0) return;
    listeners.forEach((fn) => {
      try {
        fn(values, derived, revision);
      } catch (err) {
        console.error('[Performance] onChange handler error', err);
      }
    });
  }

  /**
   * Pull Settings into the cache. Bumps revision only when dirty.
   * Density changes defer grid remount — tear down the live lattice first.
   * @returns {typeof values}
   */
  function sync() {
    const src =
      (animConfig && animConfig.performance) || PERFORMANCE_DEFAULTS;
    const density = normalizePixelDensity(src.pixelDensity);
    const qualityUi = Math.max(
      0,
      Math.min(10, Math.round(Number(src.effectQuality))),
    );
    const frameTarget = normalizeFrameRateTarget(src.frameRateTarget);
    const adaptive = !!src.adaptivePerformance;
    let dirty = false;
    let densityTeardown = false;

    if (!Number.isFinite(_appliedDensity)) {
      _appliedDensity = density;
      _density = density;
      values.pixelDensity = density;
    }

    if (density !== _appliedDensity) {
      /* Already tearing down / awaiting rebuild for this target — ignore. */
      if (_pendingDensity === density) {
        values.pixelDensity = density;
      } else {
        _pendingDensity = density;
        _density = density;
        values.pixelDensity = density;
        densityTeardown = true;
        dirty = true;
      }
    } else if (_pendingDensity != null && density === _appliedDensity) {
      /* Settings reverted to the applied density before remount. */
      _pendingDensity = null;
      values.pixelDensity = density;
      dirty = true;
    }

    if (qualityUi !== _qualityUi) {
      _qualityUi = qualityUi;
      values.effectQuality = Number.isFinite(qualityUi)
        ? qualityUi
        : PERFORMANCE_DEFAULTS.effectQuality;
      dirty = true;
    }
    if (frameTarget !== _frameTarget) {
      _frameTarget = frameTarget;
      values.frameRateTarget = frameTarget;
      dirty = true;
      lastRenderTime = 0;
    }
    if (adaptive !== _adaptive) {
      _adaptive = adaptive;
      values.adaptivePerformance = adaptive;
      dirty = true;
      if (!adaptive) adaptiveScale = 1;
    }

    lastChanged = dirty;
    if (dirty) {
      recomputeDerived();
      if (densityTeardown && events) {
        events.emit(PixelEvents.PixelDensityTeardownRequest, {
          fromDensity: _appliedDensity,
          toDensity: density,
          pendingCell: cellSizeFromDensity(density),
          cols: grid && grid.cols,
          rows: grid && grid.rows,
          cell: grid && grid.cell,
        });
      } else if (!hasPendingDensity()) {
        applyCellToGrid();
      }
      revision += 1;
      notify();
    }
    return values;
  }

  function getRevision() {
    return revision;
  }

  function didChange() {
    return lastChanged;
  }

  function getCellSize() {
    return derived.cell;
  }

  function getDotSize() {
    return derived.dot;
  }

  /** Base Effect Quality scale 0–1 (ignores adaptive). */
  function getQuality() {
    return derived.quality;
  }

  /** Quality after adaptive scaling — prefer this in paint/sim loops. */
  function getEffectiveQuality() {
    return derived.effectiveQuality;
  }

  function getFpsCap() {
    return derived.fpsCap;
  }

  function isAdaptiveEnabled() {
    return values.adaptivePerformance;
  }

  /**
   * Frame gate — returns false when this rAF should skip heavy work.
   * Always returns true for Auto / Unlimited (no artificial cap).
   * @param {number} nowMs
   * @returns {boolean}
   */
  function shouldRender(nowMs) {
    const cap = derived.fpsCap;
    if (cap == null) return true;
    const minDelta = 1000 / cap;
    if (lastRenderTime > 0 && nowMs - lastRenderTime < minDelta - 0.75) {
      return false;
    }
    lastRenderTime = nowMs;
    return true;
  }

  /** Call at the start of a rendered frame (after shouldRender passes). */
  function beginFrame(nowMs) {
    frameStart = nowMs > 0 ? nowMs : 0;
  }

  /**
   * Sample frame cost and ease adaptive scale. Changes are gradual so
   * users do not notice sudden visual degradation.
   * @param {number} nowMs
   */
  function endFrame(nowMs) {
    if (!values.adaptivePerformance || !(frameStart > 0)) {
      if (derived.adaptiveScale !== (values.adaptivePerformance ? adaptiveScale : 1)) {
        recomputeDerived();
      }
      return;
    }
    const dt = Math.max(0, (nowMs || 0) - frameStart);
    if (dt <= 0) return;
    /* Exponential moving average — ignore one-frame spikes. */
    emaFrameMs = emaFrameMs * 0.88 + dt * 0.12;

    let next = adaptiveScale;
    if (emaFrameMs > ADAPTIVE_SLOW_MS) {
      next = Math.max(ADAPTIVE_MIN, adaptiveScale - ADAPTIVE_DOWN);
    } else if (emaFrameMs < ADAPTIVE_FAST_MS) {
      next = Math.min(1, adaptiveScale + ADAPTIVE_UP);
    }

    if (Math.abs(next - adaptiveScale) > 0.0005) {
      adaptiveScale = next;
      recomputeDerived();
    }
  }

  /**
   * Convenience: begin + shouldRender. Skipped frames still schedule rAF
   * but avoid beginFrame/endFrame accounting.
   * @param {number} nowMs
   * @returns {boolean}
   */
  function beginFrameIfDue(nowMs) {
    if (!shouldRender(nowMs)) return false;
    beginFrame(nowMs);
    return true;
  }

  function onChange(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }

  /* Legacy V1 stubs — monitoring enable flag (independent of adaptive). */
  let monitorEnabled = false;

  function isEnabled() {
    return monitorEnabled;
  }

  function setEnabled(on) {
    monitorEnabled = !!on;
  }

  /** @deprecated Prefer getEffectiveQuality / derived.effectiveQuality */
  function getQualityTier() {
    const q = derived.effectiveQuality;
    let tier = 'full';
    if (q < 0.35) tier = 'low';
    else if (q < 0.7) tier = 'medium';
    return {
      tier,
      cellScale: CELL > 0 ? derived.cell / CELL : 1,
      throttle: derived.fpsCap ? Math.max(1, Math.round(60 / derived.fpsCap)) : 1,
      quality: q,
    };
  }

  recomputeDerived();
  sync();

  let unsub = null;
  if (events && typeof events.on === 'function') {
    unsub = events.on(PixelEvents.AnimConfigChange, () => {
      sync();
    });
  }

  function destroy() {
    if (typeof unsub === 'function') unsub();
    unsub = null;
    listeners.clear();
    monitorEnabled = false;
  }

  return {
    values,
    derived,
    defaults: PERFORMANCE_DEFAULTS,
    sync,
    getRevision,
    didChange,
    getCellSize,
    getDotSize,
    getQuality,
    getEffectiveQuality,
    getFpsCap,
    isAdaptiveEnabled,
    shouldRender,
    beginFrame,
    endFrame,
    beginFrameIfDue,
    onChange,
    hasPendingDensity,
    getPendingDensity,
    commitPendingDensity,
    isEnabled,
    setEnabled,
    getQualityTier,
    destroy,
  };
}
