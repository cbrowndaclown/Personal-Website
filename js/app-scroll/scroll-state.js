/* ==========================================================================
   App scroll state — (screen × nav) transitions

   Canonical two-screen cycle (never skip):

     Screen1 + Open
     Screen1 + Open          ← application start
         ↓ scroll down
     Screen1 + Closed
         ↓ scroll down
     Screen2 + Closed
         ↑ scroll up
     Screen2 + Open
         ↑ scroll up
     Screen1 + Open

   Rules:
   General rules (N screens):

     DOWN  (i, open)   → (i, closed)
     DOWN  (i, closed) → (i+1, closed) if i < N-1, else stay
     UP    (i, closed) → (i, open)
     UP    (i, open)   → (i-1, open) if i > 0, else stay

   Each deliberate gesture advances exactly one edge.
   ========================================================================== */

/** @typedef {'open' | 'closed'} NavStateValue */

/**
 * @typedef {object} ScrollStep
 * @property {number} screen  Zero-based Pixel FS screen index
 * @property {NavStateValue} nav
 */

export const NavState = Object.freeze({
  OPEN: 'open',
  CLOSED: 'closed',
});

/**
 * @param {ScrollStep} a
 * @param {ScrollStep} b
 * @returns {boolean}
 */
export function stepsEqual(a, b) {
  return !!a && !!b && a.screen === b.screen && a.nav === b.nav;
}

/**
 * Canonical top of the down-ladder / end of the up-ladder: Screen 1 + Open.
 * Load/unlock remain Screen 1 + Closed (parked) so the pixel field stays flush
 * through boot — matching prior topnav. Open is reached by one up-gesture.
 * Enumerate every (screen, nav) pair for debugging / tooling.
 * @param {number} screenCount
 * @returns {ScrollStep[]}
 */
export function listScrollStates(screenCount) {
  const n = Math.max(0, Math.floor(Number(screenCount)) || 0);
  /** @type {ScrollStep[]} */
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ screen: i, nav: NavState.OPEN });
    out.push({ screen: i, nav: NavState.CLOSED });
  }
  return out;
}

/**
 * Application start: Screen 1 + Navigation Open.
 * @param {number} [screenCount]
 * @returns {ScrollStep}
 */
export function defaultScrollStep(screenCount) {
  void screenCount;
  return { screen: 0, nav: NavState.OPEN };
}

/**
 * Resolve the next state for one scroll direction.
 * @param {ScrollStep} current
 * @param {number} direction  Negative = up; positive = down
 * @param {number} screenCount
 * @returns {ScrollStep}
 */
export function transitionScrollStep(current, direction, screenCount) {
  const n = Math.max(1, Math.floor(Number(screenCount)) || 1);
  const screen = Math.max(0, Math.min(n - 1, current.screen | 0));
  const nav = current.nav === NavState.OPEN ? NavState.OPEN : NavState.CLOSED;
  const step = { screen, nav };

  if (!direction) return step;

  if (direction > 0) {
    /* Scroll down */
    if (nav === NavState.OPEN) {
      return { screen, nav: NavState.CLOSED };
    }
    if (screen < n - 1) {
      return { screen: screen + 1, nav: NavState.CLOSED };
    }
    return step;
  }

  /* Scroll up */
  if (nav === NavState.CLOSED) {
    return { screen, nav: NavState.OPEN };
  }
  if (screen > 0) {
    return { screen: screen - 1, nav: NavState.OPEN };
  }
  return step;
}

/**
 * @param {ScrollStep} step
 * @param {number} screenCount
 * @returns {ScrollStep}
 */
export function clampScrollStep(step, screenCount) {
  const n = Math.max(1, Math.floor(Number(screenCount)) || 1);
  return {
    screen: Math.max(0, Math.min(n - 1, (step && step.screen) | 0)),
    nav: step && step.nav === NavState.OPEN ? NavState.OPEN : NavState.CLOSED,
  };
}
