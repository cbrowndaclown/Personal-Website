/* Cursor Mode — interaction modifiers layered on top of Pixel FS styles.
   Modes never own a rAF loop; Heat / Wave / Lightning apply the active
   modifier inside their existing cursor pipelines. Soft config publishes
   refresh the cache once (same revision pattern as Pixel Behavior). */

import { PixelEvents } from './constants.js';

/** @typedef {'standard'|'attract'|'repel'|'disturb'|'freeze'} CursorModeId */

export const CURSOR_MODE = Object.freeze({
  STANDARD: 'standard',
  ATTRACT: 'attract',
  REPEL: 'repel',
  DISTURB: 'disturb',
  FREEZE: 'freeze',
});

export const CURSOR_MODE_DEFAULT = CURSOR_MODE.STANDARD;

export const CURSOR_MODE_OPTIONS = Object.freeze([
  { value: CURSOR_MODE.STANDARD, label: 'Standard' },
  { value: CURSOR_MODE.ATTRACT, label: 'Attract' },
  { value: CURSOR_MODE.REPEL, label: 'Repel' },
  { value: CURSOR_MODE.DISTURB, label: 'Disturb' },
  { value: CURSOR_MODE.FREEZE, label: 'Freeze' },
]);

const MODE_SET = new Set(Object.values(CURSOR_MODE));

/**
 * @param {string} value
 * @returns {CursorModeId}
 */
export function normalizeCursorMode(value) {
  const v = String(value || '');
  return MODE_SET.has(v) ? /** @type {CursorModeId} */ (v) : CURSOR_MODE_DEFAULT;
}

