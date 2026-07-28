/* Intro / landing sequence — Animation Manager core (V1).
   boot → intro → directory → idle. Logic preserved from the monolithic main.js.
*/

/**
 * @param {object} deps
 * @param {object} deps.animConfig
 * @param {boolean} deps.prefersReduced
 * @param {() => string|null} deps.resolveActiveBgMode
 */
export function createIntroController(deps) {
  const animConfig = deps.animConfig;
  const prefersReduced = deps.prefersReduced;
  const resolveActiveBgMode = deps.resolveActiveBgMode;

  const FF_RATE = 4;

  const INTRO_IDLE_MS      = 800;
  const INTRO_HOLD_MS      = 3500;
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
  const INTRO_DISSOLVE_SCALE = 0.40;
  const INTRO_DISSOLVE_PAUSE = 280;

  const DIR_DELAY_SEC      = 0.85;
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
  /* Must match heatmap / wave CELL — idle Y (px) → fractional row shift */
  const LED_CELL           = 5;

  const INTRO_LINES = [
    { text: 'Hey there,',                pace: 1.00 },
    { text: 'My name is Canaan Brown.',  pace: 1.40 },
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
  let phase = 'boot'; /* boot | intro | directory | idle | skipped */
  let timeline = null; /* THE only landing GSAP timeline */
  let timeScale = 1;
  let holdingFF = false;
  let killed = false; /* true after skip/cancel — blocks late timeline callbacks */
  let started = false;
  let phaseStartTime = 0; /* timeline.time() when current LED phase began */
  let touchGuardUntil = 0;

  let cols = 0;
  let rows = 0;
  let introTotalMs = 0;
  let assembleMs = 0;

  /* Intro LED buffers */
  let iTarget = null, iOn = null, iLevel = null, iOnAt = null;
  let iDetachAt = null, iGoneAt = null, iLine = null;
  let iDriftX = null, iDriftY = null, iOx = null, iOy = null;
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
    const dest = y + shiftPx / LED_CELL;
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

  function isOnLanding() {
    const home = document.getElementById('home');
    if (!home) return true;
    const rect = home.getBoundingClientRect();
    return rect.bottom > 40 && rect.top < window.innerHeight - 40;
  }

  function ensureGrid() {
    if (cols >= 12 && rows >= 8) return;
    const stage = document.getElementById('stage');
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    cols = Math.max(cols, Math.ceil(Math.max(1, rect.width) / 5) | 0);
    rows = Math.max(rows, Math.ceil(Math.max(1, rect.height) / 5) | 0);
  }

  function setBoot(flag) {
    if (flag) document.body.dataset.boot = flag;
    else delete document.body.dataset.boot;
  }

  function isActivePhase() {
    return phase === 'boot' || phase === 'intro' || phase === 'directory';
  }

  /* ── master timeline ──────────────────────────────────────────────────── */

  function killMasterTimeline() {
    if (timeline) {
      timeline.kill();
      timeline = null;
    }
  }

  function setTimeScale(rate) {
    const next = rate > 0 ? rate : 1;
    timeScale = next;
    if (timeline) timeline.timeScale(next);
  }

  function phaseElapsedMs() {
    if (!timeline) return 0;
    return Math.max(0, (timeline.time() - phaseStartTime) * 1000);
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
    if (iWordId) iWordId.fill(-1);
    iIdleWords = [];
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

  function bakeIntro() {
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
    iWordId = new Int16Array(n);
    iWordId.fill(-1);
    iIdleWords = [];
    introTotalMs = 0;

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

        const nAng = hash01(clusterId, 0xd01);
        const nDist = hash01(i, 0xd02 + L);
        const nSpin = (hash01(i, 0xd03) - 0.5) * 0.85;
        let baseAng = Math.atan2(y - lineCy, x - lineCx);
        if (!isFinite(baseAng) || (x === lineCx && y === lineCy)) {
          baseAng = nAng * Math.PI * 2;
        }
        const ang = baseAng + nSpin + (nAng - 0.5) * 0.55;
        const dist = INTRO_DRIFT_MIN + nDist * (INTRO_DRIFT_MAX - INTRO_DRIFT_MIN);
        iDriftX[i] = Math.cos(ang) * dist;
        iDriftY[i] = Math.sin(ang) * dist;
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

    const holdEnd = cursor + INTRO_HOLD_MS;
    let dissolveCursor = holdEnd;
    let maxGone = holdEnd;

    for (let L = 0; L < lineCount; L++) {
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
      if (L < lineCount - 1) dissolveCursor += INTRO_DISSOLVE_PAUSE;
    }

    introTotalMs = maxGone + 120;
  }

  /* ── directory LED bake / clear ───────────────────────────────────────── */

  function clearDirectoryLeds() {
    if (!dOn) return;
    dOn.fill(0);
    if (dTarget) dTarget.fill(0);
    if (dLevel) dLevel.fill(0);
    if (dOnAt) dOnAt.fill(0);
    if (dDetachAt) dDetachAt.fill(0);
    if (dGoneAt) dGoneAt.fill(0);
    if (dDriftX) dDriftX.fill(0);
    if (dDriftY) dDriftY.fill(0);
    if (dOx) dOx.fill(0);
    if (dOy) dOy.fill(0);
    if (dWordId) dWordId.fill(-1);
    dIdleWords = [];
    dBitmap = null;
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
    const instant = !!(opts && opts.instant);
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
            DIR_REVEAL_MAX,
            Math.max(DIR_REVEAL_MIN, spanX * DIR_MS_PER_COL * DIR_LINES[L].pace)
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
        const clusterOff = (hash01(clusterId, 0xc01) - 0.5) * DIR_CLUSTER_MS;
        const jitter = (hash01(i, 0xc11 + L) - 0.5) * DIR_JITTER_MS;
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
            const sparkOn = Math.max(lineStart, waveT - 45 + (n1 - 0.5) * 55);
            const life = 80 + n2 * 170;
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
      if (L < lineCount - 1) cursor += instant ? 0 : DIR_LINE_PAUSE;
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

  /* ── phase entry (called ONLY from the master timeline) ─────────────── */

  function enterIntroPhase() {
    if (killed) return;
    phase = 'intro';
    phaseStartTime = timeline ? timeline.time() : 0;
    setBoot('intro');
    window.dispatchEvent(new CustomEvent('pixelintrostart'));
  }

  function enterDirectoryPhase() {
    if (killed) return;
    /* Sole visual entry — mask was baked once when the master timeline was built */
    console.info('[IntroController] enterDirectoryPhase (sole entry)');
    clearIntroLeds();
    if (!dOn) bakeDirectory(); /* safety if build skipped prebake */
    phase = 'directory';
    phaseStartTime = timeline ? timeline.time() : 0;
    setBoot('directory');
    window.dispatchEvent(new CustomEvent('pixeldirectorystart'));
  }

  function enterIdle() {
    if (killed && phase === 'idle') return;
    phase = 'idle';
    holdingFF = false;
    timeScale = 1;
    setBoot(null);
    paintDirectoryHold();
    window.dispatchEvent(new CustomEvent('pixeldirectoryhold'));
  }

  function renderFinalHold() {
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
    setBoot(null);
    window.dispatchEvent(new CustomEvent('pixeldirectorystart'));
    window.dispatchEvent(new CustomEvent('pixeldirectoryhold'));
  }

  /* ── build + play the single master timeline ──────────────────────────── */

  function buildAndPlayMasterTimeline(opts) {
    opts = opts || {};
    const skipIntroPhase = !!opts.skipIntroPhase;

    killMasterTimeline();
    killed = false;
    clearIntroLeds();
    clearDirectoryLeds();

    ensureGrid();
    if (prefersReduced || !animConfig.motion || cols < 12 || rows < 8) {
      phase = 'skipped';
      setBoot(null);
      return false;
    }

    if (!skipIntroPhase) {
      bakeIntro();
    } else {
      introTotalMs = 0;
    }

    /* Bake directory once here — enterDirectoryPhase only reveals it */
    bakeDirectory();
    const dirAssembleSec = Math.max(0.05, assembleMs / 1000);

    const idleSec = skipIntroPhase ? 0 : INTRO_IDLE_MS / 1000;
    const introSec = skipIntroPhase ? 0 : Math.max(0.05, introTotalMs / 1000);
    const dirDelaySec = DIR_DELAY_SEC;

    if (!window.gsap) {
      console.error('[IntroController] GSAP required for landing sequence');
      phase = 'skipped';
      return false;
    }

    phase = 'boot';
    started = true;
    setBoot(skipIntroPhase ? 'directory' : 'intro');

    timeline = window.gsap.timeline({
      defaults: { ease: 'none' },
      onComplete: function () {
        if (killed) return;
        timeline = null;
      },
    });
    timeline.timeScale(timeScale);

    /* Wake Heat/Wave rAF for the boot delay (before intro LEDs appear) */
    window.dispatchEvent(new CustomEvent('pixelintrostart'));

    if (!skipIntroPhase) {
      timeline.addLabel('boot');
      if (idleSec > 0) timeline.to({}, { duration: idleSec });

      timeline.addLabel('intro');
      timeline.call(enterIntroPhase);
      timeline.to({}, { duration: introSec });
      timeline.call(function () {
        if (killed) return;
        clearIntroLeds();
      });
    }

    timeline.addLabel('dirDelay');
    if (dirDelaySec > 0) timeline.to({}, { duration: dirDelaySec });

    timeline.addLabel('directory');
    timeline.call(enterDirectoryPhase);
    timeline.to({}, { duration: dirAssembleSec });

    timeline.addLabel('idle');
    timeline.call(function () {
      if (killed) return;
      enterIdle();
    });

    return true;
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
    killMasterTimeline();
    renderFinalHold();
  }

  function cancel() {
    killed = true;
    killMasterTimeline();
    clearIntroLeds();
    clearDirectoryLeds();
    phase = 'skipped';
    holdingFF = false;
    timeScale = 1;
    started = false;
    setBoot(null);
  }

  function schedule() {
    if (prefersReduced || !animConfig.motion || resolveActiveBgMode() !== 'heat') {
      phase = 'skipped';
      return;
    }
    if (started) return;

    const kick = function () {
      if (started || killed) return;
      buildAndPlayMasterTimeline();
    };

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(kick).catch(kick);
    } else {
      kick();
    }
  }

  function replayDirectoryAfterMotionOn() {
    requestAnimationFrame(function () {
      if (!animConfig.motion) return;
      if (!isOnLanding()) return;
      killed = false;
      started = false;
      holdingFF = false;
      timeScale = 1;
      buildAndPlayMasterTimeline({ skipIntroPhase: true });
      window.dispatchEvent(new CustomEvent('pixeldirectorystart'));
    });
  }

  /* ── per-frame LED update (time from master timeline) ─────────────────── */

  function updateIntroLeds(t) {
    if (!iOn) return false;
    let anyLit = false;
    let dissolving = false;
    const n = cols * rows;

    /* Detect dissolve first — geometric drift owns those frames */
    for (let i = 0; i < n; i++) {
      if (!iTarget || !iTarget[i]) continue;
      if (!(iGoneAt && iGoneAt[i] > iOnAt[i])) continue;
      if (t < iOnAt[i] || t >= iGoneAt[i]) continue;
      const detachAt = iDetachAt[i];
      if (t >= detachAt && iGoneAt[i] > detachAt) {
        dissolving = true;
        break;
      }
    }

    if (dissolving) {
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
        if (iTarget[i] && t >= detachAt && iGoneAt[i] > detachAt) {
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

    /* Holding: rebuild brightness via fixed-grid light flow from idle Y */
    const yCache = iIdleWords.length
      ? tickAllIdleWords(iIdleWords, t, false)
      : null;
    iOn.fill(0);

    for (let i = 0; i < n; i++) {
      iOx[i] = 0;
      iOy[i] = 0;
      if (!(iGoneAt && iGoneAt[i] > iOnAt[i])) continue;
      if (t < iOnAt[i] || t >= iGoneAt[i]) continue;
      anyLit = true;
      const level = iLevel[i];
      if (iTarget && iTarget[i]) {
        const wid = iWordId ? iWordId[i] : -1;
        const shiftPx = yCache && wid >= 0 ? yCache[wid] : 0;
        const x = i % cols;
        const y = (i / cols) | 0;
        scatterIdleLight(iOn, x, y, level, shiftPx);
      } else {
        /* Sparks stay pinned to their home cell */
        iOn[i] = level;
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
    /* Render buffer only — source bitmap stays untouched */
    dOn.fill(0);

    for (let i = 0; i < n; i++) {
      if (dOx) dOx[i] = 0;
      if (dOy) dOy[i] = 0;
      if (!(dGoneAt && dGoneAt[i] > dOnAt[i])) continue;
      if (t < dOnAt[i] || t >= dGoneAt[i]) continue;
      anyLit = true;

      if (dTarget && dTarget[i]) {
        /* Always sample the frozen bitmap at the home cell */
        const level = dBitmap ? dBitmap[i] : dLevel[i];
        const wid = dWordId ? dWordId[i] : -1;
        const shiftPx =
          yCache && wid >= 0 && wid < yCache.length ? yCache[wid] : 0;
        const x = i % cols;
        const y = (i / cols) | 0;
        scatterIdleLight(dOn, x, y, level, shiftPx);
      } else {
        /* Transient sparks — not part of the frozen bitmap */
        dOn[i] = dLevel[i];
      }
    }
    return anyLit;
  }

  function update(/* now */) {
    if (phase === 'idle') {
      /*
        Idle hold: render ONLY from the immutable bitmap.
        Do NOT reuse assemble timing (Infinity >= HOLD_SENTINEL wiped the field).
      */
      if (!dBitmap) return false;
      const yCache = dIdleWords.length
        ? tickAllIdleWords(dIdleWords, assembleMs + 1, false)
        : null;
      renderDirectoryFromBitmap(yCache);
      return true;
    }
    if (phase === 'intro') {
      return updateIntroLeds(phaseElapsedMs()) || !!timeline;
    }
    if (phase === 'directory') {
      return updateDirectoryLeds(phaseElapsedMs()) || !!timeline;
    }
    /* boot / dirDelay — keep rAF alive while master timeline runs */
    return !!timeline;
  }

  function brightness(i) {
    const a = iOn ? iOn[i] : 0;
    const b = dOn ? dOn[i] : 0;
    return a > b ? a : b;
  }

  function offsetX(i) {
    const d = dOx ? dOx[i] : 0;
    if (d) return d;
    return iOx ? iOx[i] : 0;
  }

  function offsetY(i) {
    const d = dOy ? dOy[i] : 0;
    if (d) return d;
    return iOy ? iOy[i] : 0;
  }

  function isActive() {
    return isActivePhase() || phase === 'idle' || !!timeline;
  }

  function onResize(nextCols, nextRows) {
    const c = nextCols | 0;
    const r = nextRows | 0;
    if (c === cols && r === rows) return;
    cols = c;
    rows = r;

    if (phase === 'intro') {
      bakeIntro();
      /* Elapsed still comes from master timeline — no clock reset / restart */
    } else if (phase === 'directory') {
      bakeDirectory();
    } else if (phase === 'idle') {
      bakeDirectory({ instant: true });
      paintDirectoryHold();
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

    window.addEventListener('keydown', function (e) {
      if (e.code !== 'Space' && e.key !== ' ') return;
      if (e.repeat) return;
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.target && e.target.isContentEditable) return;
      if (phase === 'idle' || phase === 'skipped') return;
      e.preventDefault();
      skip();
    });

    window.addEventListener('motionreenabled', replayDirectoryAfterMotionOn);
    window.addEventListener('animconfigchange', function (e) {
      if (e.detail && e.detail.motion === false) cancel();
    });
  }

  bindInputs();

  return {
    brightness: brightness,
    offsetX: offsetX,
    offsetY: offsetY,
    update: update,
    isActive: isActive,
    onResize: onResize,
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
  };

}
