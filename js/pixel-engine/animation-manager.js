/* Animation Manager — boot lifecycle + intro content orchestration. */

import { createIntroController } from './intro/intro-controller.js';
import { createBootController } from './boot/index.js';
import { PixelEvents } from './constants.js';

/**
 * @param {object} options
 * @param {object} options.animConfig
 * @param {boolean} options.prefersReduced
 * @param {() => string|null} options.resolveActiveBgMode
 * @param {import('./events.js').EventSystem} options.events
 * @param {ReturnType<import('./grid-manager.js').createGridManager>} [options.grid]
 */
export function createAnimationManager(options) {
  const events = options.events;

  const introController = createIntroController({
    animConfig: options.animConfig,
    prefersReduced: options.prefersReduced,
    resolveActiveBgMode: options.resolveActiveBgMode,
  });

  const bootController = createBootController({
    animConfig: options.animConfig,
    prefersReduced: options.prefersReduced,
    resolveActiveBgMode: options.resolveActiveBgMode,
    events,
    grid: options.grid,
    intro: introController,
  });

  /* Compatibility surface — Heat / Wave / Lightning talk to pixelField + schedule */
  const pixelField = {
    brightness: function (i) { return bootController.brightness(i); },
    offsetX: function (i) { return bootController.offsetX(i); },
    offsetY: function (i) { return bootController.offsetY(i); },
    presence: function (i) { return bootController.presence(i); },
    update: function (now) { return bootController.update(now); },
    isActive: function () { return bootController.isActive(); },
    isReady: function () { return bootController.isReady(); },
    interactionsEnabled: function () {
      return bootController.interactionsEnabled();
    },
    exclusiveBootActive: function () {
      return bootController.exclusiveBootActive();
    },
    latticeBootActive: function () {
      return bootController.latticeBootActive();
    },
    indicatorAccentActive: function () {
      return bootController.indicatorAccentActive();
    },
    onResize: function (c, r) { bootController.onResize(c, r); },
    cancel: function () { bootController.cancel(); },
  };

  const pixelIntro = {
    schedule: function () { bootController.schedule(); },
    cancel: function () { bootController.cancel(); },
    isRunning: function () {
      const p = bootController.getPhase();
      return p !== 'ready' && p !== 'skipped' && p !== 'off';
    },
  };

  /* Forward grid resize into boot + intro LED buffers */
  if (options.grid && events) {
    events.on(PixelEvents.GridResized, (info) => {
      if (info && info.changed) {
        bootController.onResize(info.cols, info.rows);
      }
    });
    events.on(PixelEvents.GridInitialized, (info) => {
      if (info) bootController.onResize(info.cols, info.rows);
    });
  }

  /* Space skips intro only — exclusive boot (loading ring) is never skippable */
  window.addEventListener('keydown', function (e) {
    if (e.code !== 'Space' && e.key !== ' ') return;
    if (e.repeat) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.target && e.target.isContentEditable) return;
    if (bootController.exclusiveBootActive()) return;
    if (bootController.isReady() && !introController.isControllable()) return;
    if (bootController.getPhase() === 'skipped') return;
    e.preventDefault();
    bootController.skip();
  });

  /* Expose for debugging parity with V1 */
  window.bootSequence = bootController;
  window.bootController = bootController;
  window.introController = introController;

  return {
    introController,
    bootController,
    pixelField,
    pixelIntro,
    schedule: () => pixelIntro.schedule(),
    cancel: () => pixelIntro.cancel(),
    isActive: () => pixelField.isActive(),
    isReady: () => bootController.isReady(),
    destroy() {
      bootController.destroy();
    },
  };
}
