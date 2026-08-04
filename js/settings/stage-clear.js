/* ==========================================================================
   Pixel clear — the display wipe that hands the field to the settings panel.

   Opening full screen settings should read as the display clearing itself,
   not as a panel dropped over a live simulation. A throwaway canvas is laid
   over the field, seeded with a snapshot of the frame that was on screen, and
   the pixels are then extinguished cell by cell in a sweep from the left. The
   panel pops in behind a field that has already gone quiet.

   Closing runs the same sweep in reverse: the flat field is erased back off
   the canvas from the right, so the live simulation underneath is revealed
   pixel by pixel instead of snapping back.

   This owns no simulation state. It reads the engine's cell size so the wipe
   lands on the same lattice the field is drawn on, and it borrows one frame
   from the live canvas — nothing here writes to the Pixel Engine.
   ========================================================================== */

const CLEAR_MS = 540;
const RESTORE_MS = 480;

/** How much of the sweep a single cell may run ahead of / behind the front. */
const EDGE = 0.18;

/** Cells are painted a hair oversized so a fractional cell leaves no seam. */
const OVERDRAW = 0.75;

const FALLBACK_CELL = 8;
const FALLBACK_FIELD = '#D2D2D2';

/** @param {number} t */
function easeInOutSine(t) {
  return 0.5 - Math.cos(Math.PI * t) * 0.5;
}

/**
 * Order the lattice into a ragged left-to-right front.
 *
 * Each cell gets a position along the sweep from its column plus a jitter of
 * up to EDGE, then the whole lattice is sorted by it. Walking that order at a
 * steady rate gives a soft, grainy edge rather than a ruled line, and costs
 * one sort instead of a per-frame pass over every cell.
 *
 * @param {number} cols
 * @param {number} rows
 * @returns {Uint32Array}
 */
function buildSweepOrder(cols, rows) {
  const count = cols * rows;
  const front = new Float32Array(count);
  const order = new Array(count);
  const span = cols > 1 ? cols - 1 : 1;
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    front[i] = (col / span) * (1 - EDGE) + Math.random() * EDGE;
    order[i] = i;
  }
  order.sort((a, b) => front[a] - front[b]);
  return Uint32Array.from(order);
}

/**
 * @typedef {object} StageClearOptions
 * @property {() => number} [getCell] — live Pixel Engine cell size
 * @property {boolean} [reduceMotion]
 */

/**
 * @param {StageClearOptions} [options]
 */
export function createStageClear(options) {
  const opts = options || {};
  const reduceMotion =
    opts.reduceMotion != null
      ? !!opts.reduceMotion
      : typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** @type {HTMLCanvasElement|null} */
  let canvas = null;
  let raf = 0;
  /** @type {(() => void)|null} */
  let settle = null;

  /** One sort per lattice size, reused across every open / close. */
  let cachedKey = '';
  /** @type {Uint32Array|null} */
  let cachedOrder = null;

  function cellSize() {
    const raw =
      typeof opts.getCell === 'function' ? Number(opts.getCell()) : NaN;
    return Number.isFinite(raw) && raw > 0 ? raw : FALLBACK_CELL;
  }

  function fieldColor(field) {
    const paint = window.getComputedStyle(field).backgroundColor;
    if (!paint || paint === 'transparent' || paint === 'rgba(0, 0, 0, 0)') {
      return FALLBACK_FIELD;
    }
    return paint;
  }

  function sweepOrder(cols, rows) {
    const key = `${cols}x${rows}`;
    if (key !== cachedKey || !cachedOrder) {
      cachedOrder = buildSweepOrder(cols, rows);
      cachedKey = key;
    }
    return cachedOrder;
  }

  function teardown() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (canvas && canvas.parentNode) canvas.remove();
    canvas = null;
  }

  /** Drop an in-flight sweep and let whoever was awaiting it continue. */
  function cancel() {
    const pending = settle;
    settle = null;
    teardown();
    if (pending) pending();
  }

  /**
   * @param {HTMLElement} field — the .stage__field being cleared
   * @param {object} run
   * @param {'clear'|'restore'} run.mode
   * @param {() => void} [run.onReady] — fired once the overlay is covering the
   *   field, i.e. the moment it is safe to switch motion off / back on
   * @returns {Promise<void>}
   */
  function play(field, run) {
    cancel();
    const mode = run && run.mode === 'restore' ? 'restore' : 'clear';
    const onReady = run && run.onReady;

    return new Promise((resolve) => {
      if (!field) {
        if (typeof onReady === 'function') onReady();
        resolve();
        return;
      }

      const rect = field.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const paint = fieldColor(field);

      canvas = document.createElement('canvas');
      canvas.className = 'settings-stage__clear';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        teardown();
        if (typeof onReady === 'function') onReady();
        resolve();
        return;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      /* Seed the overlay: the frame that is on screen for a clear, the settled
         field for a restore. Either way the field never blinks. */
      ctx.fillStyle = paint;
      ctx.fillRect(0, 0, width, height);
      if (mode === 'clear') {
        const live = field.querySelector('canvas.heatmap');
        if (live && live.width > 0 && live.height > 0) {
          ctx.drawImage(live, 0, 0, width, height);
        }
      }

      field.appendChild(canvas);
      if (typeof onReady === 'function') onReady();

      const finish = () => {
        settle = null;
        teardown();
        resolve();
      };
      settle = finish;

      if (reduceMotion) {
        finish();
        return;
      }

      const cell = cellSize();
      const cols = Math.max(1, Math.ceil(width / cell));
      const rows = Math.max(1, Math.ceil(height / cell));
      const order = sweepOrder(cols, rows);
      const total = order.length;
      const duration = mode === 'clear' ? CLEAR_MS : RESTORE_MS;
      const size = cell + OVERDRAW;
      const started = performance.now();
      let painted = 0;

      const tick = (now) => {
        raf = 0;
        const p = Math.min(1, (now - started) / duration);
        const target = Math.round(easeInOutSine(p) * total);
        while (painted < target) {
          /* A restore is the same front consumed from the far end, so the
             field peels back toward the side the panel left from. */
          const i = order[mode === 'clear' ? painted : total - 1 - painted];
          const x = (i % cols) * cell;
          const y = ((i / cols) | 0) * cell;
          if (mode === 'clear') ctx.fillRect(x, y, size, size);
          else ctx.clearRect(x - OVERDRAW, y - OVERDRAW, size, size);
          painted += 1;
        }
        if (p < 1) {
          raf = requestAnimationFrame(tick);
          return;
        }
        finish();
      };

      raf = requestAnimationFrame(tick);
    });
  }

  return {
    /** @param {HTMLElement} field */
    clear: (field, onReady) => play(field, { mode: 'clear', onReady }),
    /** @param {HTMLElement} field */
    restore: (field, onReady) => play(field, { mode: 'restore', onReady }),
    cancel,
  };
}
