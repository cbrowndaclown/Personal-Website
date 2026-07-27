/* ==========================================================================
   main.js — Stage + top nav + settings + name ribbon + pixel field
   ========================================================================== */

(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────────────────────
     0.  Animation preferences — single source of truth for motion + pixels
  ───────────────────────────────────────────────────────────────────────── */
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Pixel-field styles — each mode owns its own update/render system below. */
  const PIXEL_FIELD_STYLES = {
    heat:      { implemented: true },
    wave:      { implemented: true },
    lightning: { implemented: true },
  };

  const animConfig = {
    motion: !prefersReduced,
    bgMode: 'heat', /* default; remembered while Motion is off */
    /* Last fully implemented mode — used if a future placeholder is selected */
    lastImplementedBgMode: 'heat',
    /* Shared accent across Heat / Wave / Lightning */
    effectColor: { r: 255, g: 52, b: 158 },
  };

  function resolveActiveBgMode() {
    if (!animConfig.motion) return null;
    const style = PIXEL_FIELD_STYLES[animConfig.bgMode];
    if (style && style.implemented) return animConfig.bgMode;
    return animConfig.lastImplementedBgMode || 'heat';
  }

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
    const activeMode = resolveActiveBgMode();
    const detail = {
      motion: animConfig.motion,
      bgMode: animConfig.bgMode, /* UI / remembered selection (may be placeholder) */
      activeBgMode: activeMode,  /* simulation currently driving the canvas */
      effectColor: { ...animConfig.effectColor },
    };
    window.dispatchEvent(new CustomEvent('animconfigchange', { detail }));
    /* Legacy alias for pixel systems that already listen for mode changes.
       Emits the active (implemented) mode so placeholders don't blank the field. */
    window.dispatchEvent(new CustomEvent('bgmodechange', {
      detail: { mode: activeMode, selected: animConfig.bgMode },
    }));
  }

  function setMotion(on) {
    const next = !!on;
    if (animConfig.motion === next) return;
    const turningOn = next && !animConfig.motion;
    animConfig.motion = next;
    publishAnimConfig();
    /* Fired after bgmodechange listeners so field systems are already re-enabled */
    if (turningOn) {
      window.dispatchEvent(new CustomEvent('motionreenabled'));
    }
  }

  function setBgMode(mode) {
    if (!Object.prototype.hasOwnProperty.call(PIXEL_FIELD_STYLES, mode)) return;
    if (animConfig.bgMode === mode) return;
    const prev = PIXEL_FIELD_STYLES[animConfig.bgMode];
    if (prev && prev.implemented) {
      animConfig.lastImplementedBgMode = animConfig.bgMode;
    }
    animConfig.bgMode = mode;
    if (PIXEL_FIELD_STYLES[mode].implemented) {
      animConfig.lastImplementedBgMode = mode;
    }
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

    /* Document scroll is locked; wheel is the sole reveal gesture.
       Allowed during directory assemble so nav can open mid-animation. */
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
     1b. Settings panel — Motion + Effect (Heat / Wave / Lightning)
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
     (Heat / Wave / Lightning selection lives in animConfig; no standalone UI.)
  ═══════════════════════════════════════════════════════════════════════════ */


  /* ═══════════════════════════════════════════════════════════════════════════
     INTRO CONTROLLER — single owner of the entire landing sequence

       boot → intro (greeting / name) → directory → idle

     Exactly ONE GSAP master timeline exists at a time.
     Fast-forward = timeline.timeScale(FF_RATE).
     Space = skip() → kill timeline → final directory hold.
     LED phases read elapsed time from the master timeline — no competing clocks.
  ═══════════════════════════════════════════════════════════════════════════ */
  const introController = (function createIntroController() {
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
  })();

  /* Compatibility surface — heatmap / wave still talk to pixelField + schedule */
  const pixelField = {
    brightness: function (i) { return introController.brightness(i); },
    offsetX: function (i) { return introController.offsetX(i); },
    offsetY: function (i) { return introController.offsetY(i); },
    update: function (now) { return introController.update(now); },
    isActive: function () { return introController.isActive(); },
    onResize: function (c, r) { introController.onResize(c, r); },
    cancel: function () { introController.cancel(); },
  };

  const pixelIntro = {
    schedule: function () { introController.schedule(); },
    cancel: function () { introController.cancel(); },
    isRunning: function () {
      const p = introController.getPhase();
      return p === 'intro' || p === 'boot';
    },
  };

  window.bootSequence = introController;
  window.introController = introController;

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

        const introHv = pixelField.brightness(i);
        const introDX = pixelField.offsetX(i);
        const introDY = pixelField.offsetY(i);
        const introDrift = introDX !== 0 || introDY !== 0;

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
        const hv = Math.max(heat[i], introDrift ? 0 : introHv);
        /* Soft radial heat: strong under cursor → medium → subtle rim → cool.
           COLOR_FALLOFF < 1 keeps a gentle pink fringe; GLOW_OPACITY caps peak. */
        const eased = hv * hv * (3 - 2 * hv);
        const tint  = Math.min(1, Math.pow(eased, COLOR_FALLOFF) * GLOW_OPACITY);

        /* Depth from pressure + displacement — pressed centre, calm rim */
        const disp = Math.min(1, Math.hypot(ox[i], oy[i]) / (MAX_DISP + EPS));
        const depth = Math.min(1, heat[i] * 0.5 + disp * 0.45);
        const scale = 1 - smootherstep(depth) * 0.24;
        const size  = DOT * scale * (1 + (heat[i] > 0 ? tint * GLOW_SIZE : 0));

        const homeX = x * CELL + CELL * 0.5 + ox[i] * CELL;
        const homeY = y * CELL + CELL * 0.5 + oy[i] * CELL;
        const cx = homeX + introDX;
        const cy = homeY + introDY;

        /* While a glyph LED drifts away, restore the idle white dot at home */
        if (introDrift && heat[i] < EPS) {
          ctx.fillStyle = `rgb(${COOL[0]},${COOL[1]},${COOL[2]})`;
          ctx.fillRect(homeX - DOT * 0.5, homeY - DOT * 0.5, DOT, DOT);
        }

        /* Faint feathered bloom — warm light through frosted glass.
           Driven by tint so it dissolves with the heat field. */
        const drawTint = introDrift
          ? Math.min(1, Math.pow(introHv * introHv * (3 - 2 * introHv), COLOR_FALLOFF) * GLOW_OPACITY)
          : tint;

        if (drawTint > BLOOM_THRESHOLD) {
          const bloom = smootherstep(
            (drawTint - BLOOM_THRESHOLD) / (1 - BLOOM_THRESHOLD)
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
        let r = COOL[0] + (HOT[0] - COOL[0]) * drawTint;
        let g = COOL[1] + (HOT[1] - COOL[1]) * drawTint;
        let b = COOL[2] + (HOT[2] - COOL[2]) * drawTint;
        if (drawTint > 0) {
          const lift = drawTint * BLOOM_BRIGHTNESS;
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
    pixelIntro.schedule();
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
  })();


  /* ═══════════════════════════════════════════════════════════════════════════
     SYSTEM 8 · LIGHTNING STRIKE CONTROLLER
     ═══════════════════════════════════════════════════════════════════════════

     Timing-only system. Spawns strike *events* — never draws bolts.
     Rendering (if any) should listen for `lightningstrike` and stay independent.

     Rules:
       • Active only while Lightning field style is selected (and motion on)
       • Arms only while the cursor is inside the pixel field (#stage)
       • Pauses immediately on leave; resumes remaining wait on re-enter
       • One strike every random 2–6s; interval re-rolled after each strike
  ═══════════════════════════════════════════════════════════════════════════ */

  function createLightningStrikeController(options) {
    const opts = options || {};
    const intervalMin = opts.intervalMin != null ? opts.intervalMin : 2000;
    const intervalMax = opts.intervalMax != null ? opts.intervalMax : 6000;
    const onStrike = typeof opts.onStrike === 'function' ? opts.onStrike : null;

    let modeActive = false;
    let cursorInField = false;
    let timerId = null;
    let deadline = 0;
    /* ms left when paused; null means next arm should pick a fresh interval */
    let pausedRemaining = null;
    let strikeSeq = 0;
    let lastWaitMs = 0;

    function randomIntervalMs() {
      /* Irregular bands so consecutive waits rarely feel metronomic */
      const span = intervalMax - intervalMin;
      const u = Math.random();
      let wait;
      if (u < 0.2) wait = intervalMin + Math.random() * span * 0.28;
      else if (u < 0.55) wait = intervalMin + span * (0.22 + Math.random() * 0.38);
      else if (u < 0.82) wait = intervalMin + span * (0.48 + Math.random() * 0.32);
      else wait = intervalMin + span * (0.7 + Math.random() * 0.3);

      /* Nudge away from the previous wait when it would feel rhythmic */
      if (lastWaitMs > 0 && Math.abs(wait - lastWaitMs) < span * 0.12) {
        wait = wait > lastWaitMs
          ? Math.min(intervalMax, wait + span * randSkew())
          : Math.max(intervalMin, wait - span * randSkew());
      }
      lastWaitMs = wait;
      return wait;
    }

    function randSkew() {
      return 0.12 + Math.random() * 0.22;
    }

    function clearTimer() {
      if (timerId == null) return;
      clearTimeout(timerId);
      timerId = null;
    }

    function canRun() {
      return modeActive && cursorInField;
    }

    function arm(waitMs) {
      clearTimer();
      if (!canRun()) return;
      const wait = Math.max(0, waitMs);
      deadline = performance.now() + wait;
      timerId = setTimeout(fireStrike, wait);
    }

    function fireStrike() {
      timerId = null;
      if (!canRun()) return;

      strikeSeq += 1;
      const detail = {
        id: strikeSeq,
        time: performance.now(),
        intervalMin: intervalMin,
        intervalMax: intervalMax,
      };

      if (onStrike) onStrike(detail);
      window.dispatchEvent(new CustomEvent('lightningstrike', { detail: detail }));

      pausedRemaining = null;
      arm(randomIntervalMs());
    }

    function pause() {
      if (timerId == null) return;
      pausedRemaining = Math.max(0, deadline - performance.now());
      clearTimer();
    }

    function resume() {
      if (!canRun()) return;
      if (timerId != null) return;
      const wait = pausedRemaining != null ? pausedRemaining : randomIntervalMs();
      pausedRemaining = null;
      arm(wait);
    }

    function sync() {
      if (canRun()) resume();
      else pause();
    }

    return {
      setModeActive: function (on) {
        const next = !!on;
        if (modeActive === next) {
          sync();
          return;
        }
        modeActive = next;
        if (!modeActive) {
          pause();
          pausedRemaining = null;
          return;
        }
        sync();
      },
      setCursorInField: function (inside) {
        const next = !!inside;
        if (cursorInField === next) return;
        cursorInField = next;
        sync();
      },
      reset: function () {
        clearTimer();
        pausedRemaining = null;
        deadline = 0;
        lastWaitMs = 0;
      },
      destroy: function () {
        clearTimer();
        modeActive = false;
        cursorInField = false;
        pausedRemaining = null;
        deadline = 0;
        lastWaitMs = 0;
      },
      isArmed: function () {
        return timerId != null;
      },
      isActive: function () {
        return canRun();
      },
    };
  }

  (function initLightningStrikeController() {
    const stage = document.getElementById('stage');
    if (!stage) return;

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


  /* ═══════════════════════════════════════════════════════════════════════════
     SYSTEM 9 · LIGHTNING MODE (render / weather field)
     ═══════════════════════════════════════════════════════════════════════════

     Independent weather field on the shared heatmap canvas / dot grid.
     Each weather layer owns its own update + render so strikes, clouds, rain,
     and future effects can grow without touching Heat or Wave.

     Strike *timing* lives in SYSTEM 8. This system listens for
     `lightningstrike` and builds a unique procedural bolt for each event.

     Strikes / clouds / rain / glow / cursor all share one Lightning theme
     palette derived from the settings RGB (highlight, base, mid, shadow,
     glow, rain, cloud) so the field stays visually cohesive.
  ═══════════════════════════════════════════════════════════════════════════ */

  (function initLightningMode() {
    const canvas = document.getElementById('heatmap');
    const stage  = document.getElementById('stage');
    if (!canvas || !stage) return;

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

      const half = (CELL - DOT) * 0.5;
      ctx.fillStyle = `rgb(${COOL[0]},${COOL[1]},${COOL[2]})`;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          ctx.fillRect(x * CELL + half, y * CELL + half, DOT, DOT);
        }
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

    window.addEventListener('animconfigchange', () => {
      lightningTheme.sync();
      if (enabled) start();
    });

    /* SYSTEM 8 → SYSTEM 9: timing events become unique bolt geometry */
    window.addEventListener('lightningstrike', (e) => {
      if (!enabled) return;
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

})();
