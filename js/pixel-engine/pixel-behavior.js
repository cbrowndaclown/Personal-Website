/* Shared Pixel Behavior layer — sits between Settings (animConfig) and
   Pixel FS modes (Heat / Wave / Lightning). Soft config updates refresh the
   cache once; modes read cached values/scales and skip work when revision
   is unchanged. */

import { PixelEvents } from './constants.js';

/** Defaults match pre-settings Heat V1 / animConfig.pixelBehavior. */
export const PIXEL_BEHAVIOR_DEFAULTS = Object.freeze({
  reactionStrength: 0.4,
  movementSpeed: 0.078,
  returnSpeed: 0.026,
  trailLifetime: 0.965,
});

const BEHAVIOR_KEYS = Object.freeze([
  'reactionStrength',
  'movementSpeed',
  'returnSpeed',
  'trailLifetime',
]);

/**
 * @param {object} options
 * @param {object} options.animConfig
 * @param {import('./events.js').EventSystem} [options.events]
 */
export function createPixelBehaviorSystem(options) {
  const animConfig = options.animConfig;
  const events = options.events || null;

  /** Live snapshot — mutated in place so mode references stay valid. */
  const values = {
    reactionStrength: PIXEL_BEHAVIOR_DEFAULTS.reactionStrength,
    movementSpeed: PIXEL_BEHAVIOR_DEFAULTS.movementSpeed,
    returnSpeed: PIXEL_BEHAVIOR_DEFAULTS.returnSpeed,
    trailLifetime: PIXEL_BEHAVIOR_DEFAULTS.trailLifetime,
  };

  /** Processed ratios vs defaults (1.0 at default settings). */
  const scales = {
    reaction: 1,
    movement: 1,
    return: 1,
  };

  let _reaction = NaN;
  let _move = NaN;
  let _return = NaN;
  let _trail = NaN;
  let revision = 0;
  let lastChanged = false;

  /** @type {Set<(values: typeof values, scales: typeof scales, revision: number) => void>} */
  const listeners = new Set();

  function recomputeScales() {
    scales.reaction =
      PIXEL_BEHAVIOR_DEFAULTS.reactionStrength > 0
        ? values.reactionStrength / PIXEL_BEHAVIOR_DEFAULTS.reactionStrength
        : 1;
    scales.movement =
      PIXEL_BEHAVIOR_DEFAULTS.movementSpeed > 0
        ? values.movementSpeed / PIXEL_BEHAVIOR_DEFAULTS.movementSpeed
        : 1;
    scales.return =
      PIXEL_BEHAVIOR_DEFAULTS.returnSpeed > 0
        ? values.returnSpeed / PIXEL_BEHAVIOR_DEFAULTS.returnSpeed
        : 1;
  }

  function notify() {
    if (listeners.size === 0) return;
    listeners.forEach((fn) => {
      try {
        fn(values, scales, revision);
      } catch (err) {
        console.error('[PixelBehavior] onChange handler error', err);
      }
    });
  }

  /**
   * Pull current Settings values into the shared cache.
   * No-ops when unchanged; bumps revision + recomputes scales only when dirty.
   * @returns {typeof values}
   */
  function sync() {
    const pb = (animConfig && animConfig.pixelBehavior) || PIXEL_BEHAVIOR_DEFAULTS;
    const reaction = Number(pb.reactionStrength);
    const move = Number(pb.movementSpeed);
    const ret = Number(pb.returnSpeed);
    const trail = Number(pb.trailLifetime);
    let dirty = false;

    if (reaction !== _reaction) {
      _reaction = reaction;
      values.reactionStrength = Number.isFinite(reaction)
        ? reaction
        : PIXEL_BEHAVIOR_DEFAULTS.reactionStrength;
      dirty = true;
    }
    if (move !== _move) {
      _move = move;
      values.movementSpeed = Number.isFinite(move)
        ? move
        : PIXEL_BEHAVIOR_DEFAULTS.movementSpeed;
      dirty = true;
    }
    if (ret !== _return) {
      _return = ret;
      values.returnSpeed = Number.isFinite(ret)
        ? ret
        : PIXEL_BEHAVIOR_DEFAULTS.returnSpeed;
      dirty = true;
    }
    if (trail !== _trail) {
      _trail = trail;
      values.trailLifetime = Number.isFinite(trail)
        ? trail
        : PIXEL_BEHAVIOR_DEFAULTS.trailLifetime;
      dirty = true;
    }

    lastChanged = dirty;
    if (dirty) {
      recomputeScales();
      revision += 1;
      notify();
    }
    return values;
  }

  function get(key) {
    if (!Object.prototype.hasOwnProperty.call(PIXEL_BEHAVIOR_DEFAULTS, key)) {
      return undefined;
    }
    return values[key];
  }

  /** Shallow copy of the current snapshot (safe to stash). */
  function getSnapshot() {
    return {
      reactionStrength: values.reactionStrength,
      movementSpeed: values.movementSpeed,
      returnSpeed: values.returnSpeed,
      trailLifetime: values.trailLifetime,
    };
  }

  function getRevision() {
    return revision;
  }

  /** True if the most recent sync() mutated cached values. */
  function didChange() {
    return lastChanged;
  }

  /**
   * Subscribe to dirty updates (after revision bumps).
   * @param {(values: typeof values, scales: typeof scales, revision: number) => void} fn
   * @returns {() => void} unsubscribe
   */
  function onChange(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }

  sync();

  let unsub = null;
  if (events && typeof events.on === 'function') {
    unsub = events.on(PixelEvents.AnimConfigChange, () => {
      /* Soft publishes are behavior-only; full publishes early-out when
         pixelBehavior is unchanged. Sync once here — modes read the cache. */
      sync();
    });
  }

  function destroy() {
    if (typeof unsub === 'function') unsub();
    unsub = null;
    listeners.clear();
  }

  return {
    /** Live cache — modes keep a reference; do not mutate. */
    values,
    /** Live scales vs defaults (reaction / movement / return). */
    scales,
    defaults: PIXEL_BEHAVIOR_DEFAULTS,
    keys: BEHAVIOR_KEYS,
    sync,
    get,
    getSnapshot,
    getRevision,
    didChange,
    onChange,
    destroy,
  };
}
