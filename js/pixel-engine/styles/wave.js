/* Pixel FS — Wave. V1 simulation preserved. */

/**
 * @param {object} deps
 */
export function createWaveStyle(deps) {
  const canvas = deps.canvas;
  const stage = deps.stage;
  const animConfig = deps.animConfig;
  const resolveActiveBgMode = deps.resolveActiveBgMode;
  const pixelField = deps.pixelField;
  if (!canvas || !stage) {
    return { id: 'wave', implemented: true, mount() {}, destroy() {} };
  }

  /* Match Heat grid so both modes share the same visual field */
  const CELL  = 5;
  const DOT   = CELL - 2;
  const FIELD = [210, 210, 210];
  const COOL  = [255, 255, 255];
  const EPS   = 0.00045;

  /* ── Lattice / ripple (tweak freely) ────────────────────────────────────
     Hand-through-water wake: broader inject, velocity-scaled, still settles. */
  const ENERGY_INJECT = 0.24;  /* stronger push into the membrane */
  const TENSION       = 0.084; /* faster neighbor spread — wake fills out */
  const REST_K        = 0.007; /* persistence before calm */
  const DAMPING       = 0.022; /* smooth fade to a static rest */
  const V_MAX         = 0.52;  /* headroom for energetic wakes */
  const U_MAX         = 1.55;  /* crest ceiling */
  const DISP_PX       = 2.95;  /* visual travel */
  const SIZE_RESP     = 0.22;  /* crest scale */

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
    ctx.fillStyle = `rgb(${FIELD[0]},${FIELD[1]},${FIELD[2]})`;
    ctx.fillRect(0, 0, viewW, viewH);

    const half = (CELL - DOT) * 0.5;
    ctx.fillStyle = `rgb(${COOL[0]},${COOL[1]},${COOL[2]})`;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        ctx.fillRect(x * CELL + half, y * CELL + half, DOT, DOT);
      }
    }
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
    if (gridChanged || !u) {
      u = new Float32Array(n);
      v = new Float32Array(n);
      lastPtrX = lastPtrY = -1;
    }
    if (gridChanged) pixelField.onResize(cols, rows);

    if (!enabled) return;
    applySurface();
    paintRest();
    if (pixelField.isActive()) start();
  }

  /* Soft wake brush — hand through water; strength & width follow cursor speed. */
  function injectAt(localX, localY) {
    if (!v || !cols) return;

    let speed = 0;
    if (lastPtrX >= 0) {
      speed = Math.hypot(localX - lastPtrX, localY - lastPtrY);
      if (speed > WAKE_SPEED_MAX) {
        /* Teleport / tab-focus jump — start a fresh stroke, no spike */
        lastPtrX = localX;
        lastPtrY = localY;
        return;
      }
    }
    lastPtrX = localX;
    lastPtrY = localY;

    const speedT = smoothstep(Math.min(1, speed / WAKE_SPEED_PX));
    /* Slow → gentle; medium → fuller; fast → broad energetic wake */
    const strength = 0.32 + speedT * 1.25;
    const radius = WAKE_RADIUS * (1 + speedT * 0.65);

    const fx = localX / CELL;
    const fy = localY / CELL;
    const x0 = Math.max(0, Math.floor(fx - radius));
    const x1 = Math.min(cols - 1, Math.ceil(fx + radius));
    const y0 = Math.max(0, Math.floor(fy - radius));
    const y1 = Math.min(rows - 1, Math.ceil(fy + radius));
    const r2 = radius * radius;

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - fx;
        const dy = y + 0.5 - fy;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;

        const d = Math.sqrt(d2);
        const fall = smoothstep(1 - d / radius);
        const impulse = ENERGY_INJECT * strength * fall;
        if (impulse < EPS) continue;

        const i = y * cols + x;
        v[i] = softClamp(v[i] + impulse, V_MAX);
      }
    }

    start();
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

    const HOT = [
      animConfig.effectColor.r,
      animConfig.effectColor.g,
      animConfig.effectColor.b,
    ];

    const introAlive = pixelField.update(performance.now());
    const n = cols * rows;
    let alive = !!introAlive;

    /* Pass 1 — neighbor exchange (4-way + soft diagonals), shoreline damp */
    for (let i = 0; i < n; i++) {
      const x = i % cols;
      const y = (i / cols) | 0;
      const ui = u[i];
      const shore = shoreFactor(x, y);

      /* Cardinal + half-weight diagonals → broader, more continuous ripples */
      const lap =
        heightAt(x - 1, y) +
        heightAt(x + 1, y) +
        heightAt(x, y - 1) +
        heightAt(x, y + 1) +
        0.5 * (
          heightAt(x - 1, y - 1) +
          heightAt(x + 1, y - 1) +
          heightAt(x - 1, y + 1) +
          heightAt(x + 1, y + 1)
        ) -
        6 * ui;

      /* Rim drinks most of the energy; a little returns via ghost reflection */
      const damp = DAMPING + EDGE_ABSORB * shore * 0.10;
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

    /* Pass 2 — integrate displacement, then paint */
    ctx.fillStyle = `rgb(${FIELD[0]},${FIELD[1]},${FIELD[2]})`;
    ctx.fillRect(0, 0, viewW, viewH);

    const invU = 1 / (U_MAX * 0.72);
    const invV = 1 / (V_MAX * 1.15);

    for (let i = 0; i < n; i++) {
      const x = i % cols;
      const y = (i / cols) | 0;
      const shore = shoreFactor(x, y);

      let disp = u[i] + v[i];
      /* Gradual settle into the shore — no abrupt stop */
      if (shore > 0) {
        disp *= 1 - shore * 0.028;
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
      if (!introDrift && introHv > energy) energy = introHv;
      if (introHv > 0) alive = true;
      const eased = energy * energy * (3 - 2 * energy);
      const tint  = Math.min(1, Math.pow(eased, COLOR_FALLOFF));

      const size = DOT * (1 + mag * SIZE_RESP);
      const homeX = x * CELL + CELL * 0.5;
      const homeY = y * CELL + CELL * 0.5 + disp * DISP_PX;
      const cx = homeX + introDX;
      const cy = homeY + introDY;

      if (introDrift && Math.abs(disp) < EPS && Math.abs(vel) < EPS) {
        ctx.fillStyle = `rgb(${COOL[0]},${COOL[1]},${COOL[2]})`;
        ctx.fillRect(homeX - DOT * 0.5, homeY - DOT * 0.5, DOT, DOT);
      }

      const drawTint = introDrift
        ? Math.min(1, Math.pow(introHv * introHv * (3 - 2 * introHv), COLOR_FALLOFF))
        : tint;

      /* Subtle bloom on the brightest crests — premium neon, not harsh */
      if (drawTint > BLOOM_THRESHOLD) {
        const bloom = (drawTint - BLOOM_THRESHOLD) / (1 - BLOOM_THRESHOLD);
        const bEase = bloom * bloom * (3 - 2 * bloom);
        const br = (HOT[0] + (255 - HOT[0]) * 0.35) | 0;
        const bg = (HOT[1] + (255 - HOT[1]) * 0.35) | 0;
        const bb = (HOT[2] + (255 - HOT[2]) * 0.35) | 0;
        const sOuter = size + DOT * BLOOM_SPREAD;
        const sInner = size + DOT * BLOOM_SPREAD * 0.45;
        ctx.fillStyle = `rgba(${br},${bg},${bb},${bEase * BLOOM_STRENGTH * 0.34})`;
        ctx.fillRect(cx - sOuter * 0.5, cy - sOuter * 0.5, sOuter, sOuter);
        ctx.fillStyle = `rgba(${br},${bg},${bb},${bEase * BLOOM_STRENGTH * 0.55})`;
        ctx.fillRect(cx - sInner * 0.5, cy - sInner * 0.5, sInner, sInner);
      }

      let r = COOL[0] + (HOT[0] - COOL[0]) * drawTint;
      let g = COOL[1] + (HOT[1] - COOL[1]) * drawTint;
      let b = COOL[2] + (HOT[2] - COOL[2]) * drawTint;
      if (drawTint > 0) {
        const lift = drawTint * BLOOM_BRIGHTNESS;
        r += (255 - r) * lift;
        g += (220 - g) * lift * 0.35;
        b += (240 - b) * lift * 0.45;
      }

      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.fillRect(cx - size * 0.5, cy - size * 0.5, size, size);
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
      if (u) u.fill(0);
      if (v) v.fill(0);
      return;
    }

    lastPtrX = lastPtrY = -1;
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
    mount() {},
    destroy() {},
  };
}
