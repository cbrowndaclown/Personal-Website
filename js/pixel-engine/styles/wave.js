/* Pixel FS — Wave. V1 simulation preserved. */

import { PixelEvents } from '../constants.js';
import { computeGridLayout } from '../grid-manager.js';

/**
 * @param {object} deps
 */
export function createWaveStyle(deps) {
  const canvas = deps.canvas;
  const stage = deps.stage;
  const animConfig = deps.animConfig;
  const resolveActiveBgMode = deps.resolveActiveBgMode;
  const pixelBehavior = deps.pixelBehavior;
  const cursorMode = deps.cursorMode;
  const perfMgr = deps.performance;
  const pixelField = deps.pixelField;
  const events = deps.events;
  const grid = deps.grid;
  if (!canvas || !stage) {
    return { id: 'wave', implemented: true, mount() {}, destroy() {} };
  }

  /* Live via Performance → Pixel Density (default preserves V1 CELL=5). */
  let CELL = (perfMgr && typeof perfMgr.getCellSize === 'function')
    ? perfMgr.getCellSize()
    : 5;
  let DOT = Math.max(1, CELL - 2);
  const FIELD = [210, 210, 210];
  const COOL  = [255, 255, 255];
  const EPS   = 0.00045;
  let _perfRev = -1;
  let effectQuality = 1;

  /* Shared Pixel Behavior → Wave lattice. Defaults match V1 exactly
     (scale = 1 at PIXEL_BEHAVIOR_DEFAULTS). Remap only when revision advances. */
  const BEHAVIOR_DEFAULTS =
    (pixelBehavior && pixelBehavior.defaults) ||
    Object.freeze({
      reactionStrength: 0.4,
      movementSpeed: 0.078,
      returnSpeed: 0.026,
      trailLifetime: 0.965,
    });
  const BEHAVIOR_TRAIL_RANGE = Object.freeze({ min: 0.85, max: 0.995 });
  const behavior =
    (pixelBehavior && pixelBehavior.values) ||
    {
      reactionStrength: BEHAVIOR_DEFAULTS.reactionStrength,
      movementSpeed: BEHAVIOR_DEFAULTS.movementSpeed,
      returnSpeed: BEHAVIOR_DEFAULTS.returnSpeed,
      trailLifetime: BEHAVIOR_DEFAULTS.trailLifetime,
    };

  /* ── Lattice / ripple baselines (pre-settings V1) ───────────────────────
     Hand-through-water wake: broader inject, velocity-scaled, still settles. */
  const BASE_ENERGY_INJECT = 0.24; /* stronger push into the membrane */
  const BASE_TENSION       = 0.084; /* faster neighbor spread — wake fills out */
  const BASE_REST_K        = 0.007; /* persistence before calm */
  const BASE_DAMPING       = 0.022; /* smooth fade to a static rest */
  const V_MAX              = 0.52;  /* headroom for energetic wakes */
  const U_MAX              = 1.55;  /* crest ceiling */
  const BASE_DISP_PX       = 2.95;  /* visual travel */
  const SIZE_RESP          = 0.22;  /* crest scale */

  /* Trail Lifetime → damping: short trails die fast, long trails linger.
     Anchored so default trail (0.965) → BASE_DAMPING exactly. */
  const DAMP_AT_TRAIL_MIN = 0.055;
  const DAMP_AT_TRAIL_MAX = 0.008;

  let ENERGY_INJECT = BASE_ENERGY_INJECT;
  let TENSION = BASE_TENSION;
  let REST_K = BASE_REST_K;
  let DAMPING = BASE_DAMPING;
  let DISP_PX = BASE_DISP_PX;
  let _behaviorRev = -1;
  let _cursorModeRev = -1;
  let activeCursorMode = 'standard';
  let cursorInject = {
    sign: 1,
    radial: 0,
    radialAmp: 0,
    jitter: 0,
    turbulence: 0,
    skip: false,
    dampScale: 1,
    freezeHold: false,
    paintTrail: false,
  };

  /* Paint mode — lingering wake samples aged by Trail Lifetime */
  const PAINT_TRAIL_MAX = 18;
  const PAINT_TRAIL_STEP = 0.55;
  const paintTrail = [];

  function remapTrailToDamping(trail) {
    const tMin = BEHAVIOR_TRAIL_RANGE.min;
    const tMax = BEHAVIOR_TRAIL_RANGE.max;
    const tDef = BEHAVIOR_DEFAULTS.trailLifetime;
    const v = Number(trail);
    if (!Number.isFinite(v) || v <= tMin) return DAMP_AT_TRAIL_MIN;
    if (v >= tMax) return DAMP_AT_TRAIL_MAX;
    if (v === tDef) return BASE_DAMPING;
    if (v < tDef) {
      const span = tDef - tMin;
      const t = span > 0 ? (v - tMin) / span : 1;
      return DAMP_AT_TRAIL_MIN + (BASE_DAMPING - DAMP_AT_TRAIL_MIN) * t;
    }
    const span = tMax - tDef;
    const t = span > 0 ? (v - tDef) / span : 1;
    return BASE_DAMPING + (DAMP_AT_TRAIL_MAX - BASE_DAMPING) * t;
  }

  /**
   * Map shared Pixel Behavior → live Wave physics.
   * Uses cached scales from the shared layer; trail remap stays Wave-local.
   * @returns {boolean} true when lattice constants changed
   */
  function applyBehaviorToWave() {
    const rev = pixelBehavior ? pixelBehavior.getRevision() : 0;
    if (rev === _behaviorRev) return false;
    _behaviorRev = rev;

    const sc = (pixelBehavior && pixelBehavior.scales) || {
      reaction: 1,
      movement: 1,
      return: 1,
    };
    ENERGY_INJECT = BASE_ENERGY_INJECT * sc.reaction;
    DISP_PX = BASE_DISP_PX * sc.reaction;
    TENSION = BASE_TENSION * sc.movement;
    REST_K = BASE_REST_K * sc.return;
    DAMPING = remapTrailToDamping(behavior.trailLifetime);
    return true;
  }

  function syncBehaviorFromConfig() {
    /* Shared layer already synced on AnimConfigChange — only apply locally. */
    return applyBehaviorToWave();
  }

  function syncCursorModeFromConfig() {
    if (!cursorMode) {
      activeCursorMode = 'standard';
      cursorInject = {
        sign: 1,
        radial: 0,
        radialAmp: 0,
        jitter: 0,
        turbulence: 0,
        skip: false,
        dampScale: 1,
        freezeHold: false,
        paintTrail: false,
      };
      return false;
    }
    const rev = cursorMode.getRevision();
    if (rev === _cursorModeRev) return false;
    _cursorModeRev = rev;
    activeCursorMode = cursorMode.get();
    cursorInject =
      typeof cursorMode.waveCursorInject === 'function'
        ? cursorMode.waveCursorInject(activeCursorMode)
        : {
            sign: 1,
            radial: 0,
            radialAmp: 0,
            jitter: 0,
            turbulence: 0,
            skip: false,
            dampScale: 1,
            freezeHold: false,
            paintTrail: false,
          };
    if (!cursorInject.paintTrail) paintTrail.length = 0;
    return true;
  }

  /**
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

  /* Cursor wake — soft brush, width scales with movement speed */
  const WAKE_RADIUS   = 4.0;   /* base influence in cells (~60%+ wider than a point) */
  const WAKE_SPEED_PX = 38;    /* movement (px/event) that reads as “fast” */
  const WAKE_SPEED_MAX = 120;  /* clamp — kills teleport / jitter spikes */

  /* Effect color shared with Heat via animConfig.effectColor */
  const COLOR_FALLOFF = 0.72;
  const BLOOM_STRENGTH   = 0.14;
  const BLOOM_SPREAD     = 1.45;
  const BLOOM_BRIGHTNESS = 0.18;
  const BLOOM_THRESHOLD  = 0.06;

  /* ── Shoreline edges ───────────────────────────────────────────────────
     Absorb most energy, return a faint soft reflection — not a mirror wall. */
  const EDGE_WIDTH   = 12;    /* cells of gradual shoreline influence */
  const EDGE_ABSORB  = 0.78;  /* how strongly the rim drinks energy */
  const EDGE_REFLECT = 0.16;  /* weak inverted ghost beyond the rim */
  const EDGE_SINK    = 0.035; /* extra rest pull as waves meet the shore */

  const ctx = canvas.getContext('2d', { alpha: false });
  let cols = 0;
  let rows = 0;
  let u = null; /* displacement (height) */
  let v = null; /* velocity (energy) */
  let viewW = 0;
  let viewH = 0;
  let dpr = 1;
  let enabled = animConfig.motion && resolveActiveBgMode() === 'wave';
  let running = false;
  let lastPtrX = -1;
  let lastPtrY = -1;
  let stageLeft = 0;
  let stageTop  = 0;

  function softClamp(x, limit) {
    if (x >  limit) return  limit;
    if (x < -limit) return -limit;
    return x;
  }

  function smoothstep(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t * t * (3 - 2 * t);
  }

  /* 0 in the open field → 1 at the outer rim (smooth, no hard shelf). */
  function shoreFactor(x, y) {
    const d = Math.min(x, y, cols - 1 - x, rows - 1 - y);
    if (d >= EDGE_WIDTH) return 0;
    const t = 1 - d / EDGE_WIDTH;
    return t * t * (3 - 2 * t);
  }

  function applySurface() {
    canvas.width  = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
    canvas.style.width  = viewW + 'px';
    canvas.style.height = viewH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function paintRest() {
    /* Density sync generates over the powered gray panel — never a black cut. */
    ctx.fillStyle = `rgb(${FIELD[0]},${FIELD[1]},${FIELD[2]})`;
    ctx.fillRect(0, 0, viewW, viewH);

    const n = cols * rows;
    for (let i = 0; i < n; i++) {
      const presence =
        typeof pixelField.presence === 'function' ? pixelField.presence(i) : 1;
      if (presence <= 0.001) continue;
      const x = i % cols;
      const y = (i / cols) | 0;
      const size = DOT * Math.min(1, 0.35 + presence * 0.65);
      const a = Math.min(1, presence);
      const r = (FIELD[0] + (COOL[0] - FIELD[0]) * a) | 0;
      const g = (FIELD[1] + (COOL[1] - FIELD[1]) * a) | 0;
      const b = (FIELD[2] + (COOL[2] - FIELD[2]) * a) | 0;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(
        x * CELL + CELL * 0.5 - size * 0.5,
        y * CELL + CELL * 0.5 - size * 0.5,
        size,
        size,
      );
    }
  }

  /** Density teardown / sync — neutral system colors only (no Settings RGB). */
  function densityOpsActive() {
    if (typeof pixelField.densityOpsActive === 'function') {
      return pixelField.densityOpsActive();
    }
    return (
      (typeof pixelField.teardownActive === 'function' &&
        pixelField.teardownActive()) ||
      (typeof pixelField.recalibrationActive === 'function' &&
        pixelField.recalibrationActive())
    );
  }

  function syncStageRect() {
    const rect = stage.getBoundingClientRect();
    stageLeft = rect.left;
    stageTop  = rect.top;
    return rect;
  }

  function resize() {
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
    if (gridChanged || !u) {
      u = new Float32Array(n);
      v = new Float32Array(n);
      lastPtrX = lastPtrY = -1;
      paintTrail.length = 0;
    }
    /* Window resize only — density rebuilds boot via PixelDensityChanged. */
    if (gridChanged) pixelField.onResize(cols, rows);

    if (!enabled) return;
    applySurface();
    paintRest();
    if (pixelField.isActive()) start();
  }

  /**
   * Full local rebuild after Pixel Density — always reallocate from authority.
   * @param {object} [info]
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
      adoptGridInfo();
    }
    if (info && info.dpr > 0) dpr = info.dpr;
    else dpr = Math.min(window.devicePixelRatio || 1, 2);
    const n = Math.max(0, cols * rows);

    u = new Float32Array(n);
    v = new Float32Array(n);
    lastPtrX = lastPtrY = -1;
    paintTrail.length = 0;

    if (!enabled) return;
    applySurface();
    paintRest();
    start();
  }

  /* Soft wake brush — hand through water; Cursor Mode reshapes the membrane
     (radial converge/diverge, turbulence, paint trail) without a second loop. */
  function injectAt(localX, localY) {
    if (!v || !cols) return;
    syncCursorModeFromConfig();

    /* Density recalibration — only disturb cells the sync wave has claimed */
    if (typeof pixelField.cellInteractive === 'function') {
      const cx = Math.min(cols - 1, Math.max(0, (localX / CELL) | 0));
      const cy = Math.min(rows - 1, Math.max(0, (localY / CELL) | 0));
      if (!pixelField.cellInteractive(cy * cols + cx)) {
        lastPtrX = localX;
        lastPtrY = localY;
        start();
        return;
      }
    }

    let speed = 0;
    if (lastPtrX >= 0) {
      speed = Math.hypot(localX - lastPtrX, localY - lastPtrY);
      if (speed > WAKE_SPEED_MAX) {
        lastPtrX = localX;
        lastPtrY = localY;
        return;
      }
    }
    lastPtrX = localX;
    lastPtrY = localY;

    if (cursorInject.paintTrail) {
      pushPaintSample(localX / CELL, localY / CELL);
    }

    if (cursorInject.skip) {
      start();
      return;
    }

    const speedT = smoothstep(Math.min(1, speed / WAKE_SPEED_PX));
    const strength = 0.32 + speedT * 1.25;
    const radius = WAKE_RADIUS * (1 + speedT * 0.65) *
      (cursorInject.radial !== 0 ? 1.35 : 1);
    applyWaveBrush(localX / CELL, localY / CELL, radius, strength, 1);
    start();
  }

  function pushPaintSample(cx, cy) {
    const head = paintTrail[0];
    if (!head) {
      paintTrail.push({ x: cx, y: cy, w: 1 });
      return;
    }
    const dist = Math.hypot(cx - head.x, cy - head.y);
    if (dist < PAINT_TRAIL_STEP * 0.45) {
      head.x = cx;
      head.y = cy;
      head.w = 1;
      return;
    }
    const steps = Math.max(1, Math.ceil(dist / PAINT_TRAIL_STEP));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      paintTrail.unshift({
        x: head.x + (cx - head.x) * t,
        y: head.y + (cy - head.y) * t,
        w: 1,
      });
    }
    while (paintTrail.length > PAINT_TRAIL_MAX) paintTrail.pop();
  }

  function agePaintTrail() {
    if (!paintTrail.length) return;
    const fade = Math.min(0.995, behavior.trailLifetime);
    for (let t = 0; t < paintTrail.length; t++) {
      paintTrail[t].w *= fade;
    }
    while (paintTrail.length && paintTrail[paintTrail.length - 1].w < 0.03) {
      paintTrail.pop();
    }
  }

  /**
   * Apply Cursor Mode wake into the velocity field around a cell-space point.
   * @param {number} fx
   * @param {number} fy
   * @param {number} radius
   * @param {number} strength
   * @param {number} weight
   */
  function applyWaveBrush(fx, fy, radius, strength, weight) {
    if (!v || weight < 0.02) return;
    const x0 = Math.max(0, Math.floor(fx - radius));
    const x1 = Math.min(cols - 1, Math.ceil(fx + radius));
    const y0 = Math.max(0, Math.floor(fy - radius));
    const y1 = Math.min(rows - 1, Math.ceil(fy + radius));
    const r2 = radius * radius;
    const sign = cursorInject.sign;
    const radial = cursorInject.radial;
    const radialAmp = cursorInject.radialAmp * ENERGY_INJECT * strength * weight;
    const jitter = cursorInject.jitter;
    const turb = cursorInject.turbulence;

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - fx;
        const dy = y + 0.5 - fy;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;

        const d = Math.sqrt(d2);
        const fall = smoothstep(1 - d / radius);
        const i = y * cols + x;
        let impulse = ENERGY_INJECT * strength * fall * sign * weight;

        if (jitter > 0 || turb > 0) {
          const n =
            Math.sin((x * 19.1 + y * 7.3) * 12.9898 + fx * 0.11 + fy * 0.07) *
            43758.5453;
          const j = (n - Math.floor(n)) * 2 - 1;
          if (jitter > 0) impulse *= 1 + j * jitter;
          if (turb > 0) {
            /* Broken fronts — signed interference, not a clean ripple */
            const n2 =
              Math.sin((x * 3.7 - y * 11.2) * 7.13 + fy * 0.19) * 43758.5453;
            const j2 = (n2 - Math.floor(n2)) * 2 - 1;
            impulse += ENERGY_INJECT * strength * fall * weight * j2 * turb * 0.85;
            if (d > 0.001) {
              const tx = -dy / d;
              const ty = dx / d;
              const kick = ENERGY_INJECT * strength * fall * weight * j * turb * 0.55;
              /* Tangential kick via height coupling — shear the crest */
              impulse += kick * (tx * 0.35 + ty * 0.35);
            }
          }
        }

        if (radial !== 0 && d > 0.001) {
          /* Converge (attract) or diverge (repel) — reshapes existing waves */
          const inv = (radial * radialAmp * fall) / d;
          const radialKick = (dx * inv + dy * inv) * 0.5;
          impulse += radialKick;
          /* Soft height bend so crests visibly lean toward / away from cursor */
          u[i] = softClamp(u[i] + radialKick * 0.12 * weight, U_MAX);
        }

        if (Math.abs(impulse) < EPS) continue;
        v[i] = softClamp(v[i] + impulse, V_MAX);
      }
    }
  }

  /* Interior: live height. Outside: weak inverted ghost — soft shoreline echo. */
  function heightAt(x, y) {
    if (x >= 0 && y >= 0 && x < cols && y < rows) {
      return u[y * cols + x];
    }
    const bx = x < 0 ? 0 : x >= cols ? cols - 1 : x;
    const by = y < 0 ? 0 : y >= rows ? rows - 1 : y;
    return -EDGE_REFLECT * u[by * cols + bx];
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
    if (perfMgr && typeof perfMgr.getEffectiveQuality === 'function') {
      effectQuality = perfMgr.getEffectiveQuality();
    }
    const q = effectQuality;
    const bloomStrength = BLOOM_STRENGTH * q;
    const bloomThreshold = BLOOM_THRESHOLD + (1 - q) * 0.1;
    const useDiagonals = q >= 0.45;

    /* Density teardown / sync stay neutral so rebuild reads as system ops. */
    const HOT = densityOpsActive()
      ? COOL
      : [
          animConfig.effectColor.r,
          animConfig.effectColor.g,
          animConfig.effectColor.b,
        ];

    const introAlive = pixelField.update(nowMs);
    const n = cols * rows;
    let alive = !!introAlive;
    if (
      typeof pixelField.recalibrationActive === 'function' &&
      pixelField.recalibrationActive()
    ) {
      alive = true;
    }
    if (
      typeof pixelField.teardownActive === 'function' &&
      pixelField.teardownActive()
    ) {
      alive = true;
    }
    const dampScale = cursorInject.dampScale;
    const hasPtr = lastPtrX >= 0 && lastPtrY >= 0;
    const ptrFx = hasPtr ? lastPtrX / CELL : 0;
    const ptrFy = hasPtr ? lastPtrY / CELL : 0;
    const fieldR = WAKE_RADIUS * (cursorInject.radial !== 0 || cursorInject.turbulence > 0 || cursorInject.freezeHold ? 2.1 : 1.4);
    const fieldR2 = fieldR * fieldR;
    const freezeHold = cursorInject.freezeHold && hasPtr;

    /* Continuous Cursor Mode field — works while cursor is still */
    if (hasPtr && !cursorInject.skip && (cursorInject.radial !== 0 || cursorInject.turbulence > 0)) {
      applyWaveBrush(ptrFx, ptrFy, fieldR, 0.42, 0.16);
      alive = true;
    }

    /* Paint trail — lingering disturbances aged by Trail Lifetime */
    if (cursorInject.paintTrail) {
      agePaintTrail();
      for (let t = 0; t < paintTrail.length; t++) {
        const p = paintTrail[t];
        applyWaveBrush(p.x, p.y, WAKE_RADIUS * 1.05, 0.4, p.w * 0.28);
      }
      if (paintTrail.length) alive = true;
    }

    /* Pass 1 — neighbor exchange (4-way + soft diagonals), shoreline damp */
    for (let i = 0; i < n; i++) {
      const x = i % cols;
      const y = (i / cols) | 0;
      const ui = u[i];
      const shore = shoreFactor(x, y);

      let inFreeze = false;
      if (freezeHold) {
        const dx = x + 0.5 - ptrFx;
        const dy = y + 0.5 - ptrFy;
        inFreeze = dx * dx + dy * dy <= fieldR2;
      }

      if (inFreeze) {
        /* Local pause — settle velocity; hold displacement while under cursor */
        v[i] *= 0.18;
        if (Math.abs(v[i]) < EPS) v[i] = 0;
        alive = true;
        continue;
      }

      /* Cardinal + half-weight diagonals → broader, more continuous ripples */
      const lap = useDiagonals
        ? heightAt(x - 1, y) +
          heightAt(x + 1, y) +
          heightAt(x, y - 1) +
          heightAt(x, y + 1) +
          0.5 * (
            heightAt(x - 1, y - 1) +
            heightAt(x + 1, y - 1) +
            heightAt(x - 1, y + 1) +
            heightAt(x + 1, y + 1)
          ) -
          6 * ui
        : heightAt(x - 1, y) +
          heightAt(x + 1, y) +
          heightAt(x, y - 1) +
          heightAt(x, y + 1) -
          4 * ui;

      /* Rim drinks most of the energy; a little returns via ghost reflection */
      let damp = (DAMPING + EDGE_ABSORB * shore * 0.10) * dampScale;
      const rest = REST_K + EDGE_SINK * shore;

      let vel = v[i];
      vel += TENSION * lap - rest * ui - damp * vel;
      /* Extra shoreline drag — waves wash out instead of bouncing hard */
      if (shore > 0) {
        vel *= 1 - EDGE_ABSORB * shore * 0.045;
      }
      vel = softClamp(vel, V_MAX);
      v[i] = vel;
    }

    /* Pass 2 — integrate displacement, then paint.
       Density sync keeps the gray backlit panel; pixels rise over it. */
    const densitySync =
      typeof pixelField.recalibrationActive === 'function' &&
      pixelField.recalibrationActive();
    ctx.fillStyle = `rgb(${FIELD[0]},${FIELD[1]},${FIELD[2]})`;
    ctx.fillRect(0, 0, viewW, viewH);

    const invU = 1 / (U_MAX * 0.72);
    const invV = 1 / (V_MAX * 1.15);

    for (let i = 0; i < n; i++) {
      const x = i % cols;
      const y = (i / cols) | 0;
      const shore = shoreFactor(x, y);

      let inFreeze = false;
      if (freezeHold) {
        const dx = x + 0.5 - ptrFx;
        const dy = y + 0.5 - ptrFy;
        inFreeze = dx * dx + dy * dy <= fieldR2;
      }

      let disp;
      if (inFreeze) {
        /* Hold the frozen crest — no further integration under cursor */
        disp = u[i];
        v[i] *= 0.5;
      } else {
        disp = u[i] + v[i];
        if (shore > 0) {
          disp *= 1 - shore * 0.028;
        }
      }
      disp = softClamp(disp, U_MAX);
      const vel = v[i];
      if (Math.abs(disp) < EPS && Math.abs(vel) < EPS) {
        disp = 0;
        v[i] = 0;
      } else {
        alive = true;
      }
      u[i] = disp;

      const mag = Math.abs(disp);
      /* Wave energy → accent intensity; intro LEDs use same HOT path */
      let energy = mag * invU + Math.abs(vel) * invV * 0.4;
      if (energy > 1) energy = 1;
      const introHv = pixelField.brightness(i);
      const introDX = pixelField.offsetX(i);
      const introDY = pixelField.offsetY(i);
      const introDrift = introDX !== 0 || introDY !== 0;
      const presence =
        typeof pixelField.presence === 'function' ? pixelField.presence(i) : 1;
      if (
        typeof pixelField.teardownActive === 'function' &&
        pixelField.teardownActive() &&
        typeof pixelField.cellInteractive === 'function' &&
        !pixelField.cellInteractive(i)
      ) {
        u[i] = 0;
        v[i] = 0;
        disp = 0;
      }
      if (presence <= 0.001) {
        u[i] = 0;
        v[i] = 0;
        if (introHv <= 0 && !introDrift) continue;
      }
      if (!introDrift && introHv > energy) energy = introHv;
      if (introHv > 0 || presence < 0.999) alive = true;
      const eased = energy * energy * (3 - 2 * energy);
      const tint  = Math.min(1, Math.pow(eased, COLOR_FALLOFF));

      const presenceScale = densitySync
        ? Math.min(1, 0.55 + Math.max(presence, introHv) * 0.45)
        : Math.min(1, 0.35 + presence * 0.65);
      const size = DOT * presenceScale * (1 + mag * SIZE_RESP);
      const homeX = x * CELL + CELL * 0.5;
      const homeY = y * CELL + CELL * 0.5 + disp * DISP_PX;
      const cx = homeX + introDX;
      const cy = homeY + introDY;

      if (introDrift && Math.abs(disp) < EPS && Math.abs(vel) < EPS && presence > 0.001) {
        const pr = (FIELD[0] + (COOL[0] - FIELD[0]) * presence) | 0;
        const pg = (FIELD[1] + (COOL[1] - FIELD[1]) * presence) | 0;
        const pb = (FIELD[2] + (COOL[2] - FIELD[2]) * presence) | 0;
        ctx.fillStyle = `rgb(${pr},${pg},${pb})`;
        ctx.fillRect(homeX - DOT * 0.5 * presenceScale, homeY - DOT * 0.5 * presenceScale, DOT * presenceScale, DOT * presenceScale);
      }

      const drawTint = introDrift
        ? Math.min(1, Math.pow(introHv * introHv * (3 - 2 * introHv), COLOR_FALLOFF))
        : tint;

      /* Subtle bloom on the brightest crests — premium neon, not harsh */
      if (q > 0.08 && drawTint > bloomThreshold) {
        const bloom = (drawTint - bloomThreshold) / (1 - bloomThreshold);
        const bEase = bloom * bloom * (3 - 2 * bloom);
        const br = (HOT[0] + (255 - HOT[0]) * 0.35) | 0;
        const bg = (HOT[1] + (255 - HOT[1]) * 0.35) | 0;
        const bb = (HOT[2] + (255 - HOT[2]) * 0.35) | 0;
        const sOuter = size + DOT * BLOOM_SPREAD;
        const sInner = size + DOT * BLOOM_SPREAD * 0.45;
        ctx.fillStyle = `rgba(${br},${bg},${bb},${bEase * bloomStrength * 0.34})`;
        ctx.fillRect(cx - sOuter * 0.5, cy - sOuter * 0.5, sOuter, sOuter);
        ctx.fillStyle = `rgba(${br},${bg},${bb},${bEase * bloomStrength * 0.55})`;
        ctx.fillRect(cx - sInner * 0.5, cy - sInner * 0.5, sInner, sInner);
      }

      let r = FIELD[0] + (COOL[0] - FIELD[0]) * Math.min(1, presence);
      let g = FIELD[1] + (COOL[1] - FIELD[1]) * Math.min(1, presence);
      let b = FIELD[2] + (COOL[2] - FIELD[2]) * Math.min(1, presence);
      r = r + (HOT[0] - r) * drawTint;
      g = g + (HOT[1] - g) * drawTint;
      b = b + (HOT[2] - b) * drawTint;
      if (drawTint > 0) {
        const lift = drawTint * BLOOM_BRIGHTNESS;
        r += (255 - r) * lift;
        g += (220 - g) * lift * 0.35;
        b += (240 - b) * lift * 0.45;
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
      paintRest();
    }
  }

  function start() {
    if (!enabled || running) return;
    running = true;
    requestAnimationFrame(tick);
  }

  function setEnabled(on) {
    enabled = on;
    if (!enabled) {
      running = false;
      lastPtrX = lastPtrY = -1;
      paintTrail.length = 0;
      if (u) u.fill(0);
      if (v) v.fill(0);
      return;
    }

    lastPtrX = lastPtrY = -1;
    paintTrail.length = 0;
    if (viewW) {
      applySurface();
      if (u) u.fill(0);
      if (v) v.fill(0);
      paintRest();
    } else {
      resize();
    }
    /* Continue shared LED field if still playing after Heat → Wave switch */
    if (pixelField.isActive()) start();
  }

  window.addEventListener('bgmodechange', (e) => {
    const mode = e.detail && e.detail.mode;
    setEnabled(mode === 'wave');
    if (mode == null) pixelField.cancel();
  });

  window.addEventListener('pixelintrostart', () => {
    if (enabled) start();
  });

  window.addEventListener('pixeldirectorystart', () => {
    if (enabled) start();
  });

  window.addEventListener('pixelbootready', () => {
    if (enabled) start();
  });

  window.addEventListener('animconfigchange', (e) => {
    /* Soft Pixel Behavior / Cursor Mode / quality — density via PixelDensityChanged.
       Never apply a new CELL here without remounting cols/rows. */
    if (e.detail && e.detail.soft) {
      const bh = syncBehaviorFromConfig();
      const cm = syncCursorModeFromConfig();
      syncPerformanceFromConfig({ applyDensity: false });
      if ((bh || cm) && enabled) start();
      return;
    }
    syncPerformanceFromConfig({ applyDensity: false });
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

  document.addEventListener('mousemove', (e) => {
    if (!enabled) return;
    syncStageRect();
    const x = e.clientX - stageLeft;
    const y = e.clientY - stageTop;
    if (x < 0 || y < 0 || x > viewW || y > viewH) {
      lastPtrX = lastPtrY = -1;
      return;
    }
    injectAt(x, y);
  }, { passive: true });

  document.documentElement.addEventListener('mouseleave', () => {
    lastPtrX = lastPtrY = -1;
  });

  /* Measure grid now; paint only if Wave is already active */
  resize();

  return {
    id: 'wave',
    implemented: true,
    /** Live Pixel Behavior snapshot received from the shared layer. */
    getPixelBehavior: () => behavior,
    mount() {},
    destroy() {},
  };
}
