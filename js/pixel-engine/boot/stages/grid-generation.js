/* GRID_GENERATION — organic cluster assembly of the lattice. */

import { BOOT_TIMING } from '../constants.js';
import { hash01, smoothstep, clamp01, easeOutCubic } from '../math.js';

/**
 * Localized cluster awakenings rather than a single wipe.
 */
export function createGridGenerationStage() {
  let startMs = 0;
  /** @type {{ cx: number, cy: number, radius: number, t0: number, span: number }[]} */
  let clusters = null;

  return {
    id: 'grid_generation',
    durationMs: BOOT_TIMING.GRID_GENERATION_MS,
    /* Complete the lattice before calibration — avoids dual writers on presence */
    overlapMs: 0,

    enter(ctx) {
      startMs = ctx.now;
      const field = ctx.field;
      const cols = field.cols;
      const rows = field.rows;
      field.clearBrightness();

      const area = Math.max(1, cols * rows);
      const count = Math.max(10, Math.min(36, Math.round(Math.sqrt(area) * 0.55)));
      clusters = [];

      for (let c = 0; c < count; c++) {
        const cx = hash01(c, 0x601) * cols;
        const cy = hash01(c, 0x602) * rows;
        const radius = 4.5 + hash01(c, 0x603) * 11;
        /* Stagger cluster ignition — many local starts over the stage window */
        const t0 = hash01(c, 0x604) * 0.72;
        const span = 0.22 + hash01(c, 0x605) * 0.28;
        clusters.push({ cx, cy, radius, t0, span });
      }
    },

    update(ctx) {
      const field = ctx.field;
      const presence = field.presence;
      const brightness = field.brightness;
      if (!presence || !clusters) return { done: true };

      const cols = field.cols;
      const rows = field.rows;
      const elapsed = ctx.now - startMs;
      const u = clamp01(elapsed / BOOT_TIMING.GRID_GENERATION_MS);
      brightness.fill(0);

      for (let i = 0; i < presence.length; i++) {
        const x = i % cols;
        const y = (i / cols) | 0;
        let best = presence[i];

        for (let c = 0; c < clusters.length; c++) {
          const cl = clusters[c];
          const local = clamp01((u - cl.t0) / cl.span);
          if (local <= 0) continue;
          const dx = x + 0.5 - cl.cx;
          const dy = y + 0.5 - cl.cy;
          const d = Math.hypot(dx, dy);
          if (d > cl.radius) continue;
          const rim = 1 - d / cl.radius;
          const noise = 0.82 + hash01(i, 0x611 + c) * 0.18;
          const grow = easeOutCubic(local) * smoothstep(rim * 1.15) * noise;
          if (grow > best) best = grow;
        }

        /* Late-stage fill so the lattice completes cleanly */
        const fill = smoothstep((u - 0.78) / 0.22);
        if (fill > 0) {
          const n = 0.88 + hash01(i, 0x622) * 0.12;
          best = Math.max(best, fill * n);
        }

        presence[i] = best;

        /* Soft construction sparkle at the growth front */
        if (best > 0.08 && best < 0.92) {
          const spark = (1 - Math.abs(best - 0.55) * 2) * 0.16 * hash01(i, 0x633);
          if (spark > 0) brightness[i] = spark * smoothstep(u);
        }
      }

      return { done: elapsed >= BOOT_TIMING.GRID_GENERATION_MS };
    },

    exit(ctx) {
      ctx.field.fillPresence(1);
      ctx.field.clearBrightness();
      clusters = null;
    },
  };
}
