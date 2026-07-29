/* Settings control — native select dropdown. */

/**
 * @typedef {{ value: string, label: string, disabled?: boolean }} DropdownOption
 */

/**
 * @param {object} opts
 * @param {string} opts.id
 * @param {string} opts.value
 * @param {DropdownOption[]} opts.options
 * @param {string} [opts.labelledBy]
 * @param {(value: string) => void} opts.onChange
 * @returns {{ root: HTMLElement, setValue: (v: string) => void, setLocked: (on: boolean) => void }}
 */
export function createDropdown(opts) {
  const root = document.createElement('div');
  root.className = 'settings__dropdown';
  root.id = opts.id;

  const select = document.createElement('select');
  select.className = 'settings__select';
  select.id = `${opts.id}-select`;
  if (opts.labelledBy) select.setAttribute('aria-labelledby', opts.labelledBy);

  opts.options.forEach((opt) => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    if (opt.disabled) option.disabled = true;
    select.appendChild(option);
  });

  root.appendChild(select);

  function setValue(value) {
    if (select.value === value) return;
    select.value = value;
  }

  function setLocked(on) {
    const next = !!on;
    if (select.disabled === next) return;
    select.disabled = next;
  }

  select.addEventListener('change', () => {
    opts.onChange(select.value);
  });

  setValue(opts.value);

  return { root, setValue, setLocked };
}
