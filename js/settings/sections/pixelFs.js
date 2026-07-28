/* Pixel FS section — Motion, Style, Global Color. */

import { createRow, createSegment, createRgbControl } from '../controls/index.js';

/**
 * Style UI → pixel-field engines.
 * Magnetic → heat (default). Wave / Lightning keep current engines.
 * Experimental is a disabled Style placeholder (no behavior yet).
 */
export const PIXEL_FS_STYLE_OPTIONS = [
  { value: 'heat', label: 'Magnetic' },
  { value: 'wave', label: 'Wave' },
  { value: 'lightning', label: 'Lightning' },
  { value: 'experimental', label: 'Experimental', disabled: true },
];

/**
 * @param {HTMLElement} body
 * @param {object} api
 * @returns {{ sync: () => void }}
 */
export function buildPixelFsSection(body, api) {
  const motionRow = createRow({
    id: 'settings-motion-row',
    label: 'Motion',
    desc: 'Animations and pixel field',
  });
  const motionSeg = createSegment({
    id: 'settings-motion',
    labelledBy: motionRow.labelId,
    value: api.getMotion() ? 'on' : 'off',
    options: [
      { value: 'on', label: 'On' },
      { value: 'off', label: 'Off' },
    ],
    onChange: (value) => api.setMotion(value === 'on'),
  });
  motionRow.body.appendChild(motionSeg.root);
  body.appendChild(motionRow.root);

  const styleRow = createRow({
    id: 'settings-style-row',
    label: 'Style',
    desc: 'Pixel field style',
  });

  const activeStyles = PIXEL_FS_STYLE_OPTIONS.filter((o) => !o.disabled);
  const styleSeg = createSegment({
    id: 'settings-style',
    labelledBy: styleRow.labelId,
    value: api.getBgMode(),
    options: activeStyles,
    onChange: (value) => {
      if (!api.getMotion()) return;
      api.setBgMode(value);
    },
  });
  styleRow.body.appendChild(styleSeg.root);

  const experimental = PIXEL_FS_STYLE_OPTIONS.find((o) => o.disabled);
  if (experimental) {
    const placeholder = document.createElement('button');
    placeholder.type = 'button';
    placeholder.className = 'settings__seg-placeholder';
    placeholder.dataset.value = experimental.value;
    placeholder.textContent = experimental.label;
    placeholder.disabled = true;
    placeholder.setAttribute('aria-disabled', 'true');
    placeholder.title = 'Coming soon';
    styleRow.body.appendChild(placeholder);
  }

  body.appendChild(styleRow.root);

  const colorRow = createRow({
    id: 'settings-color-row',
    label: 'Global Color',
    desc: 'Shared by Magnetic, Wave, and Lightning',
    metaRow: true,
  });
  const rgb = createRgbControl({
    id: 'settings-color',
    labelledBy: colorRow.labelId,
    value: api.getEffectColor(),
    onChange: (c, publish) => api.setEffectColor(c.r, c.g, c.b, publish),
  });
  const meta = colorRow.root.querySelector('.settings__meta');
  if (meta) meta.appendChild(rgb.swatch);
  colorRow.body.appendChild(rgb.root);
  body.appendChild(colorRow.root);

  function sync() {
    const motionOn = api.getMotion();
    motionSeg.setValue(motionOn ? 'on' : 'off');

    const mode = api.getBgMode();
    const option = activeStyles.find((o) => o.value === mode);
    styleSeg.setValue(option ? mode : api.getLastImplementedBgMode());
    styleRow.setDisabled(!motionOn);
    styleSeg.setLocked(!motionOn);

    rgb.setValue(api.getEffectColor());
  }

  return { sync };
}
