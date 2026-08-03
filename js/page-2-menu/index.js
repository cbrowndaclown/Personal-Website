/* ==========================================================================
   Page 2 Menu — visibility + Screen 2 typography trigger

   Typography is rendered by the shared Pixel FS intro LED pipeline
   (same system as Screen 1 greeting / Screen 1 directory menu).
   This module only owns Screen 2 eligibility and when to ask the
   intro controller to show Screen 2 vs Screen 1 menu content.

   Visibility / typography swap wait for appscrollchange (scroll settled).
   data-app-screen flips at transition start — baking then would paint
   Screen 2 LEDs onto the still-visible Screen 1 canvas mid-scroll.
   ========================================================================== */

/** @typedef {'hidden' | 'visible'} Page2MenuVisibilityValue */

export const Page2MenuVisibility = Object.freeze({
  HIDDEN: 'hidden',
  VISIBLE: 'visible',
});

/**
 * @typedef {object} Page2MenuOptions
 * @property {HTMLElement} [root]
 * @property {HTMLElement} [frame]  #site-frame — reads data-app-screen
 * @property {number} [screen2Index]  Zero-based Screen 2 index (default 1)
 * @property {object} [intro]  createIntroController instance (shared PE typography)
 */

/**
 * @param {Page2MenuOptions} [options]
 */
