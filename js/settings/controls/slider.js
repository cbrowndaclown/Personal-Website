/* Settings control — single range slider with live value. */

/**
 * Snap onto the slider's step grid so the UI never shows float dust.
 * @param {number} n
 * @param {number} min
 * @param {number} max
 * @param {number} step
 * @returns {number}
 */
function snapValue(n, min, max, step) {
  const value = Number(n);
  if (!Number.isFinite(value)) return min;
  const clamped = Math.min(max, Math.max(min, value));
  if (!(step > 0)) return clamped;
  const stepped = Math.round((clamped - min) / step) * step + min;
  const precision = step >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(step)));
  const rounded =
    precision === 0
      ? Math.round(stepped)
      : Number(stepped.toFixed(precision));
  return Math.min(max, Math.max(min, rounded));
}

/**
 * @param {object} opts
 * @param {string} opts.id
 * @param {number} opts.value
 * @param {number} opts.min
 * @param {number} opts.max
 * @param {number} [opts.step]
 * @param {string} [opts.unit]
 * @param {string} [opts.labelledBy]
 * @param {(value: number) => void} opts.onChange
 * @returns {{ root: HTMLElement, setValue: (v: number) => void, setLocked: (on: boolean) => void }}
 */
export function createSlider(opts) {
  const min = opts.min;
  const max = opts.max;
  const step = opts.step == null ? 1 : opts.step;
  const unit = opts.unit || '';

  const root = document.createElement('label');
  root.className = 'settings__slider settings__slider--solo';
  root.id = opts.id;

  const input = document.createElement('input');
  input.type = 'range';
  input.id = `${opts.id}-input`;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(snapValue(opts.value, min, max, step));
  if (opts.labelledBy) input.setAttribute('aria-labelledby', opts.labelledBy);

  const val = document.createElement('span');
  val.className = 'settings__slider-val';
  val.id = `${opts.id}-val`;

  root.append(input, val);

  let locked = false;
  let current = NaN;

  function format(n) {
    const display = step >= 1 ? String(Math.round(n)) : String(n);
    return unit ? `${display}${unit}` : display;
  }

  function paint(n) {
    const snapped = snapValue(n, min, max, step);
    if (snapped === current && input.value === String(snapped)) {
      return;
    }
    current = snapped;
    input.value = String(snapped);
    val.textContent = format(snapped);
  }

  function setValue(n) {
    paint(n);
  }

  function setLocked(on) {
    const next = !!on;
    if (locked === next) return;
    locked = next;
    input.disabled = locked;
  }

  input.addEventListener('input', () => {
    const n = snapValue(input.value, min, max, step);
    current = n;
    input.value = String(n);
    val.textContent = format(n);
    opts.onChange(n);
  });

  paint(opts.value);

  return { root, setValue, setLocked };
}
