/* Boot stage pipeline — reorder, insert, or remove stages here. */

import { BootPhase } from '../constants.js';
import { createPoweringOnStage } from './powering-on.js';
import { createGridGenerationStage } from './grid-generation.js';
import { createCalibrationStage } from './calibration.js';
import { createSelfTestStage } from './self-test.js';
import { createTypographyStage } from './typography.js';
import { createStabilizingStage } from './stabilizing.js';
import { createReadyStage } from './ready.js';

/**
 * Build the ordered V1 boot pipeline.
 * Future stages can be spliced into this list without touching the controller.
 *
 * @param {object} options
 * @param {object} options.intro
 * @returns {{ id: string, phase: string, create: Function }[]}
 */
export function createBootStageDefs(options) {
  const intro = options.intro;

  return [
    {
      id: 'powering_on',
      phase: BootPhase.POWERING_ON,
      create: () => createPoweringOnStage(),
    },
    {
      id: 'grid_generation',
      phase: BootPhase.GRID_GENERATION,
      create: () => createGridGenerationStage(),
    },
    {
      id: 'calibration',
      phase: BootPhase.CALIBRATION,
      create: () => createCalibrationStage(),
    },
    {
      id: 'self_test',
      phase: BootPhase.SELF_TEST,
      create: () => createSelfTestStage(),
    },
    {
      id: 'typography_construction',
      phase: BootPhase.TYPOGRAPHY_CONSTRUCTION,
      create: () => createTypographyStage({ intro }),
    },
    {
      id: 'stabilizing',
      phase: BootPhase.STABILIZING,
      create: () => createStabilizingStage(),
    },
    {
      id: 'ready',
      phase: BootPhase.READY,
      create: () => createReadyStage({ intro }),
    },
  ];
}
