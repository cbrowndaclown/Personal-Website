/* Settings control — numeric stepper input. */

/**
 * @param {object} opts
 * @param {string} opts.id
 * @param {number} opts.value
 * @param {number} [opts.min]
 * @param {number} [opts.max]
 * @param {number} [opts.step]
 * @param {string} [opts.unit]
 * @param {string} [opts.labelledBy]
 * @param {(value: number) => void} opts.onChange
 * @returns {{ root: HTMLElement, setValue: (v: number) => void, setLocked: (on: boolean) => void }}
 */
export function createNumberInput(opts) {
  const root = document.createElement('label');
  root.className = 'settings__number';
  root.id = opts.id;

  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'settings__number-input';
  input.id = `${opts.id}-input`;
  if (opts.min != null) input.min = String(opts.min);
  if (opts.max != null) input.max = String(opts.max);
  if (opts.step != null) input.step = String(opts.step);
  input.value = String(opts.value);
  if (opts.labelledBy) input.setAttribute('aria-labelledby', opts.labelledBy);

  root.appendChild(input);

  if (opts.unit) {
    const unit = document.createElement('span');
    unit.className = 'settings__number-unit';
    unit.textContent = opts.unit;
    root.appendChild(unit);
  }

  function clamp(n) {
    let next = Number(n);
    if (!Number.isFinite(next)) next = opts.value;
    if (opts.min != null) next = Math.max(opts.min, next);
    if (opts.max != null) next = Math.min(opts.max, next);
    return next;
  }

  function setValue(n) {
    const next = clamp(n);
    if (input.value === String(next)) return;
    input.value = String(next);
  }

  function setLocked(on) {
    const next = !!on;
    if (input.disabled === next) return;
    input.disabled = next;
  }

  function commit() {
    const next = clamp(input.value);
    input.value = String(next);
    opts.onChange(next);
  }

  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    }
  });

  return { root, setValue, setLocked };
}
