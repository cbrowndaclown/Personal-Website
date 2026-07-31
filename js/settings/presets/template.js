/* Complete Pixel FS settings template — factory defaults for every configurable
   field on animConfig. Presets merge onto this shape so new settings added to
   the template are inherited automatically by existing presets. */

import { PIXEL_BEHAVIOR_DEFAULTS } from '../../pixel-engine/pixel-behavior.js';
import { CURSOR_MODE_DEFAULT } from '../../pixel-engine/cursor-mode.js';
import { PERFORMANCE_DEFAULTS } from '../../pixel-engine/performance-manager.js';

/**
 * Build a fresh, complete settings object matching the live animConfig shape.
 * Engine-native values (not UI 0–10 scales). Callers should treat the result
 * as a template — clone before mutating.
 *
 * When a new configurable setting lands on animConfig, add it here so presets
 * and validation stay complete without rewriting Preset Manager logic.
 *
 * @returns {object}
 */
export function createSettingsTemplate() {
  return {
    motion: true,
    bgMode: 'heat',
    lastImplementedBgMode: 'heat',
    effectColor: { r: 255, g: 52, b: 158 },
    heatEnabled: true,
    heatIntensity: 0.92,
    heatRadius: 11.8,
    pixelBehavior: {
      reactionStrength: PIXEL_BEHAVIOR_DEFAULTS.reactionStrength,
      movementSpeed: PIXEL_BEHAVIOR_DEFAULTS.movementSpeed,
      decaySpeed: PIXEL_BEHAVIOR_DEFAULTS.decaySpeed,
      trailLifetime: PIXEL_BEHAVIOR_DEFAULTS.trailLifetime,
    },
    cursorMode: CURSOR_MODE_DEFAULT,
    performance: {
      pixelDensity: PERFORMANCE_DEFAULTS.pixelDensity,
      effectQuality: PERFORMANCE_DEFAULTS.effectQuality,
      frameRateTarget: PERFORMANCE_DEFAULTS.frameRateTarget,
      adaptivePerformance: PERFORMANCE_DEFAULTS.adaptivePerformance,
    },
    /* null = Custom; named ids persist without a format change when new
       presets are registered later. */
    activePresetId: null,
  };
}
