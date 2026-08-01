/* Config → DOM — renders reusable controls from SettingDef entries. */

import {
  createRow,
  createSegment,
  createRgbControl,
  createToggle,
  createSlider,
  createDropdown,
  createColorPicker,
  createNumberInput,
} from './controls/index.js';
import { createSection } from './section.js';
import {
  SETTINGS,
  EMPTY_SETTINGS_MESSAGE,
} from './definitions/index.js';

/**
 * Resolve option list for a setting definition.
 * @param {import('./definitions/settings.js').SettingDef} def
 * @param {object} [api]
 */
function resolveOptions(def, api) {
  if (typeof def.optionsFrom === 'function') {
    return def.optionsFrom.length > 0 ? def.optionsFrom(api) : def.optionsFrom();
  }
  return def.options ? def.options.slice() : [];
}

/**
 * Apply disabledWhen to a row + optional control lock.
 * @param {ReturnType<typeof createRow>} row
 * @param {{ setLocked?: (on: boolean) => void } | null} control
 * @param {import('./definitions/settings.js').SettingDef} def
 * @param {object} api
 */
function syncDisabled(row, control, def, api) {
  const disabled =
    typeof def.disabledWhen === 'function' && def.disabledWhen(api);
  row.setDisabled(!!disabled);
  if (control && typeof control.setLocked === 'function') {
    control.setLocked(!!disabled);
  }
}

/**
 * Whether changing this setting may alter which rows are visible / enabled.
 * Those need a full inspector sync; continuous knobs do not.
 * @param {import('./definitions/settings.js').SettingDef} def
 */
function needsInspectorSync(def) {
  return (
    def.type === 'segment' ||
    def.id === 'style' ||
    def.id === 'motion' ||
    def.id === 'pixel-preset'
  );
}

/**
 * Mount one setting control into a section body.
 * @param {HTMLElement} body
 * @param {import('./definitions/settings.js').SettingDef} def
 * @param {object} api
 * @param {{ suppressSync?: () => void, allowSync?: () => void, requestSync?: () => void, requestSoftSync?: () => void }} [syncGate]
 * @returns {{ root: HTMLElement, sync: () => void, syncOnSoft?: boolean }}
 */
