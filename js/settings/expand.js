/* ==========================================================================
   Full screen settings — the Pixel FS display as the settings surface.

   Instead of switching the pixel field off and leaving a blank panel, this
   hands that same space to the inspector: motion goes off, the field settles
   to its resting gray, and the settings body moves into the stage of whichever
   screen is in view.

   The body is moved, not cloned. Every control keeps the listeners and sync
   handles `initSettings` registered for it, so there is exactly one inspector
   no matter where it is mounted.
   ========================================================================== */

const HOST_ID = 'settings-stage';
const OPEN_MS = 260;

/**
 * @typedef {object} SettingsExpanderOptions
 * @property {HTMLElement} panel  #settings-panel — the dropdown the body lives in
 * @property {HTMLElement} body   #settings-body
 * @property {HTMLElement} [foot] Reset footer, moved alongside the body
 * @property {HTMLElement} [button] Gear button, held inert while expanded
 * @property {HTMLElement} [frame] #site-frame — reads data-app-screen
 * @property {string[]} [screenIds]
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
  const screenIds = opts.screenIds || [
    'pixel-fs-screen-1',
    'pixel-fs-screen-2',
  ];
  if (!panel || !body) return null;

  const reduceMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let expanded = false;
  /** Screen the panel was opened on — leaving it hands the space back. */
  let hostScreen = -1;
  let host = null;
  let closeTimer = 0;

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

  function buildHost() {
    const root = document.createElement('div');
    root.className = 'settings-stage';
    root.id = HOST_ID;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'false');
    root.setAttribute('aria-label', 'Settings');

    const shell = document.createElement('div');
    shell.className = 'settings-stage__shell';

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
    shell.appendChild(head);
    root.appendChild(shell);

    /* Scroll and gestures inside the panel are the panel's own — the screen
       stepper reads `.settings-stage` as an ignored target for the rest. */
    root.addEventListener('wheel', (e) => e.stopPropagation(), {
      passive: true,
    });

    return { root, shell, close };
  }

  function expand() {
    if (expanded) return false;
    const index = activeScreenIndex();
    const field = fieldFor(index);
    if (!field) return false;

    expanded = true;
    hostScreen = index;
    window.clearTimeout(closeTimer);

    host = buildHost();
    host.shell.appendChild(body);
    if (foot) host.shell.appendChild(foot);
    field.appendChild(host.root);

    document.body.dataset.settingsStage = String(index);
    if (opts.button) opts.button.setAttribute('aria-disabled', 'true');

    /* The field is the panel now — nothing should be simulating behind it. */
    if (typeof api.setMotion === 'function') api.setMotion(false);

    if (reduceMotion) {
      host.root.classList.add('is-open');
    } else {
      requestAnimationFrame(() => {
        if (host) host.root.classList.add('is-open');
      });
    }
    /* Dismiss the dropdown first — it parks focus on the gear on its way out. */
    if (typeof opts.onExpand === 'function') opts.onExpand();
    host.close.focus({ preventScroll: true });
    return true;
  }

  function returnBody() {
    /* Head stays put in the dropdown; body and footer slot back under it. */
    panel.appendChild(body);
    if (foot) panel.appendChild(foot);
  }

  function collapse() {
    if (!expanded) return false;
    expanded = false;
    hostScreen = -1;
    delete document.body.dataset.settingsStage;
    if (opts.button) opts.button.removeAttribute('aria-disabled');

    const dying = host;
    host = null;
    returnBody();

    const drop = () => {
      if (dying && dying.root.parentNode) dying.root.remove();
    };
    if (dying) {
      dying.root.classList.remove('is-open');
      if (reduceMotion) drop();
      else closeTimer = window.setTimeout(drop, OPEN_MS);
    }

    /* Give the display back exactly as it was handed over. */
    if (typeof api.setMotion === 'function') api.setMotion(true);
    if (opts.button) opts.button.focus({ preventScroll: true });
    return true;
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
