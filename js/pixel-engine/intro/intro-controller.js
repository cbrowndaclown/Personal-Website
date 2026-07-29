/* Intro content service — typography + directory LED sequences.
   Boot lifecycle is owned by the Boot Controller; this module supplies
   glyph construction, migration, directory assemble, and idle float.

   Lattice geometry (cols / rows / cell) is adopted from the shared GridManager
   or the density-rebuild authority — never invented from pending Settings. */

import {
  cellSizeFromDensity,
  PERFORMANCE_DEFAULTS,
} from '../performance-manager.js';
import { computeGridLayout } from '../grid-manager.js';
import { CELL as DEFAULT_CELL } from '../constants.js';

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

  const DIR_FONT =
    '"Josefin Sans", "Apple Symbols", "Segoe UI Symbol", "Noto Sans Symbols", system-ui, sans-serif';

  /* ── controller state ─────────────────────────────────────────────────── */
  let phase = 'idle'; /* typography | directory | idle | skipped | dissolving */
  let timeScale = 1;
  let holdingFF = false;
  let killed = false;
  let contentLocked = false; /* exclusive boot owns the PE canvas */
  /* Directory LEDs ("Scroll up/down") must not exist until post-boot reveal */
  let directoryAllowed = false;
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
    idleYCache = null;
    assembleMs = 0;
  }

  function arrowSizeFor(fontPx) {
    return Math.max(fontPx * 1.15, fontPx + 2);
  }

  function lineLayoutWidth(octx, line, fontPx) {
    octx.font = `600 ${fontPx}px ${DIR_FONT}`;
    const textW = octx.measureText(line.text).width;
    const arrowW = arrowSizeFor(fontPx) * 1.05;
    const gap = Math.max(3, Math.round(fontPx * 0.35));
    return textW + gap + arrowW;
  }

  function fitDirFont(octx, lines, maxWidth, startPx) {
    let fontPx = startPx;
    for (let attempt = 0; attempt < 14; attempt++) {
      let widest = 0;
      for (let L = 0; L < lines.length; L++) {
        widest = Math.max(widest, lineLayoutWidth(octx, lines[L], fontPx));
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

  function sampleLineWithArrow(octx, line, cx, cy, fontPx) {
    octx.fillStyle = '#000';
    octx.fillRect(0, 0, cols, rows);
    octx.fillStyle = '#fff';
    octx.font = `600 ${fontPx}px ${DIR_FONT}`;
    octx.textAlign = 'left';
    octx.textBaseline = 'middle';

    const arrowSize = arrowSizeFor(fontPx);
    const gap = Math.max(3, Math.round(fontPx * 0.35));
    const textW = octx.measureText(line.text).width;
    const arrowW = arrowSize * 1.05;
    const totalW = textW + gap + arrowW;
    const startX = cx - totalW * 0.5;

    octx.fillText(line.text, startX, cy);
    drawPixelArrow(
      octx,
      startX + textW + gap + arrowW * 0.5,
      cy,
      arrowSize,
      line.arrow
    );

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

  function bakeDirectory(opts) {
    /* Hard gate — never generate scroll-up / scroll-down pixels early */
    if (!directoryAllowed) {
      clearDirectoryLeds();
      return;
    }
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
    dIdleWords = [];
    dBitmap = null;
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
      any = true;
      const wid = dWordId ? dWordId[i] : -1;
      const shiftPx =
        yCache && wid >= 0 && wid < yCache.length ? yCache[wid] : 0;
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

  /* ── content phase API (driven by Boot Controller) ─────────────────────── */

  /**
   * Clear all content LEDs and lock the intro out of the PE canvas
   * until typography construction is explicitly started.
   * Directory pixels are destroyed — not hidden — until post-boot reveal.
   */
  function suppressContent() {
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
    bakeDirectory(
      opts.instant
        ? { instant: true }
        : opts.densityRebuild !== false
          ? { densityRebuild: true }
          : undefined,
    );
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
      bakeDirectory(
        opts.instant
          ? { instant: true }
          : { densityRebuild: true },
      );
    }

    if (opts.instant) {
      paintDirectoryHold();
      phase = 'idle';
      holdingFF = false;
      timeScale = 1;
      typographySettled = true;
      setBoot(null);
      window.dispatchEvent(new CustomEvent('pixeldirectorystart'));
      window.dispatchEvent(new CustomEvent('pixeldirectoryhold'));
      return;
    }

    resetContentClock();
    phase = 'directory';
    setBoot('directory');
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
    resetContentClock();
    phase = 'directory';
    setBoot('directory');
    window.dispatchEvent(new CustomEvent('pixeldirectorystart'));
  }

  function enterIdle() {
    phase = 'idle';
    holdingFF = false;
    timeScale = 1;
    setBoot(null);
    paintDirectoryHold();
    window.dispatchEvent(new CustomEvent('pixeldirectoryhold'));
  }

  function beginDirectorySequence(opts) {
    opts = opts || {};
    clearDissolveTimer();
    killed = false;
    contentLocked = false;
    directoryAllowed = true;

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

  function skipToDirectoryHold() {
    clearDissolveTimer();
    contentLocked = false;
    directoryAllowed = true;
    ensureGrid();
    clearIntroLeds();
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
    killed = true;
    clearDissolveTimer();
    skipToDirectoryHold();
  }

  function cancel() {
    killed = true;
    contentLocked = false;
    directoryAllowed = false;
    clearDissolveTimer();
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

  function update(now) {
    if (contentLocked) return false;

    const wall = now || performance.now();
    tickContentClock(wall);
    const t = phaseElapsedMs();

    if (phase === 'idle') {
      if (!directoryAllowed || !dBitmap) return false;
      const yCache = dIdleWords.length
        ? tickAllIdleWords(dIdleWords, assembleMs + 1, false)
        : null;
      renderDirectoryFromBitmap(yCache);
      return true;
    }
    if (phase === 'typography' || phase === 'dissolving') {
      if (phase === 'typography') isTypographySettled();
      return updateIntroLeds(t);
    }
    if (phase === 'directory') {
      if (!directoryAllowed) return false;
      const lit = updateDirectoryLeds(t);
      if (t >= assembleMs && assembleMs > 0) {
        enterIdle();
        return true;
      }
      return lit;
    }
    return false;
  }

  function brightness(i) {
    if (contentLocked) return 0;
    const a = iOn ? iOn[i] : 0;
    /* Directory contribution only after explicit post-boot reveal */
    const b = directoryAllowed && dOn ? dOn[i] : 0;
    return a > b ? a : b;
  }

  function offsetX(i) {
    if (contentLocked) return 0;
    const d = directoryAllowed && dOx ? dOx[i] : 0;
    if (d) return d;
    return iOx ? iOx[i] : 0;
  }

  function offsetY(i) {
    if (contentLocked) return 0;
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
      beginDirectorySequence({
        fromDensityRebuild: true,
        grid: gridSnap,
      });
      return;
    }

    /* Menu complete — regenerate pixel text without replaying intro */
    if (phase === 'idle' && directoryAllowed) {
      clearIntroLeds();
      bakeDirectory({ instant: true });
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
      bakeDirectory();
    } else if (phase === 'idle' && directoryAllowed && dBitmap) {
      bakeDirectory({ instant: true });
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
  };

}
