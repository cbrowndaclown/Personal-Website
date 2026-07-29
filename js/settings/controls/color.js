/* Settings control — color picker (native input + hex readout). */

/**
 * @param {object} opts
 * @param {string} opts.id
 * @param {string} opts.value — #rrggbb
 * @param {string} [opts.labelledBy]
 * @param {(value: string) => void} opts.onChange
 * @returns {{
 *   root: HTMLElement,
 *   swatch: HTMLElement,
 *   setValue: (hex: string) => void,
 *   setLocked: (on: boolean) => void
 * }}
 */
export function createColorPicker(opts) {
  const root = document.createElement('div');
  root.className = 'settings__color';
  root.id = opts.id;
  root.setAttribute('role', 'group');
  if (opts.labelledBy) root.setAttribute('aria-labelledby', opts.labelledBy);

  const swatch = document.createElement('span');
  swatch.className = 'settings__swatch';
  swatch.setAttribute('aria-hidden', 'true');

  const input = document.createElement('input');
  input.type = 'color';
  input.className = 'settings__color-input';
  input.id = `${opts.id}-input`;
  input.value = normalizeHex(opts.value);
  if (opts.labelledBy) input.setAttribute('aria-labelledby', opts.labelledBy);

  const hex = document.createElement('span');
  hex.className = 'settings__color-hex';
  hex.id = `${opts.id}-hex`;

  root.append(input, hex);

  function normalizeHex(value) {
    const raw = String(value || '#000000').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
    if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toLowerCase()}`;
    return '#000000';
  }

  function paint(value) {
    const next = normalizeHex(value);
    if (input.value === next && hex.textContent === next.toUpperCase()) return;
    input.value = next;
    hex.textContent = next.toUpperCase();
    swatch.style.background = next;
  }

  function setValue(value) {
    paint(value);
  }

  function setLocked(on) {
    const next = !!on;
    if (input.disabled === next) return;
    input.disabled = next;
  }

  input.addEventListener('input', () => {
    paint(input.value);
    opts.onChange(input.value);
  });

  paint(opts.value);

  return { root, swatch, setValue, setLocked };
}
