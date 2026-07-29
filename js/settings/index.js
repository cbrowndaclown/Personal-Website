/* Settings panel host — chrome, accordion, and section mounting. */

import { createSection } from './section.js';
import { bindAccordion } from './accordion.js';
import { getSettingsCatalog } from './catalog.js';
import { resetSettingsToDefaults } from './definitions/index.js';

/**
 * @param {object} api
 * @param {() => boolean} api.getMotion
 * @param {(on: boolean) => void} api.setMotion
 * @param {() => string} api.getBgMode
 * @param {(mode: string) => void} api.setBgMode
 * @param {() => string} api.getLastImplementedBgMode
 * @param {() => { r: number, g: number, b: number }} api.getEffectColor
 * @param {(r: number, g: number, b: number, publish?: boolean) => void} api.setEffectColor
 */
export function initSettings(api) {
  const root = document.querySelector('.settings');
  const btn = document.getElementById('settings-btn');
  const panel = document.getElementById('settings-panel');
  const close = document.getElementById('settings-close');
  const body = document.getElementById('settings-body');
  if (!root || !btn || !panel || !close || !body) return;

  let open = false;
  const icon = btn.querySelector('.settings__icon');

  /* Gear spin tracks wheel/trackpad — rAF-coalesced, no forced JS scroll */
  let gearAngle = 0;
  let gearRaf = 0;
  let pendingGearDelta = 0;
  const GEAR_SCALE = 0.22;
  const GEAR_MIN_ANGLE = -75;
  const GEAR_MAX_ANGLE = 75;

  function nudgeGear(deltaY) {
    if (!deltaY) return;
    pendingGearDelta += deltaY;
    if (gearRaf) return;
    gearRaf = requestAnimationFrame(() => {
      gearRaf = 0;
      const delta = pendingGearDelta;
      pendingGearDelta = 0;
      if (!delta || !icon) return;
      gearAngle = Math.min(
        GEAR_MAX_ANGLE,
        Math.max(GEAR_MIN_ANGLE, gearAngle + delta * GEAR_SCALE)
      );
      icon.style.transform = `rotate(${gearAngle}deg)`;
    });
  }

  function setOpen(next) {
    open = next;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.setAttribute('aria-label', open ? 'Close settings' : 'Open settings');
    panel.classList.toggle('is-open', open);
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');

    if (open) {
      close.focus({ preventScroll: true });
    } else {
      btn.focus({ preventScroll: true });
    }
  }

  /* Skip inspector DOM rewrites while the user is driving a continuous control */
  let suppressSyncDepth = 0;
  const syncFns = [];
  const sectionHandles = [];

  function syncFromConfig() {
    if (suppressSyncDepth > 0) return;
    syncFns.forEach((fn) => fn());
  }

  const syncGate = {
    suppressSync() {
      suppressSyncDepth += 1;
    },
    allowSync() {
      suppressSyncDepth = Math.max(0, suppressSyncDepth - 1);
    },
    requestSync() {
      syncFromConfig();
    },
  };

  getSettingsCatalog(api, syncGate).forEach((entry) => {
    const section = createSection({
      id: entry.id,
      title: entry.title,
      defaultOpen: !!entry.defaultOpen,
      build: (sectionBody) => {
        const handle = entry.build(sectionBody);
        if (handle && typeof handle.sync === 'function') {
          syncFns.push(handle.sync);
        }
        if (handle && Array.isArray(handle.sections)) {
          sectionHandles.push(...handle.sections);
        }
      },
    });
    body.appendChild(section.root);
    sectionHandles.push(section);
  });

  bindAccordion({
    container: body,
    sections: sectionHandles,
  });

  /* Reset footer — data-driven via SETTINGS defaultValue */
  const foot = document.createElement('div');
  foot.className = 'settings__foot';
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'settings__reset';
  resetBtn.id = 'settings-reset';
  resetBtn.textContent = 'Reset to Defaults';
  resetBtn.setAttribute('aria-label', 'Reset all settings to defaults');
  resetBtn.addEventListener('click', () => {
    resetSettingsToDefaults(api);
    syncFromConfig();
  });
  foot.appendChild(resetBtn);
  panel.appendChild(foot);

  window.addEventListener('animconfigchange', (e) => {
    /* Soft Pixel Behavior updates paint the active slider themselves —
       skip full inspector rewrites (no React/UI churn). */
    if (e.detail && e.detail.soft) return;
    syncFromConfig();
  });
  /* Density teardown / rebuild locks the Pixel Density slider mid-transition. */
  window.addEventListener('pixeldensitylockchange', () => {
    syncFromConfig();
  });
  syncFromConfig();

  /*
    Native scroll inside .settings__body — only preventDefault at edges /
    over chrome so the page underneath does not move. Avoids rewriting
    scrollTop on every wheel tick (main scroll lag source).
  */
  panel.addEventListener(
    'wheel',
    (e) => {
      if (!open) return;
      nudgeGear(e.deltaY);

      const overBody = e.target === body || body.contains(/** @type {Node} */ (e.target));
      if (overBody) {
        const maxScroll = body.scrollHeight - body.clientHeight;
        if (maxScroll <= 0) {
          e.preventDefault();
          return;
        }
        const atTop = body.scrollTop <= 0 && e.deltaY < 0;
        const atBottom = body.scrollTop >= maxScroll - 0.5 && e.deltaY > 0;
        if (atTop || atBottom) e.preventDefault();
        return;
      }
      e.preventDefault();
    },
    { passive: false }
  );

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(!open);
  });

  close.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) setOpen(false);
  });

  document.addEventListener('pointerdown', (e) => {
    if (!open) return;
    if (root.contains(e.target)) return;
    setOpen(false);
  });

  window.addEventListener('topnavhide', () => {
    if (open) setOpen(false);
  });
}
