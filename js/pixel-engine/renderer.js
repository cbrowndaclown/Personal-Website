/* Renderer — draws the current pixel field surface.
   Owns the shared canvas context and rest-state paint helpers.
   Style plugins decide *what* to show by updating state / calling paint APIs;
   they should not reach past this module for raw surface setup. */

import { CELL, DOT, FIELD, COOL } from './constants.js';

/**
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {ReturnType<import('./grid-manager.js').createGridManager>} options.grid
 */
export function createRenderer(options) {
  const canvas = options.canvas;
  const grid = options.grid;
  const ctx = canvas.getContext('2d', { alpha: false });

  /**
   * Size the backing store to the current grid view + DPR.
   * Call when an active style claims the shared canvas.
   */
  function applySurface() {
    const { viewW, viewH, dpr } = grid;
    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
    canvas.style.width = viewW + 'px';
    canvas.style.height = viewH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * Idle field: flat FIELD background + resting COOL dots.
   * @param {object} [override]
   * @param {number} [override.cols]
   * @param {number} [override.rows]
   * @param {number} [override.cell]
   * @param {number} [override.viewW]
   * @param {number} [override.viewH]
   */
  function paintRest(override) {
    const cols = override && override.cols != null ? override.cols : grid.cols;
    const rows = override && override.rows != null ? override.rows : grid.rows;
    const cell = override && override.cell != null ? override.cell : grid.cell || CELL;
    const viewW = override && override.viewW != null ? override.viewW : grid.viewW;
    const viewH = override && override.viewH != null ? override.viewH : grid.viewH;
    const dot = cell - 2;

    ctx.fillStyle = `rgb(${FIELD[0]},${FIELD[1]},${FIELD[2]})`;
    ctx.fillRect(0, 0, viewW, viewH);

    const half = (cell - dot) * 0.5;
    ctx.fillStyle = `rgb(${COOL[0]},${COOL[1]},${COOL[2]})`;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        ctx.fillRect(x * cell + half, y * cell + half, dot, dot);
      }
    }
  }

  function clear(color) {
    const c = color || FIELD;
    ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
    ctx.fillRect(0, 0, grid.viewW, grid.viewH);
  }

  /**
   * Future path: paint from PixelStateManager buffers.
   * V1 styles still own their simulation paint loops; this exists so
   * future Pixel FS plugins can modify state without touching canvas code.
   * @param {ReturnType<import('./pixel-state.js').createPixelStateManager>['getBuffers'] extends Function ? any : never} buffers
   */
  function paintFromState(buffers) {
    if (!buffers || !buffers.count) {
      paintRest();
      return;
    }
    const cell = grid.cell || CELL;
    const dot = DOT;
    clear(FIELD);
    for (let i = 0; i < buffers.count; i++) {
      if (buffers.active && !buffers.active[i]) continue;
      const size = dot;
      const cx = (buffers.x[i] + (buffers.offsetX ? buffers.offsetX[i] : 0));
      const cy = (buffers.y[i] + (buffers.offsetY ? buffers.offsetY[i] : 0));
      const a = buffers.opacity ? buffers.opacity[i] : 1;
      const r = buffers.colorR ? (buffers.colorR[i] * 255) | 0 : COOL[0];
      const g = buffers.colorG ? (buffers.colorG[i] * 255) | 0 : COOL[1];
      const b = buffers.colorB ? (buffers.colorB[i] * 255) | 0 : COOL[2];
      ctx.fillStyle = a < 1 ? `rgba(${r},${g},${b},${a})` : `rgb(${r},${g},${b})`;
      ctx.fillRect(cx - size * 0.5, cy - size * 0.5, size, size);
    }
  }

  return {
    canvas,
    ctx,
    applySurface,
    paintRest,
    paintFromState,
    clear,
    get CELL() { return CELL; },
    get DOT() { return DOT; },
    get FIELD() { return FIELD; },
    get COOL() { return COOL; },
  };
}
