/* Preset Manager — centralized register / resolve / load / apply / track.

   Presets are complete Pixel FS experiences: each resolves to every configurable
   animConfig field via validateSettings(createSettingsTemplate()). Loading a
   preset starts the Pixel FS refresh animation first, then applies settings
   behind that mask so the display never reveals the new preset early.

   Lifecycle: the manager stays inactive through BOOT → INTRO → MENU_GENERATION.
   Saved settings are restored silently onto animConfig before Pixel FS starts
   (see restoreSettings). reconcileActivePreset only syncs Active vs Custom —
   it never triggers refresh. activate() runs after menu hold / boot ready;
   only then may loadPreset run refresh transitions.

   activePresetId lives on the shared animConfig so the existing persistence
   path saves/restores it — no duplicate save logic. On boot, reconcileActive
   resolves Active vs Custom by exact settings match (future presets need no
   save-format change).

   Future presets: definePreset(...) then register() — no manager logic changes. */

import { PixelEvents } from '../../pixel-engine/constants.js';
import {
  applySettings,
  snapshotSettings,
  validateSettings,
} from '../persist.js';
import { BUILTIN_PRESETS } from './builtins.js';
import { definePreset } from './define.js';
import { settingsExactlyMatch } from './match.js';
import { createSettingsTemplate } from './template.js';
import {
  createPresetTransition,
} from './transition.js';

/** Sentinel value for inspector when no named preset is active. */
export const PRESET_CUSTOM_ID = '__custom__';

/**
 * Resolve a preset's (possibly partial) settings into a complete, validated
 * animConfig-shaped snapshot. New template fields fill in automatically.
 *
 * @param {import('./define.js').PixelPreset|object} preset
 * @returns {object|null}
 */
export function resolvePresetSettings(preset) {
  if (!preset || typeof preset !== 'object') return null;
  const raw =
    preset.settings && typeof preset.settings === 'object'
      ? preset.settings
      : preset;
  return validateSettings(raw, createSettingsTemplate());
}

/**
 * @param {object} options
 * @param {object} options.animConfig — live shared settings object
 * @param {() => void} [options.beginBatch]
 * @param {() => void} [options.endBatch]
 * @param {(opts?: object) => void} [options.publishAnimConfig]
 * @param {import('../../pixel-engine/events.js').EventSystem} [options.events]
 * @param {() => void} [options.syncAnimDom] — keep CSS accents in sync during apply
 * @param {(opts?: { densityChanging?: boolean }) => { mode: string }} [options.beginPresetRefresh]
 * @param {() => void} [options.finishPresetRefreshInstant]
 * @param {() => void} [options.onActivate] — inspector / boot unlock hook
 * @param {boolean} [options.interactive=false] — false until startup reaches READY
 * @param {boolean} [options.prefersReduced]
 * @param {boolean} [options.registerBuiltins=true]
 * @param {boolean} [options.reconcile=true] — match restored settings → Active/Custom
 */
