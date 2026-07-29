/* Settings control — on/off toggle switch. */

/**
 * @param {object} opts
 * @param {string} opts.id
 * @param {boolean} opts.value
 * @param {string} [opts.labelledBy]
 * @param {(value: boolean) => void} opts.onChange
 * @returns {{ root: HTMLElement, setValue: (v: boolean) => void, setLocked: (on: boolean) => void }}
 */
export function createToggle(opts) {
  const root = document.createElement('button');
  root.type = 'button';
  root.className = 'settings__toggle';
  root.id = opts.id;
  root.setAttribute('role', 'switch');
  if (opts.labelledBy) root.setAttribute('aria-labelledby', opts.labelledBy);

  const thumb = document.createElement('span');
  thumb.className = 'settings__toggle-thumb';
  thumb.setAttribute('aria-hidden', 'true');
  root.appendChild(thumb);

  let locked = false;
  let value = !!opts.value;

  function paint(next) {
    const on = !!next;
    if (value === on) return;
    value = on;
    root.classList.toggle('is-on', value);
    root.setAttribute('aria-checked', value ? 'true' : 'false');
  }

  function setValue(next) {
    paint(next);
  }

  function setLocked(on) {
    const next = !!on;
    if (locked === next) return;
    locked = next;
    root.disabled = locked;
  }

  root.addEventListener('click', () => {
    if (locked) return;
    paint(!value);
    opts.onChange(value);
  });

  /* Force initial paint even when starting false (paint early-returns on match). */
  value = !opts.value;
  paint(opts.value);

  return { root, setValue, setLocked };
}
