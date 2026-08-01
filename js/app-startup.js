/* ==========================================================================
   App startup lock — isolates exclusive boot from the application shell.

   While data-app-startup is set:
     • Screen 2 stays in layout (ribbon / stage geometry unchanged) but is
       unreachable (scroll locked, visibility hidden)
     • Top nav + settings are inert
     • Scroll + snap are locked
     • Ribbon / nav layout stay at their final start shape (no resize)

   data-boot is PE-only (Screen 1 lattice visuals) and must not own shell layout.
   ========================================================================== */

/**
 * @returns {boolean}
 */
export function isAppStartup() {
  return document.body.hasAttribute('data-app-startup');
}

/**
 * Release the application shell after exclusive boot completes.
 * Idempotent — safe to call from multiple completion paths.
 * @returns {boolean} True when this call cleared the lock.
 */
export function clearAppStartup() {
  if (!document.body.hasAttribute('data-app-startup')) return false;
  delete document.body.dataset.appStartup;
  const screen2 = document.getElementById('pixel-fs-screen-2');
  if (screen2) screen2.setAttribute('aria-hidden', 'false');
  window.dispatchEvent(new CustomEvent('pixelstartupdone'));
  return true;
}
