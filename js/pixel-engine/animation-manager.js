/* Animation Manager — timeline orchestration for intro / future transitions.
   V1 owns the landing sequence via createIntroController. */

import { createIntroController } from './intro/intro-controller.js';
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

  /* Compatibility surface — Heat / Wave / Lightning talk to pixelField + schedule */
  const pixelField = {
    brightness: function (i) { return introController.brightness(i); },
    offsetX: function (i) { return introController.offsetX(i); },
    offsetY: function (i) { return introController.offsetY(i); },
    update: function (now) { return introController.update(now); },
    isActive: function () { return introController.isActive(); },
    onResize: function (c, r) { introController.onResize(c, r); },
    cancel: function () { introController.cancel(); },
  };

  const pixelIntro = {
    schedule: function () { introController.schedule(); },
    cancel: function () { introController.cancel(); },
    isRunning: function () {
      const p = introController.getPhase();
      return p === 'intro' || p === 'boot';
    },
  };

  /* Forward grid resize into the intro LED buffers (single authority later). */
  if (options.grid && events) {
    events.on(PixelEvents.GridResized, (info) => {
      if (info && info.changed) {
        introController.onResize(info.cols, info.rows);
      }
    });
  }

  /* Expose for debugging parity with V1 */
  window.bootSequence = introController;
  window.introController = introController;

  return {
    introController,
    pixelField,
    pixelIntro,
    schedule: () => pixelIntro.schedule(),
    cancel: () => pixelIntro.cancel(),
    isActive: () => pixelField.isActive(),
    destroy() {
      introController.cancel();
    },
  };
}
