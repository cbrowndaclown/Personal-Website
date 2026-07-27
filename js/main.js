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
     SYSTEM 8 · LIGHTNING MODE
     ═══════════════════════════════════════════════════════════════════════════

     Independent weather field on the shared heatmap canvas / dot grid.
     Each weather layer owns its own update + render so strikes, clouds, rain,
     and future effects can grow without touching Heat or Wave.

     Current scaffold: rest field + intro/directory LED composite.
     Weather layers below are wired into the frame loop as no-op stubs.
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

    /* ── Weather layers (independent update/render; expand later) ─────────── */
    const clouds = {
      update: function (/* dt, now */) {
        /* Thunderclouds — rolling density across the upper field */
      },
      render: function (/* ctx, cols, rows, CELL, DOT */) {
        /* Draw cloud silhouette into the fixed pixel grid */
      },
      reset: function () {},
      onResize: function (/* cols, rows */) {},
    };

    const rain = {
      update: function (/* dt, now */) {
        /* Falling rain particles through the grid */
      },
      render: function (/* ctx, cols, rows, CELL, DOT */) {
        /* Illuminate rain streaks as brief cell flashes */
      },
      reset: function () {},
      onResize: function (/* cols, rows */) {},
    };

    const strikes = {
      update: function (/* dt, now */) {
        /* Lightning bolt paths + flash envelopes */
      },
      render: function (/* ctx, cols, rows, CELL, DOT */) {
        /* Branching strike illumination on the fixed grid */
      },
      reset: function () {},
      onResize: function (/* cols, rows */) {},
    };

    const weatherLayers = [clouds, rain, strikes];

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
      if (pixelField.isActive()) start();
    }

    function renderIntroLeds() {
      const HOT = [
        animConfig.effectColor.r,
        animConfig.effectColor.g,
        animConfig.effectColor.b,
      ];
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

      return any;
    }

    function tick(now) {
      if (!enabled) {
        running = false;
        return;
      }

      const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016;
      lastNow = now;

      const introAlive = pixelField.update(now);

      paintRest();

      for (let i = 0; i < weatherLayers.length; i++) {
        weatherLayers[i].update(dt, now);
      }
      for (let i = 0; i < weatherLayers.length; i++) {
        weatherLayers[i].render(ctx, cols, rows, CELL, DOT);
      }

      const ledsAlive = renderIntroLeds();
      const weatherAlive = false; /* flip when layers report activity */
      const alive = introAlive || ledsAlive || weatherAlive;

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
        for (let i = 0; i < weatherLayers.length; i++) {
          weatherLayers[i].reset();
        }
        return;
      }

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
      if (enabled) start();
    });

    window.addEventListener('resize', resize, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => resize());
      ro.observe(stage);
    }

    let ptrX = -1;
    let ptrY = -1;

    /* Pointer reserved for future strike targeting / rain density under cursor */
    document.addEventListener('mousemove', (e) => {
      if (!enabled) return;
      syncStageRect();
      const x = e.clientX - stageLeft;
      const y = e.clientY - stageTop;
      if (x < 0 || y < 0 || x > viewW || y > viewH) {
        ptrX = ptrY = -1;
        return;
      }
      ptrX = x;
      ptrY = y;
    }, { passive: true });

    document.documentElement.addEventListener('mouseleave', () => {
      ptrX = ptrY = -1;
    });

    resize();
  })();

})();
