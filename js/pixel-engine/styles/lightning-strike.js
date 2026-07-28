/* Lightning strike timing controller — events only, no rendering. */

export function createLightningStrikeController(options) {
  const opts = options || {};
  const intervalMin = opts.intervalMin != null ? opts.intervalMin : 2000;
  const intervalMax = opts.intervalMax != null ? opts.intervalMax : 6000;
  const onStrike = typeof opts.onStrike === 'function' ? opts.onStrike : null;

  let modeActive = false;
  let cursorInField = false;
  let timerId = null;
  let deadline = 0;
  /* ms left when paused; null means next arm should pick a fresh interval */
  let pausedRemaining = null;
  let strikeSeq = 0;
  let lastWaitMs = 0;

  function randomIntervalMs() {
    /* Irregular bands so consecutive waits rarely feel metronomic */
    const span = intervalMax - intervalMin;
    const u = Math.random();
    let wait;
    if (u < 0.2) wait = intervalMin + Math.random() * span * 0.28;
    else if (u < 0.55) wait = intervalMin + span * (0.22 + Math.random() * 0.38);
    else if (u < 0.82) wait = intervalMin + span * (0.48 + Math.random() * 0.32);
    else wait = intervalMin + span * (0.7 + Math.random() * 0.3);

    /* Nudge away from the previous wait when it would feel rhythmic */
    if (lastWaitMs > 0 && Math.abs(wait - lastWaitMs) < span * 0.12) {
      wait = wait > lastWaitMs
        ? Math.min(intervalMax, wait + span * randSkew())
        : Math.max(intervalMin, wait - span * randSkew());
    }
    lastWaitMs = wait;
    return wait;
  }

  function randSkew() {
    return 0.12 + Math.random() * 0.22;
  }

  function clearTimer() {
    if (timerId == null) return;
    clearTimeout(timerId);
    timerId = null;
  }

  function canRun() {
    return modeActive && cursorInField;
  }

  function arm(waitMs) {
    clearTimer();
    if (!canRun()) return;
    const wait = Math.max(0, waitMs);
    deadline = performance.now() + wait;
    timerId = setTimeout(fireStrike, wait);
  }

  function fireStrike() {
    timerId = null;
    if (!canRun()) return;

    strikeSeq += 1;
    const detail = {
      id: strikeSeq,
      time: performance.now(),
      intervalMin: intervalMin,
      intervalMax: intervalMax,
    };

    if (onStrike) onStrike(detail);
    window.dispatchEvent(new CustomEvent('lightningstrike', { detail: detail }));

    pausedRemaining = null;
    arm(randomIntervalMs());
  }

  function pause() {
    if (timerId == null) return;
    pausedRemaining = Math.max(0, deadline - performance.now());
    clearTimer();
  }

  function resume() {
    if (!canRun()) return;
    if (timerId != null) return;
    const wait = pausedRemaining != null ? pausedRemaining : randomIntervalMs();
    pausedRemaining = null;
    arm(wait);
  }

  function sync() {
    if (canRun()) resume();
    else pause();
  }

  return {
    setModeActive: function (on) {
      const next = !!on;
      if (modeActive === next) {
        sync();
        return;
      }
      modeActive = next;
      if (!modeActive) {
        pause();
        pausedRemaining = null;
        return;
      }
      sync();
    },
    setCursorInField: function (inside) {
      const next = !!inside;
      if (cursorInField === next) return;
      cursorInField = next;
      sync();
    },
    reset: function () {
      clearTimer();
      pausedRemaining = null;
      deadline = 0;
      lastWaitMs = 0;
    },
    destroy: function () {
      clearTimer();
      modeActive = false;
      cursorInField = false;
      pausedRemaining = null;
      deadline = 0;
      lastWaitMs = 0;
    },
    isArmed: function () {
      return timerId != null;
    },
    isActive: function () {
      return canRun();
    },
  };
}

