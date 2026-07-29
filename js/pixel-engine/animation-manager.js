/* Animation Manager — boot lifecycle + intro content orchestration. */

import { createIntroController } from './intro/intro-controller.js';
import { createBootController } from './boot/index.js';
import { createDensityRebuildPipeline } from './density-rebuild.js';
import { PixelEvents } from './constants.js';

/**
 * @param {object} options
 * @param {object} options.animConfig
 * @param {boolean} options.prefersReduced
 * @param {() => string|null} options.resolveActiveBgMode
 * @param {import('./events.js').EventSystem} options.events
 * @param {ReturnType<import('./grid-manager.js').createGridManager>} [options.grid]
 * @param {ReturnType<import('./performance-manager.js').createPerformanceManager>} [options.performance]
 */
export function createAnimationManager(options) {
  const events = options.events;
  const performance = options.performance || null;
  const grid = options.grid || null;

  const introController = createIntroController({
    animConfig: options.animConfig,
    prefersReduced: options.prefersReduced,
    resolveActiveBgMode: options.resolveActiveBgMode,
    grid,
    performance,
  });

  const bootController = createBootController({
    animConfig: options.animConfig,
    prefersReduced: options.prefersReduced,
    resolveActiveBgMode: options.resolveActiveBgMode,
    events,
    grid,
    intro: introController,
  });

  const densityRebuild =
    grid && performance
      ? createDensityRebuildPipeline({
          grid,
          performance,
          events,
          bootController,
          introController,
        })
      : null;

  if (densityRebuild && typeof bootController.bindDensityRebuild === 'function') {
    bootController.bindDensityRebuild(densityRebuild);
  }

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
    cellInteractive: function (i) {
      return typeof bootController.cellInteractive === 'function'
        ? bootController.cellInteractive(i)
        : true;
    },
    recalibrationActive: function () {
      return typeof bootController.recalibrationActive === 'function'
        ? bootController.recalibrationActive()
        : false;
    },
    teardownActive: function () {
      return typeof bootController.teardownActive === 'function'
        ? bootController.teardownActive()
        : false;
    },
    /**
     * Density teardown / sync generation — neutral system colors only
     * (no Settings RGB tint). Menu restore after sync may use the theme again.
     */
    densityOpsActive: function () {
      if (typeof bootController.densityOpsNeutral === 'function') {
        return bootController.densityOpsNeutral();
      }
      const tearing =
        typeof bootController.teardownActive === 'function' &&
        bootController.teardownActive();
      const syncing =
        typeof bootController.recalibrationActive === 'function' &&
        bootController.recalibrationActive();
      return !!(tearing || syncing);
    },
    densityChangeLocked: function () {
      return typeof bootController.densityChangeLocked === 'function'
        ? bootController.densityChangeLocked()
        : false;
    },
    /** Authoritative lattice during / after a density rebuild. */
    getDensityAuthority: function () {
      if (densityRebuild && typeof densityRebuild.getAuthority === 'function') {
        const a = densityRebuild.getAuthority();
        if (a) return a;
      }
      if (
        bootController &&
        typeof bootController.getDensityAuthority === 'function'
      ) {
        return bootController.getDensityAuthority();
      }
      return null;
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
    rebuildForDensity: function (c, r) {
      if (typeof bootController.rebuildForDensity === 'function') {
        bootController.rebuildForDensity(c, r);
      } else {
        bootController.onResize(c, r);
      }
    },
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

  /* Forward grid resize into boot + intro LED buffers.
     Density workflow is owned by density-rebuild.js — one authoritative grid
     drives recalibration, simulation remount, and menu bake. */
  if (grid && events) {
    events.on(PixelEvents.GridResized, (info) => {
      if (!info || !info.changed) return;
      if (info.reason === 'density') return;
      /* During a density transition the pipeline owns lattice size. */
      if (
        typeof bootController.densityChangeLocked === 'function' &&
        bootController.densityChangeLocked()
      ) {
        return;
      }
      bootController.onResize(info.cols, info.rows);
    });
    events.on(PixelEvents.PixelDensityTeardownRequest, () => {
      if (typeof bootController.beginDensityTeardown === 'function') {
        bootController.beginDensityTeardown();
      } else {
        bootController.rebuildForDensity(grid.cols, grid.rows);
      }
    });
    events.on(PixelEvents.PixelDensityTeardownEnd, () => {
      if (densityRebuild) {
        densityRebuild.runAfterTeardown();
        return;
      }
      /* Fallback if pipeline could not be constructed — same init order. */
      if (
        !performance ||
        typeof performance.commitPendingDensity !== 'function'
      ) {
        return;
      }
      if (typeof bootController.destroyPreviousGrid === 'function') {
        bootController.destroyPreviousGrid();
      }
      const committed = performance.commitPendingDensity({ silent: true });
      if (committed === false) return;
      const info =
        typeof grid.ensureCoverage === 'function'
          ? grid.ensureCoverage()
          : typeof grid.getInfo === 'function'
            ? grid.getInfo()
            : committed;
      if (!info || !(info.cols > 0) || !(info.rows > 0)) return;
      if (typeof bootController.setDensityAuthority === 'function') {
        bootController.setDensityAuthority(info);
      }
      if (typeof bootController.createGridFromAuthority === 'function') {
        bootController.createGridFromAuthority(info);
      } else if (typeof bootController.beginDensityGeneration === 'function') {
        bootController.beginDensityGeneration(info);
        events.emit(PixelEvents.PixelDensityChanged, info);
        events.emit(PixelEvents.GridResized, {
          ...info,
          changed: true,
          reason: 'density',
        });
        return;
      }
      events.emit(PixelEvents.PixelDensityChanged, info);
      events.emit(PixelEvents.GridResized, {
        ...info,
        changed: true,
        reason: 'density',
      });
      if (
        introController &&
        typeof introController.rasterizeMenuForGrid === 'function'
      ) {
        introController.rasterizeMenuForGrid(info, { densityRebuild: true });
      }
      if (typeof bootController.beginRebuildAnimation === 'function') {
        bootController.beginRebuildAnimation(info);
      }
    });
    events.on(PixelEvents.GridInitialized, (info) => {
      if (info) bootController.onResize(info.cols, info.rows);
    });
    events.on(PixelEvents.PixelDensityTransitionEnd, () => {
      if (densityRebuild) densityRebuild.markComplete();
      else if (
        bootController &&
        typeof bootController.setDensityAuthority === 'function'
      ) {
        bootController.setDensityAuthority(null);
      }
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
  window.densityRebuild = densityRebuild;

  return {
    introController,
    bootController,
    densityRebuild,
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
