/* Blank stage — Pixel FS resting lattice only.
   Reuses grid + renderer so the field matches the live engine at rest.
   No boot, intro, interaction, or style simulation. */

import { createEventSystem } from './pixel-engine/events.js';
import { createGridManager } from './pixel-engine/grid-manager.js';
import { createRenderer } from './pixel-engine/renderer.js';
import { CELL, PixelEvents } from './pixel-engine/constants.js';

(function initBlankStage() {
  'use strict';

  const canvas = document.getElementById('heatmap');
  const stage = document.getElementById('stage');
  if (!canvas || !stage) return;

  const events = createEventSystem();
  const grid = createGridManager({
    stage,
    hitBounds: stage,
    events,
    cell: CELL,
  });
  const renderer = createRenderer({
    canvas,
    canvases: [canvas],
    grid,
  });

  function paintRestingGrid() {
    if (!(grid.viewW > 0) || !(grid.viewH > 0)) return;
    renderer.applySurface();
    renderer.paintRest();
  }

  events.on(PixelEvents.GridInitialized, paintRestingGrid);
  events.on(PixelEvents.GridResized, paintRestingGrid);

  grid.start();
  paintRestingGrid();

  window.blankStage = { grid, renderer, events };
})();
