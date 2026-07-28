/* Settings control — RGB triad sliders + live swatch. */

/**
 * @param {object} opts
 * @param {string} opts.id
 * @param {{ r: number, g: number, b: number }} opts.value
 * @param {string} [opts.labelledBy]
 * @param {(rgb: { r: number, g: number, b: number }, publish: boolean) => void} opts.onChange
 * @returns {{
 *   root: HTMLElement,
 *   swatch: HTMLElement,
 *   setValue: (rgb: { r: number, g: number, b: number }) => void
 * }}
 */
export function createRgbControl(opts) {
  const root = document.createElement('div');
  root.className = 'settings__colors';
  root.id = opts.id;
  root.setAttribute('role', 'group');
  if (opts.labelledBy) root.setAttribute('aria-labelledby', opts.labelledBy);

  const swatch = document.createElement('span');
  swatch.className = 'settings__swatch';
  swatch.id = `${opts.id}-swatch`;
  swatch.setAttribute('aria-hidden', 'true');
  swatch.title = 'Current color';

  /** @type {Record<'r'|'g'|'b', { input: HTMLInputElement, val: HTMLElement }>} */
  const channels = {};

  ['r', 'g', 'b'].forEach((ch) => {
    const label = document.createElement('label');
    label.className = 'settings__slider';

    const name = document.createElement('span');
    name.className = 'settings__slider-label';
    name.textContent = ch.toUpperCase();

    const input = document.createElement('input');
    input.type = 'range';
    input.id = `${opts.id}-${ch}`;
    input.min = '0';
    input.max = '255';
    input.value = String(opts.value[ch]);
    input.setAttribute('aria-label', ch === 'r' ? 'Red' : ch === 'g' ? 'Green' : 'Blue');

    const val = document.createElement('span');
    val.className = 'settings__slider-val';
    val.id = `${opts.id}-${ch}-val`;
    val.textContent = String(opts.value[ch]);

    label.append(name, input, val);
    root.appendChild(label);
    channels[ch] = { input, val };

    input.addEventListener('input', () => {
      const rgb = read();
      paint(rgb);
      opts.onChange(rgb, true);
    });
  });

  function read() {
    return {
      r: Number(channels.r.input.value) | 0,
      g: Number(channels.g.input.value) | 0,
      b: Number(channels.b.input.value) | 0,
    };
  }

  function paint(rgb) {
    channels.r.input.value = String(rgb.r);
    channels.g.input.value = String(rgb.g);
    channels.b.input.value = String(rgb.b);
    channels.r.val.textContent = String(rgb.r);
    channels.g.val.textContent = String(rgb.g);
    channels.b.val.textContent = String(rgb.b);
    swatch.style.background = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
  }

  function setValue(rgb) {
    paint(rgb);
  }

  paint(opts.value);

  return { root, swatch, setValue };
}
