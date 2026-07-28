/* Pixel FS — Lightning (weather field + strike timing). V1 preserved. */

import { createLightningStrikeController } from './lightning-strike.js';

/**
 * @param {object} deps
 */
export function createLightningStyle(deps) {
  const canvas = deps.canvas;
  const stage = deps.stage;
  const animConfig = deps.animConfig;
  const resolveActiveBgMode = deps.resolveActiveBgMode;
  const pixelField = deps.pixelField;
  if (!canvas || !stage) {
    return { id: 'lightning', implemented: true, mount() {}, destroy() {} };
  }

  (function initLightningStrikeController() {
    /* ── Strike timing (formerly SYSTEM 8) ─────────────────────────────────── */
    const controller = createLightningStrikeController({
      intervalMin: 2000,
      intervalMax: 6000,
    });

    let stageLeft = 0;
    let stageTop = 0;
    let stageW = 0;
    let stageH = 0;
    let lastClientX = null;
    let lastClientY = null;

    function syncStageRect() {
      const rect = stage.getBoundingClientRect();
      stageLeft = rect.left;
      stageTop = rect.top;
      stageW = rect.width;
      stageH = rect.height;
      return rect;
    }

    function lightningModeSelected() {
      return !!animConfig.motion && resolveActiveBgMode() === 'lightning';
    }

    function pointInField(clientX, clientY) {
      syncStageRect();
      const x = clientX - stageLeft;
      const y = clientY - stageTop;
      return x >= 0 && y >= 0 && x <= stageW && y <= stageH;
    }

    function syncMode() {
      const active = lightningModeSelected();
      controller.setModeActive(active);
      if (!active) {
        controller.setCursorInField(false);
        return;
      }
      /* Re-evaluate hover without waiting for another mousemove */
      if (lastClientX != null && lastClientY != null) {
        controller.setCursorInField(pointInField(lastClientX, lastClientY));
      }
    }

    window.addEventListener('bgmodechange', syncMode);
    window.addEventListener('animconfigchange', syncMode);

    document.addEventListener('mousemove', (e) => {
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      if (!lightningModeSelected()) {
        controller.setCursorInField(false);
        return;
      }
      if (
        typeof pixelField.interactionsEnabled === 'function' &&
        !pixelField.interactionsEnabled()
      ) {
        controller.setCursorInField(false);
        return;
      }
      controller.setCursorInField(pointInField(e.clientX, e.clientY));
    }, { passive: true });

    document.documentElement.addEventListener('mouseleave', () => {
      controller.setCursorInField(false);
    });

    window.addEventListener('blur', () => {
      controller.setCursorInField(false);
    });

    syncMode();

  })();

  (function initLightningMode() {
    /* ── Weather field (formerly SYSTEM 9) ─────────────────────────────────── */
    const CELL  = 5;
    const DOT   = CELL - 2;
    const FIELD = [210, 210, 210];
    const COOL  = [255, 255, 255];

    /* Soft bloom knobs — match Heat/Wave LED presence language */
    const COLOR_FALLOFF   = 0.72;
    const BLOOM_THRESHOLD = 0.22;
    const BLOOM_STRENGTH  = 0.55;
    const BLOOM_SPREAD    = 1.35;
    const BLOOM_BRIGHTNESS = 0.28;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let cols = 0;
    let rows = 0;
    let viewW = 0;
    let viewH = 0;
    let dpr = 1;
    let stageLeft = 0;
    let stageTop = 0;
    let running = false;
    let enabled = animConfig.motion && resolveActiveBgMode() === 'lightning';
    let ptrX = -1;
    let ptrY = -1;

    function rand(a, b) {
      return a + Math.random() * (b - a);
    }

    function clamp01(t) {
      return t < 0 ? 0 : t > 1 ? 1 : t;
    }

    function smootherstep(t) {
      t = clamp01(t);
      return t * t * t * (t * (t * 6 - 15) + 10);
    }

    /* ── Shared Lightning theme palette (single source for every weather effect) ─
       Derived from animConfig.effectColor. All bolts, clouds, rain, glow, and the
       cursor indicator read from here — never invent local colors per effect. */
    const lightningTheme = (function () {
      const WHITE = [255, 255, 255];
      const SLATE = [158, 164, 174];
      const DEEP = [58, 64, 76];

      const theme = {
        highlight: [255, 180, 220],
        base: [255, 52, 158],
        bolt: [210, 40, 130],
        afterglow: [255, 160, 210],
        mid: [200, 90, 160],
        shadow: [110, 70, 100],
        glow: [255, 120, 185],
        flashBright: [255, 210, 235],
        rain: [230, 160, 200],
        cloud: [140, 120, 145],
        srcR: -1,
        srcG: -1,
        srcB: -1,
      };

      function mix(a, b, t) {
        return [
          a[0] + (b[0] - a[0]) * t,
          a[1] + (b[1] - a[1]) * t,
          a[2] + (b[2] - a[2]) * t,
        ];
      }

      function darken(c, amount) {
        return [c[0] * (1 - amount), c[1] * (1 - amount), c[2] * (1 - amount)];
      }

      function lighten(c, amount) {
        return [
          c[0] + (255 - c[0]) * amount,
          c[1] + (255 - c[1]) * amount,
          c[2] + (255 - c[2]) * amount,
        ];
      }

      function write(target, src) {
        target[0] = src[0];
        target[1] = src[1];
        target[2] = src[2];
      }

      function cssTriplet(c) {
        return `${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}`;
      }

      function publishCss() {
        const root = document.documentElement;
        root.style.setProperty('--lightning-highlight', cssTriplet(theme.highlight));
        root.style.setProperty('--lightning-base', cssTriplet(theme.base));
        root.style.setProperty('--lightning-bolt', cssTriplet(theme.bolt));
        root.style.setProperty('--lightning-afterglow', cssTriplet(theme.afterglow));
        root.style.setProperty('--lightning-mid', cssTriplet(theme.mid));
        root.style.setProperty('--lightning-shadow', cssTriplet(theme.shadow));
        root.style.setProperty('--lightning-glow', cssTriplet(theme.glow));
        root.style.setProperty('--lightning-flash', cssTriplet(theme.flashBright));
        root.style.setProperty('--lightning-rain', cssTriplet(theme.rain));
        root.style.setProperty('--lightning-cloud', cssTriplet(theme.cloud));
      }

      function sync() {
        const ar = animConfig.effectColor.r;
        const ag = animConfig.effectColor.g;
        const ab = animConfig.effectColor.b;
        if (ar === theme.srcR && ag === theme.srcG && ab === theme.srcB) return theme;

        theme.srcR = ar;
        theme.srcG = ag;
        theme.srcB = ab;

        const accent = [ar, ag, ab];

        /* Base — the selected RGB itself */
        write(theme.base, accent);

        /* Active bolt body — slightly darker variation of the selected color */
        write(theme.bolt, darken(accent, 0.22));

        /* Afterglow afterimage — lighter variation of the selected color */
        write(theme.afterglow, lighten(accent, 0.42));

        /* Highlight — lighter version preserving hue (hot cores, lit rims) */
        write(theme.highlight, lighten(accent, 0.52));

        /* Flash — brighter accent wash for surrounding pixel illumination */
        write(theme.flashBright, lighten(accent, 0.68));

        /* Mid-tone — muted accent for secondary fills */
        write(theme.mid, mix(mix(accent, SLATE, 0.28), WHITE, 0.08));

        /* Shadow — darker storm body */
        write(theme.shadow, darken(mix(mix(accent, DEEP, 0.55), SLATE, 0.28), 0.1));

        /* Glow — soft illuminated wash around bolts / hot pixels */
        write(theme.glow, mix(accent, lighten(accent, 0.3), 0.55));

        /* Rain — brighter accent wash */
        write(theme.rain, lighten(mix(accent, SLATE, 0.18), 0.32));

        /* Cloud — storm slate tinted by accent (reads as weather, not solid brand) */
        write(
          theme.cloud,
          darken(mix(mix(accent, DEEP, 0.48), SLATE, 0.38), 0.06)
        );

        publishCss();
        return theme;
      }

      sync();

      return {
        colors: theme,
        sync: sync,
        /* Convenience aliases used by effects */
        get highlight() { sync(); return theme.highlight; },
        get base() { sync(); return theme.base; },
        get bolt() { sync(); return theme.bolt; },
        get afterglow() { sync(); return theme.afterglow; },
        get mid() { sync(); return theme.mid; },
        get shadow() { sync(); return theme.shadow; },
        get glow() { sync(); return theme.glow; },
        get flashBright() { sync(); return theme.flashBright; },
        get rain() { sync(); return theme.rain; },
        get cloud() { sync(); return theme.cloud; },
      };
    })();

    /* ── Click weather: calm storm cells (pooled clouds + rain) ───────────── */
    const clickWeather = (function () {
      const CLOUD_POOL = 8;
      const MAX_CLOUD_CELLS = 160;
      const DROP_POOL = 480;
      const MAX_EMIT_PER_FRAME = 18;

      const FADE_IN_MIN = 420;
      const FADE_IN_MAX = 720;
      const RAIN_DELAY_MIN = 380;
      const RAIN_DELAY_MAX = 900;
      const RAIN_DUR_MIN = 5000;
      const RAIN_DUR_MAX = 10000;
      const DISSIPATE_MS_MIN = 1400;
      const DISSIPATE_MS_MAX = 2400;

      let density = null;
      let densCols = 0;
      let densRows = 0;
      let activeClouds = 0;

      /* Shared breeze — slow, non-repeating wind across all drops */
      let wind = 0;
      let windPhaseA = rand(0, Math.PI * 2);
      let windPhaseB = rand(0, Math.PI * 2);

      function hash2(ix, iy, seed) {
        let n = (ix * 374761393 + iy * 668265263 + seed * 362437) | 0;
        n = (n ^ (n >>> 13)) * 1274126177;
        n ^= n >>> 16;
        return (n >>> 0) / 4294967296;
      }

      function makeCloud() {
        return {
          alive: false,
          born: 0,
          cx: 0,
          cy: 0,
          fadeInMs: 500,
          phaseA: 0,
          phaseB: 0,
          phaseC: 0,
          freqA: 0.37,
          freqB: 0.61,
          freqC: 0.23,
          ampA: 5,
          ampB: 3,
          ampC: 2,
          driftVx: 0,
          driftVy: 0,
          breathPhase: 0,
          breathFreq: 0.15,
          breathAmp: 0.06,
          rainStart: 0,
          rainEnd: 0,
          dissipateAt: 0,
          dissipateMs: 1500,
          emitAcc: 0,
          seed: 0,
          cellCount: 0,
          ox: new Int16Array(MAX_CLOUD_CELLS),
          oy: new Int16Array(MAX_CLOUD_CELLS),
          ow: new Float32Array(MAX_CLOUD_CELLS),
        };
      }

      function makeDrop() {
        return {
          alive: false,
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          life: 0,
          maxLife: 1,
          bright: 0.5,
          phase: 0,
          wobbleFreq: 2,
          wobbleAmp: 8,
          fadeIn: 0.1,
          fadeOut: 0.22,
          /* 0 = base rain tone, 1 = brighter — baked at spawn from live palette */
          tone: 0,
          pr: 200,
          pg: 190,
          pb: 210,
        };
      }

      const cloudPool = [];
      for (let i = 0; i < CLOUD_POOL; i++) cloudPool.push(makeCloud());

      const dropPool = [];
      for (let i = 0; i < DROP_POOL; i++) dropPool.push(makeDrop());

      /* Compact live list — avoids scanning the whole drop pool when sparse */
      const liveDrops = new Uint16Array(DROP_POOL);
      let liveCount = 0;

      function acquireCloud() {
        for (let i = 0; i < CLOUD_POOL; i++) {
          if (!cloudPool[i].alive) return cloudPool[i];
        }
        let oldest = cloudPool[0];
        for (let i = 1; i < CLOUD_POOL; i++) {
          if (cloudPool[i].born < oldest.born) oldest = cloudPool[i];
        }
        return oldest;
      }

      function acquireDrop() {
        for (let i = 0; i < DROP_POOL; i++) {
          if (!dropPool[i].alive) return i;
        }
        return -1;
      }

      function killDropAtLive(liveIdx) {
        const di = liveDrops[liveIdx];
        dropPool[di].alive = false;
        liveCount--;
        liveDrops[liveIdx] = liveDrops[liveCount];
      }

      function bakeCloudCells(c, seed) {
        /* Lobes: primary ellipse + 1–2 offset puffs for irregular silhouette */
        const lobes = 1 + ((Math.random() * 2) | 0);
        const lobeRx = [];
        const lobeRy = [];
        const lobeOx = [];
        const lobeOy = [];
        for (let L = 0; L < lobes; L++) {
          lobeRx.push(rand(5.5, 10.5) * (L === 0 ? 1 : rand(0.45, 0.75)));
          lobeRy.push(rand(3.2, 5.8) * (L === 0 ? 1 : rand(0.5, 0.85)));
          lobeOx.push(L === 0 ? 0 : rand(-5, 5));
          lobeOy.push(L === 0 ? 0 : rand(-2.5, 2.5));
        }

        let n = 0;
        const pad = 14;
        for (let iy = -pad; iy <= pad && n < MAX_CLOUD_CELLS; iy++) {
          for (let ix = -pad; ix <= pad && n < MAX_CLOUD_CELLS; ix++) {
            let best = 0;
            for (let L = 0; L < lobes; L++) {
              const nx = (ix - lobeOx[L]) / lobeRx[L];
              const ny = (iy - lobeOy[L]) / lobeRy[L];
              const d = nx * nx + ny * ny;
              const noise = hash2(ix + L * 17, iy - L * 9, seed);
              const edge = 0.62 + noise * 0.55;
              if (d > edge) continue;
              if (noise < 0.1 && d > 0.28) continue;
              const fall = 1 - d / edge;
              const w = fall * fall * (0.4 + noise * 0.6);
              if (w > best) best = w;
            }
            if (best < 0.07) continue;
            /* Soften rim further with a second noise octave */
            const rim = hash2(ix * 3, iy * 5, seed ^ 0x9e3779b9);
            if (best < 0.22 && rim < 0.35) continue;
            c.ox[n] = ix;
            c.oy[n] = iy;
            c.ow[n] = best * (0.85 + rim * 0.2);
            n++;
          }
        }
        c.cellCount = n;
      }

      function cloudPresence(c, now) {
        const age = now - c.born;
        if (age < c.fadeInMs) return smootherstep(age / c.fadeInMs);
        if (now < c.dissipateAt) return 1;
        const t = (now - c.dissipateAt) / c.dissipateMs;
        if (t >= 1) return 0;
        return 1 - smootherstep(t);
      }

      function rainIntensity(c, now) {
        if (now < c.rainStart || now > c.rainEnd) return 0;
        const into = now - c.rainStart;
        const dur = c.rainEnd - c.rainStart;
        const fadeIn = Math.min(420, dur * 0.12);
        const taperAt = dur * 0.62;
        if (into < fadeIn) return smootherstep(into / fadeIn);
        if (into > taperAt) {
          return 1 - smootherstep((into - taperAt) / (dur - taperAt));
        }
        /* Gentle breathing during steady rain — avoids flat intensity */
        const pulse = 0.92 + 0.08 * Math.sin(now * 0.0017 + c.breathPhase);
        return pulse;
      }

      /* Multi-frequency float — incommensurate rates so paths never loop cleanly */
      function cloudDrawPos(c, now) {
        const t = (now - c.born) * 0.001;
        const x =
          c.cx +
          Math.sin(t * c.freqA + c.phaseA) * c.ampA +
          Math.sin(t * c.freqB + c.phaseB) * c.ampB +
          Math.sin(t * c.freqC + c.phaseC) * c.ampC * 0.55;
        const y =
          c.cy +
          Math.sin(t * c.freqB * 0.87 + c.phaseB) * c.ampA * 0.35 +
          Math.sin(t * c.freqC + c.phaseC) * c.ampC +
          Math.sin(t * c.freqA * 1.13 + c.phaseA) * c.ampB * 0.4;
        return { x: x, y: y };
      }

      function spawn(clickX, clickY, now) {
        const c = acquireCloud();
        const seed = (Math.random() * 1e9) | 0;

        c.alive = true;
        c.born = now;
        c.fadeInMs = rand(FADE_IN_MIN, FADE_IN_MAX);
        c.cx = clickX + rand(-10, 10);
        c.cy = Math.max(CELL * 3, clickY - rand(32, 78));
        c.phaseA = rand(0, Math.PI * 2);
        c.phaseB = rand(0, Math.PI * 2);
        c.phaseC = rand(0, Math.PI * 2);
        /* Hz-ish rates chosen to avoid obvious period locking */
        c.freqA = rand(0.28, 0.52);
        c.freqB = rand(0.47, 0.79);
        c.freqC = rand(0.17, 0.33);
        c.ampA = rand(4, 9);
        c.ampB = rand(2.5, 5.5);
        c.ampC = rand(1.5, 3.8);
        c.driftVx = rand(-3.5, 3.5);
        c.driftVy = rand(-1.2, 1.2);
        c.breathPhase = rand(0, Math.PI * 2);
        c.breathFreq = rand(0.11, 0.22);
        c.breathAmp = rand(0.04, 0.1);
        c.rainStart = now + rand(RAIN_DELAY_MIN, RAIN_DELAY_MAX);
        const rainDur = rand(RAIN_DUR_MIN, RAIN_DUR_MAX);
        c.rainEnd = c.rainStart + rainDur;
        c.dissipateMs = rand(DISSIPATE_MS_MIN, DISSIPATE_MS_MAX);
        c.dissipateAt = c.rainEnd - c.dissipateMs * rand(0.45, 0.7);
        c.emitAcc = 0;
        c.seed = seed;
        bakeCloudCells(c, seed);
        return true;
      }

      function emitRain(c, now, dt, intensity, budget) {
        if (intensity <= 0.02 || budget.left <= 0) return;
        lightningTheme.sync();
        const rainTone = lightningTheme.rain;
        const rainBright = lightningTheme.highlight;
        const pos = cloudDrawPos(c, now);
        /* Soften emission when many storms share the field */
        const crowd = Math.max(1, activeClouds);
        const rate = (16 + c.cellCount * 0.14) / Math.sqrt(crowd);
        c.emitAcc += rate * intensity * dt;

        while (c.emitAcc >= 1 && budget.left > 0) {
          c.emitAcc -= 1;
          const di = acquireDrop();
          if (di < 0) break;
          budget.left--;

          const d = dropPool[di];
          const span = 22 + Math.min(42, c.cellCount * 0.28);
          d.alive = true;
          d.x = pos.x + rand(-span, span);
          d.y = pos.y + rand(4, 18);
          d.vx = wind * 0.35 + rand(-12, 12);
          d.vy = rand(70, 165);
          d.bright = rand(0.28, 0.62);
          d.phase = rand(0, Math.PI * 2);
          d.wobbleFreq = rand(1.1, 2.8);
          d.wobbleAmp = rand(5, 16);
          d.fadeIn = rand(0.08, 0.18);
          d.fadeOut = rand(0.18, 0.34);
          /* Bake shared theme tones so new drops follow RGB changes */
          d.tone = Math.random() < 0.35 ? 1 : 0;
          if (d.tone) {
            d.pr = rainBright[0];
            d.pg = rainBright[1];
            d.pb = rainBright[2];
          } else {
            d.pr = rainTone[0];
            d.pg = rainTone[1];
            d.pb = rainTone[2];
          }

          if (Math.random() < 0.4) {
            d.maxLife = rand(0.4, 1.25);
          } else {
            d.maxLife = rand(1.5, 3.6);
          }
          d.life = 0;
          liveDrops[liveCount++] = di;
        }
      }

      function ensureDensity() {
        if (densCols === cols && densRows === rows && density) return;
        densCols = cols;
        densRows = rows;
        density = new Float32Array(Math.max(1, densCols * densRows));
      }

      function updateClouds(dt, now) {
        lightningTheme.sync();
        ensureDensity();
        density.fill(0);

        /* Evolving breeze — two incommensurate oscillators, no hard loop */
        wind =
          Math.sin(now * 0.00031 + windPhaseA) * 14 +
          Math.sin(now * 0.00053 + windPhaseB) * 9 +
          Math.sin(now * 0.00019 + windPhaseA * 0.7) * 5;

        activeClouds = 0;
        for (let i = 0; i < CLOUD_POOL; i++) {
          if (cloudPool[i].alive) activeClouds++;
        }

        const budget = { left: MAX_EMIT_PER_FRAME };

        for (let i = 0; i < CLOUD_POOL; i++) {
          const c = cloudPool[i];
          if (!c.alive) continue;

          /* Slow center drift — storm cell wanders, never orbits a fixed point */
          c.cx += c.driftVx * dt;
          c.cy += c.driftVy * dt;
          c.driftVx += rand(-2.5, 2.5) * dt;
          c.driftVy += rand(-1.2, 1.2) * dt;
          if (c.driftVx > 5) c.driftVx = 5;
          if (c.driftVx < -5) c.driftVx = -5;
          if (c.driftVy > 2.5) c.driftVy = 2.5;
          if (c.driftVy < -2.5) c.driftVy = -2.5;

          const presence = cloudPresence(c, now);
          if (presence <= 0.001 && now >= c.dissipateAt) {
            c.alive = false;
            continue;
          }

          const breath =
            1 +
            Math.sin(now * 0.001 * c.breathFreq * Math.PI * 2 + c.breathPhase) *
              c.breathAmp;
          const pos = cloudDrawPos(c, now);
          const baseCol = Math.round(pos.x / CELL);
          const baseRow = Math.round(pos.y / CELL);

          for (let k = 0; k < c.cellCount; k++) {
            const gx = baseCol + c.ox[k];
            const gy = baseRow + c.oy[k];
            if (gx < 0 || gy < 0 || gx >= densCols || gy >= densRows) continue;
            /* Micro shimmer unique per cell — breaks static stamped look */
            const shimmer =
              0.93 +
              0.07 *
                Math.sin(
                  now * 0.0021 +
                    c.ox[k] * 0.7 +
                    c.oy[k] * 1.1 +
                    c.phaseA
                );
            const v = c.ow[k] * presence * breath * shimmer;
            const idx = gy * densCols + gx;
            if (v > density[idx]) density[idx] = v > 1 ? 1 : v;
          }

          emitRain(c, now, dt, rainIntensity(c, now) * presence, budget);
        }
      }

      function updateRain(dt) {
        let i = 0;
        while (i < liveCount) {
          const d = dropPool[liveDrops[i]];
          d.life += dt;
          if (d.life >= d.maxLife) {
            killDropAtLive(i);
            continue;
          }

          const wobble =
            Math.sin(d.life * d.wobbleFreq + d.phase) * d.wobbleAmp;
          d.vx += ((wind * 0.55 + wobble) - d.vx) * Math.min(1, dt * 1.8);
          d.x += d.vx * dt;
          d.y += d.vy * dt;
          /* Slight terminal-speed ease — heavier drops settle into pace */
          d.vy += (d.vy * 0.02) * dt;

          if (d.y > viewH + 14 || d.x < -24 || d.x > viewW + 24) {
            killDropAtLive(i);
            continue;
          }
          i++;
        }
      }

      function renderClouds(drawCtx) {
        if (!density) return;
        lightningTheme.sync();

        /* Shared palette: highlight rim → mid → cloud/shadow body */
        const rim = lightningTheme.highlight;
        const mid = lightningTheme.mid;
        const body = lightningTheme.cloud;
        const deep = lightningTheme.shadow;
        const n = densCols * densRows;

        for (let i = 0; i < n; i++) {
          const dens = density[i];
          if (dens < 0.035) continue;

          const x = i % densCols;
          const y = (i / densCols) | 0;
          const cx = x * CELL + CELL * 0.5;
          const cy = y * CELL + CELL * 0.5;
          const tint = Math.min(1, smootherstep(dens) * 0.9);

          let sr;
          let sg;
          let sb;
          if (dens < 0.4) {
            const t = dens / 0.4;
            sr = rim[0] + (mid[0] - rim[0]) * t;
            sg = rim[1] + (mid[1] - rim[1]) * t;
            sb = rim[2] + (mid[2] - rim[2]) * t;
          } else if (dens < 0.72) {
            const t = (dens - 0.4) / 0.32;
            sr = mid[0] + (body[0] - mid[0]) * t;
            sg = mid[1] + (body[1] - mid[1]) * t;
            sb = mid[2] + (body[2] - mid[2]) * t;
          } else {
            const t = (dens - 0.72) / 0.28;
            sr = body[0] + (deep[0] - body[0]) * t;
            sg = body[1] + (deep[1] - body[1]) * t;
            sb = body[2] + (deep[2] - body[2]) * t;
          }

          const r = (COOL[0] + (sr - COOL[0]) * tint) | 0;
          const g = (COOL[1] + (sg - COOL[1]) * tint) | 0;
          const b = (COOL[2] + (sb - COOL[2]) * tint) | 0;
          drawCtx.fillStyle = `rgb(${r},${g},${b})`;
          drawCtx.fillRect(cx - DOT * 0.5, cy - DOT * 0.5, DOT, DOT);
        }
      }

      function dropAlpha(d) {
        const t = d.life / d.maxLife;
        let fade = 1;
        if (t < d.fadeIn) fade = smootherstep(t / d.fadeIn);
        else if (t > 1 - d.fadeOut) fade = 1 - smootherstep((t - (1 - d.fadeOut)) / d.fadeOut);
        return d.bright * fade;
      }

      function renderRain(drawCtx) {
        for (let i = 0; i < liveCount; i++) {
          const d = dropPool[liveDrops[i]];
          const a = dropAlpha(d);
          if (a < 0.04) continue;

          const gx = (d.x / CELL) | 0;
          const gy = (d.y / CELL) | 0;
          if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) continue;

          const cx = gx * CELL + CELL * 0.5;
          const cy = gy * CELL + CELL * 0.5;

          const r = (COOL[0] + (d.pr - COOL[0]) * a) | 0;
          const g = (COOL[1] + (d.pg - COOL[1]) * a) | 0;
          const b = (COOL[2] + (d.pb - COOL[2]) * a) | 0;
          drawCtx.fillStyle = `rgb(${r},${g},${b})`;
          drawCtx.fillRect(cx - DOT * 0.5, cy - DOT * 0.5, DOT, DOT);

          if (a > 0.22 && gy > 0) {
            const ta = a * 0.35;
            const tr = (COOL[0] + (d.pr - COOL[0]) * ta) | 0;
            const tg = (COOL[1] + (d.pg - COOL[1]) * ta) | 0;
            const tb = (COOL[2] + (d.pb - COOL[2]) * ta) | 0;
            drawCtx.fillStyle = `rgb(${tr},${tg},${tb})`;
            drawCtx.fillRect(cx - DOT * 0.5, cy - CELL - DOT * 0.5, DOT, DOT);
          }
        }
      }

      function anyClouds() {
        for (let i = 0; i < CLOUD_POOL; i++) {
          if (cloudPool[i].alive) return true;
        }
        return false;
      }

      function anyRain() {
        return liveCount > 0;
      }

      function reset() {
        for (let i = 0; i < CLOUD_POOL; i++) cloudPool[i].alive = false;
        for (let i = 0; i < DROP_POOL; i++) dropPool[i].alive = false;
        liveCount = 0;
        activeClouds = 0;
        if (density) density.fill(0);
      }

      function onResize() {
        densCols = 0;
        densRows = 0;
        density = null;
      }

      return {
        spawn: spawn,
        reset: reset,
        clouds: {
          update: function (dt, now) { updateClouds(dt, now); },
          render: function (drawCtx) { renderClouds(drawCtx); },
          reset: function () {},
          onResize: onResize,
          isAlive: anyClouds,
        },
        rain: {
          update: function (dt) { updateRain(dt); },
          render: function (drawCtx) { renderRain(drawCtx); },
          reset: function () {},
          onResize: function () {},
          isAlive: anyRain,
        },
      };
    })();

    const clouds = clickWeather.clouds;
    const rain = clickWeather.rain;

    /* Procedural lightning renderer — unique bolt geometry per strike event.
       Timing is owned by SYSTEM 8 (`lightningstrike`). This layer only
       builds paths, stamps glow / flash, and paints — never schedules strikes. */
    const strikes = (function () {
      const POOL_SIZE = 4;
      const MAX_MAIN = 128;
      const MAX_BRANCH = 56;
      const MAX_BRANCHES = 3;

      const TARGET_NEAR = 100;
      const TARGET_MID = 200;
      const TARGET_FAR_MAX = 420;
      const BAND_NEAR = 0.75;
      const BAND_MID = 0.95;

      const RISE_MIN = 8;
      const RISE_MAX = 20;
      const ACTIVE_MIN = 300;
      const ACTIVE_MAX = 900;
      const AFTERGLOW_MIN = 200;
      const AFTERGLOW_MAX = 500;

      /* Base stamp radii — scaled per-strike by rolled width */
      const BASE_MAIN_RADIUS = 4.2;
      const BASE_BRANCH_RADIUS = 2.5;
      const BASE_ILLUM_RADIUS = 16;
      const GLOW_EPS = 0.006;
      const SAMPLE_STEP = CELL * 0.6;
      const STRIKE_BLOOM_THRESHOLD = 0.28;

      const HISTORY_SIZE = 14;
      const MIN_SEPARATION = 72;
      const recentX = new Float32Array(HISTORY_SIZE);
      const recentY = new Float32Array(HISTORY_SIZE);
      let recentCount = 0;
      let recentWrite = 0;

      /* Scratch — reused every spawn to avoid per-strike allocations */
      const scratchTarget = { x: 0, y: 0 };
      const scratchOrigin = { x: 0, y: 0 };
      const scratchPersonality = {
        isBranch: false,
        segMin: 4,
        segMax: 10,
        jagAmp: 10,
        wander: 1,
        bias: 0.6,
        zigChance: 0.18,
        kickChance: 0.15,
        kickScale: 1.5,
        side: 1,
        swayPhase: 0,
        swayFreq: 4,
        swayAmp: 0.5,
        vertWobble: 0.2,
      };
      const scratchBranchForks = new Int16Array(MAX_BRANCHES);
      let scratchBranchForkCount = 0;

      let glow = null;
      let after = null;
      let illum = null;
      let gridCols = 0;
      let gridRows = 0;
      let glowAlive = false;
      let afterAlive = false;
      let illumAlive = false;

      let prevPtrX = -1;
      let prevPtrY = -1;
      let ptrVX = 0;
      let ptrVY = 0;

      function ensureBuffers() {
        if (glow && after && illum && gridCols === cols && gridRows === rows) return;
        gridCols = cols;
        gridRows = rows;
        const n = Math.max(1, gridCols * gridRows);
        glow = new Float32Array(n);
        after = new Float32Array(n);
        illum = new Float32Array(n);
      }

      function rememberStrike(x, y) {
        recentX[recentWrite] = x;
        recentY[recentWrite] = y;
        recentWrite = (recentWrite + 1) % HISTORY_SIZE;
        if (recentCount < HISTORY_SIZE) recentCount++;
      }

      function tooCloseToRecent(x, y) {
        for (let i = 0; i < recentCount; i++) {
          const dx = x - recentX[i];
          const dy = y - recentY[i];
          if (dx * dx + dy * dy < MIN_SEPARATION * MIN_SEPARATION) return true;
        }
        return false;
      }

      function clampX(x) {
        const margin = CELL * 2;
        return Math.max(margin, Math.min(viewW - margin, x));
      }

      function clampInto(out, x, y) {
        const margin = CELL * 2;
        out.x = Math.max(margin, Math.min(viewW - margin, x));
        out.y = Math.max(margin, Math.min(viewH - margin, y));
        return out;
      }

      function trackPointer() {
        if (ptrX < 0) {
          prevPtrX = prevPtrY = -1;
          ptrVX *= 0.85;
          ptrVY *= 0.85;
          return;
        }
        if (prevPtrX >= 0) {
          ptrVX = ptrVX * 0.72 + (ptrX - prevPtrX) * 0.28;
          ptrVY = ptrVY * 0.72 + (ptrY - prevPtrY) * 0.28;
        }
        prevPtrX = ptrX;
        prevPtrY = ptrY;
      }

      function makeBranchBuffers() {
        return {
          len: 0,
          x: new Float32Array(MAX_BRANCH),
          y: new Float32Array(MAX_BRANCH),
        };
      }

      function makeStrike() {
        const branches = [];
        for (let b = 0; b < MAX_BRANCHES; b++) branches.push(makeBranchBuffers());
        return {
          alive: false,
          born: 0,
          riseMs: 12,
          activeMs: 500,
          afterglowMs: 1100,
          brightness: 1,
          flickerAmp: 0.07,
          flickerFreqA: 36,
          flickerFreqB: 61,
          flickerFreqC: 93,
          flickerPhaseA: 0,
          flickerPhaseB: 0,
          flickerPhaseC: 0,
          width: 1,
          mainRadius: BASE_MAIN_RADIUS,
          branchRadius: BASE_BRANCH_RADIUS,
          illumRadius: BASE_ILLUM_RADIUS,
          illumStrength: 0.7,
          mainLen: 0,
          mainX: new Float32Array(MAX_MAIN),
          mainY: new Float32Array(MAX_MAIN),
          branchCount: 0,
          branches: branches,
        };
      }

      const pool = [];
      for (let i = 0; i < POOL_SIZE; i++) pool.push(makeStrike());

      /* Most medium; occasional thin / thick. Cap keeps bolts sharp, not puffy. */
      function chooseStrikeWidth(lengthPx) {
        const lengthNorm = clamp01((lengthPx - 90) / 400);
        const roll = Math.random();
        let base;
        if (roll < 0.18) base = rand(0.4, 0.58);
        else if (roll < 0.88) base = rand(0.62, 0.88);
        else base = rand(0.9, 1.08);

        const lengthBias = (lengthNorm - 0.5) * 0.12;
        return Math.max(0.38, Math.min(1.12, base + lengthBias + rand(-0.04, 0.04)));
      }

      function fillPathPersonality(out, isBranch) {
        const segMin = isBranch ? rand(2.8, 5.8) : rand(3.4, 7.2);
        out.isBranch = !!isBranch;
        out.segMin = segMin;
        out.segMax = isBranch
          ? rand(segMin + 2.2, segMin + 8)
          : rand(segMin + 2.8, segMin + 11);
        out.jagAmp = isBranch ? rand(8, 22) : rand(11, 28);
        out.wander = rand(0.55, 1.45);
        out.bias = rand(0.4, 0.78);
        out.zigChance = rand(0.16, 0.38);
        out.kickChance = rand(0.14, 0.3);
        out.kickScale = rand(1.25, 2.7);
        out.side = Math.random() < 0.5 ? -1 : 1;
        out.swayPhase = rand(0, Math.PI * 2);
        out.swayFreq = rand(2.8, 9.2);
        out.swayAmp = rand(0.35, 1.05);
        out.vertWobble = isBranch ? rand(0.28, 0.75) : rand(0.1, 0.32);
        return out;
      }

      /**
       * Main bolts: always descend, terminate at/above target Y — never wrap under.
       * Branches: free zig-zag with their own personality.
       */
      function generateBolt(x0, y0, x1, y1, outX, outY, maxPts, personality) {
        const p = personality || fillPathPersonality(scratchPersonality, false);
        const isBranch = !!p.isBranch;
        const spanY = Math.max(1, y1 - y0);
        const spanDist = Math.hypot(x1 - x0, y1 - y0) || 1;

        let n = 0;
        outX[n] = x0;
        outY[n] = y0;
        n++;

        let x = x0;
        let y = y0;
        let side = p.side;
        let guard = 0;

        while (n < maxPts - 1 && guard++ < maxPts * 2) {
          if (!isBranch) {
            const remY = y1 - y;
            if (remY <= 1.25) break;

            const progress = clamp01((y - y0) / spanY);
            let segLen = rand(p.segMin, p.segMax);
            if (segLen > remY) segLen = Math.max(1.15, remY);

            if (Math.random() < p.zigChance) side *= -1;

            const mid = Math.sin(Math.max(0.04, Math.min(0.96, progress)) * Math.PI);
            const sway =
              Math.sin(p.swayPhase + progress * p.swayFreq * Math.PI * 2) *
              p.swayAmp *
              p.jagAmp;

            let lateral =
              side * rand(p.jagAmp * 0.28, p.jagAmp) * p.wander * (0.32 + mid * 0.88) +
              sway * mid +
              rand(-p.jagAmp * 0.3, p.jagAmp * 0.3);

            if (Math.random() < p.kickChance) {
              lateral += side * rand(p.jagAmp * 0.65, p.jagAmp * p.kickScale);
            }

            /* Descend first; attract X toward the strike point as we fall */
            const down = remY < p.segMax * 1.65
              ? remY
              : rand(segLen * 0.7, segLen);
            const attract = (0.18 + progress * 0.62) * p.bias;
            let nx = x + (x1 - x) * attract * (down / Math.max(remY, 1)) + lateral * (1 - attract * 0.35);
            let ny = y + down;

            /* Hard termination — never past the strike Y, always downward */
            if (ny > y1) ny = y1;
            if (ny <= y) ny = Math.min(y1, y + 1.4);
            nx = Math.max(-CELL * 3, Math.min(viewW + CELL * 3, nx));

            outX[n] = nx;
            outY[n] = ny;
            n++;
            x = nx;
            y = ny;

            if (y >= y1 - 0.75) break;
          } else {
            const rem = Math.hypot(x1 - x, y1 - y);
            if (rem < p.segMin * 0.75) break;

            const progress = 1 - rem / spanDist;
            const segLen = rand(p.segMin, p.segMax);
            const inv = 1 / rem;
            const dirX = (x1 - x) * inv;
            const dirY = (y1 - y) * inv;
            const perpX = -dirY;
            const perpY = dirX;

            if (Math.random() < p.zigChance) side *= -1;

            const mid = Math.sin(Math.max(0.04, Math.min(0.96, progress)) * Math.PI);
            let lateral =
              side * rand(p.jagAmp * 0.3, p.jagAmp) * p.wander * (0.35 + mid * 0.9) +
              Math.sin(p.swayPhase + progress * p.swayFreq * Math.PI * 2) *
                p.swayAmp * p.jagAmp * mid +
              rand(-p.jagAmp * 0.3, p.jagAmp * 0.3);

            if (Math.random() < p.kickChance) {
              lateral += side * rand(p.jagAmp * 0.7, p.jagAmp * p.kickScale);
            }

            const advance = Math.min(segLen * p.bias, rem * 0.92);
            let nx = x + dirX * advance + perpX * lateral;
            let ny = y + dirY * advance + perpY * lateral * p.vertWobble;

            if (Math.hypot(nx - x, ny - y) < 1.2) {
              nx = x + side * rand(2.5, 6);
              ny = y + dirY * Math.max(2, segLen * 0.5);
            }

            outX[n] = nx;
            outY[n] = ny;
            n++;
            x = nx;
            y = ny;
          }
        }

        /* Snap terminus: main ends at/just above target — never below */
        if (!isBranch) {
          const endY = Math.min(y1, Math.max(y0 + 1, y1 - rand(0, 2.2)));
          if (n > 0 && Math.hypot(outX[n - 1] - x1, outY[n - 1] - endY) < 1.5) {
            outX[n - 1] = x1;
            outY[n - 1] = endY;
          } else if (n < maxPts) {
            outX[n] = x1;
            outY[n] = endY;
            n++;
          }
        } else if (n < maxPts) {
          outX[n] = x1;
          outY[n] = y1;
          n++;
        }

        return n;
      }

      /* Cursor as electrical attractor — distance bands keep the storm alive but focused. */
      function pickStrikeTarget() {
        const cx = ptrX >= 0 ? ptrX : viewW * 0.5;
        const cy = ptrY >= 0 ? ptrY : viewH * 0.45;
        const speed = Math.hypot(ptrVX, ptrVY);
        const leadX = speed > 0.3 ? clamp01(speed / 18) * ptrVX * 3.2 : 0;
        const leadY = speed > 0.3 ? clamp01(speed / 18) * ptrVY * 1.4 : 0;
        const ax = cx + leadX;
        const ay = cy + leadY;
        const farCap = Math.min(TARGET_FAR_MAX, Math.max(TARGET_MID + 40, Math.hypot(viewW, viewH) * 0.32));

        for (let attempt = 0; attempt < 22; attempt++) {
          const band = Math.random();
          let dist;
          if (band < BAND_NEAR) {
            /* ~75% land within ~100px of the cursor */
            dist = Math.sqrt(Math.random()) * TARGET_NEAR;
            dist = Math.max(14, dist);
          } else if (band < BAND_MID) {
            /* ~20% within ~200px */
            dist = TARGET_NEAR + Math.random() * (TARGET_MID - TARGET_NEAR);
          } else {
            /* ~5% farther — keeps the storm unpredictable */
            dist = TARGET_MID + Math.random() * (farCap - TARGET_MID);
          }

          const angle = rand(0, Math.PI * 2);
          let tx = ax + Math.cos(angle) * dist;
          let ty = ay + Math.sin(angle) * dist;
          /* Soft vertical pull toward the attractor so bolts feel drawn to the cursor */
          ty = ty * 0.62 + ay * 0.38 + rand(-10, 10);

          clampInto(scratchTarget, tx, ty);
          scratchTarget.y = Math.max(CELL * 6, Math.min(scratchTarget.y, viewH - CELL * 2));

          if (!tooCloseToRecent(scratchTarget.x, scratchTarget.y)) return scratchTarget;
        }

        /* Escape hatch — push away from the densest recent hit while staying near cursor */
        const escapeAng = rand(0, Math.PI * 2);
        clampInto(
          scratchTarget,
          ax + Math.cos(escapeAng) * rand(48, 110),
          ay + Math.sin(escapeAng) * rand(28, 80)
        );
        scratchTarget.y = Math.max(CELL * 6, scratchTarget.y);
        return scratchTarget;
      }

      function pickOrigin() {
        const cursorX = ptrX >= 0 ? ptrX : viewW * 0.5;
        const tight = rand(24, 100);
        let ox = cursorX + rand(-tight, tight);

        const roll = Math.random();
        if (roll < 0.2) ox = cursorX + rand(-tight * 2.2, tight * 2.2);
        else if (roll < 0.3) {
          ox = cursorX + (Math.random() < 0.5 ? -1 : 1) * rand(tight * 1.3, tight * 2.6);
        }

        scratchOrigin.x = clampX(ox);
        scratchOrigin.y = 0;
        return scratchOrigin;
      }

      function chooseBranchCount() {
        const roll = Math.random();
        if (roll < 0.36) return 0;
        if (roll < 0.68) return 1;
        if (roll < 0.88) return 2;
        return 3;
      }

      /* Distinct fork indices into scratchBranchForks — no array alloc / sort alloc */
      function pickBranchOrigins(mainLen, want) {
        scratchBranchForkCount = 0;
        if (mainLen < 8 || want <= 0) return;

        const lo = Math.max(2, (mainLen * 0.1) | 0);
        const hi = Math.max(lo + 1, (mainLen * 0.86) | 0);
        const minSep = Math.max(3, (mainLen / (want + 2)) | 0);

        for (let attempt = 0; attempt < 28 && scratchBranchForkCount < want; attempt++) {
          const idx = lo + ((Math.random() * (hi - lo)) | 0);
          let ok = true;
          for (let i = 0; i < scratchBranchForkCount; i++) {
            if (Math.abs(scratchBranchForks[i] - idx) < minSep) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;

          /* Insert sorted */
          let insertAt = scratchBranchForkCount;
          for (let i = 0; i < scratchBranchForkCount; i++) {
            if (idx < scratchBranchForks[i]) {
              insertAt = i;
              break;
            }
          }
          for (let i = scratchBranchForkCount; i > insertAt; i--) {
            scratchBranchForks[i] = scratchBranchForks[i - 1];
          }
          scratchBranchForks[insertAt] = idx;
          scratchBranchForkCount++;
        }
      }

      function acquire() {
        for (let i = 0; i < POOL_SIZE; i++) {
          if (!pool[i].alive) return pool[i];
        }
        let oldest = pool[0];
        for (let i = 1; i < POOL_SIZE; i++) {
          if (pool[i].born < oldest.born) oldest = pool[i];
        }
        return oldest;
      }

      function spawn(now) {
        ensureBuffers();
        if (ptrX < 0 || !glow || viewW <= 0 || viewH <= 0) return false;

        const s = acquire();
        const target = pickStrikeTarget();
        const origin = pickOrigin();
        const estLen = Math.hypot(target.x - origin.x, target.y - origin.y);
        const width = chooseStrikeWidth(estLen);
        const branchScale = rand(0.48, 0.62);

        const mainPersonality = fillPathPersonality(scratchPersonality, false);

        s.born = now;
        /* Appear almost instantly, then hold active 0.3–0.9s before afterglow */
        s.riseMs = rand(RISE_MIN, RISE_MAX);
        s.activeMs = rand(ACTIVE_MIN, ACTIVE_MAX);
        s.afterglowMs = rand(AFTERGLOW_MIN, AFTERGLOW_MAX);
        s.brightness = rand(0.86, 1.0);
        s.flickerAmp = rand(0.035, 0.1);
        s.flickerFreqA = rand(26, 48);
        s.flickerFreqB = rand(52, 78);
        s.flickerFreqC = rand(88, 130);
        s.flickerPhaseA = rand(0, Math.PI * 2);
        s.flickerPhaseB = rand(0, Math.PI * 2);
        s.flickerPhaseC = rand(0, Math.PI * 2);
        s.width = width;
        s.mainRadius = BASE_MAIN_RADIUS * width;
        s.branchRadius = BASE_BRANCH_RADIUS * width * branchScale;
        s.illumRadius = BASE_ILLUM_RADIUS * (0.85 + width * 0.45);
        s.illumStrength = rand(0.55, 0.9) * (0.9 + width * 0.15);
        s.mainLen = generateBolt(
          origin.x, origin.y,
          target.x, target.y,
          s.mainX, s.mainY,
          MAX_MAIN,
          mainPersonality
        );

        const want = chooseBranchCount();
        pickBranchOrigins(s.mainLen, want);
        s.branchCount = 0;

        for (let b = 0; b < scratchBranchForkCount && s.branchCount < MAX_BRANCHES; b++) {
          const mid = scratchBranchForks[b];
          const bx0 = s.mainX[mid];
          const by0 = s.mainY[mid];
          const nx = s.mainX[Math.min(mid + 1, s.mainLen - 1)] - bx0;
          const ny = s.mainY[Math.min(mid + 1, s.mainLen - 1)] - by0;
          const mainAngle = Math.atan2(ny, nx);

          const side = Math.random() < 0.5 ? 1 : -1;
          const branchLen = rand(24, 130) * rand(0.5, 1.2);
          const forkAngle = mainAngle + side * rand(0.4, 1.65) + rand(-0.35, 0.35);
          let bx1 = bx0 + Math.cos(forkAngle) * branchLen + rand(-22, 22);
          let by1 = by0 + Math.sin(forkAngle) * branchLen + rand(-16, 20);
          by1 = Math.min(by1, target.y + rand(0, 16));

          const branchPersonality = fillPathPersonality(scratchPersonality, true);
          const branch = s.branches[b];
          branch.len = generateBolt(
            bx0, by0,
            bx1, by1,
            branch.x, branch.y,
            MAX_BRANCH,
            branchPersonality
          );
          s.branchCount++;
        }

        rememberStrike(target.x, target.y);
        s.alive = true;
        return true;
      }

      function strikeAge(s, now) {
        return now - s.born;
      }

      function activeEndMs(s) {
        return s.riseMs + s.activeMs;
      }

      function lifeEndMs(s) {
        return activeEndMs(s) + s.afterglowMs;
      }

      function boltEnvelope(s, now) {
        const age = strikeAge(s, now);
        if (age < 0) return 0;

        const rise = s.riseMs;
        const active = s.activeMs;

        /* Near-instant appear */
        if (age < rise) {
          return s.brightness * smootherstep(age / Math.max(1, rise));
        }

        /* Active phase only — subtle unstable electricity flicker */
        if (age < rise + active) {
          const t = age * 0.001;
          const flicker =
            1 +
            Math.sin(t * s.flickerFreqA + s.flickerPhaseA) * s.flickerAmp +
            Math.sin(t * s.flickerFreqB + s.flickerPhaseB) * s.flickerAmp * 0.55;
          const crackleWave = Math.sin(t * s.flickerFreqC + s.flickerPhaseC);
          const crackle = crackleWave > 0.9 ? 0.9 : crackleWave < -0.92 ? 0.94 : 1;
          return s.brightness * clamp01(flicker * crackle);
        }

        /* Active bolt is replaced by afterglow — no more full bolt body */
        return 0;
      }

      function afterglowEnvelope(s, now) {
        const age = strikeAge(s, now);
        const start = activeEndMs(s);
        if (age < start) return 0;
        const afterAge = age - start;
        if (afterAge >= s.afterglowMs) return 0;
        /* Smooth fade of the lighter electrical afterimage */
        return s.brightness * 0.72 * (1 - smootherstep(afterAge / s.afterglowMs));
      }

      /* Surrounding pixel illumination — lives through active + afterglow, then gone */
      function illumEnvelope(s, now) {
        const age = strikeAge(s, now);
        if (age < 0 || age >= lifeEndMs(s)) return 0;

        const rise = s.riseMs;
        const end = activeEndMs(s);

        if (age < rise) {
          return s.illumStrength * smootherstep(age / Math.max(1, rise));
        }
        if (age < end) {
          return s.illumStrength;
        }
        const afterAge = age - end;
        return s.illumStrength * (1 - smootherstep(afterAge / s.afterglowMs));
      }

      function stampPoint(buf, px, py, energy, radius, softPow) {
        if (!buf || energy <= 0 || radius <= 0) return;
        const cx = px / CELL;
        const cy = py / CELL;
        const r = radius;
        const r2 = r * r;
        const pow = softPow || 3;
        const x0 = Math.max(0, (cx - r) | 0);
        const y0 = Math.max(0, (cy - r) | 0);
        const x1 = Math.min(gridCols - 1, (cx + r + 1) | 0);
        const y1 = Math.min(gridRows - 1, (cy + r + 1) | 0);

        for (let y = y0; y <= y1; y++) {
          const dy = (y + 0.5) - cy;
          const dy2 = dy * dy;
          const row = y * gridCols;
          for (let x = x0; x <= x1; x++) {
            const dx = (x + 0.5) - cx;
            const d2 = dx * dx + dy2;
            if (d2 > r2) continue;
            const fall = 1 - d2 / r2;
            let soft = fall;
            for (let p = 1; p < pow; p++) soft *= fall;
            const core = d2 < 0.22 ? 1 : soft;
            const v = energy * core;
            const idx = row + x;
            if (v > buf[idx]) buf[idx] = v;
          }
        }
      }

      function stampPath(buf, ptsX, ptsY, len, energy, radius, softPow, varyWidth) {
        if (len < 2 || energy <= 0) return;
        for (let i = 0; i < len - 1; i++) {
          const x0 = ptsX[i];
          const y0 = ptsY[i];
          const x1 = ptsX[i + 1];
          const y1 = ptsY[i + 1];
          const dist = Math.hypot(x1 - x0, y1 - y0);
          const steps = Math.max(1, (dist / SAMPLE_STEP) | 0);
          const inv = 1 / steps;
          const rSeg = varyWidth
            ? radius * (0.93 + 0.12 * Math.sin(i * 1.7 + x0 * 0.03))
            : radius;
          for (let s = 0; s <= steps; s++) {
            const t = s * inv;
            stampPoint(
              buf,
              x0 + (x1 - x0) * t,
              y0 + (y1 - y0) * t,
              energy,
              rSeg,
              softPow
            );
          }
        }
      }

      function update(dt, now) {
        ensureBuffers();
        if (!glow || !after || !illum) return;

        lightningTheme.sync();
        trackPointer();

        /* Rebuild transient fields every frame from strike geometry —
           never mutate the base pixel grid; paintRest restores it each tick. */
        glow.fill(0);
        after.fill(0);
        illum.fill(0);

        let anyGlow = false;
        let anyAfter = false;
        let anyIllum = false;

        for (let i = 0; i < POOL_SIZE; i++) {
          const s = pool[i];
          if (!s.alive) continue;

          if (strikeAge(s, now) >= lifeEndMs(s)) {
            s.alive = false;
            continue;
          }

          const boltE = boltEnvelope(s, now);
          const afterE = afterglowEnvelope(s, now);
          const illumE = illumEnvelope(s, now);

          if (boltE > 0.001) {
            anyGlow = true;
            stampPath(glow, s.mainX, s.mainY, s.mainLen, boltE, s.mainRadius, 3, true);
            for (let b = 0; b < s.branchCount; b++) {
              const branch = s.branches[b];
              stampPath(
                glow,
                branch.x, branch.y, branch.len,
                boltE * 0.58,
                s.branchRadius,
                3,
                true
              );
            }
          }

          if (afterE > 0.001) {
            anyAfter = true;
            /* Softer, slightly wider afterimage replacing the active bolt */
            stampPath(
              after,
              s.mainX, s.mainY, s.mainLen,
              afterE,
              s.mainRadius * 1.35,
              2,
              false
            );
            for (let b = 0; b < s.branchCount; b++) {
              const branch = s.branches[b];
              stampPath(
                after,
                branch.x, branch.y, branch.len,
                afterE * 0.5,
                s.branchRadius * 1.25,
                2,
                false
              );
            }
          }

          if (illumE > 0.001) {
            anyIllum = true;
            stampPath(
              illum,
              s.mainX, s.mainY, s.mainLen,
              illumE,
              s.illumRadius,
              2,
              false
            );
            for (let b = 0; b < s.branchCount; b++) {
              const branch = s.branches[b];
              stampPath(
                illum,
                branch.x, branch.y, branch.len,
                illumE * 0.4,
                s.illumRadius * 0.6,
                2,
                false
              );
            }
          }
        }

        glowAlive = anyGlow;
        afterAlive = anyAfter;
        illumAlive = anyIllum;
      }

      function render(drawCtx) {
        if ((!glow || !glowAlive) && (!after || !afterAlive) && (!illum || !illumAlive)) return;

        lightningTheme.sync();
        const bolt = lightningTheme.bolt;
        const core = lightningTheme.highlight;
        const fringe = lightningTheme.glow;
        const afterCol = lightningTheme.afterglow;
        const illumCol = lightningTheme.flashBright;
        const n = gridCols * gridRows;

        for (let i = 0; i < n; i++) {
          const e = glow ? glow[i] : 0;
          const a = after ? after[i] : 0;
          const u = illum ? illum[i] : 0;
          if (e < GLOW_EPS && a < GLOW_EPS && u < GLOW_EPS) continue;

          const x = i % gridCols;
          const y = (i / gridCols) | 0;
          const cx = x * CELL + CELL * 0.5;
          const cy = y * CELL + CELL * 0.5;
          const size = DOT;

          const t = smootherstep(e);
          const presence = Math.min(1, t * 1.15);
          const afterT = smootherstep(Math.min(1, a * 1.05));
          const illumT = smootherstep(Math.min(1, u * 1.05));

          /* Start from pristine cool pixel — illumination/bolts are overlays only */
          let r = COOL[0];
          let g = COOL[1];
          let b = COOL[2];

          /* Surrounding illumination — distance falloff already in the illum field */
          if (illumT > 0) {
            const lift = illumT * 0.55;
            r += (illumCol[0] - r) * lift;
            g += (illumCol[1] - g) * lift;
            b += (illumCol[2] - b) * lift;

            if (illumT > 0.05) {
              const fEase = illumT * illumT * (3 - 2 * illumT);
              const fOuter = size + DOT * (0.8 + illumT * 1.4);
              drawCtx.fillStyle = `rgba(${illumCol[0] | 0},${illumCol[1] | 0},${illumCol[2] | 0},${fEase * 0.16})`;
              drawCtx.fillRect(cx - fOuter * 0.5, cy - fOuter * 0.5, fOuter, fOuter);
            }
          }

          /* Active bolt — darker selected RGB body */
          if (presence > 0.001) {
            let sr;
            let sg;
            let sb;
            if (t < 0.55) {
              const k = t / 0.55;
              sr = fringe[0] + (bolt[0] - fringe[0]) * k;
              sg = fringe[1] + (bolt[1] - fringe[1]) * k;
              sb = fringe[2] + (bolt[2] - fringe[2]) * k;
            } else {
              const k = (t - 0.55) / 0.45;
              sr = bolt[0] + (core[0] - bolt[0]) * k;
              sg = bolt[1] + (core[1] - bolt[1]) * k;
              sb = bolt[2] + (core[2] - bolt[2]) * k;
            }

            if (presence > STRIKE_BLOOM_THRESHOLD) {
              const bloom = (presence - STRIKE_BLOOM_THRESHOLD) / (1 - STRIKE_BLOOM_THRESHOLD);
              const bEase = smootherstep(bloom);
              const sOuter = size + DOT * BLOOM_SPREAD * 0.55;
              const sInner = size + DOT * BLOOM_SPREAD * 0.22;
              drawCtx.fillStyle = `rgba(${fringe[0] | 0},${fringe[1] | 0},${fringe[2] | 0},${bEase * 0.22})`;
              drawCtx.fillRect(cx - sOuter * 0.5, cy - sOuter * 0.5, sOuter, sOuter);
              drawCtx.fillStyle = `rgba(${bolt[0] | 0},${bolt[1] | 0},${bolt[2] | 0},${bEase * 0.32})`;
              drawCtx.fillRect(cx - sInner * 0.5, cy - sInner * 0.5, sInner, sInner);
            }

            r = r + (sr - r) * presence;
            g = g + (sg - g) * presence;
            b = b + (sb - b) * presence;
          }

          /* Afterglow afterimage — lighter RGB, replaces the active bolt */
          if (afterT > 0) {
            const soft = afterT * 0.85;
            r = r + (afterCol[0] - r) * soft;
            g = g + (afterCol[1] - g) * soft;
            b = b + (afterCol[2] - b) * soft;

            if (afterT > 0.06) {
              const aEase = afterT * afterT * (3 - 2 * afterT);
              const aOuter = size + DOT * (0.7 + afterT * 1.1);
              drawCtx.fillStyle = `rgba(${afterCol[0] | 0},${afterCol[1] | 0},${afterCol[2] | 0},${aEase * 0.18})`;
              drawCtx.fillRect(cx - aOuter * 0.5, cy - aOuter * 0.5, aOuter, aOuter);
            }
          }

          drawCtx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
          drawCtx.fillRect(cx - size * 0.5, cy - size * 0.5, size, size);
        }
      }

      function reset() {
        for (let i = 0; i < POOL_SIZE; i++) pool[i].alive = false;
        if (glow) glow.fill(0);
        if (after) after.fill(0);
        if (illum) illum.fill(0);
        glowAlive = false;
        afterAlive = false;
        illumAlive = false;
        recentCount = 0;
        recentWrite = 0;
        prevPtrX = prevPtrY = -1;
        ptrVX = ptrVY = 0;
      }

      function onResize(nextCols, nextRows) {
        if (nextCols === gridCols && nextRows === gridRows && glow && after && illum) return;
        gridCols = nextCols;
        gridRows = nextRows;
        const n = Math.max(1, gridCols * gridRows);
        glow = new Float32Array(n);
        after = new Float32Array(n);
        illum = new Float32Array(n);
        for (let i = 0; i < POOL_SIZE; i++) pool[i].alive = false;
        glowAlive = false;
        afterAlive = false;
        illumAlive = false;
      }

      function isAlive() {
        if (glowAlive || afterAlive || illumAlive) return true;
        for (let i = 0; i < POOL_SIZE; i++) {
          if (pool[i].alive) return true;
        }
        return false;
      }

      return {
        update: update,
        render: function (drawCtx) { render(drawCtx); },
        reset: reset,
        onResize: onResize,
        isAlive: isAlive,
        spawn: spawn,
      };
    })();

    const weatherLayers = [clouds, rain, strikes];

    /* Tiny pixel marker under the pointer — DOM layer, not part of strike sim */
    const cursorDot = document.getElementById('lightning-cursor');
    const CURSOR_DOT_SIZE = 5;
    /* Nudge up so the square sits on the OS cursor tip, not below it */
    const CURSOR_DOT_BENEATH = -1;

    function showCursorDot(x, y) {
      if (!cursorDot) return;
      const dx = Math.round(x - CURSOR_DOT_SIZE * 0.5);
      const dy = Math.round(y + CURSOR_DOT_BENEATH);
      cursorDot.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      cursorDot.classList.add('is-in-field');
    }

    function hideCursorDot() {
      if (!cursorDot) return;
      cursorDot.classList.remove('is-in-field');
    }

    let lastNow = 0;

    function applySurface() {
      canvas.width = Math.round(viewW * dpr);
      canvas.height = Math.round(viewH * dpr);
      canvas.style.width = viewW + 'px';
      canvas.style.height = viewH + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function syncStageRect() {
      const rect = stage.getBoundingClientRect();
      stageLeft = rect.left;
      stageTop = rect.top;
      return rect;
    }

    function paintRest() {
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
          size
        );
      }
    }

    function resize() {
      const rect = syncStageRect();
      viewW = Math.max(1, Math.round(rect.width));
      viewH = Math.max(1, Math.round(rect.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2);

      const nextCols = Math.ceil(viewW / CELL);
      const nextRows = Math.ceil(viewH / CELL);
      const gridChanged = nextCols !== cols || nextRows !== rows;

      cols = nextCols;
      rows = nextRows;

      if (gridChanged) {
        pixelField.onResize(cols, rows);
        for (let i = 0; i < weatherLayers.length; i++) {
          weatherLayers[i].onResize(cols, rows);
        }
      }

      if (!enabled) return;
      applySurface();
      paintRest();
      if (pixelField.isActive() || weatherAlive()) start();
    }

    function renderIntroLeds() {
      lightningTheme.sync();
      const HOT = lightningTheme.base;
      const GLOW = lightningTheme.glow;
      const n = cols * rows;
      let any = false;

      for (let i = 0; i < n; i++) {
        const introHv = pixelField.brightness(i);
        const introDX = pixelField.offsetX(i);
        const introDY = pixelField.offsetY(i);
        const introDrift = introDX !== 0 || introDY !== 0;
        if (!(introHv > 0) && !introDrift) continue;
        any = true;

        const x = i % cols;
        const y = (i / cols) | 0;
        const homeX = x * CELL + CELL * 0.5;
        const homeY = y * CELL + CELL * 0.5;
        const cx = homeX + introDX;
        const cy = homeY + introDY;
        const size = DOT;

        if (introDrift) {
          ctx.fillStyle = `rgb(${COOL[0]},${COOL[1]},${COOL[2]})`;
          ctx.fillRect(homeX - DOT * 0.5, homeY - DOT * 0.5, DOT, DOT);
        }

        const energy = introHv;
        const eased = energy * energy * (3 - 2 * energy);
        const tint = Math.min(1, Math.pow(eased, COLOR_FALLOFF));

        if (tint > BLOOM_THRESHOLD) {
          const bloom = (tint - BLOOM_THRESHOLD) / (1 - BLOOM_THRESHOLD);
          const bEase = bloom * bloom * (3 - 2 * bloom);
          const br = (GLOW[0] + (255 - GLOW[0]) * 0.2) | 0;
          const bg = (GLOW[1] + (255 - GLOW[1]) * 0.2) | 0;
          const bb = (GLOW[2] + (255 - GLOW[2]) * 0.2) | 0;
          const sOuter = size + DOT * BLOOM_SPREAD;
          const sInner = size + DOT * BLOOM_SPREAD * 0.45;
          ctx.fillStyle = `rgba(${br},${bg},${bb},${bEase * BLOOM_STRENGTH * 0.34})`;
          ctx.fillRect(cx - sOuter * 0.5, cy - sOuter * 0.5, sOuter, sOuter);
          ctx.fillStyle = `rgba(${br},${bg},${bb},${bEase * BLOOM_STRENGTH * 0.55})`;
          ctx.fillRect(cx - sInner * 0.5, cy - sInner * 0.5, sInner, sInner);
        }

        let r = COOL[0] + (HOT[0] - COOL[0]) * tint;
        let g = COOL[1] + (HOT[1] - COOL[1]) * tint;
        let b = COOL[2] + (HOT[2] - COOL[2]) * tint;
        if (tint > 0) {
          const lift = tint * BLOOM_BRIGHTNESS;
          const hi = lightningTheme.highlight;
          r += (hi[0] - r) * lift;
          g += (hi[1] - g) * lift * 0.85;
          b += (hi[2] - b) * lift * 0.9;
        }

        ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
        ctx.fillRect(cx - size * 0.5, cy - size * 0.5, size, size);
      }

      return any;
    }

    function weatherAlive() {
      for (let i = 0; i < weatherLayers.length; i++) {
        if (weatherLayers[i].isAlive()) return true;
      }
      return false;
    }

    function tick(now) {
      if (!enabled) {
        running = false;
        return;
      }

      /* Stable pacing — clamp spikes, floor tiny gaps so motion stays even */
      let dt = lastNow ? (now - lastNow) / 1000 : 1 / 60;
      if (dt > 0.045) dt = 0.045;
      if (dt < 0.001) dt = 0.001;
      lastNow = now;

      lightningTheme.sync();

      const introAlive = pixelField.update(now);

      paintRest();

      for (let i = 0; i < weatherLayers.length; i++) {
        weatherLayers[i].update(dt, now);
      }
      for (let i = 0; i < weatherLayers.length; i++) {
        weatherLayers[i].render(ctx, cols, rows, CELL, DOT);
      }

      const ledsAlive = renderIntroLeds();
      const alive = introAlive || ledsAlive || weatherAlive();

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
      lastNow = 0;
      requestAnimationFrame(tick);
    }

    function setEnabled(on) {
      enabled = on;
      if (!enabled) {
        running = false;
        lastNow = 0;
        hideCursorDot();
        clickWeather.reset();
        for (let i = 0; i < weatherLayers.length; i++) {
          weatherLayers[i].reset();
        }
        return;
      }

      lightningTheme.sync();
      lastNow = 0;
      if (viewW) {
        applySurface();
        paintRest();
      } else {
        resize();
      }
      /* Resume shared LED field / weather loop when Lightning becomes active */
      start();
    }

    window.addEventListener('bgmodechange', (e) => {
      const mode = e.detail && e.detail.mode;
      setEnabled(mode === 'lightning');
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

    window.addEventListener('animconfigchange', () => {
      lightningTheme.sync();
      if (enabled) start();
    });

    /* SYSTEM 8 → SYSTEM 9: timing events become unique bolt geometry */
    window.addEventListener('lightningstrike', (e) => {
      if (!enabled) return;
      if (
        typeof pixelField.interactionsEnabled === 'function' &&
        !pixelField.interactionsEnabled()
      ) {
        return;
      }
      const now = e.detail && e.detail.time != null ? e.detail.time : performance.now();
      if (strikes.spawn(now)) start();
    });

    window.addEventListener('resize', resize, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => resize());
      ro.observe(stage);
    }

    document.addEventListener('mousemove', (e) => {
      if (!enabled) return;
      if (
        typeof pixelField.interactionsEnabled === 'function' &&
        !pixelField.interactionsEnabled()
      ) {
        ptrX = ptrY = -1;
        hideCursorDot();
        return;
      }
      syncStageRect();
      const x = e.clientX - stageLeft;
      const y = e.clientY - stageTop;
      if (x < 0 || y < 0 || x > viewW || y > viewH) {
        ptrX = ptrY = -1;
        hideCursorDot();
        return;
      }
      ptrX = x;
      ptrY = y;
      showCursorDot(x, y);
      start();
    }, { passive: true });

    /* Click the field to seed a local storm cell (cloud + rain) */
    stage.addEventListener('click', (e) => {
      if (!enabled) return;
      if (
        typeof pixelField.interactionsEnabled === 'function' &&
        !pixelField.interactionsEnabled()
      ) {
        return;
      }
      if (e.button != null && e.button !== 0) return;
      syncStageRect();
      const x = e.clientX - stageLeft;
      const y = e.clientY - stageTop;
      if (x < 0 || y < 0 || x > viewW || y > viewH) return;
      clickWeather.spawn(x, y, performance.now());
      start();
    });

    document.documentElement.addEventListener('mouseleave', () => {
      ptrX = ptrY = -1;
      hideCursorDot();
    });

    resize();
  })();

  return {
    id: 'lightning',
    implemented: true,
    mount() {},
    destroy() {},
  };
}
