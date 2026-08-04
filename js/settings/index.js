/* Settings panel host — chrome, accordion, and section mounting. */

import { createSection } from './section.js';
import { bindAccordion } from './accordion.js';
import { getSettingsCatalog } from './catalog.js';
import { createSettingsExpander } from './expand.js';
import { resetSettingsToDefaults } from './definitions/index.js';
import { isAppStartup } from '../app-startup.js';

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
  const icons = btn.querySelector('.settings__icons');
  const reduceMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Gear spin tracks wheel/trackpad — rAF-coalesced, no forced JS scroll */
  let gearAngle = 0;
  let gearRaf = 0;
  let pendingGearDelta = 0;
  let iconSwapTimer = 0;
  let toggleEndTimer = 0;
  const GEAR_SCALE = 0.22;
  const GEAR_MIN_ANGLE = -75;
  const GEAR_MAX_ANGLE = 75;
  const ICON_SWAP_MS = 160;
  const TOGGLE_MS = 380;

  function nudgeGear(deltaY) {
    if (isAppStartup()) return;
    if (!deltaY) return;
    pendingGearDelta += deltaY;
    if (gearRaf) return;
    gearRaf = requestAnimationFrame(() => {
      gearRaf = 0;
      const delta = pendingGearDelta;
      pendingGearDelta = 0;
      if (!delta || !icons) return;
      gearAngle = Math.min(
        GEAR_MAX_ANGLE,
        Math.max(GEAR_MIN_ANGLE, gearAngle + delta * GEAR_SCALE)
      );
      icons.style.transform = `rotate(${gearAngle}deg)`;
    });
  }

  function setOpen(next) {
    if (next && isAppStartup()) return;
    if (next === open) return;
    open = next;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.setAttribute('aria-label', open ? 'Close settings' : 'Open settings');
    panel.classList.toggle('is-open', open);
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');

    /* Box nudge + mid-spin icon swap (cog ↔ tools) */
    window.clearTimeout(iconSwapTimer);
    window.clearTimeout(toggleEndTimer);
    const targetIcon = open ? 'tools' : 'cog';
    if (reduceMotion) {
      btn.dataset.icon = targetIcon;
      btn.classList.remove('is-toggling');
    } else {
      btn.classList.remove('is-toggling');
      void btn.offsetWidth;
      btn.classList.add('is-toggling');
      iconSwapTimer = window.setTimeout(() => {
        btn.dataset.icon = targetIcon;
      }, ICON_SWAP_MS);
      toggleEndTimer = window.setTimeout(() => {
        btn.classList.remove('is-toggling');
      }, TOGGLE_MS);
    }

    if (open) {
      close.focus({ preventScroll: true });
    } else {
      btn.focus({ preventScroll: true });
    }
  }

  /* Skip inspector DOM rewrites while the user is driving a continuous control */
  let suppressSyncDepth = 0;
  let pendingSoftSync = false;
  const syncFns = [];
  const softSyncFns = [];
  const sectionHandles = [];
  /* Top level categories only — the full screen rail routes these into its
     detail column, so it needs them apart from their nested subsections. */
  const categorySections = [];

  function syncFromConfig() {
    if (suppressSyncDepth > 0) return;
    pendingSoftSync = false;
    syncFns.forEach((fn) => fn());
  }

  /** Soft AnimConfigChange — refresh Preset → Custom without full inspector churn. */
  function syncSoftFromConfig() {
    if (suppressSyncDepth > 0) {
      pendingSoftSync = true;
      return;
    }
    pendingSoftSync = false;
    softSyncFns.forEach((fn) => fn());
  }

  const syncGate = {
    suppressSync() {
      suppressSyncDepth += 1;
    },
    allowSync() {
      suppressSyncDepth = Math.max(0, suppressSyncDepth - 1);
      if (suppressSyncDepth === 0 && pendingSoftSync) {
        syncSoftFromConfig();
      }
    },
    requestSync() {
      syncFromConfig();
    },
    requestSoftSync() {
      syncSoftFromConfig();
    },
  };

  /* Motion is no longer a setting of its own — the full screen panel owns the
     off state, and that panel never survives a reload. A persisted off would
     leave a dead field with nothing left in the UI to revive it. */
  if (typeof api.getMotion === 'function' && !api.getMotion()) {
    api.setMotion(true);
  }

  /* Reset footer — data-driven via SETTINGS defaultValue. Built before the
     catalog so the expander can move it with the body. */
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
    /* Defaults restore motion, but the field is the panel right now. */
    if (expander && expander.isExpanded()) api.setMotion(false);
    syncFromConfig();
  });
  foot.appendChild(resetBtn);

  const expander = createSettingsExpander({
    panel,
    body,
    foot,
    button: btn,
    api,
    categorySections,
    sections: sectionHandles,
    onExpand: () => setOpen(false),
  });

  /* Catalog-facing api — engine getters plus the panel's own surface control,
     so a SettingDef can drive the expansion like any other setting. */
  const uiApi = expander
    ? Object.assign({}, api, {
        expandSettings: () => expander.expand(),
        collapseSettings: () => expander.collapse(),
        isSettingsExpanded: () => expander.isExpanded(),
      })
    : api;

  getSettingsCatalog(uiApi, syncGate).forEach((entry) => {
    const section = createSection({
      id: entry.id,
      title: entry.title,
      defaultOpen: !!entry.defaultOpen,
      build: (sectionBody) => {
        const handle = entry.build(sectionBody);
        if (handle && typeof handle.sync === 'function') {
          syncFns.push(handle.sync);
        }
        if (handle && typeof handle.softSync === 'function') {
          softSyncFns.push(handle.softSync);
        }
        if (handle && Array.isArray(handle.sections)) {
          sectionHandles.push(...handle.sections);
        }
      },
    });
    body.appendChild(section.root);
    sectionHandles.push(section);
    categorySections.push(section);
  });

  bindAccordion({
    container: body,
    sections: sectionHandles,
  });

  panel.appendChild(foot);

  window.addEventListener('animconfigchange', (e) => {
    /* Soft Pixel Behavior updates paint the active slider themselves —
       skip full inspector rewrites, but still flip Preset → Custom. */
    if (e.detail && e.detail.soft) {
      syncSoftFromConfig();
      return;
    }
    syncFromConfig();
  });
  /* Density teardown / rebuild locks the Pixel Density slider mid-transition. */
  window.addEventListener('pixeldensitylockchange', () => {
    syncFromConfig();
  });
  /* Preset system unlocks after startup menu hold — refresh the Preset row. */
  window.addEventListener('pixelpresetsready', () => {
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
    if (isAppStartup()) return;
    /* The gear is the way back out of the full screen panel. */
    if (expander && expander.isExpanded()) {
      expander.collapse();
      return;
    }
    setOpen(!open);
  });

  close.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (expander && expander.isExpanded()) {
      expander.collapse();
      return;
    }
    if (open) setOpen(false);
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
