/* Boot Controller — state-driven Pixel Engine lifecycle.
   Owns stage advancement, overlaps, interaction gating, and field compositing. */

import {
  BootPhase,
  isExclusiveBootPhase,
  isLatticeBootPhase,
  isIndicatorAccentPhase,
} from './constants.js';
import { createBootField } from './boot-field.js';
import { createBootIndicator } from './indicator.js';
import { createBootStageDefs } from './stages/index.js';
import { PixelEvents } from '../constants.js';

/**
 * @param {object} options
 * @param {object} options.animConfig
 * @param {boolean} options.prefersReduced
 * @param {() => string|null} options.resolveActiveBgMode
 * @param {import('../events.js').EventSystem} options.events
 * @param {object} [options.grid]
 * @param {object} options.intro — intro content service (typography + directory)
 */
export function createBootController(options) {
  const animConfig = options.animConfig;
  const prefersReduced = options.prefersReduced;
  const resolveActiveBgMode = options.resolveActiveBgMode;
  const events = options.events;
  const intro = options.intro;

  const field = createBootField();
  const indicator = createBootIndicator();
  const stageDefs = createBootStageDefs({ intro });

  let phase = BootPhase.OFF;
  let started = false;
  let killed = false;
  let interactive = false;
  let running = false;
  let rafId = 0;
  let lastNow = 0;

  /** @type {{ def: object, instance: object, startedAt: number, done: boolean }[]} */
  let active = [];
  let nextIndex = 0;
  let primaryPhase = BootPhase.OFF;

  function setBootAttr(flag) {
    if (flag) document.body.dataset.boot = flag;
    else delete document.body.dataset.boot;
  }

  function emitPhase(next) {
    primaryPhase = next;
    phase = next;
    if (events) {
      events.emit(PixelEvents.BootPhaseChanged, { phase: next });
    }
    /* Wake style rAF loops */
    window.dispatchEvent(new CustomEvent('pixelintrostart', { detail: { phase: next } }));
  }

  function setInteractive(on) {
    interactive = !!on;
  }

  function emitReady() {
    setBootAttr(null);
    if (events) {
      events.emit(PixelEvents.BootReady, { phase: BootPhase.READY });
      events.emit(PixelEvents.AnimationFinished, { name: 'boot' });
    }
    window.dispatchEvent(new CustomEvent('pixelbootready'));
  }

  function ensureFieldSize() {
    let cols = 0;
    let rows = 0;
    if (options.grid && options.grid.cols) {
      cols = options.grid.cols;
      rows = options.grid.rows;
    }
    if (cols < 12 || rows < 8) {
      const stage = document.getElementById('stage');
      if (stage) {
        const rect = stage.getBoundingClientRect();
        cols = Math.max(cols, Math.ceil(Math.max(1, rect.width) / 5) | 0);
        rows = Math.max(rows, Math.ceil(Math.max(1, rect.height) / 5) | 0);
      }
    }
    if (cols >= 1 && rows >= 1) {
      field.allocate(cols, rows);
      intro.onResize(cols, rows);
    }
    return cols >= 12 && rows >= 8;
  }

  function makeCtx(now) {
    return {
      now,
      field,
      indicator,
      intro,
      phase: primaryPhase,
      setPhase: emitPhase,
      setInteractive,
      emitReady,
      interactive,
    };
  }

  function startNextStage(now) {
    if (nextIndex >= stageDefs.length) return false;
    const def = stageDefs[nextIndex];
    nextIndex += 1;
    const instance = def.create();
    emitPhase(def.phase);
    if (def.phase !== BootPhase.READY) {
      setBootAttr(def.phase);
    }
    instance.enter(makeCtx(now));
    active.push({
      def,
      instance,
      startedAt: now,
      done: false,
    });
    return true;
  }

  function pruneActive() {
    active = active.filter((entry) => !entry.done);
  }

  function advancePipeline(now) {
    if (!active.length && nextIndex < stageDefs.length) {
      startNextStage(now);
      return;
    }

    /* Overlap: when the leading unfinished stage is far enough along, spawn next */
    const lead = active.find((e) => !e.done);
    if (!lead) return;

    if (lead.instance.durationMs == null) {
      /* Duration unknown (typography) — wait for done before starting next */
      return;
    }

    const elapsed = now - lead.startedAt;
    const overlap = lead.instance.overlapMs || 0;
    const threshold = Math.max(0, lead.instance.durationMs - overlap);
    if (elapsed >= threshold && nextIndex < stageDefs.length) {
      const nextDef = stageDefs[nextIndex];
      /* Don't overlap into READY — finish stabilizing cleanly first */
      if (nextDef.phase === BootPhase.READY) return;
      /* Post-calibration story beats must run sequentially */
      if (
        nextDef.phase === BootPhase.DISPLAY_CLEAR ||
        nextDef.phase === BootPhase.SELF_TEST ||
        nextDef.phase === BootPhase.TYPOGRAPHY_CONSTRUCTION
      ) {
        return;
      }
      startNextStage(now);
    }
  }

  function tick(now) {
    if (!running || killed) {
      running = false;
      rafId = 0;
      return;
    }

    if (!lastNow) lastNow = now;
    lastNow = now;

    const ctx = makeCtx(now);

    for (let i = 0; i < active.length; i++) {
      const entry = active[i];
      if (entry.done) continue;
      const result = entry.instance.update(ctx) || {};
      if (result.done && !result.terminal) {
        entry.done = true;
        entry.instance.exit(ctx);
      }
    }

    pruneActive();

    /* Sequential story beats after energy boot — no overlap */
    if (!active.length && nextIndex < stageDefs.length) {
      const nextPhase = stageDefs[nextIndex].phase;
      if (
        nextPhase === BootPhase.DISPLAY_CLEAR ||
        nextPhase === BootPhase.SELF_TEST ||
        nextPhase === BootPhase.TYPOGRAPHY_CONSTRUCTION ||
        nextPhase === BootPhase.STABILIZING ||
        nextPhase === BootPhase.READY
      ) {
        startNextStage(now);
      } else {
        advancePipeline(now);
      }
    } else {
      advancePipeline(now);
    }

    /*
      Content LED clock is advanced from style paint via update().
      This loop only drives stage transitions + keeps rAF alive.
    */
    const alive =
      phase !== BootPhase.SKIPPED &&
      (phase !== BootPhase.READY || intro.isActive() || active.length > 0 || !interactive);

    if (alive || active.length > 0 || nextIndex < stageDefs.length) {
      rafId = requestAnimationFrame(tick);
    } else {
      running = false;
      rafId = 0;
    }
  }

  function startLoop() {
    if (running) return;
    running = true;
    lastNow = 0;
    rafId = requestAnimationFrame(tick);
  }

  function stopLoop() {
    running = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function jumpToReady(opts) {
    opts = opts || {};
    stopLoop();
    active = [];
    nextIndex = stageDefs.length;
    indicator.reset();
    field.allocate(field.cols || 1, field.rows || 1);
    ensureFieldSize();
    field.fillPresence(1);
    field.clearBrightness();
    field.clearMotion();
    setInteractive(true);
    phase = BootPhase.READY;
    primaryPhase = BootPhase.READY;
    setBootAttr(null);
    if (opts.instantDirectory !== false) {
      intro.skipToDirectoryHold();
    }
    started = true;
    if (events) {
      events.emit(PixelEvents.BootPhaseChanged, { phase: BootPhase.READY });
      events.emit(PixelEvents.BootReady, { phase: BootPhase.READY });
    }
    window.dispatchEvent(new CustomEvent('pixelintrostart'));
    window.dispatchEvent(new CustomEvent('pixeldirectorystart'));
    window.dispatchEvent(new CustomEvent('pixeldirectoryhold'));
    window.dispatchEvent(new CustomEvent('pixelbootready'));
    startLoop();
  }

  function cancel() {
    killed = true;
    stopLoop();
    active.forEach((e) => {
      try { e.instance.exit(makeCtx(performance.now())); } catch (_) { /* ignore */ }
    });
    active = [];
    nextIndex = 0;
    indicator.reset();
    intro.cancel();
    field.clear();
    interactive = false;
    phase = BootPhase.SKIPPED;
    primaryPhase = BootPhase.SKIPPED;
    started = false;
    setBootAttr(null);
  }

  function skip() {
    if (phase === BootPhase.READY || phase === BootPhase.SKIPPED) {
      intro.skip();
      return;
    }
    killed = false;
    /* Tear down in-flight stages cleanly */
    active.forEach((e) => {
      try { e.instance.exit(makeCtx(performance.now())); } catch (_) { /* ignore */ }
    });
    active = [];
    jumpToReady({ instantDirectory: true });
  }

  function buildAndStart() {
    killed = false;
    interactive = false;
    active = [];
    nextIndex = 0;
    indicator.reset();
    field.clear();

    /* Exclusive ownership of the PE canvas — no leftover directory / type LEDs */
    if (intro && typeof intro.suppressContent === 'function') {
      intro.suppressContent();
    }

    if (prefersReduced || !animConfig.motion) {
      phase = BootPhase.SKIPPED;
      jumpToReady({ instantDirectory: true });
      return false;
    }

    if (!ensureFieldSize()) {
      phase = BootPhase.SKIPPED;
      jumpToReady({ instantDirectory: true });
      return false;
    }

    /* Boot sequence currently starts with Heat (landing identity). */
    if (resolveActiveBgMode() !== 'heat') {
      phase = BootPhase.SKIPPED;
      jumpToReady({ instantDirectory: true });
      return false;
    }

    started = true;
    phase = BootPhase.OFF;
    setInteractive(false);
    emitPhase(BootPhase.POWERING_ON);
    setBootAttr(BootPhase.POWERING_ON);
    startNextStage(performance.now());
    startLoop();
    return true;
  }

  function schedule() {
    if (started) return;
    if (prefersReduced || !animConfig.motion || resolveActiveBgMode() !== 'heat') {
      ensureFieldSize();
      phase = BootPhase.SKIPPED;
      jumpToReady({ instantDirectory: true });
      return;
    }

    const kick = function () {
      if (started || killed) return;
      buildAndStart();
    };

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(kick).catch(kick);
    } else {
      kick();
    }
  }

  function onResize(cols, rows) {
    field.allocate(cols, rows);
    if (phase === BootPhase.READY || phase === BootPhase.SKIPPED) {
      field.fillPresence(1);
    }
    intro.onResize(cols, rows);
  }

  function presence(i) {
    if (interactive || phase === BootPhase.READY || phase === BootPhase.SKIPPED) {
      return 1;
    }
    return field.getPresence(i);
  }

  function brightness(i) {
    const boot = field.getBrightness(i);
    /* Exclusive energy / self-test: only the boot indicator may light cells */
    if (isExclusiveBootPhase(phase)) {
      return boot;
    }
    const led = intro.brightness(i);
    return boot > led ? boot : led;
  }

  function offsetX(i) {
    if (isExclusiveBootPhase(phase)) return field.getOffsetX(i);
    const boot = field.getOffsetX(i);
    if (boot) return boot;
    return intro.offsetX(i);
  }

  function offsetY(i) {
    if (isExclusiveBootPhase(phase)) return field.getOffsetY(i);
    const boot = field.getOffsetY(i);
    if (boot) return boot;
    return intro.offsetY(i);
  }

  function update(now) {
    /* Styles call update each paint frame; ensure boot loop is alive during boot */
    if (!running && started && phase !== BootPhase.SKIPPED) {
      startLoop();
    }
    /* Suppress intro content clocks during exclusive boot ownership */
    const contentAlive = isExclusiveBootPhase(phase)
      ? false
      : intro.update(now);
    return (
      contentAlive ||
      (phase !== BootPhase.READY &&
        phase !== BootPhase.SKIPPED &&
        phase !== BootPhase.OFF) ||
      running ||
      active.length > 0
    );
  }

  function isActive() {
    return (
      started &&
      phase !== BootPhase.SKIPPED &&
      (phase !== BootPhase.READY || intro.isActive() || running)
    );
  }

  function interactionsEnabled() {
    /* Armed only after typography settles (or skip-to-ready). */
    return interactive;
  }

  function isReady() {
    return phase === BootPhase.READY || phase === BootPhase.SKIPPED;
  }

  function getPhase() {
    return phase;
  }

  function isControllable() {
    return (
      phase === BootPhase.POWERING_ON ||
      phase === BootPhase.GRID_GENERATION ||
      phase === BootPhase.CALIBRATION ||
      phase === BootPhase.DISPLAY_CLEAR ||
      phase === BootPhase.SELF_TEST ||
      phase === BootPhase.TYPOGRAPHY_CONSTRUCTION ||
      phase === BootPhase.STABILIZING ||
      intro.isControllable()
    );
  }

  function exclusiveBootActive() {
    return isExclusiveBootPhase(phase);
  }

  function latticeBootActive() {
    /* Intro may overwrite data-boot to "typography" during construction */
    const attr = document.body.dataset.boot;
    return isLatticeBootPhase(phase) || isLatticeBootPhase(attr);
  }

  function indicatorAccentActive() {
    const attr = document.body.dataset.boot;
    return isIndicatorAccentPhase(phase) || isIndicatorAccentPhase(attr);
  }

  /* FF / skip inputs during boot */
  function beginFastForward() {
    if (!isControllable()) return;
    intro.beginFastForward();
  }

  function endFastForward() {
    intro.endFastForward();
  }

  /* Motion re-enabled → directory-only path */
  function replayDirectoryAfterMotionOn() {
    requestAnimationFrame(function () {
      if (!animConfig.motion) return;
      killed = false;
      started = false;
      interactive = true;
      ensureFieldSize();
      field.fillPresence(1);
      jumpToReady({ instantDirectory: false });
      intro.beginDirectorySequence({ fromMotionReenable: true });
    });
  }

  window.addEventListener('motionreenabled', replayDirectoryAfterMotionOn);
  window.addEventListener('animconfigchange', function (e) {
    if (e.detail && e.detail.motion === false) cancel();
  });

  return {
    schedule,
    cancel,
    skip,
    beginFastForward,
    endFastForward,
    update,
    presence,
    brightness,
    offsetX,
    offsetY,
    onResize,
    isActive,
    isReady,
    interactionsEnabled,
    getPhase,
    isControllable,
    exclusiveBootActive,
    latticeBootActive,
    indicatorAccentActive,
    field,
    destroy() {
      cancel();
    },
  };
}
