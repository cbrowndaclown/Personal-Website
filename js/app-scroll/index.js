/* ==========================================================================
   App scroll controller — light (screen × nav) stepping

   Single authority for Top Navigation + screen step:

     • `step` is the only source of truth for (screen × nav)
     • `requestStep()` is the only path that mutates step / nav DOM
     • Open, close, animation completion, and scroll sync never race:
         - busy transitions reject all other step requests
         - scroll listeners never change nav, and are paused while busy
         - gesture lock drains inertia before another nav edge can commit

   Nav open/close is intercepted only at settled screen edges.
   Screen changes use native scroll + CSS snap on #app-scroll (never the ribbon).
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

  const screenIds = options.screenIds && options.screenIds.length
    ? options.screenIds.slice()
    : ['pixel-fs-screen-1', 'pixel-fs-screen-2'];
  const screenCount = screenIds.length;

  const GESTURE_IDLE_MS = options.gestureIdleMs ?? 180;
  const prefersReduced =
    options.prefersReduced ??
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** @type {import('./scroll-state.js').ScrollStep} */
  let step = defaultScrollStep(screenCount);
  let interactive = false;

  /**
   * Transition generation — sole owner of open/close/settle.
   * Non-zero while a requestStep run owns the DOM; stale completions ignore.
   */
  let transitionGen = 0;
  /** True after a committed step until input goes idle (drains inertia). */
  let gestureLocked = false;
  /** True while the shell is mid native snap / smooth scroll. */
  let shellMoving = false;

  let gestureIdleTimer = 0;
  /** Nav transitionend fallback — owned by the active transitionGen. */
  let navWaitFallback = 0;
  /** Smooth-scroll settle fallback — never shared with scroll debounce. */
  let shellSettleTimer = 0;
  /** Scroll-idle debounce for screen sync only. */
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

  function navTransitionMs() {
    if (prefersReduced) return 0;
    const style = getComputedStyle(nav);
    const props = (style.transitionProperty || '').split(',');
    const durs = (style.transitionDuration || '0.58s').split(',');
    for (let i = 0; i < props.length; i++) {
      const prop = props[i].trim();
      if (prop !== 'margin-top' && prop !== 'margin' && prop !== 'all') continue;
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
      /* Never release while a transition still owns nav/screen. */
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
   * Sole DOM writer for Top Navigation visibility.
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
        nav.removeEventListener('transitionend', onEnd);
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
        if (e.target !== nav) return;
        if (e.propertyName && e.propertyName !== 'margin-top') return;
        finish();
      };
      nav.addEventListener('transitionend', onEnd);
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
      /* Safari / older engines may lack scrollend. */
      shellSettleTimer = window.setTimeout(finish, prefersReduced ? 0 : 480);
    });
  }

  /**
   * Authoritative step transition. Rejects if another transition is in flight
   * so open/close animations are never interrupted.
   * @param {import('./scroll-state.js').ScrollStep} next
   * @param {{ animate?: boolean }} [opts]
   * @returns {Promise<boolean>} True when this call owned and finished the step.
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

    /* No-op for duplicate requests — still pin the shell once at init. */
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
        /* Snap shell after nav layout; scroll sync stays paused until gen clears. */
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

  /**
   * Scroll may update the active screen index only. It never opens/closes nav,
   * and never runs while a transition owns the shell.
   */
  function syncStepFromScroll() {
    if (!interactive || isBusy() || gestureLocked) return;
    const screen = nearestScreenIndex();
    if (screen === step.screen) return;
    step = { screen, nav: step.nav };
    frame.dataset.appScreen = String(screen);
    publish();
  }

  function onShellScroll() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      /* Layout noise during a owned transition must not start a parallel settle. */
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
    /* Stay inert until exclusive boot releases the application shell. */
    if (isAppStartup()) return;
    interactive = true;
    requestAnimationFrame(() => {
      if (!isBusy()) void syncShellToCurrentScreen(false);
    });
  }

  /* Shell unlocks only after exclusive boot releases data-app-startup. */
  window.addEventListener('pixelstartupdone', unlock);
  window.addEventListener('pixeldirectoryhold', unlock);

  /**
   * Nav-only edge: consume the gesture and commit immediately (no distance accum).
   * Screen changes fall through to native snap.
   * @param {number} direction  Negative = up; positive = down
   * @returns {'nav' | 'native' | 'block' | 'noop'}
   */
  function classifyGesture(direction) {
    if (!interactive || !direction) return 'noop';
    if (isBusy() || gestureLocked) return 'block';
    /* While CSS snap is settling, never steal the gesture for nav. */
    if (shellMoving) return 'native';

    if (direction > 0 && step.nav === NavState.OPEN) return 'nav';
    if (direction < 0 && step.nav === NavState.CLOSED) return 'nav';
    return 'native';
  }

  /**
   * @param {number} direction
   * @returns {boolean}
   */
  function commitNavStep(direction) {
    if (isBusy() || gestureLocked) return false;
    const next = transitionScrollStep(step, direction, screenCount);
    /* Nav edges only — screen changes are native snap. */
    if (stepsEqual(next, step) || next.screen !== step.screen) return false;
    void requestStep(next, { animate: true });
    return true;
  }

  /**
   * Programmatic path (keyboard / goTo) — may change screen and/or nav.
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
    return !!(target && target.closest && (
      target.closest('.settings') ||
      target.closest('input') ||
      target.closest('textarea') ||
      target.closest('select') ||
      target.closest('[contenteditable="true"]')
    ));
  }

  /* ── Wheel / trackpad — intercept only nav edges ──────────────────────── */
  window.addEventListener(
    'wheel',
    (e) => {
      if (!interactive) return;
      if (ignoredTarget(e.target)) return;

      const direction = Math.sign(e.deltaY);
      if (!direction) return;

      const kind = classifyGesture(direction);

      if (kind === 'noop') return;

      if (kind === 'block') {
        /* Hold the line while a transition or post-commit inertia drain runs. */
        e.preventDefault();
        unlockGestureWhenIdle();
        return;
      }

      if (kind === 'nav') {
        e.preventDefault();
        commitNavStep(direction);
        return;
      }

      /* kind === 'native' — do not preventDefault; snap owns the screen step. */
    },
    { passive: false }
  );

  /* ── Touch — same edge rule; otherwise let the shell scroll natively ─── */
  let touchActive = false;
  let touchStartX = 0;
  let touchStartY = 0;
  let touchLastY = 0;
  let touchAxisLocked = false;
  let touchIsVertical = false;
  let touchNavArmed = false;

  window.addEventListener(
    'touchstart',
    (e) => {
      if (!interactive || e.touches.length !== 1 || ignoredTarget(e.target)) {
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
      touchNavArmed = false;
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
      /* Finger down → content up (negative direction). */
      const direction = Math.sign(-deltaFinger);
      if (!direction) return;

      const kind = classifyGesture(direction);

      if (kind === 'block' || kind === 'nav') {
        e.preventDefault();
        if (kind === 'block') {
          unlockGestureWhenIdle();
          return;
        }
        if (touchNavArmed) return;
        touchNavArmed = true;
        commitNavStep(direction);
        return;
      }

      /* native — allow default touch scrolling / snap */
    },
    { passive: false }
  );

  function endTouchGesture() {
    touchActive = false;
    touchAxisLocked = false;
    touchIsVertical = false;
    touchNavArmed = false;
    unlockGestureWhenIdle();
  }

  window.addEventListener('touchend', endTouchGesture, { passive: true });
  window.addEventListener('touchcancel', endTouchGesture, { passive: true });

  /* ── Keyboard ─────────────────────────────────────────────────────────── */
  window.addEventListener(
    'keydown',
    (e) => {
      if (!interactive || isBusy()) return;
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
        { screen, nav: navState || NavState.OPEN },
        screenCount
      ),
      { animate: animate !== false }
    );
  }

  function goHome() {
    return goTo(0, NavState.OPEN, true);
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

  void requestStep(step, { animate: false });

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
