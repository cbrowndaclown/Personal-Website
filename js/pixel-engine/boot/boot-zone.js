/* Boot zone — temporary reserved region for the loading ring + "Booting…" status.
   While active, procedural generation still initializes gray presence underneath,
   but random white foreground energy is withheld from this region so the boot
   chrome sits cleanly inside the Pixel FS. Released automatically when exclusive
   boot chrome finishes — no permanent hole or mask. */

import { BOOT_ENERGY } from './constants.js';

const FACE_RADIUS = 5;
/** Presence ceiling inside the zone while reserved — gray may build; white may not. */
const FOREGROUND_CAP = BOOT_ENERGY.LIGHT;

/**
 * Shared geometry with indicator / status so the reserve hugs the boot chrome.
 * @param {number} cols
 * @param {number} rows
 */
export function bootChromeLayout(cols, rows) {
  const cx = (cols - 1) * 0.5;
  const cy = (rows - 1) * 0.5;
  const radius = Math.max(FACE_RADIUS, Math.min(cols, rows) * 0.09);

  let fontPx = Math.max(8, Math.round(Math.min(cols, rows) * 0.088));
  fontPx = Math.min(fontPx, Math.max(8, Math.round(rows * 0.095)));

  const ringBottom = cy + radius;
  const clearance = Math.max(8, Math.round(radius * 1.15 + rows * 0.02));
  let textCy = Math.round(ringBottom + clearance + fontPx * 0.5);
  const maxCy = rows - Math.ceil(fontPx * 0.65) - 1;
  if (textCy > maxCy) textCy = maxCy;
  const minCy = Math.round(ringBottom + Math.max(5, radius * 0.55) + fontPx * 0.4);
  if (textCy < minCy && minCy <= maxCy) textCy = minCy;

  /* Soft padding — immediate neighbors of ring + word, not a hard cutout. */
  const pad = Math.max(5, Math.round(radius * 0.65 + Math.min(cols, rows) * 0.012));
  const textHalfW = Math.max(
    radius + pad,
    Math.round(fontPx * 3.6 + pad)
  );
  const top = cy - radius - pad;
  const bottom = textCy + fontPx * 0.72 + pad;
  const midY = (top + bottom) * 0.5;
  const rx = textHalfW;
  const ry = Math.max(radius + pad, (bottom - top) * 0.5);

  return {
    cx,
    cy,
    radius,
    fontPx,
    textCy,
    midY,
    rx,
    ry,
    pad,
  };
}

/**
 * @returns {object}
 */
export function createBootZone() {
  let active = false;
  let cols = 0;
  let rows = 0;
  let cx = 0;
  let midY = 0;
  let rx = 1;
  let ry = 1;
  /** @type {Uint8Array|null} */
  let mask = null;

  function rebuild(nextCols, nextRows) {
    cols = nextCols | 0;
    rows = nextRows | 0;
    if (cols < 8 || rows < 8) {
      mask = null;
      return;
    }

    const layout = bootChromeLayout(cols, rows);
    cx = layout.cx;
    midY = layout.midY;
    rx = Math.max(1, layout.rx);
    ry = Math.max(1, layout.ry);

    const n = cols * rows;
    mask = new Uint8Array(n);
    const invRx2 = 1 / (rx * rx);
    const invRy2 = 1 / (ry * ry);
    for (let y = 0; y < rows; y++) {
      const dy = y - midY;
      const dy2 = dy * dy * invRy2;
      const row = y * cols;
      for (let x = 0; x < cols; x++) {
        const dx = x - cx;
        if (dx * dx * invRx2 + dy2 <= 1) {
          mask[row + x] = 1;
        }
      }
    }
  }

  /**
   * Arm the reserve for exclusive boot chrome.
   * @param {number} nextCols
   * @param {number} nextRows
   */
  function activate(nextCols, nextRows) {
    active = true;
    rebuild(nextCols, nextRows);
  }

  /**
   * Drop the reserve. Optionally lift capped cells to a finished energy level
   * so the lattice has no lasting dimmer island.
   * @param {ReturnType<import('./boot-field.js').createBootField>} [field]
   * @param {number} [energy]
   */
  function deactivate(field, energy) {
    if (active && field && field.presence && mask && energy != null) {
      const presence = field.presence;
      const target = energy;
      for (let i = 0; i < mask.length; i++) {
        if (!mask[i]) continue;
        if (presence[i] < target) presence[i] = target;
      }
    }
    active = false;
    mask = null;
  }

  function isActive() {
    return active;
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  function contains(x, y) {
    if (!active || !mask) return false;
    if (x < 0 || y < 0 || x >= cols || y >= rows) return false;
    return mask[y * cols + x] === 1;
  }

  /**
   * @param {number} i
   */
  function containsIndex(i) {
    if (!active || !mask) return false;
    if (i < 0 || i >= mask.length) return false;
    return mask[i] === 1;
  }

  /**
   * Target energy for a cell while the zone is reserved.
   * Gray ladder (→ DARK / LIGHT) proceeds; WHITE foreground is withheld.
   * @param {number} i
   * @param {number} toEnergy
   */
  function cappedToEnergy(i, toEnergy) {
    if (!containsIndex(i)) return toEnergy;
    if (toEnergy <= FOREGROUND_CAP) return toEnergy;
    return FOREGROUND_CAP;
  }

  /**
   * True when this cell should use a calm (non-scattered) reveal order
   * so early random bright pops do not appear inside the reserve.
   * @param {number} i
   */
  function prefersCalmOrder(i) {
    return containsIndex(i);
  }

  function syncSize(nextCols, nextRows) {
    if (!active) return;
    if (nextCols === cols && nextRows === rows && mask) return;
    rebuild(nextCols, nextRows);
  }

  return {
    activate,
    deactivate,
    isActive,
    contains,
    containsIndex,
    cappedToEnergy,
    prefersCalmOrder,
    syncSize,
    get foregroundCap() {
      return FOREGROUND_CAP;
    },
  };
}
