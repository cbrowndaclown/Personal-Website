/* Settings control — segmented pill (2–n options). */

/**
 * @typedef {{ value: string, label: string, disabled?: boolean }} SegOption
 */

/**
 * @param {object} opts
 * @param {string} opts.id
 * @param {string} [opts.labelledBy]
 * @param {SegOption[]} opts.options
 * @param {string} opts.value
 * @param {(value: string) => void} opts.onChange
 * @returns {{ root: HTMLElement, setValue: (v: string) => void, setLocked: (on: boolean) => void }}
 */
export function createSegment(opts) {
  const options = opts.options.slice();
  const count = Math.max(2, options.length);
  const selectable = options.filter((o) => !o.disabled).map((o) => o.value);

  const root = document.createElement('div');
  root.className = 'settings__seg';
  root.id = opts.id;
  root.setAttribute('role', 'group');
  if (opts.labelledBy) root.setAttribute('aria-labelledby', opts.labelledBy);
  root.dataset.active = opts.value;
  root.style.setProperty('--seg-count', String(count));

  if (options.length === 2) root.classList.add('settings__seg--dual');
  if (options.length === 3) root.classList.add('settings__seg--triple');
  if (options.length >= 4) root.classList.add('settings__seg--n');

  const thumb = document.createElement('span');
  thumb.className = 'settings__seg-thumb';
  thumb.setAttribute('aria-hidden', 'true');
  root.appendChild(thumb);

  /** @type {Map<string, HTMLButtonElement>} */
  const buttons = new Map();

  options.forEach((opt, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'settings__seg-opt';
    btn.dataset.value = opt.value;
    btn.dataset.index = String(index);
    btn.textContent = opt.label;

    if (opt.disabled) {
      btn.disabled = true;
      btn.classList.add('is-placeholder');
      btn.setAttribute('aria-disabled', 'true');
      btn.title = 'Coming soon';
    } else {
      btn.setAttribute('aria-pressed', 'false');
    }

    buttons.set(opt.value, btn);
    root.appendChild(btn);
  });

  function resolveSelectable(value) {
    if (selectable.indexOf(value) !== -1) return value;
    return selectable[0] || value;
  }

  function syncThumb(active) {
    const resolved = resolveSelectable(active);
    const btn = buttons.get(resolved);
    const index = btn ? Number(btn.dataset.index) || 0 : 0;
    thumb.style.transform = `translateX(${index * 100}%)`;
    root.dataset.active = resolved;
    buttons.forEach((el, value) => {
      if (el.classList.contains('is-placeholder')) return;
      const on = value === resolved;
      el.classList.toggle('is-active', on);
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function setValue(value) {
    syncThumb(value);
  }

  function setLocked(on) {
    buttons.forEach((btn) => {
      if (btn.classList.contains('is-placeholder')) {
        btn.disabled = true;
        return;
      }
      btn.disabled = !!on;
    });
  }

  root.addEventListener('click', (e) => {
    const opt = e.target.closest('.settings__seg-opt');
    if (!opt || opt.disabled) return;
    const value = opt.dataset.value;
    if (!value || value === root.dataset.active) return;
    syncThumb(value);
    opts.onChange(value);
  });

  syncThumb(opts.value);

  return { root, setValue, setLocked };
}
