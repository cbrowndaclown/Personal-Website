/* Pixel Engine — Version 1 architecture shell.
   Composes grid, state, render, interaction, animation, Pixel FS, and events.
   Visual behavior is preserved by mounting the existing Heat / Wave / Lightning
   implementations as plugins. */

import { createEventSystem } from './events.js';
import { createAnimConfig } from './config.js';
import { createPixelBehaviorSystem } from './pixel-behavior.js';
import { createCursorModeSystem } from './cursor-mode.js';
import { createGridManager } from './grid-manager.js';
import { createPixelStateManager } from './pixel-state.js';
import { createRenderer } from './renderer.js';
import { createInteractionManager } from './interaction-manager.js';
import { createAnimationManager } from './animation-manager.js';
import { createPixelFSManager } from './pixel-fs-manager.js';
import { createPerformanceManager } from './performance-manager.js';
import { CELL, PixelEvents } from './constants.js';
import { restoreSettings } from '../settings/persist.js';

import { createHeatStyle } from './styles/heat.js';
import { createWaveStyle } from './styles/wave.js';
import { createLightningStyle } from './styles/lightning.js';
import { createExperimentalStyle } from './styles/experimental.js';

/**
 * @param {object} [options]
 * @param {HTMLCanvasElement} [options.canvas]
 * @param {HTMLElement} [options.stage]
 * @param {boolean} [options.prefersReduced]
 * @returns {object|null}
 */
