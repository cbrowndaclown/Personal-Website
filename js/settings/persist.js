/* Settings persistence — save + restore the complete animConfig object.

   Save path: AnimConfigChange → debounced localStorage write.
   Restore path: load → validate → apply (wired before Pixel FS init).

   Live simulation still updates immediately; localStorage writes are debounced
   so continuous controls (sliders / RGB) do not thrash storage mid-drag. */

import { PIXEL_FIELD_STYLES, PixelEvents } from '../pixel-engine/constants.js';
import { normalizeCursorMode } from '../pixel-engine/cursor-mode.js';
import {
  normalizeFrameRateTarget,
  normalizePixelDensity,
} from '../pixel-engine/performance-manager.js';

/** @type {string} */
export const SETTINGS_STORAGE_KEY = 'pixel-fs-settings';

/** Pause after last change before writing (ms). */
const PERSIST_DEBOUNCE_MS = 250;

/** Pixel Behavior clamp ranges — must match config.js setters. */
const PIXEL_BEHAVIOR_RANGES = Object.freeze({
  reactionStrength: { min: 0, max: 0.8 },
  movementSpeed: { min: 0.005, max: 0.2 },
  decaySpeed: { min: 0.001, max: 0.1 },
  trailLifetime: { min: 0.85, max: 0.995 },
});

/**
 * Deep-clone the live settings object for storage.
 * Cloning the whole animConfig means future knobs persist automatically.
 * @param {object} animConfig
 * @returns {object}
 */
export function snapshotSettings(animConfig) {
  if (typeof structuredClone === 'function') {
    return structuredClone(animConfig);
  }
  return JSON.parse(JSON.stringify(animConfig));
}

/**
 * Persist the complete centralized settings object.
 * @param {object} animConfig
 * @returns {boolean} true if the write succeeded
 */
export function saveSettings(animConfig) {
  if (!animConfig || typeof animConfig !== 'object') return false;
  try {
    const snapshot = snapshotSettings(animConfig);
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(snapshot));
    return true;
  } catch (err) {
    /* Quota / private mode / disabled storage — fail silently. */
    console.warn('[PixelFS:settings] persist failed', err);
    return false;
  }
}

/**
 * Read the last saved settings snapshot (if any).
 * @returns {object|null}
 */
export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn('[PixelFS:settings] load failed', err);
    return null;
  }
}

/**
 * @param {unknown} n
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clampNum(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

/**
 * @param {unknown} n
 * @param {number} fallback
 * @returns {number}
 */
function clampByte(n, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(255, v | 0));
}

/**
 * Validate a stored snapshot against the live defaults template.
 * Known keys are coerced/clamped; unknown keys are dropped; invalid values
 * fall back to the matching default. Always returns a full settings object.
 *
 * @param {object|null|undefined} saved
 * @param {object} defaults — current animConfig shape (defaults before apply)
 * @returns {object|null} validated snapshot, or null if input is unusable
 */
export function validateSettings(saved, defaults) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return null;
  if (!defaults || typeof defaults !== 'object') return null;

  const out = snapshotSettings(defaults);

  if ('motion' in saved) out.motion = !!saved.motion;

  if (typeof saved.bgMode === 'string' &&
      Object.prototype.hasOwnProperty.call(PIXEL_FIELD_STYLES, saved.bgMode)) {
    out.bgMode = saved.bgMode;
  }

  if (
    typeof saved.lastImplementedBgMode === 'string' &&
    Object.prototype.hasOwnProperty.call(
      PIXEL_FIELD_STYLES,
      saved.lastImplementedBgMode
    ) &&
    PIXEL_FIELD_STYLES[saved.lastImplementedBgMode].implemented
  ) {
    out.lastImplementedBgMode = saved.lastImplementedBgMode;
  } else if (
    PIXEL_FIELD_STYLES[out.bgMode] &&
    PIXEL_FIELD_STYLES[out.bgMode].implemented
  ) {
    out.lastImplementedBgMode = out.bgMode;
  }

  if (saved.effectColor && typeof saved.effectColor === 'object') {
    out.effectColor.r = clampByte(saved.effectColor.r, out.effectColor.r);
    out.effectColor.g = clampByte(saved.effectColor.g, out.effectColor.g);
    out.effectColor.b = clampByte(saved.effectColor.b, out.effectColor.b);
  }

  if ('heatEnabled' in saved) out.heatEnabled = !!saved.heatEnabled;
  if ('heatIntensity' in saved) {
    out.heatIntensity = clampNum(saved.heatIntensity, 0, 1, out.heatIntensity);
  }
  if ('heatRadius' in saved) {
    out.heatRadius = clampNum(saved.heatRadius, 1, 30, out.heatRadius);
  }

  if (saved.pixelBehavior && typeof saved.pixelBehavior === 'object') {
    const pb = saved.pixelBehavior;
    const keys = Object.keys(PIXEL_BEHAVIOR_RANGES);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (!(key in pb)) continue;
      const range = PIXEL_BEHAVIOR_RANGES[key];
      out.pixelBehavior[key] = clampNum(
        pb[key],
        range.min,
        range.max,
        out.pixelBehavior[key]
      );
    }
  }

  /* Migrate legacy Heat-only decay into shared Pixel Behavior.decaySpeed. */
  const savedPb =
    saved.pixelBehavior && typeof saved.pixelBehavior === 'object'
      ? saved.pixelBehavior
      : null;
  if (!(savedPb && 'decaySpeed' in savedPb) && 'heatDecaySpeed' in saved) {
    const range = PIXEL_BEHAVIOR_RANGES.decaySpeed;
    out.pixelBehavior.decaySpeed = clampNum(
      saved.heatDecaySpeed,
      range.min,
      range.max,
      out.pixelBehavior.decaySpeed
    );
  }

  if ('cursorMode' in saved) {
    out.cursorMode = normalizeCursorMode(saved.cursorMode);
  }

  if (saved.performance && typeof saved.performance === 'object') {
    const perf = saved.performance;
    if ('pixelDensity' in perf) {
      out.performance.pixelDensity = normalizePixelDensity(perf.pixelDensity);
    }
    if ('effectQuality' in perf) {
      out.performance.effectQuality = Math.round(
        clampNum(perf.effectQuality, 0, 10, out.performance.effectQuality)
      );
    }
    if ('frameRateTarget' in perf) {
      out.performance.frameRateTarget = normalizeFrameRateTarget(
        perf.frameRateTarget
      );
    }
    if ('adaptivePerformance' in perf) {
      out.performance.adaptivePerformance = !!perf.adaptivePerformance;
    }
  }

  /* Active preset id — opaque string (future presets need no format change).
     null / empty / "__custom__" → Custom. Unknown ids are kept; the Preset
     Manager reconciles against registered presets after restore. */
  if ('activePresetId' in saved) {
    const id = saved.activePresetId;
    if (typeof id === 'string' && id && id !== '__custom__') {
      out.activePresetId = id;
    } else {
      out.activePresetId = null;
    }
  }

  return out;
}

