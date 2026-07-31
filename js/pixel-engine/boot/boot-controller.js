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
import {
  RECALIBRATION,
  applyOrganicSyncReveal,
  beginInactiveLattice,
  finishSyncLattice,
  decaySyncEnergize,
} from './recalibrate.js';
import {
  TEARDOWN,
  applyOrganicTeardown,
  finishTeardownLattice,
} from './teardown.js';
import { PixelEvents } from '../constants.js';
import { computeGridLayout } from '../grid-manager.js';
import {
  fieldMatchesAuthority,
  snapshotGridAuthority,
  validateGridAuthority,
} from '../density-rebuild.js';
import { clearAppStartup } from '../../app-startup.js';

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
  const sharedGrid = options.grid || null;

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

  /* Density recalibration — center-out sync after PixelDensityChanged */
  let recalibrating = false;
  let recalibStartedAt = 0;
  let recalibSeed = 0xc41b;
  let recalibLastNow = 0;

  /* Density teardown — center-out collapse before any remount */
  let tearingDown = false;
  let teardownStartedAt = 0;
  let teardownSeed = 0xd04e;
  let teardownLastNow = 0;
  /** True after teardown finishes until density generation begins. */
  let awaitingDensityRebuild = false;
  /** True while post-teardown center-out generation is running. */
  let densityGenerating = false;
  /** True while menu is rebaking/assembling after density generation. */
  let densityMenuRestoring = false;
  /**
   * Soft preset refresh — lattice masked via recalibration while settings
   * apply behind the sync wave (same-density preset loads).
   */
  let presetRefreshing = false;
  /**
   * Soft preset refresh — procedural menu assemble after recalibration
   * (same beginDirectorySequence path as startup).
   */
  let presetMenuRestoring = false;
  /**
   * False until startup menu hold / boot ready. Preset refresh must never
   * touch the lattice during BOOT → INTRO → MENU_GENERATION.
   */
  let presetEffectsAllowed = false;
  /**
   * Frozen lattice from the density rebuild pipeline — single source of truth
   * for recalibration, simulation remount, and menu bake.
   * @type {ReturnType<typeof snapshotGridAuthority>|null}
   */
  let densityAuthority = null;
  /** @type {ReturnType<import('../density-rebuild.js').createDensityRebuildPipeline>|null} */
  let densityRebuild = null;

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
    /* Exclusive boot is done — PE releases data-boot. Shell unlock waits until
       intro/directory is enabled so Screen 2 does not resize the lattice mid-handoff. */
    setBootAttr(null);
    if (events) {
      events.emit(PixelEvents.BootReady, { phase: BootPhase.READY });
      events.emit(PixelEvents.AnimationFinished, { name: 'boot' });
    }
    window.dispatchEvent(new CustomEvent('pixelbootready'));
  }

  function bindDensityRebuild(pipeline) {
    densityRebuild = pipeline || null;
  }

  function setDensityAuthority(info) {
    densityAuthority =
      info && validateGridAuthority(info, null)
        ? info.reason === 'density' && info.n != null
          ? info
          : snapshotGridAuthority(info)
        : null;
  }

  function getDensityAuthority() {
    if (densityAuthority) return densityAuthority;
    if (densityRebuild && typeof densityRebuild.getAuthority === 'function') {
      return densityRebuild.getAuthority();
    }
    return null;
  }

  function ensureFieldSize() {
    /* Prefer the live shared grid — never invent a parallel lattice. */
    if (sharedGrid && sharedGrid.cols > 0 && sharedGrid.rows > 0) {
      const c = sharedGrid.cols | 0;
      const r = sharedGrid.rows | 0;
      field.allocate(c, r);
      if (typeof intro.adoptGrid === 'function' && sharedGrid.cell > 0) {
        intro.adoptGrid({
          cols: c,
          rows: r,
          cell: sharedGrid.cell,
          viewW: sharedGrid.viewW,
          viewH: sharedGrid.viewH,
          dpr: sharedGrid.dpr,
        });
      } else {
        intro.onResize(c, r);
      }
      return c >= 12 && r >= 8;
    }
    let cols = 0;
    let rows = 0;
    const cellPx =
      sharedGrid && sharedGrid.cell > 0 ? sharedGrid.cell : 5;
    const stage = document.getElementById('stage');
    if (stage) {
      const rect = stage.getBoundingClientRect();
      const layout = computeGridLayout(rect.width, rect.height, cellPx);
      cols = layout.cols;
      rows = layout.rows;
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
      /* Exclusive boot chrome — calibration ring only. */
      paintChrome(targetField, t) {
        const f = targetField || field;
        const at = t != null ? t : now;
        if (indicator) indicator.paint(f, at);
      },
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

    const overlap = lead.instance.overlapMs || 0;
    /*
      Zero-overlap stages (energy ladder) must finish every pixel before the
      next stage starts — never spawn early and lockEnergy over unfinished cells.
    */
    if (overlap <= 0) return;

    const elapsed = now - lead.startedAt;
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

  function emitDensityLockChange() {
    window.dispatchEvent(
      new CustomEvent('pixeldensitylockchange', {
        detail: { locked: densityChangeLocked() },
      }),
    );
  }

  function endTeardown(opts) {
    opts = opts || {};
    const was = tearingDown;
    if (!was && !opts.force) return;
    tearingDown = false;
    teardownLastNow = 0;
    if (opts.snap !== false) finishTeardownLattice(field);
    if (!was) return;

    /* Cancel / jump paths — do not continue into generation. */
    if (opts.rebuild === false) {
      awaitingDensityRebuild = false;
      emitDensityLockChange();
      return;
    }

    awaitingDensityRebuild = true;
    if (events) {
      events.emit(PixelEvents.PixelDensityTeardownEnd, {
        cols: field.cols,
        rows: field.rows,
      });
    }
    window.dispatchEvent(new CustomEvent('pixeldensityteardownend'));
    /* One more style paint so the snapped empty lattice clears to gray */
    window.dispatchEvent(
      new CustomEvent('pixelintrostart', { detail: { teardown: false } }),
    );
    emitDensityLockChange();
  }

  /**
   * Begin center-out teardown of the live lattice. Menu is already hidden;
   * pixels deactivate as the front reaches them. Does not remount or rebuild.
   */
  function beginTeardown() {
    /* Cancel any in-flight density sync — teardown owns the transition now. */
    endRecalibration({ force: true, snap: false, restoreMenu: false });
    /* Density pipeline owns the lock from here — soft preset flag clears. */
    presetRefreshing = false;
    presetMenuRestoring = false;

    tearingDown = true;
    awaitingDensityRebuild = false;
    teardownStartedAt = performance.now();
    teardownLastNow = teardownStartedAt;
    teardownSeed =
      (Math.imul(teardownSeed ^ (teardownStartedAt | 0), 0x27d4eb2d) >>> 0) ||
      0xd04e;

    /* Drop LED accents immediately so only lattice presence remains */
    field.clearBrightness();
    field.clearMotion();
    setInteractive(false);

    if (events) {
      events.emit(PixelEvents.PixelDensityTeardownStart, {
        cols: field.cols,
        rows: field.rows,
        seed: teardownSeed,
      });
    }
    window.dispatchEvent(
      new CustomEvent('pixelintrostart', { detail: { teardown: true } }),
    );
    window.dispatchEvent(new CustomEvent('pixeldensityteardownstart'));
    emitDensityLockChange();
    startLoop();
  }

  function tickTeardown(now) {
    if (!tearingDown) return false;

    teardownLastNow = now;
    const elapsed = Math.max(0, now - teardownStartedAt);
    const u = elapsed / TEARDOWN.DURATION_MS;
    const settled = applyOrganicTeardown(
      field,
      TEARDOWN.FROM_ENERGY,
      TEARDOWN.TO_ENERGY,
      u,
      {
        scatter: TEARDOWN.SCATTER,
        soft: TEARDOWN.SOFT,
        seed: teardownSeed,
      },
    );

    if (settled && elapsed >= TEARDOWN.DURATION_MS * 0.92) {
      endTeardown({ snap: true });
      return false;
    }
    return true;
  }

  function endRecalibration(opts) {
    opts = opts || {};
    const was = recalibrating;
    if (!was && !opts.force) return;
    recalibrating = false;
    recalibLastNow = 0;
    if (opts.snap !== false) {
      finishSyncLattice(field);
      /* Every generated pixel must join the active simulation — no gray leftovers. */
      if (field.presence) field.presence.fill(RECALIBRATION.TO_ENERGY);
      if (field.brightness) field.brightness.fill(0);
      if (typeof field.clearMotion === 'function') field.clearMotion();
    }
    if (!was) return;

    const fromDensityGen = densityGenerating;
    densityGenerating = false;
    const wasPresetRefresh = presetRefreshing;
    /* Density generation / forced cancel hand off ownership; soft preset clears below. */
    if (fromDensityGen || opts.force) {
      presetRefreshing = false;
    } else if (wasPresetRefresh) {
      presetRefreshing = false;
    }

    if (events) {
      events.emit(PixelEvents.PixelRecalibrationEnd, {
        cols: field.cols,
        rows: field.rows,
        cell: densityAuthority && densityAuthority.cell,
        n: field.size,
        densityGeneration: fromDensityGen,
      });
    }
    window.dispatchEvent(
      new CustomEvent('pixelrecalibrationend', {
        detail: { densityGeneration: fromDensityGen },
      }),
    );

    if (fromDensityGen) {
      /*
        Grid generation complete — every pixel is live. Replay menu on the
        same authority; keep settings locked until directory hold finishes.
      */
      awaitingDensityRebuild = false;
      setInteractive(true);
      phase = BootPhase.READY;
      primaryPhase = BootPhase.READY;
      setBootAttr(null);
      window.dispatchEvent(
        new CustomEvent('pixelintrostart', {
          detail: { recalibration: false, densityGeneration: false },
        }),
      );

      if (opts.restoreMenu === false) {
        densityMenuRestoring = false;
        emitDensityLockChange();
        return;
      }

      densityMenuRestoring = true;
      emitDensityLockChange();
      restoreMenuAfterSync(opts);
      return;
    }

    /* Soft preset refresh — recalibration done; play startup menu assemble next.
       Skip when force-cancelled (density teardown takes over). */
    if (wasPresetRefresh && !opts.force && !fromDensityGen) {
      if (opts.restoreMenu === false) {
        presetRefreshing = false;
        setInteractive(true);
        window.dispatchEvent(
          new CustomEvent('pixelpresetrefreshend', {
            detail: { densityGeneration: false, restoreMenu: false },
          }),
        );
        if (events) {
          events.emit(PixelEvents.PixelPresetRefreshEnd, {
            cols: field.cols,
            rows: field.rows,
            n: field.size,
          });
        }
        emitDensityLockChange();
        return;
      }
      restoreMenuAfterPresetRefresh({ instant: !!opts.instant });
      return;
    }

    if (opts.restoreMenu !== false) {
      restoreMenuAfterSync(opts);
    }
  }

  /**
   * Menu assemble finished after a density rebuild — unlock settings + full FS.
   */
  function completeDensityTransition() {
    if (!densityMenuRestoring) return;
    densityMenuRestoring = false;
    awaitingDensityRebuild = false;
    setInteractive(true);
    const authority = getDensityAuthority();
    /* Emit PixelDensityTransitionEnd first so the transition engine finishes
       before emitDensityLockChange triggers syncFromConfig. */
    window.dispatchEvent(new CustomEvent('pixeldensitytransitionend'));
    if (events) {
      events.emit(PixelEvents.PixelDensityTransitionEnd, {
        cols: field.cols,
        rows: field.rows,
        cell: authority && authority.cell,
        n: field.size,
      });
    }
    emitDensityLockChange();
    /* Pipeline markComplete clears authority — no stale grid snapshot left. */
  }

  /**
   * Soft preset refresh — menu assemble finished. Unlock + signal transition end.
   * Recalibration already completed; this is stage 2 of the preset pipeline.
   */
  function completePresetMenuRestore() {
    if (!presetMenuRestoring) return;
    presetMenuRestoring = false;
    presetRefreshing = false;
    setInteractive(true);
    /* Emit PixelPresetRefreshEnd first so the transition engine finishes
       (active → false, onComplete fires) before emitDensityLockChange
       triggers syncFromConfig. This eliminates the timing gap where the
       settings panel evaluates disabledWhen while the transition is still
       marked active. */
    window.dispatchEvent(
      new CustomEvent('pixelpresetrefreshend', {
        detail: { menuRestored: true },
      }),
    );
    if (events) {
      events.emit(PixelEvents.PixelPresetRefreshEnd, {
        cols: field.cols,
        rows: field.rows,
        n: field.size,
        menuRestored: true,
      });
    }
    emitDensityLockChange();
  }

  /**
   * After soft recalibration: play the same procedural directory assemble used
   * at startup. Interaction stays locked until pixeldirectoryhold.
   * @param {{ instant?: boolean }} [opts]
   */
  function restoreMenuAfterPresetRefresh(opts) {
    opts = opts || {};
    presetRefreshing = false;
    presetMenuRestoring = true;
    setInteractive(false);
    emitDensityLockChange();

    if (!intro) {
      completePresetMenuRestore();
      return;
    }

    /* Reduced motion — snap to hold (still goes through hold → unlock). */
    if (opts.instant || prefersReduced || !animConfig.motion) {
      if (typeof intro.skipToDirectoryHold === 'function') {
        intro.skipToDirectoryHold();
        return;
      }
      completePresetMenuRestore();
      return;
    }

    /*
      Exact startup menu path — bake + procedural assemble (DIR_TIMING).
      Do not use density-rebuild timing; presets reuse the post-boot sequence.
    */
    if (typeof intro.beginDirectorySequence === 'function') {
      intro.beginDirectorySequence();
      return;
    }

    completePresetMenuRestore();
  }

  /**
   * Stage 6 — reveal pre-rasterized menu on the synchronized lattice.
   * Always uses the density authority (same grid as recalibration / sim).
   * @param {{ instant?: boolean }} [opts]
   */
  function restoreMenuAfterSync(opts) {
    opts = opts || {};
    if (!intro) {
      completeDensityTransition();
      return;
    }

    const authority = getDensityAuthority() || snapshotGridAuthority({
      cols: field.cols,
      rows: field.rows,
      cell: sharedGrid && sharedGrid.cell > 0 ? sharedGrid.cell : 5,
      viewW: sharedGrid && sharedGrid.viewW,
      viewH: sharedGrid && sharedGrid.viewH,
      dpr: sharedGrid && sharedGrid.dpr,
      covers: true,
    });

    /* Pipeline owns menu reveal when available — same geometry as stages 2–5. */
    if (
      densityRebuild &&
      typeof densityRebuild.beginInteractionFromAuthority === 'function'
    ) {
      if (densityRebuild.beginInteractionFromAuthority(opts)) return;
    }
    if (
      densityRebuild &&
      typeof densityRebuild.rebuildMenuFromAuthority === 'function'
    ) {
      if (densityRebuild.rebuildMenuFromAuthority(opts)) return;
    }

    if (typeof intro.revealMenuAfterRebuild === 'function') {
      intro.revealMenuAfterRebuild(authority, {
        fromDensityRebuild: true,
        instant: !!opts.instant,
      });
      return;
    }

    if (typeof intro.rebuildMenuForGrid === 'function') {
      intro.rebuildMenuForGrid(authority, {
        fromDensityRebuild: true,
        instant: !!opts.instant,
      });
      return;
    }

    /* Reduced motion — snap menu to hold without assemble replay. */
    if (opts.instant && typeof intro.skipToDirectoryHold === 'function') {
      if (typeof intro.adoptGrid === 'function') intro.adoptGrid(authority);
      intro.skipToDirectoryHold();
      return;
    }
    if (typeof intro.beginDirectorySequence === 'function') {
      intro.beginDirectorySequence({
        fromDensityRebuild: true,
        instant: !!opts.instant,
        grid: authority,
      });
      return;
    }
    if (typeof intro.rebuildForDensity === 'function') {
      intro.rebuildForDensity(authority.cols, authority.rows, authority);
    }
  }

  /**
   * Stage 1 — release every reference to the previous density lattice.
   * Call after teardown completes, before creating the new grid.
   */
  function destroyPreviousGrid() {
    endRecalibration({ force: true, snap: false, restoreMenu: false });
    endTeardown({ force: true, snap: false, rebuild: false });

    const nowMs =
      typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now();
    active.forEach((e) => {
      try {
        e.instance.exit(makeCtx(nowMs));
      } catch (_) {
        /* ignore */
      }
    });
    active = [];
    nextIndex = stageDefs.length;
    indicator.reset();
    killed = false;
    started = true;

    awaitingDensityRebuild = true;
    densityGenerating = false;
    densityMenuRestoring = false;
    densityAuthority = null;
    recalibrating = false;
    tearingDown = false;
    presetRefreshing = false;
    presetMenuRestoring = false;
    recalibLastNow = 0;
    teardownLastNow = 0;
    recalibSeed = 0xc41b;
    teardownSeed = 0xd04e;

    if (typeof field.release === 'function') {
      field.release();
    } else {
      field.allocate(0, 0, { fresh: true });
    }

    if (typeof intro.destroyGridState === 'function') {
      intro.destroyGridState();
    } else if (typeof intro.suppressContent === 'function') {
      intro.suppressContent();
    }

    setInteractive(false);
    emitDensityLockChange();
  }

  /**
   * Stage 2 — allocate a brand-new inactive BootField from authority.
   * @param {number|{cols:number,rows:number,cell?:number}} colsOrInfo
   * @param {number} [rowsMaybe]
   */
  function createGridFromAuthority(colsOrInfo, rowsMaybe) {
    let authority = null;
    let c = 0;
    let r = 0;

    if (colsOrInfo && typeof colsOrInfo === 'object') {
      authority = snapshotGridAuthority(colsOrInfo);
      c = authority.cols;
      r = authority.rows;
      densityAuthority = authority;
    } else {
      c = colsOrInfo | 0;
      r = rowsMaybe | 0;
      authority = snapshotGridAuthority({
        cols: c,
        rows: r,
        cell: sharedGrid && sharedGrid.cell > 0 ? sharedGrid.cell : 5,
        viewW: sharedGrid && sharedGrid.viewW,
        viewH: sharedGrid && sharedGrid.viewH,
        dpr: sharedGrid && sharedGrid.dpr,
        covers: true,
      });
      densityAuthority = authority;
    }
    if (c < 1 || r < 1) return;

    awaitingDensityRebuild = false;
    densityMenuRestoring = false;
    densityGenerating = true;
    setInteractive(false);

    if (typeof intro.adoptGrid === 'function') {
      intro.adoptGrid(authority);
    }

    /* Brand-new inactive lattice — no copy from the previous density. */
    field.allocate(c, r, { fresh: true });
    beginInactiveLattice(field);

    if (!fieldMatchesAuthority(field, authority)) {
      field.allocate(authority.cols, authority.rows, { fresh: true });
      beginInactiveLattice(field);
    }

    phase = BootPhase.READY;
    primaryPhase = BootPhase.READY;
    setBootAttr(null);
    emitDensityLockChange();
  }

  /**
   * Allow / deny preset refresh effects. Startup keeps this false until the
   * menu has fully settled so recalibration cannot fight boot / intro.
   * @param {boolean} on
   */
  function setPresetEffectsAllowed(on) {
    presetEffectsAllowed = !!on;
  }

  /**
   * True when preset refresh is permitted (post-startup).
   * @returns {boolean}
   */
  function arePresetEffectsAllowed() {
    return presetEffectsAllowed;
  }

  /**
   * Startup still owns the display — exclusive boot, typography, stabilizing,
   * or intro menu assemble (directory / typography phases).
   * @returns {boolean}
   */
  function startupBlocksPresetEffects() {
    if (!presetEffectsAllowed) return true;
    if (isExclusiveBootPhase(phase)) return true;
    if (
      phase === BootPhase.TYPOGRAPHY_CONSTRUCTION ||
      phase === BootPhase.STABILIZING ||
      phase === BootPhase.OFF
    ) {
      return true;
    }
    if (intro && typeof intro.getPhase === 'function') {
      const ip = intro.getPhase();
      if (
        ip === 'typography' ||
        ip === 'directory' ||
        ip === 'dissolving'
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Start the Pixel FS refresh mask for a preset load.
   * Must run BEFORE settings are published so the new preset never paints
   * on a live lattice.
   *
   * Same density → center-out recalibration owns the transition.
   * Density change → instant inactive lattice; apply triggers teardown/rebuild
   * which reuses the existing density refresh pipeline.
   *
   * @param {{ densityChanging?: boolean }} [opts]
   * @returns {{ mode: 'soft'|'density'|'instant'|'blocked' }}
   */
  function beginPresetRefresh(opts) {
    opts = opts || {};
    const densityChanging = !!opts.densityChanging;

    /* Abort any stale preset refresh (recalibration or menu restore) so the
       new load starts on a clean boot controller. Without this, an orphaned
       menu restore leaves the intro in 'directory' phase, causing
       startupBlocksPresetEffects() to block the new refresh and permanently
       locking the Preset dropdown. */
    if (presetRefreshing || presetMenuRestoring) {
      endRecalibration({ force: true, snap: false, restoreMenu: false });
      presetRefreshing = false;
      presetMenuRestoring = false;
      if (typeof intro.suppressContent === 'function') {
        intro.suppressContent();
      }
    }

    /* Never disturb boot / intro / menu generation. */
    if (startupBlocksPresetEffects()) {
      return { mode: 'blocked' };
    }

    presetRefreshing = true;
    presetMenuRestoring = false;
    setInteractive(false);
    emitDensityLockChange();

    /* Hide menu for the whole refresh — recalibration, then procedural assemble. */
    if (typeof intro.suppressContent === 'function') {
      intro.suppressContent();
    }

    /* Instant mask — gray panel before any settings write. */
    beginInactiveLattice(field);
    window.dispatchEvent(
      new CustomEvent('pixelintrostart', {
        detail: {
          recalibration: !densityChanging,
          presetRefresh: true,
          densityGeneration: false,
        },
      }),
    );

    /*
      Density changes always hand off to the density pipeline after apply —
      including reduced-motion (instant teardown / rebuild). Only same-density
      soft loads use the local instant finish path.
    */
    if (densityChanging) {
      startLoop();
      return { mode: 'density' };
    }

    if (prefersReduced || !animConfig.motion) {
      /* Caller applies settings, then finishPresetRefreshInstant. */
      return { mode: 'instant' };
    }

    /* Soft path — sync wave is the transition; settings apply behind it. */
    beginRecalibration();
    return { mode: 'soft' };
  }

  /**
   * Reduced-motion / motion-off completion for soft (same-density) preset loads.
   * Still routes through menu restore → hold so unlock timing matches motion on.
   */
  function finishPresetRefreshInstant() {
    if (!presetRefreshing && !presetMenuRestoring) return;
    finishSyncLattice(field);
    if (field.presence) field.presence.fill(RECALIBRATION.TO_ENERGY);
    if (field.brightness) field.brightness.fill(0);
    if (typeof intro.suppressContent === 'function') {
      intro.suppressContent();
    }
    restoreMenuAfterPresetRefresh({ instant: true });
  }

  /**
   * Begin / restart center-out density sync on the current BootField.
   * Procedural path is always derived from field.cols/rows (the rebuilt grid).
   * Never reuses radial references from a previous lattice.
   */
  function beginRecalibration() {
    /* Guard: sync wave must cover the authority exactly. */
    const authority = getDensityAuthority();
    if (authority && !fieldMatchesAuthority(field, authority)) {
      field.allocate(authority.cols, authority.rows, { fresh: true });
      beginInactiveLattice(field);
    } else {
      beginInactiveLattice(field);
    }

    recalibrating = true;
    recalibStartedAt = performance.now();
    recalibLastNow = recalibStartedAt;
    /* Seed from authority size so the wave character scales with the grid,
       not leftover state from the previous density. */
    const sizeKey = (field.cols | 0) * 4099 + (field.rows | 0);
    recalibSeed =
      (Math.imul(
        (recalibStartedAt | 0) ^ sizeKey ^ 0xc41b,
        0x27d4eb2d,
      ) >>> 0) || 0xc41b;

    if (events) {
      events.emit(PixelEvents.PixelRecalibrationStart, {
        cols: field.cols,
        rows: field.rows,
        cell: authority ? authority.cell : sharedGrid && sharedGrid.cell,
        seed: recalibSeed,
        /* Soft sync wave — not a density rebuild. */
        densityGeneration: false,
        n: field.size,
      });
    }
    /* Wake style paint loops — same channel boot/intro already use */
    window.dispatchEvent(
      new CustomEvent('pixelintrostart', {
        detail: { recalibration: true, densityGeneration: false },
      }),
    );
    window.dispatchEvent(new CustomEvent('pixelrecalibrationstart'));
    startLoop();
  }

  /**
   * Stage 5 — rebuild animation on the newly created grid.
   * Simulation + menu must already be initialized for this authority.
   * @param {object} [authorityMaybe]
   */
  function beginRebuildAnimation(authorityMaybe) {
    if (authorityMaybe && typeof authorityMaybe === 'object') {
      const authority = snapshotGridAuthority(authorityMaybe);
      densityAuthority = authority;
      if (!fieldMatchesAuthority(field, authority)) {
        field.allocate(authority.cols, authority.rows, { fresh: true });
        beginInactiveLattice(field);
      }
    }

    densityGenerating = true;
    awaitingDensityRebuild = false;
    setInteractive(false);

    /* Reduced motion — snap every pixel live, then reveal menu. */
    if (prefersReduced || !animConfig.motion) {
      finishSyncLattice(field);
      if (field.presence) field.presence.fill(RECALIBRATION.TO_ENERGY);
      densityGenerating = false;
      awaitingDensityRebuild = false;
      setInteractive(true);
      phase = BootPhase.READY;
      primaryPhase = BootPhase.READY;
      setBootAttr(null);
      densityMenuRestoring = true;
      window.dispatchEvent(
        new CustomEvent('pixelintrostart', {
          detail: { recalibration: false, densityGeneration: false },
        }),
      );
      emitDensityLockChange();
      queueMicrotask(function () {
        restoreMenuAfterSync({ instant: true });
      });
      return;
    }

    emitDensityLockChange();
    beginRecalibration();
  }

  /**
   * Post-teardown density generation — legacy combined path used when the
   * pipeline is unavailable. Prefer destroy → create → rasterize → anim.
   * @param {number|{cols:number,rows:number,cell?:number}} colsOrInfo
   * @param {number} [rowsMaybe]
   */
  function beginDensityGeneration(colsOrInfo, rowsMaybe) {
    destroyPreviousGrid();
    createGridFromAuthority(colsOrInfo, rowsMaybe);
    beginRebuildAnimation(
      colsOrInfo && typeof colsOrInfo === 'object' ? colsOrInfo : null,
    );
  }

  function tickRecalibration(now) {
    if (!recalibrating) return false;

    const dt = recalibLastNow > 0 ? Math.max(0, now - recalibLastNow) : 16.7;
    recalibLastNow = now;

    const elapsed = Math.max(0, now - recalibStartedAt);
    const u = elapsed / RECALIBRATION.DURATION_MS;
    const settled = applyOrganicSyncReveal(
      field,
      RECALIBRATION.FROM_ENERGY,
      RECALIBRATION.TO_ENERGY,
      u,
      {
        scatter: RECALIBRATION.SCATTER,
        soft: RECALIBRATION.SOFT,
        seed: recalibSeed,
        energize: RECALIBRATION.ENERGIZE,
      },
    );
    decaySyncEnergize(field, dt, RECALIBRATION.ENERGIZE_DECAY_MS);

    if (settled && elapsed >= RECALIBRATION.DURATION_MS * 0.92) {
      endRecalibration({ snap: true });
      return false;
    }
    return true;
  }

  function tick(now) {
    if (!running || killed) {
      running = false;
      rafId = 0;
      return;
    }

    if (!lastNow) lastNow = now;
    lastNow = now;

    const teardownAlive = tickTeardown(now);
    const recalibAlive = teardownAlive ? false : tickRecalibration(now);

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
      teardownAlive ||
      recalibAlive ||
      (phase !== BootPhase.SKIPPED &&
        (phase !== BootPhase.READY ||
          intro.isActive() ||
          active.length > 0 ||
          (!interactive && !awaitingDensityRebuild && !tearingDown)));

    if (
      alive ||
      active.length > 0 ||
      nextIndex < stageDefs.length ||
      recalibrating ||
      tearingDown
    ) {
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
    endTeardown({ force: true, snap: true, rebuild: false });
    awaitingDensityRebuild = false;
    densityGenerating = false;
    densityMenuRestoring = false;
    presetRefreshing = false;
    presetMenuRestoring = false;
    endRecalibration({ force: true, snap: true, restoreMenu: false });
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
    const settleMenu = !!(opts.settle && animConfig.motion && !prefersReduced);
    /* data-boot never owns shell layout. Instant paths unlock the shell now;
       Magnetic Lock / directory settle keeps startup locked until hold. */
    setBootAttr(null);
    if (settleMenu) {
      /*
        Intro fires directory hold after Magnetic Lock finishes.
        Listen first so a failed lock (instant hold) still unlocks the shell.
      */
      const onHold = function () {
        window.removeEventListener('pixeldirectoryhold', onHold);
        clearAppStartup();
        window.dispatchEvent(new CustomEvent('pixelbootready'));
      };
      window.addEventListener('pixeldirectoryhold', onHold);
    } else {
      clearAppStartup();
    }
    if (opts.instantDirectory !== false) {
      intro.skipToDirectoryHold(settleMenu ? { settle: true } : undefined);
    }
    started = true;
    if (events) {
      events.emit(PixelEvents.BootPhaseChanged, { phase: BootPhase.READY });
      events.emit(PixelEvents.BootReady, { phase: BootPhase.READY });
    }
    window.dispatchEvent(new CustomEvent('pixelintrostart'));
    if (!settleMenu) {
      window.dispatchEvent(new CustomEvent('pixeldirectorystart'));
      window.dispatchEvent(new CustomEvent('pixeldirectoryhold'));
      window.dispatchEvent(new CustomEvent('pixelbootready'));
    }
    startLoop();
  }

  function cancel() {
    killed = true;
    endTeardown({ force: true, snap: false, rebuild: false });
    awaitingDensityRebuild = false;
    densityGenerating = false;
    densityMenuRestoring = false;
    presetRefreshing = false;
    presetMenuRestoring = false;
    endRecalibration({ force: true, snap: false, restoreMenu: false });
    stopLoop();
    active.forEach((e) => {
      try {
        e.instance.exit(makeCtx(performance.now()));
      } catch (_) {
        /* ignore */
      }
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
    clearAppStartup();
  }

  function skip() {
    /* Exclusive boot (loading ring) cannot be skipped */
    if (isExclusiveBootPhase(phase)) return;

    if (phase === BootPhase.READY || phase === BootPhase.SKIPPED) {
      intro.skip();
      return;
    }
    killed = false;
    /* Tear down in-flight stages cleanly (typography / stabilizing → directory) */
    active.forEach((e) => {
      try {
        e.instance.exit(makeCtx(performance.now()));
      } catch (_) {
        /* ignore */
      }
    });
    active = [];
    jumpToReady({ instantDirectory: true, settle: true });
  }

  function buildAndStart() {
    killed = false;
    interactive = false;
    active = [];
    nextIndex = 0;
    indicator.reset();
    field.clear();
    endTeardown({ force: true, snap: false, rebuild: false });
    awaitingDensityRebuild = false;
    densityGenerating = false;
    densityMenuRestoring = false;
    presetRefreshing = false;
    presetMenuRestoring = false;
    endRecalibration({ force: true, snap: false, restoreMenu: false });

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

    /* Exclusive boot always runs when motion is on. Restored settings
       (including non-Heat styles from a saved preset) stay on animConfig —
       they must not skip the startup sequence or trigger refresh. */

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

    /* Lock content immediately — before fonts.ready — so early grid resize
       cannot bake "Scroll up/down" LEDs into the field ahead of boot. */
    if (intro && typeof intro.suppressContent === 'function') {
      intro.suppressContent();
    }

    if (prefersReduced || !animConfig.motion) {
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
    /* Density pipeline owns lattice size — reject divergent remounts mid-flight. */
    if (densityChangeLocked()) {
      const authority = getDensityAuthority();
      if (authority) {
        if (
          (cols | 0) !== authority.cols ||
          (rows | 0) !== authority.rows
        ) {
          return;
        }
        /* Same size as authority — keep BootField aligned without copying stale presence. */
        if (!fieldMatchesAuthority(field, authority)) {
          field.allocate(authority.cols, authority.rows, {
            fresh: densityGenerating || recalibrating,
          });
        }
        return;
      }
      if (densityGenerating || recalibrating || tearingDown) return;
    }
    /* allocate() copies overlapping presence — never wipe the lattice to black */
    field.allocate(cols, rows);
    if (phase === BootPhase.READY || phase === BootPhase.SKIPPED) {
      if (!recalibrating && !tearingDown && !awaitingDensityRebuild) {
        field.fillPresence(1);
      }
    }
    if (typeof intro.adoptGrid === 'function' && sharedGrid && sharedGrid.cell > 0) {
      intro.adoptGrid({
        cols: cols | 0,
        rows: rows | 0,
        cell: sharedGrid.cell,
        viewW: sharedGrid.viewW,
        viewH: sharedGrid.viewH,
        dpr: sharedGrid.dpr,
      });
    } else {
      intro.onResize(cols, rows);
    }
  }

  /**
   * Pixel Density transition — hide menu and tear down the live lattice.
   * Does not remount or generate a new grid; that happens in a later phase.
   * @param {number} [_cols]
   * @param {number} [_rows]
   */
  function rebuildForDensity(_cols, _rows) {
    /* Soft preset mask hands off — density stages own the lock from here. */
    presetRefreshing = false;
    presetMenuRestoring = false;

    /* Exclusive energy ladder owns presence — still continue into generation
       (generation aborts the boot pipeline and remounts the lattice). */
    if (isExclusiveBootPhase(phase)) {
      if (typeof intro.suppressContent === 'function') {
        intro.suppressContent();
      }
      endTeardown({ force: true, snap: false, rebuild: false });
      endRecalibration({ force: true, snap: false, restoreMenu: false });
      awaitingDensityRebuild = true;
      if (events) {
        events.emit(PixelEvents.PixelDensityTeardownEnd, {
          cols: field.cols,
          rows: field.rows,
          fromExclusiveBoot: true,
        });
      }
      window.dispatchEvent(new CustomEvent('pixeldensityteardownend'));
      emitDensityLockChange();
      return;
    }

    /* Already tearing down — don't stack. */
    if (tearingDown) return;

    /* 1–2. Hide pixel menu immediately and lock content out of the PE canvas */
    if (typeof intro.suppressContent === 'function') {
      intro.suppressContent();
    }

    /* Keep current lattice dimensions — teardown retires these cells in place.
       Pending density remount is deferred until after teardown (separate task). */

    /* Reduced motion / motion off — snap to empty gray panel. */
    if (prefersReduced || !animConfig.motion) {
      finishTeardownLattice(field);
      tearingDown = false;
      awaitingDensityRebuild = true;
      setInteractive(false);
      if (events) {
        events.emit(PixelEvents.PixelDensityTeardownEnd, {
          cols: field.cols,
          rows: field.rows,
          instant: true,
        });
      }
      window.dispatchEvent(
        new CustomEvent('pixelintrostart', { detail: { teardown: false } }),
      );
      window.dispatchEvent(new CustomEvent('pixeldensityteardownend'));
      emitDensityLockChange();
      return;
    }

    /* 3–5. Procedural center-out teardown → gray backlit panel only */
    beginTeardown();
  }

  function presence(i) {
    /*
      Always read the shared BootField presence buffer — the same lattice boot
      generates and Heat paints afterward. A released / unallocated field is
      inactive (0), never a faked completed frame.
    */
    if (!field.presence || field.size === 0) return 0;
    return field.getPresence(i);
  }

  function brightness(i) {
    const boot = field.getBrightness(i);
    /* Exclusive energy / density sync / teardown: only lattice may light cells */
    if (isExclusiveBootPhase(phase) || recalibrating || tearingDown) {
      return boot;
    }
    const led = intro.brightness(i);
    return boot > led ? boot : led;
  }

  function offsetX(i) {
    if (isExclusiveBootPhase(phase) || recalibrating || tearingDown) {
      return field.getOffsetX(i);
    }
    const boot = field.getOffsetX(i);
    if (boot) return boot;
    return intro.offsetX(i);
  }

  function offsetY(i) {
    if (isExclusiveBootPhase(phase) || recalibrating || tearingDown) {
      return field.getOffsetY(i);
    }
    const boot = field.getOffsetY(i);
    if (boot) return boot;
    return intro.offsetY(i);
  }

  function update(now) {
    /* Styles call update each paint frame; ensure boot loop is alive during boot */
    if (
      !running &&
      started &&
      (phase !== BootPhase.SKIPPED || recalibrating || tearingDown)
    ) {
      startLoop();
    }
    if (!running && (recalibrating || tearingDown)) startLoop();
    /* Suppress intro clocks during exclusive boot, density sync, and teardown */
    const contentAlive =
      isExclusiveBootPhase(phase) || recalibrating || tearingDown
        ? false
        : intro.update(now);
    return (
      contentAlive ||
      recalibrating ||
      tearingDown ||
      (phase !== BootPhase.READY &&
        phase !== BootPhase.SKIPPED &&
        phase !== BootPhase.OFF) ||
      running ||
      active.length > 0
    );
  }

  function isActive() {
    return (
      recalibrating ||
      tearingDown ||
      densityGenerating ||
      densityMenuRestoring ||
      presetMenuRestoring ||
      (started &&
        phase !== BootPhase.SKIPPED &&
        (phase !== BootPhase.READY || intro.isActive() || running) &&
        !awaitingDensityRebuild)
    );
  }

  function interactionsEnabled() {
    /* Cursor tracking stays live; exclusive boot / teardown still blocks forces.
       During recalibration, styles gate per-cell via cellInteractive(). */
    if (tearingDown) return true; /* per-cell gate via cellInteractive */
    if (interactive) return true;
    if (!started || killed) return false;
    if (phase === BootPhase.OFF || phase === BootPhase.SKIPPED) {
      return recalibrating;
    }
    return !isExclusiveBootPhase(phase);
  }

  /**
   * True when cursor / pixel forces may affect cell i.
   * During recalibration, only synchronized cells accept interaction.
   * During teardown, cells drop out as the collapse front reaches them.
   * @param {number} i
   */
  function cellInteractive(i) {
    if (tearingDown) {
      if (!field.presence) return false;
      return field.getPresence(i) >= TEARDOWN.INTERACT_PRESENCE;
    }
    if (!recalibrating) return true;
    if (!field.presence) return true;
    return field.getPresence(i) >= RECALIBRATION.INTERACT_PRESENCE;
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
    /* Exclusive + lattice phases only — intro never writes data-boot. */
    return isLatticeBootPhase(phase);
  }

  function indicatorAccentActive() {
    return isIndicatorAccentPhase(phase);
  }

  function recalibrationActive() {
    return recalibrating;
  }

  function teardownActive() {
    return tearingDown;
  }

  /**
   * Neutral FIELD colors during teardown, generation, and sync —
   * not during menu restore (theme may return).
   */
  function densityOpsNeutral() {
    return (
      tearingDown ||
      recalibrating ||
      densityGenerating ||
      awaitingDensityRebuild ||
      presetRefreshing
    );
  }

  /**
   * True while any density / preset transition stage is in flight —
   * teardown, generation, menu restore, or deferred remount.
   */
  function densityChangeLocked() {
    return (
      tearingDown ||
      recalibrating ||
      densityGenerating ||
      densityMenuRestoring ||
      awaitingDensityRebuild ||
      presetRefreshing ||
      presetMenuRestoring
    );
  }

  function presetRefreshActive() {
    return presetRefreshing || presetMenuRestoring || recalibrating;
  }

  /** Begin density teardown (menu hide + center-out collapse). */
  function beginDensityTeardown() {
    rebuildForDensity(field.cols, field.rows);
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
  /* Density / soft-preset menu assemble completes on directory hold. */
  window.addEventListener('pixeldirectoryhold', completeDensityTransition);
  window.addEventListener('pixeldirectoryhold', completePresetMenuRestore);

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
    rebuildForDensity,
    beginDensityTeardown,
    destroyPreviousGrid,
    createGridFromAuthority,
    beginRebuildAnimation,
    beginDensityGeneration,
    beginPresetRefresh,
    finishPresetRefreshInstant,
    setPresetEffectsAllowed,
    arePresetEffectsAllowed,
    bindDensityRebuild,
    setDensityAuthority,
    getDensityAuthority,
    isActive,
    isReady,
    interactionsEnabled,
    cellInteractive,
    recalibrationActive,
    teardownActive,
    densityOpsNeutral,
    densityChangeLocked,
    presetRefreshActive,
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