export function renderSetting(body, def, api, syncGate) {
  const row = createRow({
    id: `settings-${def.id}-row`,
    label: def.label,
    desc: def.desc,
    metaRow: !!def.metaRow,
  });

  /** @type {(() => void) | null} */
  let syncControl = null;

  function applySet(value, extra) {
    const quiet = syncGate && !needsInspectorSync(def);
    if (quiet) syncGate.suppressSync();
    try {
      if (extra !== undefined) def.set(api, value, extra);
      else def.set(api, value);
    } finally {
      if (quiet) syncGate.allowSync();
    }
    if (syncGate && needsInspectorSync(def) && typeof syncGate.requestSync === 'function') {
      syncGate.requestSync();
    }
  }

  if (def.type === 'segment') {
    const allOptions = resolveOptions(def, api);
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
      onChange: (value) => applySet(value),
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
      const value = def.resolveValue
        ? def.resolveValue(api, selectable)
        : def.get(api);
      seg.setValue(value);
      syncDisabled(row, seg, def, api);
    };
  } else if (def.type === 'rgb') {
    const rgb = createRgbControl({
      id: `settings-${def.id}`,
      labelledBy: row.labelId,
      value: def.get(api),
      onChange: (c, publish) => applySet(c, publish),
    });
    if (def.metaRow) {
      const meta = row.root.querySelector('.settings__meta');
      if (meta) meta.appendChild(rgb.swatch);
    }
    row.body.appendChild(rgb.root);

    syncControl = () => {
      rgb.setValue(def.get(api));
      syncDisabled(row, null, def, api);
    };
  } else if (def.type === 'toggle') {
    const toggle = createToggle({
      id: `settings-${def.id}`,
      labelledBy: row.labelId,
      value: !!def.get(api),
      onChange: (value) => applySet(value),
    });
    row.body.appendChild(toggle.root);

    syncControl = () => {
      toggle.setValue(!!def.get(api));
      syncDisabled(row, toggle, def, api);
    };
  } else if (def.type === 'slider') {
    const range = def.range || { min: 0, max: 100, step: 1 };
    const slider = createSlider({
      id: `settings-${def.id}`,
      labelledBy: row.labelId,
      value: Number(def.get(api)),
      min: range.min,
      max: range.max,
      step: range.step,
      unit: range.unit,
      onChange: (value) => applySet(value),
    });
    row.body.appendChild(slider.root);

    syncControl = () => {
      slider.setValue(Number(def.get(api)));
      syncDisabled(row, slider, def, api);
    };
  } else if (def.type === 'dropdown') {
    const options = resolveOptions(def, api);
    const dropdown = createDropdown({
      id: `settings-${def.id}`,
      labelledBy: row.labelId,
      value: String(def.get(api)),
      options,
      onChange: (value) => applySet(value),
    });
    row.body.appendChild(dropdown.root);

    syncControl = () => {
      dropdown.setValue(String(def.get(api)));
      syncDisabled(row, dropdown, def, api);
    };
  } else if (def.type === 'color') {
    const color = createColorPicker({
      id: `settings-${def.id}`,
      labelledBy: row.labelId,
      value: String(def.get(api)),
      onChange: (value) => applySet(value),
    });
    if (def.metaRow) {
      const meta = row.root.querySelector('.settings__meta');
      if (meta) meta.appendChild(color.swatch);
    }
    row.body.appendChild(color.root);

    syncControl = () => {
      color.setValue(String(def.get(api)));
      syncDisabled(row, color, def, api);
    };
  } else if (def.type === 'number') {
    const range = def.range || {};
    const number = createNumberInput({
      id: `settings-${def.id}`,
      labelledBy: row.labelId,
      value: Number(def.get(api)),
      min: range.min,
      max: range.max,
      step: range.step,
      unit: range.unit,
      onChange: (value) => applySet(value),
    });
    row.body.appendChild(number.root);

    syncControl = () => {
      number.setValue(Number(def.get(api)));
      syncDisabled(row, number, def, api);
    };
  } else {
    /* Reserved / unknown types — quiet stub so the registry stays extensible. */
    const stub = document.createElement('span');
    stub.className = 'settings__empty';
    stub.textContent = `Unsupported control type: ${def.type}`;
    row.body.appendChild(stub);
    syncControl = () => {};
  }

  if (def.styleId) {
    row.root.dataset.styleId = def.styleId;
  }

  body.appendChild(row.root);

  return {
    root: row.root,
    syncOnSoft: !!def.syncOnSoft,
    sync() {
      if (syncControl) syncControl();
    },
  };
}

/**
 * Mount settings into a body and return sync + row handles.
 * @param {HTMLElement} body
 * @param {import('./definitions/settings.js').SettingDef[]} defs
 * @param {object} api
 * @param {{ suppressSync?: () => void, allowSync?: () => void, requestSync?: () => void }} [syncGate]
 */
function mountSettingHandles(body, defs, api, syncGate) {
  return defs.map((def) => ({
    def,
    ...renderSetting(body, def, api, syncGate),
  }));
}

/**
 * Sync row visibility for style-scoped settings; returns visible count.
 * @param {Array<{ def: import('./definitions/settings.js').SettingDef, root: HTMLElement, sync: () => void }>} handles
 * @param {string} styleId
 */
function syncSettingHandles(handles, styleId) {
  let visible = 0;
  handles.forEach((handle) => {
    const show = !handle.def.styleId || handle.def.styleId === styleId;
    if (handle.root.hidden !== !show) {
      handle.root.hidden = !show;
    }
    if (show) {
      visible += 1;
      handle.sync();
    }
  });
  return visible;
}

