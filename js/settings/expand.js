/* ==========================================================================
   Full screen settings — the Pixel FS display as the settings surface.

   Instead of switching the pixel field off and leaving a blank panel, this
   hands that same space to the inspector: the display clears itself pixel by
   pixel, motion goes off, and the settings surface pops into the stage of
   whichever screen is in view.

   The surface is a master / detail pair filling the whole field. Categories
   live in a rail pinned to the left; opening one slides its panel out to the
   right until the pair spans the screen. Only one category is open at a time
   there — a stack of accordions is a dropdown's answer to a narrow column,
   not this one's.

   The body is moved, not cloned. Every control keeps the listeners and sync
   handles `initSettings` registered for it, so there is exactly one inspector
   no matter where it is mounted. Category panels are moved the same way, out
   of the rail and into the detail column, so the rail stays a list of titles.
   ========================================================================== */

import { createStageClear } from './stage-clear.js';
import { bindAccordion } from './accordion.js';

const HOST_ID = 'settings-stage';
const OPEN_MS = 300;

/** @param {number} ms */
function wait(ms) {
  return new Promise((resolve) => {
    if (ms <= 0) resolve();
    else window.setTimeout(resolve, ms);
  });
}

/**
 * @typedef {object} SettingsSectionHandle
 * @property {string} id
 * @property {HTMLElement} root
 * @property {HTMLElement} body
 * @property {() => boolean} isOpen
 * @property {(open: boolean, animate?: boolean) => void} setOpen
 */

/**
 * @typedef {object} SettingsExpanderOptions
 * @property {HTMLElement} panel  #settings-panel — the dropdown the body lives in
 * @property {HTMLElement} body   #settings-body
 * @property {HTMLElement} [foot] Reset footer, moved alongside the body
 * @property {HTMLElement} [button] Gear button, held inert while expanded
 * @property {HTMLElement} [frame] #site-frame — reads data-app-screen
 * @property {string[]} [screenIds]
 * @property {SettingsSectionHandle[]} [categorySections] — top level categories
 * @property {SettingsSectionHandle[]} [sections] — every section, nested included
 * @property {object} api
 * @property {() => void} [onExpand]
 */

/**
 * @param {SettingsExpanderOptions} options
 */
