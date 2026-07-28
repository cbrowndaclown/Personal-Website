/* Settings catalog — register sections here to grow the panel. */

import { buildPixelFsSection } from './sections/pixelFs.js';
import { buildAppearanceSection } from './sections/appearance.js';
import { buildLayoutSection } from './sections/layout.js';
import { buildAdvancedSection } from './sections/advanced.js';

/**
 * Ordered inspector categories. Add a section object to extend the panel.
 * Each `build(body, api)` may mount any control from `js/settings/controls`.
 *
 * @param {object} api
 * @returns {Array<{
 *   id: string,
 *   title: string,
 *   defaultOpen?: boolean,
 *   build: (body: HTMLElement, api: object) => { sync: () => void }
 * }>}
 */
export function getSettingsCatalog(api) {
  return [
    {
      id: 'pixel-fs',
      title: 'Pixel FS',
      defaultOpen: true,
      build: (body) => buildPixelFsSection(body, api),
    },
    {
      id: 'appearance',
      title: 'Appearance',
      defaultOpen: false,
      build: (body) => buildAppearanceSection(body, api),
    },
    {
      id: 'layout',
      title: 'Layout',
      defaultOpen: false,
      build: (body) => buildLayoutSection(body, api),
    },
    {
      id: 'advanced',
      title: 'Advanced',
      defaultOpen: false,
      build: (body) => buildAdvancedSection(body, api),
    },
  ];
}
