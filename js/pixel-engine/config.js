/* Anim / settings config — motion, Pixel FS selection, shared effect color.
   Publishes through the engine event system (bridged to window for settings).

   Pixel Behavior knobs live on animConfig.pixelBehavior. Soft publishes feed
   the shared Pixel Behavior system, which modes (Heat / Wave / Lightning) read.

   Performance knobs live on animConfig.performance. Soft publishes feed the
   Performance Manager (density → grid cell, quality, FPS cap, adaptive). */

import { PIXEL_FIELD_STYLES, PixelEvents } from './constants.js';
import { PIXEL_BEHAVIOR_DEFAULTS } from './pixel-behavior.js';
import {
  CURSOR_MODE_DEFAULT,
  normalizeCursorMode,
} from './cursor-mode.js';
import {
  PERFORMANCE_DEFAULTS,
  normalizeFrameRateTarget,
  normalizePixelDensity,
} from './performance-manager.js';

/**
 * @param {object} options
 * @param {import('./events.js').EventSystem} options.events
 * @param {boolean} options.prefersReduced
 */
export function createAnimConfig(options) {
  const events = options.events;
  const prefersReduced = !!options.prefersReduced;

  /* Shared Pixel Behavior physics — defaults match pre-settings Heat V1.
     Future knobs (gravity, friction, turbulence, …) land on this object. */
  const PIXEL_BEHAVIOR_RANGES = Object.freeze({
    reactionStrength: {
      min: 0,
      max: 0.8,
      default: PIXEL_BEHAVIOR_DEFAULTS.reactionStrength,
    },
    movementSpeed: {
      min: 0.005,
      max: 0.2,
      default: PIXEL_BEHAVIOR_DEFAULTS.movementSpeed,
    },
    returnSpeed: {
      min: 0.002,
      max: 0.1,
      default: PIXEL_BEHAVIOR_DEFAULTS.returnSpeed,
    },
    trailLifetime: {
      min: 0.85,
      max: 0.995,
      default: PIXEL_BEHAVIOR_DEFAULTS.trailLifetime,
    },
  });

  const animConfig = {
    motion: !prefersReduced,
    bgMode: 'heat',
    lastImplementedBgMode: 'heat',
    effectColor: { r: 255, g: 52, b: 158 },
    /* Heat brush knobs — defaults match pre-settings V1 */
    heatEnabled: true,
    heatIntensity: 0.92,
    heatRadius: 11.8,
    heatDecaySpeed: 0.018,
    /* Shared pixel physics (category-root Pixel Behavior settings) */
    pixelBehavior: {
      reactionStrength: PIXEL_BEHAVIOR_DEFAULTS.reactionStrength,
      movementSpeed: PIXEL_BEHAVIOR_DEFAULTS.movementSpeed,
      returnSpeed: PIXEL_BEHAVIOR_DEFAULTS.returnSpeed,
      trailLifetime: PIXEL_BEHAVIOR_DEFAULTS.trailLifetime,
    },
    /* Cursor Interaction — modifiers layered on active Pixel FS style */
    cursorMode: CURSOR_MODE_DEFAULT,
    /* Performance — density / quality / FPS / adaptive (defaults = V1 look) */
    performance: {
      pixelDensity: PERFORMANCE_DEFAULTS.pixelDensity,
      effectQuality: PERFORMANCE_DEFAULTS.effectQuality,
      frameRateTarget: PERFORMANCE_DEFAULTS.frameRateTarget,
      adaptivePerformance: PERFORMANCE_DEFAULTS.adaptivePerformance,
    },
  };

  function resolveActiveBgMode() {
    if (!animConfig.motion) return null;
    const style = PIXEL_FIELD_STYLES[animConfig.bgMode];
    if (style && style.implemented) return animConfig.bgMode;
    return animConfig.lastImplementedBgMode || 'heat';
  }

  function syncAnimDom() {
    document.body.dataset.motion = animConfig.motion ? 'on' : 'off';
    document.body.dataset.bgMode = animConfig.bgMode;
    const { r, g, b } = animConfig.effectColor;
    const root = document.documentElement;
    root.style.setProperty('--accent-r', String(r));
    root.style.setProperty('--accent-g', String(g));
    root.style.setProperty('--accent-b', String(b));
    root.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
  }

  let batchDepth = 0;
  let pendingMotionReenabled = false;

  /**
   * @param {{ soft?: boolean, changed?: string[] }} [opts]
   *   soft — behavior-only update: skip mode/FS remount + inspector rewrite;
   *   Pixel Behavior system syncs once, modes apply only when revision advances.
   */
  function publishAnimConfig(opts) {
    if (batchDepth > 0) return;
    const soft = !!(opts && opts.soft);
    if (!soft) syncAnimDom();
    const activeMode = resolveActiveBgMode();
    const detail = {
      motion: animConfig.motion,
      bgMode: animConfig.bgMode,
      activeBgMode: activeMode,
      effectColor: { ...animConfig.effectColor },
      soft,
      changed: (opts && opts.changed) || null,
    };
    events.emit(PixelEvents.AnimConfigChange, detail);
    events.emit(PixelEvents.SettingsUpdated, detail);
    if (!soft) {
      events.emit(PixelEvents.BgModeChange, {
        mode: activeMode,
        selected: animConfig.bgMode,
      });
      events.emit(PixelEvents.PixelFSChanged, {
        mode: activeMode,
        selected: animConfig.bgMode,
      });
    }
    if (pendingMotionReenabled) {
      pendingMotionReenabled = false;
      events.emit(PixelEvents.MotionReenabled, {});
    }
  }

  function beginBatch() {
    batchDepth += 1;
  }

  function endBatch() {
    batchDepth = Math.max(0, batchDepth - 1);
    if (batchDepth === 0) publishAnimConfig();
  }

  function setMotion(on) {
    const next = !!on;
    if (animConfig.motion === next) return;
    const turningOn = next && !animConfig.motion;
    animConfig.motion = next;
    if (turningOn) {
      if (batchDepth > 0) pendingMotionReenabled = true;
      else {
        publishAnimConfig();
        events.emit(PixelEvents.MotionReenabled, {});
        return;
      }
    }
    publishAnimConfig();
  }

  function setBgMode(mode) {
    if (!Object.prototype.hasOwnProperty.call(PIXEL_FIELD_STYLES, mode)) return;
    if (animConfig.bgMode === mode) return;
    const prev = PIXEL_FIELD_STYLES[animConfig.bgMode];
    if (prev && prev.implemented) {
      animConfig.lastImplementedBgMode = animConfig.bgMode;
    }
    animConfig.bgMode = mode;
    if (PIXEL_FIELD_STYLES[mode].implemented) {
      animConfig.lastImplementedBgMode = mode;
    }
    publishAnimConfig();
  }

  function clampByte(n) {
    return Math.max(0, Math.min(255, n | 0));
  }

  function setEffectColor(r, g, b, publish) {
    animConfig.effectColor.r = clampByte(r);
    animConfig.effectColor.g = clampByte(g);
    animConfig.effectColor.b = clampByte(b);
    if (publish !== false) publishAnimConfig();
  }

  function clampNum(n, min, max) {
    const v = Number(n);
    if (!Number.isFinite(v)) return min;
    return Math.min(max, Math.max(min, v));
  }

  function setHeatEnabled(on) {
    const next = !!on;
    if (animConfig.heatEnabled === next) return;
    animConfig.heatEnabled = next;
    publishAnimConfig();
  }

  function setHeatIntensity(value) {
    const next = clampNum(value, 0, 1);
    if (animConfig.heatIntensity === next) return;
    animConfig.heatIntensity = next;
    publishAnimConfig();
  }

  function setHeatRadius(value) {
    const next = clampNum(value, 1, 30);
    if (animConfig.heatRadius === next) return;
    animConfig.heatRadius = next;
    publishAnimConfig();
  }

  function setHeatDecaySpeed(value) {
    const next = clampNum(value, 0.001, 0.1);
    if (animConfig.heatDecaySpeed === next) return;
    animConfig.heatDecaySpeed = next;
    publishAnimConfig();
  }

  /**
   * Update one shared Pixel Behavior knob. Soft-publishes so the Pixel Behavior
   * system (and modes that sync from it) pick up the change — no mode churn.
   * @param {keyof typeof PIXEL_BEHAVIOR_RANGES} key
   * @param {number} value
   */
  function setPixelBehavior(key, value) {
    const range = PIXEL_BEHAVIOR_RANGES[key];
    if (!range) return;
    const next = clampNum(value, range.min, range.max);
    if (animConfig.pixelBehavior[key] === next) return;
    animConfig.pixelBehavior[key] = next;
    publishAnimConfig({ soft: true, changed: [`pixelBehavior.${key}`] });
  }

  function getPixelBehavior(key) {
    const range = PIXEL_BEHAVIOR_RANGES[key];
    if (!range) return undefined;
    const v = Number(animConfig.pixelBehavior[key]);
    return Number.isFinite(v) ? v : range.default;
  }

  function setCursorMode(value) {
    const next = normalizeCursorMode(value);
    if (animConfig.cursorMode === next) return;
    animConfig.cursorMode = next;
    publishAnimConfig({ soft: true, changed: ['cursorMode'] });
  }

  function getCursorMode() {
    return normalizeCursorMode(animConfig.cursorMode);
  }

  function clampInt(n, min, max) {
    const v = Math.round(Number(n));
    if (!Number.isFinite(v)) return min;
    return Math.min(max, Math.max(min, v));
  }

  function setPixelDensity(value) {
    const next = normalizePixelDensity(value);
    if (animConfig.performance.pixelDensity === next) return;
    animConfig.performance.pixelDensity = next;
    publishAnimConfig({ soft: true, changed: ['performance.pixelDensity'] });
  }

  function getPixelDensity() {
    return normalizePixelDensity(animConfig.performance.pixelDensity);
  }

  function setEffectQuality(value) {
    const next = clampInt(value, 0, 10);
    if (animConfig.performance.effectQuality === next) return;
    animConfig.performance.effectQuality = next;
    publishAnimConfig({ soft: true, changed: ['performance.effectQuality'] });
  }

  function getEffectQuality() {
    return clampInt(animConfig.performance.effectQuality, 0, 10);
  }

  function setFrameRateTarget(value) {
    const next = normalizeFrameRateTarget(value);
    if (animConfig.performance.frameRateTarget === next) return;
    animConfig.performance.frameRateTarget = next;
    publishAnimConfig({ soft: true, changed: ['performance.frameRateTarget'] });
  }

  function getFrameRateTarget() {
    return normalizeFrameRateTarget(animConfig.performance.frameRateTarget);
  }

  function setAdaptivePerformance(on) {
    const next = !!on;
    if (animConfig.performance.adaptivePerformance === next) return;
    animConfig.performance.adaptivePerformance = next;
    publishAnimConfig({
      soft: true,
      changed: ['performance.adaptivePerformance'],
    });
  }

  function getAdaptivePerformance() {
    return !!animConfig.performance.adaptivePerformance;
  }

  syncAnimDom();

  return {
    animConfig,
    prefersReduced,
    resolveActiveBgMode,
    syncAnimDom,
    publishAnimConfig,
    beginBatch,
    endBatch,
    setMotion,
    setBgMode,
    setEffectColor,
    setHeatEnabled,
    setHeatIntensity,
    setHeatRadius,
    setHeatDecaySpeed,
    setPixelBehavior,
    getPixelBehavior,
    setCursorMode,
    getCursorMode,
    setPixelDensity,
    getPixelDensity,
    setEffectQuality,
    getEffectQuality,
    setFrameRateTarget,
    getFrameRateTarget,
    setAdaptivePerformance,
    getAdaptivePerformance,
    setPixelReactionStrength: (v) => setPixelBehavior('reactionStrength', v),
    setPixelMovementSpeed: (v) => setPixelBehavior('movementSpeed', v),
    setPixelReturnSpeed: (v) => setPixelBehavior('returnSpeed', v),
    setPixelTrailLifetime: (v) => setPixelBehavior('trailLifetime', v),
    getMotion: () => animConfig.motion,
    getBgMode: () => animConfig.bgMode,
    getLastImplementedBgMode: () => animConfig.lastImplementedBgMode || 'heat',
    getEffectColor: () => ({ ...animConfig.effectColor }),
    getHeatEnabled: () => !!animConfig.heatEnabled,
    getHeatIntensity: () => animConfig.heatIntensity,
    getHeatRadius: () => animConfig.heatRadius,
    getHeatDecaySpeed: () => animConfig.heatDecaySpeed,
    getPixelReactionStrength: () => getPixelBehavior('reactionStrength'),
    getPixelMovementSpeed: () => getPixelBehavior('movementSpeed'),
    getPixelReturnSpeed: () => getPixelBehavior('returnSpeed'),
    getPixelTrailLifetime: () => getPixelBehavior('trailLifetime'),
    PIXEL_BEHAVIOR_RANGES,
  };
}
