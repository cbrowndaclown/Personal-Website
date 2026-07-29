/* Shared center-out organic front — density sync, teardown, and generation.
   Radial order with branching corridors, local clusters, and per-cell grain.
   Not a perfect circle; neighboring cells rarely fire in lockstep. */

import { clamp01, smootherstep, hash01 } from './math.js';

/**
 * Bound on per-cell radial-order jitter (must match cellRadialOrder).
 * @param {number} scatter
 */
export function radialOrderLocalPad(scatter) {
  const s = scatter || 0;
  return s * 0.55 + s * 0.7 + s * 0.35 + 0.05;
}

/**
 * Procedural radial order: distance from center + branching corridors, local
 * clusters, and per-cell scatter. Lower = earlier in the front.
 *
 * @param {number} i
 * @param {number} cols
 * @param {number} rows
 * @param {number} scatter
 * @param {number} seed
 * @returns {number} unclamped order
 */
export function cellRadialOrder(i, cols, rows, scatter, seed) {
  const cx = (cols - 1) * 0.5;
  const cy = (rows - 1) * 0.5;
  const x = i % cols;
  const y = (i / cols) | 0;
  const dx = cx > 0 ? (x - cx) / cx : 0;
  const dy = cy > 0 ? (y - cy) / cy : 0;
  const dist = Math.hypot(dx, dy);

  const h1 = hash01(i, seed);
  const h2 = hash01(i, seed ^ 0x9e3779b9);
  const h3 = hash01(i, seed + 0x85ebca6b);
  const h4 = hash01(i, seed ^ 0xc2b2ae35);
  const angle = Math.atan2(dy, dx);

  /* Branching corridors — some angular sectors leap ahead */
  const branch =
    Math.sin(angle * 2.35 + h2 * 5.4) * scatter * 0.62 +
    Math.sin(angle * 5.1 + h4 * 3.2) * scatter * 0.22;
  /* Local clusters that tend to activate / retire together */
  const cluster =
    Math.sin(x * 0.37 + y * 0.29 + h3 * 4.4) * scatter * 0.32 +
    Math.sin(x * 0.71 - y * 0.53 + h1 * 2.7) * scatter * 0.14;
  /* Fine per-pixel jitter so neighbors rarely fire in lockstep */
  const grain = (h1 - 0.5) * scatter + (h2 - 0.5) * scatter * 0.38;

  return dist * 0.7 + branch + cluster + grain;
}

/**
 * Sticky center-out energy transition driven by cellRadialOrder.
 * Progress may exceed 1 until every cell settles. Optional energize flash
 * on rising activations (density generation / sync).
 *
 * @param {ReturnType<import('./boot-field.js').createBootField>} field
 * @param {number} fromEnergy
 * @param {number} toEnergy
 * @param {number} u — progress (may exceed 1 until settled)
 * @param {{
 *   scatter?: number,
 *   soft?: number,
 *   seed?: number,
 *   energize?: number,
 *   eps?: number,
 *   breatheRate?: number,
 *   breatheAmp?: number,
 *   frontierWobble?: number,
 *   extraLag?: number,
 * }} [opts]
 * @returns {boolean} true when every cell has reached toEnergy
 */
export function applyOrganicRadialReveal(field, fromEnergy, toEnergy, u, opts) {
  const presence = field && field.presence;
  if (!presence) return true;

  const cols = field.cols;
  const rows = field.rows;
  if (cols < 1 || rows < 1) return true;

  const scatter = opts && opts.scatter != null ? opts.scatter : 0.34;
  const soft = Math.max(0.012, opts && opts.soft != null ? opts.soft : 0.026);
  const seed = (opts && opts.seed) || 0xc41b;
  const energize = opts && opts.energize != null ? opts.energize : 0;
  const eps = opts && opts.eps != null ? opts.eps : 0.0015;
  const breatheRate = opts && opts.breatheRate != null ? opts.breatheRate : 7.1;
  const breatheAmp = opts && opts.breatheAmp != null ? opts.breatheAmp : 0.55;
  const frontierWobble =
    opts && opts.frontierWobble != null ? opts.frontierWobble : 0.08;
  const extraLag = opts && opts.extraLag != null ? opts.extraLag : 0;
  const brightness = field.brightness;
  const progress = u < 0 ? 0 : u;

  const localPad = radialOrderLocalPad(scatter);
  const orderMin = -localPad;
  const orderMax = 1.08 + localPad;
  const span = orderMax - orderMin + 2 * soft;
  const breathe = Math.sin(progress * breatheRate) * soft * breatheAmp;
  const front = orderMin - soft + progress * span + breathe;

  const rising = toEnergy >= fromEnergy;
  let pending = 0;

  for (let i = 0; i < presence.length; i++) {
    const cur = presence[i];
    if (Math.abs(cur - toEnergy) <= eps) {
      presence[i] = toEnergy;
      continue;
    }

    let order = cellRadialOrder(i, cols, rows, scatter, seed);
    const h = hash01(i, seed ^ 0x7f4a7c15);
    order += Math.sin(progress * 5.3 + h * 6.28) * scatter * frontierWobble;
    if (extraLag > 0) {
      const h2 = hash01(i, seed ^ 0xa511e9b3);
      order += (h2 - 0.5) * scatter * extraLag;
    }

    const raw = clamp01((front - order) / soft);
    const pop = raw <= 0 ? 0 : raw >= 1 ? 1 : smootherstep(raw);
    const next = fromEnergy + (toEnergy - fromEnergy) * pop;

    const wasInactive = cur <= fromEnergy + (toEnergy - fromEnergy) * 0.2;
    /* Sticky — only advance toward the target, never batch-rewrite */
    if (rising) {
      if (next > cur) presence[i] = next;
    } else if (next < cur) {
      presence[i] = next;
    }

    /* Brief energize the moment a dormant cell is claimed (rising only) */
    if (
      brightness &&
      rising &&
      wasInactive &&
      pop >= 0.4 &&
      energize > 0 &&
      brightness[i] < energize
    ) {
      brightness[i] = energize * (0.65 + 0.35 * pop);
    }

    if (Math.abs(presence[i] - toEnergy) > eps) pending += 1;
  }

  return pending === 0;
}
