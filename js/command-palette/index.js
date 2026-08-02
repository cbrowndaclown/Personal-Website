/* ==========================================================================
   Command Palette — Screen 2 "/" command box

   The "/ for options" line is LED typography baked into the shared Pixel FS
   grid, not DOM text. Pressing "/" on Screen 2 masks that line and grows a
   command box out of that spot, redrawing the slash at entry size so it
   matches typed text. The option list rises out of the box above it.

   Box chrome, options, typed entry and caret are all LEDs on that same grid,
   raised by the intro controller. The DOM here is input plumbing only: a
   visually hidden field to capture keystrokes and a listbox for assistive
   tech. Nothing in this module paints.
   ========================================================================== */

const LINE_KEY = 'options';

/* Order is top-to-bottom on screen; the last entry sits against the box. */
const COMMANDS = [
  { name: '/clear', hint: 'Clears screen' },
  { name: '/text',  hint: 'Opens text box' },
  { name: '/close', hint: 'Closes command box' },
  { name: '/more',  hint: 'Displays more options' },
];

/* Matches the LED entry cap in the intro controller. */
const MAX_ENTRY = 10;

/**
 * @typedef {object} CommandPaletteOptions
 * @property {HTMLElement} [screen]  #pixel-fs-screen-2
 * @property {HTMLCanvasElement} [canvas]  #heatmap-2 — LED coordinate origin
 * @property {HTMLElement} [frame]  #site-frame — reads data-app-screen
 * @property {number} [screen2Index]
 * @property {object} [intro]  createIntroController instance
 */

/**
 * @param {CommandPaletteOptions} [options]
 */