/** Cheap deterministic noise in [0, 1) — no per-cell Math.random. */
function hashNoise(seed) {
  const n = Math.sin(seed * 12.9898) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * Shared force modifier for radial cursor fields (Heat springs).
 * `fx/fy` are the style's native outward radial force from the cursor trail.
 * Mutates and returns `out` to avoid GC.
 *
 * @param {CursorModeId} mode
 * @param {object} input
 * @param {number} input.fx
 * @param {number} input.fy
 * @param {number} input.push — displacement magnitude already scaled by Pixel Behavior
 * @param {number} input.blend — influence 0–1
 * @param {number} input.cellIndex
 * @param {number} input.timeMs
 * @param {number} input.maxDisp
 * @param {{ targetX: number, targetY: number, motion: boolean, heatHold: number }} out
 */
export function applyHeatCursorMode(mode, input, out) {
  const fx = input.fx;
  const fy = input.fy;
  const push = input.push;
  const blend = input.blend;
  const mag = Math.hypot(fx, fy);

  out.targetX = 0;
  out.targetY = 0;
  out.motion = true;
  out.heatHold = 1;

  if (blend < 0.001 || push < 0.0001) {
    return out;
  }

  const ux = mag > 0.0001 ? fx / mag : 0;
  const uy = mag > 0.0001 ? fy / mag : 0;

  switch (mode) {
    case CURSOR_MODE.ATTRACT: {
      /* Inward pull — negate the native outward radial */
      out.targetX = -ux * push;
      out.targetY = -uy * push;
      break;
    }
    case CURSOR_MODE.REPEL: {
      out.targetX = ux * push;
      out.targetY = uy * push;
      break;
    }
    case CURSOR_MODE.DISTURB: {
      /* Localized unstable energy — tiny radial + tangential jitter, no wave */
      const t = input.timeMs * 0.0017;
      const n1 = hashNoise(input.cellIndex * 0.173 + t) * 2 - 1;
      const n2 = hashNoise(input.cellIndex * 0.419 + t * 1.3) * 2 - 1;
      const n3 = hashNoise(input.cellIndex * 0.791 + t * 0.7) * 2 - 1;
      const amp = input.maxDisp * blend * 0.55;
      const tx = -uy;
      const ty = ux;
      out.targetX = ux * push * 0.12 + (tx * n1 + ux * n2) * amp;
      out.targetY = uy * push * 0.12 + (ty * n1 + uy * n3) * amp;
      break;
    }
    case CURSOR_MODE.FREEZE: {
      /* Hold at rest while under influence — springs ease home via Decay Speed */
      out.targetX = 0;
      out.targetY = 0;
      out.motion = true;
      break;
    }
    case CURSOR_MODE.STANDARD:
    default: {
      /* Native Heat outward push — unchanged default experience */
      out.targetX = ux * push;
      out.targetY = uy * push;
      break;
    }
  }

  return out;
}

/**
 * Wave inject / field flags for the active Cursor Mode.
 * Styles apply these inside injectAt + tick — no separate loop.
 * @param {CursorModeId} mode
 * @returns {{
 *   sign: number,
 *   radial: number,
 *   radialAmp: number,
 *   jitter: number,
 *   turbulence: number,
 *   skip: boolean,
 *   dampScale: number,
 *   freezeHold: boolean,
 *   paintTrail: boolean
 * }}
 */
export function waveCursorInject(mode) {
  switch (mode) {
    case CURSOR_MODE.ATTRACT:
      return {
        sign: 0.35,
        radial: -1,
        radialAmp: 1.15,
        jitter: 0,
        turbulence: 0,
        skip: false,
        dampScale: 1,
        freezeHold: false,
        paintTrail: false,
      };
    case CURSOR_MODE.REPEL:
      return {
        sign: 0.45,
        radial: 1,
        radialAmp: 1.2,
        jitter: 0,
        turbulence: 0,
        skip: false,
        dampScale: 1,
        freezeHold: false,
        paintTrail: false,
      };
    case CURSOR_MODE.DISTURB:
      return {
        sign: 0.25,
        radial: 0,
        radialAmp: 0,
        jitter: 1.1,
        turbulence: 1,
        skip: false,
        dampScale: 1.05,
        freezeHold: false,
        paintTrail: false,
      };
    case CURSOR_MODE.FREEZE:
      return {
        sign: 0,
        radial: 0,
        radialAmp: 0,
        jitter: 0,
        turbulence: 0,
        skip: true,
        dampScale: 1.2,
        freezeHold: true,
        paintTrail: false,
      };
    case CURSOR_MODE.STANDARD:
    default:
      return {
        sign: 1,
        radial: 0,
        radialAmp: 0,
        jitter: 0,
        turbulence: 0,
        skip: false,
        dampScale: 1,
        freezeHold: false,
        paintTrail: false,
      };
  }
}

/**
 * Lightning cursor-field + strike bias for the active Cursor Mode.
 * @param {CursorModeId} mode
 * @returns {{
 *   pull: number,
 *   scatter: number,
 *   freeze: boolean,
 *   rainPush: number,
 *   fieldGlow: number,
 *   fieldIllum: number,
 *   spark: number,
 *   paintTrail: boolean,
 *   freezeField: boolean
 * }}
 */
export function lightningCursorBias(mode) {
  switch (mode) {
    case CURSOR_MODE.ATTRACT:
      return {
        pull: 1.55,
        scatter: 0.7,
        freeze: false,
        rainPush: -1.1,
        fieldGlow: 0.55,
        fieldIllum: 0.7,
        spark: 0,
        paintTrail: false,
        freezeField: false,
      };
    case CURSOR_MODE.REPEL:
      return {
        pull: -0.85,
        scatter: 1.45,
        freeze: false,
        rainPush: 1.25,
        fieldGlow: 0.4,
        fieldIllum: 0.35,
        spark: 0,
        paintTrail: false,
        freezeField: false,
      };
    case CURSOR_MODE.DISTURB:
      return {
        pull: 0.25,
        scatter: 2.1,
        freeze: false,
        rainPush: 0.35,
        fieldGlow: 0.75,
        fieldIllum: 0.45,
        spark: 1,
        paintTrail: false,
        freezeField: false,
      };
    case CURSOR_MODE.FREEZE:
      return {
        pull: 0,
        scatter: 0.9,
        freeze: true,
        rainPush: 0,
        fieldGlow: 0.2,
        fieldIllum: 0.55,
        spark: 0,
        paintTrail: false,
        freezeField: true,
      };
    case CURSOR_MODE.STANDARD:
    default:
      return {
        pull: 1,
        scatter: 1,
        freeze: false,
        rainPush: 0,
        fieldGlow: 0,
        fieldIllum: 0,
        spark: 0,
        paintTrail: false,
        freezeField: false,
      };
  }
}

/**
 * @param {object} options
 * @param {object} options.animConfig
 * @param {import('./events.js').EventSystem} [options.events]
 */
export function createCursorModeSystem(options) {
  const animConfig = options.animConfig;
  const events = options.events || null;

  /** @type {CursorModeId} */
  let mode = CURSOR_MODE_DEFAULT;
  let revision = 0;
  let lastChanged = false;

  /** @type {Set<(mode: CursorModeId, revision: number) => void>} */
  const listeners = new Set();

  function notify() {
    if (listeners.size === 0) return;
    listeners.forEach((fn) => {
      try {
        fn(mode, revision);
      } catch (err) {
        console.error('[CursorMode] onChange handler error', err);
      }
    });
  }

  function sync() {
    const next = normalizeCursorMode(
      animConfig && animConfig.cursorMode
    );
    lastChanged = next !== mode;
    if (lastChanged) {
      mode = next;
      revision += 1;
      notify();
    }
    return mode;
  }

  function get() {
    return mode;
  }

  function getRevision() {
    return revision;
  }

  function didChange() {
    return lastChanged;
  }

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
      sync();
    });
  }

  function destroy() {
    if (typeof unsub === 'function') unsub();
    unsub = null;
    listeners.clear();
  }

  return {
    modes: CURSOR_MODE,
    defaults: CURSOR_MODE_DEFAULT,
    options: CURSOR_MODE_OPTIONS,
    sync,
    get,
    getRevision,
    didChange,
    onChange,
    destroy,
    /* Pure helpers — styles call these with the cached mode */
    applyHeatCursorMode,
    waveCursorInject,
    lightningCursorBias,
  };
}
