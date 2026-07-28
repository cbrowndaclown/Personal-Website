/* Settings panel host — chrome, accordion, and section mounting. */

import { createSection } from './section.js';
import { bindAccordion } from './accordion.js';
import { getSettingsCatalog } from './catalog.js';

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

  /* Gear spin tracks wheel/trackpad 1:1 — no inertia after scroll stops */
  let gearAngle = 0;
  const GEAR_SCALE = 0.22;
  const GEAR_MIN_ANGLE = -75;
  const GEAR_MAX_ANGLE = 75;

  function nudgeGear(deltaY) {
    if (!deltaY) return;
    gearAngle = Math.min(
      GEAR_MAX_ANGLE,
      Math.max(GEAR_MIN_ANGLE, gearAngle + deltaY * GEAR_SCALE)
    );
    if (icon) icon.style.transform = `rotate(${gearAngle}deg)`;
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

  /* Mount catalog sections */
  const syncFns = [];
  const sectionHandles = [];

  getSettingsCatalog(api).forEach((entry) => {
    const section = createSection({
      id: entry.id,
      title: entry.title,
      defaultOpen: !!entry.defaultOpen,
      build: (sectionBody) => {
        const handle = entry.build(sectionBody, api);
        if (handle && typeof handle.sync === 'function') {
          syncFns.push(handle.sync);
        }
      },
    });
    body.appendChild(section.root);
    sectionHandles.push(section);
  });

  bindAccordion({
    container: body,
    sections: sectionHandles,
    maxOpen: 2,
  });

  function syncFromConfig() {
    syncFns.forEach((fn) => fn());
  }

  window.addEventListener('animconfigchange', syncFromConfig);
  syncFromConfig();

  /* Contain all wheel/trackpad to panel content; page scrolls when pointer leaves */
  panel.addEventListener(
    'wheel',
    (e) => {
      if (!open) return;
      e.preventDefault();
      nudgeGear(e.deltaY);
      body.scrollTop += e.deltaY;
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
