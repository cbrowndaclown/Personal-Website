/* STABILIZING — residual motion dies; soft lock-in pulse across the lattice. */

import { BOOT_TIMING } from '../constants.js';
import { hash01, smoothstep, clamp01, easeOutSine } from '../math.js';

export function createStabilizingStage() {
  let startMs = 0;

  return {
    id: 'stabilizing',
    durationMs: BOOT_TIMING.STABILIZING_MS,
    overlapMs: 0,

    enter(ctx) {
      startMs = ctx.now;
      ctx.field.fillPresence(1);
      ctx.field.clearMotion();
      introHold(ctx);
    },

    update(ctx) {
      const field = ctx.field;
      const brightness = field.brightness;
      const ox = field.ox;
      const oy = field.oy;
      if (!brightness) return { done: true };

      const cols = field.cols;
      const rows = field.rows;
      const elapsed = ctx.now - startMs;
      const u = clamp01(elapsed / BOOT_TIMING.STABILIZING_MS);
      const pulse = Math.sin(easeOutSine(u) * Math.PI);
      const fade = 1 - smoothstep((u - 0.55) / 0.45);

      brightness.fill(0);
      ox.fill(0);
      oy.fill(0);

      /* Single soft synchronization sweep — radial from center */
      const cx = cols * 0.5;
      const cy = rows * 0.5;
      const maxR = Math.hypot(cx, cy) + 2;
      const waveR = easeOutSine(u) * maxR;

      for (let i = 0; i < brightness.length; i++) {
        const x = i % cols;
        const y = (i / cols) | 0;
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const band = 1 - Math.min(1, Math.abs(d - waveR) / 3.2);
        if (band > 0) {
          const glow = smoothstep(band) * pulse * 0.14 * fade;
          brightness[i] = glow * (0.75 + hash01(i, 0x801) * 0.25);
        }
      }

      return { done: elapsed >= BOOT_TIMING.STABILIZING_MS };
    },

    exit(ctx) {
      ctx.field.clearBrightness();
      ctx.field.clearMotion();
      ctx.field.fillPresence(1);
    },
  };
}

function introHold(ctx) {
  if (ctx.intro && typeof ctx.intro.holdTypography === 'function') {
    ctx.intro.holdTypography();
  }
}