export function createSettingsExpander(options) {
  const opts = options || {};
  const panel = opts.panel;
  const body = opts.body;
  const foot = opts.foot || null;
  const api = opts.api || {};
  const frame = opts.frame || document.getElementById('site-frame');
  const categorySections = opts.categorySections || [];
  const allSections = opts.sections || categorySections;
  const screenIds = opts.screenIds || [
    'pixel-fs-screen-1',
    'pixel-fs-screen-2',
  ];
  if (!panel || !body) return null;

  const reduceMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const stageClear = createStageClear({
    getCell: () =>
      typeof api.getPixelCell === 'function' ? api.getPixelCell() : NaN,
    reduceMotion,
  });

  let expanded = false;
  /** Held across the clear / restore sweeps so open and close cannot overlap. */
  let busy = false;
  /** Screen the panel was opened on — leaving it hands the space back. */
  let hostScreen = -1;
  let host = null;
  /** Category currently occupying the detail column. */
  let detailId = '';
  /** Dropdown accordion state, handed back untouched on close. */
  let dropdownOpenIds = [];

  function activeScreenIndex() {
    if (!frame || frame.dataset.appScreen == null) return 0;
    const n = Number(frame.dataset.appScreen);
    return Number.isFinite(n) && n > 0 ? Math.min(n, screenIds.length - 1) : 0;
  }

  /** The squircle field of a screen — the exact bounds the pixels occupy. */
  function fieldFor(index) {
    const screen = document.getElementById(screenIds[index]);
    return screen ? screen.querySelector('.stage__field') : null;
  }

  /** A section's collapsible panel, wherever it currently lives. */
  function panelOf(section) {
    return section && section.body ? section.body.parentElement : null;
  }

  function categoryFor(node) {
    return categorySections.find((section) => section.root === node) || null;
  }

  function buildHost() {
    const root = document.createElement('div');
    root.className = 'settings-stage';
    root.id = HOST_ID;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'false');
    root.setAttribute('aria-label', 'Settings');

    const shell = document.createElement('div');
    shell.className = 'settings-stage__shell';

    const rail = document.createElement('div');
    rail.className = 'settings-stage__rail';

    const head = document.createElement('div');
    head.className = 'settings-stage__head';

    const title = document.createElement('h2');
    title.className = 'settings-stage__title';
    title.textContent = 'Settings';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'settings-stage__close';
    close.textContent = '✕';
    close.setAttribute('aria-label', 'Close full screen settings');
    close.addEventListener('click', () => collapse());

    head.append(title, close);
    rail.appendChild(head);

    const detail = document.createElement('div');
    detail.className = 'settings-stage__detail';

    shell.append(rail, detail);
    root.appendChild(shell);

    /* Category panels leave #settings-body for the detail column, so the
       dropdown's accordion no longer sees their nested toggles. */
    bindAccordion({ container: detail, sections: allSections });

    /* Categories drive the detail column here, not an in-place accordion.
       Capture keeps the toggle from reaching the rail's accordion at all. */
    root.addEventListener(
      'settingssectiontoggle',
      (e) => {
        const section = categoryFor(e.target);
        if (!section) return;
        e.stopPropagation();
        const wantOpen = !!(e.detail && e.detail.open);
        if (wantOpen) openDetail(section);
        else closeDetail();
      },
      true
    );

    /* Scroll and gestures inside the panel are the panel's own — the screen
       stepper reads `.settings-stage` as an ignored target for the rest. */
    root.addEventListener('wheel', (e) => e.stopPropagation(), {
      passive: true,
    });

    return { root, shell, rail, detail, close };
  }

  /** Send a category's panel back under its own header in the rail. */
  function stowPanel(section) {
    const sectionPanel = panelOf(section);
    if (!sectionPanel) return;
    if (sectionPanel.parentNode !== section.root) {
      section.root.appendChild(sectionPanel);
    }
  }

  function closeDetail() {
    if (!detailId) return;
    const section = categorySections.find((s) => s.id === detailId);
    detailId = '';
    if (host) host.root.classList.remove('has-detail');
    if (!section) return;
    /* Instant: the column's own width is carrying the motion now. */
    section.setOpen(false, false);
    stowPanel(section);
  }

  function openDetail(section) {
    if (!host || !section) return;
    if (detailId === section.id) return;
    closeDetail();

    section.setOpen(true, false);
    const sectionPanel = panelOf(section);
    if (sectionPanel) host.detail.appendChild(sectionPanel);
    detailId = section.id;
    host.root.classList.add('has-detail');
  }

  /** Park the dropdown's accordion state; the rail opens one category at a time. */
  function takeSections() {
    dropdownOpenIds = categorySections
      .filter((section) => section.isOpen())
      .map((section) => section.id);
    categorySections.forEach((section) => {
      if (section.isOpen()) section.setOpen(false, false);
    });
    detailId = '';
  }

  /** Hand the accordion back exactly as the dropdown left it. */
  function releaseSections() {
    closeDetail();
    categorySections.forEach((section) => {
      stowPanel(section);
      const shouldOpen = dropdownOpenIds.indexOf(section.id) !== -1;
      if (section.isOpen() !== shouldOpen) section.setOpen(shouldOpen, false);
    });
    dropdownOpenIds = [];
  }

  function returnBody() {
    /* Head stays put in the dropdown; body and footer slot back under it. */
    panel.appendChild(body);
    if (foot) panel.appendChild(foot);
  }

  async function expand() {
    if (expanded || busy) return false;
    const index = activeScreenIndex();
    const field = fieldFor(index);
    if (!field) return false;

    expanded = true;
    busy = true;
    hostScreen = index;
    document.body.dataset.settingsStage = String(index);
    if (opts.button) opts.button.setAttribute('aria-disabled', 'true');
    /* Dismiss the dropdown first — it parks focus on the gear on its way out. */
    if (typeof opts.onExpand === 'function') opts.onExpand();

    try {
      /* The field is the panel now — nothing should be simulating behind it,
         but the snapshot has to be taken while the last frame is still up. */
      await stageClear.clear(field, () => {
        if (typeof api.setMotion === 'function') api.setMotion(false);
      });

      /* Collapsed while the display was still clearing. */
      if (!expanded) return false;

      host = buildHost();
      takeSections();
      host.rail.appendChild(body);
      if (foot) host.rail.appendChild(foot);
      field.appendChild(host.root);

      if (reduceMotion) {
        host.root.classList.add('is-open');
      } else {
        requestAnimationFrame(() => {
          if (host) host.root.classList.add('is-open');
        });
      }
      host.close.focus({ preventScroll: true });
      return true;
    } finally {
      busy = false;
    }
  }

  async function collapse() {
    if (!expanded || busy) return false;
    expanded = false;
    busy = true;

    const field = fieldFor(hostScreen >= 0 ? hostScreen : activeScreenIndex());
    hostScreen = -1;
    delete document.body.dataset.settingsStage;
    if (opts.button) opts.button.removeAttribute('aria-disabled');

    const dying = host;
    host = null;

    try {
      if (dying) {
        dying.root.classList.remove('is-open');
        await wait(reduceMotion ? 0 : OPEN_MS);
      }
      releaseSections();
      returnBody();
      if (dying && dying.root.parentNode) dying.root.remove();

      /* Give the display back exactly as it was handed over — the field comes
         up live under the overlay and the sweep peels the overlay away. */
      await stageClear.restore(field, () => {
        if (typeof api.setMotion === 'function') api.setMotion(true);
      });

      if (opts.button) opts.button.focus({ preventScroll: true });
      return true;
    } finally {
      busy = false;
    }
  }

  /* Scrolling to the other screen leaves the panel floating over a field it
     no longer owns — hand that screen back. */
  window.addEventListener('appscrollchange', () => {
    if (!expanded) return;
    if (activeScreenIndex() !== hostScreen) collapse();
  });

  return {
    expand,
    collapse,
    toggle: () => (expanded ? collapse() : expand()),
    isExpanded: () => expanded,
  };
}
