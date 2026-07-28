/* POWERING_ON — dormant field with sparse soft flicker. */

import { BOOT_TIMING } from '../constants.js';
import { hash01, smoothstep, clamp01 } from '../math.js';

/**
 * @param {object} ctx
 * @param {import('../boot-field.js').createBootField extends Function} ctx.field
 */
export function createPoweringOnStage() {
  let startMs = 0;
  let seeds = null;

  return {
    id: 'powering_on',
    durationMs: BOOT_TIMING.POWERING_ON_MS,
    overlapMs: BOOT_TIMING.POWERING_OVERLAP_MS,

    enter(ctx) {
      startMs = ctx.now;
      const field = ctx.field;
      field.clear();
      const n = field.size;
      /* Very few flicker seeds — restrained power-on signal */
      const count = Math.max(4, Math.min(18, (n * 0.0012) | 0));
      seeds = new Int32Array(count);
      for (let s = 0; s < count; s++) {
        seeds[s] = (hash01(s, 0x501) * n) | 0;
      }
    },

    update(ctx) {
      const field = ctx.field;
      const presence = field.presence;
      const brightness = field.brightness;
      if (!presence || !brightness || !seeds) return { done: true };

      const elapsed = ctx.now - startMs;
      const u = clamp01(elapsed / BOOT_TIMING.POWERING_ON_MS);
      brightness.fill(0);

      /* Soft ambient lift near the end so the handoff into grid gen is continuous */
      const ambient = smoothstep((u - 0.55) / 0.45) * 0.04;
      if (ambient > 0) {
        for (let i = 0; i < presence.length; i++) {
          if (presence[i] < ambient) presence[i] = ambient * hash01(i, 0x511) * 0.35;
        }
      }

      for (let s = 0; s < seeds.length; s++) {
        const i = seeds[s];
        const phase = hash01(s, 0x522);
        const pulse = 0.5 + 0.5 * Math.sin(elapsed * 0.0042 + phase * Math.PI * 2);
        const envelope = smoothstep(u * 1.35) * (1 - smoothstep((u - 0.82) / 0.18));
        const level = (0.18 + pulse * 0.42) * envelope;
        brightness[i] = Math.max(brightness[i], level);
        /* Tiny presence so flicker sits on an almost-invisible lattice point */
        if (presence[i] < 0.22) presence[i] = 0.22 * envelope;
      }

      return { done: elapsed >= BOOT_TIMING.POWERING_ON_MS };
    },

    exit() {
      seeds = null;
    },
  };
}