export function createPixelEngine(options = {}) {
  const canvas = options.canvas || document.getElementById('heatmap');
  const stage = options.stage || document.getElementById('stage');
  if (!canvas || !stage) return null;

  const prefersReduced =
    options.prefersReduced != null
      ? !!options.prefersReduced
      : window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const events = createEventSystem();
  const config = createAnimConfig({ events, prefersReduced });

  /* Load → validate → apply before Pixel FS / startup so boot uses restored state. */
  if (restoreSettings(config.animConfig)) {
    config.syncAnimDom();
  }

  /* Shared behavior layer: Settings → pixelBehavior → all Pixel FS modes */
  const pixelBehavior = createPixelBehaviorSystem({
    animConfig: config.animConfig,
    events,
  });
  /* Cursor Interaction modifiers — layered on active Pixel FS style */
  const cursorMode = createCursorModeSystem({
    animConfig: config.animConfig,
    events,
  });
  const grid = createGridManager({ stage, events, cell: CELL });
  const state = createPixelStateManager({ grid, events });
  const renderer = createRenderer({ canvas, grid });
  const interaction = createInteractionManager({ stage, grid, events });
  const performance = createPerformanceManager({
    animConfig: config.animConfig,
    events,
    grid,
  });

  const animation = createAnimationManager({
    animConfig: config.animConfig,
    prefersReduced: config.prefersReduced,
    resolveActiveBgMode: config.resolveActiveBgMode,
    events,
    grid,
    performance,
  });

  const pixelFS = createPixelFSManager({ events, config });

  const styleDeps = {
    canvas,
    stage,
    animConfig: config.animConfig,
    resolveActiveBgMode: config.resolveActiveBgMode,
    pixelBehavior,
    cursorMode,
    pixelField: animation.pixelField,
    pixelIntro: animation.pixelIntro,
    events,
    grid,
    state,
    renderer,
    interaction,
    performance,
  };

  pixelFS.register(createHeatStyle(styleDeps));
  pixelFS.register(createWaveStyle(styleDeps));
  pixelFS.register(createLightningStyle(styleDeps));
  pixelFS.register(createExperimentalStyle(styleDeps));

  /* Grid + interaction infrastructure (styles still self-manage V1 resize loops). */
  grid.start();
  interaction.start();
  pixelFS.mountAll();
  pixelFS.syncFromConfig();

  return {
    events,
    config,
    pixelBehavior,
    cursorMode,
    grid,
    state,
    renderer,
    interaction,
    animation,
    pixelFS,
    performance,
    PixelEvents,

    /* Settings / chrome API */
    getMotion: config.getMotion,
    setMotion: config.setMotion,
    getBgMode: config.getBgMode,
    setBgMode: config.setBgMode,
    getLastImplementedBgMode: config.getLastImplementedBgMode,
    getEffectColor: config.getEffectColor,
    setEffectColor: config.setEffectColor,
    getHeatEnabled: config.getHeatEnabled,
    setHeatEnabled: config.setHeatEnabled,
    getHeatIntensity: config.getHeatIntensity,
    setHeatIntensity: config.setHeatIntensity,
    getHeatRadius: config.getHeatRadius,
    setHeatRadius: config.setHeatRadius,
    getHeatDecaySpeed: config.getHeatDecaySpeed,
    setHeatDecaySpeed: config.setHeatDecaySpeed,
    getPixelReactionStrength: config.getPixelReactionStrength,
    setPixelReactionStrength: config.setPixelReactionStrength,
    getPixelMovementSpeed: config.getPixelMovementSpeed,
    setPixelMovementSpeed: config.setPixelMovementSpeed,
    getPixelReturnSpeed: config.getPixelReturnSpeed,
    setPixelReturnSpeed: config.setPixelReturnSpeed,
    getPixelTrailLifetime: config.getPixelTrailLifetime,
    setPixelTrailLifetime: config.setPixelTrailLifetime,
    getCursorMode: config.getCursorMode,
    setCursorMode: config.setCursorMode,
    getPixelDensity: config.getPixelDensity,
    setPixelDensity: (value) => {
      if (
        animation &&
        animation.pixelField &&
        typeof animation.pixelField.densityChangeLocked === 'function' &&
        animation.pixelField.densityChangeLocked()
      ) {
        return;
      }
      config.setPixelDensity(value);
    },
    isPixelDensityLocked: () =>
      !!(
        animation &&
        animation.pixelField &&
        typeof animation.pixelField.densityChangeLocked === 'function' &&
        animation.pixelField.densityChangeLocked()
      ),
    getEffectQuality: config.getEffectQuality,
    setEffectQuality: config.setEffectQuality,
    getFrameRateTarget: config.getFrameRateTarget,
    setFrameRateTarget: config.setFrameRateTarget,
    getAdaptivePerformance: config.getAdaptivePerformance,
    setAdaptivePerformance: config.setAdaptivePerformance,
    beginBatch: config.beginBatch,
    endBatch: config.endBatch,
    animConfig: config.animConfig,
    resolveActiveBgMode: config.resolveActiveBgMode,

    destroy() {
      pixelFS.destroy();
      cursorMode.destroy();
      pixelBehavior.destroy();
      animation.destroy();
      interaction.destroy();
      grid.destroy();
      state.destroy();
      performance.destroy();
      events.destroy();
    },
  };
}

export { PixelEvents, CELL } from './constants.js';
export { BootPhase, BOOT_TIMING, BOOT_ENERGY } from './boot/constants.js';
export { createEventSystem } from './events.js';
export {
  createPixelBehaviorSystem,
  PIXEL_BEHAVIOR_DEFAULTS,
} from './pixel-behavior.js';
export {
  createCursorModeSystem,
  CURSOR_MODE,
  CURSOR_MODE_DEFAULT,
  CURSOR_MODE_OPTIONS,
} from './cursor-mode.js';
export {
  createGridManager,
  computeGridLayout,
  gridCoversViewport,
} from './grid-manager.js';
export {
  createPerformanceManager,
  PERFORMANCE_DEFAULTS,
  FRAME_RATE_OPTIONS,
  PIXEL_DENSITY_MIN,
  PIXEL_DENSITY_MAX,
  PIXEL_DENSITY_DEFAULT,
  normalizePixelDensity,
  cellSizeFromDensity,
} from './performance-manager.js';
