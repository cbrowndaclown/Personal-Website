/* Interaction Manager — pointer / hover / future gesture + keyboard entry point.
   V1 preserves current field hover behavior via MouseMoved / PointerLeft events. */

import { PixelEvents } from './constants.js';

/**
 * @param {object} options
 * @param {HTMLElement} options.stage
 * @param {HTMLElement[]} [options.stages]
 * @param {ReturnType<import('./grid-manager.js').createGridManager>} options.grid
 * @param {import('./events.js').EventSystem} options.events
 */
export function createInteractionManager(options) {
  const stage = options.stage;
  const stages =
    options.stages && options.stages.length
      ? options.stages.filter(Boolean)
      : [stage];
  const grid = options.grid;
  const events = options.events;

  let clientX = null;
  let clientY = null;
  let localX = -1;
  let localY = -1;
  let inside = false;
  let stageIndex = -1;
  let started = false;

  function pointInField(cx, cy) {
    for (let i = 0; i < stages.length; i++) {
      const rect = stages[i].getBoundingClientRect();
      const rectX = cx - rect.left;
      const rectY = cy - rect.top;
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        rectX >= 0 &&
        rectY >= 0 &&
        rectX <= rect.width &&
        rectY <= rect.height
      ) {
        return {
          inside: true,
          x: rectX * (grid.viewW / rect.width),
          y: rectY * (grid.viewH / rect.height),
          stageIndex: i,
          stage: stages[i],
        };
      }
    }
    return { inside: false, x: -1, y: -1, stageIndex: -1, stage: null };
  }

  function emitMove(cx, cy) {
    clientX = cx;
    clientY = cy;
    const hit = pointInField(cx, cy);
    const wasInside = inside;
    inside = hit.inside;
    stageIndex = hit.stageIndex;
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
      stageIndex: hit.stageIndex,
      stage: hit.stage,
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
    stageIndex = -1;
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
      stageIndex,
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
    get stages() { return stages.slice(); },
  };
}
