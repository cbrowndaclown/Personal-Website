/* Anim / settings config — motion, Pixel FS selection, shared effect color.
   Publishes through the engine event system (bridged to window for settings). */

import { PIXEL_FIELD_STYLES, PixelEvents } from './constants.js';

/**
 * @param {object} options
 * @param {import('./events.js').EventSystem} options.events
 * @param {boolean} options.prefersReduced
 */
export function createAnimConfig(options) {
  const events = options.events;
  const prefersReduced = !!options.prefersReduced;

  const animConfig = {
    motion: !prefersReduced,
    bgMode: 'heat',
    lastImplementedBgMode: 'heat',
    effectColor: { r: 255, g: 52, b: 158 },
  };

  function resolveActiveBgMode() {
    if (!animConfig.motion) return null;
    const style = PIXEL_FIELD_STYLES[animConfig.bgMode];
    if (style && style.implemented) return animConfig.bgMode;
    return animConfig.lastImplementedBgMode || 'heat';
  }

  function syncAnimDom() {
    document.body.dataset.motion = animConfig.motion ? 'on' : 'off';
    document.body.dataset.bgMode = animConfig.bgMode;
    const { r, g, b } = animConfig.effectColor;
    const root = document.documentElement;
    root.style.setProperty('--accent-r', String(r));
    root.style.setProperty('--accent-g', String(g));
    root.style.setProperty('--accent-b', String(b));
    root.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
  }

  function publishAnimConfig() {
    syncAnimDom();
    const activeMode = resolveActiveBgMode();
    const detail = {
      motion: animConfig.motion,
      bgMode: animConfig.bgMode,
      activeBgMode: activeMode,
      effectColor: { ...animConfig.effectColor },
    };
    events.emit(PixelEvents.AnimConfigChange, detail);
    events.emit(PixelEvents.SettingsUpdated, detail);
    events.emit(PixelEvents.BgModeChange, {
      mode: activeMode,
      selected: animConfig.bgMode,
    });
    events.emit(PixelEvents.PixelFSChanged, {
      mode: activeMode,
      selected: animConfig.bgMode,
    });
  }

  function setMotion(on) {
    const next = !!on;
    if (animConfig.motion === next) return;
    const turningOn = next && !animConfig.motion;
    animConfig.motion = next;
    publishAnimConfig();
    if (turningOn) {
      events.emit(PixelEvents.MotionReenabled, {});
    }
  }

  function setBgMode(mode) {
    if (!Object.prototype.hasOwnProperty.call(PIXEL_FIELD_STYLES, mode)) return;
    if (animConfig.bgMode === mode) return;
    const prev = PIXEL_FIELD_STYLES[animConfig.bgMode];
    if (prev && prev.implemented) {
      animConfig.lastImplementedBgMode = animConfig.bgMode;
    }
    animConfig.bgMode = mode;
    if (PIXEL_FIELD_STYLES[mode].implemented) {
      animConfig.lastImplementedBgMode = mode;
    }
    publishAnimConfig();
  }

  function clampByte(n) {
    return Math.max(0, Math.min(255, n | 0));
  }

  function setEffectColor(r, g, b, publish) {
    animConfig.effectColor.r = clampByte(r);
    animConfig.effectColor.g = clampByte(g);
    animConfig.effectColor.b = clampByte(b);
    if (publish !== false) publishAnimConfig();
  }

  syncAnimDom();

  return {
    animConfig,
    prefersReduced,
    resolveActiveBgMode,
    syncAnimDom,
    publishAnimConfig,
    setMotion,
    setBgMode,
    setEffectColor,
    getMotion: () => animConfig.motion,
    getBgMode: () => animConfig.bgMode,
    getLastImplementedBgMode: () => animConfig.lastImplementedBgMode || 'heat',
    getEffectColor: () => ({ ...animConfig.effectColor }),
  };
}
