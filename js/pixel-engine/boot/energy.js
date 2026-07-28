/* Shared left→right energy wipe used by boot stages. */

import { clamp01, smootherstep, easeInOutCubic, hash01 } from './math.js';

/**
 * Apply a soft left-to-right energy transition across the entire grid.
 * Every cell lerps from `fromEnergy` toward `toEnergy` as the front passes.
 *
 * @param {ReturnType<import('./boot-field.js').createBootField>} field
 * @param {number} fromEnergy
 * @param {number} toEnergy
 * @param {number} u — 0..1 stage progress
 * @param {number} feather — soft edge width as fraction of grid width
 */
export function applyEnergySweep(field, fromEnergy, toEnergy, u, feather) {
  const presence = field.presence;
  if (!presence) return;

  const cols = field.cols;
  const rows = field.rows;
  if (cols < 1 || rows < 1) return;

  const edge = Math.max(0.04, feather || 0.14);
  const progress = easeInOutCubic(clamp01(u));
  const front = -edge + progress * (1 + 2 * edge);
  const denom = Math.max(1, cols - 1);

  for (let i = 0; i < presence.length; i++) {
    const x = i % cols;
    const xn = x / denom;
    const t = smootherstep(clamp01((front - xn) / edge));
    presence[i] = fromEnergy + (toEnergy - fromEnergy) * t;
  }
}

/**
 * Conservative bound on per-cell organic jitter (must match local math below).
 * @param {number} scatter
 */
function organicLocalPad(scatter) {
  const s = scatter || 0;
  return s * 0.5 + s * 0.21 + 0.018 + 0.042;
}

/**
 * Per-cell organic order in the same space as applyOrganicEnergyReveal.
 * @param {number} i
 * @param {number} cols
 * @param {number} rows
 * @param {number} scatter
 * @param {number} seed
 */
function cellOrder(i, cols, rows, scatter, seed) {
  const xDenom = Math.max(1, cols - 1);
  const yDenom = Math.max(1, rows - 1);
  const x = i % cols;
  const y = (i / cols) | 0;
  const xn = x / xDenom;
  const yn = y / yDenom;
  const h1 = hash01(i, seed);
  const h2 = hash01(i, seed ^ 0x9e3779b9);
  const h3 = hash01(i, seed + 0x85ebca6b);
  const yRipple = (yn - 0.5) * 0.06 * (0.4 + h2);
  const local =
    (h1 - 0.5) * scatter +
    (h2 - 0.5) * scatter * 0.42 +
    Math.sin(y * 1.73 + h3 * 6.1) * 0.018 +
    yRipple;
  return xn + local;
}

/**
 * Calm L→R order (no organic scatter) — used inside the temporary boot zone
 * so reserved chrome space does not sprout early random bright cells.
 * @param {number} i
 * @param {number} cols
 */
function calmOrder(i, cols) {
  const xDenom = Math.max(1, cols - 1);
  return (i % cols) / xDenom;
}

/**
 * Procedural left→right reveal with sticky per-cell generation.
 *
 * Each cell advances toward `toEnergy` only when the front reaches its own
 * unclamped order. Already-generated cells are never rewritten. Progress is
 * not clamped to 1 — if the stage clock runs long, the same algorithm keeps
 * flipping the remaining cells individually (no completed-frame swap).
 *
 * Optional `bootZone`: while active, cells inside the reserve still receive
 * gray energy but never white foreground, and use calm (non-scattered) order.
 *
 * @param {ReturnType<import('./boot-field.js').createBootField>} field
 * @param {number} fromEnergy
 * @param {number} toEnergy
 * @param {number} u — stage progress (may exceed 1 until settled)
 * @param {{ scatter?: number, soft?: number, seed?: number, bootZone?: object }} [opts]
 * @returns {boolean} true when every cell has reached its effective target
 */
export function applyOrganicEnergyReveal(field, fromEnergy, toEnergy, u, opts) {
  const presence = field.presence;
  if (!presence) return true;

  const cols = field.cols;
  const rows = field.rows;
  if (cols < 1 || rows < 1) return true;

  const scatter = opts && opts.scatter != null ? opts.scatter : 0.28;
  const soft = Math.max(0.012, opts && opts.soft != null ? opts.soft : 0.03);
  const seed = (opts && opts.seed) || 0x51a7;
  const bootZone = opts && opts.bootZone;
  const zoneLive = !!(bootZone && bootZone.isActive && bootZone.isActive());
  if (zoneLive && typeof bootZone.syncSize === 'function') {
    bootZone.syncSize(cols, rows);
  }
  /* Do not clamp to 1 — trailing cells keep generating past the nominal end */
  const progress = u < 0 ? 0 : u;

  const localPad = organicLocalPad(scatter);
  const orderMin = -localPad;
  const orderMax = 1 + localPad;
  const span = orderMax - orderMin + 2 * soft;
  const front = orderMin - soft + progress * span;

  const rising = toEnergy >= fromEnergy;
  const eps = 0.0015;
  let pending = 0;

  for (let i = 0; i < presence.length; i++) {
    /* Effective target — boot zone may withhold WHITE while gray still builds */
    const target =
      zoneLive && typeof bootZone.cappedToEnergy === 'function'
        ? bootZone.cappedToEnergy(i, toEnergy)
        : toEnergy;

    const cur = presence[i];
    if (Math.abs(cur - target) <= eps) {
      presence[i] = target;
      continue;
    }

    const calm =
      zoneLive &&
      typeof bootZone.prefersCalmOrder === 'function' &&
      bootZone.prefersCalmOrder(i);
    const order = calm
      ? calmOrder(i, cols)
      : cellOrder(i, cols, rows, scatter, seed);
    const raw = clamp01((front - order) / soft);
    const pop = raw <= 0 ? 0 : raw >= 1 ? 1 : smootherstep(raw);
    const next = fromEnergy + (target - fromEnergy) * pop;

    /* Sticky — only advance toward the target, never batch-rewrite */
    if (rising) {
      if (next > cur) presence[i] = next;
    } else if (next < cur) {
      presence[i] = next;
    }

    if (Math.abs(presence[i] - target) > eps) pending += 1;
  }

  return pending === 0;
}

/**
 * True when every cell is within eps of the target energy.
 * @param {ReturnType<import('./boot-field.js').createBootField>} field
 * @param {number} energy
 * @param {number} [eps]
 */
export function isEnergySettled(field, energy, eps) {
  const presence = field && field.presence;
  if (!presence) return true;
  const tol = eps != null ? eps : 0.0015;
  for (let i = 0; i < presence.length; i++) {
    if (Math.abs(presence[i] - energy) > tol) return false;
  }
  return true;
}

/**
 * Snap every cell to an exact energy level.
 * Baseline / skip paths only — never use to finish a reveal early.
 * @param {ReturnType<import('./boot-field.js').createBootField>} field
 * @param {number} energy
 */
export function lockEnergy(field, energy) {
  if (field && field.presence) field.presence.fill(energy);
}
