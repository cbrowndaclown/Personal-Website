/* Settings control — labeled row shell (label + description + body slot). */

/**
 * @param {object} opts
 * @param {string} opts.label
 * @param {string} [opts.desc]
 * @param {string} [opts.id] — used for aria labelling
 * @param {boolean} [opts.metaRow] — label row lays out horizontally (e.g. swatch)
 * @returns {{ root: HTMLElement, body: HTMLElement, labelId: string|undefined, setDisabled: (on: boolean) => void }}
 */
export function createRow(opts) {
  const root = document.createElement('div');
  root.className = 'settings__row';
  if (opts.id) root.id = opts.id;

  const meta = document.createElement('div');
  meta.className = opts.metaRow ? 'settings__meta settings__meta--row' : 'settings__meta';

  const labelId = opts.id ? `${opts.id}-label` : undefined;
  const label = document.createElement('span');
  label.className = 'settings__label';
  if (labelId) label.id = labelId;
  label.textContent = opts.label;

  let desc = null;
  if (opts.desc) {
    desc = document.createElement('span');
    desc.className = 'settings__desc';
    desc.textContent = opts.desc;
  }

  if (opts.metaRow) {
    const textWrap = document.createElement('div');
    textWrap.appendChild(label);
    if (desc) textWrap.appendChild(desc);
    meta.appendChild(textWrap);
  } else {
    meta.appendChild(label);
    if (desc) meta.appendChild(desc);
  }

  root.appendChild(meta);

  const body = document.createElement('div');
  body.className = 'settings__row-body';
  root.appendChild(body);

  function setDisabled(on) {
    const next = !!on;
    if (root.classList.contains('is-disabled') === next) return;
    root.classList.toggle('is-disabled', next);
    root.setAttribute('aria-disabled', next ? 'true' : 'false');
  }

  return { root, body, labelId, setDisabled };
}
