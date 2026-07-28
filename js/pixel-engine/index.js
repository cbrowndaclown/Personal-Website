/* Pixel Engine — Version 1 architecture shell.
   Composes grid, state, render, interaction, animation, Pixel FS, and events.
   Visual behavior is preserved by mounting the existing Heat / Wave / Lightning
   implementations as plugins. */

import { createEventSystem } from './events.js';
import { createAnimConfig } from './config.js';
import { createGridManager } from './grid-manager.js';
import { createPixelStateManager } from './pixel-state.js';
import { createRenderer } from './renderer.js';
import { createInteractionManager } from './interaction-manager.js';
import { createAnimationManager } from './animation-manager.js';
import { createPixelFSManager } from './pixel-fs-manager.js';
import { createPerformanceManager } from './performance-manager.js';
import { CELL, PixelEvents } from './constants.js';

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
  const grid = createGridManager({ stage, events, cell: CELL });
  const state = createPixelStateManager({ grid, events });
  const renderer = createRenderer({ canvas, grid });
  const interaction = createInteractionManager({ stage, grid, events });
  const performance = createPerformanceManager();

  const animation = createAnimationManager({
    animConfig: config.animConfig,
    prefersReduced: config.prefersReduced,
    resolveActiveBgMode: config.resolveActiveBgMode,
    events,
    grid,
  });

  const pixelFS = createPixelFSManager({ events, config });

  const styleDeps = {
    canvas,
    stage,
    animConfig: config.animConfig,
    resolveActiveBgMode: config.resolveActiveBgMode,
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
    animConfig: config.animConfig,
    resolveActiveBgMode: config.resolveActiveBgMode,

    destroy() {
      pixelFS.destroy();
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
export { BootPhase, BOOT_TIMING } from './boot/constants.js';
export { createEventSystem } from './events.js';
