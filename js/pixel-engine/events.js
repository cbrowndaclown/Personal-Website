/* Lightweight pub/sub for Pixel Engine modules.
   Optionally mirrors selected events onto `window` as CustomEvents so existing
   settings / DOM listeners keep working during the V1 → engine transition. */

/**
 * @typedef {object} EventSystem
 * @property {(type: string, handler: Function) => () => void} on
 * @property {(type: string, handler: Function) => void} off
 * @property {(type: string, detail?: any) => void} emit
 * @property {() => void} destroy
 */

/**
 * @param {object} [options]
 * @param {boolean} [options.bridgeWindow=true] — also dispatch window CustomEvents
 * @param {string[]} [options.windowBridge] — event names to mirror onto window
 * @returns {EventSystem}
 */
export function createEventSystem(options = {}) {
  const bridgeWindow = options.bridgeWindow !== false;
  const windowBridge = new Set(
    options.windowBridge || [
      'animconfigchange',
      'bgmodechange',
      'motionreenabled',
      'pixelintrostart',
      'pixeldirectorystart',
      'pixeldirectoryhold',
      'lightningstrike',
    ]
  );

  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map();

  function on(type, handler) {
    if (typeof handler !== 'function') return () => {};
    let set = listeners.get(type);
    if (!set) {
      set = new Set();
      listeners.set(type, set);
    }
    set.add(handler);
    return () => off(type, handler);
  }

  function off(type, handler) {
    const set = listeners.get(type);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) listeners.delete(type);
  }

  function emit(type, detail) {
    const set = listeners.get(type);
    if (set) {
      /* Snapshot so handlers can unsubscribe during emit */
      const list = Array.from(set);
      for (let i = 0; i < list.length; i++) {
        try {
          list[i](detail);
        } catch (err) {
          console.error(`[PixelEngine:events] handler error for "${type}"`, err);
        }
      }
    }

    if (bridgeWindow && windowBridge.has(type)) {
      window.dispatchEvent(new CustomEvent(type, { detail }));
    }
  }

  function destroy() {
    listeners.clear();
  }

  return { on, off, emit, destroy };
}