/**
 * Copy a validated snapshot into the live centralized settings object.
 * Mutates nested objects in place so existing references stay valid.
 * Does not publish events — callers sync DOM / subsystems as needed.
 *
 * @param {object} animConfig
 * @param {object} validated
 * @returns {boolean}
 */
export function applySettings(animConfig, validated) {
  if (!animConfig || !validated) return false;

  animConfig.motion = !!validated.motion;
  animConfig.bgMode = validated.bgMode;
  animConfig.lastImplementedBgMode = validated.lastImplementedBgMode;
  animConfig.heatEnabled = !!validated.heatEnabled;
  animConfig.heatIntensity = validated.heatIntensity;
  animConfig.heatRadius = validated.heatRadius;
  animConfig.cursorMode = validated.cursorMode;

  if (validated.effectColor && animConfig.effectColor) {
    animConfig.effectColor.r = validated.effectColor.r;
    animConfig.effectColor.g = validated.effectColor.g;
    animConfig.effectColor.b = validated.effectColor.b;
  }

  if (validated.pixelBehavior && animConfig.pixelBehavior) {
    const keys = Object.keys(PIXEL_BEHAVIOR_RANGES);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (key in validated.pixelBehavior) {
        animConfig.pixelBehavior[key] = validated.pixelBehavior[key];
      }
    }
  }

  if (validated.performance && animConfig.performance) {
    animConfig.performance.pixelDensity = validated.performance.pixelDensity;
    animConfig.performance.effectQuality = validated.performance.effectQuality;
    animConfig.performance.frameRateTarget =
      validated.performance.frameRateTarget;
    animConfig.performance.adaptivePerformance =
      !!validated.performance.adaptivePerformance;
  }

  if ('activePresetId' in validated) {
    const id = validated.activePresetId;
    animConfig.activePresetId =
      typeof id === 'string' && id ? id : null;
  }

  return true;
}

/**
 * Load → validate → apply saved settings onto the live animConfig.
 * No-ops cleanly when nothing is stored or the payload is invalid.
 *
 * @param {object} animConfig
 * @returns {boolean} true if saved settings were applied
 */
export function restoreSettings(animConfig) {
  if (!animConfig || typeof animConfig !== 'object') return false;
  const saved = loadSettings();
  if (!saved) return false;
  const validated = validateSettings(saved, animConfig);
  if (!validated) return false;
  return applySettings(animConfig, validated);
}

/**
 * Watch animConfig changes and auto-persist the full settings object.
 *
 * @param {object} options
 * @param {object} options.animConfig — live centralized settings object
 * @param {import('../pixel-engine/events.js').EventSystem} options.events
 * @param {number} [options.debounceMs]
 * @returns {{ flush: () => void, destroy: () => void }}
 */
export function initSettingsPersistence(options) {
  const animConfig = options.animConfig;
  const events = options.events;
  const debounceMs =
    options.debounceMs != null ? options.debounceMs : PERSIST_DEBOUNCE_MS;

  if (!animConfig || !events) {
    return { flush() {}, destroy() {} };
  }

  let timer = 0;
  let dirty = false;

  function writeNow() {
    dirty = false;
    saveSettings(animConfig);
  }

  function schedulePersist() {
    dirty = true;
    if (timer) clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = 0;
      if (dirty) writeNow();
    }, debounceMs);
  }

  /** Flush any pending write immediately (interaction end / page hide). */
  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
    if (dirty) writeNow();
  }

  function onPointerEnd() {
    if (dirty) flush();
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') flush();
  }

  const unsub = events.on(PixelEvents.AnimConfigChange, schedulePersist);

  /* Complete a drag / interaction without waiting for the debounce window. */
  window.addEventListener('pointerup', onPointerEnd);
  window.addEventListener('pointercancel', onPointerEnd);
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', onVisibilityChange);

  function destroy() {
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
    unsub();
    window.removeEventListener('pointerup', onPointerEnd);
    window.removeEventListener('pointercancel', onPointerEnd);
    window.removeEventListener('pagehide', flush);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }

  return { flush, destroy };
}
