/* Built-in Pixel FS presets — complete experiences via settings snapshots.
   Each preset is an intentional personality composed from existing settings
   only (style, color, heat, pixel behavior, cursor, performance).
   Add a new built-in by appending another definePreset(...) entry. */

import { definePreset } from './define.js';
import { PIXEL_BEHAVIOR_DEFAULTS } from '../../pixel-engine/pixel-behavior.js';
import { CURSOR_MODE_DEFAULT } from '../../pixel-engine/cursor-mode.js';
import { PERFORMANCE_DEFAULTS } from '../../pixel-engine/performance-manager.js';

/**
 * Ordered built-in presets. Each `settings` object may be partial; the Preset
 * Manager resolves against createSettingsTemplate() so new animConfig fields
 * are filled automatically.
 *
 * Default is a fully defined preset (same shape as every other built-in) —
 * not an empty "do nothing" sentinel. Selecting it always writes every field,
 * including the classic Pixel FS pink accent.
 *
 * @type {import('./define.js').PixelPreset[]}
 */
export const BUILTIN_PRESETS = [
  definePreset({
    id: 'default',
    label: 'Default',
    description: 'Balanced, responsive — the intended Pixel FS experience',
    settings: {
      motion: true,
      bgMode: 'heat',
      lastImplementedBgMode: 'heat',
      /* Classic Pixel FS pink — factory accent */
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
    },
  }),
  definePreset({
    id: 'ambient',
    label: 'Ambient',
    description: 'Calm field — gentle movement, long decay, soft interaction',
    settings: {
      motion: true,
      bgMode: 'wave',
      lastImplementedBgMode: 'wave',
      /* Soft mist blue — low chroma, resting atmosphere */
      effectColor: { r: 110, g: 168, b: 198 },
      heatEnabled: true,
      heatIntensity: 0.38,
      heatRadius: 18,
      pixelBehavior: {
        reactionStrength: 0.14,
        movementSpeed: 0.022,
        /* Near floor — energy lingers; trails wash slowly */
        decaySpeed: 0.0035,
        trailLifetime: 0.992,
      },
      cursorMode: 'attract',
      performance: {
        pixelDensity: 3,
        effectQuality: 8,
        frameRateTarget: 'auto',
        adaptivePerformance: true,
      },
    },
  }),
  definePreset({
    id: 'cyber',
    label: 'Cyber',
    description: 'Fast, bright RGB energy — snappy, futuristic cursor response',
    settings: {
      motion: true,
      bgMode: 'lightning',
      lastImplementedBgMode: 'lightning',
      /* Neon cyan — high-energy RGB punch */
      effectColor: { r: 0, g: 255, b: 210 },
      heatEnabled: true,
      heatIntensity: 0.95,
      /* Tight brush — precise, immediate cursor feedback */
      heatRadius: 8,
      pixelBehavior: {
        reactionStrength: 0.72,
        movementSpeed: 0.165,
        /* Fast recovery — field snaps clean between strikes */
        decaySpeed: 0.048,
        trailLifetime: 0.888,
      },
      cursorMode: 'repel',
      performance: {
        pixelDensity: 5,
        effectQuality: 10,
        frameRateTarget: '60',
        adaptivePerformance: true,
      },
    },
  }),
  definePreset({
    id: 'storm',
    label: 'Storm',
    description: 'Aggressive turbulence — large disturbances, engine showcase',
    settings: {
      motion: true,
      bgMode: 'lightning',
      lastImplementedBgMode: 'lightning',
      /* Electric violet-white — volatile storm light */
      effectColor: { r: 196, g: 168, b: 255 },
      heatEnabled: true,
      heatIntensity: 1,
      /* Wide brush — large disturbances across the field */
      heatRadius: 26,
      pixelBehavior: {
        /* Ceiling values — maximum reaction and motion */
        reactionStrength: 0.8,
        movementSpeed: 0.2,
        decaySpeed: 0.072,
        trailLifetime: 0.9,
      },
      cursorMode: 'disturb',
      performance: {
        pixelDensity: 4,
        effectQuality: 10,
        frameRateTarget: 'unlimited',
        adaptivePerformance: true,
      },
    },
  }),
  definePreset({
    id: 'minimal',
    label: 'Minimal',
    description: 'Restrained field — low motion, simple color, readable surface',
    settings: {
      motion: true,
      bgMode: 'heat',
      lastImplementedBgMode: 'heat',
      /* Neutral cool gray — no chroma competing with content */
      effectColor: { r: 198, g: 202, b: 208 },
      heatEnabled: true,
      heatIntensity: 0.28,
      heatRadius: 6,
      pixelBehavior: {
        reactionStrength: 0.08,
        movementSpeed: 0.012,
        /* Clears quickly so residual motion does not obscure reading */
        decaySpeed: 0.042,
        trailLifetime: 0.875,
      },
      /* Hold still under the cursor — interaction stays out of the way */
      cursorMode: 'freeze',
      performance: {
        pixelDensity: 2,
        effectQuality: 5,
        frameRateTarget: '30',
        adaptivePerformance: true,
      },
    },
  }),
];

/**
 * Dropdown options derived from built-ins (id + label only).
 * @returns {Array<{ value: string, label: string }>}
 */
export function getBuiltinPresetOptions() {
  return BUILTIN_PRESETS.map((preset) => ({
    value: preset.id,
    label: preset.label,
  }));
}
