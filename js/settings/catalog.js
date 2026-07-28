/* Settings catalog — assembles the inspector from declarative definitions. */

import {
  STATIC_SECTIONS,
  STYLE_SETTINGS_SECTION,
  PIXEL_FS_STYLE_SETTINGS,
  getStyleById,
  getStyleLabel,
} from './definitions/index.js';
import { bindSettings, bindStyleSpecificSettings } from './render.js';

/**
 * Resolve which style drives the style-specific settings header/body.
 * @param {object} api
 * @returns {string}
 */
function resolveUiStyleId(api) {
  const mode = api.getBgMode();
  if (getStyleById(mode)) return mode;
  return api.getLastImplementedBgMode() || 'heat';
}

/**
 * Ordered inspector categories. Sections and controls come from definitions;
 * add a SettingDef (or a new style entry) instead of hand-building UI.
 *
 * @param {object} api
 * @returns {Array<{
 *   id: string,
 *   title: string | ((api: object) => string),
 *   defaultOpen?: boolean,
 *   build: (body: HTMLElement, helpers?: object) => { sync: () => void }
 * }>}
 */
export function getSettingsCatalog(api) {
  const pixelFs = STATIC_SECTIONS.find((s) => s.id === 'pixel-fs');
  const trailing = STATIC_SECTIONS.filter((s) => s.id !== 'pixel-fs');

  /** @type {Array<{ id: string, title: string | ((api: object) => string), defaultOpen?: boolean, build: Function }>} */
  const catalog = [];

  if (pixelFs) {
    catalog.push({
      id: pixelFs.id,
      title: pixelFs.title,
      defaultOpen: !!pixelFs.defaultOpen,
      build: (body) => bindSettings(body, pixelFs.settings, api),
    });
  }

  catalog.push({
    id: STYLE_SETTINGS_SECTION.id,
    title: (a) => `${getStyleLabel(resolveUiStyleId(a))} Settings`,
    defaultOpen: !!STYLE_SETTINGS_SECTION.defaultOpen,
    build: (body, helpers) =>
      bindStyleSpecificSettings(body, {
        api,
        styleSettings: PIXEL_FS_STYLE_SETTINGS,
        emptyMessage: STYLE_SETTINGS_SECTION.emptyMessage,
        setTitle: helpers && helpers.setTitle,
        resolveStyleId: resolveUiStyleId,
        getStyleLabel,
      }),
  });

  trailing.forEach((section) => {
    catalog.push({
      id: section.id,
      title: section.title,
      defaultOpen: !!section.defaultOpen,
      build: (body) => bindSettings(body, section.settings, api),
    });
  });

  return catalog;
}
