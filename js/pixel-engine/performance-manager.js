/* Performance Manager — placeholder for future FPS / quality / density scaling. */

/**
 * Reserved for:
 *  - FPS monitoring
 *  - adaptive quality
 *  - grid density scaling
 *  - animation throttling
 *
 * No behavior in V1 — architecture only.
 */
export function createPerformanceManager() {
  let enabled = false;

  return {
    /** @returns {boolean} */
    isEnabled() {
      return enabled;
    },
    /** Enable/disable future monitoring hooks (no-op in V1). */
    setEnabled(on) {
      enabled = !!on;
    },
    /** Future: sample frame timing. */
    beginFrame() {},
    /** Future: end frame sample. */
    endFrame() {},
    /** Future: suggested quality tier. */
    getQualityTier() {
      return { tier: 'full', cellScale: 1, throttle: 1 };
    },
    destroy() {
      enabled = false;
    },
  };
}
