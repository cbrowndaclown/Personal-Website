/* Config → DOM — renders reusable controls from SettingDef entries. */

import { createRow, createSegment, createRgbControl } from './controls/index.js';

/**
 * Resolve option list for a setting definition.
 * @param {import('./definitions/settings.js').SettingDef} def
 */
function resolveOptions(def) {
  if (typeof def.optionsFrom === 'function') return def.optionsFrom();
  return def.options ? def.options.slice() : [];
}

/**
 * Mount one setting control into a section body.
 * @param {HTMLElement} body
 * @param {import('./definitions/settings.js').SettingDef} def
 * @param {object} api
 * @returns {{ sync: () => void }}
 */
export function renderSetting(body, def, api) {
  const row = createRow({
    id: `settings-${def.id}-row`,
    label: def.label,
    desc: def.desc,
    metaRow: !!def.metaRow,
  });

  /** @type {(() => void) | null} */
  let syncControl = null;

  if (def.type === 'segment') {
    const allOptions = resolveOptions(def);
    const activeOptions = allOptions.filter((o) => !o.disabled);
    const selectable = activeOptions.map((o) => o.value);
    const initial = def.resolveValue
      ? def.resolveValue(api, selectable)
      : def.get(api);

    const seg = createSegment({
      id: `settings-${def.id}`,
      labelledBy: row.labelId,
      value: initial,
      options: activeOptions,
      onChange: (value) => def.set(api, value),
    });
    row.body.appendChild(seg.root);

    /* Disabled options render as separate placeholders (preserves Style → Experimental). */
    allOptions
      .filter((o) => o.disabled)
      .forEach((opt) => {
        const placeholder = document.createElement('button');
        placeholder.type = 'button';
        placeholder.className = 'settings__seg-placeholder';
        placeholder.dataset.value = opt.value;
        placeholder.textContent = opt.label;
        placeholder.disabled = true;
        placeholder.setAttribute('aria-disabled', 'true');
        placeholder.title = 'Coming soon';
        row.body.appendChild(placeholder);
      });

    syncControl = () => {
      const disabled = typeof def.disabledWhen === 'function' && def.disabledWhen(api);
      const value = def.resolveValue
        ? def.resolveValue(api, selectable)
        : def.get(api);
      seg.setValue(value);
      row.setDisabled(!!disabled);
      seg.setLocked(!!disabled);
    };
  } else if (def.type === 'rgb') {
    const rgb = createRgbControl({
      id: `settings-${def.id}`,
      labelledBy: row.labelId,
      value: def.get(api),
      onChange: (c, publish) => def.set(api, c, publish),
    });
    if (def.metaRow) {
      const meta = row.root.querySelector('.settings__meta');
      if (meta) meta.appendChild(rgb.swatch);
    }
    row.body.appendChild(rgb.root);

    syncControl = () => {
      rgb.setValue(def.get(api));
      if (typeof def.disabledWhen === 'function') {
        row.setDisabled(!!def.disabledWhen(api));
      }
    };
  } else {
    /* Reserved for slider / dropdown / toggle / button — leave a quiet stub row. */
    const stub = document.createElement('span');
    stub.className = 'settings__empty';
    stub.textContent = `Unsupported control type: ${def.type}`;
    row.body.appendChild(stub);
    syncControl = () => {};
  }

  body.appendChild(row.root);

  return {
    sync() {
      if (syncControl) syncControl();
    },
  };
}

/**
 * Render a list of setting definitions into a section body.
 * @param {HTMLElement} body
 * @param {import('./definitions/settings.js').SettingDef[]} defs
 * @param {object} api
 * @returns {{ sync: () => void }}
 */
export function bindSettings(body, defs, api) {
  const handles = (defs || []).map((def) => renderSetting(body, def, api));
  return {
    sync() {
      handles.forEach((h) => h.sync());
    },
  };
}

/**
 * Render style-specific settings for every registered style; show only the active group.
 * @param {HTMLElement} body
 * @param {object} opts
 * @param {object} opts.api
 * @param {Record<string, import('./definitions/settings.js').SettingDef[]>} opts.styleSettings
 * @param {string} opts.emptyMessage
 * @param {(title: string) => void} [opts.setTitle]
 * @param {(api: object) => string} opts.resolveStyleId
 * @param {(styleId: string) => string} opts.getStyleLabel
 * @returns {{ sync: () => void }}
 */
export function bindStyleSpecificSettings(body, opts) {
  const { api, styleSettings, emptyMessage, setTitle, resolveStyleId, getStyleLabel } =
    opts;

  const empty = document.createElement('p');
  empty.className = 'settings__empty';
  empty.textContent = emptyMessage;
  body.appendChild(empty);

  /** @type {Map<string, { root: HTMLElement, sync: () => void, count: number }>} */
  const groups = new Map();

  Object.keys(styleSettings).forEach((styleId) => {
    const defs = styleSettings[styleId] || [];
    const group = document.createElement('div');
    group.className = 'settings__style-group';
    group.dataset.style = styleId;
    group.hidden = true;
    const bound = bindSettings(group, defs, api);
    body.appendChild(group);
    groups.set(styleId, { root: group, sync: bound.sync, count: defs.length });
  });

  function sync() {
    const styleId = resolveStyleId(api);
    const label = getStyleLabel(styleId);
    if (typeof setTitle === 'function') {
      setTitle(`${label} Settings`);
    }

    let activeCount = 0;
    groups.forEach((group, id) => {
      const isActive = id === styleId;
      const show = isActive && group.count > 0;
      group.root.hidden = !show;
      if (isActive) {
        activeCount = group.count;
        if (show) group.sync();
      }
    });

    empty.hidden = activeCount > 0;
  }

  return { sync };
}
