/* ==========================================================================
   main.js — Site chrome (nav, settings, nameplate) + Pixel Engine bootstrap
   ========================================================================== */

import { initSettings } from './settings/index.js';
import { initSettingsPersistence } from './settings/persist.js';
import { createPresetManager } from './settings/presets/index.js';
import { createPixelEngine } from './pixel-engine/index.js';
import { initAppScroll } from './app-scroll/index.js';

(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────────────────────
     1. App scroll — (screen × nav) state machine
         Start: Screen 1 + Navigation Open
         Down:  Open → Closed → Screen 2 Closed
         Up:    Screen 2 Closed → Open → Screen 1 Open
         Sole scroller: #app-scroll (Pixel FS screens). Ribbon frame never scrolls.
         Nav edges intercepted; screen changes use native CSS snap.
         Topnav slides inside .page-shell (ribbon frame stays put).
  ───────────────────────────────────────────────────────────────────────── */
  const appScroll = initAppScroll({
    frame: document.getElementById('site-frame'),
    nav: document.getElementById('topnav'),
    shell: document.getElementById('app-scroll'),
    screenIds: ['pixel-fs-screen-1', 'pixel-fs-screen-2'],
  });

  const homeBtn = document.getElementById('nav-home');
  if (homeBtn && appScroll) {
    homeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (!appScroll.isInteractive()) return;
      /* Return to Screen 1 + navigation open (application start). */
      void appScroll.goHome();
    });
  }

  /* ─────────────────────────────────────────────────────────────────────────
     Pixel Engine — grid, state, render, interaction, animation, Pixel FS
  ───────────────────────────────────────────────────────────────────────── */
  const engine = createPixelEngine({
    canvas: document.getElementById('heatmap'),
    stage: document.getElementById('stage'),
    hitBounds: document.getElementById('pixel-fs-screen-1-bounds')
      || document.getElementById('pixel-fs-screen-1'),
  });

  if (engine) {
    /* Preset Manager — inactive through BOOT → INTRO → MENU_GENERATION.
       Saved settings were restored silently in createPixelEngine; reconcile
       only syncs Active vs Custom. activate() after menu hold unlocks
       refresh transitions. */
    const presets = createPresetManager({
      animConfig: engine.animConfig,
      beginBatch: engine.beginBatch,
      endBatch: engine.endBatch,
      publishAnimConfig: engine.config.publishAnimConfig,
      syncAnimDom: engine.config.syncAnimDom,
      prefersReduced: engine.config.prefersReduced,
      events: engine.events,
      interactive: false,
      beginPresetRefresh: (opts) => {
        const field = engine.animation && engine.animation.pixelField;
        return field && typeof field.beginPresetRefresh === 'function'
          ? field.beginPresetRefresh(opts)
          : { mode: 'instant' };
      },
      finishPresetRefreshInstant: () => {
        const field = engine.animation && engine.animation.pixelField;
        if (field && typeof field.finishPresetRefreshInstant === 'function') {
          field.finishPresetRefreshInstant();
        }
      },
      onActivate: () => {
        const field = engine.animation && engine.animation.pixelField;
        if (field && typeof field.setPresetEffectsAllowed === 'function') {
          field.setPresetEffectsAllowed(true);
        }
      },
    });

    function activatePresetSystem() {
      presets.activate();
    }
    /* Menu fully settled — unlock preset transitions. Do NOT use
       pixelbootready: READY stage emits it before directory generation. */
    window.addEventListener('pixeldirectoryhold', activatePresetSystem);
    /*
      createPixelEngine may already have emitted pixeldirectoryhold (sync
      jumpToReady while Heat style schedules boot). Catch up so interactive
      is not stuck false with the Preset dropdown permanently disabled.
    */
    const intro = engine.animation && engine.animation.introController;
    const introPhase =
      intro && typeof intro.getPhase === 'function' ? intro.getPhase() : null;
    if (introPhase === 'idle' || introPhase === 'skipped') {
      activatePresetSystem();
    }

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
      getPixelReactionStrength: engine.getPixelReactionStrength,
      setPixelReactionStrength: engine.setPixelReactionStrength,
      getPixelMovementSpeed: engine.getPixelMovementSpeed,
      setPixelMovementSpeed: engine.setPixelMovementSpeed,
      getPixelDecaySpeed: engine.getPixelDecaySpeed,
      setPixelDecaySpeed: engine.setPixelDecaySpeed,
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
      listPresets: () => presets.listPresets(),
      getPresetOptions: () => presets.getPresetOptions(),
      getActivePresetId: () => presets.getActivePresetId(),
      loadPreset: (id) => presets.loadPreset(id),
      isPresetSystemActive: () => presets.isInteractive(),
      isPresetTransitionActive: () => presets.isTransitionActive(),
      registerPreset: (preset) => presets.register(preset),
    });

    /* Auto-persist the complete animConfig whenever settings change.
       Simulation updates immediately; storage writes are debounced.
       Restore runs earlier inside createPixelEngine (before Pixel FS init). */
    initSettingsPersistence({
      animConfig: engine.animConfig,
      events: engine.events,
    });

    /* Debug / compatibility handles */
    engine.presets = presets;
    window.pixelEngine = engine;
  } else {
    /* No PE boot — unlock shell (Screen 2, nav, scroll, snap) immediately */
    delete document.body.dataset.boot;
    delete document.body.dataset.appStartup;
    const screen2 = document.getElementById('pixel-fs-screen-2');
    if (screen2) screen2.setAttribute('aria-hidden', 'false');
    window.dispatchEvent(new CustomEvent('pixelstartupdone'));
    window.dispatchEvent(new CustomEvent('pixelbootready'));
  }

  /* ─────────────────────────────────────────────────────────────────────────
     1c. Nameplate ribbon — Benz Grotesk textPath around the visible device
         window (the #app-scroll scrollport inside the ribbon frame).
         Closed path: up left → TL → top → TR → down right → BR → bottom → BL.
         Clockwise travel keeps glyphs outward (no TL flip).
         Geometry is locked to the fixed ribbon viewport — it does NOT track
         the tall scrolling stage, so the ribbon never moves independently
         when Pixel FS screens snap. Canvas still scrolls with .stage.
         Endless conveyor: phase is time-based within one measured tile so the
         startOffset wrap is visually identical (no hitch / reset).
  ───────────────────────────────────────────────────────────────────────── */
  (function initNameplate() {
    const stage     = document.getElementById('stage');
    const rimHost   = document.getElementById('app-scroll'); /* visible device window */
    const frame     = document.getElementById('home');
    const svg      = document.querySelector('.nameplate__svg');
    const rimPath  = document.getElementById('nameplate-rim');
    const textEl   = document.querySelector('.nameplate__text');
    const textPath = document.getElementById('nameplate-tp');
    if (!rimHost || !frame || !svg || !rimPath || !textEl || !textPath) return;

    const LABEL = 'Canaan Brown';
    const SEP   = '   ·   ';
    const TILE  = LABEL + SEP;
    const SQUIRCLE_N = 4;
    const CORNER_SAMPLES = 48;
    /* Slow liquid pace — px / second (constant velocity) */
    const SPEED = 20;

    let pathLen = 0;
    let unitLen = 0;
    /* Phase locked to a clock epoch so we never accumulate float-dt error. */
    let phase = 0;
    let epoch = 0;
    let rafId = 0;
    let layoutRaf = 0;
    let running = false;
    const hasBaseVal = !!(textPath.startOffset && textPath.startOffset.baseVal);

    function clamp(n, a, b) {
      return Math.max(a, Math.min(b, n));
    }

    function wrapUnit(x, period) {
      if (!(period > 0)) return 0;
      return x - Math.floor(x / period) * period;
    }

    /* Direct SVG length write — no attribute string thrash per frame. */
    function applyOffset(o) {
      if (hasBaseVal) textPath.startOffset.baseVal.value = -o;
      else textPath.setAttribute('startOffset', String(-o));
    }

    function currentOffset(now) {
      if (!(unitLen > 1) || !epoch) return phase;
      return wrapUnit(phase + SPEED * ((now - epoch) / 1000), unitLen);
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
      Closed clockwise rim around the visible device window:
      left ↑ → TL squircle → top → TR → right ↓ → BR → bottom ← → BL → close.
      Clockwise travel keeps glyphs facing outward into the white chrome.
    */
    function buildRimPoints(W, H, R, gap) {
      const pts = [];
      const step = 8;
      const r = Math.min(R, W * 0.5, H * 0.5);

      /* Start on the left edge, just above the BL corner */
      pts.push({ x: -gap, y: H - r });

      /* Up the left edge to the TL corner */
      appendLine(pts, -gap, r, step);

      /* TL: west → north (startAng = π) */
      appendCorner(pts, r, r, r, Math.PI, gap);

      /* Top edge, left → right */
      appendLine(pts, W - r, -gap, step);

      /* TR: north → east (startAng = 3π/2) */
      appendCorner(pts, W - r, r, r, Math.PI * 1.5, gap);

      /* Down the right edge to the BR corner */
      appendLine(pts, W + gap, H - r, step);

      /* BR: east → south (startAng = 0) */
      appendCorner(pts, W - r, H - r, r, 0, gap);

      /* Bottom edge, right → left */
      appendLine(pts, r, H + gap, step);

      /* BL: south → west (startAng = π/2) */
      appendCorner(pts, r, H - r, r, Math.PI * 0.5, gap);

      /* Close back to the left-edge start */
      appendLine(pts, -gap, H - r, step);

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

    /*
      Tile period must match the live textPath advances exactly — a detached
      probe (or CSS vs presentation-attribute mismatch) desyncs the wrap and
      produces a hitch every cycle. getSubStringLength(0, tileChars) is the
      layout engine’s own period for startOffset.
    */
    function measureAndFill(fontSize) {
      textEl.setAttribute('font-size', String(fontSize));
      textEl.style.fontSize = fontSize + 'px';

      const tileChars = TILE.length;
      textPath.textContent = TILE;
      let measured = 0;
      try {
        measured = textPath.getSubStringLength(0, tileChars);
      } catch (_) {
        measured = textPath.getComputedTextLength();
      }
      if (!(measured > 0)) measured = fontSize * 8;

      const copies = Math.max(4, Math.ceil(pathLen / measured) + 3);
      textPath.textContent = TILE.repeat(copies);

      let unit = measured;
      try {
        const exact = textPath.getSubStringLength(0, tileChars);
        if (exact > 0) unit = exact;
      } catch (_) {
        const full = textPath.getComputedTextLength();
        if (full > 0) unit = full / copies;
      }
      return { unit, copies };
    }

    function layout() {
      /* Size to the fixed scrollport — never the tall scrolling stage. */
      const rect = rimHost.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;

      const radiusSrc = stage || rimHost;
      const cs = getComputedStyle(radiusSrc);
      const rRaw = parseFloat(cs.borderTopLeftRadius);
      const R = Number.isFinite(rRaw) && rRaw > 0 ? rRaw : 36;

      /* Chrome band from ribbon padding — stable; ribbon never scrolls */
      const frameCs = getComputedStyle(frame);
      const padY = Math.min(
        parseFloat(frameCs.paddingTop) || 27,
        parseFloat(frameCs.paddingBottom) || 27
      );
      const padX = parseFloat(frameCs.paddingLeft) || 8;
      const band = Math.min(padY, padX, 36);
      const fontSize = clamp(band * 0.72, 16, 26);
      const gap = clamp(fontSize * 0.28, 6, 10);

      const W = rect.width;
      const H = rect.height;
      const pts = buildRimPoints(W, H, R, gap);
      rimPath.setAttribute('d', pointsToPath(pts));

      pathLen = rimPath.getTotalLength();
      if (!(pathLen > 1)) return;

      const now = performance.now();
      const prevUnit = unitLen;
      const visual = currentOffset(now);

      const { unit } = measureAndFill(fontSize);
      unitLen = unit;

      /* Preserve conveyor position across relayout / font swap / resize. */
      if (prevUnit > 1 && unitLen > 1) {
        phase = wrapUnit((visual / prevUnit) * unitLen, unitLen);
      } else {
        phase = 0;
      }
      epoch = now;
      applyOffset(phase);

      const pad = Math.ceil(fontSize * 1.6 + gap + 8);
      svg.setAttribute('viewBox', `${-pad} ${-pad} ${W + pad * 2} ${H + pad * 2}`);
      svg.setAttribute('width', String(Math.ceil(W + pad * 2)));
      svg.setAttribute('height', String(Math.ceil(H + pad * 2)));
      /*
        Ribbon frame does not scroll — pin the rim to the visible device
        window inside .page-shell. No scroll listener; geometry is constant
        across Screen 1 ↔ Screen 2 snaps.
      */
      const origin = frame.getBoundingClientRect();
      svg.style.left = `${Math.round(rect.left - origin.left - pad)}px`;
      svg.style.top  = `${Math.round(rect.top  - origin.top  - pad)}px`;
    }

    /* Coalesce resize / RO bursts so layout never lands mid-frame thrash. */
    function scheduleLayout() {
      if (layoutRaf) return;
      layoutRaf = requestAnimationFrame(() => {
        layoutRaf = 0;
        layout();
      });
    }

    function tick(ts) {
      if (!running) return;
      if (unitLen > 1) {
        let o = currentOffset(ts);
        /*
          Periodically fold phase back into [0, unitLen) so the live
          expression `phase + SPEED*t` never grows large enough for float
          error to desync the tile wrap.
        */
        if (ts - epoch > 4000) {
          phase = o;
          epoch = ts;
          o = phase;
        }
        applyOffset(o);
      }
      rafId = requestAnimationFrame(tick);
    }

    function start() {
      if (running) return;
      running = true;
      epoch = performance.now();
      rafId = requestAnimationFrame(tick);
    }

    function stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      /* Freeze phase at the last painted offset so resume is continuous. */
      if (unitLen > 1 && epoch) {
        phase = currentOffset(performance.now());
        epoch = 0;
      }
    }

    layout();
    start();

    window.addEventListener('resize', scheduleLayout, { passive: true });
    /* Relayout when nav open/close changes the scrollport height — not on scroll. */
    window.addEventListener('appscrollchange', scheduleLayout, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(scheduleLayout);
      ro.observe(rimHost);
      ro.observe(frame);
      if (stage) ro.observe(stage);
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop();
      else {
        layout();
        start();
      }
    });

    if (document.fonts) {
      document.fonts.load('400 20px "Benz Grotesk"').then(scheduleLayout).catch(() => {});
      if (document.fonts.ready) document.fonts.ready.then(scheduleLayout).catch(() => {});
    }
  })();

})();
