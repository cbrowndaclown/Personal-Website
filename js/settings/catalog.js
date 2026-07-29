/* Settings catalog — assembles the inspector from declarative categories. */

import {
  SETTINGS_CATEGORIES,
  EMPTY_SETTINGS_MESSAGE,
  getStyleById,
} from './definitions/index.js';
import { bindCategorySettings } from './render.js';

/**
 * Resolve which Pixel FS style is active for style-scoped settings.
 * @param {object} api
 * @returns {string}
 */
function resolveUiStyleId(api) {
  const mode = api.getBgMode();
  if (getStyleById(mode)) return mode;
  return api.getLastImplementedBgMode() || 'heat';
}

/**
 * Ordered inspector categories from SETTINGS_CATEGORIES.
 * Add a SettingDef with a matching categoryId (and optional sectionId) to
 * grow a section — no hand-built UI required.
 *
 * @param {object} api
 * @param {{ suppressSync?: () => void, allowSync?: () => void, requestSync?: () => void }} [syncGate]
 * @returns {Array<{
 *   id: string,
 *   title: string,
 *   defaultOpen?: boolean,
 *   build: (body: HTMLElement) => {
 *     sync: () => void,
 *     sections?: Array<{
 *       id: string,
 *       root: HTMLElement,
 *       isOpen: () => boolean,
 *       setOpen: (o: boolean, a?: boolean) => void
 *     }>
 *   }
 * }>}
 */
export function getSettingsCatalog(api, syncGate) {
  return SETTINGS_CATEGORIES.map((category) => ({
    id: category.id,
    title: category.title,
    defaultOpen: !!category.defaultOpen,
    build: (body) =>
      bindCategorySettings(body, {
        categoryId: category.id,
        sections: category.sections || [],
        api,
        resolveStyleId: resolveUiStyleId,
        emptyMessage: category.emptyMessage || EMPTY_SETTINGS_MESSAGE,
        syncGate,
      }),
  }));
}