export function createPresetManager(options) {
  const animConfig = options && options.animConfig;
  const beginBatch = options && options.beginBatch;
  const endBatch = options && options.endBatch;
  const publishAnimConfig = options && options.publishAnimConfig;
  const syncAnimDom = options && options.syncAnimDom;
  const beginPresetRefresh = options && options.beginPresetRefresh;
  const finishPresetRefreshInstant =
    options && options.finishPresetRefreshInstant;
  const onActivate = options && options.onActivate;
  const events = options && options.events;
  const prefersReduced = !!(options && options.prefersReduced);
  const registerBuiltins = !options || options.registerBuiltins !== false;
  const shouldReconcile = !options || options.reconcile !== false;

  /** @type {Map<string, import('./define.js').PixelPreset>} */
  const registry = new Map();
  /** @type {string[]} registration order for listPresets() */
  const order = [];

  /** @type {string|null} */
  let activePresetId = null;
  /** True while loadPreset / reconcile / transition writes animConfig — ignore dirty clears. */
  let applying = false;
  /**
   * False through BOOT → INTRO → MENU_GENERATION. activate() flips this after
   * the startup menu has fully settled so refresh transitions cannot fight boot.
   */
  let interactive = !!(options && options.interactive);

  const transition = createPresetTransition({
    animConfig,
    publishAnimConfig,
    syncAnimDom,
    beginBatch,
    endBatch,
    beginPresetRefresh,
    finishPresetRefreshInstant,
    events,
    prefersReduced,
  });

  /**
   * Keep manager + shared animConfig.activePresetId in sync (persistence source).
   * @param {string|null} id
   */
  function setActivePresetId(id) {
    const next =
      typeof id === 'string' && id && id !== PRESET_CUSTOM_ID ? id : null;
    activePresetId = next;
    if (animConfig) animConfig.activePresetId = next;
  }

  /**
   * Register a preset. Re-registering the same id replaces the definition
   * but keeps its place in list order.
   * @param {import('./define.js').PixelPreset|object} preset
   * @returns {boolean}
   */
  function register(preset) {
    const normalized =
      preset && typeof preset.id === 'string' && typeof preset.label === 'string'
        ? definePreset(preset)
        : null;
    if (!normalized) {
      console.warn('[PixelFS:presets] register ignored — invalid preset', preset);
      return false;
    }
    if (!registry.has(normalized.id)) {
      order.push(normalized.id);
    }
    registry.set(normalized.id, normalized);
    return true;
  }

  /**
   * @param {string} id
   * @returns {boolean}
   */
  function unregister(id) {
    if (!registry.has(id)) return false;
    registry.delete(id);
    const idx = order.indexOf(id);
    if (idx !== -1) order.splice(idx, 1);
    if (activePresetId === id) setActivePresetId(null);
    return true;
  }

  /**
   * @param {string} id
   * @returns {import('./define.js').PixelPreset|null}
   */
  function getPreset(id) {
    return registry.get(id) || null;
  }

  /**
   * @returns {import('./define.js').PixelPreset[]}
   */
  function listPresets() {
    const out = [];
    for (let i = 0; i < order.length; i++) {
      const preset = registry.get(order[i]);
      if (preset) out.push(preset);
    }
    return out;
  }

  /**
   * @returns {Array<{ value: string, label: string }>}
   */
  function getPresetOptions() {
    return listPresets().map((preset) => ({
      value: preset.id,
      label: preset.label,
    }));
  }

  function getActivePresetId() {
    return activePresetId;
  }

  /**
   * True when live animConfig exactly matches a registered preset's settings.
   * @param {string} id
   * @returns {boolean}
   */
  function liveMatchesPreset(id) {
    if (!animConfig) return false;
    const preset = registry.get(id);
    if (!preset) return false;
    const resolved = resolvePresetSettings(preset);
    return !!resolved && settingsExactlyMatch(animConfig, resolved);
  }

  /**
   * Find a registered preset whose settings exactly match the live animConfig.
   * Scan order = registration order (built-ins first).
   * @returns {string|null}
   */
  function findMatchingPresetId() {
    if (!animConfig) return null;
    for (let i = 0; i < order.length; i++) {
      const id = order[i];
      if (liveMatchesPreset(id)) return id;
    }
    return null;
  }

  /**
   * After restore (or boot): resolve Active vs Custom from live settings.
   * Does not re-apply settings or publish — only syncs activePresetId.
   *
   * Rules:
   * 1. If saved activePresetId is registered AND settings still match it → keep.
   * 2. Else if settings exactly match any registered preset → that preset.
   * 3. Else → Custom (null).
   *
   * New presets participate automatically once registered (no save-format change).
   *
   * @returns {string|null} resolved active preset id
   */
  function reconcileActivePreset() {
    if (!animConfig) {
      setActivePresetId(null);
      return null;
    }

    applying = true;
    try {
      const hinted =
        typeof animConfig.activePresetId === 'string' &&
        animConfig.activePresetId
          ? animConfig.activePresetId
          : null;

      if (hinted && registry.has(hinted) && liveMatchesPreset(hinted)) {
        setActivePresetId(hinted);
        return hinted;
      }

      const matched = findMatchingPresetId();
      setActivePresetId(matched);
      return matched;
    } finally {
      applying = false;
    }
  }

  /**
   * Resolve + stamp selection id onto a writable snapshot for apply/transition.
   * Preset settings never own activePresetId — that is selection state only.
   * @param {import('./define.js').PixelPreset} preset
   * @returns {object|null}
   */
  function resolvedTargetSnapshot(preset) {
    const validated = resolvePresetSettings(preset);
    if (!validated) return null;
    const snap = snapshotSettings(validated);
    snap.activePresetId = preset.id;
    return snap;
  }

  /**
   * Settings-only apply — no publish, no refresh, no density rebuild.
   * Used while startup owns the Pixel FS display.
   * @param {object} target — snapshot including activePresetId
   * @returns {boolean}
   */
  function applyPresetSilent(target) {
    applying = true;
    try {
      if (!applySettings(animConfig, target)) return false;
      setActivePresetId(target.activePresetId);
      if (typeof syncAnimDom === 'function') syncAnimDom();
      return true;
    } finally {
      applying = false;
    }
  }

  /**
   * Instant apply path (identical target / transition unavailable).
   * @param {object} target — snapshot including activePresetId
   * @returns {boolean}
   */
  function applyPresetImmediate(target) {
    const canBatch =
      typeof beginBatch === 'function' && typeof endBatch === 'function';

    applying = true;
    try {
      if (canBatch) beginBatch();
      try {
        if (!applySettings(animConfig, target)) return false;
        setActivePresetId(target.activePresetId);
      } finally {
        if (canBatch) endBatch();
        else if (typeof publishAnimConfig === 'function') publishAnimConfig();
      }
      return true;
    } finally {
      applying = false;
    }
  }

  /**
   * Enable preset transitions after startup (menu hold / boot ready).
   * Idempotent — does not re-apply or refresh the live field.
   * @returns {boolean} true if this call flipped inactive → active
   */
  function activate() {
    if (interactive) return false;
    interactive = true;
    if (typeof onActivate === 'function') onActivate();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('pixelpresetsready'));
    }
    return true;
  }

  function isInteractive() {
    return interactive;
  }

  /**
   * Load a registered preset onto the shared settings object.
   * Every named preset (including Default) uses the same path. Custom is not
   * a loadable preset — it is entered automatically when the user edits.
   *
   * Before activate(): settings-only write (no refresh / rebuild).
   * After activate(): refresh animation owns the transition whenever the
   * selection or settings actually change.
   * @param {string} id
   * @returns {boolean}
   */
  function loadPreset(id) {
    if (!animConfig) return false;

    /* Cancel any in-flight transition so the new preset can proceed. */
    if (transition.isActive()) {
      transition.cancel();
    }

    const preset = registry.get(id);
    if (!preset) {
      console.warn('[PixelFS:presets] loadPreset — unknown id', id);
      return false;
    }
    const to = resolvedTargetSnapshot(preset);
    if (!to) return false;

    const from = snapshotSettings(animConfig);

    /* Already on this preset with matching settings — nothing to apply. */
    if (activePresetId === preset.id && settingsExactlyMatch(from, to)) {
      setActivePresetId(preset.id);
      return true;
    }

    /*
      Startup pipeline owns the display. Seed / edge-case loads may write
      settings but must not recalibrate, refresh, or regenerate the menu.
    */
    if (!interactive) {
      return applyPresetSilent(to);
    }

    /* Mark Active immediately so the inspector tracks the selection. */
    setActivePresetId(preset.id);

    applying = true;
    let started = false;
    try {
      started = transition.run({
        from,
        to,
        onComplete() {
          /* Land exactly on the target snapshot (clamps / discrete finals).
             Full (non-soft) publish ensures syncAnimDom + mode-change events
             fire even when the transition used the blocked path (which skips
             applyBehindMask). Redundant publishes are harmless — setActive
             guards on identity and syncAnimDom is idempotent. */
          applying = true;
          try {
            applySettings(animConfig, to);
            setActivePresetId(preset.id);
            if (typeof publishAnimConfig === 'function') {
              publishAnimConfig();
            }
          } finally {
            applying = false;
          }
        },
      });
    } catch (err) {
      console.warn('[PixelFS:presets] loadPreset transition failed — applying immediately', err);
      started = false;
    } finally {
      /*
        Masked apply already published inside run(). Clear applying so only the
        write windows suppress dirty→Custom; the refresh animation may continue.
        onComplete will do a second full publish to land final values.
        Also clears applying if run() threw before applyBehindMask.
      */
      applying = false;
    }

    if (!started) {
      return applyPresetImmediate(to);
    }

    return true;
  }

  function isTransitionActive() {
    return transition.isActive();
  }

  /**
   * Snapshot of the fully resolved settings for a preset (does not apply).
   * @param {string} id
   * @returns {object|null}
   */
  function peekPresetSettings(id) {
    const preset = registry.get(id);
    if (!preset) return null;
    const validated = resolvePresetSettings(preset);
    return validated ? snapshotSettings(validated) : null;
  }

  /** Clear active preset when the user edits settings outside loadPreset. */
  function onSettingsChanged() {
    if (applying) return;
    /* Mutate animConfig before persistence listeners snapshot — same event. */
    setActivePresetId(null);
  }

  let unsub = null;
  if (events) {
    unsub = events.on(PixelEvents.AnimConfigChange, onSettingsChanged);
  }

  if (registerBuiltins) {
    for (let i = 0; i < BUILTIN_PRESETS.length; i++) {
      register(BUILTIN_PRESETS[i]);
    }
  }

  /* Restore path: settings already on animConfig; resolve Active vs Custom. */
  if (shouldReconcile) {
    reconcileActivePreset();
  }

  function destroy() {
    transition.destroy();
    applying = false;
    interactive = false;
    if (unsub) {
      unsub();
      unsub = null;
    }
    registry.clear();
    order.length = 0;
    activePresetId = null;
  }

  return {
    register,
    unregister,
    getPreset,
    listPresets,
    getPresetOptions,
    getActivePresetId,
    loadPreset,
    activate,
    isInteractive,
    isTransitionActive,
    peekPresetSettings,
    resolvePresetSettings,
    reconcileActivePreset,
    findMatchingPresetId,
    destroy,
  };
}
