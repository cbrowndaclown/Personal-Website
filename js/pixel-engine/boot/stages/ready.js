/* READY — engine online; interactions unlock; post-boot content may continue. */

import { BOOT_TIMING } from '../constants.js';

/**
 * @param {object} options
 * @param {object} options.intro
 */
export function createReadyStage(options) {
  const intro = options.intro;
  let startMs = 0;
  let directoryStarted = false;

  return {
    id: 'ready',
    durationMs: BOOT_TIMING.READY_DIRECTORY_DELAY_MS,
    overlapMs: 0,

    enter(ctx) {
      startMs = ctx.now;
      directoryStarted = false;
      ctx.field.fillPresence(1);
      ctx.field.clearBrightness();
      ctx.field.clearMotion();
      ctx.setInteractive(true);
      ctx.setPhase('ready');
      ctx.emitReady();
    },

    update(ctx) {
      const elapsed = ctx.now - startMs;
      if (!directoryStarted && elapsed >= BOOT_TIMING.READY_DIRECTORY_DELAY_MS) {
        directoryStarted = true;
        intro.beginDirectorySequence();
      }
      /* Ready is terminal for the boot pipeline — never "done" for advancement */
      return { done: false, terminal: true };
    },

    exit() {},
  };
}
