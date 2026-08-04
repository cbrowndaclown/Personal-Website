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

   Enter runs whatever command the entry is a prefix of. The actions themselves
   are LED work, so each one is a single call into the intro controller.
   ========================================================================== */

const LINE_KEY = 'options';
/* Screen 2 top-region menu line — `/text` clears it to free the corner. */
const HEADER_KEY = 'header';

/* Order is top-to-bottom on screen; the last entry sits against the box. */
const COMMANDS = [
  { name: '/clear', hint: 'Clears screen' },
  { name: '/text',  hint: 'Opens text box' },
  { name: '/more',  hint: 'Displays more options' },
];

/* The second page of `/more`. Actions land later; the list is the feature. */
const MORE_COMMANDS = [
  { name: '/paint',    hint: 'Allows you to paint' },
  { name: '/widgets',  hint: 'Manage widgets' },
  { name: '/theme',    hint: 'Manage site theme' },
  { name: '/settings', hint: 'Quick open settings' },
];

/* Only meaningful once `/clear` has emptied the screen, so it joins the list
   at open time instead of living in COMMANDS. */
const MENU_COMMAND = { name: '/menu', hint: 'Restores menu' };

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
  /** Option the entry currently prefixes, or -1. */
  let match = -1;
  /** A command's animation owns the box — hold keystrokes until it settles. */
  let running = false;
  /** The list the LED stack is currently showing. */
  let commands = COMMANDS.slice();

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

  /* Spoken counterpart to the LED option stack — rebuilt whenever the stack
     changes, so assistive tech reads the list the display is showing. */
  /** @type {HTMLLIElement[]} */
  let optionEls = [];

  function renderOptions() {
    list.replaceChildren();
    optionEls = commands.map((cmd) => {
      const li = document.createElement('li');
      li.className = 'command-palette__option';
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.textContent = `${cmd.name} — ${cmd.hint}`;
      list.append(li);
      return li;
    });
  }

  renderOptions();

  const input = document.createElement('input');
  input.className = 'command-palette__input';
  input.type = 'text';
  input.autocomplete = 'off';
  input.autocapitalize = 'off';
  input.spellcheck = false;
  input.maxLength = MAX_ENTRY;
  input.setAttribute('aria-label', 'Command input');

  /* Text box input — lives next to the command input but only captures
     keystrokes while the text box is open. */
  const txtInput = document.createElement('input');
  txtInput.className = 'command-palette__input command-palette__input--text';
  txtInput.type = 'text';
  txtInput.autocomplete = 'off';
  txtInput.autocapitalize = 'off';
  txtInput.spellcheck = false;
  txtInput.setAttribute('aria-label', 'Text box input');

  let txtOpen = false;

  root.append(list, input, txtInput);
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
    /* Prefer the live box: `/clear` slides it off the menu line it grew from. */
    const box =
      typeof ctrl.getScreen2CommandBox === 'function'
        ? ctrl.getScreen2CommandBox()
        : null;
    /* Match intro-controller CMD_ENTRY_SCALE / commandGeometry. */
    const entryGrid =
      box && box.fontPx > 0 ? box.fontPx : Math.max(5, Math.round(m.fontPx * 0.85));
    const fontPx = entryGrid * cell;
    const padX = Math.max(2, Math.round(entryGrid * 0.28)) * cell;
    const boxLeft = box
      ? Math.round(originX + box.boxLeft * cell)
      : Math.round(originX + Math.round(m.minX) * cell - padX);
    const centerY = Math.round(originY + (box ? box.cy : m.cy) * cell);

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
    /* The stage is the settings panel — there is no lattice to grow out of. */
    if (document.body.hasAttribute('data-settings-stage')) return false;
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

  /**
   * Push the entry to the LED box and emphasize the option it prefixes. An
   * entry short enough to prefix several options takes the topmost, so what
   * Enter runs is always the highest lit row rather than an arbitrary one.
   */
  function syncEntry() {
    const typed = ('/' + input.value).trim().toLowerCase();
    match = -1;
    if (typed.length > 1) {
      match = commands.findIndex((cmd) => cmd.name.startsWith(typed));
    }
    optionEls.forEach((el, index) => {
      el.setAttribute('aria-selected', index === match ? 'true' : 'false');
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

  /* ── Commands ───────────────────────────────────────────────────────────
     Every action is LED work on the shared grid, so each runner is a call into
     the intro controller plus the keystroke gate around its animation. */

  function beginRun() {
    running = true;
    /* readOnly keeps focus (and the LED caret) while the animation plays. */
    input.readOnly = true;
  }

  function endRun() {
    running = false;
    input.readOnly = false;
  }

  /**
   * `/clear` — retire everything on Screen 2, the box included, then raise
   * the box again lower on the display with its options.
   */
  function runClear() {
    const ctrl = resolveIntro();
    if (!ctrl || typeof ctrl.clearScreen2Content !== 'function') return;
    beginRun();
    /* The entry that invoked the command is spent — reset it before the box
       goes so the caret returns on an empty prompt. */
    input.value = '';
    syncEntry();
    /* The box comes back offering `/menu`: the screen it restores is the one
       this command is about to retire. */
    commands = COMMANDS.concat(MENU_COMMAND);
    renderOptions();
    const started = ctrl.clearScreen2Content({
      options: commands,
      onDone: () => {
        if (!open) return;
        endRun();
        syncEntry();
        scheduleLayout();
      },
    });
    if (!started) endRun();
  }

  /**
   * `/text` — clear the top menu line, then raise the text box in the corner
   * it vacated. The text box takes the surface, so the command box closes.
   */
  function runText() {
    const ctrl = resolveIntro();
    if (!ctrl || typeof ctrl.clearScreen2Lines !== 'function') return;
    beginRun();
    const started = ctrl.clearScreen2Lines([HEADER_KEY], {
      quick: true,
      onDone: () => {
        endRun();
        closePalette();
        if (typeof ctrl.openScreen2TextBox === 'function') {
          ctrl.openScreen2TextBox();
        }
        openTextInput();
      },
    });
    if (!started) endRun();
  }

  /**
   * `/more` — retire the option stack and raise the second page in its place.
   * The box itself never moves, so the swap reads as the list turning over.
   */
  function runMore() {
    const ctrl = resolveIntro();
    if (!ctrl || typeof ctrl.setScreen2CommandOptions !== 'function') return;
    beginRun();
    input.value = '';
    syncEntry();
    commands = MORE_COMMANDS.slice();
    renderOptions();
    const started = ctrl.setScreen2CommandOptions(commands, {
      onDone: () => {
        if (!open) return;
        endRun();
        syncEntry();
        scheduleLayout();
      },
    });
    if (!started) endRun();
  }

  /**
   * `/menu` — hand Screen 2 back to the menu. The box goes first so the
   * assemble replays into an empty grid, exactly like the first visit.
   */
  function runMenu() {
    const ctrl = resolveIntro();
    if (!ctrl || typeof ctrl.replayScreen2Menu !== 'function') return;
    closePalette();
    /* Chained onto the dismiss already in flight — fires once it settles. */
    if (typeof ctrl.closeScreen2Command === 'function') {
      ctrl.closeScreen2Command({ onDone: () => ctrl.replayScreen2Menu() });
    } else {
      ctrl.replayScreen2Menu();
    }
  }

  /** Run the option the entry currently prefixes. */
  function runMatchedCommand() {
    if (running || match < 0 || match >= commands.length) return;
    switch (commands[match].name) {
      case '/clear':
        runClear();
        return;
      case '/text':
        runText();
        return;
      case '/more':
        runMore();
        return;
      case '/menu':
        runMenu();
        return;
      default:
        /* The `/more` page is a listing for now — no actions behind it yet. */
        return;
    }
  }

  /**
   * The list the box opens with. `/menu` only earns a row once `/clear` has
   * emptied the screen there would be something to restore.
   */
  function activeCommands() {
    const ctrl = resolveIntro();
    const cleared = !!(
      ctrl &&
      typeof ctrl.hasScreen2Cleared === 'function' &&
      ctrl.hasScreen2Cleared()
    );
    return cleared ? COMMANDS.concat(MENU_COMMAND) : COMMANDS.slice();
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
    commands = activeCommands();
    renderOptions();
    /* Mask first: the box grows into the space the menu line just vacated. */
    setMasked(true);
    if (!ctrl.openScreen2Command(LINE_KEY, commands)) {
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
    endRun();
    match = -1;
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

  /* ── Text box input ─────────────────────────────────────────────────── */

  function layoutTextInput() {
    const ctrl = resolveIntro();
    if (!ctrl || typeof ctrl.getScreen2TextBox !== 'function') return;
    const box = ctrl.getScreen2TextBox();
    if (!box || !(box.cell > 0)) return;

    const canvasRect = canvas.getBoundingClientRect();
    const screenRect = screen.getBoundingClientRect();
    const originX = canvasRect.left - screenRect.left;
    const originY = canvasRect.top - screenRect.top;

    const left = Math.round(originX + box.boxLeft * box.cell);
    const top = Math.round(originY + box.boxTop * box.cell);
    const w = Math.round(box.boxW * box.cell);
    const h = Math.round(box.boxH * box.cell);
    const font = Math.round(box.fontPx * box.cell);

    root.style.setProperty('--tp-left', `${left}px`);
    root.style.setProperty('--tp-top', `${top}px`);
    root.style.setProperty('--tp-width', `${w}px`);
    root.style.setProperty('--tp-height', `${h}px`);
    root.style.setProperty('--tp-font', `${font}px`);
  }

  function syncTextEntry() {
    const ctrl = resolveIntro();
    if (ctrl && typeof ctrl.setScreen2TextBoxText === 'function') {
      ctrl.setScreen2TextBoxText(txtInput.value);
    }
  }

  function openTextInput() {
    if (txtOpen) return;
    txtOpen = true;
    layoutTextInput();
    txtInput.value = '';
    txtInput.style.pointerEvents = 'auto';
    requestAnimationFrame(() => {
      txtInput.focus({ preventScroll: true });
    });
  }

  function closeTextInput() {
    if (!txtOpen) return;
    txtOpen = false;
    txtInput.blur();
    txtInput.value = '';
    txtInput.style.pointerEvents = '';
  }

  txtInput.addEventListener('input', syncTextEntry);

  txtInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      const ctrl = resolveIntro();
      if (ctrl && typeof ctrl.closeScreen2TextBox === 'function') {
        ctrl.closeScreen2TextBox();
      }
      closeTextInput();
      return;
    }
  });

  txtInput.addEventListener('blur', () => {
    requestAnimationFrame(() => {
      if (!txtOpen) return;
      if (document.hidden || !document.hasFocus()) return;
      if (root.contains(document.activeElement)) return;
      const ctrl = resolveIntro();
      if (ctrl && typeof ctrl.closeScreen2TextBox === 'function') {
        ctrl.closeScreen2TextBox();
      }
      closeTextInput();
    });
  });

  /* ── Input wiring ───────────────────────────────────────────────────── */

  function editableTarget(target) {
    if (!target || !target.closest) return false;
    if (target === txtInput) return true;
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

  /* The text box outlives the command box that raised it, so nothing holds
     focus to dismiss it — Escape retires it the way it does the command box,
     without spending `/clear` on the whole screen. */
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || open) return;
    /* Settings owns Escape while its panel is up. */
    if (document.querySelector('.settings__panel.is-open')) return;
    if (!onScreen2()) return;
    /* The txtInput's own keydown already handles Escape when it has focus. */
    if (e.target === txtInput) return;
    const ctrl = resolveIntro();
    if (
      !ctrl ||
      typeof ctrl.isScreen2TextBoxOpen !== 'function' ||
      !ctrl.isScreen2TextBoxOpen()
    ) {
      return;
    }
    e.preventDefault();
    ctrl.closeScreen2TextBox();
    closeTextInput();
  });

  input.addEventListener('input', syncEntry);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closePalette();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      runMatchedCommand();
      return;
    }
    /* A running command owns the box — swallow edits until it settles. */
    if (running) {
      e.preventDefault();
      return;
    }
    /* Backspacing past the prompt dismisses the box, matching the slash
       that opened it. */
    if (e.key === 'Backspace' && input.value === '') {
      e.preventDefault();
      closePalette();
      return;
    }
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

  /* Reclaim the caret when returning to a still-open palette or text box. */
  function restoreFocusIfOpen() {
    if (document.hidden || !document.hasFocus()) return;
    if (txtOpen) {
      if (document.activeElement === txtInput) return;
      txtInput.focus({ preventScroll: true });
      return;
    }
    if (!open) return;
    if (document.activeElement === input) return;
    input.focus({ preventScroll: true });
  }
  document.addEventListener('visibilitychange', restoreFocusIfOpen);
  window.addEventListener('focus', restoreFocusIfOpen);

  /* data-app-screen is written before the event publishes, so the frame is
     already authoritative here. */
  window.addEventListener('appscrollchange', () => {
    if (onScreen2()) scheduleLayout();
    else {
      closePalette({ instant: true });
      closeTextInput();
    }
  });

  /* A menu replay (density rebuild, motion re-enable) re-raises Screen 2 from
     scratch and drops the LED box with it — do not keep capturing keys. */
  window.addEventListener('pixeldirectorystart', () => {
    closePalette({ instant: true });
    closeTextInput();
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
