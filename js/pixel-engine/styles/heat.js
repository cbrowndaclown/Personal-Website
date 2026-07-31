/* Pixel FS — Magnetic (heat). V1 simulation preserved.
   Thermal energy model: Decay Speed → how quickly heat cools + springs settle. */

import { PixelEvents } from '../constants.js';
import { computeGridLayout } from '../grid-manager.js';
import { applyDecayRate } from '../pixel-behavior.js';

/**
 * @param {object} deps
 */
export function createHeatStyle(deps) {
  const canvas = deps.canvas;
  const stage = deps.stage;
  const animConfig = deps.animConfig;
  const resolveActiveBgMode = deps.resolveActiveBgMode;
  const pixelBehavior = deps.pixelBehavior;
  const cursorMode = deps.cursorMode;
  const perfMgr = deps.performance;
  const pixelField = deps.pixelField;
  const pixelIntro = deps.pixelIntro;
  const events = deps.events;
  const grid = deps.grid;
  if (!canvas || !stage) {
    return { id: 'heat', implemented: true, mount() {}, destroy() {} };
  }

  /* Live via Performance → Pixel Density (default 5 preserves V1). */
  let CELL = (perfMgr && typeof perfMgr.getCellSize === 'function')
    ? perfMgr.getCellSize()
    : 5;
  /* MAX_DISP default 0.40 — live via shared Pixel Behavior (reactionStrength) */
  const HEAT_IN  = 0.09;   /* color lags motion — keep snappy under cursor */
  /* Thermal cool-down baseline — live via shared Decay Speed (scales.decay) */
  const BASE_HEAT_OUT = 0.018;
  const MOUSE_NEAR = 0.11; /* soft when cursor is close to sample */
  const MOUSE_FAR  = 0.26; /* catches up when pointer leaps */
  let DOT = Math.max(1, CELL - 2);
  const EPS      = 0.0006;
  let _perfRev = -1;
  let effectQuality = 1;

  /* ── Visual / influence (tweak freely) ──────────────────────────────────
     Soft coral heat radiating through the dot field.  Brush extent,
     intensity, and cool-down are driven by animConfig (Settings). */
  const DEFAULT_RADIUS = 11.8;
  const DEFAULT_SIGMA  = 4.9;              /* scaled with radius — soft rim */
  const SIGMA_RATIO    = DEFAULT_SIGMA / DEFAULT_RADIUS;
  /* HOT comes from animConfig.effectColor — shared with Wave */
  const COLOR_FALLOFF   = 0.72;             /* <1 lifts soft fringe at the outer edge */
  const GLOW_OPACITY    = 0.95;             /* peak pink blend strength */
  const GLOW_SIZE       = 0.10;             /* subtle size bloom on hottest dots */
  /* Soft bloom — frosted warm light, never neon */
  const BLOOM_STRENGTH   = 0.12;            /* peak feather opacity (keep tiny) */
  const BLOOM_SPREAD     = 1.4;             /* glow reach beyond the dot (× DOT) */
  const BLOOM_BRIGHTNESS = 0.20;            /* lift toward warm light with influence */
  const BLOOM_THRESHOLD  = 0.05;            /* no feather below this tint */

  /* Flat field · white pixels → coral heat under pressure */
  const FIELD = [210, 210, 210];
  const COOL  = [255, 255, 255];
  /* Boot indicator accent — restrained red, independent of Settings HOT */
  const BOOT_RED = [214, 46, 46];

  function latticeBootActive() {
    if (typeof pixelField.latticeBootActive === 'function') {
      return pixelField.latticeBootActive();
    }
    const p = document.body.dataset.boot;
    return (
      p === 'powering_on' ||
      p === 'grid_generation' ||
      p === 'calibration' ||
      p === 'display_clear' ||
      p === 'self_test' ||
      p === 'typography_construction' ||
      p === 'typography'
    );
  }

  /**
   * Startup lattice build only — black clear + FIELD claim as cells generate.
   * Density rebuild must never use this path (powered gray panel stays lit).
   */
  function bootMaterializeActive() {
    return latticeBootActive();
  }

  /** Density sync — pixels materialize over an already-powered gray panel. */
  function densitySyncActive() {
    return (
      typeof pixelField.recalibrationActive === 'function' &&
      pixelField.recalibrationActive()
    );
  }

  /** Progressive lattice claim (boot black→FIELD, or density gray→pixels). */
  function latticeMaterializeActive() {
    return bootMaterializeActive() || densitySyncActive();
  }

  /** Density teardown — gray panel shows through as pixels retire (not black). */
  function teardownActive() {
    return (
      typeof pixelField.teardownActive === 'function' &&
      pixelField.teardownActive()
    );
  }

  /**
   * Density teardown / sync — internal system op; never borrow Settings RGB.
   * Resting lattice stays FIELD → COOL; energize / residual heat lift toward white.
   */
  function densityOpsActive() {
    if (typeof pixelField.densityOpsActive === 'function') {
      return pixelField.densityOpsActive();
    }
    return (
      teardownActive() ||
      (typeof pixelField.recalibrationActive === 'function' &&
        pixelField.recalibrationActive())
    );
  }

  function exclusiveBootActive() {
    if (typeof pixelField.exclusiveBootActive === 'function') {
      return pixelField.exclusiveBootActive();
    }
    const p = document.body.dataset.boot;
    return (
      p === 'powering_on' ||
      p === 'grid_generation' ||
      p === 'calibration' ||
      p === 'display_clear' ||
      p === 'self_test'
    );
  }

  function indicatorAccentActive() {
    if (typeof pixelField.indicatorAccentActive === 'function') {
      return pixelField.indicatorAccentActive();
    }
    return exclusiveBootActive();
  }

  /* ── Spring (silicone / fabric) ─────────────────────────────────────────
     Overdamped mass-spring: force pulls dots, then they ease home.
     Return is softer than engagement; nonlinear drag kills bounce.
     STIFF_PULL ← Movement Speed; return ← Decay Speed (energy settle). */
  const DRAG              = 0.29;  /* base velocity drag */
  const DRAG_QUAD         = 0.42;  /* extra drag at speed — settles clean */
  const V_MAX             = 0.20;  /* soft ceiling, no hard pops */
  const BASE_STIFF_RETURN = 0.026; /* spring home at default Decay Speed */

  /* ── Trail / pressure-wave (all configurable) ─────────────────────────── */
  const TRAIL_LENGTH   = 12;   /* short wake — one continuous lobe */
  const TRAIL_DECAY    = 0.50; /* tip-led; history only softens the wave */
  const TRAIL_MIN_STEP = 0.36; /* dense samples — liquid continuity */
  const TRAIL_FORCE    = 0.90; /* displacement gain */
  /* TRAIL_FADE default 0.965 — live via shared Pixel Behavior (trailLifetime) */
  const TRAIL_FADE_CUT = 0.015; /* drop samples only once nearly invisible */

  /* Shared Pixel Behavior — modes read through pixelBehavior, not animConfig directly */
  const BEHAVIOR_DEFAULTS =
    (pixelBehavior && pixelBehavior.defaults) ||
    Object.freeze({
      reactionStrength: 0.4,
      movementSpeed: 0.078,
      decaySpeed: 0.018,
      trailLifetime: 0.965,
    });
  let MAX_DISP = BEHAVIOR_DEFAULTS.reactionStrength;
  /* Menu Impact — one-shot lattice flex (Space-skip only; not cursor heat) */
  let menuImpact = null;
  let STIFF_PULL = BEHAVIOR_DEFAULTS.movementSpeed;
  let HEAT_OUT = BASE_HEAT_OUT;
  let STIFF_RETURN = BASE_STIFF_RETURN;
  let TRAIL_FADE = BEHAVIOR_DEFAULTS.trailLifetime;
  let _behaviorRev = -1;
  let _cursorModeRev = -1;
  let activeCursorMode = 'standard';
  const _cursorOut = { targetX: 0, targetY: 0, motion: true, heatHold: 1 };

  /**
   * Map shared Pixel Behavior → live Heat physics.
   * Decay Speed scales thermal cool-down + spring return (energy dissipates).
   */
  function syncBehaviorFromConfig() {
    if (!pixelBehavior) return false;
    const rev = pixelBehavior.getRevision();
    if (rev === _behaviorRev) return false;
    _behaviorRev = rev;
    const bh = pixelBehavior.values;
    const sc = pixelBehavior.scales || { decay: 1 };
    MAX_DISP = bh.reactionStrength;
    STIFF_PULL = bh.movementSpeed;
    /* Decay Speed — thermal energy cools; displacement energy settles home */
    HEAT_OUT = applyDecayRate(BASE_HEAT_OUT, sc.decay);
    STIFF_RETURN = applyDecayRate(BASE_STIFF_RETURN, sc.decay);
    TRAIL_FADE = bh.trailLifetime;
    return true;
  }

  function syncCursorModeFromConfig() {
    if (!cursorMode) {
      activeCursorMode = 'standard';
      return false;
    }
    const rev = cursorMode.getRevision();
    if (rev === _cursorModeRev) return false;
    _cursorModeRev = rev;
    activeCursorMode = cursorMode.get();
    return true;
  }

  /**
   * Pull Performance cache — density remount is owned by PixelDensityChanged.
   * Soft paths must not change CELL without recalculating cols/rows (that left
   * a gray uncovered strip: rows*oldCount * newCell < viewH).
   * @param {{ applyDensity?: boolean }} [opts]
   * @returns {{ changed: boolean, densityChanged: boolean }}
   */
  function syncPerformanceFromConfig(opts) {
    const applyDensity = !opts || opts.applyDensity !== false;
    if (!perfMgr || typeof perfMgr.getRevision !== 'function') {
      effectQuality = 1;
      return { changed: false, densityChanged: false };
    }
    const rev = perfMgr.getRevision();
    if (rev === _perfRev) {
      effectQuality =
        typeof perfMgr.getEffectiveQuality === 'function'
          ? perfMgr.getEffectiveQuality()
          : 1;
      return { changed: false, densityChanged: false };
    }
    _perfRev = rev;
    const nextCell =
      typeof perfMgr.getCellSize === 'function' ? perfMgr.getCellSize() : CELL;
    const densityChanged = nextCell !== CELL;
    if (applyDensity && densityChanged) {
      CELL = nextCell;
      DOT = Math.max(1, CELL - 2);
    }
    effectQuality =
      typeof perfMgr.getEffectiveQuality === 'function'
        ? perfMgr.getEffectiveQuality()
        : 1;
    return { changed: true, densityChanged };
  }

  /**
   * Adopt shared grid geometry (single source of truth with BootField).
   * @param {object} [info]
   */
  function adoptGridInfo(info) {
    if (info && info.cols > 0 && info.rows > 0 && info.cell > 0) {
      CELL = info.cell;
      DOT = Math.max(1, CELL - 2);
      cols = info.cols | 0;
      rows = info.rows | 0;
      viewW = info.viewW > 0 ? info.viewW : viewW;
      viewH = info.viewH > 0 ? info.viewH : viewH;
      if (info.dpr > 0) dpr = info.dpr;
      return;
    }
    const rect = syncStageRect();
    const layout = computeGridLayout(rect.width, rect.height, CELL);
    cols = layout.cols;
    rows = layout.rows;
    viewW = layout.viewW;
    viewH = layout.viewH;
  }

  syncBehaviorFromConfig();
  syncCursorModeFromConfig();
  syncPerformanceFromConfig();

  const ctx = canvas.getContext('2d', { alpha: false });
  let cols = 0;
  let rows = 0;
  let heat = null;
  let ox = null;
  let oy = null;
  let vx = null;
  let vy = null;

  /* Raw pointer vs smoothed field sample — kills snap / stutter */
  let ptrX = -1;
  let ptrY = -1;
  let smX  = -1;
  let smY  = -1;
  let pointerIn = false;
  let running = false;
  let enabled =
    animConfig.motion &&
    resolveActiveBgMode() === 'heat' &&
    !!animConfig.heatEnabled;
  let viewW = 0;
  let viewH = 0;
  let dpr = 1;
  let stageLeft = 0;
  let stageTop  = 0;

  /* Short cursor history in cell-space: newest at index 0.
     Each entry: { x, y, w } — w is relative strength (1 at tip). */
  const trail = [];

  function smoothstep(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t * t * (3 - 2 * t);
  }

  /* Ken Perlin smootherstep — C2 continuous, no harsh shoulders */
  function smootherstep(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function applySurface() {
    canvas.width  = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
    canvas.style.width  = viewW + 'px';
    canvas.style.height = viewH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function syncStageRect() {
    const rect = stage.getBoundingClientRect();
    stageLeft = rect.left;
    stageTop  = rect.top;
    return rect;
  }

  function resize() {
    /* Density rebuild pipeline owns lattice size — do not invent a parallel grid. */
    if (
      pixelField &&
      typeof pixelField.densityChangeLocked === 'function' &&
      pixelField.densityChangeLocked()
    ) {
      const authority =
        typeof pixelField.getDensityAuthority === 'function'
          ? pixelField.getDensityAuthority()
          : null;
      if (authority && authority.cols > 0) {
        adoptGridInfo(authority);
        if (enabled) {
          applySurface();
          paintRest();
          if (pixelField.isActive()) start();
        }
      }
      return;
    }
    const rect = syncStageRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (grid && grid.cell > 0) {
      CELL = grid.cell;
      DOT = Math.max(1, CELL - 2);
    } else if (typeof perfMgr.getCellSize === 'function') {
      CELL = perfMgr.getCellSize();
      DOT = Math.max(1, CELL - 2);
    }
    const layout = computeGridLayout(rect.width, rect.height, CELL);
    const nextCols = layout.cols;
    const nextRows = layout.rows;
    const gridChanged = nextCols !== cols || nextRows !== rows;

    cols = nextCols;
    rows = nextRows;
    viewW = layout.viewW;
    viewH = layout.viewH;
    const n = cols * rows;

    if (gridChanged || !heat) {
      heat  = new Float32Array(n);
      ox    = new Float32Array(n);
      oy    = new Float32Array(n);
      vx    = new Float32Array(n);
      vy    = new Float32Array(n);
      trail.length = 0;
      smX = smY = -1;
    }
    /* Window resize only — density rebuilds boot via PixelDensityChanged. */
    if (gridChanged) pixelField.onResize(cols, rows);

    /* Shared canvas — only claim the surface while Heat is active */
    if (!enabled) return;
    applySurface();
    paintRest();
    if (pixelField.isActive()) start();
  }

  /**
   * Full local rebuild after Pixel Density changes. Always reallocates sim
   * buffers from the authoritative GridInfo — never recomputes cols/rows/cell.
   * @param {object} [info] — shared grid layout from PixelDensityChanged
   */
  function rebuildForDensity(info) {
    syncPerformanceFromConfig({ applyDensity: true });
    if (info && info.cols > 0 && info.rows > 0) {
      adoptGridInfo(info);
    } else if (
      pixelField &&
      typeof pixelField.getDensityAuthority === 'function' &&
      pixelField.getDensityAuthority()
    ) {
      adoptGridInfo(pixelField.getDensityAuthority());
    } else if (grid && typeof grid.getInfo === 'function') {
      adoptGridInfo(grid.getInfo());
    } else {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      adoptGridInfo();
    }
    if (info && info.dpr > 0) dpr = info.dpr;
    else dpr = Math.min(window.devicePixelRatio || 1, 2);
    const n = Math.max(0, cols * rows);

    heat = new Float32Array(n);
    ox = new Float32Array(n);
    oy = new Float32Array(n);
    vx = new Float32Array(n);
    vy = new Float32Array(n);
    trail.length = 0;
    pointerIn = false;
    ptrX = ptrY = -1;
    smX = smY = -1;

    if (!enabled) return;
    applySurface();
    paintRest();
    start();
  }

  function paintRest() {
    const bootMaterialize = bootMaterializeActive();
    /* Boot: ungenerated cells stay black. Density sync: gray panel stays lit. */
    if (bootMaterialize) {
      ctx.fillStyle = '#000000';
    } else {
      ctx.fillStyle = `rgb(${FIELD[0]},${FIELD[1]},${FIELD[2]})`;
    }
    ctx.fillRect(0, 0, viewW, viewH);

    const n = cols * rows;
    for (let i = 0; i < n; i++) {
      const presence =
        typeof pixelField.presence === 'function' ? pixelField.presence(i) : 1;
      if (presence <= 0.001) continue;
      const x = i % cols;
      const y = (i / cols) | 0;
      if (bootMaterialize) {
        /* Permanently initialize this cell's resting Pixel FS background */
        ctx.fillStyle = `rgb(${FIELD[0]},${FIELD[1]},${FIELD[2]})`;
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
      const size = DOT * Math.min(1, 0.35 + presence * 0.65);
      const a = Math.min(1, presence);
      /* Same FIELD → COOL resting formula used during normal operation */
      const r = (FIELD[0] + (COOL[0] - FIELD[0]) * a) | 0;
      const g = (FIELD[1] + (COOL[1] - FIELD[1]) * a) | 0;
      const b = (FIELD[2] + (COOL[2] - FIELD[2]) * a) | 0;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(
        x * CELL + CELL * 0.5 - size * 0.5,
        y * CELL + CELL * 0.5 - size * 0.5,
        size,
        size
      );
    }
  }

  /* Soft Gaussian × smootherstep rim — pressure blooms, never stamps. */
  function falloff(d2, d, radius, sigma) {
    const g = Math.exp(-d2 / (2 * sigma * sigma));
    const edge = smootherstep(1 - d / radius);
    return Math.pow(g * edge, 0.88);
  }

  /* One axis of an overdamped spring — silicone settle, no robotic ease.
     Mutates via return-by-writing into a tiny scratch to avoid GC churn. */
  const _s = { pos: 0, vel: 0 };
  function springAxis(pos, vel, target) {
    const underForce = Math.abs(target) > EPS;
    const k = underForce ? STIFF_PULL : STIFF_RETURN;
    /* Nonlinear drag: calm when slow, firm when fast — no oscillation */
    const drag = DRAG + Math.abs(vel) * DRAG_QUAD;
    vel += (target - pos) * k - vel * drag;
    if (vel >  V_MAX) vel =  V_MAX;
    if (vel < -V_MAX) vel = -V_MAX;
    pos += vel;
    _s.pos = pos;
    _s.vel = vel;
    return _s;
  }

  function rebuildTrailWeights() {
    for (let t = 0; t < trail.length; t++) {
      trail[t].w = Math.pow(TRAIL_DECAY, t);
    }
  }

  /* Advance / age the pressure-wave path from the smoothed cursor.
     Fast moves interpolate along the segment so samples never leave a gap
     wider than TRAIL_MIN_STEP — that gap was the dual-crater bug. */
  function updateTrail(cx, cy, active) {
    if (active) {
      const head = trail[0];
      if (!head) {
        trail.push({ x: cx, y: cy, w: 1 });
      } else {
        const dx = cx - head.x;
        const dy = cy - head.y;
        const dist = Math.hypot(dx, dy);

        if (dist >= TRAIL_MIN_STEP) {
          const x0 = head.x;
          const y0 = head.y;
          const steps = Math.max(1, Math.ceil(dist / TRAIL_MIN_STEP));
          for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            trail.unshift({
              x: x0 + dx * t,
              y: y0 + dy * t,
              w: 1,
            });
          }
          while (trail.length > TRAIL_LENGTH) trail.pop();
        } else {
          /* Keep the tip locked to the live cursor for a fluid leading edge */
          head.x = cx;
          head.y = cy;
        }
      }
      rebuildTrailWeights();
    } else if (trail.length) {
      /* Softly age the wake out — pressure wave dissipates, no hard cut. */
      const fade = TRAIL_FADE;
      for (let t = 0; t < trail.length; t++) {
        trail[t].w *= fade;
      }
      while (trail.length && trail[trail.length - 1].w < TRAIL_FADE_CUT) trail.pop();
    }
  }

  function tick() {
    if (!running || !enabled) {
      running = false;
      return;
    }

    const nowMs = performance.now();
    if (
      perfMgr &&
      typeof perfMgr.beginFrameIfDue === 'function' &&
      !perfMgr.beginFrameIfDue(nowMs)
    ) {
      requestAnimationFrame(tick);
      return;
    }

    syncCursorModeFromConfig();
    /* Adaptive may ease quality between revision bumps — refresh cheaply. */
    if (perfMgr && typeof perfMgr.getEffectiveQuality === 'function') {
      effectQuality = perfMgr.getEffectiveQuality();
    }

    /* Live Settings accent — intro LEDs + cursor heat share this HOT.
       Density teardown / sync stay neutral (COOL) so the rebuild reads as ops. */
    const densityOps = densityOpsActive();
    const HOT = densityOps
      ? COOL
      : [
          animConfig.effectColor.r,
          animConfig.effectColor.g,
          animConfig.effectColor.b,
        ];

    /* Live Settings — brush knobs (defaults match pre-settings V1) */
    const RADIUS =
      Number(animConfig.heatRadius) > 0
        ? Number(animConfig.heatRadius)
        : DEFAULT_RADIUS;
    const SIGMA = RADIUS * SIGMA_RATIO;
    const COLOR_INTENSITY = Number.isFinite(Number(animConfig.heatIntensity))
      ? Number(animConfig.heatIntensity)
      : 0.92;
    /* Effect Quality — soften intensity + slightly faster cool-down when reduced */
    const q = effectQuality;
    const qualityIntensity = COLOR_INTENSITY * (0.55 + 0.45 * q);
    const qualityHeatOut = HEAT_OUT * (1 + (1 - q) * 0.35);
    const bloomStrength = BLOOM_STRENGTH * q;
    const bloomThreshold = BLOOM_THRESHOLD + (1 - q) * 0.12;
    const introAlive = pixelField.update(nowMs);
    const latticeBoot = latticeBootActive();
    const materialize = latticeMaterializeActive();
    const tearingDown = teardownActive();
    const exclusiveBoot = exclusiveBootActive();
    const indicatorAccent = indicatorAccentActive();
    const applyCursorMod =
      cursorMode && typeof cursorMode.applyHeatCursorMode === 'function'
        ? cursorMode.applyHeatCursorMode
        : null;

    /* Adaptive chase — responsive across gaps, velvet up close */
    if (pointerIn) {
      if (smX < 0) {
        smX = ptrX;
        smY = ptrY;
      } else {
        const mdx = ptrX - smX;
        const mdy = ptrY - smY;
        const gap = Math.hypot(mdx, mdy);
        const catchUp = smootherstep(Math.min(1, gap / 90));
        const lerp = MOUSE_NEAR + (MOUSE_FAR - MOUSE_NEAR) * catchUp;
        smX += mdx * lerp;
        smY += mdy * lerp;
      }
    }

    /* Pointer is always tracked; only exclusive boot suppresses heat forces */
    const active = pointerIn && smX >= 0 && !exclusiveBoot;
    if (active) {
      updateTrail(smX / CELL, smY / CELL, true);
    } else {
      updateTrail(0, 0, false);
    }

    const hasTrail = trail.length > 0;

    /* Bounding box around the whole wake so the wave stays one field */
    let x0 = 0;
    let x1 = -1;
    let y0 = 0;
    let y1 = -1;
    if (hasTrail) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let t = 0; t < trail.length; t++) {
        const p = trail[t];
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      x0 = Math.max(0, Math.floor(minX - RADIUS));
      x1 = Math.min(cols - 1, Math.ceil(maxX + RADIUS));
      y0 = Math.max(0, Math.floor(minY - RADIUS));
      y1 = Math.min(rows - 1, Math.ceil(maxY + RADIUS));
    }

    let alive = hasTrail || active || introAlive;
    /* Keep painting while boot / density sync / teardown owns the lattice */
    if (materialize || tearingDown) alive = true;

    /* Boot materialize clears black; density sync / ops keep the gray panel lit. */
    if (bootMaterializeActive()) {
      ctx.fillStyle = '#000000';
    } else {
      ctx.fillStyle = `rgb(${FIELD[0]},${FIELD[1]},${FIELD[2]})`;
    }
    ctx.fillRect(0, 0, viewW, viewH);

    const nCells = cols * rows;
    /* Exclusive boot owns the frame; typography+ composites cursor heat with intro LEDs.
       Teardown gates per-cell via cellInteractive + presence clear. */
    const allowHeat = !exclusiveBoot;
    const freezeMode = activeCursorMode === 'freeze';

    /* Menu Impact phase — resolve once per frame (Space-skip lattice flex) */
    let impactAge = -1;
    let impactPhase = null;
    if (menuImpact && allowHeat) {
      impactAge = nowMs - menuImpact.born;
      const life = menuImpact.compressMs + menuImpact.shockMs;
      if (impactAge < 0) {
        impactPhase = null;
      } else if (impactAge < menuImpact.compressMs) {
        impactPhase = 'compress';
        alive = true;
      } else if (impactAge < life) {
        impactPhase = 'shock';
        alive = true;
      } else {
        menuImpact = null;
        impactPhase = null;
      }
    }

    for (let i = 0; i < nCells; i++) {
      const x = i % cols;
      const y = (i / cols) | 0;

      let targetX = 0;
      let targetY = 0;
      let pressure = 0;
      let heatHold = 1;

      if (allowHeat && hasTrail && x >= x0 && x <= x1 && y >= y0 && y <= y1) {
        let fx = 0;
        let fy = 0;
        /* Soft-OR blend across history — one liquid lobe, not stacked rings */
        let blend = 0;

        for (let t = 0; t < trail.length; t++) {
          const p = trail[t];
          const dx = x + 0.5 - p.x;
          const dy = y + 0.5 - p.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > RADIUS * RADIUS) continue;

          const d = Math.sqrt(d2);
          const f = falloff(d2, d, RADIUS, SIGMA) * p.w;
          if (f < EPS) continue;

          blend = blend + f * (1 - blend);

          if (d > 0.001) {
            const inv = f / d;
            fx += dx * inv;
            fy += dy * inv;
          }
        }

        pressure = blend * qualityIntensity;

        /* Density sync / teardown — interaction only on live cells */
        if (
          typeof pixelField.cellInteractive === 'function' &&
          !pixelField.cellInteractive(i)
        ) {
          pressure = 0;
          fx = 0;
          fy = 0;
        }

        const mag = Math.hypot(fx, fy);
        if (mag > EPS) {
          /* Soft magnitude curve — yield eases in, never clips hard */
          const push = smootherstep(Math.min(1, mag * 1.15)) * MAX_DISP * TRAIL_FORCE;
          if (applyCursorMod) {
            applyCursorMod(
              activeCursorMode,
              {
                fx,
                fy,
                push,
                blend,
                cellIndex: i,
                timeMs: nowMs,
                maxDisp: MAX_DISP,
              },
              _cursorOut
            );
            targetX = _cursorOut.targetX;
            targetY = _cursorOut.targetY;
            heatHold = _cursorOut.heatHold;
          } else {
            targetX = (fx / mag) * push;
            targetY = (fy / mag) * push;
          }
        } else if (freezeMode && blend > 0.02) {
          targetX = 0;
          targetY = 0;
        }
      }

      /* Menu Impact — compress then outward shock through the spring field */
      if (impactPhase && menuImpact) {
        const dx = x - menuImpact.cx;
        const dy = y - menuImpact.cy;
        const dist = Math.hypot(dx, dy);
        const radius = menuImpact.radius;
        if (dist < radius) {
          const inv = dist > 1e-6 ? 1 / dist : 0;
          const nx = dx * inv;
          const ny = dy * inv;
          let w = 1 - dist / radius;
          w *= w;
          if (y < menuImpact.minY) w *= 0.35;
          else if (y > menuImpact.maxY) w *= 1.2;
          if (impactPhase === 'compress') {
            const u = impactAge / menuImpact.compressMs;
            const c = (1 - u) * (1 - u) * w * menuImpact.compressCell;
            targetX += -nx * c;
            targetY += -ny * c;
            if (y >= menuImpact.maxY) targetY += c * 0.4;
          } else {
            const shockAge = impactAge - menuImpact.compressMs;
            const u = shockAge / menuImpact.shockMs;
            const front = u * radius;
            const ring = 1 - Math.min(1, Math.abs(dist - front) / 1.8);
            if (ring > 0) {
              const fade = (1 - u) * (1 - u);
              const s = ring * ring * fade * w * menuImpact.shockCell;
              targetX += nx * s;
              targetY += ny * s;
            }
          }
        }
      }

      /* Color follows pressure — ease both ways, no stepped tint */
      const h = heat[i];
      if (allowHeat) {
        const outRate = qualityHeatOut * heatHold;
        if (pressure > h) {
          heat[i] = h + (pressure - h) * HEAT_IN;
        } else {
          heat[i] = h + (0 - h) * outRate;
          if (heat[i] < EPS) heat[i] = 0;
        }
      } else if (heat[i] !== 0) {
        heat[i] = 0;
      }

      /* Spring-damper: pressure displaces, then soft fabric return to rest */
      if (allowHeat) {
        if (freezeMode && pressure > 0.02) {
          /* Stabilize under cursor — kill velocity, ease toward rest */
          springAxis(ox[i], vx[i] * 0.35, 0);
          ox[i] = _s.pos; vx[i] = _s.vel * 0.4;
          springAxis(oy[i], vy[i] * 0.35, 0);
          oy[i] = _s.pos; vy[i] = _s.vel * 0.4;
        } else {
          springAxis(ox[i], vx[i], targetX);
          ox[i] = _s.pos; vx[i] = _s.vel;
          springAxis(oy[i], vy[i], targetY);
          oy[i] = _s.pos; vy[i] = _s.vel;
        }
      } else {
        ox[i] = oy[i] = vx[i] = vy[i] = 0;
      }

      const introHv = pixelField.brightness(i);
      const introDX = latticeBoot && indicatorAccent ? 0 : pixelField.offsetX(i);
      const introDY = latticeBoot && indicatorAccent ? 0 : pixelField.offsetY(i);
      const introDrift = introDX !== 0 || introDY !== 0;
      const presence =
        typeof pixelField.presence === 'function' ? pixelField.presence(i) : 1;

      /* Teardown wave — retire sim the moment the cell drops out of interaction */
      if (
        tearingDown &&
        typeof pixelField.cellInteractive === 'function' &&
        !pixelField.cellInteractive(i)
      ) {
        heat[i] = 0;
        ox[i] = oy[i] = vx[i] = vy[i] = 0;
      }

      /* Retired / ungenerated cells — clear sim and reveal the panel beneath */
      if (presence <= 0.001) {
        heat[i] = 0;
        ox[i] = oy[i] = vx[i] = vy[i] = 0;
        if (introHv <= 0 && !introDrift) continue;
      }

      /* Microscopic sleep only — never hard-stop a visible settle */
      if (
        !hasTrail &&
        !active &&
        introHv === 0 &&
        heat[i] === 0 &&
        Math.abs(ox[i]) < EPS &&
        Math.abs(oy[i]) < EPS &&
        Math.abs(vx[i]) < EPS &&
        Math.abs(vy[i]) < EPS
      ) {
        ox[i] = oy[i] = vx[i] = vy[i] = 0;
      } else if (
        heat[i] > 0 ||
        introHv > 0 ||
        presence < 0.999 ||
        Math.abs(ox[i]) > EPS ||
        Math.abs(oy[i]) > EPS ||
        Math.abs(vx[i]) > EPS ||
        Math.abs(vy[i]) > EPS
      ) {
        alive = true;
      }

      /*
        Shared BootField presence drives the live Pixel FS:
        - Boot: each generated cell initializes FIELD bg + FIELD→COOL dots
        - Indicator: boot brightness tints with BOOT_RED
        - Density teardown / sync: neutral COOL lift only (no Settings RGB)
        - Intro+: Settings HOT tints LED brightness on the same resting lattice
      */
      const bootSignal = indicatorAccent ? introHv : 0;
      const typeSignal = indicatorAccent ? 0 : introHv;
      /* Intro LEDs share the same energy→tint path as cursor heat (Settings HOT) */
      let hv = Math.max(heat[i], introDrift ? 0 : bootSignal);
      if (!introDrift && typeSignal > hv) hv = typeSignal;
      const accent = indicatorAccent ? BOOT_RED : HOT;
      const eased = hv * hv * (3 - 2 * hv);
      const tint  = Math.min(1, Math.pow(eased, COLOR_FALLOFF) * GLOW_OPACITY);

      /* Depth from pressure + displacement — pressed centre, calm rim */
      const disp = Math.min(1, Math.hypot(ox[i], oy[i]) / (MAX_DISP + EPS));
      const depth = Math.min(1, heat[i] * 0.5 + disp * 0.45);
      const scale = 1 - smootherstep(depth) * 0.24;
      const presenceScale = materialize
        ? Math.min(1, 0.55 + Math.max(presence, typeSignal) * 0.45)
        : Math.min(1, 0.35 + presence * 0.65);
      const size  = DOT * scale * presenceScale * (1 + (heat[i] > 0 ? tint * GLOW_SIZE : 0));

      const homeX = x * CELL + CELL * 0.5 + ox[i] * CELL;
      const homeY = y * CELL + CELL * 0.5 + oy[i] * CELL;
      const cx = homeX + introDX;
      const cy = homeY + introDY;

      /* Claim resting FIELD background only while boot paints over black.
         Density sync already clears to gray — pixels materialize on top. */
      if (bootMaterializeActive() && presence > 0.001) {
        ctx.fillStyle = `rgb(${FIELD[0]},${FIELD[1]},${FIELD[2]})`;
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }

      /* While a glyph LED drifts away, restore the idle resting dot at home.
         Sub-pixel lattice nudges (Menu Impact compress/reverb) move in place. */
      if (
        introDrift &&
        Math.hypot(introDX, introDY) > 2.5 &&
        heat[i] < EPS &&
        presence > 0.001
      ) {
        const pr = (FIELD[0] + (COOL[0] - FIELD[0]) * presence) | 0;
        const pg = (FIELD[1] + (COOL[1] - FIELD[1]) * presence) | 0;
        const pb = (FIELD[2] + (COOL[2] - FIELD[2]) * presence) | 0;
        ctx.fillStyle = `rgb(${pr},${pg},${pb})`;
        ctx.fillRect(homeX - DOT * 0.5 * presenceScale, homeY - DOT * 0.5 * presenceScale, DOT * presenceScale, DOT * presenceScale);
      }

      /* Faint feathered bloom — warm light through frosted glass.
         Driven by tint so it dissolves with the heat field. */
      const drawTint = introDrift
        ? Math.min(1, Math.pow(typeSignal * typeSignal * (3 - 2 * typeSignal), COLOR_FALLOFF) * GLOW_OPACITY)
        : tint;

      if (q > 0.08 && drawTint > bloomThreshold && (indicatorAccent || typeSignal > 0.001 || heat[i] > EPS)) {
        const bloom = smootherstep(
          (drawTint - bloomThreshold) / (1 - bloomThreshold)
        );
        const br = (accent[0] + (255 - accent[0]) * 0.58) | 0;
        const bg = (accent[1] + (255 - accent[1]) * 0.58) | 0;
        const bb = (accent[2] + (255 - accent[2]) * 0.58) | 0;
        const bloomGain = indicatorAccent ? 0.85 : 1;
        const aOuter = bloom * bloomStrength * 0.32 * bloomGain;
        const aInner = bloom * bloomStrength * 0.55 * bloomGain;
        const sOuter = size + DOT * BLOOM_SPREAD * 0.75;
        const sInner = size + DOT * BLOOM_SPREAD * 0.35;

        ctx.fillStyle = `rgba(${br},${bg},${bb},${aOuter})`;
        ctx.fillRect(cx - sOuter * 0.5, cy - sOuter * 0.5, sOuter, sOuter);
        ctx.fillStyle = `rgba(${br},${bg},${bb},${aInner})`;
        ctx.fillRect(cx - sInner * 0.5, cy - sInner * 0.5, sInner, sInner);
      }

      /* Boot + intro + ops: FIELD → COOL → accent (BOOT_RED / neutral COOL / Settings HOT) */
      let r = FIELD[0] + (COOL[0] - FIELD[0]) * Math.min(1, presence);
      let g = FIELD[1] + (COOL[1] - FIELD[1]) * Math.min(1, presence);
      let b = FIELD[2] + (COOL[2] - FIELD[2]) * Math.min(1, presence);
      r = r + (accent[0] - r) * drawTint;
      g = g + (accent[1] - g) * drawTint;
      b = b + (accent[2] - b) * drawTint;
      if (drawTint > 0) {
        const lift = drawTint * BLOOM_BRIGHTNESS;
        r += (255 - r) * lift;
        g += (248 - g) * lift;
        b += (250 - b) * lift;
      }

      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.fillRect(cx - size * 0.5, cy - size * 0.5, size, size);
    }

    if (perfMgr && typeof perfMgr.endFrame === 'function') {
      perfMgr.endFrame(performance.now());
    }

    if (alive) {
      requestAnimationFrame(tick);
    } else {
      running = false;
      smX = smY = -1;
      trail.length = 0;
      paintRest();
    }
  }

  function start() {
    if (!enabled || running) return;
    running = true;
    requestAnimationFrame(tick);
  }

  function setEnabled(on) {
    on = !!on;
    if (enabled === on) {
      if (on && !running && pixelField.isActive()) start();
      return;
    }
    enabled = on;
    if (!enabled) {
      /* Keep pixelField running across Heat ↔ Wave ↔ Lightning switches */
      pointerIn = false;
      ptrX = ptrY = -1;
      smX = smY = -1;
      trail.length = 0;
      menuImpact = null;
      if (heat) {
        heat.fill(0);
        ox.fill(0);
        oy.fill(0);
        vx.fill(0);
        vy.fill(0);
      }
      running = false;
      /* Still on Heat style but effect toggled off — show resting field */
      if (resolveActiveBgMode() === 'heat' && viewW) {
        applySurface();
        paintRest();
      }
      return;
    }
    /* Reclaim shared canvas when returning to Heat */
    if (viewW) {
      applySurface();
      paintRest();
    } else {
      resize();
    }
    if (pixelField.isActive()) start();
  }

  function heatShouldRun(mode) {
    const active = mode !== undefined ? mode : resolveActiveBgMode();
    return active === 'heat' && !!animConfig.heatEnabled;
  }

  window.addEventListener('bgmodechange', (e) => {
    const mode = e.detail && e.detail.mode;
    setEnabled(heatShouldRun(mode));
    if (mode == null) pixelField.cancel();
  });

  window.addEventListener('pixelintrostart', () => {
    if (enabled) start();
  });

  window.addEventListener('pixeldirectorystart', () => {
    if (enabled) start();
  });

  window.addEventListener('pixelmenuimpact', (e) => {
    if (!enabled || !ox) return;
    const d = e.detail || {};
    const cell = CELL > 0 ? CELL : 1;
    menuImpact = {
      cx: d.cx || 0,
      cy: d.cy || 0,
      minY: d.minY || 0,
      maxY: d.maxY || 0,
      radius: d.radius > 0 ? d.radius : 5.5,
      compressMs: d.compressMs > 0 ? d.compressMs : 36,
      shockMs: d.shockMs > 0 ? d.shockMs : 150,
      /* Convert CSS-px intent into Heat cell-fraction targets */
      compressCell: Math.min(MAX_DISP * 0.95, (d.compressPx || 1.85) / cell),
      shockCell: Math.min(MAX_DISP * 1.05, (d.shockPx || 2.1) / cell),
      born: performance.now(),
    };
    start();
  });

  window.addEventListener('pixelbootready', () => {
    if (enabled) start();
  });

  window.addEventListener('animconfigchange', (e) => {
    /* Soft behavior / quality / FPS — density rebuild is PixelDensityChanged.
       Never apply a new CELL here without remounting cols/rows. */
    if (e.detail && e.detail.soft) {
      syncBehaviorFromConfig();
      syncCursorModeFromConfig();
      syncPerformanceFromConfig({ applyDensity: false });
      /* Keep the field painting while preset morphs (color / heat knobs). */
      if (enabled) start();
      return;
    }
    syncPerformanceFromConfig({ applyDensity: false });
    setEnabled(heatShouldRun());
    if (enabled) start();
  });

  if (events && typeof events.on === 'function') {
    events.on(PixelEvents.PixelDensityChanged, (info) => {
      rebuildForDensity(info);
    });
  }

  window.addEventListener('resize', resize, { passive: true });
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => resize());
    ro.observe(stage);
  }

  /* Shared InteractionManager pointer stream — always sample; heat application
     is gated in tick via exclusiveBoot only (intro does not pause tracking). */
  function applyPointerSample(x, y, inside) {
    if (!enabled) return;
    if (inside) {
      if (pointerIn && ptrX === x && ptrY === y) return;
      ptrX = x;
      ptrY = y;
      pointerIn = true;
      start();
    } else if (pointerIn) {
      pointerIn = false;
      ptrX = ptrY = -1;
      start(); /* springs ease the field back to rest */
    }
  }

  if (events && typeof events.on === 'function') {
    events.on(PixelEvents.MouseMoved, (p) => {
      applyPointerSample(p.x, p.y, !!p.inside);
    });
    events.on(PixelEvents.PointerLeft, () => {
      applyPointerSample(-1, -1, false);
    });
  } else {
    document.addEventListener('mousemove', (e) => {
      if (!enabled) return;
      syncStageRect();
      const x = e.clientX - stageLeft;
      const y = e.clientY - stageTop;
      const inside = x >= 0 && y >= 0
        && x <= ((grid && grid.hitW > 0) ? grid.hitW : viewW)
        && y <= ((grid && grid.hitH > 0) ? grid.hitH : viewH);
      applyPointerSample(x, y, inside);
    }, { passive: true });

    document.documentElement.addEventListener('mouseleave', () => {
      applyPointerSample(-1, -1, false);
    });
  }

  resize();
  pixelIntro.schedule();

  return {
    id: 'heat',
    implemented: true,
    /** Live Pixel Behavior values applied by this mode. */
    getPixelBehavior: () => ({
      reactionStrength: MAX_DISP,
      movementSpeed: STIFF_PULL,
      decaySpeed: HEAT_OUT,
      trailLifetime: TRAIL_FADE,
    }),
    mount() {},
    destroy() {},
  };
}
