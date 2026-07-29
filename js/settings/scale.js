/* User-facing slider scale ↔ internal Pixel FS engine values.
   Settings UI uses a consistent 0–10 integer scale; the engine keeps its
   native ranges. Reuse createUiScale() for any future numeric Pixel FS knobs. */

/** Default inspector scale: whole numbers from 0 through 10. */
export const PIXEL_UI_SCALE = Object.freeze({
  min: 0,
  max: 10,
  step: 1,
});

/**
 * Snap a number onto a closed [min, max] grid with the given step.
 * @param {number} n
 * @param {number} min
 * @param {number} max
 * @param {number} step
 * @returns {number}
 */
export function snapToStep(n, min, max, step) {
  const value = Number(n);
  if (!Number.isFinite(value)) return min;
  const clamped = Math.min(max, Math.max(min, value));
  if (!(step > 0)) return clamped;
  const stepped = Math.round((clamped - min) / step) * step + min;
  /* Avoid float dust (e.g. 0.1 * 3) so UI always shows clean integers. */
  const precision = step >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(step)));
  const rounded =
    precision === 0
      ? Math.round(stepped)
      : Number(stepped.toFixed(precision));
  return Math.min(max, Math.max(min, rounded));
}

/**
 * Build a conversion layer between a user-facing integer scale (0–10 by
 * default) and an internal engine numeric range.
 *
 * Mapping is piecewise-linear through the engine default so the default UI
 * tick restores the exact current Pixel FS behavior, while other ticks still
 * span the full internal min→max smoothly.
 *
 * @param {{ min: number, max: number, default: number }} internal
 * @param {{ min?: number, max?: number, step?: number }} [ui]
 * @returns {{
 *   ui: { min: number, max: number, step: number },
 *   defaultUi: number,
 *   defaultInternal: number,
 *   toInternal: (uiValue: number) => number,
 *   toUi: (internalValue: number) => number,
 * }}
 */
export function createUiScale(internal, ui = {}) {
  const uiMin = ui.min != null ? ui.min : PIXEL_UI_SCALE.min;
  const uiMax = ui.max != null ? ui.max : PIXEL_UI_SCALE.max;
  const uiStep = ui.step != null ? ui.step : PIXEL_UI_SCALE.step;
  const iMin = Number(internal.min);
  const iMax = Number(internal.max);
  const iDefault = Number(internal.default);

  const span = iMax - iMin;
  const t = span === 0 ? 0 : (iDefault - iMin) / span;
  const defaultUi = snapToStep(
    uiMin + t * (uiMax - uiMin),
    uiMin,
    uiMax,
    uiStep,
  );

  function toInternal(uiValue) {
    const u = snapToStep(uiValue, uiMin, uiMax, uiStep);
    if (u === defaultUi) return iDefault;

    if (u < defaultUi) {
      if (defaultUi === uiMin) return iDefault;
      const p = (u - uiMin) / (defaultUi - uiMin);
      return iMin + p * (iDefault - iMin);
    }

    if (defaultUi === uiMax) return iDefault;
    const p = (u - defaultUi) / (uiMax - defaultUi);
    return iDefault + p * (iMax - iDefault);
  }

  function toUi(internalValue) {
    const v = Number(internalValue);
    if (!Number.isFinite(v)) return defaultUi;
    if (Math.abs(v - iDefault) <= 1e-9) return defaultUi;

    if (v < iDefault) {
      if (iDefault === iMin) return defaultUi;
      const p = (v - iMin) / (iDefault - iMin);
      return snapToStep(uiMin + p * (defaultUi - uiMin), uiMin, uiMax, uiStep);
    }

    if (iDefault === iMax) return defaultUi;
    const p = (v - iDefault) / (iMax - iDefault);
    return snapToStep(
      defaultUi + p * (uiMax - defaultUi),
      uiMin,
      uiMax,
      uiStep,
    );
  }

  return {
    ui: { min: uiMin, max: uiMax, step: uiStep },
    defaultUi,
    defaultInternal: iDefault,
    toInternal,
    toUi,
  };
}

/**
 * Wrap a numeric SettingDef so the inspector speaks 0–10 integers while
 * get/set still talk to the engine in its native range. Reusable for any
 * future Pixel Behavior / Pixel FS slider.
 *
 * @param {object} def — SettingDef fields except range/defaultValue/get/set wiring
 * @param {{
 *   get: (api: object) => number,
 *   set: (api: object, value: number) => void,
 *   internal: { min: number, max: number, default: number },
 *   ui?: { min?: number, max?: number, step?: number },
 * }} opts
 * @returns {object}
 */
export function scaledSliderSetting(def, opts) {
  const scale = createUiScale(opts.internal, opts.ui);
  return {
    ...def,
    type: 'slider',
    defaultValue: scale.defaultUi,
    range: { min: scale.ui.min, max: scale.ui.max, step: scale.ui.step },
    scale,
    get: (api) => scale.toUi(opts.get(api)),
    set: (api, value) => opts.set(api, scale.toInternal(value)),
  };
}
