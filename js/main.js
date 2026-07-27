/* ==========================================================================
   main.js — Stage + top nav + settings + name ribbon + pixel field
   ========================================================================== */

(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────────────────────
     0.  Animation preferences — single source of truth for motion + pixels
  ───────────────────────────────────────────────────────────────────────── */
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const animConfig = {
    motion: !prefersReduced,
    bgMode: 'heat', /* remembered while Motion is off */
    /* Shared Heat / Wave cursor color — default neon hot pink */
    effectColor: { r: 255, g: 52, b: 158 },
  };

  function syncAnimDom() {
    document.body.dataset.motion = animConfig.motion ? 'on' : 'off';
    document.body.dataset.bgMode = animConfig.bgMode;
    const { r, g, b } = animConfig.effectColor;
    const root = document.documentElement;
    root.style.setProperty('--accent-r', String(r));
    root.style.setProperty('--accent-g', String(g));
    root.style.setProperty('--accent-b', String(b));
    root.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
  }

  function publishAnimConfig() {
    syncAnimDom();
    const detail = {
      motion: animConfig.motion,
      bgMode: animConfig.bgMode,
      effectColor: { ...animConfig.effectColor },
    };
    window.dispatchEvent(new CustomEvent('animconfigchange', { detail }));
    /* Legacy alias for pixel systems that already listen for mode changes */
    window.dispatchEvent(new CustomEvent('bgmodechange', {
      detail: { mode: animConfig.motion ? animConfig.bgMode : null },
    }));
  }

  function setMotion(on) {
    const next = !!on;
    if (animConfig.motion === next) return;
    animConfig.motion = next;
    publishAnimConfig();
  }

  function setBgMode(mode) {
    if (mode !== 'heat' && mode !== 'wave') return;
    if (animConfig.bgMode === mode) return;
    animConfig.bgMode = mode;
    publishAnimConfig();
  }

  function clampByte(n) {
    return Math.max(0, Math.min(255, n | 0));
  }

  function setEffectColor(r, g, b, publish) {
    animConfig.effectColor.r = clampByte(r);
    animConfig.effectColor.g = clampByte(g);
    animConfig.effectColor.b = clampByte(b);
    if (publish !== false) publishAnimConfig();
  }

  syncAnimDom();

  /* ─────────────────────────────────────────────────────────────────────────
     1.  Footer year stamp
  ───────────────────────────────────────────────────────────────────────── */
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ─────────────────────────────────────────────────────────────────────────
     1a. Top navigation — unified site-frame slides as one surface
         Hidden:   translateY(-navH) — frame flush with viewport top
         Revealed: translateY(0)     — nav attached above the frame
  ───────────────────────────────────────────────────────────────────────── */
  (function initTopNav() {
    const frame = document.getElementById('site-frame');
    const nav = document.getElementById('topnav');
    const homeBtn = document.getElementById('nav-home');
    const home = document.getElementById('home');
    if (!frame || !nav) return;

    const SHOW_THRESHOLD = 56; /* px of upward intent before reveal */
    const HIDE_THRESHOLD = 48; /* px of downward intent before hide */
    const DIR_RESET_SLACK = 8;

    let revealed = false;
    let accum = 0;
    let homeScrollRaf = 0;

    function setRevealed(next) {
      if (revealed === next) return;
      revealed = next;
      /* Only two states: parked (-navH via CSS) or flush (0) — no drift */
      frame.classList.toggle('is-nav-revealed', revealed);
      nav.setAttribute('aria-hidden', revealed ? 'false' : 'true');
      accum = 0;
      /* Hide settings if the nav parks away */
      if (!revealed) {
        window.dispatchEvent(new CustomEvent('topnavhide'));
      }
    }

    function applyIntent(deltaY) {
      if (!deltaY) return;

      if (accum !== 0 && Math.sign(deltaY) !== Math.sign(accum)) {
        if (Math.abs(deltaY) >= DIR_RESET_SLACK) accum = 0;
        else return;
      }

      accum += deltaY;

      if (!revealed && accum <= -SHOW_THRESHOLD) {
        setRevealed(true);
      } else if (revealed && accum >= HIDE_THRESHOLD) {
        setRevealed(false);
      }
    }

    function getScrollY() {
      return (
        window.pageYOffset ||
        document.documentElement.scrollTop ||
        document.body.scrollTop ||
        0
      );
    }

    function easeInOutCubic(t) {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    /* Smooth return to landing — ScrollToPlugin when present, else rAF */
    function scrollToHome() {
      const targetY = home
        ? getScrollY() + home.getBoundingClientRect().top
        : 0;

      if (window.gsap && window.ScrollToPlugin) {
        window.gsap.to(window, {
          duration: 0.85,
          scrollTo: { y: targetY, autoKill: true },
          ease: 'power2.inOut',
        });
        return;
      }

      if (prefersReduced) {
        window.scrollTo(0, targetY);
        return;
      }

      if (homeScrollRaf) cancelAnimationFrame(homeScrollRaf);
      const startY = getScrollY();
      const delta = targetY - startY;
      if (Math.abs(delta) < 1) return;

      const duration = 850;
      const startTime = performance.now();

      function tick(now) {
        const t = Math.min(1, (now - startTime) / duration);
        window.scrollTo(0, startY + delta * easeInOutCubic(t));
        if (t < 1) homeScrollRaf = requestAnimationFrame(tick);
        else homeScrollRaf = 0;
      }

      homeScrollRaf = requestAnimationFrame(tick);
    }

    if (homeBtn) {
      homeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        scrollToHome();
        /* Return to the parked landing composition */
        setRevealed(false);
      });
    }

    /* Document scroll is locked; wheel is the sole reveal gesture */
    window.addEventListener(
      'wheel',
      (e) => {
        if (e.target && e.target.closest && e.target.closest('.settings')) return;
        applyIntent(e.deltaY);
      },
      { passive: true }
    );
  })();

  /* ─────────────────────────────────────────────────────────────────────────
     1b. Settings panel — Motion + Effect (Heat / Wave)
  ───────────────────────────────────────────────────────────────────────── */
  (function initSettings() {
    const root  = document.querySelector('.settings');
    const btn   = document.getElementById('settings-btn');
    const panel = document.getElementById('settings-panel');
    const close = document.getElementById('settings-close');
    const motionSeg = document.getElementById('settings-motion');
    const effectSeg = document.getElementById('settings-effect');
    const effectRow = document.getElementById('settings-effect-row');
    const colorR = document.getElementById('settings-color-r');
    const colorG = document.getElementById('settings-color-g');
    const colorB = document.getElementById('settings-color-b');
    const colorRVal = document.getElementById('settings-color-r-val');
    const colorGVal = document.getElementById('settings-color-g-val');
    const colorBVal = document.getElementById('settings-color-b-val');
    const colorSwatch = document.getElementById('settings-color-swatch');
    if (!root || !btn || !panel || !close) return;

    let open = false;
    const body = panel.querySelector('.settings__body');
    const icon = btn.querySelector('.settings__icon');

    /* Gear spin tracks wheel/trackpad 1:1 — no inertia after scroll stops */
    let gearAngle = 0;
    const GEAR_SCALE = 0.22; /* deg per px of deltaY */
    const GEAR_MIN_ANGLE = -75;
    const GEAR_MAX_ANGLE = 75;

    function nudgeGear(deltaY) {
      if (!deltaY) return;
      gearAngle = Math.min(
        GEAR_MAX_ANGLE,
        Math.max(GEAR_MIN_ANGLE, gearAngle + deltaY * GEAR_SCALE)
      );
      if (icon) icon.style.transform = `rotate(${gearAngle}deg)`;
    }

    function setOpen(next) {
      open = next;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.setAttribute('aria-label', open ? 'Close settings' : 'Open settings');
      panel.classList.toggle('is-open', open);
      panel.setAttribute('aria-hidden', open ? 'false' : 'true');

      if (open) {
        close.focus({ preventScroll: true });
      } else {
        btn.focus({ preventScroll: true });
      }
    }

    function syncSeg(seg, active) {
      if (!seg) return;
      seg.dataset.active = active;
      seg.querySelectorAll('.settings__seg-opt').forEach((opt) => {
        const on = opt.dataset.value === active;
        opt.classList.toggle('is-active', on);
        opt.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }

    function syncFromConfig() {
      syncSeg(motionSeg, animConfig.motion ? 'on' : 'off');
      syncSeg(effectSeg, animConfig.bgMode);
      if (effectRow) {
        const locked = !animConfig.motion;
        effectRow.classList.toggle('is-disabled', locked);
        effectRow.setAttribute('aria-disabled', locked ? 'true' : 'false');
        if (effectSeg) {
          effectSeg.querySelectorAll('.settings__seg-opt').forEach((opt) => {
            opt.disabled = locked;
          });
        }
      }
      syncColorUi();
    }

    function syncColorUi() {
      const { r, g, b } = animConfig.effectColor;
      if (colorR) colorR.value = String(r);
      if (colorG) colorG.value = String(g);
      if (colorB) colorB.value = String(b);
      if (colorRVal) colorRVal.textContent = String(r);
      if (colorGVal) colorGVal.textContent = String(g);
      if (colorBVal) colorBVal.textContent = String(b);
      if (colorSwatch) colorSwatch.style.background = `rgb(${r},${g},${b})`;
    }

    function readColorSliders(publish) {
      if (!colorR || !colorG || !colorB) return;
      setEffectColor(colorR.value, colorG.value, colorB.value, publish);
      syncColorUi();
    }

    if (motionSeg) {
      motionSeg.addEventListener('click', (e) => {
        const opt = e.target.closest('.settings__seg-opt');
        if (!opt) return;
        setMotion(opt.dataset.value === 'on');
      });
    }

    if (effectSeg) {
      effectSeg.addEventListener('click', (e) => {
        if (!animConfig.motion) return;
        const opt = e.target.closest('.settings__seg-opt');
        if (!opt) return;
        setBgMode(opt.dataset.value);
      });
    }

    [colorR, colorG, colorB].forEach((input) => {
      if (!input) return;
      input.addEventListener('input', () => readColorSliders(true));
    });

    window.addEventListener('animconfigchange', syncFromConfig);
    syncFromConfig();

    /* Contain all wheel/trackpad to panel content; page scrolls when pointer leaves */
    panel.addEventListener(
      'wheel',
      (e) => {
        if (!open) return;
        e.preventDefault();
        nudgeGear(e.deltaY);
        if (body) body.scrollTop += e.deltaY;
      },
      { passive: false }
    );

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setOpen(!open);
    });

    close.addEventListener('click', (e) => {
      e.stopPropagation();
      setOpen(false);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && open) setOpen(false);
    });

    document.addEventListener('pointerdown', (e) => {
      if (!open) return;
      if (root.contains(e.target)) return;
      setOpen(false);
    });

    window.addEventListener('topnavhide', () => {
      if (open) setOpen(false);
    });
  })();

  /* ─────────────────────────────────────────────────────────────────────────
     1c. Nameplate ribbon — Benz Grotesk textPath, BL → BR along the frame
         Open path: up the left, across the top, down the right.
         Clockwise travel keeps glyphs outward (no TL flip). Smooth linear loop.
  ───────────────────────────────────────────────────────────────────────── */
  (function initNameplate() {
    const stage    = document.getElementById('stage');
    const shell    = document.getElementById('home');
    const svg      = document.querySelector('.nameplate__svg');
    const rimPath  = document.getElementById('nameplate-rim');
    const textEl   = document.querySelector('.nameplate__text');
    const textPath = document.getElementById('nameplate-tp');
    if (!stage || !svg || !rimPath || !textEl || !textPath) return;

    const LABEL = 'Canaan Brown';
    const SEP   = '   ·   ';
    const SQUIRCLE_N = 4;
    const CORNER_SAMPLES = 48;
    /* Slow liquid pace — px / second */
    const SPEED = 20;

    let pathLen = 0;
    let unitLen = 0;
    let offset  = 0;
    let lastTs  = 0;
    let rafId   = 0;
    let running = false;

    function clamp(n, a, b) {
      return Math.max(a, Math.min(b, n));
    }

    function cornerPoint(cx, cy, R, startAng, t) {
      const ang = startAng + t * (Math.PI / 2);
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const e = 2 / SQUIRCLE_N;
      return {
        x: cx + R * Math.sign(c) * Math.pow(Math.abs(c), e),
        y: cy + R * Math.sign(s) * Math.pow(Math.abs(s), e),
      };
    }

    /* Clockwise travel → outward is the CW normal (into the white margin). */
    function outwardNormal(tx, ty) {
      const len = Math.hypot(tx, ty) || 1;
      return { x: ty / len, y: -tx / len };
    }

    function appendCorner(pts, cx, cy, R, startAng, gap) {
      if (R < 0.5) return;
      for (let i = 0; i <= CORNER_SAMPLES; i++) {
        const t = i / CORNER_SAMPLES;
        const p0 = cornerPoint(cx, cy, R, startAng, Math.max(0, t - 0.5 / CORNER_SAMPLES));
        const p1 = cornerPoint(cx, cy, R, startAng, Math.min(1, t + 0.5 / CORNER_SAMPLES));
        const n = outwardNormal(p1.x - p0.x, p1.y - p0.y);
        const p = cornerPoint(cx, cy, R, startAng, t);
        const x = p.x + n.x * gap;
        const y = p.y + n.y * gap;
        const last = pts[pts.length - 1];
        if (last && Math.hypot(x - last.x, y - last.y) < 0.15) continue;
        pts.push({ x, y });
      }
    }

    function appendLine(pts, x2, y2, step) {
      const last = pts[pts.length - 1];
      if (!last) {
        pts.push({ x: x2, y: y2 });
        return;
      }
      const dx = x2 - last.x;
      const dy = y2 - last.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.15) return;
      const n = Math.max(1, Math.ceil(len / step));
      for (let i = 1; i <= n; i++) {
        pts.push({
          x: last.x + (dx * i) / n,
          y: last.y + (dy * i) / n,
        });
      }
    }

    /*
      Bottom-left → up left → TL squircle → across top → TR squircle →
      down right → bottom-right. Open bottom; clockwise so glyphs face out.
    */
    function buildRimPoints(W, H, R, gap) {
      const pts = [];
      const step = 8;
      const r = Math.min(R, W * 0.5, H * 0.5);

      /* Start bottom-left */
      pts.push({ x: -gap, y: H + gap * 0.35 });

      /* Up the left edge to the TL corner */
      appendLine(pts, -gap, r, step);

      /* TL: west → north (startAng = π) */
      appendCorner(pts, r, r, r, Math.PI, gap);

      /* Top edge, left → right */
      appendLine(pts, W - r, -gap, step);

      /* TR: north → east (startAng = 3π/2) */
      appendCorner(pts, W - r, r, r, Math.PI * 1.5, gap);

      /* Down the right edge to bottom-right */
      appendLine(pts, W + gap, H + gap * 0.35, step);

      return pts;
    }

    function pointsToPath(pts) {
      if (!pts.length) return '';
      let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
      for (let i = 1; i < pts.length; i++) {
        d += ` L ${pts[i].x.toFixed(2)} ${pts[i].y.toFixed(2)}`;
      }
      return d;
    }

    function measureUnit(fontSize) {
      const probe = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      probe.setAttribute('font-size', String(fontSize));
      probe.setAttribute('font-family', 'Benz Grotesk, Josefin Sans, system-ui, sans-serif');
      probe.setAttribute('font-weight', '400');
      probe.setAttribute('letter-spacing', '0.04em');
      probe.textContent = LABEL + SEP;
      probe.setAttribute('visibility', 'hidden');
      svg.appendChild(probe);
      const w = probe.getComputedTextLength();
      svg.removeChild(probe);
      return Math.max(w, fontSize * 8);
    }

    function layout() {
      const rect = stage.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;

      const cs = getComputedStyle(stage);
      const rRaw = parseFloat(cs.borderTopLeftRadius);
      const R = Number.isFinite(rRaw) && rRaw > 0 ? rRaw : 36;

      const band = Math.min(rect.top, rect.left, 36);
      const fontSize = clamp(band * 0.72, 16, 26);
      const gap = clamp(fontSize * 0.28, 6, 10);

      textEl.setAttribute('font-size', String(fontSize));
      textEl.style.fontSize = fontSize + 'px';

      const W = rect.width;
      const H = rect.height;
      const pts = buildRimPoints(W, H, R, gap);
      rimPath.setAttribute('d', pointsToPath(pts));

      pathLen = rimPath.getTotalLength();
      if (!(pathLen > 1)) return;

      const prevUnit = unitLen;
      unitLen = measureUnit(fontSize);

      if (prevUnit > 1) offset = (offset / prevUnit) * unitLen;
      offset = ((offset % unitLen) + unitLen) % unitLen;

      const copies = Math.max(2, Math.ceil(pathLen / unitLen) + 2);
      textPath.textContent = Array.from({ length: copies }, () => LABEL + SEP).join('');

      const pad = Math.ceil(fontSize * 1.6 + gap + 8);
      svg.setAttribute('viewBox', `${-pad} ${-pad} ${W + pad * 2} ${H + pad * 2}`);
      svg.setAttribute('width', String(Math.ceil(W + pad * 2)));
      svg.setAttribute('height', String(Math.ceil(H + pad * 2)));
      /* Position relative to page-shell so the ribbon rides the shell transform */
      const origin = shell ? shell.getBoundingClientRect() : { left: 0, top: 0 };
      svg.style.left = `${Math.round(rect.left - origin.left - pad)}px`;
      svg.style.top  = `${Math.round(rect.top  - origin.top  - pad)}px`;

      textPath.setAttribute('startOffset', String(-offset));
    }

    function tick(ts) {
      if (!running) return;
      if (!lastTs) lastTs = ts;
      const dt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;

      if (unitLen > 1) {
        offset = (offset + SPEED * dt) % unitLen;
        textPath.setAttribute('startOffset', String(-offset));
      }
      rafId = requestAnimationFrame(tick);
    }

    function start() {
      if (running) return;
      running = true;
      lastTs = 0;
      rafId = requestAnimationFrame(tick);
    }

    function stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    }

    layout();
    start();

    window.addEventListener('resize', layout, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(layout);
      ro.observe(stage);
      ro.observe(document.body);
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop();
      else {
        layout();
        start();
      }
    });

    if (document.fonts) {
      document.fonts.load('400 20px "Benz Grotesk"').then(layout).catch(() => {});
      if (document.fonts.ready) document.fonts.ready.then(layout).catch(() => {});
    }
  })();

  /* ═══════════════════════════════════════════════════════════════════════════
     BACKGROUND MODE — driven by settings Effect toggle
     (Heat / Wave selection lives in animConfig; no standalone UI.)
  ═══════════════════════════════════════════════════════════════════════════ */


  /* ═══════════════════════════════════════════════════════════════════════════
     SYSTEM 6 · PIXEL HEATMAP
     ═══════════════════════════════════════════════════════════════════════════

     Fine pixel grid filling the stage.  A short cursor history drives a
     blended pressure wave through the elastic field — dots displace under
     soft force; heat radiates as a warm coral-pink glow.  pointer-events off.
  ═══════════════════════════════════════════════════════════════════════════ */

  (function initHeatmap() {
    const canvas = document.getElementById('heatmap');
    const stage  = document.getElementById('stage');
    if (!canvas || !stage) return;

    const CELL     = 5;      /* CSS pixels per cell — finer grid */
    const MAX_DISP = 0.40;   /* subtler max yield — expensive restraint */
    const HEAT_IN  = 0.09;   /* color lags motion */
    const HEAT_OUT = 0.05;   /* gentle cool, no ribbon */
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
    const TRAIL_FADE     = 0.91; /* linger, then dissolve */

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
    let enabled = animConfig.motion && animConfig.bgMode === 'heat';
    let viewW = 0;
    let viewH = 0;
    let dpr = 1;
    let stageLeft = 0;
    let stageTop  = 0;

    /* Short cursor history in cell-space: newest at index 0.
       Each entry: { x, y, w } — w is relative strength (1 at tip). */
    const trail = [];

    /* ── Intro LED text — lights the same dots via HOT accent (Settings RGB) ── */
    const INTRO_IDLE_MS      = 700;   /* pure idle field before first LEDs */
    const INTRO_REVEAL_MS    = 2100;  /* staggered discovery window */
    const INTRO_HOLD_MS      = 1600;  /* fully formed brand hold */
    const INTRO_DISSOLVE_MS  = 1200;  /* individual LEDs turn off */
    const INTRO_SPARK_RATIO  = 0.11;  /* exploratory non-glyph flashes */

    let introTarget = null;  /* 1 = glyph cell */
    let introOn     = null;  /* live LED brightness (snaps — no fades) */
    let introLevel  = null;  /* per-LED peak 0.84–1 → tint through HOT */
    let introOnAt   = null;  /* ms from reveal clock when LED snaps on */
    let introOffAt  = null;  /* ms from reveal clock when LED snaps off */
    let introPhase  = 'pending'; /* pending | running | done | skipped */
    let introOrigin = 0;
    let introTimer  = 0;

    function hash01(i, salt) {
      let x = Math.imul(i ^ (salt | 0), 0x27d4eb2d);
      x = Math.imul(x ^ (x >>> 15), 0x85ebca6b);
      x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
      return ((x >>> 0) / 4294967296);
    }

    function clearIntroArrays() {
      if (!introOn) return;
      introOn.fill(0);
      if (introTarget) introTarget.fill(0);
      if (introLevel) introLevel.fill(0);
      if (introOnAt) introOnAt.fill(0);
      if (introOffAt) introOffAt.fill(0);
    }

    function cancelIntro() {
      if (introTimer) {
        clearTimeout(introTimer);
        introTimer = 0;
      }
      if (introPhase === 'running' || introPhase === 'pending') {
        introPhase = 'done';
      }
      clearIntroArrays();
    }

    /* Sample brand text into the cell grid — each lit sample is one LED. */
    function bakeIntroMask() {
      const n = cols * rows;
      introTarget = new Float32Array(n);
      introOn     = new Float32Array(n);
      introLevel  = new Float32Array(n);
      introOnAt   = new Float32Array(n);
      introOffAt  = new Float32Array(n);

      if (cols < 12 || rows < 8) return;

      const off = document.createElement('canvas');
      off.width = cols;
      off.height = rows;
      const octx = off.getContext('2d', { alpha: false });
      if (!octx) return;

      octx.fillStyle = '#000';
      octx.fillRect(0, 0, cols, rows);
      octx.fillStyle = '#fff';
      octx.textAlign = 'center';
      octx.textBaseline = 'middle';

      const dual = cols < 72;
      const lines = dual ? ['CANAAN', 'BROWN'] : ['CANAAN BROWN'];
      let fontPx = dual
        ? Math.max(5, Math.floor(rows * 0.16))
        : Math.max(6, Math.floor(rows * 0.20));

      for (let attempt = 0; attempt < 8; attempt++) {
        octx.font = `600 ${fontPx}px "Josefin Sans", system-ui, sans-serif`;
        let widest = 0;
        for (let L = 0; L < lines.length; L++) {
          widest = Math.max(widest, octx.measureText(lines[L]).width);
        }
        if (widest <= cols * 0.86) break;
        fontPx = Math.max(5, fontPx - 1);
      }

      octx.font = `600 ${fontPx}px "Josefin Sans", system-ui, sans-serif`;
      const lineGap = dual ? fontPx * 1.35 : 0;
      const startY = rows * 0.5 - lineGap * 0.5;

      for (let L = 0; L < lines.length; L++) {
        octx.fillText(lines[L], cols * 0.5, startY + L * lineGap);
      }

      const data = octx.getImageData(0, 0, cols, rows).data;
      let minX = cols;
      let maxX = -1;
      let minY = rows;
      let maxY = -1;
      const glyph = [];

      for (let i = 0; i < n; i++) {
        /* Hard threshold — crisp LED silhouette, no soft alpha fades */
        if (data[i * 4] > 140) {
          introTarget[i] = 1;
          glyph.push(i);
          const x = i % cols;
          const y = (i / cols) | 0;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }

      if (!glyph.length) return;

      const pad = Math.max(3, Math.round(Math.min(cols, rows) * 0.04));
      const bx0 = Math.max(0, minX - pad);
      const bx1 = Math.min(cols - 1, maxX + pad);
      const by0 = Math.max(0, minY - pad);
      const by1 = Math.min(rows - 1, maxY + pad);

      const revealEnd = INTRO_REVEAL_MS;
      const holdEnd   = revealEnd + INTRO_HOLD_MS;
      const cx = (minX + maxX) * 0.5;
      const cy = (minY + maxY) * 0.5;
      const diag = Math.hypot(maxX - minX, maxY - minY) + 1;

      /* Glyph LEDs — spatial + noise order so letters assemble, not stamp */
      for (let g = 0; g < glyph.length; g++) {
        const i = glyph[g];
        const x = i % cols;
        const y = (i / cols) | 0;
        const radial = Math.hypot(x - cx, y - cy) / diag;
        const n1 = hash01(i, 0xa11);
        const n2 = hash01(i, 0xb22);
        const order = Math.min(1, radial * 0.45 + n1 * 0.55);
        introOnAt[i]  = order * INTRO_REVEAL_MS;
        introOffAt[i] = holdEnd + n2 * INTRO_DISSOLVE_MS;
        introLevel[i] = 0.88 + n1 * 0.12;
      }

      /* Exploratory flashes — light, then realize they don't belong */
      for (let y = by0; y <= by1; y++) {
        for (let x = bx0; x <= bx1; x++) {
          const i = y * cols + x;
          if (introTarget[i]) continue;
          if (hash01(i, 0xc33) > INTRO_SPARK_RATIO) continue;
          const n1 = hash01(i, 0xd44);
          const n2 = hash01(i, 0xe55);
          const onAt = n1 * INTRO_REVEAL_MS * 0.72;
          const life = 90 + n2 * 280;
          introOnAt[i]  = onAt;
          introOffAt[i] = Math.min(revealEnd - 40, onAt + life);
          introLevel[i] = 0.62 + n1 * 0.28;
        }
      }
    }

    function introScheduled(i) {
      return introOffAt && introOffAt[i] > introOnAt[i];
    }

    /* Snap LEDs on/off from the intro clock — discrete, not faded. */
    function updateIntro(now) {
      if (introPhase !== 'running' || !introOn) return false;

      const t = now - introOrigin;
      const total = INTRO_REVEAL_MS + INTRO_HOLD_MS + INTRO_DISSOLVE_MS + 40;
      let anyLit = false;
      const n = cols * rows;

      for (let i = 0; i < n; i++) {
        if (!introScheduled(i)) {
          introOn[i] = 0;
          continue;
        }
        if (t >= introOnAt[i] && t < introOffAt[i]) {
          introOn[i] = introLevel[i];
          anyLit = true;
        } else {
          introOn[i] = 0;
        }
      }

      if (t >= total) {
        introPhase = 'done';
        clearIntroArrays();
        return false;
      }

      return anyLit || t < total;
    }

    function beginIntro() {
      introTimer = 0;
      if (!enabled || prefersReduced || introPhase === 'done' || introPhase === 'skipped') {
        return;
      }
      if (!heat || cols < 12) {
        introPhase = 'skipped';
        return;
      }
      bakeIntroMask();
      introOrigin = performance.now();
      introPhase = 'running';
      start();
    }

    function scheduleIntro() {
      if (prefersReduced || !animConfig.motion || animConfig.bgMode !== 'heat') {
        introPhase = 'skipped';
        return;
      }
      if (introPhase !== 'pending') return;

      const kick = () => {
        if (introPhase !== 'pending') return;
        introTimer = window.setTimeout(beginIntro, INTRO_IDLE_MS);
      };

      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(kick).catch(kick);
      } else {
        kick();
      }
    }

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

      cols = Math.ceil(viewW / CELL);
      rows = Math.ceil(viewH / CELL);
      const n = cols * rows;

      heat  = new Float32Array(n);
      ox    = new Float32Array(n);
      oy    = new Float32Array(n);
      vx    = new Float32Array(n);
      vy    = new Float32Array(n);
      trail.length = 0;

      /* Rebuild intro mask if mid-play; otherwise keep pending/done */
      if (introPhase === 'running') {
        bakeIntroMask();
        introOrigin = performance.now();
      }

      /* Shared canvas — only claim the surface while Heat is active */
      if (!enabled) return;
      applySurface();
      paintRest();
      if (introPhase === 'running') start();
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
        while (trail.length && trail[trail.length - 1].w < 0.04) trail.pop();
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

      const introAlive = updateIntro(performance.now());

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

      const active = pointerIn && smX >= 0;
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

      ctx.fillStyle = `rgb(${FIELD[0]},${FIELD[1]},${FIELD[2]})`;
      ctx.fillRect(0, 0, viewW, viewH);

      const nCells = cols * rows;

      for (let i = 0; i < nCells; i++) {
        const x = i % cols;
        const y = (i / cols) | 0;

        let targetX = 0;
        let targetY = 0;
        let pressure = 0;

        if (hasTrail && x >= x0 && x <= x1 && y >= y0 && y <= y1) {
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
        if (pressure > h) {
          heat[i] = h + (pressure - h) * HEAT_IN;
        } else {
          heat[i] = h + (0 - h) * HEAT_OUT;
          if (heat[i] < EPS) heat[i] = 0;
        }

        /* Spring-damper: pressure displaces, then soft fabric return to rest */
        springAxis(ox[i], vx[i], targetX);
        ox[i] = _s.pos; vx[i] = _s.vel;
        springAxis(oy[i], vy[i], targetY);
        oy[i] = _s.pos; vy[i] = _s.vel;

        const introHv = introOn ? introOn[i] : 0;

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
          Math.abs(ox[i]) > EPS ||
          Math.abs(oy[i]) > EPS ||
          Math.abs(vx[i]) > EPS ||
          Math.abs(vy[i]) > EPS
        ) {
          alive = true;
        }

        /* Intro LEDs share the heat tint path → live Settings RGB accent */
        const hv = Math.max(heat[i], introHv);
        /* Soft radial heat: strong under cursor → medium → subtle rim → cool.
           COLOR_FALLOFF < 1 keeps a gentle pink fringe; GLOW_OPACITY caps peak. */
        const eased = hv * hv * (3 - 2 * hv);
        const tint  = Math.min(1, Math.pow(eased, COLOR_FALLOFF) * GLOW_OPACITY);

        /* Depth from pressure + displacement — pressed centre, calm rim */
        const disp = Math.min(1, Math.hypot(ox[i], oy[i]) / (MAX_DISP + EPS));
        const depth = Math.min(1, heat[i] * 0.5 + disp * 0.45);
        const scale = 1 - smootherstep(depth) * 0.24;
        const size  = DOT * scale * (1 + (heat[i] > 0 ? tint : 0) * GLOW_SIZE);

        const cx = x * CELL + CELL * 0.5 + ox[i] * CELL;
        const cy = y * CELL + CELL * 0.5 + oy[i] * CELL;

        /* Faint feathered bloom — warm light through frosted glass.
           Driven by tint so it dissolves with the heat field. */
        if (tint > BLOOM_THRESHOLD) {
          const bloom = smootherstep(
            (tint - BLOOM_THRESHOLD) / (1 - BLOOM_THRESHOLD)
          );
          const br = (HOT[0] + (255 - HOT[0]) * 0.58) | 0;
          const bg = (HOT[1] + (255 - HOT[1]) * 0.58) | 0;
          const bb = (HOT[2] + (255 - HOT[2]) * 0.58) | 0;
          const aOuter = bloom * BLOOM_STRENGTH * 0.32;
          const aInner = bloom * BLOOM_STRENGTH * 0.55;
          const sOuter = size + DOT * BLOOM_SPREAD;
          const sInner = size + DOT * BLOOM_SPREAD * 0.45;

          ctx.fillStyle = `rgba(${br},${bg},${bb},${aOuter})`;
          ctx.fillRect(cx - sOuter * 0.5, cy - sOuter * 0.5, sOuter, sOuter);
          ctx.fillStyle = `rgba(${br},${bg},${bb},${aInner})`;
          ctx.fillRect(cx - sInner * 0.5, cy - sInner * 0.5, sInner, sInner);
        }

        /* Base accent tint, then a whisper of warm brightness with influence */
        let r = COOL[0] + (HOT[0] - COOL[0]) * tint;
        let g = COOL[1] + (HOT[1] - COOL[1]) * tint;
        let b = COOL[2] + (HOT[2] - COOL[2]) * tint;
        if (tint > 0) {
          const lift = tint * BLOOM_BRIGHTNESS;
          r += (255 - r) * lift;
          g += (248 - g) * lift;
          b += (250 - b) * lift;
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
        cancelIntro();
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
    }

    window.addEventListener('bgmodechange', (e) => {
      setEnabled(e.detail && e.detail.mode === 'heat');
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
    scheduleIntro();
  })();


  /* ═══════════════════════════════════════════════════════════════════════════
     SYSTEM 7 · WAVE MODE
     ═══════════════════════════════════════════════════════════════════════════

     Independent simulation on the shared heatmap canvas / dot grid.
     Damped spring-mass lattice — each dot is a membrane node.
     Cursor injects a velocity-scaled soft wake; ripples travel through neighbor coupling.
     Edges act as a soft shoreline: absorb most energy, faint reflection, fade.
  ═══════════════════════════════════════════════════════════════════════════ */

  (function initWaveMode() {
    const canvas = document.getElementById('heatmap');
    const stage  = document.getElementById('stage');
    if (!canvas || !stage) return;

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
    let enabled = animConfig.motion && animConfig.bgMode === 'wave';
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

      cols = Math.ceil(viewW / CELL);
      rows = Math.ceil(viewH / CELL);
      const n = cols * rows;
      u = new Float32Array(n);
      v = new Float32Array(n);
      lastPtrX = lastPtrY = -1;

      if (!enabled) return;
      applySurface();
      paintRest();
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

      const n = cols * rows;
      let alive = false;

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
        /* Wave energy → neon pink intensity (crest brightest, fades with calm) */
        let energy = mag * invU + Math.abs(vel) * invV * 0.4;
        if (energy > 1) energy = 1;
        const eased = energy * energy * (3 - 2 * energy);
        const tint  = Math.min(1, Math.pow(eased, COLOR_FALLOFF));

        const size = DOT * (1 + mag * SIZE_RESP);
        const cx = x * CELL + CELL * 0.5;
        const cy = y * CELL + CELL * 0.5 + disp * DISP_PX;

        /* Subtle bloom on the brightest crests — premium neon, not harsh */
        if (tint > BLOOM_THRESHOLD) {
          const bloom = (tint - BLOOM_THRESHOLD) / (1 - BLOOM_THRESHOLD);
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

        let r = COOL[0] + (HOT[0] - COOL[0]) * tint;
        let g = COOL[1] + (HOT[1] - COOL[1]) * tint;
        let b = COOL[2] + (HOT[2] - COOL[2]) * tint;
        if (tint > 0) {
          const lift = tint * BLOOM_BRIGHTNESS;
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
    }

    window.addEventListener('bgmodechange', (e) => {
      setEnabled(e.detail && e.detail.mode === 'wave');
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
  })();

})();