/**
 * Render every setting for a category, including config-driven nested
 * sections. Style-scoped rows/sections hide when inactive; empty categories
 * show a clean placeholder.
 *
 * @param {HTMLElement} body
 * @param {object} opts
 * @param {string} opts.categoryId
 * @param {import('./definitions/settings.js').SettingsSectionDef[]} [opts.sections]
 * @param {object} opts.api
 * @param {(api: object) => string} opts.resolveStyleId
 * @param {string} [opts.emptyMessage]
 * @param {{ suppressSync?: () => void, allowSync?: () => void, requestSync?: () => void }} [opts.syncGate]
 * @returns {{
 *   sync: () => void,
 *   softSync: () => void,
 *   sections: Array<{
 *     id: string,
 *     root: HTMLElement,
 *     body: HTMLElement,
 *     isOpen: () => boolean,
 *     setOpen: (open: boolean, animate?: boolean) => void,
 *     setTitle: (text: string) => void
 *   }>
 * }}
 */
export function bindCategorySettings(body, opts) {
  const {
    categoryId,
    sections: sectionDefs = [],
    api,
    resolveStyleId,
    emptyMessage = EMPTY_SETTINGS_MESSAGE,
    syncGate,
  } = opts;

  const knownSectionIds = new Set(sectionDefs.map((s) => s.id));
  const categoryDefs = SETTINGS.filter((def) => def.categoryId === categoryId);
  const rootDefs = categoryDefs.filter(
    (def) => !def.sectionId || !knownSectionIds.has(def.sectionId)
  );

  const empty = document.createElement('p');
  empty.className = 'settings__empty';
  empty.textContent = emptyMessage;
  body.appendChild(empty);

  /** @type {Array<{ def: import('./definitions/settings.js').SettingsSectionDef, section: ReturnType<typeof createSection>, handles: ReturnType<typeof mountSettingHandles>, empty: HTMLElement, lastVisible: number }>} */
  const nested = [];

  sectionDefs.forEach((sectionDef) => {
    const sectionEmptyMsg = sectionDef.emptyMessage || emptyMessage;
    const section = createSection({
      id: `${categoryId}__${sectionDef.id}`,
      title: sectionDef.title,
      defaultOpen: !!sectionDef.defaultOpen,
      className: 'settings__section--nested',
    });

    const sectionEmpty = document.createElement('p');
    sectionEmpty.className = 'settings__empty';
    sectionEmpty.textContent = sectionEmptyMsg;
    section.body.appendChild(sectionEmpty);

    const defs = categoryDefs.filter((def) => def.sectionId === sectionDef.id);
    const handles = mountSettingHandles(section.body, defs, api, syncGate);

    if (sectionDef.styleId) {
      section.root.dataset.styleId = sectionDef.styleId;
    }

    nested.push({
      def: sectionDef,
      section,
      handles,
      empty: sectionEmpty,
      lastVisible: -1,
    });
    body.appendChild(section.root);
  });

  const rootHandles = mountSettingHandles(body, rootDefs, api, syncGate);

  let lastStyleId = null;
  let lastVisible = -1;

  function sync() {
    const styleId = resolveStyleId(api);
    let visible = 0;

    nested.forEach((entry) => {
      const sectionShow =
        !entry.def.styleId || entry.def.styleId === styleId;
      if (entry.section.root.hidden !== !sectionShow) {
        entry.section.root.hidden = !sectionShow;
      }
      if (!sectionShow) {
        entry.lastVisible = 0;
        return;
      }

      const sectionVisible = syncSettingHandles(entry.handles, styleId);
      if (sectionVisible !== entry.lastVisible) {
        entry.empty.hidden = sectionVisible > 0;
        entry.lastVisible = sectionVisible;
      }
      if (sectionVisible > 0) visible += 1;
    });

    visible += syncSettingHandles(rootHandles, styleId);

    if (visible !== lastVisible || styleId !== lastStyleId) {
      empty.hidden = visible > 0;
      lastVisible = visible;
      lastStyleId = styleId;
    }
  }

  /** Soft publishes skip full inspector sync — refresh syncOnSoft rows only. */
  function softSync() {
    nested.forEach((entry) => {
      entry.handles.forEach((handle) => {
        if (handle.syncOnSoft && !handle.root.hidden) handle.sync();
      });
    });
    rootHandles.forEach((handle) => {
      if (handle.syncOnSoft && !handle.root.hidden) handle.sync();
    });
  }

  return {
    sync,
    softSync,
    sections: nested.map((entry) => entry.section),
  };
}
