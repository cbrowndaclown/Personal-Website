/* CALIBRATION — deliberate micro-sync, neighbor waves, brightness balance. */

import { BOOT_TIMING } from '../constants.js';
import { hash01, smoothstep, clamp01 } from '../math.js';

export function createCalibrationStage() {
  let startMs = 0;
  /** @type {{ x: number, y: number, t0: number }[]} */
  let syncNodes = null;

  return {
    id: 'calibration',
    durationMs: BOOT_TIMING.CALIBRATION_MS,
    overlapMs: 0,

    enter(ctx) {
      startMs = ctx.now;
      const field = ctx.field;
      field.fillPresence(1);
      field.clearMotion();

      const cols = field.cols;
      const rows = field.rows;
      const count = Math.max(5, Math.min(14, Math.round((cols + rows) * 0.04)));
      syncNodes = [];
      for (let s = 0; s < count; s++) {
        syncNodes.push({
          x: hash01(s, 0x701) * cols,
          y: hash01(s, 0x702) * rows,
          t0: 0.08 + hash01(s, 0x703) * 0.55,
        });
      }
    },

    update(ctx) {
      const field = ctx.field;
      const brightness = field.brightness;
      const ox = field.ox;
      const oy = field.oy;
      if (!brightness || !syncNodes) return { done: true };

      const cols = field.cols;
      const rows = field.rows;
      const elapsed = ctx.now - startMs;
      const u = clamp01(elapsed / BOOT_TIMING.CALIBRATION_MS);
      brightness.fill(0);
      ox.fill(0);
      oy.fill(0);

      /* Global balancing breath — very subtle */
      const breath = Math.sin(u * Math.PI) * 0.045;
      const settle = 1 - smoothstep((u - 0.75) / 0.25);

      for (let i = 0; i < brightness.length; i++) {
        const x = i % cols;
        const y = (i / cols) | 0;
        let glow = breath * (0.55 + hash01(i, 0x711) * 0.45);

        for (let s = 0; s < syncNodes.length; s++) {
          const node = syncNodes[s];
          const local = clamp01((u - node.t0) / 0.28);
          if (local <= 0 || local >= 1) continue;
          const dx = x + 0.5 - node.x;
          const dy = y + 0.5 - node.y;
          const d = Math.hypot(dx, dy);
          const waveR = 2 + local * 16;
          const band = 1 - Math.abs(d - waveR) / 2.4;
          if (band <= 0) continue;
          const pulse = smoothstep(band) * Math.sin(local * Math.PI) * 0.22;
          glow = Math.max(glow, pulse);

          /* Neighbor micro-adjust — sub-pixel nudge toward sync node, then ease out */
          if (d > 0.2 && d < waveR + 2) {
            const pull = pulse * 0.35 * settle;
            ox[i] += (dx / d) * pull * -0.55;
            oy[i] += (dy / d) * pull * -0.55;
          }
        }

        /* Soft column sync ripple — implies scanline calibration without chaos */
        const colPhase = ((x / Math.max(1, cols - 1)) - u * 1.15);
        const colBand = 1 - Math.min(1, Math.abs(colPhase) * 18);
        if (colBand > 0) {
          glow = Math.max(glow, colBand * 0.08 * settle);
        }

        brightness[i] = Math.max(0, glow) * settle;
        ox[i] *= settle;
        oy[i] *= settle;
      }

      return { done: elapsed >= BOOT_TIMING.CALIBRATION_MS };
    },

    exit(ctx) {
      ctx.field.clearBrightness();
      ctx.field.clearMotion();
      ctx.field.fillPresence(1);
      syncNodes = null;
    },
  };
}
