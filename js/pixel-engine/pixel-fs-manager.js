/* Pixel FS Manager — plugin registry for field styles (Heat / Wave / Lightning…).
   Styles register themselves; the manager tracks the active implementation
   and will eventually mediate transitions. V1 preserves per-style enable logic. */

import { PIXEL_FIELD_STYLES, PixelEvents } from './constants.js';

/**
 * @typedef {object} PixelFSPlugin
 * @property {string} id
 * @property {boolean} [implemented]
 * @property {() => void} [mount]
 * @property {() => void} [destroy]
 * @property {(on: boolean) => void} [setEnabled]
 * @property {() => boolean} [isEnabled]
 */

/**
 * @param {object} options
 * @param {import('./events.js').EventSystem} options.events
 * @param {ReturnType<import('./config.js').createAnimConfig>} options.config
 */
export function createPixelFSManager(options) {
  const events = options.events;
  const config = options.config;

  /** @type {Map<string, PixelFSPlugin>} */
  const plugins = new Map();
  let activeId = null;

  function register(plugin) {
    if (!plugin || !plugin.id) {
      throw new Error('[PixelEngine:PixelFS] plugin requires an id');
    }
    plugins.set(plugin.id, plugin);
    return () => {
      if (plugins.get(plugin.id) === plugin) plugins.delete(plugin.id);
    };
  }

  function get(id) {
    return plugins.get(id) || null;
  }

  function list() {
    return Array.from(plugins.values());
  }

  function getActiveId() {
    return activeId;
  }

  function getActive() {
    return activeId ? plugins.get(activeId) || null : null;
  }

  /**
   * Record the active style id. V1 styles still self-enable via bgmodechange;
   * this keeps engine-level truth in sync for future transitions.
   * @param {string|null} id
   */
  function setActive(id) {
    const next = id == null ? null : id;
    if (activeId === next) return activeId;
    const prev = activeId;
    activeId = next;
    events.emit(PixelEvents.PixelFSChanged, {
      mode: activeId,
      previous: prev,
      selected: config.animConfig.bgMode,
    });
    return activeId;
  }

  function syncFromConfig() {
    setActive(config.resolveActiveBgMode());
  }

  function mountAll() {
    plugins.forEach((plugin) => {
      if (typeof plugin.mount === 'function') plugin.mount();
    });
    syncFromConfig();
  }

  function destroy() {
    plugins.forEach((plugin) => {
      if (typeof plugin.destroy === 'function') plugin.destroy();
    });
    plugins.clear();
    activeId = null;
  }

  /* Keep active id aligned when settings change */
  events.on(PixelEvents.BgModeChange, (detail) => {
    const mode = detail && detail.mode;
    setActive(mode == null ? null : mode);
  });

  return {
    register,
    get,
    list,
    getActiveId,
    getActive,
    setActive,
    syncFromConfig,
    mountAll,
    destroy,
    stylesCatalog: PIXEL_FIELD_STYLES,
  };
}
