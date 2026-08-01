/* Preset ↔ settings matching — used on restore to resolve Active vs Custom.

   Comparison is against configurable Pixel FS fields only (activePresetId is
   excluded). Both sides are normalized through validateSettings so future
   template fields do not break equality for older snapshots. */

import { validateSettings } from '../persist.js';
import { createSettingsTemplate } from './template.js';

/**
 * Normalize settings into a stable, comparable snapshot (no activePresetId).
 * @param {object|null|undefined} settings
 * @returns {object|null}
 */
export function normalizeSettingsForMatch(settings) {
  if (!settings || typeof settings !== 'object') return null;
  const validated = validateSettings(settings, createSettingsTemplate());
  if (!validated) return null;
  const out = { ...validated };
  delete out.activePresetId;
  return out;
}

/**
 * Stable fingerprint for exact preset matching.
 * @param {object|null|undefined} settings
 * @returns {string|null}
 */
export function settingsMatchFingerprint(settings) {
  const normalized = normalizeSettingsForMatch(settings);
  if (!normalized) return null;
  return JSON.stringify(normalized);
}

/**
 * True when two settings objects describe the same Pixel FS configuration.
 * @param {object|null|undefined} a
 * @param {object|null|undefined} b
 * @returns {boolean}
 */
export function settingsExactlyMatch(a, b) {
  const fa = settingsMatchFingerprint(a);
  const fb = settingsMatchFingerprint(b);
  return fa != null && fa === fb;
}
