/* ==========================================================================
   main.js — Site chrome (nav, settings, nameplate) + Pixel Engine bootstrap
   ========================================================================== */

import { initSettings } from './settings/index.js';
import { initSettingsPersistence } from './settings/persist.js';
import { createPresetManager } from './settings/presets/index.js';
import { createPixelEngine } from './pixel-engine/index.js';
import { initAppScroll } from './app-scroll/index.js';
import { initPage2Menu } from './page-2-menu/index.js';
import { initCommandPalette } from './command-palette/index.js';

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
    surfaces: [
      {
        canvas: document.getElementById('heatmap'),
        stage: document.getElementById('stage'),
      },
      {
        canvas: document.getElementById('heatmap-2'),
        stage: document.getElementById('stage-2'),
      },
    ],
  });

  /* Page 2 Menu — Screen 2 visibility; typography via shared intro LED pipeline. */
  const page2Menu = initPage2Menu({
    root: document.getElementById('page-2-menu'),
    frame: document.getElementById('site-frame'),
    intro: engine && engine.animation ? engine.animation.introController : null,
  });
  if (page2Menu) window.page2Menu = page2Menu;

  /* Command palette — "/" grows a command box out of the baked LED slash. */
  const commandPalette = initCommandPalette({
    screen: document.getElementById('pixel-fs-screen-2'),
    canvas: document.getElementById('heatmap-2'),
    frame: document.getElementById('site-frame'),
    intro: engine && engine.animation ? engine.animation.introController : null,
  });
  if (commandPalette) window.commandPalette = commandPalette;

  if (engine) {
    /* One simulation surface, displayed through the active screen's canvas. */
    const pixelSurfaceFrame = document.getElementById('site-frame');
    const syncPixelSurface = (event) => {
      const screen =
        event && event.detail && event.detail.screen != null
          ? event.detail.screen
          : Number(pixelSurfaceFrame?.dataset.appScreen) || 0;
      engine.renderer.setActiveSurface(screen);
      engine.interaction.reevaluate();
    };
    /* Both screens are on-screen while they cross the viewport, so every
       surface must stay live for the whole transition. data-app-screen flips
       at transition start; appscrollchange fires once the screen has settled. */
    window.addEventListener('appscrollchange', (event) => {
      engine.renderer.setPresentAllSurfaces(false);
      syncPixelSurface(event);
    });
    if (pixelSurfaceFrame && typeof MutationObserver !== 'undefined') {
      const pixelSurfaceObserver = new MutationObserver(() => {
        engine.renderer.setPresentAllSurfaces(true);
      });
      pixelSurfaceObserver.observe(pixelSurfaceFrame, {
        attributes: true,
        attributeFilter: ['data-app-screen'],
      });
    }
    engine.renderer.syncSurfaces();
    syncPixelSurface();

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
     1c. Nameplate ribbon — Porca textPath along the active frame
         Screen 1: up the left, across the top, down the right (open bottom).
         Screen 2: down the left, across the bottom, up the right (open top).
         Same continuous display — active edges follow the current screen.
         Clockwise travel keeps glyphs outward. Smooth linear loop preserved.
  ───────────────────────────────────────────────────────────────────────── */
  (function initNameplate() {
    const stage    = document.getElementById('stage');
    const shell    = document.getElementById('home');
    const aperture = document.getElementById('app-scroll');
    const frame    = document.getElementById('site-frame');
    const plate    = document.querySelector('.nameplate');
    const svg      = document.querySelector('.nameplate__svg');
    const rimPath  = document.getElementById('nameplate-rim');
    const textEl   = document.querySelector('.nameplate__text');
    const textPath = document.getElementById('nameplate-tp');
    if (!stage || !svg || !rimPath || !textEl || !textPath) return;

    const LABEL = 'Canaan Brown';
    const SEP   = '   ·   ';
    const UNIT  = LABEL + SEP;
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
    let lastFill = '';
    let lastCopies = 0;

    function clamp(n, a, b) {
      return Math.max(a, Math.min(b, n));
    }

    /* Active Pixel FS screen index from the scroll state machine. */
    function activeScreenIndex() {
      const raw = frame && frame.dataset.appScreen;
      const n = raw == null ? 0 : parseInt(raw, 10);
      return Number.isFinite(n) && n > 0 ? n : 0;
    }

    function cornerPoint(cx, cy, R, startAng, t, sweep) {
      const ang = startAng + t * (Math.PI / 2) * (sweep < 0 ? -1 : 1);
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

    function appendCorner(pts, cx, cy, R, startAng, gap, sweep) {
      if (R < 0.5) return;
      const dir = sweep < 0 ? -1 : 1;
      for (let i = 0; i <= CORNER_SAMPLES; i++) {
        const t = i / CORNER_SAMPLES;
        const p0 = cornerPoint(cx, cy, R, startAng, Math.max(0, t - 0.5 / CORNER_SAMPLES), dir);
        const p1 = cornerPoint(cx, cy, R, startAng, Math.min(1, t + 0.5 / CORNER_SAMPLES), dir);
        const n = outwardNormal(p1.x - p0.x, p1.y - p0.y);
        const p = cornerPoint(cx, cy, R, startAng, t, dir);
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
      Screen 1 — top/left/right (open bottom):
      Bottom-left → up left → TL squircle → across top → TR squircle →
      down right → bottom-right. Clockwise so glyphs face out.
    */
    function buildRimPointsTop(W, H, R, gap) {
      const pts = [];
      const step = 8;
      const r = Math.min(R, W * 0.5, H * 0.5);

      /* Start bottom-left */
      pts.push({ x: -gap, y: H + gap * 0.35 });

      /* Up the left edge to the TL corner */
      appendLine(pts, -gap, r, step);

      /* TL: west → north (startAng = π) */
      appendCorner(pts, r, r, r, Math.PI, gap, 1);

      /* Top edge, left → right */
      appendLine(pts, W - r, -gap, step);

      /* TR: north → east (startAng = 3π/2) */
      appendCorner(pts, W - r, r, r, Math.PI * 1.5, gap, 1);

      /* Down the right edge to bottom-right */
      appendLine(pts, W + gap, H + gap * 0.35, step);

      return pts;
    }

    /*
      Screen 2 — bottom/left/right (open top):
      Top-right → down right → BR squircle → across bottom (R→L) →
      BL squircle → up left → top-left.
      Same clockwise framing as Screen 1 so glyphs stay outward.
    */
    function buildRimPointsBottom(W, H, R, gap) {
      const pts = [];
      const step = 8;
      const r = Math.min(R, W * 0.5, H * 0.5);

      /* Start top-right */
      pts.push({ x: W + gap, y: -gap * 0.35 });

      /* Down the right edge to the BR corner */
      appendLine(pts, W + gap, H - r, step);

      /* BR: east → south (startAng = 0) */
      appendCorner(pts, W - r, H - r, r, 0, gap, 1);

      /* Bottom edge, right → left */
      appendLine(pts, r, H + gap, step);

      /* BL: south → west (startAng = π/2) */
      appendCorner(pts, r, H - r, r, Math.PI * 0.5, gap, 1);

      /* Up the left edge to top-left */
      appendLine(pts, -gap, -gap * 0.35, step);

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

    /**
     * Advance width of one UNIT on the live textPath — the same metric
     * startOffset uses — so wraps land on an identical glyph. Prefer
     * averaging an existing multi-copy fill so layout never collapses text.
     */
    function measureLiveUnit(fontSize) {
      if (lastCopies >= 2 && textPath.textContent === lastFill) {
        const total = textPath.getComputedTextLength();
        if (total > 1) return total / lastCopies;
      }
      const restore = textPath.textContent;
      textPath.textContent = UNIT;
      const w = textPath.getComputedTextLength();
      if (restore && restore !== UNIT) textPath.textContent = restore;
      else {
        lastFill = UNIT;
        lastCopies = 1;
      }
      return w > 1 ? w : Math.max(fontSize * 8, 1);
    }

    function setRibbonFill(copies) {
      const fill = Array.from({ length: copies }, () => UNIT).join('');
      if (fill === lastFill && textPath.textContent === fill) {
        lastCopies = copies;
        return copies;
      }
      textPath.textContent = fill;
      lastFill = fill;
      lastCopies = copies;
      return copies;
    }

    /**
     * Aperture box relative to the page shell, ignoring the ribbon flip
     * transform — the nameplate carries that same transform, so measuring the
     * transformed rect mid-flip would double-apply the shift.
     */
    function apertureBox() {
      if (aperture && aperture.offsetWidth > 1) {
        return {
          left: aperture.offsetLeft,
          top: aperture.offsetTop,
          width: aperture.offsetWidth,
          height: aperture.offsetHeight,
        };
      }
      const r = stage.getBoundingClientRect();
      const o = shell
        ? shell.getBoundingClientRect()
        : { left: 0, top: 0 };
      return {
        left: r.left - o.left,
        top: r.top - o.top,
        width: r.width,
        height: r.height,
      };
    }

    function layout() {
      /* Fixed application aperture — not the scrolled stage — so the ribbon
         frames the live Pixel FS window on every screen. */
      const rect = apertureBox();
      if (rect.width < 2 || rect.height < 2) return;

      const cs = getComputedStyle(stage);
      const rRaw = parseFloat(cs.borderTopLeftRadius);
      const R = Number.isFinite(rRaw) && rRaw > 0 ? rRaw : 36;

      const shellCs = shell ? getComputedStyle(shell) : null;
      const chromeY = shellCs
        ? Math.max(
            parseFloat(shellCs.paddingTop) || 0,
            parseFloat(shellCs.paddingBottom) || 0
          )
        : 0;
      const chromeX = shellCs ? parseFloat(shellCs.paddingLeft) || 0 : 0;
      const band = Math.min(chromeY || chromeX || 36, chromeX || 36, 36);
      const fontSize = clamp(band * 0.72, 16, 26);
      const gap = clamp(fontSize * 0.28, 6, 10);

      textEl.setAttribute('font-size', String(fontSize));
      textEl.style.fontSize = fontSize + 'px';

      const W = rect.width;
      const H = rect.height;
      const screen = activeScreenIndex();
      const pts =
        screen > 0
          ? buildRimPointsBottom(W, H, R, gap)
          : buildRimPointsTop(W, H, R, gap);
      rimPath.setAttribute('d', pointsToPath(pts));

      pathLen = rimPath.getTotalLength();
      if (!(pathLen > 1)) return;

      const prevUnit = unitLen;
      let unit = measureLiveUnit(fontSize);

      /* Cover pathLen plus startOffset travel, with extra repeats so curved
         corners never read as empty stretches along the open rim. */
      const copies = Math.max(8, Math.ceil((pathLen + unit * 2) / unit) + 6);
      setRibbonFill(copies);

      /* Average over the full fill — matches the animated startOffset cycle. */
      const total = textPath.getComputedTextLength();
      unitLen = total > 1 ? total / copies : unit;

      if (prevUnit > 1) offset = (offset / prevUnit) * unitLen;
      offset = ((offset % unitLen) + unitLen) % unitLen;

      const pad = Math.ceil(fontSize * 1.6 + gap + 8);
      svg.setAttribute('viewBox', `${-pad} ${-pad} ${W + pad * 2} ${H + pad * 2}`);
      svg.setAttribute('width', String(Math.ceil(W + pad * 2)));
      svg.setAttribute('height', String(Math.ceil(H + pad * 2)));
      /* Position relative to page-shell so the ribbon rides the shell transform */
      svg.style.left = `${Math.round(rect.left - pad)}px`;
      svg.style.top  = `${Math.round(rect.top - pad)}px`;

      textPath.setAttribute('startOffset', String(-offset));
    }

    function flipFadeMs() {
      const raw = getComputedStyle(shell || document.body).getPropertyValue(
        '--shell-flip-fade-ms'
      );
      const n = parseFloat(raw);
      return Number.isFinite(n) && n > 0 ? n : 140;
    }

    /*
      The rim traces different edges on each screen, so the path cannot morph
      between them. Rebuild it at the midpoint of the aperture glide, hidden
      behind a short fade, so the swap never reads as a jump.
    */
    let flipTimer = 0;
    function flipRim() {
      const reduce =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!plate || reduce) {
        layout();
        return;
      }
      plate.classList.add('is-flipping');
      if (flipTimer) clearTimeout(flipTimer);
      flipTimer = window.setTimeout(() => {
        flipTimer = 0;
        layout();
        plate.classList.remove('is-flipping');
      }, flipFadeMs());
    }

    function tick(ts) {
      if (!running) return;
      if (!lastTs) lastTs = ts;
      const dt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;

      if (unitLen > 1) {
        offset += SPEED * dt;
        /* Subtract whole units — same phase, no probe/path metric drift. */
        if (offset >= unitLen) offset -= unitLen * Math.floor(offset / unitLen);
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
    /* Boundary flips with the active screen; keep scroll offset continuous. */
    window.addEventListener('appscrollchange', layout, { passive: true });
    if (frame && typeof MutationObserver !== 'undefined') {
      new MutationObserver(flipRim).observe(frame, {
        attributes: true,
        attributeFilter: ['data-app-screen'],
      });
    }
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(layout);
      if (aperture) ro.observe(aperture);
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
      document.fonts.load('400 20px "Porca"').then(layout).catch(() => {});
      if (document.fonts.ready) document.fonts.ready.then(layout).catch(() => {});
    }
  })();

})();
