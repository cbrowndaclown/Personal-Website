/* Interaction Manager — pointer / hover / future gesture + keyboard entry point.
   V1 preserves current field hover behavior via MouseMoved / PointerLeft events. */

import { PixelEvents } from './constants.js';

/**
 * @param {object} options
 * @param {HTMLElement} options.stage
 * @param {ReturnType<import('./grid-manager.js').createGridManager>} options.grid
 * @param {import('./events.js').EventSystem} options.events
 */
export function createInteractionManager(options) {
  const stage = options.stage;
  const grid = options.grid;
  const events = options.events;

  let clientX = null;
  let clientY = null;
  let localX = -1;
  let localY = -1;
  let inside = false;
  let started = false;

  function pointInField(cx, cy) {
    grid.syncStageRect();
    const x = cx - grid.stageLeft;
    const y = cy - grid.stageTop;
    const w = grid.viewW;
    const h = grid.viewH;
    return x >= 0 && y >= 0 && x <= w && y <= h
      ? { inside: true, x, y }
      : { inside: false, x, y };
  }

  function emitMove(cx, cy) {
    clientX = cx;
    clientY = cy;
    const hit = pointInField(cx, cy);
    const wasInside = inside;
    inside = hit.inside;
    if (inside) {
      localX = hit.x;
      localY = hit.y;
    } else {
      localX = -1;
      localY = -1;
    }

    events.emit(PixelEvents.MouseMoved, {
      clientX: cx,
      clientY: cy,
      x: hit.x,
      y: hit.y,
      inside: hit.inside,
      viewW: grid.viewW,
      viewH: grid.viewH,
    });

    if (hit.inside || wasInside) {
      events.emit(PixelEvents.InteractionDetected, {
        type: 'pointer',
        inside: hit.inside,
      });
    }

    if (wasInside && !hit.inside) {
      events.emit(PixelEvents.PointerLeft, {
        clientX: cx,
        clientY: cy,
      });
    }
  }

  function onMouseMove(e) {
    emitMove(e.clientX, e.clientY);
  }

  function onMouseLeave() {
    const wasInside = inside;
    inside = false;
    localX = localY = -1;
    events.emit(PixelEvents.PointerLeft, {
      clientX,
      clientY,
    });
    if (wasInside) {
      events.emit(PixelEvents.InteractionDetected, {
        type: 'pointer',
        inside: false,
      });
    }
  }

  function onBlur() {
    onMouseLeave();
  }

  function start() {
    if (started) return;
    started = true;
    document.addEventListener('mousemove', onMouseMove, { passive: true });
    document.documentElement.addEventListener('mouseleave', onMouseLeave);
    window.addEventListener('blur', onBlur);
  }

  function destroy() {
    if (!started) return;
    document.removeEventListener('mousemove', onMouseMove);
    document.documentElement.removeEventListener('mouseleave', onMouseLeave);
    window.removeEventListener('blur', onBlur);
    started = false;
  }

  function getPointer() {
    return {
      clientX,
      clientY,
      x: localX,
      y: localY,
      inside,
    };
  }

  /**
   * Re-evaluate last known pointer against the current stage box
   * (e.g. after mode switches without a fresh mousemove).
   */
  function reevaluate() {
    if (clientX == null || clientY == null) return getPointer();
    emitMove(clientX, clientY);
    return getPointer();
  }

  return {
    start,
    destroy,
    getPointer,
    reevaluate,
    pointInField,
    get stage() { return stage; },
  };
}
