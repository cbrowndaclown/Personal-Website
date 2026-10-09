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

  /* ── Screen glide — eased scroll between Pixel FS screens ─────────────
     Native smooth scroll is short and abrupt and its timing varies by
     browser. Drive scrollTop ourselves with a soft ease-in-out, with snap off
     for the duration so the browser cannot re-snap mid glide. */
  const GLIDE_MS = 680;
  let glideRaf = 0;
  let glideFinish = null;

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function cancelGlide() {
    if (glideRaf) {
      cancelAnimationFrame(glideRaf);
      glideRaf = 0;
    }
    if (glideFinish) {
      const finish = glideFinish;
      glideFinish = null;
      finish();
    }
  }

  /**
   * @param {number} targetY
   * @param {boolean} [fromDrag]  Page already moved a little with the gesture.
   */
  function glideShellTo(targetY, fromDrag) {
    cancelGlide();
    cancelSpring();
    /* Ease in-out either way — an ease-out handoff read as coasting. */
    const ease = easeInOutCubic;
    const duration = fromDrag ? GLIDE_MS * 0.9 : GLIDE_MS;
    return new Promise((resolve) => {
      const fromY = shell.scrollTop;
      const dist = targetY - fromY;
      let startAt = 0;
      shellMoving = true;
      shell.style.scrollSnapType = 'none';
      glideFinish = () => {
        glideRaf = 0;
        glideFinish = null;
        shell.scrollTop = targetY;
        shell.style.scrollSnapType = '';
        shellMoving = false;
        resolve();
      };
      const frameStep = (now) => {
        if (!startAt) startAt = now;
        const t = Math.min(1, (now - startAt) / duration);
        shell.scrollTop = fromY + dist * ease(t);
        if (t < 1) {
          glideRaf = requestAnimationFrame(frameStep);
        } else if (glideFinish) {
          glideFinish();
        }
      };
      glideRaf = requestAnimationFrame(frameStep);
    });
  }

  function syncShellToCurrentScreen(smooth, fromDrag) {
    const targetY = screenScrollTop(step.screen);
    if (Math.abs(shell.scrollTop - targetY) < 1) {
      cancelSpring();
      shell.style.scrollSnapType = '';
      return Promise.resolve();
    }

    if (!smooth || prefersReduced) {
      cancelGlide();
      cancelSpring();
      shell.scrollTop = targetY;
      shell.style.scrollSnapType = '';
      return Promise.resolve();
    }

    return glideShellTo(targetY, fromDrag);
  }

  /* ── Drag follow — a trackpad / touch scroll toward the other screen moves
     the page with the gesture first, then glides the rest of the way once
     it commits, or springs back when it does not. Nav-only steps (the nav
     slides from the frame) keep their discrete trigger. ──────────────── */
  const DRAG_FOLLOW = 0.1;      /* page px per wheel px while following */
  const DRAG_MAX_PX = 16;       /* follow is a hint of motion, not a free scroll */
  const DRAG_COMMIT = 300;      /* wheel px that commits the screen change */
  const DRAG_RELEASE_MS = 160;  /* quiet time before an uncommitted drag returns */
  const SPRING_MS = 280;
  let dragging = false;
  let dragDir = 0;
  let dragAccum = 0;
  let dragBaseY = 0;
  let dragReleaseTimer = 0;
  let springRaf = 0;

  /** True when a gesture this way would change screens (not just the nav). */
  function isScreenGesture(direction) {
    return transitionScrollStep(step, direction, screenCount).screen !== step.screen;
  }

  function cancelSpring() {
    if (springRaf) {
      cancelAnimationFrame(springRaf);
      springRaf = 0;
    }
  }

  function clearDragRelease() {
    if (dragReleaseTimer) {
      clearTimeout(dragReleaseTimer);
      dragReleaseTimer = 0;
    }
  }

  function dragTo(direction, offsetPx) {
    cancelSpring();
    if (!dragging) {
      dragging = true;
      dragAccum = 0;
      dragBaseY = screenScrollTop(step.screen);
      shell.style.scrollSnapType = 'none';
    }
    dragDir = direction;
    shell.scrollTop = dragBaseY + offsetPx;
  }

  function springBack() {
    clearDragRelease();
    if (!dragging) return;
    dragging = false;
    dragAccum = 0;
    const fromY = shell.scrollTop;
    const toY = dragBaseY;
    let startAt = 0;
    const frameStep = (now) => {
      if (!startAt) startAt = now;
      const t = Math.min(1, (now - startAt) / SPRING_MS);
      shell.scrollTop = fromY + (toY - fromY) * easeOutCubic(t);
      if (t < 1) {
        springRaf = requestAnimationFrame(frameStep);
      } else {
        springRaf = 0;
        shell.style.scrollSnapType = '';
      }
    };
    springRaf = requestAnimationFrame(frameStep);
  }

  function armDragRelease() {
    clearDragRelease();
    dragReleaseTimer = window.setTimeout(() => {
      dragReleaseTimer = 0;
      springBack();
    }, DRAG_RELEASE_MS);
  }

  /** Hand the moving page to the screen glide. */
  function commitDrag(direction) {
    clearDragRelease();
    dragging = false;
    dragAccum = 0;
    if (!interactive || isBusy()) {
      springBack();
      return;
    }
    gestureLocked = false;
    const next = transitionScrollStep(step, direction, screenCount);
    void requestStep(next, { animate: true, fromDrag: true });
  }

  /**
   * @param {import('./scroll-state.js').ScrollStep} next
   * @param {{ animate?: boolean, fromDrag?: boolean }} [opts]
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
      if (screenChanged) {
        /* The nav slides while the screen glides — one motion, not two. */
        await Promise.all([
          waitForNavTransition(gen, navChanged, animate),
          syncShellToCurrentScreen(animate, !!(opts && opts.fromDrag)),
        ]);
      } else if (navChanged) {
        await waitForNavTransition(gen, true, animate);
        if (gen !== transitionGen) return false;
        await syncShellToCurrentScreen(false);
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
    /* Movement this controller drives (follow, spring, glide) is not a
       native scroll — don't let it lock out the gesture that caused it. */
    if (dragging || springRaf || glideRaf) return;
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
        target.closest('input') ||
        target.closest('textarea') ||
        target.closest('select') ||
        target.closest('[contenteditable="true"]'))
    );
  }

  /* ── Wheel — one state edge per trackpad/mouse swipe (not per delta) ───
     Trackpad momentum keeps firing wheel events for ~1s after the fingers
     lift. A series latch eats that momentum, and a series ends on a quiet
     gap measured between event timestamps — not a timer, which can fire
     while queued momentum is still waiting behind a busy frame.

     A fresh swipe made during the old momentum shows up as a surge: the
     last few ticks average well above the ticks before them (momentum only
     decays). Averages, not single ticks, so coalesced events cannot fake
     one. A surge during a transition is held and released once it ends. */
  let wheelLatched = false;
  let wheelAccum = 0;
  let wheelSeriesDir = 0;
  let wheelLastTs = -Infinity;
  let wheelSurgePending = false;
  /* Mouse notches step at once; trackpads need a deliberate swipe. */
  const WHEEL_THRESHOLD = 40;
  const WHEEL_THRESHOLD_TRACKPAD = 120; /* nav open / close — lighter than a screen change */
  /* Quiet gap that ends a series (momentum ticks arrive every ~16ms). */
  const WHEEL_IDLE_MS = 140;
  const WHEEL_SURGE_RATIO = 2.5;
  const WHEEL_SURGE_MIN = 14;
  const WHEEL_RECENT = 3;
  const WHEEL_HISTORY = 10;
  const wheelHistory = [];

  function wheelSurge() {
    const n = wheelHistory.length;
    if (n < WHEEL_HISTORY) return false;
    let recent = 0;
    let before = 0;
    for (let i = 0; i < n; i++) {
      if (i >= n - WHEEL_RECENT) recent += wheelHistory[i];
      else before += wheelHistory[i];
    }
    recent /= WHEEL_RECENT;
    before /= n - WHEEL_RECENT;
    return recent >= WHEEL_SURGE_MIN && recent > before * WHEEL_SURGE_RATIO;
  }

  function resetWheelSeries() {
    wheelLatched = false;
    wheelAccum = 0;
    wheelSeriesDir = 0;
    wheelSurgePending = false;
    wheelHistory.length = 0;
  }

  window.addEventListener(
    'wheel',
    (e) => {
      if (!interactive) return;
      if (ignoredTarget(e.target)) return;

      const direction = Math.sign(e.deltaY);
      if (!direction) return;

      const ts = e.timeStamp || performance.now();
      const quiet = ts - wheelLastTs > WHEEL_IDLE_MS;
      wheelLastTs = ts;
      if (quiet) resetWheelSeries();

      wheelHistory.push(Math.abs(e.deltaY));
      if (wheelHistory.length > WHEEL_HISTORY) wheelHistory.shift();

      /* New swipe riding the old momentum (surge or reversal). */
      if (wheelLatched && (direction !== wheelSeriesDir || wheelSurge())) {
        wheelSurgePending = true;
        wheelHistory.length = 0;
      }
      if (wheelSurgePending && !isBusy()) {
        const pendingDir = direction;
        resetWheelSeries();
        wheelSeriesDir = pendingDir;
      }

      /* Fresh swipe — parity with touchstart / keydown unlock. Must run
         before classifyGesture so it is not stuck behind the post-transition
         soft lock. */
      if (!wheelLatched && !isBusy()) {
        gestureLocked = false;
        clearGestureIdleTimer();
      }

      const kind = classifyGesture(direction);
      if (kind === 'noop') return;

      /* Consume so native snap cannot free-scroll / skip states. */
      e.preventDefault();

      /* Already stepped this swipe — eat momentum only. */
      if (wheelLatched) return;

      /* Direction flip starts a fresh accumulation. */
      if (wheelSeriesDir && wheelSeriesDir !== direction) wheelAccum = 0;
      wheelSeriesDir = direction;

      if (kind === 'block') return;
      if (isBusy() || gestureLocked || shellMoving) return;

      /* Reversing mid-follow lets the page settle back first. */
      if (dragging && direction !== dragDir) springBack();

      /* Trackpads (small pixel deltas) follow toward the other screen;
         mouse wheel notches step straight away. */
      if (e.deltaMode === 0 && Math.abs(e.deltaY) < 50 && isScreenGesture(direction)) {
        dragAccum += Math.abs(e.deltaY);
        dragTo(direction, direction * Math.min(dragAccum * DRAG_FOLLOW, DRAG_MAX_PX));
        if (dragAccum < DRAG_COMMIT) {
          armDragRelease();
          return;
        }
        wheelLatched = true;
        wheelAccum = 0;
        commitDrag(direction);
        return;
      }

      wheelAccum += Math.abs(e.deltaY);
      const threshold =
        e.deltaMode === 0 && Math.abs(e.deltaY) < 50
          ? WHEEL_THRESHOLD_TRACKPAD
          : WHEEL_THRESHOLD;
      if (wheelAccum < threshold) return;

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
  /* Recent finger samples for release velocity. */
  let touchPrevY = 0;
  let touchPrevT = 0;
  let touchVelocity = 0; /* px/ms, positive = finger moving up */
  const TOUCH_FOLLOW = 0.35;
  const TOUCH_COMMIT_PX = 130;
  const TOUCH_FLICK = 0.6; /* px/ms toward the other screen */

  window.addEventListener(
    'touchstart',
    (e) => {
      if (
        !interactive ||
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
      touchPrevY = t.clientY;
      touchPrevT = e.timeStamp || performance.now();
      touchVelocity = 0;
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
      const now = e.timeStamp || performance.now();
      const dt = now - touchPrevT;
      if (dt > 0) {
        const v = (touchPrevY - t.clientY) / dt;
        touchVelocity = touchVelocity * 0.3 + v * 0.7;
        touchPrevY = t.clientY;
        touchPrevT = now;
      }

      /* Toward the other screen — the page follows the finger. */
      const pullDir = Math.sign(-dy);
      if (
        !touchStepArmed &&
        pullDir &&
        !isBusy() &&
        !gestureLocked &&
        !shellMoving &&
        isScreenGesture(pullDir)
      ) {
        e.preventDefault();
        const maxPull = shell.clientHeight * 0.6;
        const pull = Math.max(-maxPull, Math.min(maxPull, -dy * TOUCH_FOLLOW));
        dragTo(pullDir, pull);
        return;
      }
      if (dragging) {
        /* Finger crossed back past the start — return to rest. */
        e.preventDefault();
        springBack();
        return;
      }

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

  function endTouchGesture(e) {
    if (dragging && e && e.type === 'touchcancel') {
      springBack();
    } else if (dragging) {
      const pulled = touchStartY - touchLastY; /* positive = finger moved up */
      const flick = touchVelocity * dragDir > TOUCH_FLICK;
      if (Math.abs(pulled) > TOUCH_COMMIT_PX || flick) {
        touchStepArmed = true;
        commitDrag(dragDir);
      } else {
        springBack();
      }
    }
    touchActive = false;
    touchAxisLocked = false;
    touchIsVertical = false;
    touchStepArmed = false;
    unlockGestureWhenIdle();
  }

  window.addEventListener('touchend', endTouchGesture, { passive: true });
  window.addEventListener('touchcancel', endTouchGesture, { passive: true });

  /* ── Space never scrolls — screens move by wheel, trackpad, touch or the
     arrow keys only. Space keeps its other jobs (intro skip, typing,
     pressing a focused button or link). ─────────────────────────────── */
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== ' ' && e.code !== 'Space') return;
      const t = e.target;
      if (ignoredTarget(t)) return;
      if (
        t &&
        t.closest &&
        t.closest('button, a[href], summary, [role="button"], [role="checkbox"], [role="switch"], [role="option"]')
      ) {
        return;
      }
      e.preventDefault();
    },
    { passive: false }
  );

  /* ── Keyboard — one step per key press ────────────────────────────────── */
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
      if (!interactive) return;
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
    goTo,
    goHome,
    unlock,
    isInteractive: () => interactive,
  };
}
