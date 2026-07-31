/* ==========================================================================
   main.js — Site chrome (nav, settings, nameplate) + Pixel Engine bootstrap
   ========================================================================== */

import { initSettings } from './settings/index.js';
import { initSettingsPersistence } from './settings/persist.js';
import { createPixelEngine } from './pixel-engine/index.js';
import { initAppScroll } from './app-scroll/index.js';

(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────────────────────
     1.  Footer year stamp
  ───────────────────────────────────────────────────────────────────────── */
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ─────────────────────────────────────────────────────────────────────────
     1. App scroll — (screen × nav) state machine
         Down:  S1 Open → S1 Closed → S2 Closed
         Up:    S2 Closed → S2 Open → S1 Open
         One deliberate gesture → one edge. Nav uses existing site-frame
         transform; screen changes are programmatic on #app-scroll.
         Unlocks on pixeldirectory* / pixelbootready (same as prior topnav).
  ───────────────────────────────────────────────────────────────────────── */
  const appScroll = initAppScroll({
    frame: document.getElementById('site-frame'),
    nav: document.getElementById('topnav'),
    shell: document.getElementById('app-scroll'),
    screenIds: ['pixel-fs-screen-1', 'pixel-fs-screen-2'],
  });

  /* Debug / compatibility */
  if (appScroll) window.appScroll = appScroll;
  /* ─────────────────────────────────────────────────────────────────────────
     Pixel Engine — grid, state, render, interaction, animation, Pixel FS
  ───────────────────────────────────────────────────────────────────────── */
  const engine = createPixelEngine({
    canvas: document.getElementById('heatmap'),
    stage: document.getElementById('stage'),
  });

  if (engine) {
    initSettings({
      getMotion: engine.getMotion,
      setMotion: engine.setMotion,
      getBgMode: engine.getBgMode,
      setBgMode: engine.setBgMode,
      getLastImplementedBgMode: engine.getLastImplementedBgMode,
      getEffectColor: engine.getEffectColor,
      setEffectColor: engine.setEffectColor,
      getHeatEnabled: engine.getHeatEnabled,
      setHeatEnabled: engine.setHeatEnabled,
      getHeatIntensity: engine.getHeatIntensity,
      setHeatIntensity: engine.setHeatIntensity,
      getHeatRadius: engine.getHeatRadius,
      setHeatRadius: engine.setHeatRadius,
      getHeatDecaySpeed: engine.getHeatDecaySpeed,
      setHeatDecaySpeed: engine.setHeatDecaySpeed,
      getPixelReactionStrength: engine.getPixelReactionStrength,
      setPixelReactionStrength: engine.setPixelReactionStrength,
      getPixelMovementSpeed: engine.getPixelMovementSpeed,
      setPixelMovementSpeed: engine.setPixelMovementSpeed,
      getPixelReturnSpeed: engine.getPixelReturnSpeed,
      setPixelReturnSpeed: engine.setPixelReturnSpeed,
      getPixelTrailLifetime: engine.getPixelTrailLifetime,
      setPixelTrailLifetime: engine.setPixelTrailLifetime,
      getCursorMode: engine.getCursorMode,
      setCursorMode: engine.setCursorMode,
      getPixelDensity: engine.getPixelDensity,
      setPixelDensity: engine.setPixelDensity,
      isPixelDensityLocked: engine.isPixelDensityLocked,
      getEffectQuality: engine.getEffectQuality,
      setEffectQuality: engine.setEffectQuality,
      getFrameRateTarget: engine.getFrameRateTarget,
      setFrameRateTarget: engine.setFrameRateTarget,
      getAdaptivePerformance: engine.getAdaptivePerformance,
      setAdaptivePerformance: engine.setAdaptivePerformance,
      beginBatch: engine.beginBatch,
      endBatch: engine.endBatch,
    });

    /* Auto-persist the complete animConfig whenever settings change.
       Simulation updates immediately; storage writes are debounced.
       Restore runs earlier inside createPixelEngine (before Pixel FS init). */
    initSettingsPersistence({
      animConfig: engine.animConfig,
      events: engine.events,
    });

    /* Debug / compatibility handles */
    window.pixelEngine = engine;
  } else {
    /* No PE boot — don't leave topnav locked forever */
    window.dispatchEvent(new CustomEvent('pixelbootready'));
  }

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

})();