export function initCommandPalette(options) {
  const opts = options || {};
  const screen = opts.screen || document.getElementById('pixel-fs-screen-2');
  const canvas = opts.canvas || document.getElementById('heatmap-2');
  const frame = opts.frame || document.getElementById('site-frame');
  if (!screen || !canvas) return null;

  const screen2Index = opts.screen2Index != null ? opts.screen2Index | 0 : 1;

  /** @type {object | null} */
  let intro = opts.intro || null;
  let open = false;
  let layoutRaf = 0;

  function resolveIntro() {
    if (intro) return intro;
    if (typeof window !== 'undefined' && window.introController) {
      intro = window.introController;
    }
    return intro;
  }

  /* ── DOM ────────────────────────────────────────────────────────────── */

  const root = document.createElement('div');
  root.className = 'command-palette';
  root.id = 'command-palette';
  root.setAttribute('aria-hidden', 'true');
  root.dataset.open = 'false';

  const list = document.createElement('ul');
  list.className = 'command-palette__list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Screen 2 commands');

  /* Spoken counterpart to the LED option stack. */
  /** @type {HTMLLIElement[]} */
  const optionEls = COMMANDS.map((cmd) => {
    const li = document.createElement('li');
    li.className = 'command-palette__option';
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', 'false');
    li.textContent = `${cmd.name} — ${cmd.hint}`;
    list.append(li);
    return li;
  });

  const input = document.createElement('input');
  input.className = 'command-palette__input';
  input.type = 'text';
  input.autocomplete = 'off';
  input.autocapitalize = 'off';
  input.spellcheck = false;
  input.maxLength = MAX_ENTRY;
  input.setAttribute('aria-label', 'Command input');

  root.append(list, input);
  screen.append(root);

  /* ── Geometry ───────────────────────────────────────────────────────── */

  /**
   * Park the hidden capture field over the LED box. It never shows, but
   * keeping it there stops focus and the native caret from scrolling the
   * screen somewhere the box is not.
   */
  function layout() {
    const ctrl = resolveIntro();
    if (!ctrl || typeof ctrl.getScreen2LineMetrics !== 'function') return false;
    const m = ctrl.getScreen2LineMetrics(LINE_KEY);
    if (!m || !(m.cell > 0)) return false;

    const canvasRect = canvas.getBoundingClientRect();
    const screenRect = screen.getBoundingClientRect();
    const originX = canvasRect.left - screenRect.left;
    const originY = canvasRect.top - screenRect.top;

    const cell = m.cell;
    /* Match intro-controller CMD_ENTRY_SCALE / commandGeometry. */
    const entryGrid = Math.max(5, Math.round(m.fontPx * 0.85));
    const fontPx = entryGrid * cell;
    const padX = Math.max(2, Math.round(entryGrid * 0.28)) * cell;
    const boxLeft = Math.round(originX + Math.round(m.minX) * cell - padX);
    const centerY = Math.round(originY + m.cy * cell);

    root.style.setProperty('--cp-left', `${boxLeft}px`);
    root.style.setProperty('--cp-center-y', `${centerY}px`);
    root.style.setProperty('--cp-font', `${fontPx}px`);
    return true;
  }

  function scheduleLayout() {
    if (layoutRaf) return;
    layoutRaf = requestAnimationFrame(() => {
      layoutRaf = 0;
      if (open) layout();
    });
  }

  /* ── State ──────────────────────────────────────────────────────────── */

  function onScreen2() {
    if (!frame || frame.dataset.appScreen == null) return false;
    return Number(frame.dataset.appScreen) === screen2Index;
  }

  function canOpen() {
    if (open) return false;
    if (document.body.hasAttribute('data-app-startup')) return false;
    if (document.body.hasAttribute('data-boot')) return false;
    if (!onScreen2()) return false;
    const ctrl = resolveIntro();
    if (!ctrl || typeof ctrl.getScreen2LineMetrics !== 'function') return false;
    /* Wait for the menu assemble to settle — masking mid-wave would eat
       LEDs that are still lighting up. */
    if (typeof ctrl.getPhase === 'function' && ctrl.getPhase() === 'directory') {
      return false;
    }
    /* A dismiss fade still owns the slash mask — wait it out. */
    if (
      typeof ctrl.isScreen2CommandOpen === 'function' &&
      ctrl.isScreen2CommandOpen()
    ) {
      return false;
    }
    return !!ctrl.getScreen2LineMetrics(LINE_KEY);
  }

  /** Push the entry to the LED box and emphasize the option it prefixes. */
  function syncEntry() {
    const typed = ('/' + input.value).trim().toLowerCase();
    let match = -1;
    optionEls.forEach((el, index) => {
      const hit = typed.length > 1 && COMMANDS[index].name.startsWith(typed);
      if (hit) match = index;
      el.setAttribute('aria-selected', hit ? 'true' : 'false');
    });

    const ctrl = resolveIntro();
    if (ctrl && typeof ctrl.setScreen2CommandText === 'function') {
      ctrl.setScreen2CommandText(input.value, match);
    }
  }

  function setMasked(masked) {
    const ctrl = resolveIntro();
    if (ctrl && typeof ctrl.setScreen2LineMasked === 'function') {
      ctrl.setScreen2LineMasked(LINE_KEY, masked);
    }
  }

  function openPalette() {
    if (!canOpen()) return false;
    const ctrl = resolveIntro();
    if (!ctrl || typeof ctrl.openScreen2Command !== 'function') return false;

    open = true;
    if (!layout()) {
      open = false;
      return false;
    }
    /* Mask first: the box grows into the space the menu line just vacated. */
    setMasked(true);
    if (!ctrl.openScreen2Command(LINE_KEY, COMMANDS)) {
      open = false;
      setMasked(false);
      return false;
    }

    input.value = '';
    syncEntry();
    root.dataset.open = 'true';
    root.setAttribute('aria-hidden', 'false');
    screen.dataset.commandPalette = 'open';
    input.focus({ preventScroll: true });
    return true;
  }

  /**
   * @param {{ instant?: boolean }} [opts]
   */
  function closePalette(opts) {
    if (!open) return;
    open = false;
    root.dataset.open = 'false';
    root.setAttribute('aria-hidden', 'true');
    delete screen.dataset.commandPalette;
    input.blur();
    input.value = '';
    optionEls.forEach((el) => el.setAttribute('aria-selected', 'false'));
    const ctrl = resolveIntro();
    if (ctrl && typeof ctrl.closeScreen2Command === 'function') {
      /* Keep the slash masked until the fade/pop finishes. */
      ctrl.closeScreen2Command({
        instant: !!(opts && opts.instant),
        onDone: () => setMasked(false),
      });
    } else {
      setMasked(false);
    }
  }

  /* ── Input wiring ───────────────────────────────────────────────────── */

  function editableTarget(target) {
    if (!target || !target.closest) return false;
    return !!(
      target.closest('input') ||
      target.closest('textarea') ||
      target.closest('select') ||
      target.closest('[contenteditable="true"]') ||
      target.closest('.settings')
    );
  }

  window.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (open || editableTarget(e.target)) return;
    if (!canOpen()) return;
    /* Also suppresses Firefox quick-find. */
    e.preventDefault();
    openPalette();
  });

  input.addEventListener('input', syncEntry);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closePalette();
      return;
    }
    /* Backspacing past the prompt dismisses the box, matching the slash
       that opened it. */
    if (e.key === 'Backspace' && input.value === '') {
      e.preventDefault();
      closePalette();
      return;
    }
    if (e.key === 'Enter') e.preventDefault();
  });

  /* Dismiss on in-page focus loss, but keep open across tab/window switches —
     those also fire blur even though the user didn't leave the command box. */
  input.addEventListener('blur', () => {
    requestAnimationFrame(() => {
      if (!open) return;
      if (document.hidden || !document.hasFocus()) return;
      if (root.contains(document.activeElement)) return;
      closePalette();
    });
  });

  /* Reclaim the caret when returning to a still-open palette. */
  function restoreFocusIfOpen() {
    if (!open || document.hidden || !document.hasFocus()) return;
    if (document.activeElement === input) return;
    input.focus({ preventScroll: true });
  }
  document.addEventListener('visibilitychange', restoreFocusIfOpen);
  window.addEventListener('focus', restoreFocusIfOpen);

  /* data-app-screen is written before the event publishes, so the frame is
     already authoritative here. */
  window.addEventListener('appscrollchange', () => {
    if (onScreen2()) scheduleLayout();
    else closePalette({ instant: true });
  });

  /* A menu replay (density rebuild, motion re-enable) re-raises Screen 2 from
     scratch and drops the LED box with it — do not keep capturing keys. */
  window.addEventListener('pixeldirectorystart', () => {
    closePalette({ instant: true });
  });

  window.addEventListener('resize', scheduleLayout, { passive: true });
  window.addEventListener('pixeldirectoryhold', scheduleLayout);

  return {
    isOpen: () => open,
    open: openPalette,
    close: closePalette,
    setIntro(nextIntro) {
      intro = nextIntro || null;
    },
  };
}
