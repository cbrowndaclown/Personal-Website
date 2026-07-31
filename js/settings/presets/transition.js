/* Preset transition engine — refresh-masked apply between two settings
   snapshots after a preset is selected.

   The Pixel FS recalibration / density rebuild animation owns the transition
   lifecycle. Settings are applied only after the lattice is masked, so the
   user never sees the new preset before the refresh begins:

     Old Preset → Refresh Animation → New Preset

   Does not own presets, storage, or selection. Callers resolve the target
   preset, then run({ from, to }) so apply happens behind the refresh. */

import { PixelEvents } from '../../pixel-engine/constants.js';

/** @deprecated Morph window — retained for callers that still read the export. */
export const PRESET_TRANSITION_MS = 420;

/** Raw progress at which non-numeric fields adopt the target value (lerp helper). */
const DISCRETE_CROSSFADE_AT = 0.5;

/**
 * Keys that must not mid-lerp (grid rebuild / hard remount). Held at `from`
 * until the transition completes, then snapped to `to`.
 * @type {ReadonlySet<string>}
 */
const SNAP_AT_END_PATHS = new Set(['performance.pixelDensity']);

/**
 * @param {number} t
 * @returns {number}
 */
function clamp01(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t;
}

/**
 * Smoothstep5 — ease in/out so the morph settles naturally.
 * @param {number} t
 * @returns {number}
 */
function easeInOut(t) {
  t = clamp01(t);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * @param {unknown} v
 * @returns {boolean}
 */
function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Recursively interpolate two settings snapshots.
 * Numbers ease; plain objects recurse; everything else snaps at discreteAt.
 *
 * @param {unknown} from
 * @param {unknown} to
 * @param {number} eased — eased continuous progress
 * @param {number} rawT — linear 0–1 progress
 * @param {boolean} discreteOn — whether discrete fields have flipped
 * @param {string} path — dot path for special-case keys
 * @returns {unknown}
 */
function lerpDeep(from, to, eased, rawT, discreteOn, path) {
  if (typeof from === 'number' && typeof to === 'number') {
    if (SNAP_AT_END_PATHS.has(path)) {
      return rawT >= 1 ? to : from;
    }
    if (path === 'performance.effectQuality') {
      return Math.round(from + (to - from) * eased);
    }
    return from + (to - from) * eased;
  }

  if (isPlainObject(from) && isPlainObject(to)) {
    /** @type {Record<string, unknown>} */
    const out = {};
    const keys = Object.keys(to);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const childPath = path ? `${path}.${key}` : key;
      if (!(key in /** @type {object} */ (from))) {
        out[key] = to[key];
        continue;
      }
      out[key] = lerpDeep(
        /** @type {object} */ (from)[key],
        to[key],
        eased,
        rawT,
        discreteOn,
        childPath
      );
    }
    return out;
  }

  if (SNAP_AT_END_PATHS.has(path)) {
    return rawT >= 1 ? to : from;
  }
  return discreteOn ? to : from;
}

/**
 * Build an intermediate settings object for progress rawT ∈ [0, 1].
 * When bgMode changes, presence knobs dip through the midpoint so the style
 * swap reads as a crossfade rather than an instant personality cut.
 *
 * @param {object} from
 * @param {object} to
 * @param {number} rawT
 * @param {{ discreteAt?: number }} [opts]
 * @returns {object}
 */
export function interpolatePresetSettings(from, to, rawT, opts) {
  const t = clamp01(rawT);
  const discreteAt =
    opts && opts.discreteAt != null ? opts.discreteAt : DISCRETE_CROSSFADE_AT;
  const discreteOn = t >= discreteAt;
  const eased = easeInOut(t);

  const out = /** @type {object} */ (
    lerpDeep(from, to, eased, t, discreteOn, '')
  );

  const modeChanging =
    from &&
    to &&
    typeof from.bgMode === 'string' &&
    typeof to.bgMode === 'string' &&
    from.bgMode !== to.bgMode;

  /* Presence dip around the discrete style swap — field softens, swaps, returns. */
  if (modeChanging && t > 0 && t < 1) {
    const dip = Math.sin(Math.PI * t);
    if (typeof out.heatIntensity === 'number') {
      out.heatIntensity = Math.max(0, out.heatIntensity * (1 - 0.72 * dip));
    }
    if (
      out.pixelBehavior &&
      typeof out.pixelBehavior === 'object' &&
      typeof out.pixelBehavior.reactionStrength === 'number'
    ) {
      out.pixelBehavior.reactionStrength = Math.max(
        0,
        out.pixelBehavior.reactionStrength * (1 - 0.55 * dip)
      );
    }
  }

  /* Preset identity is selection state — always the target during a load. */
  if (to && 'activePresetId' in to) {
    out.activePresetId = to.activePresetId;
  }

  return out;
}

/**
 * Write an interpolated snapshot onto the live animConfig in place.
 * Recurses into nested objects so future numeric Pixel Behavior (and other)
 * fields land without per-key transition updates — as long as they exist on
 * the live object.
 *
 * @param {object} animConfig
 * @param {object} source
 */
export function writeSettingsInPlace(animConfig, source) {
  if (!animConfig || !source || typeof source !== 'object') return;

  const keys = Object.keys(source);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (!(key in animConfig)) continue;
    const sv = source[key];
    const tv = animConfig[key];
    if (isPlainObject(sv) && isPlainObject(tv)) {
      writeSettingsInPlace(tv, sv);
    } else {
      animConfig[key] = sv;
    }
  }
}

