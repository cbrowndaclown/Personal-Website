/* Intro content service — Pixel FS typography LED sequences.
   Boot lifecycle is owned by the Boot Controller; this module supplies
   glyph construction, migration, Screen 1 directory assemble, Screen 2 menu
   assemble, and idle float — one shared PE LED typography pipeline.

   Lattice geometry (cols / rows / cell) is adopted from the shared GridManager
   or the density-rebuild authority — never invented from pending Settings. */

import {
  cellSizeFromDensity,
  PERFORMANCE_DEFAULTS,
} from '../performance-manager.js';
import { computeGridLayout } from '../grid-manager.js';
import { CELL as DEFAULT_CELL } from '../constants.js';
import { clearAppStartup } from '../../app-startup.js';

/**
 * @param {object} deps
 * @param {object} deps.animConfig
 * @param {boolean} deps.prefersReduced
 * @param {() => string|null} [deps.resolveActiveBgMode]
 * @param {ReturnType<import('../grid-manager.js').createGridManager>} [deps.grid]
 * @param {ReturnType<import('../performance-manager.js').createPerformanceManager>} [deps.performance]
 */
export function createIntroController(deps) {
  const animConfig = deps.animConfig;
  const prefersReduced = deps.prefersReduced;
  const sharedGrid = deps.grid || null;
  const perfMgr = deps.performance || null;

  const FF_RATE = 4;

  const INTRO_HOLD_MS      = 900;
  const INTRO_LINE_PAUSE   = 720;
  const INTRO_MS_PER_COL   = 22;
  const INTRO_REVEAL_MIN   = 1400;
  const INTRO_REVEAL_MAX   = 3200;
  const INTRO_JITTER_MS    = 32;
  const INTRO_CLUSTER_MS   = 42;
  const INTRO_SPARK_RATIO  = 0.055;
  const INTRO_DRIFT_MIN    = 10;
  const INTRO_DRIFT_MAX    = 30;
  const INTRO_DRIFT_MS_MIN = 180;
  const INTRO_DRIFT_MS_MAX = 340;
  const INTRO_MIGRATE_MS_MIN = 280;
  const INTRO_MIGRATE_MS_MAX = 520;
  const INTRO_CORRECT_MS   = 160;
  const INTRO_DISSOLVE_SCALE = 0.40;
  const INTRO_DISSOLVE_PAUSE = 280;

  const DIR_MS_PER_COL     = 30;
  const DIR_REVEAL_MIN     = 1600;
  const DIR_REVEAL_MAX     = 3800;
  const DIR_LINE_PAUSE     = 880;
  const DIR_JITTER_MS      = 36;
  const DIR_CLUSTER_MS     = 48;
  const DIR_SPARK_RATIO    = 0.04;
  const DIR_DRIFT_MIN      = 10;
  const DIR_DRIFT_MAX      = 28;
  const HOLD_SENTINEL      = 1e15;

  /*
    Magnetic Lock — Space-skip only. Completed menu starts slightly displaced
    toward the display edges, then accelerates into perfect alignment. A brief
    lock flash and sub-pixel mechanical shockwave mark synchronization.
    End-to-end ~250ms. Mechanical snap — not bounce, fade, or drop.
  */
  const MAG_LOCK_DISP_MIN_PX     = 2.0;
  const MAG_LOCK_DISP_MAX_PX     = 5.0;
  const MAG_LOCK_CONVERGE_MS     = 180;
  const MAG_LOCK_FLASH_HOLD_MS   = 10;
  const MAG_LOCK_FLASH_FADE_MS   = 26;
  const MAG_LOCK_SHOCK_MS        = 85;
  const MAG_LOCK_SHOCK_PX        = 0.72;
  const MAG_LOCK_SHOCK_RADIUS    = 4.5;
  const MAG_LOCK_BRIGHT          = 1.16;
  const MAG_LOCK_TOTAL_MS        =
    MAG_LOCK_CONVERGE_MS + MAG_LOCK_SHOCK_MS;

  /* Startup directory assemble — deliberate full-length reveal. */
  const DIR_TIMING = Object.freeze({
    msPerCol: DIR_MS_PER_COL,
    revealMin: DIR_REVEAL_MIN,
    revealMax: DIR_REVEAL_MAX,
    linePause: DIR_LINE_PAUSE,
    jitterMs: DIR_JITTER_MS,
    clusterMs: DIR_CLUSTER_MS,
    sparkLeadMs: 45,
    sparkSpreadMs: 55,
    sparkLifeMin: 80,
    sparkLifeSpan: 170,
  });

  /*
    Density-rebuild directory assemble — same procedural style, ~35% shorter.
    Tightens line pauses and reveal windows; does not raise playback rate.
  */
  const DIR_TIMING_DENSITY = Object.freeze({
    msPerCol: 20,
    revealMin: 1040,
    revealMax: 2500,
    linePause: 520,
    jitterMs: 28,
    clusterMs: 34,
    sparkLeadMs: 30,
    sparkSpreadMs: 38,
    sparkLifeMin: 55,
    sparkLifeSpan: 115,
  });

  /* Organic idle float — per-word decisions, easeInOutSine steps (CSS px) */
  const IDLE_STEP_MIN_PX   = 2.2;
  const IDLE_STEP_MAX_PX   = 5.0;
  const IDLE_LIMIT_PX      = 8;
  const IDLE_DECIDE_MIN_MS = 600;
  const IDLE_DECIDE_MAX_MS = 1800;
  const IDLE_MOVE_MIN_MS   = 420;
  const IDLE_MOVE_MAX_MS   = 980;
  const IDLE_START_MIN_MS  = 180;
  const IDLE_START_MAX_MS  = 1400;
  /* Must match heatmap / wave CELL — idle Y (px) → fractional row shift.
     Always read the applied lattice cell (shared grid / authority), never the
     pending Settings density — that desynced menu spacing mid-rebuild. */
  function getLedCell() {
    if (ledCell > 0) return ledCell;
    if (sharedGrid && sharedGrid.cell > 0) return sharedGrid.cell;
    if (perfMgr && typeof perfMgr.getCellSize === 'function') {
      const c = perfMgr.getCellSize();
      if (c > 0) return c;
    }
    const density =
      animConfig && animConfig.performance
        ? animConfig.performance.pixelDensity
        : PERFORMANCE_DEFAULTS.pixelDensity;
    return cellSizeFromDensity(density);
  }

  /**
   * Adopt authoritative lattice geometry. Absolute assign — never Math.max
   * with a stale larger grid (that left menu strides mismatched after density ↓).
   * @param {{ cols: number, rows: number, cell?: number }} info
   */
  function adoptGrid(info) {
    if (!info || !(info.cols > 0) || !(info.rows > 0)) return;
    cols = info.cols | 0;
    rows = info.rows | 0;
    if (info.cell > 0) ledCell = Number(info.cell);
    else if (sharedGrid && sharedGrid.cell > 0) ledCell = sharedGrid.cell;
    idleYCache = null;
    /* Command overlay buffers are lattice-sized; the Screen 2 rebake that
       follows a grid change re-raises them at the new pitch. */
    if (cmdOn && cmdOn.length !== cols * rows) releaseCommandBuffers();
  }

  const INTRO_LINES = [
    { text: 'Hey there,',                pace: 1.00 },
    { text: 'my name is Canaan,',        pace: 1.40 },
    { text: 'Welcome to my website.',    pace: 1.12 },
    { text: 'Are you ready to explore?', pace: 1.30 },
  ];

  const DIR_LINES = [
    { text: 'Scroll up for menu',   arrow: 'up',   pace: 1.20 },
    { text: 'Scroll down for more', arrow: 'down', pace: 1.25 },
  ];

  /* Screen 2 menu — same PE LED typography + directory assemble language.
     Only content and dual-region positions differ.
     Arrows are intentionally smaller than Screen 1 directory chevrons. */
  const S2_ARROW_SCALE = 0.78;
  /* `key` marks a line the command layer can measure and mask.
     `prefix` is the leading run that survives masking — the LED "/" stays
     lit while everything after it clears for the command box. */
  const S2_LINES = [
    { text: 'Scroll up for header / top grid', region: 'top',    align: 'center', arrow: 'up',   pace: 1.20 },
    { text: '/ for options',                   region: 'bottom', align: 'left',   pace: 1.00, key: 'options', prefix: '/' },
    { text: 'Scroll down for more',            region: 'bottom', align: 'left',   arrow: 'down', pace: 1.15 },
  ];

  const DIR_FONT =
    '"Josefin Sans", "Apple Symbols", "Segoe UI Symbol", "Noto Sans Symbols", system-ui, sans-serif';

  /*
    Screen 2 command overlay — the "/" box is LED typography like every other
    Screen 2 line. Box chrome, option rows, typed entry and caret are baked
    into the lattice and composited in brightness(), so nothing about the
    command layer sits on top of the display as DOM.

    Box chrome snaps to whole LED cells (1-cell stroke). Entry text sits
    between the menu line and the option stack; the prompt slash is redrawn
    at entry size so it matches what you type.
  */
  const CMD_BOX_W_EM      = 7.2;  /* × entryFontPx — sized for CMD_MAX_ENTRY chars */
  const CMD_ENTRY_SCALE   = 0.85; /* × menu fontPx — box prompt + typed entry */
  const CMD_OPTION_SCALE  = 0.68; /* × menu fontPx */
  const CMD_ROW_STRIDE    = 1.42; /* × optionFontPx */
  const CMD_LIST_GAP      = 0.75; /* × optionFontPx, box top → bottom row */
  const CMD_HINT_LEVEL    = 0.5;
  const CMD_BOX_LEVEL     = 0.82;
  const CMD_DIM_LEVEL     = 0.45; /* unmatched rows while a command matches */
  const CMD_BOX_MS        = 120;  /* box leads, rows follow */
  const CMD_ROW_STAGGER   = 55;   /* each row leaves the box after the one below */
  const CMD_REVEAL_MS     = 240;  /* L→R wave across one row */
  const CMD_JITTER_MS     = 26;
  const CMD_MIGRATE_MS    = 220;
  const CMD_DRIFT_MIN     = 4;
  const CMD_DRIFT_MAX     = 12;
  const CMD_CARET_MS      = 1060;
  const CMD_MAX_ENTRY     = 10;
  const CMD_CLOSE_MS      = 240;  /* fade + outward pop on dismiss */
  const CMD_CLOSE_POP     = 0.9;  /* drift scale while closing */

  /* ── controller state ─────────────────────────────────────────────────── */
  let phase = 'idle'; /* typography | directory | idle | skipped | dissolving */
  let timeScale = 1;
  let holdingFF = false;
  let killed = false;
  let contentLocked = false; /* exclusive boot owns the PE canvas */
  /* Directory LEDs ("Scroll up/down") must not exist until post-boot reveal */
  let directoryAllowed = false;
  /* Which menu content occupies the shared directory LED buffers: 1 | 2 */
  let menuSurface = 1;
  /* Screen 2 menu assemble plays at most once per page load */
  let screen2MenuPlayed = false;
  /*
    Menu content opacity (0..1). Both screens display the same shared frame,
    so menu text must clear while a screen transition crosses the viewport —
    otherwise the same lines read twice, once per visible surface.
  */
  let menuFade = 1;
  let menuFadeFrom = 1;
  let menuFadeTo = 1;
  let menuFadeStartWall = 0;
  let menuFadeMs = 0;
  let phaseStartTime = 0; /* content clock ms origin */
  let contentElapsed = 0;
  let lastWallNow = 0;
  let touchGuardUntil = 0;
  let typographySettled = false;
  let typographyHoldMs = 0;
  let dissolveTimer = null;

  let cols = 0;
  let rows = 0;
  /** Applied cell pitch (CSS px) — matches GridManager / style CELL. */
  let ledCell = DEFAULT_CELL;
  let introTotalMs = 0;
  let typographyDurationMs = 0;
  let assembleMs = 0;

  /* Intro LED buffers */
  let iTarget = null, iOn = null, iLevel = null, iOnAt = null;
  let iDetachAt = null, iGoneAt = null, iLine = null;
  let iDriftX = null, iDriftY = null, iOx = null, iOy = null;
  let iMigrateMs = null;
  let iWordId = null;
  let iIdleWords = [];

  /* Directory LED buffers */
  let dTarget = null, dOn = null, dLevel = null, dOnAt = null;
  let dDetachAt = null, dGoneAt = null;
  let dDriftX = null, dDriftY = null, dOx = null, dOy = null;
  let dWordId = null;
  let dIdleWords = [];
  /* Immutable completed glyph bitmap — idle never writes here */
  let dBitmap = null;
  let idleYCache = null; /* scratch: per-word Y for the current frame */

  /* Per-cell suppression flag — masked LEDs stay baked but never render.
     Lets the command layer clear "for options" without dropping the bake. */
  let dHide = null;
  /* Per-word idle-float freeze — the prompt glyph holds still inside the
     command box instead of drifting against its static LED frame. */
  let dPinWord = null;
  /* Grid-space geometry of keyed Screen 2 lines, refreshed on every bake. */
  /** @type {Map<string, object>} */
  const s2LineMetrics = new Map();
  /* Keys currently masked after their prefix — reapplied across rebakes. */
  /** @type {Set<string>} */
  const s2MaskedKeys = new Set();

  /* Command overlay — LED buffers for the "/" box, its options and entry. */
  let cmdOpen = false;
  let cmdClosing = false;
  let cmdCloseWall = 0;
  /** @type {null | (() => void)} */
  let cmdCloseDone = null;
  let cmdKey = null;
  /** @type {{ name: string, hint?: string }[]} */
  let cmdOptions = [];
  let cmdText = '';
  let cmdChrome = null;   /* box + option glyph levels */
  let cmdChromeAt = null; /* per-cell assemble time (ms since open) */
  let cmdRow = null;      /* 0 = box chrome, 1..N = option rows */
  let cmdRowMul = null;   /* per-row level multiplier — match emphasis */
  let cmdDriftX = null, cmdDriftY = null;
  let cmdEntry = null;    /* typed text */
  let cmdCaret = null;    /* caret bar */
  let cmdOn = null, cmdOx = null, cmdOy = null;
  let cmdStartWall = 0;
  let cmdCaretWall = 0;
  let cmdEntryAt = 0;

  /* Space-skip Magnetic Lock — edge-displaced converge + lock flash + shock */
  let directoryMagLock = false;
  let magLockMinX = 0;
  let magLockMaxX = 0;
  let magLockMinY = 0;
  let magLockMaxY = 0;
  let magLockCx = 0;
  let magLockCy = 0;

  function hash01(i, salt) {
    let x = Math.imul(i ^ (salt | 0), 0x27d4eb2d);
    x = Math.imul(x ^ (x >>> 15), 0x85ebca6b);
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
    return ((x >>> 0) / 4294967296);
  }

  function easeOutCubic(u) {
    const t = 1 - u;
    return 1 - t * t * t;
  }

  function easeInOutSine(u) {
    return -(Math.cos(Math.PI * u) - 1) * 0.5;
  }

  function randRange(a, b) {
    return a + Math.random() * (b - a);
  }

  function createIdleWord(readyAtMs) {
    return {
      readyAt: readyAtMs,
      armed: false,
      y: 0,
      fromY: 0,
      toY: 0,
      animStart: 0,
      animDur: 0,
      nextAt: 0,
      streakDir: 0,
      streakCount: 0,
      paused: false,
      pauseAt: 0,
    };
  }

  /* Left-edge word bands in the same coordinate space as glyph sampling. */
  function wordBandsAt(octx, text, startX) {
    const bands = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(text))) {
      const wBefore = octx.measureText(text.slice(0, m.index)).width;
      const wWord = octx.measureText(m[0]).width;
      bands.push({
        x0: startX + wBefore,
        x1: startX + wBefore + wWord,
      });
    }
    return bands;
  }

  function bandIndexForX(x, bands) {
    if (!bands.length) return 0;
    for (let b = 0; b < bands.length; b++) {
      if (x >= bands[b].x0 - 0.85 && x <= bands[b].x1 + 0.85) return b;
    }
    let best = 0;
    let bestD = Infinity;
    for (let b = 0; b < bands.length; b++) {
      const mid = (bands[b].x0 + bands[b].x1) * 0.5;
      const d = Math.abs(x - mid);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  function sampleIdleWordY(word, wallNow) {
    if (!(word.animDur > 0)) return word.toY;
    const u = Math.max(0, Math.min(1, (wallNow - word.animStart) / word.animDur));
    return word.fromY + (word.toY - word.fromY) * easeInOutSine(u);
  }

  function decideIdleWord(word, wallNow) {
    const pos = sampleIdleWordY(word, wallNow);
    word.fromY = pos;
    word.y = pos;

    const nearTop = pos >= IDLE_LIMIT_PX - 1.25;
    const nearBot = pos <= -IDLE_LIMIT_PX + 1.25;
    const biasDown = pos > 3.5;
    const biasUp = pos < -3.5;

    /* Weighted UP / STAY / DOWN — consecutive + limit rules applied */
    let wUp = 1;
    let wStay = 0.85;
    let wDown = 1;

    if (word.streakCount >= 2 && word.streakDir === 1) wUp = 0;
    if (word.streakCount >= 2 && word.streakDir === -1) wDown = 0;
    if (nearTop) {
      wUp = 0;
      wDown *= 2.4;
      wStay *= 1.2;
    } else if (biasDown) {
      wDown *= 1.7;
      wUp *= 0.45;
    }
    if (nearBot) {
      wDown = 0;
      wUp *= 2.4;
      wStay *= 1.2;
    } else if (biasUp) {
      wUp *= 1.7;
      wDown *= 0.45;
    }

    const total = wUp + wStay + wDown;
    let pick = Math.random() * total;
    let dir = 0;
    if (pick < wUp) dir = 1;
    else if (pick < wUp + wStay) dir = 0;
    else dir = -1;

    let target = pos;
    if (dir !== 0) {
      const step = randRange(IDLE_STEP_MIN_PX, IDLE_STEP_MAX_PX);
      target = Math.max(-IDLE_LIMIT_PX, Math.min(IDLE_LIMIT_PX, pos + dir * step));
      if (Math.abs(target - pos) < 0.2) {
        dir = 0;
        target = pos;
      }
    }

    word.toY = target;
    word.animStart = wallNow;
    word.animDur = dir === 0 ? 0 : randRange(IDLE_MOVE_MIN_MS, IDLE_MOVE_MAX_MS);

    if (dir === 0) {
      word.streakDir = 0;
      word.streakCount = 0;
    } else if (dir === word.streakDir) {
      word.streakCount += 1;
    } else {
      word.streakDir = dir;
      word.streakCount = 1;
    }

    const gap = randRange(IDLE_DECIDE_MIN_MS, IDLE_DECIDE_MAX_MS);
    word.nextAt = wallNow + Math.max(gap, word.animDur + 40);
  }

  /* Returns current idle Y (px). Pauses cleanly; resumes without snapping. */
  function tickIdleWord(word, localT, wallNow, hardPause) {
    if (prefersReduced || !animConfig.motion) {
      word.y = 0;
      word.fromY = 0;
      word.toY = 0;
      word.armed = false;
      word.paused = false;
      return 0;
    }
    if (!(word.readyAt >= 0) || localT < word.readyAt) return 0;

    const paused = !!(hardPause || holdingFF);
    if (paused) {
      if (!word.paused) {
        /* Show exact source bitmap while another animation owns the stage */
        word.y = 0;
        word.fromY = 0;
        word.toY = 0;
        word.animDur = 0;
        word.paused = true;
        word.pauseAt = wallNow;
      }
      return 0;
    }

    if (word.paused) {
      const dt = wallNow - word.pauseAt;
      word.nextAt += dt;
      word.animStart += dt;
      word.paused = false;
    }

    if (!word.armed) {
      word.armed = true;
      word.y = 0;
      word.fromY = 0;
      word.toY = 0;
      word.animDur = 0;
      word.streakDir = 0;
      word.streakCount = 0;
      word.nextAt = wallNow + randRange(IDLE_START_MIN_MS, IDLE_START_MAX_MS);
    }

    if (wallNow >= word.nextAt) decideIdleWord(word, wallNow);
    word.y = sampleIdleWordY(word, wallNow);
    return word.y;
  }

  /* Tick every word once; returns Float32Array of current Y offsets (px). */
  function tickAllIdleWords(words, localT, hardPause) {
    const wallNow = performance.now();
    const n = words.length;
    if (!idleYCache || idleYCache.length < n) idleYCache = new Float32Array(n);
    for (let w = 0; w < n; w++) {
      idleYCache[w] = tickIdleWord(words[w], localT, wallNow, hardPause);
    }
    return idleYCache;
  }

  /*
    Fixed-grid light flow: keep every LED at its home cell, but redistribute
    brightness into neighboring rows from idle Y (px → fractional row).
    Positive Y lights rows below; negative Y lights rows above. Fractional
    shifts crossfade both rows so the glyph appears to drift through the matrix.
  */
  function scatterIdleLight(buf, x, y, level, shiftPx) {
    if (!(level > 0)) return;
    const dest = y + shiftPx / getLedCell();
    const yFloor = Math.floor(dest);
    const f = dest - yFloor;
    const y1 = yFloor + 1;

    if (yFloor >= 0 && yFloor < rows) {
      const i0 = yFloor * cols + x;
      const v0 = level * (1 - f);
      if (v0 > buf[i0]) buf[i0] = v0;
    }
    if (f > 1e-5 && y1 >= 0 && y1 < rows) {
      const i1 = y1 * cols + x;
      const v1 = level * f;
      if (v1 > buf[i1]) buf[i1] = v1;
    }
  }

  function pauseIdleWords(words, localT) {
    const wallNow = performance.now();
    for (let w = 0; w < words.length; w++) {
      tickIdleWord(words[w], localT, wallNow, true);
    }
  }

  /**
   * Pull geometry from the shared GridManager when local dims are unset.
   * Absolute assignment from the live grid — single source of truth.
   */
  function ensureGrid() {
    if (sharedGrid && sharedGrid.cols >= 12 && sharedGrid.rows >= 8) {
      adoptGrid({
        cols: sharedGrid.cols,
        rows: sharedGrid.rows,
        cell: sharedGrid.cell,
      });
      return;
    }
    if (cols >= 12 && rows >= 8) {
      if (!(ledCell > 0) && sharedGrid && sharedGrid.cell > 0) {
        ledCell = sharedGrid.cell;
      }
      return;
    }
    const stage = document.getElementById('stage');
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const cell = getLedCell();
    const layout = computeGridLayout(rect.width, rect.height, cell);
    cols = layout.cols;
    rows = layout.rows;
    ledCell = layout.cell;
  }

  function setBoot(flag) {
    if (flag) document.body.dataset.boot = flag;
    else delete document.body.dataset.boot;
  }

  function isActivePhase() {
    return phase === 'typography' || phase === 'directory' || phase === 'dissolving';
  }

  function setTimeScale(rate) {
    timeScale = rate > 0 ? rate : 1;
  }

  function resetContentClock() {
    contentElapsed = 0;
    lastWallNow = 0;
    phaseStartTime = 0;
  }

  function tickContentClock(now) {
    if (!lastWallNow) {
      lastWallNow = now;
      return contentElapsed;
    }
    const dt = Math.max(0, now - lastWallNow) * timeScale;
    lastWallNow = now;
    if (phase === 'typography' || phase === 'directory' || phase === 'dissolving') {
      contentElapsed += dt;
    }
    return contentElapsed;
  }

  function phaseElapsedMs() {
    return contentElapsed;
  }

  function clearDissolveTimer() {
    if (dissolveTimer != null) {
      clearTimeout(dissolveTimer);
      dissolveTimer = null;
    }
  }

  /* ── intro LED bake / clear ───────────────────────────────────────────── */

  function clearIntroLeds() {
    if (!iOn) return;
    iOn.fill(0);
    if (iTarget) iTarget.fill(0);
    if (iLevel) iLevel.fill(0);
    if (iOnAt) iOnAt.fill(0);
    if (iDetachAt) iDetachAt.fill(0);
    if (iGoneAt) iGoneAt.fill(0);
    if (iLine) iLine.fill(0);
    if (iDriftX) iDriftX.fill(0);
    if (iDriftY) iDriftY.fill(0);
    if (iOx) iOx.fill(0);
    if (iOy) iOy.fill(0);
    if (iMigrateMs) iMigrateMs.fill(0);
    if (iWordId) iWordId.fill(-1);
    iIdleWords = [];
  }

  /**
   * Fully release intro LED buffers and geometry from the previous grid.
   * Density rebuild calls this so no cached pixel map survives.
   */
  function destroyIntroLeds() {
    iTarget = null;
    iOn = null;
    iLevel = null;
    iOnAt = null;
    iDetachAt = null;
    iGoneAt = null;
    iLine = null;
    iDriftX = null;
    iDriftY = null;
    iOx = null;
    iOy = null;
    iMigrateMs = null;
    iWordId = null;
    iIdleWords = [];
  }

  /**
   * Drop every menu / typography reference tied to the previous lattice.
   * Preserves only caller-owned settings (animConfig).
   */
  function destroyGridState() {
    closeScreen2Command({ instant: true });
    clearDissolveTimer();
    destroyIntroLeds();
    clearDirectoryLeds();
    idleYCache = null;
    contentLocked = true;
    directoryAllowed = false;
    phase = 'idle';
    typographySettled = false;
    holdingFF = false;
    timeScale = 1;
    killed = false;
    introTotalMs = 0;
    typographyDurationMs = 0;
    assembleMs = 0;
    cols = 0;
    rows = 0;
    ledCell = 0;
    resetContentClock();
  }

  function fitIntroFont(octx, lines, maxWidth, startPx) {
    let fontPx = startPx;
    for (let attempt = 0; attempt < 14; attempt++) {
      octx.font = `600 ${fontPx}px "Josefin Sans", system-ui, sans-serif`;
      let widest = 0;
      for (let L = 0; L < lines.length; L++) {
        widest = Math.max(widest, octx.measureText(lines[L].text).width);
      }
      if (widest <= maxWidth) break;
      fontPx = Math.max(4, fontPx - 1);
    }
    return fontPx;
  }

  function sampleLineGlyphs(octx, text, cx, cy) {
    octx.fillStyle = '#000';
    octx.fillRect(0, 0, cols, rows);
    octx.fillStyle = '#fff';
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    octx.fillText(text, cx, cy);

    /* Thin trailing marks (esp. commas) often antialias below the LED
       threshold on the coarse grid — stamp a small solid glyph so they read. */
    reinforceTrailingPunct(octx, text, cx, cy);

    const data = octx.getImageData(0, 0, cols, rows).data;
    const glyph = [];
    let minX = cols, maxX = -1, minY = rows, maxY = -1;
    for (let i = 0, n = cols * rows; i < n; i++) {
      if (data[i * 4] <= 140) continue;
      glyph.push(i);
      const x = i % cols;
      const y = (i / cols) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return { glyph, minX, maxX, minY, maxY };
  }

  /**
   * Paint a few solid pixels for trailing punctuation so commas/periods
   * survive LED downsampling. No-ops when the line has no trailing mark.
   */
  function reinforceTrailingPunct(octx, text, cx, cy) {
    if (!text || text.length < 2) return;
    const mark = text.charAt(text.length - 1);
    if (mark !== ',' && mark !== '.' && mark !== '!' && mark !== '?') return;

    const prefix = text.slice(0, -1);
    const fullW = octx.measureText(text).width;
    const prefixW = octx.measureText(prefix).width;
    if (!(fullW > 0) || !(prefixW >= 0)) return;

    const startX = cx - fullW * 0.5;
    const gap = Math.max(1.25, fullW - prefixW);
    const x = Math.round(startX + prefixW + gap * 0.35);
    /* textBaseline middle — drop slightly for baseline marks */
    const y = Math.round(cy + 1);

    octx.fillStyle = '#fff';
    if (mark === ',') {
      /* Compact pixel comma: body + descending tail */
      octx.fillRect(x, y, 2, 1);
      octx.fillRect(x, y + 1, 1, 1);
      octx.fillRect(x - 1, y + 2, 1, 1);
    } else if (mark === '.') {
      octx.fillRect(x, y + 1, 2, 2);
    } else if (mark === '!') {
      octx.fillRect(x, y - 3, 2, 4);
      octx.fillRect(x, y + 2, 2, 1);
    } else if (mark === '?') {
      /* Hook is usually large enough; reinforce the dot only */
      octx.fillRect(x, y + 2, 2, 2);
    }
  }

  function bakeIntro(opts) {
    opts = opts || {};
    const seedCells = opts.seedCells || null;
    const n = cols * rows;
    iTarget = new Float32Array(n);
    iOn = new Float32Array(n);
    iLevel = new Float32Array(n);
    iOnAt = new Float32Array(n);
    iDetachAt = new Float32Array(n);
    iGoneAt = new Float32Array(n);
    iLine = new Uint8Array(n);
    iDriftX = new Float32Array(n);
    iDriftY = new Float32Array(n);
    iOx = new Float32Array(n);
    iOy = new Float32Array(n);
    iMigrateMs = new Float32Array(n);
    iWordId = new Int16Array(n);
    iWordId.fill(-1);
    iIdleWords = [];
    introTotalMs = 0;
    typographyDurationMs = 0;
    typographySettled = false;

    if (cols < 16 || rows < 16) return;

    const off = document.createElement('canvas');
    off.width = cols;
    off.height = rows;
    const octx = off.getContext('2d', { alpha: false });
    if (!octx) return;

    const lineCount = INTRO_LINES.length;
    let fontPx = Math.max(5, Math.floor(rows * 0.085));
    fontPx = fitIntroFont(octx, INTRO_LINES, cols * 0.90, fontPx);

    let lineGap = fontPx * 1.55;
    while (lineGap * (lineCount - 1) > rows * 0.72 && fontPx > 4) {
      fontPx -= 1;
      octx.font = `600 ${fontPx}px "Josefin Sans", system-ui, sans-serif`;
      lineGap = fontPx * 1.55;
    }
    fontPx = fitIntroFont(octx, INTRO_LINES, cols * 0.90, fontPx);
    octx.font = `600 ${fontPx}px "Josefin Sans", system-ui, sans-serif`;
    lineGap = fontPx * 1.55;

    const blockH = lineGap * (lineCount - 1);
    const startY = rows * 0.5 - blockH * 0.5;
    const cx = cols * 0.5;

    let cursor = 0;
    const lineMeta = [];
    let maxArrive = 0;

    for (let L = 0; L < lineCount; L++) {
      const cy = startY + L * lineGap;
      const sampled = sampleLineGlyphs(octx, INTRO_LINES[L].text, cx, cy);
      if (!sampled.glyph.length) {
        lineMeta.push(null);
        continue;
      }

      const spanX = Math.max(1, sampled.maxX - sampled.minX);
      const spanY = Math.max(1, sampled.maxY - sampled.minY);
      const revealMs = Math.min(
        INTRO_REVEAL_MAX,
        Math.max(INTRO_REVEAL_MIN, spanX * INTRO_MS_PER_COL * INTRO_LINES[L].pace)
      );
      const lineStart = cursor;
      const lineCx = (sampled.minX + sampled.maxX) * 0.5;
      const lineCy = (sampled.minY + sampled.maxY) * 0.5;

      const lineText = INTRO_LINES[L].text;
      const textW = octx.measureText(lineText).width;
      const bands = wordBandsAt(octx, lineText, cx - textW * 0.5);
      const bandCount = Math.max(1, bands.length);
      const baseWid = iIdleWords.length;
      const wordReady = new Float32Array(bandCount);
      for (let b = 0; b < bandCount; b++) {
        wordReady[b] = lineStart;
        iIdleWords.push(createIdleWord(lineStart));
      }

      for (let g = 0; g < sampled.glyph.length; g++) {
        const i = sampled.glyph[g];
        const x = i % cols;
        const y = (i / cols) | 0;
        const xNorm = (x - sampled.minX) / spanX;
        const yRipple = ((y - sampled.minY) / spanY - 0.5) * 24;
        const clusterX = (x / 2) | 0;
        const clusterY = (y / 2) | 0;
        const clusterId = clusterX + clusterY * 4099 + L * 9176;
        const clusterOff = (hash01(clusterId, 0xf01) - 0.5) * INTRO_CLUSTER_MS;
        const jitter = (hash01(i, 0xa11 + L) - 0.5) * INTRO_JITTER_MS;
        const n1 = hash01(i, 0xb22 + L);

        let onAt = lineStart + xNorm * revealMs + yRipple + clusterOff + jitter;
        onAt = Math.max(lineStart, Math.min(lineStart + revealMs - 8, onAt));

        const bi = bands.length ? bandIndexForX(x, bands) : 0;
        const wid = baseWid + bi;
        if (onAt > wordReady[bi]) wordReady[bi] = onAt;

        iTarget[i] = 1;
        iLine[i] = L + 1;
        iOnAt[i] = onAt;
        iLevel[i] = 0.90 + n1 * 0.10;
        iWordId[i] = wid;
        /* Hold until directory handoff retargets dissolve */
        iDetachAt[i] = HOLD_SENTINEL;
        iGoneAt[i] = HOLD_SENTINEL;

        const nAng = hash01(clusterId, 0xd01);
        const nDist = hash01(i, 0xd02 + L);
        const nSpin = (hash01(i, 0xd03) - 0.5) * 0.85;
        let baseAng = Math.atan2(y - lineCy, x - lineCx);
        if (!isFinite(baseAng) || (x === lineCx && y === lineCy)) {
          baseAng = nAng * Math.PI * 2;
        }
        const ang = baseAng + nSpin + (nAng - 0.5) * 0.55;
        const dist = INTRO_DRIFT_MIN + nDist * (INTRO_DRIFT_MAX - INTRO_DRIFT_MIN);
        /* Spawn offset — migrate toward home during construction */
        iDriftX[i] = Math.cos(ang) * dist;
        iDriftY[i] = Math.sin(ang) * dist;
        iMigrateMs[i] =
          INTRO_MIGRATE_MS_MIN +
          hash01(i, 0xd12) * (INTRO_MIGRATE_MS_MAX - INTRO_MIGRATE_MS_MIN);

        const arriveAt = onAt + iMigrateMs[i] + INTRO_CORRECT_MS;
        if (arriveAt > maxArrive) maxArrive = arriveAt;
        if (arriveAt > wordReady[bi]) wordReady[bi] = arriveAt;
      }

      for (let b = 0; b < bandCount; b++) {
        iIdleWords[baseWid + b].readyAt = wordReady[b];
      }

      const pad = Math.max(2, Math.round(fontPx * 0.35));
      const bx0 = Math.max(0, sampled.minX - pad);
      const bx1 = Math.min(cols - 1, sampled.maxX + pad);
      const by0 = Math.max(0, sampled.minY - pad);
      const by1 = Math.min(rows - 1, sampled.maxY + pad);
      const lineEnd = lineStart + revealMs;

      for (let y = by0; y <= by1; y++) {
        for (let x = bx0; x <= bx1; x++) {
          const i = y * cols + x;
          if (iTarget[i]) continue;
          if (hash01(i, 0xd44 + L * 17) > INTRO_SPARK_RATIO) continue;
          const xNorm = (x - sampled.minX) / spanX;
          const n1 = hash01(i, 0xe55 + L);
          const n2 = hash01(i, 0xf66 + L);
          const waveT = lineStart + Math.max(0, Math.min(revealMs, xNorm * revealMs));
          const onAt = Math.max(lineStart, waveT - 45 + (n1 - 0.5) * 55);
          const life = 80 + n2 * 170;
          const goneAt = Math.min(lineEnd - 16, onAt + life);
          if (goneAt <= onAt) continue;
          iOnAt[i] = onAt;
          iDetachAt[i] = goneAt;
          iGoneAt[i] = goneAt;
          iLevel[i] = 0.52 + n1 * 0.28;
          iMigrateMs[i] = 90 + n2 * 80;
          iDriftX[i] = (n1 - 0.5) * 6;
          iDriftY[i] = (n2 - 0.5) * 6;
        }
      }

      lineMeta.push({
        revealMs,
        minX: sampled.minX,
        spanX,
        glyph: sampled.glyph,
      });

      cursor = lineEnd;
      if (L < lineCount - 1) cursor += INTRO_LINE_PAUSE;
    }

    /* Smile → typography: earliest glyphs spawn from self-test smile pixels */
    if (seedCells && seedCells.length && iTarget) {
      const seeded = [];
      for (let i = 0; i < n; i++) {
        if (!iTarget[i]) continue;
        seeded.push(i);
      }
      seeded.sort(function (a, b) {
        return iOnAt[a] - iOnAt[b];
      });

      const count = Math.min(seedCells.length, seeded.length);
      for (let s = 0; s < count; s++) {
        const i = seeded[s];
        const seed = seedCells[s % seedCells.length];
        const homeX = i % cols;
        const homeY = (i / cols) | 0;
        /* Drift from smile cell toward glyph home — same pixels continue the story */
        iDriftX[i] = (seed.x - homeX) * getLedCell();
        iDriftY[i] = (seed.y - homeY) * getLedCell();
        iOnAt[i] = Math.min(iOnAt[i], 12 + s * 10);
        iMigrateMs[i] = Math.max(
          iMigrateMs[i],
          340 + hash01(i, 0x51e) * 220
        );
        /* Brighten the handoff so the smile→type bridge reads clearly */
        iLevel[i] = Math.max(iLevel[i], 0.96);
      }

      /* Recompute duration after seed timing tweaks */
      let seedMaxArrive = 0;
      for (let i = 0; i < n; i++) {
        if (!iTarget[i]) continue;
        const arriveAt = iOnAt[i] + iMigrateMs[i] + INTRO_CORRECT_MS;
        if (arriveAt > seedMaxArrive) seedMaxArrive = arriveAt;
      }
      if (seedMaxArrive > maxArrive) maxArrive = seedMaxArrive;
    }

    /* Store dissolve meta for later retarget — construction holds glyphs in place */
    bakeIntro._lineMeta = lineMeta;
    typographyHoldMs = cursor + INTRO_HOLD_MS;
    typographyDurationMs = Math.max(typographyHoldMs, maxArrive + 80);
    introTotalMs = typographyDurationMs;
  }

  /* Retarget glyph dissolve relative to content clock `t0` (ms). */
  function armIntroDissolve(t0) {
    const lineMeta = bakeIntro._lineMeta;
    if (!lineMeta || !iTarget) return 0;

    let dissolveCursor = t0;
    let maxGone = t0;

    for (let L = 0; L < lineMeta.length; L++) {
      const meta = lineMeta[L];
      if (!meta || !meta.glyph.length) continue;
      const dissolveMs = meta.revealMs * INTRO_DISSOLVE_SCALE;
      const lineStart = dissolveCursor;

      for (let g = 0; g < meta.glyph.length; g++) {
        const i = meta.glyph[g];
        const x = i % cols;
        const y = (i / cols) | 0;
        const xNorm = (x - meta.minX) / meta.spanX;
        const clusterX = (x / 2) | 0;
        const clusterY = (y / 2) | 0;
        const clusterId = clusterX + clusterY * 4099 + L * 9176;
        const clusterOff = (hash01(clusterId, 0xe01) - 0.5) * INTRO_CLUSTER_MS;
        const jitter = (hash01(i, 0xe11 + L) - 0.5) * INTRO_JITTER_MS;

        let detachAt = lineStart + xNorm * dissolveMs + clusterOff + jitter;
        detachAt = Math.max(lineStart, Math.min(lineStart + dissolveMs - 8, detachAt));
        const driftMs =
          INTRO_DRIFT_MS_MIN +
          hash01(i, 0xe22) * (INTRO_DRIFT_MS_MAX - INTRO_DRIFT_MS_MIN);
        iDetachAt[i] = detachAt;
        iGoneAt[i] = detachAt + driftMs;
        if (iGoneAt[i] > maxGone) maxGone = iGoneAt[i];
      }

      dissolveCursor = lineStart + dissolveMs;
      if (L < lineMeta.length - 1) dissolveCursor += INTRO_DISSOLVE_PAUSE;
    }

    introTotalMs = maxGone + 120;
    return introTotalMs - t0;
  }

  /* ── directory LED bake / clear ───────────────────────────────────────── */

  function clearDirectoryLeds() {
    /* Drop buffers entirely so scroll text cannot linger in canvas state */
    directoryMagLock = false;
    dTarget = null;
    dOn = null;
    dLevel = null;
    dOnAt = null;
    dDetachAt = null;
    dGoneAt = null;
    dDriftX = null;
    dDriftY = null;
    dOx = null;
    dOy = null;
    dWordId = null;
    dIdleWords = [];
    dBitmap = null;
    dHide = null;
    dPinWord = null;
    idleYCache = null;
    assembleMs = 0;
  }

  /**
   * Convergence remain (1 → 0). Ease-in accelerates into alignment; the last
   * fraction snaps hard — mechanical stop, not a soft settle.
   * @param {number} u 0..1 time progress through MAG_LOCK_CONVERGE_MS
   */
  function magLockRemain(u) {
    if (u >= 1) return 0;
    if (u <= 0) return 1;
    /* easeInQuint — slow start, rapidly accelerating lock */
    const p = u * u * u * u * u;
    const remain = 1 - p;
    /* Crush the final ~8% of travel into a crisp snap */
    if (remain < 0.08) return (remain * remain) / 0.08;
    return remain;
  }

  /**
   * Capture menu AABB + centroid for shockwave focus.
   * @returns {boolean}
   */
  function captureMagLockBounds() {
    if (!dTarget || !(cols > 0) || !(rows > 0)) return false;
    const n = cols * rows;
    let minX = cols;
    let maxX = -1;
    let minY = rows;
    let maxY = -1;
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      if (!(dTarget[i] > 0)) continue;
      const x = i % cols;
      const y = (i / cols) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      sumX += x;
      sumY += y;
      count++;
    }
    if (count < 1) return false;
    magLockMinX = minX;
    magLockMaxX = maxX;
    magLockMinY = minY;
    magLockMaxY = maxY;
    magLockCx = sumX / count;
    magLockCy = sumY / count;
    return true;
  }

  /**
   * Seed per-menu-pixel start offsets: outward along display axes (left→left,
   * top→up, …). Magnitude always 2–5px — direction from grid position, not
   * random scatter.
   */
  function seedMagLockDisplacements() {
    if (!dBitmap || !dDriftX || !dDriftY) return;
    const n = cols * rows;
    const invCols = cols > 1 ? 1 / (cols - 1) : 0;
    const invRows = rows > 1 ? 1 / (rows - 1) : 0;
    const span = MAG_LOCK_DISP_MAX_PX - MAG_LOCK_DISP_MIN_PX;
    for (let i = 0; i < n; i++) {
      dDriftX[i] = 0;
      dDriftY[i] = 0;
      if (!(dBitmap[i] > 0)) continue;
      const x = i % cols;
      const y = (i / cols) | 0;
      /* Display-normalized axes: -1 left/top → +1 right/bottom */
      const nx = x * invCols * 2 - 1;
      const ny = y * invRows * 2 - 1;
      let len = Math.hypot(nx, ny);
      let ux;
      let uy;
      if (len >= 0.12) {
        ux = nx / len;
        uy = ny / len;
      } else {
        /* Near display center — fall back to outward from menu centroid */
        const vx = x - magLockCx;
        const vy = y - magLockCy;
        len = Math.hypot(vx, vy);
        if (len > 1e-6) {
          ux = vx / len;
          uy = vy / len;
        } else {
          ux = hash01(i, 0xd02) - 0.5;
          uy = hash01(i, 0xd03) - 0.5;
          len = Math.hypot(ux, uy) || 1;
          ux /= len;
          uy /= len;
        }
      }
      const mag =
        MAG_LOCK_DISP_MIN_PX +
        span * (0.55 + 0.45 * hash01(i, 0xd01));
      dDriftX[i] = ux * mag;
      dDriftY[i] = uy * mag;
    }
  }

  /**
   * Space-skip Magnetic Lock frame — converge, lock flash, micro shockwave.
   * @param {number} t content-clock ms since lock start
   */
  function updateMagneticLock(t) {
    if (!dOn || !dBitmap) return false;
    const n = cols * rows;
    dOn.fill(0);
    if (dOx) dOx.fill(0);
    if (dOy) dOy.fill(0);

    const convergeMs = MAG_LOCK_CONVERGE_MS;
    const locked = t >= convergeMs;

    /* Convergence remain: 1 at t=0 → 0 at lock */
    let remain = 0;
    if (!locked) {
      remain = magLockRemain(t / convergeMs);
    }

    /* Lock flash — brief synchronized brighten at the snap instant */
    let brightMul = 1;
    if (locked) {
      const age = t - convergeMs;
      if (age < MAG_LOCK_FLASH_HOLD_MS) {
        brightMul = MAG_LOCK_BRIGHT;
      } else if (age < MAG_LOCK_FLASH_HOLD_MS + MAG_LOCK_FLASH_FADE_MS) {
        const u =
          (age - MAG_LOCK_FLASH_HOLD_MS) / MAG_LOCK_FLASH_FADE_MS;
        brightMul = MAG_LOCK_BRIGHT + (1 - MAG_LOCK_BRIGHT) * u;
      }
    }

    /* Micro shockwave — instantaneous outward nudge, rapid distance falloff */
    let shockAmp = 0;
    if (locked && t < convergeMs + MAG_LOCK_SHOCK_MS) {
      const u = (t - convergeMs) / MAG_LOCK_SHOCK_MS;
      /* Cubic decay — felt more than seen */
      const fade = 1 - u;
      shockAmp = fade * fade * fade;
    }

    for (let i = 0; i < n; i++) {
      const isMenu = dBitmap[i] > 0;
      if (isMenu) {
        const level = Math.min(1.12, dBitmap[i] * brightMul);
        dOn[i] = level;
        if (remain > 0.0001) {
          if (dOx) dOx[i] = (dDriftX ? dDriftX[i] : 0) * remain;
          if (dOy) dOy[i] = (dDriftY ? dDriftY[i] : 0) * remain;
        }
        continue;
      }

      if (shockAmp <= 0.001) continue;
      const x = i % cols;
      const y = (i / cols) | 0;

      /* Only immediate surroundings of the menu block */
      if (
        x < magLockMinX - 2 ||
        x > magLockMaxX + 2 ||
        y < magLockMinY - 2 ||
        y > magLockMaxY + 2
      ) {
        continue;
      }

      const vx = x - magLockCx;
      const vy = y - magLockCy;
      const dist = Math.hypot(vx, vy);
      if (dist >= MAG_LOCK_SHOCK_RADIUS || dist < 1e-6) continue;

      const spatial = 1 - dist / MAG_LOCK_SHOCK_RADIUS;
      const w = spatial * spatial * shockAmp;
      if (w <= 0.001) continue;

      const sMag = w * MAG_LOCK_SHOCK_PX;
      const inv = 1 / dist;
      if (dOx) dOx[i] = vx * inv * sMag;
      if (dOy) dOy[i] = vy * inv * sMag;
    }

    return true;
  }

  function arrowSizeFor(fontPx, scale) {
    const s = scale != null ? scale : 1.15;
    /* Screen 1 keeps the larger chevron; Screen 2 passes a sub-1 scale. */
    if (s >= 1) return Math.max(fontPx * s, fontPx + 2);
    return Math.max(2, fontPx * s);
  }

  function lineLayoutWidth(octx, line, fontPx, arrowScale) {
    octx.font = `600 ${fontPx}px ${DIR_FONT}`;
    const textW = octx.measureText(line.text).width;
    if (!line.arrow) return textW;
    const arrowW = arrowSizeFor(fontPx, arrowScale) * 1.05;
    const gap = Math.max(2, Math.round(fontPx * (arrowScale != null && arrowScale < 1 ? 0.28 : 0.35)));
    return textW + gap + arrowW;
  }

  function fitDirFont(octx, lines, maxWidth, startPx, arrowScale) {
    let fontPx = startPx;
    for (let attempt = 0; attempt < 14; attempt++) {
      let widest = 0;
      for (let L = 0; L < lines.length; L++) {
        widest = Math.max(
          widest,
          lineLayoutWidth(octx, lines[L], fontPx, arrowScale)
        );
      }
      if (widest <= maxWidth) break;
      fontPx = Math.max(4, fontPx - 1);
    }
    return fontPx;
  }

  function drawPixelArrow(octx, cx, cy, size, dir) {
    const s = size;
    const stroke = Math.max(1.5, s * 0.26);
    octx.save();
    octx.translate(cx, cy);
    if (dir === 'down') octx.scale(1, -1);
    octx.strokeStyle = '#fff';
    octx.fillStyle = '#fff';
    octx.lineWidth = stroke;
    octx.lineCap = 'round';
    octx.lineJoin = 'round';
    octx.beginPath();
    octx.moveTo(-s * 0.52, s * 0.30);
    octx.lineTo(s * 0.02, s * 0.30);
    octx.quadraticCurveTo(s * 0.28, s * 0.30, s * 0.28, s * 0.04);
    octx.lineTo(s * 0.28, -s * 0.18);
    octx.stroke();
    octx.beginPath();
    octx.moveTo(s * 0.28, -s * 0.48);
    octx.lineTo(s * 0.28 + s * 0.30, -s * 0.10);
    octx.lineTo(s * 0.28 - s * 0.30, -s * 0.10);
    octx.closePath();
    octx.fill();
    octx.restore();
  }

  /**
   * @param {CanvasRenderingContext2D} octx
   * @param {{ text: string, arrow?: string }} line
   * @param {number} x  Anchor x (center of line when align=center, left edge when left)
   * @param {number} y
   * @param {number} fontPx
   * @param {{ align?: 'left' | 'center', arrowScale?: number }} [opts]
   */
  function sampleLineWithArrow(octx, line, x, y, fontPx, opts) {
    const align = (opts && opts.align) || 'center';
    const arrowScale = opts && opts.arrowScale;

    octx.fillStyle = '#000';
    octx.fillRect(0, 0, cols, rows);
    octx.fillStyle = '#fff';
    octx.font = `600 ${fontPx}px ${DIR_FONT}`;
    octx.textAlign = 'left';
    octx.textBaseline = 'middle';

    const textW = octx.measureText(line.text).width;
    let totalW = textW;
    let gap = 0;
    let arrowSize = 0;
    let arrowW = 0;
    if (line.arrow) {
      arrowSize = arrowSizeFor(fontPx, arrowScale);
      gap = Math.max(
        2,
        Math.round(fontPx * (arrowScale != null && arrowScale < 1 ? 0.28 : 0.35))
      );
      arrowW = arrowSize * 1.05;
      totalW = textW + gap + arrowW;
    }
    const startX = align === 'left' ? x : x - totalW * 0.5;

    octx.fillText(line.text, startX, y);
    if (line.arrow) {
      drawPixelArrow(
        octx,
        startX + textW + gap + arrowW * 0.5,
        y,
        arrowSize,
        line.arrow
      );
    }

    const data = octx.getImageData(0, 0, cols, rows).data;
    const glyph = [];
    let minX = cols, maxX = -1, minY = rows, maxY = -1;
    for (let i = 0, n = cols * rows; i < n; i++) {
      if (data[i * 4] <= 140) continue;
      glyph.push(i);
      const gx = i % cols;
      const gy = (i / cols) | 0;
      if (gx < minX) minX = gx;
      if (gx > maxX) maxX = gx;
      if (gy < minY) minY = gy;
      if (gy > maxY) maxY = gy;
    }
    return {
      glyph,
      minX,
      maxX,
      minY,
      maxY,
      startX,
      textW,
      gap,
      arrowW,
      totalW,
    };
  }

  function bakeDirectory(opts) {
    /* Hard gate — never generate scroll-up / scroll-down pixels early */
    if (!directoryAllowed) {
      clearDirectoryLeds();
      return;
    }
    menuSurface = 1;
    setMenuFade(1, 0);
    const instant = !!(opts && opts.instant);
    /* Density rebuild uses a tighter timing profile; startup stays DIR_TIMING. */
    const timing =
      opts && opts.densityRebuild ? DIR_TIMING_DENSITY : DIR_TIMING;
    const n = cols * rows;
    dTarget = new Float32Array(n);
    dOn = new Float32Array(n);
    dLevel = new Float32Array(n);
    dOnAt = new Float32Array(n);
    dDetachAt = new Float32Array(n);
    dGoneAt = new Float32Array(n);
    dDriftX = new Float32Array(n);
    dDriftY = new Float32Array(n);
    dOx = new Float32Array(n);
    dOy = new Float32Array(n);
    dWordId = new Int16Array(n);
    dWordId.fill(-1);
    dHide = new Uint8Array(n);
    dIdleWords = [];
    dBitmap = null;
    s2LineMetrics.clear();
    assembleMs = 0;

    if (cols < 16 || rows < 16) return;

    const off = document.createElement('canvas');
    off.width = cols;
    off.height = rows;
    const octx = off.getContext('2d', { alpha: false });
    if (!octx) return;

    const lineCount = DIR_LINES.length;
    let fontPx = Math.max(5, Math.floor(rows * 0.078));
    fontPx = fitDirFont(octx, DIR_LINES, cols * 0.90, fontPx);

    let lineGap = fontPx * 1.85;
    while (lineGap * (lineCount - 1) > rows * 0.46 && fontPx > 4) {
      fontPx -= 1;
      lineGap = fontPx * 1.85;
    }
    fontPx = fitDirFont(octx, DIR_LINES, cols * 0.90, fontPx);
    octx.font = `600 ${fontPx}px ${DIR_FONT}`;
    lineGap = fontPx * 1.85;

    const blockH = lineGap * (lineCount - 1);
    const startY = rows * 0.5 - blockH * 0.5;
    const cx = cols * 0.5;
    let cursor = 0;

    for (let L = 0; L < lineCount; L++) {
      const cy = startY + L * lineGap;
      const sampled = sampleLineWithArrow(octx, DIR_LINES[L], cx, cy, fontPx);
      if (!sampled.glyph.length) continue;

      const spanX = Math.max(1, sampled.maxX - sampled.minX);
      const spanY = Math.max(1, sampled.maxY - sampled.minY);
      const revealMs = instant
        ? 0
        : Math.min(
            timing.revealMax,
            Math.max(
              timing.revealMin,
              spanX * timing.msPerCol * DIR_LINES[L].pace,
            ),
          );
      const lineStart = cursor;
      const lineCx = (sampled.minX + sampled.maxX) * 0.5;
      const lineCy = (sampled.minY + sampled.maxY) * 0.5;

      const arrowSize = arrowSizeFor(fontPx);
      const gap = Math.max(3, Math.round(fontPx * 0.35));
      const textW = octx.measureText(DIR_LINES[L].text).width;
      const arrowW = arrowSize * 1.05;
      const totalW = textW + gap + arrowW;
      const startX = cx - totalW * 0.5;
      const bands = wordBandsAt(octx, DIR_LINES[L].text, startX);
      /* Arrow glyphs ride as their own idle word */
      bands.push({
        x0: startX + textW + gap * 0.35,
        x1: startX + totalW + 1,
      });
      const bandCount = Math.max(1, bands.length);
      const baseWid = dIdleWords.length;
      const wordReady = new Float32Array(bandCount);
      for (let b = 0; b < bandCount; b++) {
        wordReady[b] = lineStart;
        dIdleWords.push(createIdleWord(lineStart));
      }

      for (let g = 0; g < sampled.glyph.length; g++) {
        const i = sampled.glyph[g];
        const x = i % cols;
        const y = (i / cols) | 0;
        const xNorm = (x - sampled.minX) / spanX;
        const yRipple = ((y - sampled.minY) / spanY - 0.5) * 22;
        const clusterX = (x / 2) | 0;
        const clusterY = (y / 2) | 0;
        const clusterId = clusterX + clusterY * 4099 + L * 9176;
        const clusterOff =
          (hash01(clusterId, 0xc01) - 0.5) * timing.clusterMs;
        const jitter = (hash01(i, 0xc11 + L) - 0.5) * timing.jitterMs;
        const n1 = hash01(i, 0xc22 + L);

        let litAt = instant
          ? 0
          : lineStart + xNorm * revealMs + yRipple + clusterOff + jitter;
        if (!instant) {
          litAt = Math.max(lineStart, Math.min(lineStart + revealMs - 8, litAt));
        }

        const bi = bandIndexForX(x, bands);
        if (litAt > wordReady[bi]) wordReady[bi] = litAt;

        dTarget[i] = 1;
        dOnAt[i] = litAt;
        dDetachAt[i] = HOLD_SENTINEL;
        dGoneAt[i] = HOLD_SENTINEL;
        dLevel[i] = 0.90 + n1 * 0.10;
        dWordId[i] = baseWid + bi;

        const nAng = hash01(clusterId, 0xc31);
        const nDist = hash01(i, 0xc32 + L);
        const nSpin = (hash01(i, 0xc33) - 0.5) * 0.85;
        let baseAng = Math.atan2(y - lineCy, x - lineCx);
        if (!isFinite(baseAng) || (x === lineCx && y === lineCy)) {
          baseAng = nAng * Math.PI * 2;
        }
        const ang = baseAng + nSpin + (nAng - 0.5) * 0.55;
        const dist = DIR_DRIFT_MIN + nDist * (DIR_DRIFT_MAX - DIR_DRIFT_MIN);
        dDriftX[i] = Math.cos(ang) * dist;
        dDriftY[i] = Math.sin(ang) * dist;
      }

      for (let b = 0; b < bandCount; b++) {
        dIdleWords[baseWid + b].readyAt = instant ? 0 : wordReady[b];
      }

      if (!instant) {
        const pad = Math.max(2, Math.round(fontPx * 0.35));
        const bx0 = Math.max(0, sampled.minX - pad);
        const bx1 = Math.min(cols - 1, sampled.maxX + pad);
        const by0 = Math.max(0, sampled.minY - pad);
        const by1 = Math.min(rows - 1, sampled.maxY + pad);
        const lineEnd = lineStart + revealMs;

        for (let y = by0; y <= by1; y++) {
          for (let x = bx0; x <= bx1; x++) {
            const i = y * cols + x;
            if (dTarget[i]) continue;
            if (hash01(i, 0xc44 + L * 17) > DIR_SPARK_RATIO) continue;
            const xNorm = (x - sampled.minX) / spanX;
            const n1 = hash01(i, 0xc55 + L);
            const n2 = hash01(i, 0xc66 + L);
            const waveT = lineStart + Math.max(0, Math.min(revealMs, xNorm * revealMs));
            const sparkOn = Math.max(
              lineStart,
              waveT -
                timing.sparkLeadMs +
                (n1 - 0.5) * timing.sparkSpreadMs,
            );
            const life = timing.sparkLifeMin + n2 * timing.sparkLifeSpan;
            const sparkGone = Math.min(lineEnd - 16, sparkOn + life);
            if (sparkGone <= sparkOn) continue;
            dOnAt[i] = sparkOn;
            dDetachAt[i] = sparkGone;
            dGoneAt[i] = sparkGone;
            dLevel[i] = 0.48 + n1 * 0.28;
          }
        }
      }

      cursor = lineStart + revealMs;
      if (L < lineCount - 1) cursor += instant ? 0 : timing.linePause;
    }

    assembleMs = cursor;
    freezeDirectoryBitmap();
  }

  /*
    Rebuild dHide from the masked-key set. Masking is geometric — the whole
    keyed line goes dark (prefix included) so the command layer can redraw
    the prompt slash at entry size. Survives rebakes without re-measure.
  */
  function applyS2Masks() {
    if (!dHide) return;
    dHide.fill(0);
    if (!s2MaskedKeys.size) return;
    s2MaskedKeys.forEach((key) => {
      const m = s2LineMetrics.get(key);
      if (!m) return;
      const pad = Math.max(2, Math.round(m.fontPx * 0.35));
      const x0 = Math.max(0, Math.round(m.minX) - pad);
      const x1 = Math.min(cols - 1, Math.round(m.maxX) + pad);
      const y0 = Math.max(0, Math.round(m.minY) - pad);
      const y1 = Math.min(rows - 1, Math.round(m.maxY) + pad);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) dHide[y * cols + x] = 1;
      }
    });
  }

  /**
   * Grid-space geometry of a keyed Screen 2 line, or null when Screen 2
   * content is not currently baked into the shared directory buffers.
   * @param {string} key
   */
  function getScreen2LineMetrics(key) {
    if (menuSurface !== 2) return null;
    const m = s2LineMetrics.get(key);
    return m ? { ...m } : null;
  }

  /**
   * Clear (or restore) a keyed Screen 2 line while the command box owns it.
   * @param {string} key
   * @param {boolean} masked
   */
  function setScreen2LineMasked(key, masked) {
    if (masked) s2MaskedKeys.add(key);
    else s2MaskedKeys.delete(key);
    applyS2Masks();
  }

  /* ── Screen 2 command overlay ─────────────────────────────────────────── */

  function releaseCommandBuffers() {
    cmdChrome = null;
    cmdChromeAt = null;
    cmdRow = null;
    cmdRowMul = null;
    cmdDriftX = null;
    cmdDriftY = null;
    cmdEntry = null;
    cmdCaret = null;
    cmdOn = null;
    cmdOx = null;
    cmdOy = null;
  }

  function commandContext() {
    if (!(cols > 0) || !(rows > 0)) return null;
    const off = document.createElement('canvas');
    off.width = cols;
    off.height = rows;
    const octx = off.getContext('2d', { alpha: false });
    if (!octx) return null;
    octx.font = `600 ${commandFontPx()}px ${DIR_FONT}`;
    octx.textAlign = 'left';
    octx.textBaseline = 'middle';
    return octx;
  }

  /** Entry / prompt size in grid units (between menu and options). */
  function commandFontPx() {
    const m = s2LineMetrics.get(cmdKey);
    if (!m || !(m.fontPx > 0)) return 0;
    return Math.max(5, Math.round(m.fontPx * CMD_ENTRY_SCALE));
  }

  /**
   * Box + entry geometry in grid units, derived from the keyed line the
   * command layer opened against. The prompt slash is redrawn at entry size
   * inside the box; typed text resumes after it.
   * Dimensions are whole cells so the frame lands on the lattice.
   */
  function commandGeometry() {
    const m = s2LineMetrics.get(cmdKey);
    if (!m || !(m.fontPx > 0)) return null;
    const menuFontPx = m.fontPx;
    const entryFontPx = Math.max(5, Math.round(menuFontPx * CMD_ENTRY_SCALE));
    const optionFontPx = Math.max(4, Math.round(menuFontPx * CMD_OPTION_SCALE));
    const padX = Math.max(2, Math.round(entryFontPx * 0.28));
    const padY = Math.max(1, Math.round(entryFontPx * 0.16));
    const boxH = Math.max(3, entryFontPx + padY * 2);
    const boxW = Math.max(8, Math.round(entryFontPx * CMD_BOX_W_EM));
    const radius = Math.max(1, Math.round(entryFontPx * 0.22));
    const boxLeft = Math.round(m.minX) - padX;
    const boxTop = Math.round(m.cy - boxH * 0.5);
    const promptX = m.startX;
    return {
      fontPx: entryFontPx,
      menuFontPx,
      entryFontPx,
      optionFontPx,
      padX,
      boxH,
      boxLeft,
      boxTop,
      boxW,
      radius,
      cy: m.cy,
      promptX,
      entryX: promptX, /* refined in bakeCommandEntry after measuring '/' */
    };
  }

  function roundRectPath(c, x, y, w, h, r) {
    const rad = Math.max(0, Math.min(r, w * 0.5, h * 0.5));
    if (typeof c.roundRect === 'function') {
      c.beginPath();
      c.roundRect(x, y, w, h, rad);
      return;
    }
    c.beginPath();
    c.moveTo(x + rad, y);
    c.arcTo(x + w, y, x + w, y + h, rad);
    c.arcTo(x + w, y + h, x, y + h, rad);
    c.arcTo(x, y + h, x, y, rad);
    c.arcTo(x, y, x + w, y, rad);
    c.closePath();
  }

  /**
   * Rasterize one overlay element into a level buffer. When `rowStart` is a
   * number the lit cells also receive the directory assemble language —
   * left→right wave plus an outward spawn offset they migrate home from.
   * @param {CanvasRenderingContext2D} octx
   * @param {Float32Array} level
   * @param {(c: CanvasRenderingContext2D) => void} draw
   * @param {number} lv
   * @param {number|null} rowStart
   * @param {number} rowId  -1 leaves row tagging untouched
   * @param {number} [ink]  Coverage a cell needs to count as lit
   */
  function stampCommandPass(octx, level, draw, lv, rowStart, rowId, ink) {
    const cut = ink != null ? ink : 140;
    octx.fillStyle = '#000';
    octx.fillRect(0, 0, cols, rows);
    octx.fillStyle = '#fff';
    octx.strokeStyle = '#fff';
    draw(octx);

    const data = octx.getImageData(0, 0, cols, rows).data;
    const n = cols * rows;
    const hits = [];
    let minX = cols;
    let maxX = -1;
    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < n; i++) {
      if (data[i * 4] <= cut) continue;
      hits.push(i);
      const x = i % cols;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      sumX += x;
      sumY += (i / cols) | 0;
    }
    if (!hits.length) return;

    const spanX = Math.max(1, maxX - minX);
    const midX = sumX / hits.length;
    const midY = sumY / hits.length;

    for (let h = 0; h < hits.length; h++) {
      const i = hits[h];
      if (lv > level[i]) level[i] = lv;
      if (rowId >= 0 && cmdRow) cmdRow[i] = rowId;
      if (rowStart == null || !cmdChromeAt) continue;
      const x = i % cols;
      const y = (i / cols) | 0;
      const xNorm = (x - minX) / spanX;
      const jitter = (hash01(i, 0xa71) - 0.5) * CMD_JITTER_MS;
      cmdChromeAt[i] = Math.max(
        rowStart,
        rowStart + xNorm * CMD_REVEAL_MS + jitter
      );
      let ang = Math.atan2(y - midY, x - midX);
      if (!isFinite(ang)) ang = hash01(i, 0xa74) * Math.PI * 2;
      ang += (hash01(i, 0xa72) - 0.5) * 0.9;
      const dist =
        CMD_DRIFT_MIN + hash01(i, 0xa73) * (CMD_DRIFT_MAX - CMD_DRIFT_MIN);
      cmdDriftX[i] = Math.cos(ang) * dist;
      cmdDriftY[i] = Math.sin(ang) * dist;
    }
  }

  /**
   * Bake box chrome and the option stack. Rows assemble bottom-to-top so the
   * list reads as rising out of the box.
   * @param {boolean} instant
   */
  function bakeCommandChrome(instant) {
    const geo = commandGeometry();
    if (!geo) return false;
    const octx = commandContext();
    if (!octx) return false;

    const n = cols * rows;
    cmdChrome = new Float32Array(n);
    cmdChromeAt = new Float32Array(n);
    cmdRow = new Uint8Array(n);
    cmdDriftX = new Float32Array(n);
    cmdDriftY = new Float32Array(n);
    cmdEntry = new Float32Array(n);
    cmdCaret = new Float32Array(n);
    cmdOn = new Float32Array(n);
    cmdOx = new Float32Array(n);
    cmdOy = new Float32Array(n);
    cmdRowMul = new Float32Array(cmdOptions.length + 1).fill(1);

    /* Whole-cell frame + 1-LED stroke — edges read as lattice, not a smear. */
    const bx = geo.boxLeft + 0.5;
    const by = geo.boxTop + 0.5;
    const bw = Math.max(4, geo.boxW - 1);
    const bh = Math.max(3, geo.boxH - 1);
    stampCommandPass(
      octx,
      cmdChrome,
      (c) => {
        c.lineWidth = 1;
        c.lineJoin = 'round';
        roundRectPath(c, bx, by, bw, bh, geo.radius);
        c.stroke();
      },
      CMD_BOX_LEVEL,
      instant ? null : 0,
      0,
      80
    );

    /* Prompt slash at entry size — menu glyph is masked so sizes match. */
    const entryFont = geo.entryFontPx;
    stampCommandPass(
      octx,
      cmdChrome,
      (c) => {
        c.font = `600 ${entryFont}px ${DIR_FONT}`;
        c.fillText('/', geo.promptX, geo.cy);
      },
      1,
      instant ? null : 0,
      0
    );

    const count = cmdOptions.length;
    const optFont = geo.optionFontPx;
    octx.font = `600 ${optFont}px ${DIR_FONT}`;
    const rowStride = optFont * CMD_ROW_STRIDE;
    const bottomCy = geo.boxTop - optFont * CMD_LIST_GAP - optFont * 0.5;
    const nameX = geo.boxLeft + geo.padX;
    let nameCol = 0;
    for (let r = 0; r < count; r++) {
      nameCol = Math.max(nameCol, octx.measureText(cmdOptions[r].name).width);
    }
    nameCol += optFont * 0.85;

    for (let r = 0; r < count; r++) {
      const cy = bottomCy - (count - 1 - r) * rowStride;
      const start = CMD_BOX_MS + (count - 1 - r) * CMD_ROW_STAGGER;
      const opt = cmdOptions[r];
      stampCommandPass(
        octx,
        cmdChrome,
        (c) => {
          c.font = `600 ${optFont}px ${DIR_FONT}`;
          c.fillText(opt.name, nameX, cy);
        },
        1,
        instant ? null : start,
        r + 1
      );
      if (opt.hint) {
        stampCommandPass(
          octx,
          cmdChrome,
          (c) => {
            c.font = `600 ${optFont}px ${DIR_FONT}`;
            c.fillText(opt.hint, nameX + nameCol, cy);
          },
          CMD_HINT_LEVEL,
          instant ? null : start + 40,
          r + 1
        );
      }
    }

    cmdEntryAt = instant ? 0 : CMD_BOX_MS + CMD_REVEAL_MS * 0.5;
    return true;
  }

  /**
   * Freeze idle float on every word of the line the box grew from, so the
   * surviving prompt glyph stays centered in its frame.
   * @param {boolean} pinned
   */
  function setCommandLinePinned(pinned) {
    dPinWord = null;
    if (!pinned || !dWordId || !dIdleWords.length) return;
    const m = s2LineMetrics.get(cmdKey);
    if (!m) return;
    const pad = Math.max(2, Math.round(m.fontPx * 0.35));
    const x0 = Math.max(0, Math.round(m.minX) - pad);
    const x1 = Math.min(cols - 1, Math.round(m.maxX) + pad);
    const y0 = Math.max(0, Math.round(m.minY) - pad);
    const y1 = Math.min(rows - 1, Math.round(m.maxY) + pad);
    const pins = new Uint8Array(dIdleWords.length);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const wid = dWordId[y * cols + x];
        if (wid >= 0 && wid < pins.length) pins[wid] = 1;
      }
    }
    dPinWord = pins;
  }

  /** Re-rasterize typed entry + caret. Instant — typing never re-assembles. */
  function bakeCommandEntry() {
    const geo = commandGeometry();
    if (!geo || !cmdEntry || !cmdCaret) return;
    const octx = commandContext();
    if (!octx) return;

    cmdEntry.fill(0);
    cmdCaret.fill(0);

    const entryFont = geo.entryFontPx;
    octx.font = `600 ${entryFont}px ${DIR_FONT}`;
    const promptW = octx.measureText('/').width;
    const entryX = geo.promptX + promptW;
    const text = cmdText;
    const textW = text ? octx.measureText(text).width : 0;
    if (text) {
      stampCommandPass(
        octx,
        cmdEntry,
        (c) => {
          c.font = `600 ${entryFont}px ${DIR_FONT}`;
          c.fillText(text, entryX, geo.cy);
        },
        1,
        null,
        -1
      );
    }

    /* Whole cells only — a fractional bar antialiases into a dim smear. */
    const caretX = Math.round(entryX + textW + entryFont * 0.12);
    const caretY = Math.round(geo.cy - entryFont * 0.55);
    const caretW = Math.max(1, Math.round(entryFont * 0.16) - 1);
    const caretH = Math.max(3, Math.round(entryFont * 1.1));
    stampCommandPass(
      octx,
      cmdCaret,
      (c) => c.fillRect(caretX, caretY, caretW, caretH),
      1,
      null,
      -1
    );
  }

  /** Rebake in place — resize / density keeps the box open and settled. */
  function rebakeCommandOverlay() {
    if (!cmdOpen || cmdClosing) return;
    if (!bakeCommandChrome(true)) {
      releaseCommandBuffers();
      return;
    }
    bakeCommandEntry();
    setCommandLinePinned(true);
  }

  /**
   * Composite the overlay for this frame: assemble wave, match emphasis,
   * typed entry, blinking caret — or the dismiss fade/pop.
   * @param {number} wall
   */
  function updateCommandOverlay(wall) {
    if (!cmdOpen || !cmdOn || cmdOn.length !== cols * rows) return false;
    const n = cols * rows;
    cmdOn.fill(0);
    cmdOx.fill(0);
    cmdOy.fill(0);

    /* Dismiss: reverse the assemble drift while fading out. */
    if (cmdClosing) {
      const u = Math.min(1, (wall - cmdCloseWall) / CMD_CLOSE_MS);
      const e = easeOutCubic(u);
      const fade = 1 - e;
      for (let i = 0; i < n; i++) {
        let level = 0;
        const lv = cmdChrome[i];
        if (lv > 0) level = lv * cmdRowMul[cmdRow[i]];
        if (cmdEntry[i] > level) level = cmdEntry[i];
        if (!(level > 0)) continue;
        cmdOn[i] = level * fade;
        cmdOx[i] = cmdDriftX[i] * e * CMD_CLOSE_POP;
        cmdOy[i] = cmdDriftY[i] * e * CMD_CLOSE_POP;
      }
      if (u >= 1) {
        finishCommandClose();
        return false;
      }
      return true;
    }

    const t = wall - cmdStartWall;
    const entryVisible = t >= cmdEntryAt;
    const caretPhase = (wall - cmdCaretWall) % CMD_CARET_MS;
    const caretLit = entryVisible && caretPhase < CMD_CARET_MS * 0.55;

    for (let i = 0; i < n; i++) {
      const lv = cmdChrome[i];
      if (lv > 0) {
        const at = cmdChromeAt[i];
        if (t >= at) {
          const e = easeOutCubic(Math.min(1, (t - at) / CMD_MIGRATE_MS));
          cmdOn[i] = lv * cmdRowMul[cmdRow[i]] * (0.35 + 0.65 * e);
          if (e < 1) {
            cmdOx[i] = cmdDriftX[i] * (1 - e);
            cmdOy[i] = cmdDriftY[i] * (1 - e);
          }
        }
      }
      if (!entryVisible) continue;
      if (cmdEntry[i] > cmdOn[i]) cmdOn[i] = cmdEntry[i];
      if (caretLit && cmdCaret[i] > cmdOn[i]) cmdOn[i] = cmdCaret[i];
    }
    return true;
  }

  /**
   * Grow the command box out of a keyed line's LED prefix.
   * @param {string} key
   * @param {{ name: string, hint?: string }[]} options
   * @returns {boolean}
   */
  function openScreen2Command(key, options) {
    if (menuSurface !== 2) return false;
    if (!s2LineMetrics.get(key)) return false;
    /* A dismiss mid-flight would leave stale buffers — cut it short. */
    if (cmdClosing) closeScreen2Command({ instant: true });
    cmdKey = key;
    cmdOptions = Array.isArray(options) ? options.slice() : [];
    cmdText = '';
    cmdOpen = true;
    cmdClosing = false;
    const animate = animConfig.motion && !prefersReduced;
    if (!bakeCommandChrome(!animate)) {
      closeScreen2Command({ instant: true });
      return false;
    }
    bakeCommandEntry();
    setCommandLinePinned(true);
    cmdStartWall = performance.now();
    cmdCaretWall = cmdStartWall;
    return true;
  }

  /**
   * @param {string} text  Typed entry after the LED prompt glyph
   * @param {number} [matchIndex]  Option the entry is a prefix of, else -1
   */
  function setScreen2CommandText(text, matchIndex) {
    if (!cmdOpen || cmdClosing) return;
    const next = String(text == null ? '' : text).slice(0, CMD_MAX_ENTRY);
    const match = matchIndex == null ? -1 : matchIndex | 0;
    if (next !== cmdText) {
      cmdText = next;
      /* Caret rides the entry — hold it solid through the keystroke. */
      cmdCaretWall = performance.now();
      bakeCommandEntry();
    }
    if (!cmdRowMul) return;
    for (let r = 1; r < cmdRowMul.length; r++) {
      cmdRowMul[r] = match < 0 || match === r - 1 ? 1 : CMD_DIM_LEVEL;
    }
  }

  function finishCommandClose() {
    cmdOpen = false;
    cmdClosing = false;
    cmdCloseWall = 0;
    cmdKey = null;
    cmdOptions = [];
    cmdText = '';
    dPinWord = null;
    releaseCommandBuffers();
    const done = cmdCloseDone;
    cmdCloseDone = null;
    if (done) done();
  }

  /**
   * Dismiss the command overlay. Defaults to a short fade/pop; pass
   * `{ instant: true }` for teardown paths that cannot wait a frame.
   * @param {{ instant?: boolean, onDone?: () => void }} [opts]
   */
  function closeScreen2Command(opts) {
    opts = opts || {};
    if (typeof opts.onDone === 'function') {
      const prev = cmdCloseDone;
      cmdCloseDone = prev
        ? () => {
            prev();
            opts.onDone();
          }
        : opts.onDone;
    }

    if (!cmdOpen && !cmdClosing) {
      const done = cmdCloseDone;
      cmdCloseDone = null;
      if (done) done();
      return;
    }

    const animate =
      !opts.instant &&
      animConfig.motion &&
      !prefersReduced &&
      !!cmdOn;

    if (!animate) {
      finishCommandClose();
      return;
    }

    if (cmdClosing) return;
    cmdClosing = true;
    cmdCloseWall = performance.now();
  }

  function isScreen2CommandOpen() {
    return cmdOpen;
  }

  /* Snapshot completed target glyphs once — read-only for all idle renders. */
  function freezeDirectoryBitmap() {
    const n = cols * rows;
    dBitmap = new Float32Array(n);
    if (!dTarget || !dLevel) return;
    for (let i = 0; i < n; i++) {
      if (dTarget[i]) dBitmap[i] = dLevel[i];
    }
  }

  /*
    Temporary render only: rebuild dOn from immutable dBitmap + per-word idle Y.
    Never mutates dBitmap / dTarget / dLevel.
  */
  function renderDirectoryFromBitmap(yCache) {
    if (!dOn || !dBitmap) return false;
    const n = cols * rows;
    dOn.fill(0);
    if (dOx) dOx.fill(0);
    if (dOy) dOy.fill(0);
    let any = false;
    for (let i = 0; i < n; i++) {
      const level = dBitmap[i];
      if (!(level > 0)) continue;
      if (dHide && dHide[i]) continue;
      any = true;
      const wid = dWordId ? dWordId[i] : -1;
      const pinned = wid >= 0 && dPinWord && dPinWord[wid];
      const shiftPx =
        !pinned && yCache && wid >= 0 && wid < yCache.length
          ? yCache[wid]
          : 0;
      const x = i % cols;
      const y = (i / cols) | 0;
      scatterIdleLight(dOn, x, y, level, shiftPx);
    }
    return any;
  }

  function paintDirectoryHold() {
    /* Exact post-generation bitmap — zero idle offset */
    if (!dBitmap) freezeDirectoryBitmap();
    renderDirectoryFromBitmap(null);
  }

  /**
   * Bake Screen 2 menu into the shared directory LED buffers.
   * Same assemble language as Screen 1 directory (DIR_TIMING, L→R wave).
   * Only content and dual-region positions differ.
   * @param {{ instant?: boolean, densityRebuild?: boolean }} [opts]
   */
  function bakeScreen2Menu(opts) {
    if (!directoryAllowed) {
      clearDirectoryLeds();
      return;
    }
    setMenuFade(1, 0);
    const instant = !!(opts && opts.instant);
    const timing =
      opts && opts.densityRebuild ? DIR_TIMING_DENSITY : DIR_TIMING;
    const n = cols * rows;
    dTarget = new Float32Array(n);
    dOn = new Float32Array(n);
    dLevel = new Float32Array(n);
    dOnAt = new Float32Array(n);
    dDetachAt = new Float32Array(n);
    dGoneAt = new Float32Array(n);
    dDriftX = new Float32Array(n);
    dDriftY = new Float32Array(n);
    dOx = new Float32Array(n);
    dOy = new Float32Array(n);
    dWordId = new Int16Array(n);
    dWordId.fill(-1);
    dHide = new Uint8Array(n);
    dIdleWords = [];
    dBitmap = null;
    s2LineMetrics.clear();
    assembleMs = 0;

    if (cols < 16 || rows < 16) return;

    const off = document.createElement('canvas');
    off.width = cols;
    off.height = rows;
    const octx = off.getContext('2d', { alpha: false });
    if (!octx) return;

    /* Same scaling language as Screen 1 directory (rows × 0.078 + fit),
       with smaller arrow chevrons reserved in the layout width. */
    let fontPx = Math.max(5, Math.floor(rows * 0.078));
    fontPx = fitDirFont(octx, S2_LINES, cols * 0.92, fontPx, S2_ARROW_SCALE);
    octx.font = `600 ${fontPx}px ${DIR_FONT}`;

    const lineGap = fontPx * 1.85;
    const insetY = Math.max(fontPx * 1.15, Math.round(rows * 0.07));
    const insetX = Math.max(fontPx * 0.75, Math.round(cols * 0.055));
    const cx = cols * 0.5;

    const topLines = S2_LINES.filter((l) => l.region === 'top');
    const bottomLines = S2_LINES.filter((l) => l.region === 'bottom');

    /** @type {{ line: typeof S2_LINES[0], cx: number, cy: number }[]} */
    const jobs = [];
    for (let t = 0; t < topLines.length; t++) {
      jobs.push({
        line: topLines[t],
        cx,
        cy: insetY + t * lineGap,
      });
    }
    const bottomBlock = Math.max(0, bottomLines.length - 1) * lineGap;
    const bottomBase = rows - insetY - bottomBlock;
    for (let b = 0; b < bottomLines.length; b++) {
      jobs.push({
        line: bottomLines[b],
        cx: insetX,
        cy: bottomBase + b * lineGap,
      });
    }

    let cursor = 0;

    for (let L = 0; L < jobs.length; L++) {
      const { line, cx: lx, cy: ly } = jobs[L];

      const sampled = sampleLineWithArrow(octx, line, lx, ly, fontPx, {
        align: line.align,
        arrowScale: S2_ARROW_SCALE,
      });
      if (!sampled.glyph.length) {
        if (!instant) cursor += timing.linePause;
        continue;
      }

      const spanX = Math.max(1, sampled.maxX - sampled.minX);
      const spanY = Math.max(1, sampled.maxY - sampled.minY);
      const revealMs = instant
        ? 0
        : Math.min(
            timing.revealMax,
            Math.max(
              timing.revealMin,
              spanX * timing.msPerCol * line.pace
            )
          );
      const lineStart = cursor;
      const lineCx = (sampled.minX + sampled.maxX) * 0.5;
      const lineCy = (sampled.minY + sampled.maxY) * 0.5;

      const startX = sampled.startX;
      const bands = wordBandsAt(octx, line.text, startX);
      if (line.arrow) {
        /* Arrow glyphs ride as their own idle word */
        bands.push({
          x0: startX + sampled.textW + sampled.gap * 0.35,
          x1: startX + sampled.totalW + 1,
        });
      }
      const bandCount = Math.max(1, bands.length);
      const baseWid = dIdleWords.length;
      const wordReady = new Float32Array(bandCount);
      for (let b = 0; b < bandCount; b++) {
        wordReady[b] = lineStart;
        dIdleWords.push(createIdleWord(lineStart));
      }

      if (line.key) {
        s2LineMetrics.set(line.key, {
          cell: ledCell,
          fontPx,
          startX,
          cy: ly,
          prefixW: line.prefix ? octx.measureText(line.prefix).width : 0,
          minX: sampled.minX,
          maxX: sampled.maxX,
          minY: sampled.minY,
          maxY: sampled.maxY,
        });
      }

      for (let g = 0; g < sampled.glyph.length; g++) {
        const i = sampled.glyph[g];
        const x = i % cols;
        const y = (i / cols) | 0;
        const xNorm = (x - sampled.minX) / spanX;
        const yRipple = ((y - sampled.minY) / spanY - 0.5) * 22;
        const clusterX = (x / 2) | 0;
        const clusterY = (y / 2) | 0;
        const clusterId = clusterX + clusterY * 4099 + L * 9176;
        const clusterOff =
          (hash01(clusterId, 0xc01) - 0.5) * timing.clusterMs;
        const jitter = (hash01(i, 0xc11 + L) - 0.5) * timing.jitterMs;
        const n1 = hash01(i, 0xc22 + L);

        /* Same L→R wave as Screen 1 directory assemble */
        let litAt = instant
          ? 0
          : lineStart + xNorm * revealMs + yRipple + clusterOff + jitter;
        if (!instant) {
          litAt = Math.max(
            lineStart,
            Math.min(lineStart + revealMs - 8, litAt)
          );
        }

        const bi = bandIndexForX(x, bands);
        if (litAt > wordReady[bi]) wordReady[bi] = litAt;

        dTarget[i] = 1;
        dOnAt[i] = litAt;
        dDetachAt[i] = HOLD_SENTINEL;
        dGoneAt[i] = HOLD_SENTINEL;
        dLevel[i] = 0.9 + n1 * 0.1;
        dWordId[i] = baseWid + bi;

        const nAng = hash01(clusterId, 0xc31);
        const nDist = hash01(i, 0xc32 + L);
        const nSpin = (hash01(i, 0xc33) - 0.5) * 0.85;
        let baseAng = Math.atan2(y - lineCy, x - lineCx);
        if (!isFinite(baseAng) || (x === lineCx && y === lineCy)) {
          baseAng = nAng * Math.PI * 2;
        }
        const ang = baseAng + nSpin + (nAng - 0.5) * 0.55;
        const dist = DIR_DRIFT_MIN + nDist * (DIR_DRIFT_MAX - DIR_DRIFT_MIN);
        dDriftX[i] = Math.cos(ang) * dist;
        dDriftY[i] = Math.sin(ang) * dist;
      }

      for (let b = 0; b < bandCount; b++) {
        dIdleWords[baseWid + b].readyAt = instant ? 0 : wordReady[b];
      }

      if (!instant) {
        const pad = Math.max(2, Math.round(fontPx * 0.35));
        const bx0 = Math.max(0, sampled.minX - pad);
        const bx1 = Math.min(cols - 1, sampled.maxX + pad);
        const by0 = Math.max(0, sampled.minY - pad);
        const by1 = Math.min(rows - 1, sampled.maxY + pad);
        const lineEnd = lineStart + revealMs;

        for (let y = by0; y <= by1; y++) {
          for (let x = bx0; x <= bx1; x++) {
            const i = y * cols + x;
            if (dTarget[i]) continue;
            if (hash01(i, 0xc44 + L * 17) > DIR_SPARK_RATIO) continue;
            const xNorm = (x - sampled.minX) / spanX;
            const n1 = hash01(i, 0xc55 + L);
            const n2 = hash01(i, 0xc66 + L);
            const waveT =
              lineStart + Math.max(0, Math.min(revealMs, xNorm * revealMs));
            const sparkOn = Math.max(
              lineStart,
              waveT -
                timing.sparkLeadMs +
                (n1 - 0.5) * timing.sparkSpreadMs
            );
            const life = timing.sparkLifeMin + n2 * timing.sparkLifeSpan;
            const sparkGone = Math.min(lineEnd - 16, sparkOn + life);
            if (sparkGone <= sparkOn) continue;
            dOnAt[i] = sparkOn;
            dDetachAt[i] = sparkGone;
            dGoneAt[i] = sparkGone;
            dLevel[i] = 0.48 + n1 * 0.28;
          }
        }
      }

      cursor = lineStart + revealMs;
      if (!instant && L < jobs.length - 1) cursor += timing.linePause;
    }

    assembleMs = cursor;
    freezeDirectoryBitmap();
    applyS2Masks();
    /* Line metrics just moved — re-raise an open command box onto them. */
    rebakeCommandOverlay();
  }

  /**
   * Activate Screen 2 menu on the shared PE typography buffers.
   * First visit plays assemble once; later visits idle-hold without replay.
   * @param {{ instant?: boolean, fromDensityRebuild?: boolean }} [opts]
   */
  function beginScreen2MenuSequence(opts) {
    opts = opts || {};
    if (killed || contentLocked) return;
    ensureGrid();
    clearDissolveTimer();
    clearIntroLeds();
    directoryAllowed = true;
    menuSurface = 2;

    /* Return visits snap; Pixel Density rebuilds always replay assemble. */
    const instant =
      !!opts.instant ||
      (!opts.fromDensityRebuild && screen2MenuPlayed) ||
      !animConfig.motion ||
      prefersReduced;

    bakeScreen2Menu(
      instant
        ? { instant: true }
        : opts.fromDensityRebuild
          ? { densityRebuild: true }
          : undefined
    );

    screen2MenuPlayed = true;

    if (instant || !(assembleMs > 0)) {
      paintDirectoryHold();
      phase = 'idle';
      holdingFF = false;
      timeScale = 1;
      typographySettled = true;
      setBoot(null);
      /* Return visit — no replay, so ease the settled text back in. */
      setMenuFade(0, 0);
      fadeMenuIn();
      /* Density rebuild unlock listens for hold — must fire on snap path too. */
      window.dispatchEvent(new CustomEvent('pixeldirectorystart'));
      window.dispatchEvent(new CustomEvent('pixeldirectoryhold'));
      return;
    }

    resetContentClock();
    phase = 'directory';
    holdingFF = false;
    timeScale = 1;
    typographySettled = true;
    setBoot('directory');
    window.dispatchEvent(new CustomEvent('pixeldirectorystart'));
  }

  /** Settle Screen 2 menu to idle hold (mid-assemble leave / skip). */
  function settleScreen2Menu() {
    if (killed) return;
    ensureGrid();
    clearDissolveTimer();
    clearIntroLeds();
    directoryAllowed = true;
    menuSurface = 2;
    screen2MenuPlayed = true;
    bakeScreen2Menu({ instant: true });
    paintDirectoryHold();
    phase = 'idle';
    holdingFF = false;
    timeScale = 1;
    typographySettled = true;
    setBoot(null);
    window.dispatchEvent(new CustomEvent('pixeldirectoryhold'));
  }

  /** Restore Screen 1 directory menu into the shared PE typography buffers. */
  function restoreScreen1Menu() {
    if (killed || contentLocked) return;
    closeScreen2Command({ instant: true });
    ensureGrid();
    clearDissolveTimer();
    clearIntroLeds();
    directoryAllowed = true;
    menuSurface = 1;
    if (cols >= 12 && rows >= 8 && animConfig.motion && !prefersReduced) {
      bakeDirectory({ instant: true });
      paintDirectoryHold();
    } else {
      clearDirectoryLeds();
    }
    phase = 'idle';
    holdingFF = false;
    timeScale = 1;
    typographySettled = true;
    setBoot(null);
    setMenuFade(0, 0);
    fadeMenuIn();
  }

  function getMenuSurface() {
    return menuSurface;
  }

  function hasPlayedScreen2Menu() {
    return screen2MenuPlayed;
  }

  /* ── content phase API (driven by Boot Controller) ─────────────────────── */

  /**
   * Clear all content LEDs and lock the intro out of the PE canvas
   * until typography construction is explicitly started.
   * Directory pixels are destroyed — not hidden — until post-boot reveal.
   * Preserves menuSurface so a Pixel Density rebuild on Screen 2 rebakes /
   * replays Screen 2 menu instead of falling back to Screen 1 directory.
   */
  function suppressContent() {
    closeScreen2Command({ instant: true });
    clearDissolveTimer();
    clearIntroLeds();
    directoryAllowed = false;
    clearDirectoryLeds();
    contentLocked = true;
    phase = 'idle';
    typographySettled = false;
    holdingFF = false;
    timeScale = 1;
    resetContentClock();
    /* Do not touch data-boot — boot controller owns it during exclusive phases */
  }

  /**
   * Density recalibration arm — hide menu, lock content, adopt NEW grid geometry.
   * Prefer destroyGridState + rasterizeMenuForGrid from the density pipeline.
   * @param {number} nextCols
   * @param {number} nextRows
   * @param {{ cols?: number, rows?: number, cell?: number }} [gridInfo]
   */
  function armDensityRecalibration(nextCols, nextRows, gridInfo) {
    destroyGridState();
    if (gridInfo && gridInfo.cols > 0 && gridInfo.rows > 0) {
      adoptGrid(gridInfo);
    } else {
      cols = nextCols | 0;
      rows = nextRows | 0;
      if (sharedGrid && sharedGrid.cell > 0) ledCell = sharedGrid.cell;
    }
    contentLocked = true;
    directoryAllowed = false;
  }

  /**
   * Stage 4 — bake menu LEDs for the new grid while keeping content locked
   * so nothing paints until the rebuild animation finishes.
   * @param {{ cols: number, rows: number, cell?: number }} gridInfo
   * @param {{ densityRebuild?: boolean, instant?: boolean }} [opts]
   */
  function rasterizeMenuForGrid(gridInfo, opts) {
    opts = opts || {};
    destroyIntroLeds();
    clearDirectoryLeds();
    idleYCache = null;
    if (gridInfo) adoptGrid(gridInfo);
    else ensureGrid();
    clearDissolveTimer();
    killed = false;
    /* Allow bake buffers; keep locked so brightness()/update stay silent. */
    directoryAllowed = true;
    contentLocked = true;
    const bakeOpts = opts.instant
      ? { instant: true }
      : opts.densityRebuild !== false
        ? { densityRebuild: true }
        : undefined;
    if (menuSurface === 2) bakeScreen2Menu(bakeOpts);
    else bakeDirectory(bakeOpts);
    phase = 'idle';
    typographySettled = true;
    holdingFF = false;
    timeScale = 1;
    resetContentClock();
  }

  /**
   * Stage 6 — unlock and play (or snap) the pre-rasterized menu.
   * Rebakes only if stage 4 never produced buffers.
   * @param {{ cols: number, rows: number, cell?: number }} gridInfo
   * @param {{ fromDensityRebuild?: boolean, instant?: boolean }} [opts]
   */
  function revealMenuAfterRebuild(gridInfo, opts) {
    opts = opts || {};
    if (gridInfo) adoptGrid(gridInfo);
    clearDissolveTimer();
    killed = false;
    contentLocked = false;
    directoryAllowed = true;
    clearIntroLeds();

    if (!dOn || !dBitmap) {
      const bakeOpts = opts.instant
        ? { instant: true }
        : { densityRebuild: true };
      if (menuSurface === 2) bakeScreen2Menu(bakeOpts);
      else bakeDirectory(bakeOpts);
    }

    /* Keep Screen 2 session latch in sync when density rebuilds on Screen 2. */
    if (menuSurface === 2) screen2MenuPlayed = true;

    if (opts.instant) {
      paintDirectoryHold();
      phase = 'idle';
      holdingFF = false;
      timeScale = 1;
      typographySettled = true;
      setBoot(null);
      clearAppStartup();
      window.dispatchEvent(new CustomEvent('pixeldirectorystart'));
      window.dispatchEvent(new CustomEvent('pixeldirectoryhold'));
      return;
    }

    resetContentClock();
    phase = 'directory';
    setBoot('directory');
    clearAppStartup();
    window.dispatchEvent(new CustomEvent('pixeldirectorystart'));
  }

  /**
   * Regenerate the pixel menu specifically for an authoritative grid and replay.
   * @param {{ cols: number, rows: number, cell?: number }} gridInfo
   * @param {{ fromDensityRebuild?: boolean, instant?: boolean }} [opts]
   */
  function rebuildMenuForGrid(gridInfo, opts) {
    opts = opts || {};
    rasterizeMenuForGrid(gridInfo, {
      densityRebuild: !!opts.fromDensityRebuild,
      instant: !!opts.instant,
    });
    revealMenuAfterRebuild(gridInfo, opts);
  }

  function beginTypographyConstruction(opts) {
    opts = opts || {};
    if (killed) return;
    contentLocked = false;
    directoryAllowed = false;
    ensureGrid();
    clearDissolveTimer();
    clearIntroLeds();
    clearDirectoryLeds();
    bakeIntro({ seedCells: opts.seedCells || null });
    resetContentClock();
    typographySettled = false;
    phase = 'typography';
    setBoot('typography');
    window.dispatchEvent(new CustomEvent('pixelintrostart'));
  }

  function getTypographyDurationMs() {
    return typographyDurationMs || 0;
  }

  function isTypographySettled() {
    if (typographySettled) return true;
    if (phase !== 'typography') return false;
    if (contentElapsed >= typographyDurationMs) {
      typographySettled = true;
      return true;
    }
    return false;
  }

  function holdTypography() {
    if (phase !== 'typography' && phase !== 'idle') return;
    typographySettled = true;
    /* Keep glyphs pinned at home — idle float stays paused until directory */
    pauseIdleWords(iIdleWords, contentElapsed);
  }

  function enterDirectoryPhase() {
    if (killed) return;
    directoryAllowed = true;
    clearIntroLeds();
    if (!dOn) bakeDirectory();

    /* Boot is finished — enable intro directory and release the app shell
       (topnav, Screen 2, scroll, snap) without boot owning layout anymore. */
    clearAppStartup();

    resetContentClock();
    phase = 'directory';
    setBoot('directory');
    window.dispatchEvent(new CustomEvent('pixeldirectorystart'));
  }

  function enterIdle() {
    directoryMagLock = false;
    phase = 'idle';
    holdingFF = false;
    timeScale = 1;
    setBoot(null);
    /* Safety net — shell normally unlocks when intro/directory is enabled. */
    clearAppStartup();
    paintDirectoryHold();
    window.dispatchEvent(new CustomEvent('pixeldirectoryhold'));
  }

  function beginDirectorySequence(opts) {
    opts = opts || {};
    clearDissolveTimer();
    killed = false;
    contentLocked = false;
    directoryAllowed = true;
    menuSurface = 1;

    if (opts.fromMotionReenable || opts.fromDensityRebuild) {
      /* Density rebuild must use the authority grid — never recompute independently. */
      if (opts.grid) adoptGrid(opts.grid);
      else ensureGrid();
      clearIntroLeds();
      bakeDirectory(
        opts.instant
          ? { instant: true }
          : opts.fromDensityRebuild
            ? { densityRebuild: true }
            : undefined,
      );
      enterDirectoryPhase();
      return;
    }

    /* Soft dissolve of hero type, then directory assemble */
    if (iTarget && phase === 'typography') {
      phase = 'dissolving';
      setBoot('typography');
      const dissolveMs = armIntroDissolve(contentElapsed);
      const wait = Math.max(200, dissolveMs / Math.max(0.001, timeScale));
      dissolveTimer = setTimeout(function () {
        dissolveTimer = null;
        if (killed) return;
        directoryAllowed = true;
        bakeDirectory();
        enterDirectoryPhase();
      }, wait);
      return;
    }

    bakeDirectory();
    enterDirectoryPhase();
  }

  function skipToDirectoryHold(opts) {
    opts = opts || {};
    clearDissolveTimer();
    directoryMagLock = false;
    contentLocked = false;
    directoryAllowed = true;
    ensureGrid();
    clearIntroLeds();
    const canPaint =
      cols >= 12 && rows >= 8 && animConfig.motion && !prefersReduced;

    /*
      Space-skip only: show the completed menu immediately and play Magnetic
      Lock (edge-displaced converge + lock flash + micro shockwave). Hold +
      interaction unlock wait until the lock settles.
    */
    if (opts.settle && canPaint) {
      bakeDirectory({ instant: true });
      if (dOn && dBitmap && captureMagLockBounds()) {
        seedMagLockDisplacements();
        directoryMagLock = true;
        assembleMs = MAG_LOCK_TOTAL_MS;
        resetContentClock();
        phase = 'directory';
        holdingFF = false;
        timeScale = 1;
        typographySettled = true;
        setBoot('directory');
        /* Magnetic Lock keeps the shell locked until hold fires. */
        window.dispatchEvent(new CustomEvent('pixeldirectorystart'));
        return;
      }
      directoryMagLock = false;
    }

    if (canPaint) {
      bakeDirectory({ instant: true });
      paintDirectoryHold();
    } else {
      clearDirectoryLeds();
    }
    phase = 'idle';
    holdingFF = false;
    timeScale = 1;
    typographySettled = true;
    setBoot(null);
    clearAppStartup();

    window.dispatchEvent(new CustomEvent('pixeldirectorystart'));
    window.dispatchEvent(new CustomEvent('pixeldirectoryhold'));
  }

  /* ── public control API ───────────────────────────────────────────────── */

  function beginFastForward() {
    if (!isActivePhase()) return;
    if (holdingFF) return;
    holdingFF = true;
    setTimeScale(FF_RATE);
  }

  function endFastForward() {
    if (!holdingFF) return;
    holdingFF = false;
    setTimeScale(1);
  }

  function skip() {
    if (phase === 'idle' || phase === 'skipped') return;
    /* Magnetic Lock already running — let it finish */
    if (directoryMagLock) return;
    clearDissolveTimer();
    /* Screen 2 assemble skip — settle Screen 2 menu, not Screen 1 directory. */
    if (menuSurface === 2) {
      settleScreen2Menu();
      return;
    }
    killed = true;
    skipToDirectoryHold({ settle: true });
  }

  function cancel() {
    closeScreen2Command({ instant: true });
    killed = true;
    contentLocked = false;
    directoryAllowed = false;
    menuSurface = 1;
    clearDissolveTimer();
    directoryMagLock = false;
    clearIntroLeds();
    clearDirectoryLeds();
    phase = 'skipped';
    holdingFF = false;
    timeScale = 1;
    typographySettled = false;
    resetContentClock();
    setBoot(null);
  }

  /* Boot controller owns scheduling — kept for API compatibility */
  function schedule() {
    /* no-op: BootController.schedule() starts the lifecycle */
  }

  /* ── per-frame LED update ─────────────────────────────────────────────── */

  function migrateProgress(i, t) {
    const onAt = iOnAt[i];
    if (t < onAt) return 0;
    const mig = iMigrateMs && iMigrateMs[i] > 0 ? iMigrateMs[i] : INTRO_MIGRATE_MS_MIN;
    const u = Math.max(0, Math.min(1, (t - onAt) / mig));
    return easeOutCubic(u);
  }

  function correctionOffset(i, t, arrived) {
    if (!arrived) return { x: 0, y: 0 };
    const onAt = iOnAt[i];
    const mig = iMigrateMs && iMigrateMs[i] > 0 ? iMigrateMs[i] : INTRO_MIGRATE_MS_MIN;
    const corrStart = onAt + mig;
    if (t < corrStart || t > corrStart + INTRO_CORRECT_MS) return { x: 0, y: 0 };
    const u = (t - corrStart) / INTRO_CORRECT_MS;
    const wobble = Math.sin(u * Math.PI) * (1 - u);
    const n = hash01(i, 0xc01) - 0.5;
    return {
      x: n * 1.1 * wobble,
      y: (hash01(i, 0xc02) - 0.5) * 0.9 * wobble,
    };
  }

  function updateIntroLeds(t) {
    if (!iOn) return false;
    let anyLit = false;
    let dissolving = false;
    const n = cols * rows;

    for (let i = 0; i < n; i++) {
      if (!iTarget || !iTarget[i]) continue;
      if (!(iGoneAt && iGoneAt[i] > iOnAt[i])) continue;
      if (iGoneAt[i] >= HOLD_SENTINEL * 0.5) continue;
      if (t < iOnAt[i] || t >= iGoneAt[i]) continue;
      const detachAt = iDetachAt[i];
      if (t >= detachAt && iGoneAt[i] > detachAt) {
        dissolving = true;
        break;
      }
    }

    if (dissolving || phase === 'dissolving') {
      pauseIdleWords(iIdleWords, t);
      for (let i = 0; i < n; i++) {
        if (!(iGoneAt && iGoneAt[i] > iOnAt[i])) {
          iOn[i] = 0; iOx[i] = 0; iOy[i] = 0;
          continue;
        }
        if (t < iOnAt[i] || t >= iGoneAt[i]) {
          iOn[i] = 0; iOx[i] = 0; iOy[i] = 0;
          continue;
        }
        iOn[i] = iLevel[i];
        anyLit = true;
        const detachAt = iDetachAt[i];
        if (iTarget[i] && t >= detachAt && iGoneAt[i] > detachAt && detachAt < HOLD_SENTINEL * 0.5) {
          const u = (t - detachAt) / (iGoneAt[i] - detachAt);
          const e = easeOutCubic(Math.max(0, Math.min(1, u)));
          iOx[i] = iDriftX[i] * e;
          iOy[i] = iDriftY[i] * e;
        } else {
          iOx[i] = 0;
          iOy[i] = 0;
        }
      }
      return anyLit;
    }

    /* Construction / hold: migrate into place, then fixed-grid light flow */
    const constructing = phase === 'typography' && !typographySettled;
    const yCache =
      !constructing && iIdleWords.length
        ? tickAllIdleWords(iIdleWords, t, false)
        : null;
    iOn.fill(0);

    for (let i = 0; i < n; i++) {
      iOx[i] = 0;
      iOy[i] = 0;
      if (!(iGoneAt && iGoneAt[i] > iOnAt[i])) continue;
      if (t < iOnAt[i]) continue;
      if (iGoneAt[i] < HOLD_SENTINEL * 0.5 && t >= iGoneAt[i]) continue;

      anyLit = true;
      const level = iLevel[i];

      if (iTarget && iTarget[i]) {
        const mig = migrateProgress(i, t);
        const arrived = mig >= 0.999;
        if (constructing || !arrived) {
          const remain = 1 - mig;
          const corr = correctionOffset(i, t, arrived || mig > 0.92);
          iOx[i] = iDriftX[i] * remain + corr.x;
          iOy[i] = iDriftY[i] * remain + corr.y;
          iOn[i] = level * (0.35 + mig * 0.65);
        } else {
          const wid = iWordId ? iWordId[i] : -1;
          const shiftPx = yCache && wid >= 0 ? yCache[wid] : 0;
          const x = i % cols;
          const y = (i / cols) | 0;
          scatterIdleLight(iOn, x, y, level, shiftPx);
        }
      } else {
        /* Sparks migrate briefly then stay pinned */
        const mig = migrateProgress(i, t);
        iOn[i] = level * (0.4 + mig * 0.6);
        iOx[i] = (iDriftX[i] || 0) * (1 - mig);
        iOy[i] = (iDriftY[i] || 0) * (1 - mig);
      }
    }
    return anyLit;
  }

  function updateDirectoryLeds(t) {
    if (!dOn) return false;
    if (!dBitmap) freezeDirectoryBitmap();

    /* Space-skip Magnetic Lock — displaced converge + lock + shockwave */
    if (directoryMagLock) {
      return updateMagneticLock(t);
    }

    let anyLit = false;
    const n = cols * rows;
    const yCache = dIdleWords.length
      ? tickAllIdleWords(dIdleWords, t, false)
      : null;
    dOn.fill(0);

    for (let i = 0; i < n; i++) {
      if (dOx) dOx[i] = 0;
      if (dOy) dOy[i] = 0;
      if (!(dGoneAt && dGoneAt[i] > dOnAt[i])) continue;
      if (t < dOnAt[i] || t >= dGoneAt[i]) continue;
      if (dHide && dHide[i]) continue;
      anyLit = true;

      if (dTarget && dTarget[i]) {
        const level = dBitmap ? dBitmap[i] : dLevel[i];
        const wid = dWordId ? dWordId[i] : -1;
        const shiftPx =
          yCache && wid >= 0 && wid < yCache.length ? yCache[wid] : 0;
        const x = i % cols;
        const y = (i / cols) | 0;
        scatterIdleLight(dOn, x, y, level, shiftPx);
      } else {
        dOn[i] = dLevel[i];
      }
    }
    return anyLit;
  }

  /**
   * @param {number} to
   * @param {number} ms
   */
  function setMenuFade(to, ms) {
    const next = Math.max(0, Math.min(1, to));
    const dur = Math.max(0, ms | 0);
    if (dur === 0) {
      menuFade = next;
      menuFadeFrom = next;
      menuFadeTo = next;
      menuFadeMs = 0;
      return;
    }
    if (menuFadeTo === next && menuFadeMs > 0) return;
    menuFadeFrom = menuFade;
    menuFadeTo = next;
    menuFadeMs = dur;
    menuFadeStartWall = performance.now();
  }

  function tickMenuFade(wall) {
    if (menuFadeMs <= 0 || menuFade === menuFadeTo) return;
    const u = Math.max(0, Math.min(1, (wall - menuFadeStartWall) / menuFadeMs));
    menuFade = menuFadeFrom + (menuFadeTo - menuFadeFrom) * easeInOutSine(u);
    if (u >= 1) {
      menuFade = menuFadeTo;
      menuFadeMs = 0;
    }
  }

  /** Clear menu text while a screen transition crosses the viewport. */
  function fadeMenuOut(ms) {
    setMenuFade(0, ms != null ? ms : 150);
  }

  /** Bring settled menu text back after arrival. */
  function fadeMenuIn(ms) {
    setMenuFade(1, ms != null ? ms : 260);
  }

  function update(now) {
    if (contentLocked) return false;

    const wall = now || performance.now();
    tickMenuFade(wall);
    const cmdAlive = updateCommandOverlay(wall);
    tickContentClock(wall);
    const t = phaseElapsedMs();

    if (phase === 'idle') {
      if (!directoryAllowed || !dBitmap) return cmdAlive;
      const yCache = dIdleWords.length
        ? tickAllIdleWords(dIdleWords, assembleMs + 1, false)
        : null;
      renderDirectoryFromBitmap(yCache);
      return true;
    }
    if (phase === 'typography' || phase === 'dissolving') {
      if (phase === 'typography') isTypographySettled();
      return updateIntroLeds(t) || cmdAlive;
    }
    if (phase === 'directory') {
      if (!directoryAllowed) return cmdAlive;
      updateDirectoryLeds(t);
      /* Stay alive for the whole assemble — returning only "any LED lit"
         let style rAF loops die before the first glyph, so pixeldirectoryhold
         never fired and Pixel Density stayed locked after one use. */
      if (assembleMs <= 0 || t >= assembleMs) {
        enterIdle();
      }
      return true;
    }
    return cmdAlive;
  }

  function brightness(i) {
    if (contentLocked) return 0;
    const a = iOn ? iOn[i] : 0;
    /* Directory contribution only after explicit post-boot reveal */
    const b = directoryAllowed && dOn ? dOn[i] * menuFade : 0;
    let v = a > b ? a : b;
    /* Command overlay shares the menu's transition fade — same surface */
    const c = cmdOn ? cmdOn[i] * menuFade : 0;
    if (c > v) v = c;
    return v;
  }

  function offsetX(i) {
    if (contentLocked) return 0;
    const c = cmdOx ? cmdOx[i] : 0;
    if (c) return c;
    const d = directoryAllowed && dOx ? dOx[i] : 0;
    if (d) return d;
    return iOx ? iOx[i] : 0;
  }

  function offsetY(i) {
    if (contentLocked) return 0;
    const c = cmdOy ? cmdOy[i] : 0;
    if (c) return c;
    const d = directoryAllowed && dOy ? dOy[i] : 0;
    if (d) return d;
    return iOy ? iOy[i] : 0;
  }

  function isActive() {
    if (contentLocked) return false;
    return isActivePhase() || phase === 'idle';
  }

  function onResize(nextCols, nextRows) {
    const c = nextCols | 0;
    const r = nextRows | 0;
    const cell =
      sharedGrid && sharedGrid.cell > 0 ? sharedGrid.cell : ledCell;
    if (c === cols && r === rows && cell === ledCell) return;
    adoptGrid({ cols: c, rows: r, cell });
    rebakeAfterGridChange();
  }

  /**
   * Pixel Density rebuild — always rebake from authoritative geometry so LED
   * maps stay aligned with Heat/Wave/Lightning. Prefer rebuildMenuForGrid
   * when the density pipeline supplies a frozen GridInfo.
   * @param {number} nextCols
   * @param {number} nextRows
   * @param {{ cols?: number, rows?: number, cell?: number }} [gridInfo]
   */
  function rebuildForDensity(nextCols, nextRows, gridInfo) {
    if (gridInfo && gridInfo.cols > 0 && gridInfo.rows > 0) {
      adoptGrid(gridInfo);
    } else {
      cols = nextCols | 0;
      rows = nextRows | 0;
      if (sharedGrid && sharedGrid.cell > 0) ledCell = sharedGrid.cell;
    }
    /* Drop idle caches keyed to the old pitch */
    idleYCache = null;
    iIdleWords = [];
    dIdleWords = [];

    /* During exclusive boot, never bake directory / type into the PE canvas */
    if (contentLocked) {
      clearIntroLeds();
      clearDirectoryLeds();
      return;
    }

    const gridSnap = { cols, rows, cell: ledCell };

    /* Menu animation active — rebuild LEDs and restart assemble on new grid */
    if (phase === 'directory' || phase === 'dissolving') {
      clearDissolveTimer();
      clearIntroLeds();
      clearDirectoryLeds();
      if (menuSurface === 2) {
        screen2MenuPlayed = false;
        beginScreen2MenuSequence({
          fromDensityRebuild: true,
        });
        return;
      }
      beginDirectorySequence({
        fromDensityRebuild: true,
        grid: gridSnap,
      });
      return;
    }

    /* Menu complete — regenerate pixel text without replaying intro */
    if (phase === 'idle' && directoryAllowed) {
      clearIntroLeds();
      if (menuSurface === 2) {
        bakeScreen2Menu({ instant: true });
      } else {
        bakeDirectory({ instant: true });
      }
      paintDirectoryHold();
      return;
    }

    /* Intro typography — nav is locked during play. If type already settled
       (ready delay before menu), jump straight into a menu rebuild. */
    if (phase === 'typography') {
      clearDirectoryLeds();
      if (typographySettled) {
        clearIntroLeds();
        beginDirectorySequence({
          fromDensityRebuild: true,
          grid: gridSnap,
        });
        return;
      }
      bakeIntro();
      return;
    }

    clearDirectoryLeds();
  }

  function rebakeAfterGridChange() {
    /* Window resize — soft rebake; density uses rebuildForDensity (may restart menu). */
    if (contentLocked) {
      clearIntroLeds();
      clearDirectoryLeds();
      return;
    }

    if (phase === 'typography' || phase === 'dissolving') {
      clearDirectoryLeds();
      bakeIntro();
    } else if (phase === 'directory' && directoryAllowed) {
      if (menuSurface === 2) bakeScreen2Menu();
      else bakeDirectory();
    } else if (phase === 'idle' && directoryAllowed && dBitmap) {
      if (menuSurface === 2) bakeScreen2Menu({ instant: true });
      else bakeDirectory({ instant: true });
      paintDirectoryHold();
    } else {
      clearDirectoryLeds();
    }
  }

  /* ── input wiring ─────────────────────────────────────────────────────── */

  function bindInputs() {
    const stage = document.getElementById('stage');
    if (stage) {
      stage.addEventListener('mousedown', function (e) {
        if (performance.now() < touchGuardUntil) return;
        if (e.button != null && e.button !== 0) return;
        beginFastForward();
      });
      stage.addEventListener('mouseleave', endFastForward);
      stage.addEventListener(
        'touchstart',
        function (e) {
          if (!isActivePhase()) return;
          touchGuardUntil = performance.now() + 650;
          if (e.cancelable) e.preventDefault();
          beginFastForward();
        },
        { passive: false }
      );
      stage.addEventListener('touchend', endFastForward, { passive: true });
      stage.addEventListener('touchcancel', endFastForward, { passive: true });
    }

    window.addEventListener('mouseup', endFastForward);
    /* Space skip is owned by the Boot Controller */
  }

  bindInputs();

  return {
    brightness: brightness,
    offsetX: offsetX,
    offsetY: offsetY,
    update: update,
    isActive: isActive,
    onResize: onResize,
    rebuildForDensity: rebuildForDensity,
    cancel: cancel,
    schedule: schedule,
    beginFastForward: beginFastForward,
    endFastForward: endFastForward,
    skip: skip,
    skipIntro: skip,
    finishIntro: skip,
    timeScale: setTimeScale,
    getPhase: function () { return phase; },
    isControllable: isActivePhase,

    /* Boot content API */
    suppressContent: suppressContent,
    destroyGridState: destroyGridState,
    adoptGrid: adoptGrid,
    getLedCell: getLedCell,
    armDensityRecalibration: armDensityRecalibration,
    rasterizeMenuForGrid: rasterizeMenuForGrid,
    revealMenuAfterRebuild: revealMenuAfterRebuild,
    rebuildMenuForGrid: rebuildMenuForGrid,
    beginTypographyConstruction: beginTypographyConstruction,
    getTypographyDurationMs: getTypographyDurationMs,
    isTypographySettled: isTypographySettled,
    holdTypography: holdTypography,
    beginDirectorySequence: beginDirectorySequence,
    skipToDirectoryHold: skipToDirectoryHold,

    /* Screen 2 menu — same PE typography buffers as Screen 1 directory */
    beginScreen2MenuSequence: beginScreen2MenuSequence,
    settleScreen2Menu: settleScreen2Menu,
    restoreScreen1Menu: restoreScreen1Menu,
    getMenuSurface: getMenuSurface,
    hasPlayedScreen2Menu: hasPlayedScreen2Menu,
    fadeMenuOut: fadeMenuOut,
    fadeMenuIn: fadeMenuIn,

    /* Command layer — measure and mask keyed Screen 2 lines, and drive the
       command box as LED typography on the same lattice */
    getScreen2LineMetrics: getScreen2LineMetrics,
    setScreen2LineMasked: setScreen2LineMasked,
    openScreen2Command: openScreen2Command,
    setScreen2CommandText: setScreen2CommandText,
    closeScreen2Command: closeScreen2Command,
    isScreen2CommandOpen: isScreen2CommandOpen,
  };

}
