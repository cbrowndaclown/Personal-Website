/* Pixel FS — Magnetic (heat). V1 simulation preserved. */

/**
 * @param {object} deps
 */
export function createHeatStyle(deps) {
  const canvas = deps.canvas;
  const stage = deps.stage;
  const animConfig = deps.animConfig;
  const resolveActiveBgMode = deps.resolveActiveBgMode;
  const pixelField = deps.pixelField;
  const pixelIntro = deps.pixelIntro;
  if (!canvas || !stage) {
    return { id: 'heat', implemented: true, mount() {}, destroy() {} };
  }

  const CELL     = 5;      /* CSS pixels per cell — finer grid */
  const MAX_DISP = 0.40;   /* subtler max yield — expensive restraint */
  const HEAT_IN  = 0.09;   /* color lags motion — keep snappy under cursor */
  const HEAT_OUT = 0.018;  /* slow atmospheric cool — path lingers, same peak */
  const MOUSE_NEAR = 0.11; /* soft when cursor is close to sample */
  const MOUSE_FAR  = 0.26; /* catches up when pointer leaps */
  const DOT      = CELL - 2;
  const EPS      = 0.0006;

  /* ── Visual / influence (tweak freely) ──────────────────────────────────
     Soft coral heat radiating through the dot field.  These knobs only
     affect presentation + brush extent — not spring / damping math. */
  const RADIUS          = 11.8;             /* ~35% smaller soft brush (was 18.2) */
  const SIGMA           = 4.9;              /* scaled with radius — soft rim, no hard edge */
  const COLOR_INTENSITY = 0.92;             /* max heat presence under the cursor */
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

  function indicatorAccentActive() {
    if (typeof pixelField.indicatorAccentActive === 'function') {
      return pixelField.indicatorAccentActive();
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

  /* ── Spring (silicone / fabric) ─────────────────────────────────────────
     Overdamped mass-spring: force pulls dots, then they ease home.
     Return is softer than engagement; nonlinear drag kills bounce. */
  const STIFF_PULL   = 0.078; /* responsive under pressure */
  const STIFF_RETURN = 0.026; /* slow fabric recovery */
  const DRAG         = 0.29;  /* base velocity drag */
  const DRAG_QUAD    = 0.42;  /* extra drag at speed — settles clean */
  const V_MAX        = 0.20;  /* soft ceiling, no hard pops */

  /* ── Trail / pressure-wave (all configurable) ─────────────────────────── */
  const TRAIL_LENGTH   = 12;   /* short wake — one continuous lobe */
  const TRAIL_DECAY    = 0.50; /* tip-led; history only softens the wave */
  const TRAIL_MIN_STEP = 0.36; /* dense samples — liquid continuity */
  const TRAIL_FORCE    = 0.90; /* displacement gain */
  const TRAIL_FADE     = 0.965; /* slow wake dissolve after pointer leaves */
  const TRAIL_FADE_CUT = 0.015; /* drop samples only once nearly invisible */

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
  let enabled = animConfig.motion && resolveActiveBgMode() === 'heat';
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
    const rect = syncStageRect();
    viewW = Math.max(1, Math.round(rect.width));
    viewH = Math.max(1, Math.round(rect.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    const nextCols = Math.ceil(viewW / CELL);
    const nextRows = Math.ceil(viewH / CELL);
    const gridChanged = nextCols !== cols || nextRows !== rows;

    cols = nextCols;
    rows = nextRows;
    const n = cols * rows;

    if (gridChanged || !heat) {
      heat  = new Float32Array(n);
      ox    = new Float32Array(n);
      oy    = new Float32Array(n);
      vx    = new Float32Array(n);
      vy    = new Float32Array(n);
      trail.length = 0;
    }
    if (gridChanged) pixelField.onResize(cols, rows);

    /* Shared canvas — only claim the surface while Heat is active */
    if (!enabled) return;
    applySurface();
    paintRest();
    if (pixelField.isActive()) start();
  }

  function paintRest() {
    const latticeBoot = latticeBootActive();
    if (latticeBoot) {
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
      const size = DOT * Math.min(1, 0.35 + presence * 0.65);
      const a = Math.min(1, presence);
      let r;
      let g;
      let b;
      if (latticeBoot) {
        /* Black → white energy ladder during power-on */
        r = g = b = (255 * a) | 0;
      } else {
        r = (FIELD[0] + (COOL[0] - FIELD[0]) * a) | 0;
        g = (FIELD[1] + (COOL[1] - FIELD[1]) * a) | 0;
        b = (FIELD[2] + (COOL[2] - FIELD[2]) * a) | 0;
      }
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
  function falloff(d2, d) {
    const g = Math.exp(-d2 / (2 * SIGMA * SIGMA));
    const edge = smootherstep(1 - d / RADIUS);
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
      /* Softly age the wake out — pressure wave dissipates, no hard cut */
      for (let t = 0; t < trail.length; t++) {
        trail[t].w *= TRAIL_FADE;
      }
      while (trail.length && trail[trail.length - 1].w < TRAIL_FADE_CUT) trail.pop();
    }
  }

  function tick() {
    if (!running || !enabled) {
      running = false;
      return;
    }

    /* Live Settings accent — intro LEDs + cursor heat share this HOT */
    const HOT = [
      animConfig.effectColor.r,
      animConfig.effectColor.g,
      animConfig.effectColor.b,
    ];

    const introAlive = pixelField.update(performance.now());

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

    const active =
      pointerIn &&
      smX >= 0 &&
      (typeof pixelField.interactionsEnabled !== 'function' ||
        pixelField.interactionsEnabled());
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
    const latticeBoot = latticeBootActive();
    const indicatorAccent = indicatorAccentActive();

    if (latticeBoot) {
      ctx.fillStyle = '#000000';
    } else {
      ctx.fillStyle = `rgb(${FIELD[0]},${FIELD[1]},${FIELD[2]})`;
    }
    ctx.fillRect(0, 0, viewW, viewH);

    const nCells = cols * rows;
    /* During exclusive / lattice boot the PE owns the frame — no cursor heat */
    const allowHeat = !latticeBoot;

    for (let i = 0; i < nCells; i++) {
      const x = i % cols;
      const y = (i / cols) | 0;

      let targetX = 0;
      let targetY = 0;
      let pressure = 0;

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
          const f = falloff(d2, d) * p.w;
          if (f < EPS) continue;

          blend = blend + f * (1 - blend);

          if (d > 0.001) {
            const inv = f / d;
            fx += dx * inv;
            fy += dy * inv;
          }
        }

        pressure = blend * COLOR_INTENSITY;

        const mag = Math.hypot(fx, fy);
        if (mag > EPS) {
          /* Soft magnitude curve — yield eases in, never clips hard */
          const push = smootherstep(Math.min(1, mag * 1.15)) * MAX_DISP * TRAIL_FORCE;
          targetX = (fx / mag) * push;
          targetY = (fy / mag) * push;
        }
      }

      /* Color follows pressure — ease both ways, no stepped tint */
      const h = heat[i];
      if (allowHeat) {
        if (pressure > h) {
          heat[i] = h + (pressure - h) * HEAT_IN;
        } else {
          heat[i] = h + (0 - h) * HEAT_OUT;
          if (heat[i] < EPS) heat[i] = 0;
        }
      } else if (heat[i] !== 0) {
        heat[i] = 0;
      }

      /* Spring-damper: pressure displaces, then soft fabric return to rest */
      if (allowHeat) {
        springAxis(ox[i], vx[i], targetX);
        ox[i] = _s.pos; vx[i] = _s.vel;
        springAxis(oy[i], vy[i], targetY);
        oy[i] = _s.pos; vy[i] = _s.vel;
      } else {
        ox[i] = oy[i] = vx[i] = vy[i] = 0;
      }

      const introHv = pixelField.brightness(i);
      const introDX = latticeBoot && indicatorAccent ? 0 : pixelField.offsetX(i);
      const introDY = latticeBoot && indicatorAccent ? 0 : pixelField.offsetY(i);
      const introDrift = introDX !== 0 || introDY !== 0;
      const presence =
        typeof pixelField.presence === 'function' ? pixelField.presence(i) : 1;

      /* Undrawn lattice cells stay invisible until energy reaches them */
      if (presence <= 0.001 && introHv <= 0 && !introDrift && heat[i] < EPS) {
        continue;
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
        Lattice boot paint:
        - Indicator phases: presence = energy ladder, boot brightness = red arc/ring
        - Typography handoff: presence black, intro LEDs = white constructing glyphs
      */
      const bootSignal = indicatorAccent ? introHv : 0;
      const typeSignal = indicatorAccent ? 0 : introHv;
      const hv = Math.max(heat[i], introDrift ? 0 : bootSignal);
      const accent = indicatorAccent ? BOOT_RED : HOT;
      const eased = hv * hv * (3 - 2 * hv);
      const tint  = Math.min(1, Math.pow(eased, COLOR_FALLOFF) * GLOW_OPACITY);

      /* Depth from pressure + displacement — pressed centre, calm rim */
      const disp = Math.min(1, Math.hypot(ox[i], oy[i]) / (MAX_DISP + EPS));
      const depth = Math.min(1, heat[i] * 0.5 + disp * 0.45);
      const scale = 1 - smootherstep(depth) * 0.24;
      const presenceScale = latticeBoot
        ? Math.min(1, 0.55 + Math.max(presence, typeSignal) * 0.45)
        : Math.min(1, 0.35 + presence * 0.65);
      const size  = DOT * scale * presenceScale * (1 + (heat[i] > 0 ? tint * GLOW_SIZE : 0));

      const homeX = x * CELL + CELL * 0.5 + ox[i] * CELL;
      const homeY = y * CELL + CELL * 0.5 + oy[i] * CELL;
      const cx = homeX + introDX;
      const cy = homeY + introDY;

      /* While a glyph LED drifts away, restore the idle white dot at home */
      if (introDrift && heat[i] < EPS && presence > 0.001) {
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

      if (indicatorAccent && drawTint > BLOOM_THRESHOLD) {
        const bloom = smootherstep(
          (drawTint - BLOOM_THRESHOLD) / (1 - BLOOM_THRESHOLD)
        );
        const br = (accent[0] + (255 - accent[0]) * 0.58) | 0;
        const bg = (accent[1] + (255 - accent[1]) * 0.58) | 0;
        const bb = (accent[2] + (255 - accent[2]) * 0.58) | 0;
        const bloomGain = 0.85;
        const aOuter = bloom * BLOOM_STRENGTH * 0.32 * bloomGain;
        const aInner = bloom * BLOOM_STRENGTH * 0.55 * bloomGain;
        const sOuter = size + DOT * BLOOM_SPREAD * 0.75;
        const sInner = size + DOT * BLOOM_SPREAD * 0.35;

        ctx.fillStyle = `rgba(${br},${bg},${bb},${aOuter})`;
        ctx.fillRect(cx - sOuter * 0.5, cy - sOuter * 0.5, sOuter, sOuter);
        ctx.fillStyle = `rgba(${br},${bg},${bb},${aInner})`;
        ctx.fillRect(cx - sInner * 0.5, cy - sInner * 0.5, sInner, sInner);
      }

      /* Energy / self-test: luminance ladder + red indicator.
         Typography handoff on black: white glyph LEDs.
         Operational: FIELD → COOL → accent. */
      let r;
      let g;
      let b;
      if (latticeBoot) {
        if (typeSignal > 0.001 && !indicatorAccent) {
          const L = 255 * Math.min(1, typeSignal);
          r = L;
          g = L;
          b = L;
        } else {
          const L = 255 * Math.min(1, presence);
          r = L;
          g = L;
          b = L;
          if (drawTint > 0) {
            r = r + (accent[0] - r) * drawTint;
            g = g + (accent[1] - g) * drawTint;
            b = b + (accent[2] - b) * drawTint;
            const lift = drawTint * BLOOM_BRIGHTNESS;
            r += (255 - r) * lift;
            g += (248 - g) * lift;
            b += (250 - b) * lift;
          }
        }
      } else {
        r = FIELD[0] + (COOL[0] - FIELD[0]) * Math.min(1, presence);
        g = FIELD[1] + (COOL[1] - FIELD[1]) * Math.min(1, presence);
        b = FIELD[2] + (COOL[2] - FIELD[2]) * Math.min(1, presence);
        r = r + (accent[0] - r) * drawTint;
        g = g + (accent[1] - g) * drawTint;
        b = b + (accent[2] - b) * drawTint;
        if (drawTint > 0) {
          const lift = drawTint * BLOOM_BRIGHTNESS;
          r += (255 - r) * lift;
          g += (248 - g) * lift;
          b += (250 - b) * lift;
        }
      }

      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.fillRect(cx - size * 0.5, cy - size * 0.5, size, size);
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
    enabled = on;
    if (!enabled) {
      /* Keep pixelField running across Heat ↔ Wave ↔ Lightning switches */
      pointerIn = false;
      ptrX = ptrY = -1;
      smX = smY = -1;
      trail.length = 0;
      if (heat) {
        heat.fill(0);
        ox.fill(0);
        oy.fill(0);
        vx.fill(0);
        vy.fill(0);
      }
      running = false;
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

  window.addEventListener('bgmodechange', (e) => {
    const mode = e.detail && e.detail.mode;
    setEnabled(mode === 'heat');
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
    if (enabled) start();
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
      return;
    }
    syncStageRect();
    const x = e.clientX - stageLeft;
    const y = e.clientY - stageTop;
    const inside = x >= 0 && y >= 0 && x <= viewW && y <= viewH;
    if (inside) {
      ptrX = x;
      ptrY = y;
      pointerIn = true;
      start();
    } else if (pointerIn) {
      pointerIn = false;
      ptrX = ptrY = -1;
      start(); /* springs ease the field back to rest */
    }
  }, { passive: true });

  document.documentElement.addEventListener('mouseleave', () => {
    if (!enabled) return;
    pointerIn = false;
    ptrX = ptrY = -1;
    start(); /* springs ease the field back to rest */
  });

  resize();
  pixelIntro.schedule();

  return {
    id: 'heat',
    implemented: true,
    mount() {},
    destroy() {},
  };
}