/**
 * @param {object} [options]
 * @param {object} options.animConfig
 * @param {(opts?: object) => void} [options.publishAnimConfig]
 * @param {() => void} [options.syncAnimDom]
 * @param {() => void} [options.beginBatch]
 * @param {() => void} [options.endBatch]
 * @param {(opts?: { densityChanging?: boolean }) => { mode: string }} [options.beginPresetRefresh]
 * @param {() => void} [options.finishPresetRefreshInstant]
 * @param {import('../../pixel-engine/events.js').EventSystem} [options.events]
 * @param {boolean} [options.prefersReduced]
 * @returns {{
 *   run: (args: object) => boolean,
 *   cancel: () => void,
 *   isActive: () => boolean,
 *   destroy: () => void,
 * }}
 */
export function createPresetTransition(options) {
  const animConfig = options && options.animConfig;
  const publishAnimConfig = options && options.publishAnimConfig;
  const syncAnimDom = options && options.syncAnimDom;
  const beginBatch = options && options.beginBatch;
  const endBatch = options && options.endBatch;
  const beginPresetRefresh = options && options.beginPresetRefresh;
  const finishPresetRefreshInstant =
    options && options.finishPresetRefreshInstant;
  const events = options && options.events;
  const prefersReduced = !!(options && options.prefersReduced);

  let active = false;
  /** @type {(() => void)|null} */
  let onComplete = null;
  /** @type {(() => void)|null} */
  let unsubEnd = null;

  function clearWait() {
    if (unsubEnd) {
      unsubEnd();
      unsubEnd = null;
    }
  }

  function finish() {
    clearWait();
    active = false;
    const cb = onComplete;
    onComplete = null;
    if (cb) cb();
  }

  function cancel() {
    clearWait();
    active = false;
    onComplete = null;
  }

  /**
   * Apply target settings onto the live animConfig (behind the refresh mask).
   * @param {object} to
   */
  function applyBehindMask(to) {
    const canBatch =
      typeof beginBatch === 'function' && typeof endBatch === 'function';

    if (canBatch) beginBatch();
    try {
      writeSettingsInPlace(animConfig, to);
      if (typeof syncAnimDom === 'function') syncAnimDom();
    } finally {
      if (canBatch) endBatch();
      else if (typeof publishAnimConfig === 'function') publishAnimConfig();
    }
  }

  /**
   * Wait until the refresh animation that owns this transition completes.
   * @param {'soft'|'density'|'instant'|'blocked'} mode
   */
  function waitForRefreshEnd(mode) {
    if (mode === 'blocked') {
      /* Startup still owns the display — settings already written silently
         by the manager; do not wait on refresh lifecycle. */
      finish();
      return;
    }

    if (mode === 'instant' || !events) {
      if (typeof finishPresetRefreshInstant === 'function') {
        finishPresetRefreshInstant();
      }
      finish();
      return;
    }

    if (mode === 'density') {
      /* Full density pipeline: teardown → rebuild sync → menu hold. */
      unsubEnd = events.on(PixelEvents.PixelDensityTransitionEnd, () => {
        finish();
      });
      return;
    }

    /* Soft same-density: sync wave end (PixelPresetRefreshEnd). */
    unsubEnd = events.on(PixelEvents.PixelPresetRefreshEnd, () => {
      finish();
    });
  }

  /**
   * Mask → apply → reveal. Refresh animation owns the lifecycle.
   *
   * @param {object} args
   * @param {object} args.from — snapshot of current live settings
   * @param {object} args.to — resolved target preset settings
   * @param {() => void} [args.onComplete]
   * @returns {boolean} true if a transition was started or applied
   */
  function run(args) {
    if (!animConfig || !args || !args.from || !args.to) return false;

    const from = args.from;
    const to = args.to;
    const complete = args.onComplete;

    cancel();
    active = true;
    onComplete = typeof complete === 'function' ? complete : null;

    const fromDensity =
      from &&
      from.performance &&
      typeof from.performance.pixelDensity === 'number'
        ? from.performance.pixelDensity
        : null;
    const toDensity =
      to &&
      to.performance &&
      typeof to.performance.pixelDensity === 'number'
        ? to.performance.pixelDensity
        : null;
    const densityChanging =
      fromDensity != null && toDensity != null && fromDensity !== toDensity;

    const reduced =
      prefersReduced ||
      (typeof window !== 'undefined' &&
        window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    /* 1. Start refresh mask immediately — old preset stays until this point. */
    let mode = 'instant';
    if (typeof beginPresetRefresh === 'function') {
      const result = beginPresetRefresh({ densityChanging });
      mode =
        result && typeof result.mode === 'string' ? result.mode : 'instant';
    }

    /* Startup blocked — do not publish / rebuild; caller used silent path. */
    if (mode === 'blocked') {
      waitForRefreshEnd(mode);
      return true;
    }

    /* Reduced motion only forces instant for same-density soft loads. */
    if (reduced && mode === 'soft') mode = 'instant';

    /* 2. Apply new preset behind the mask — never visible before refresh. */
    applyBehindMask(to);

    /* 3. Unlock when refresh completes (or immediately for reduced motion). */
    waitForRefreshEnd(mode);
    return true;
  }

  function isActive() {
    return active;
  }

  function destroy() {
    cancel();
  }

  return {
    run,
    cancel,
    isActive,
    destroy,
  };
}