export function initPage2Menu(options) {
  const opts = options || {};
  const root = opts.root || document.getElementById('page-2-menu');
  if (!root) return null;

  const frame = opts.frame || document.getElementById('site-frame');
  const screen2Index =
    opts.screen2Index != null ? opts.screen2Index | 0 : 1;

  /** @type {object | null} */
  let intro = opts.intro || null;

  /** Session latch — set on first Screen 2 visit; never cleared this session. */
  let revealed = false;
  /** @type {Page2MenuVisibilityValue} */
  let visibility = Page2MenuVisibility.HIDDEN;
  let screen = 0;

  /** One-shot Screen 2 assemble — armed until first settled Screen 2 arrival. */
  let revealStarted = false;

  if (!root.dataset.revealPhase) {
    root.dataset.revealPhase = 'idle';
  }

  function resolveIntro() {
    if (intro) return intro;
    if (typeof window !== 'undefined' && window.introController) {
      intro = window.introController;
    }
    return intro;
  }

  function applyDom() {
    const show = visibility === Page2MenuVisibility.VISIBLE;
    root.dataset.visibility = visibility;
    root.dataset.revealed = revealed ? 'true' : 'false';
    root.setAttribute('aria-hidden', show ? 'false' : 'true');
    root.classList.toggle('is-visible', show);

    if (show) {
      maybeStartScreen2Typography();
    } else if (revealStarted) {
      /* Settled back on Screen 1 — restore Screen 1 directory LEDs. */
      const ctrl = resolveIntro();
      if (
        ctrl &&
        typeof ctrl.getMenuSurface === 'function' &&
        ctrl.getMenuSurface() === 2 &&
        typeof ctrl.getPhase === 'function' &&
        ctrl.getPhase() === 'directory' &&
        typeof ctrl.settleScreen2Menu === 'function'
      ) {
        ctrl.settleScreen2Menu();
      }
      if (ctrl && typeof ctrl.restoreScreen1Menu === 'function') {
        ctrl.restoreScreen1Menu();
      }
      root.classList.remove('is-revealing');
      root.dataset.revealPhase = 'complete';
    }
  }

  function maybeStartScreen2Typography() {
    const ctrl = resolveIntro();
    if (!ctrl || typeof ctrl.beginScreen2MenuSequence !== 'function') {
      requestAnimationFrame(() => {
        if (visibility === Page2MenuVisibility.VISIBLE) {
          maybeStartScreen2Typography();
        }
      });
      return;
    }

    const alreadyPlayed =
      revealStarted ||
      (typeof ctrl.hasPlayedScreen2Menu === 'function' &&
        ctrl.hasPlayedScreen2Menu());

    if (alreadyPlayed) {
      revealStarted = true;
      root.classList.remove('is-revealing');
      root.dataset.revealPhase = 'complete';
      ctrl.beginScreen2MenuSequence({ instant: true });
      return;
    }

    revealStarted = true;
    root.classList.add('is-revealing');
    root.dataset.revealPhase = 'playing';
    ctrl.beginScreen2MenuSequence();

    const markComplete = () => {
      root.classList.remove('is-revealing');
      root.dataset.revealPhase = 'complete';
    };
    const start = performance.now();
    const watch = () => {
      if (visibility !== Page2MenuVisibility.VISIBLE) return;
      const phase =
        typeof ctrl.getPhase === 'function' ? ctrl.getPhase() : 'idle';
      if (phase === 'idle' || performance.now() - start > 12000) {
        markComplete();
        return;
      }
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  }

  /**
   * @param {number} screenIndex
   */
  function syncFromScreen(screenIndex) {
    const nextScreen = Math.max(0, screenIndex | 0);
    const onScreen2 = nextScreen === screen2Index;
    const nextRevealed = revealed || onScreen2;
    const nextVisibility = onScreen2
      ? Page2MenuVisibility.VISIBLE
      : Page2MenuVisibility.HIDDEN;

    if (
      nextScreen === screen &&
      nextRevealed === revealed &&
      nextVisibility === visibility
    ) {
      return;
    }

    screen = nextScreen;
    revealed = nextRevealed;
    visibility = nextVisibility;
    applyDom();
  }

  function readFrameScreen() {
    if (!frame || frame.dataset.appScreen == null) return 0;
    const n = Number(frame.dataset.appScreen);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Only appscrollchange — published after shell/nav settle.
   * Do not bake on early data-app-screen flips (mid-scroll flash).
   */
  function onAppScrollChange(event) {
    const next =
      event && event.detail && event.detail.screen != null
        ? event.detail.screen
        : readFrameScreen();
    syncFromScreen(next);

    /* Settled — text always returns, even when the step changed nothing
       here (nav-only edges, superseded transitions). */
    const ctrl = resolveIntro();
    if (ctrl && typeof ctrl.fadeMenuIn === 'function') ctrl.fadeMenuIn();
  }

  window.addEventListener('appscrollchange', onAppScrollChange);

  /* A cleared LED line leaves the display — drop its anchor so the a11y tree
     matches what Screen 2 actually shows. */
  window.addEventListener('pixelscreen2clear', (event) => {
    const keys = event && event.detail ? event.detail.keys : null;
    if (!Array.isArray(keys)) return;
    keys.forEach((key) => {
      const line = root.querySelector(`.page-2-menu__line[data-line-key="${key}"]`);
      if (line) line.hidden = true;
    });
  });

  /* `/menu` re-raises every line — the anchors come back with them. */
  window.addEventListener('pixelscreen2restore', () => {
    root.querySelectorAll('.page-2-menu__line').forEach((line) => {
      line.hidden = false;
    });
  });

  /* data-app-screen flips when the transition starts. Both screens share one
     rendered frame, so menu text must clear before they cross the viewport —
     otherwise the same lines read twice. Content swaps still wait for settle. */
  if (frame && typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(() => {
      const ctrl = resolveIntro();
      if (ctrl && typeof ctrl.fadeMenuOut === 'function') ctrl.fadeMenuOut();
    });
    observer.observe(frame, {
      attributes: true,
      attributeFilter: ['data-app-screen'],
    });
  }

  /* Parked on Screen 1 until the first settled Screen 2 arrival. */
  syncFromScreen(readFrameScreen());

  return {
    getVisibility: () => visibility,
    hasRevealed: () => revealed,
    getScreen: () => screen,
    isVisible: () => visibility === Page2MenuVisibility.VISIBLE,
    hasPlayedReveal: () => {
      const ctrl = resolveIntro();
      return (
        revealStarted ||
        !!(
          ctrl &&
          typeof ctrl.hasPlayedScreen2Menu === 'function' &&
          ctrl.hasPlayedScreen2Menu()
        )
      );
    },
    isRevealPlaying: () => {
      const ctrl = resolveIntro();
      return !!(
        ctrl &&
        typeof ctrl.getMenuSurface === 'function' &&
        ctrl.getMenuSurface() === 2 &&
        typeof ctrl.getPhase === 'function' &&
        ctrl.getPhase() === 'directory'
      );
    },
    setIntro(nextIntro) {
      intro = nextIntro || null;
    },
  };
}
