/* ==========================================================================
   App scroll controller — (screen × nav) stepping

   Single authority for Top Navigation + screen step:

     • `step` is the only source of truth for (screen × nav)
     • `requestStep()` is the only path that mutates step / nav DOM
     • One deliberate gesture → exactly one edge (never skip)
     • Nav open/close uses existing site-frame transform animation
     • Screen changes are programmatic on #app-scroll (CSS snap still
       defines resting points; free scroll is prevented)

   Unlock mirrors prior topnav: pixeldirectory* / pixelbootready.
   ========================================================================== */

import {
  NavState,
  clampScrollStep,
  defaultScrollStep,
  stepsEqual,
  transitionScrollStep,
} from './scroll-state.js';
import { isAppStartup } from '../app-startup.js';

/**
 * @typedef {object} AppScrollOptions
 * @property {HTMLElement} frame
 * @property {HTMLElement} nav
 * @property {HTMLElement} shell  #app-scroll — never the ribbon frame
 * @property {string[]} [screenIds]
 * @property {number} [gestureIdleMs]
 * @property {boolean} [prefersReduced]
 */

/**
 * @param {AppScrollOptions} options
 */
export function initAppScroll(options) {
  const frame = options.frame;
  const nav = options.nav;
  const shell = options.shell;
  if (!frame || !nav || !shell) return null;

  const screenIds =
    options.screenIds && options.screenIds.length
      ? options.screenIds.slice()
      : ['pixel-fs-screen-1', 'pixel-fs-screen-2'];
  const screenCount = screenIds.length;

  const GESTURE_IDLE_MS = options.gestureIdleMs ?? 180;
  const prefersReduced =
    options.prefersReduced ??
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  /** @type {import('./scroll-state.js').ScrollStep} */
  let step = defaultScrollStep(screenCount);
  let interactive = false;

  let transitionGen = 0;
  let gestureLocked = false;
  let shellMoving = false;

  let gestureIdleTimer = 0;
  let navWaitFallback = 0;
  let shellSettleTimer = 0;
  let scrollDebounceTimer = 0;
  let scrollRaf = 0;

  function isBusy() {
    return transitionGen !== 0;
  }

  function currentStep() {
    return step;
  }

  function screenEl(screenIndex) {
    const id = screenIds[screenIndex];
    return id ? document.getElementById(id) : null;
  }

  function screenScrollTop(screenIndex) {
    const el = screenEl(screenIndex);
    if (!el) return 0;
    const shellRect = shell.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    return Math.max(0, shell.scrollTop + (elRect.top - shellRect.top));
  }

  function nearestScreenIndex() {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < screenCount; i++) {
      const d = Math.abs(shell.scrollTop - screenScrollTop(i));
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  /* Existing nav motion is site-frame transform (0.58s), not nav margin. */
  function navTransitionMs() {
    if (prefersReduced) return 0;
    const style = getComputedStyle(frame);
    const props = (style.transitionProperty || '').split(',');
    const durs = (style.transitionDuration || '0.58s').split(',');
    for (let i = 0; i < props.length; i++) {
      const prop = props[i].trim();
      if (prop !== 'transform' && prop !== 'all') continue;
      const d = (durs[i] || durs[durs.length - 1] || '0.58s').trim();
      if (d.endsWith('ms')) return Math.max(0, parseFloat(d) || 0);
      if (d.endsWith('s')) return Math.max(0, (parseFloat(d) || 0) * 1000);
    }
    return 580;
  }

  function clearGestureIdleTimer() {
    if (gestureIdleTimer) {
      clearTimeout(gestureIdleTimer);
      gestureIdleTimer = 0;
    }
  }

  function unlockGestureWhenIdle() {
    clearGestureIdleTimer();
    gestureIdleTimer = window.setTimeout(() => {
      gestureIdleTimer = 0;
      if (isBusy()) {
        unlockGestureWhenIdle();
        return;
      }
      gestureLocked = false;
    }, GESTURE_IDLE_MS);
  }

  function armGestureLock() {
    gestureLocked = true;
    clearGestureIdleTimer();
  }

  function publish() {
    window.dispatchEvent(
      new CustomEvent('appscrollchange', {
        detail: {
          screen: step.screen,
          nav: step.nav,
          screenCount,
        },
      })
    );
  }

  /**
   * Sole DOM writer for Top Navigation visibility — preserves is-nav-revealed.
   * @param {boolean} navOpen
   * @param {boolean} wasOpen
   */
  function applyNavDom(navOpen, wasOpen) {
    frame.classList.toggle('is-nav-revealed', navOpen);
    nav.setAttribute('aria-hidden', navOpen ? 'false' : 'true');
    frame.dataset.appNav = navOpen ? NavState.OPEN : NavState.CLOSED;
    if (wasOpen && !navOpen) {
      window.dispatchEvent(new CustomEvent('topnavhide'));
    }
  }

  /**
   * @param {number} gen
   * @param {boolean} navChanged
   * @param {boolean} animate
   */
  function waitForNavTransition(gen, navChanged, animate) {
    if (!navChanged || !animate || prefersReduced) return Promise.resolve();
    const ms = navTransitionMs();
    if (ms <= 0) return Promise.resolve();

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        frame.removeEventListener('transitionend', onEnd);
        if (navWaitFallback) {
          clearTimeout(navWaitFallback);
          navWaitFallback = 0;
        }
        resolve();
      };
      const onEnd = (e) => {
        if (gen !== transitionGen) {
          finish();
          return;
        }
        if (e.target !== frame) return;
        if (e.propertyName && e.propertyName !== 'transform') return;
        finish();
      };
      frame.addEventListener('transitionend', onEnd);
      navWaitFallback = window.setTimeout(finish, ms + 40);
    });
  }

  function syncShellToCurrentScreen(smooth) {
    const targetY = screenScrollTop(step.screen);
    if (Math.abs(shell.scrollTop - targetY) < 1) return Promise.resolve();

    if (!smooth || prefersReduced) {
      shell.scrollTop = targetY;
      return Promise.resolve();
    }

    shellMoving = true;
    shell.scrollTo({ top: targetY, behavior: 'smooth' });
    return waitForShellSettle();
  }

  function waitForShellSettle() {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        shell.removeEventListener('scrollend', finish);
        if (shellSettleTimer) {
          clearTimeout(shellSettleTimer);
          shellSettleTimer = 0;
        }
        shellMoving = false;
        resolve();
      };
      shell.addEventListener('scrollend', finish, { once: true });
      shellSettleTimer = window.setTimeout(finish, prefersReduced ? 0 : 480);
    });
  }

  /**
   * @param {import('./scroll-state.js').ScrollStep} next
   * @param {{ animate?: boolean }} [opts]
   * @returns {Promise<boolean>}
   */
  async function requestStep(next, opts) {
    if (isBusy()) return false;

    const clamped = clampScrollStep(next, screenCount);
    const animate = !opts || opts.animate !== false;
    const prev = step;
    const navOpen = clamped.nav === NavState.OPEN;
    const wasOpen = frame.classList.contains('is-nav-revealed');
    const navChanged = wasOpen !== navOpen;
    const screenChanged = prev.screen !== clamped.screen;
    const alreadySettled =
      stepsEqual(clamped, step) &&
      !navChanged &&
      frame.dataset.appScreen === String(clamped.screen);

    if (alreadySettled) {
      step = clamped;
      void syncShellToCurrentScreen(false);
      return false;
    }

    step = clamped;

    const gen = ++transitionGen;
    armGestureLock();

    frame.dataset.appScreen = String(step.screen);
    applyNavDom(navOpen, wasOpen);

    try {
      if (navChanged) {
        await waitForNavTransition(gen, true, animate);
        if (gen !== transitionGen) return false;
        await syncShellToCurrentScreen(false);
      } else if (screenChanged) {
        await syncShellToCurrentScreen(animate);
      } else {
        await syncShellToCurrentScreen(false);
      }
      if (gen !== transitionGen) return false;
    } finally {
      if (gen === transitionGen) {
        transitionGen = 0;
        unlockGestureWhenIdle();
        publish();
      }
    }

    return true;
  }

  function syncStepFromScroll() {
    if (!interactive || isBusy() || gestureLocked) return;
    const screen = nearestScreenIndex();
    if (screen === step.screen) return;
    /* Native snap may only change screen; nav is unchanged (no skipped edges). */
    step = { screen, nav: step.nav };
    frame.dataset.appScreen = String(screen);
    publish();
  }

  function onShellScroll() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      if (isBusy()) return;
      shellMoving = true;
      if (scrollDebounceTimer) clearTimeout(scrollDebounceTimer);
      scrollDebounceTimer = window.setTimeout(() => {
        scrollDebounceTimer = 0;
        shellMoving = false;
        syncStepFromScroll();
      }, 120);
    });
  }

  function onShellScrollEnd() {
    if (scrollDebounceTimer) {
      clearTimeout(scrollDebounceTimer);
      scrollDebounceTimer = 0;
    }
    if (isBusy()) return;
    shellMoving = false;
    syncStepFromScroll();
  }

  function unlock() {
    if (interactive) return;
    /* Stay inert until exclusive boot releases the application shell. */
    if (isAppStartup()) return;
    interactive = true;
    /* Stay on Screen 1 + Closed (parked) so the field stays flush through
       intro/directory — same as prior topnav. S1+Open is one up-gesture away. */
    requestAnimationFrame(() => {
      if (!isBusy()) void syncShellToCurrentScreen(false);
    });
  }

  /* Same unlock gates as the previous topnav controller, plus the shell
     release that clears data-app-startup after exclusive boot. */
  window.addEventListener('pixelstartupdone', unlock);
  window.addEventListener('pixeldirectorystart', unlock);
  window.addEventListener('pixeldirectoryhold', unlock);
  window.addEventListener('pixelbootready', unlock);

  /**
   * Every deliberate gesture commits exactly one state edge.
   * @param {number} direction  Negative = up; positive = down
   * @returns {'step' | 'block' | 'noop'}
   */
  function classifyGesture(direction) {
    if (!interactive || !direction) return 'noop';
    if (isBusy() || gestureLocked || shellMoving) return 'block';
    const next = transitionScrollStep(step, direction, screenCount);
    if (stepsEqual(next, step)) return 'block';
    return 'step';
  }

  /**
   * @param {number} direction
   * @returns {boolean}
   */
  function commitStep(direction) {
    if (!interactive || isBusy() || gestureLocked || !direction) return false;
    const next = transitionScrollStep(step, direction, screenCount);
    if (stepsEqual(next, step)) return false;
    void requestStep(next, { animate: true });
    return true;
  }

  function ignoredTarget(target) {
    return !!(
      target &&
      target.closest &&
      (target.closest('.settings') ||
        target.closest('.settings-stage') ||
        target.closest('input') ||
        target.closest('textarea') ||
        target.closest('select') ||
        target.closest('[contenteditable="true"]'))
    );
  }

  /* Full screen settings owns the display — no screen / nav steps until it leaves. */
  function settingsStageOpen() {
    return document.body.hasAttribute('data-settings-stage');
  }

  /* ── Wheel — one state edge per trackpad/mouse series (not per delta) ───
     Trackpad momentum fires many wheel events. Without a series latch,
     blocked ticks kept re-arming the idle timer so the swipe ended before
     unlock — first swipes failed while keyboard (one event) worked. */
  let wheelLatched = false;
  let wheelAccum = 0;
  let wheelIdleTimer = 0;
  let wheelSeriesDir = 0;
  const WHEEL_THRESHOLD = 48;

  function endWheelSeries() {
    if (wheelIdleTimer) {
      clearTimeout(wheelIdleTimer);
      wheelIdleTimer = 0;
    }
    wheelLatched = false;
    wheelAccum = 0;
    wheelSeriesDir = 0;
    unlockGestureWhenIdle();
  }

  function armWheelSeriesIdle() {
    if (wheelIdleTimer) clearTimeout(wheelIdleTimer);
    wheelIdleTimer = window.setTimeout(() => {
      wheelIdleTimer = 0;
      endWheelSeries();
    }, GESTURE_IDLE_MS);
  }

  window.addEventListener(
    'wheel',
    (e) => {
      if (!interactive || settingsStageOpen()) return;
      if (ignoredTarget(e.target)) return;

      const direction = Math.sign(e.deltaY);
      if (!direction) return;

      /* New series after idle — parity with touchstart / keydown unlock.
         Must run before classifyGesture so a fresh swipe is not stuck
         behind the post-transition soft lock. */
      const seriesStart = !wheelLatched && wheelAccum === 0 && !wheelSeriesDir;
      if (seriesStart && !isBusy()) {
        gestureLocked = false;
        clearGestureIdleTimer();
      }

      const kind = classifyGesture(direction);
      if (kind === 'noop') return;

      /* Consume so native snap cannot free-scroll / skip states. */
      e.preventDefault();
      armWheelSeriesIdle();

      /* Already stepped this swipe — eat momentum only. */
      if (wheelLatched) return;

      /* Direction flip within residual momentum starts a fresh accum. */
      if (wheelSeriesDir && wheelSeriesDir !== direction) {
        wheelAccum = 0;
      }
      wheelSeriesDir = direction;

      if (kind === 'block') {
        /* Do not re-arm unlockGestureWhenIdle on every momentum tick. */
        return;
      }

      /* Re-check after soft unlock — classify may have run while busy. */
      if (isBusy() || gestureLocked || shellMoving) return;

      wheelAccum += Math.abs(e.deltaY);
      if (wheelAccum < WHEEL_THRESHOLD) return;

      wheelLatched = true;
      wheelAccum = 0;
      commitStep(direction);
    },
    { passive: false }
  );

  /* ── Touch — same one-edge rule ───────────────────────────────────────── */
  let touchActive = false;
  let touchStartX = 0;
  let touchStartY = 0;
  let touchLastY = 0;
  let touchAxisLocked = false;
  let touchIsVertical = false;
  let touchStepArmed = false;

  window.addEventListener(
    'touchstart',
    (e) => {
      if (
        !interactive ||
        settingsStageOpen() ||
        e.touches.length !== 1 ||
        ignoredTarget(e.target)
      ) {
        touchActive = false;
        return;
      }
      const t = e.touches[0];
      touchActive = true;
      touchStartX = t.clientX;
      touchStartY = t.clientY;
      touchLastY = t.clientY;
      touchAxisLocked = false;
      touchIsVertical = false;
      touchStepArmed = false;
      if (!isBusy()) {
        gestureLocked = false;
        clearGestureIdleTimer();
      }
    },
    { passive: true }
  );

  window.addEventListener(
    'touchmove',
    (e) => {
      if (!interactive || !touchActive || e.touches.length !== 1) return;

      const t = e.touches[0];
      const dx = t.clientX - touchStartX;
      const dy = t.clientY - touchStartY;

      if (!touchAxisLocked) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        touchAxisLocked = true;
        touchIsVertical = Math.abs(dy) >= Math.abs(dx);
        if (!touchIsVertical) {
          touchActive = false;
          return;
        }
      } else if (!touchIsVertical) {
        return;
      }

      const deltaFinger = t.clientY - touchLastY;
      touchLastY = t.clientY;
      const direction = Math.sign(-deltaFinger);
      if (!direction) return;

      const kind = classifyGesture(direction);
      if (kind === 'noop') return;

      e.preventDefault();
      if (kind === 'block') {
        unlockGestureWhenIdle();
        return;
      }
      if (touchStepArmed) return;
      touchStepArmed = true;
      commitStep(direction);
    },
    { passive: false }
  );

  function endTouchGesture() {
    touchActive = false;
    touchAxisLocked = false;
    touchIsVertical = false;
    touchStepArmed = false;
    unlockGestureWhenIdle();
  }

  window.addEventListener('touchend', endTouchGesture, { passive: true });
  window.addEventListener('touchcancel', endTouchGesture, { passive: true });

  /* ── Keyboard — one step per key press ────────────────────────────────── */
  window.addEventListener(
    'keydown',
    (e) => {
      if (!interactive || settingsStageOpen() || isBusy()) return;
      if (ignoredTarget(e.target)) return;

      let direction = 0;
      switch (e.key) {
        case 'ArrowDown':
        case 'PageDown':
          direction = 1;
          break;
        case 'ArrowUp':
        case 'PageUp':
          direction = -1;
          break;
        case 'Home':
          e.preventDefault();
          if (e.repeat) return;
          void goHome();
          return;
        default:
          return;
      }

      e.preventDefault();
      if (e.repeat) return;

      gestureLocked = false;
      clearGestureIdleTimer();
      commitStep(direction);
    },
    { passive: false }
  );

  /**
   * @param {number} screen
   * @param {import('./scroll-state.js').NavStateValue} [navState]
   * @param {boolean} [animate]
   */
  function goTo(screen, navState, animate) {
    if (isBusy()) return Promise.resolve(false);
    return requestStep(
      clampScrollStep(
        { screen, nav: navState != null ? navState : NavState.OPEN },
        screenCount
      ),
      { animate: animate !== false }
    );
  }

  function goHome() {
    /* Parked landing — preserves prior brand-home behavior */
    return goTo(0, NavState.CLOSED, true);
  }

  const homeBtn = document.getElementById('nav-home');
  if (homeBtn) {
    homeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (!interactive || settingsStageOpen()) return;
      void goHome();
    });
  }

  shell.addEventListener('scroll', onShellScroll, { passive: true });
  shell.addEventListener('scrollend', onShellScrollEnd, { passive: true });
  window.addEventListener(
    'resize',
    () => {
      if (!isBusy()) void syncShellToCurrentScreen(false);
    },
    { passive: true }
  );

  /* Boot-safe pin: Screen 1, nav parked until unlock applies start state. */
  shell.scrollTop = 0;
  step = { screen: 0, nav: NavState.CLOSED };
  frame.dataset.appScreen = '0';
  frame.dataset.appNav = NavState.CLOSED;
  applyNavDom(false, false);

  return {
    getStep: currentStep,
    getScreenCount: () => screenCount,
    goTo,
    goHome,
    unlock,
    isInteractive: () => interactive,
    isAnimating: () => isBusy(),
  };
}
