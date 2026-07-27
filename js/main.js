/* ==========================================================================
   main.js — Phase 2 : Hover + Idle + Parallax + Book Extraction

   Four self-contained systems:
     1. Book hover     — per-book GSAP timeline, neighbour ripple, z-index lift
     2. Idle float     — micro-oscillation on decorative books (~1 px amplitude)
     3. Mouse parallax — gentle alcove drift on mousemove (≤ 2 px)
     4. Book extraction — physical book-pull to screen centre (this phase)

   Phase 3 (page-turn opening) will be wired to the 'floating' state hook
   at the bottom of System 4.
   ========================================================================== */

(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────────────────────
     0.  Reduced-motion guard
         GSAP's globalTimeline can also be paused, but short-circuiting here
         avoids touching DOM elements at all.
  ───────────────────────────────────────────────────────────────────────── */
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ─────────────────────────────────────────────────────────────────────────
     1.  Footer year stamp
  ───────────────────────────────────────────────────────────────────────── */
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ─────────────────────────────────────────────────────────────────────────
     2.  BOOKS registry
         Content lives here for Phase 3 (page reveal).  The registry is
         preserved even when animations are disabled.
  ───────────────────────────────────────────────────────────────────────── */
  const BOOKS = {
    about: {
      title:      'About',
      color1:     '#A8B2B4',
      color2:     '#8A9496',
      titleFont:  '"Cormorant Garamond", Georgia, serif',
      titleStyle: 'italic',
      html: `
        <h3>About</h3>
        <p>I'm Canaan — learning web design and front-end development, building in public.</p>
        <p>This site is my practice ground: type, colour, layout, and motion — one page at a time.</p>
      `,
    },
    projects: {
      title:      'Projects',
      color1:     '#1E2836',
      color2:     '#141C28',
      titleFont:  '"Josefin Sans", system-ui, sans-serif',
      titleStyle: 'normal',
      html: `
        <h3>Projects</h3>
        <ol>
          <li>Type &amp; Hierarchy</li>
          <li>Color Systems</li>
          <li>Layout Fundamentals</li>
          <li>Motion &amp; Interaction</li>
        </ol>
        <p class="bm-note">More shipping as I build.</p>
      `,
    },
    writing: {
      title:      'Writing',
      color1:     '#BEB0A0',
      color2:     '#A09080',
      titleFont:  '"Cormorant Garamond", Georgia, serif',
      titleStyle: 'italic',
      html: `
        <h3>Writing</h3>
        <p>Notes on design, craft, and learning in public.</p>
        <p class="bm-note">Essays coming soon.</p>
      `,
    },
    photography: {
      title:      'Photography',
      color1:     '#1A1816',
      color2:     '#0E0C0A',
      titleFont:  '"Josefin Sans", system-ui, sans-serif',
      titleStyle: 'normal',
      html: `
        <h3>Photography</h3>
        <p>Quiet light. Honest subjects. Minimal editing.</p>
        <p class="bm-note">Gallery forthcoming.</p>
      `,
    },
    experience: {
      title:      'Experience',
      color1:     '#6E7A6A',
      color2:     '#546054',
      titleFont:  '"Josefin Sans", system-ui, sans-serif',
      titleStyle: 'normal',
      html: `
        <h3>Experience</h3>
        <p>Background in design, technology, and building things that work.</p>
        <p class="bm-note">Full résumé available on request.</p>
      `,
    },
    research: {
      title:      'Research',
      color1:     '#68786E',
      color2:     '#4E6054',
      titleFont:  '"Cormorant Garamond", Georgia, serif',
      titleStyle: 'italic',
      html: `
        <h3>Research</h3>
        <p>Interests in perception, material culture, and the semiotics of everyday objects.</p>
        <p class="bm-note">Writing in progress.</p>
      `,
    },
    contact: {
      title:      'Contact',
      color1:     '#7E7066',
      color2:     '#665A50',
      titleFont:  '"DM Mono", "Courier New", monospace',
      titleStyle: 'normal',
      html: `
        <h3>Contact</h3>
        <p>Open to feedback, collaboration, or just a hello while learning in public.</p>
        <a class="bm-email" href="mailto:hello@example.com">hello@example.com</a>
      `,
    },
  };

  /* ─────────────────────────────────────────────────────────────────────────
     Early exit for reduced-motion — year stamp and BOOKS registry are above.
  ───────────────────────────────────────────────────────────────────────── */
  if (reduced) return;

  /* ─────────────────────────────────────────────────────────────────────────
     Shared WeakMap — hoisted above both System 4 and System 1 so _cleanup()
     inside the extraction IIFE can reach it via closure.
     _cleanup() is only ever CALLED after System 1 has populated the map,
     so there is no temporal dead zone issue at runtime.
  ───────────────────────────────────────────────────────────────────────── */
  const hoverTimelines = new WeakMap();


  /* ═══════════════════════════════════════════════════════════════════════════
     SYSTEM 4 · BOOK EXTRACTION
     Defined first so the hover system (System 1) can reference its state.

     State machine:
       idle      → normal bookshelf, all hover effects active
       pulling   → extraction animation in flight, no interaction
       floating  → book at screen centre, backdrop active, ready for Phase 3
       returning → return-to-shelf animation in flight, no interaction

     Public API consumed by System 1:
       extraction.state          — current state string
       extraction.extractBook(el) — trigger pull-from-shelf
  ═══════════════════════════════════════════════════════════════════════════ */
  const extraction = (function () {

    /* ── Private state ─────────────────────────────────────────────────── */
    let _state    = 'idle';
    let activeEl  = null;   // the .book--link element being extracted
    let ghost     = null;   // invisible placeholder preserving shelf layout
    let backdrop  = null;   // full-viewport dim layer
    let floatTween = null;  // idle-bob while book is floating

    /* ── Reusable animation values ─────────────────────────────────────── */

    /* Page-edge inset: a cream stripe on the book's right side, simulating
       the visible page block when the spine is at a ~12° angle. */
    const PAGE_EDGE_SHADOW = 'inset -5px 0 0 rgba(242, 236, 224, 0.58)';

    /* Perspective distance applied directly to the book element.
       Using transformPerspective (self-perspective) avoids the CSS quirk
       where filter on an ancestor traps position:fixed descendants. */
    const PERSP = 1400;

    /* ── Backdrop helpers ──────────────────────────────────────────────── */
    function _showBackdrop(onReturn) {
      backdrop = document.createElement('div');
      backdrop.className = 'extraction-backdrop';
      backdrop.addEventListener('click', onReturn);
      document.body.appendChild(backdrop);

      /* Fade in slightly after the pull begins so the shelf is still
         fully visible during the first half of the animation. */
      gsap.fromTo(backdrop,
        { opacity: 0 },
        { opacity: 1, duration: 0.55, ease: 'power2.out', delay: 0.28 }
      );
    }

    function _hideBackdrop(callback) {
      if (!backdrop) { callback && callback(); return; }
      gsap.to(backdrop, {
        opacity: 0,
        duration: 0.32,
        ease: 'power2.in',
        onComplete() {
          backdrop.remove();
          backdrop = null;
          callback && callback();
        },
      });
    }

    /* ── Shelf dimmer ──────────────────────────────────────────────────── */
    /*
      We dim using opacity on individual shelf rows — NOT filter on #bookcase.

      CSS filter/transform/perspective on an ancestor creates a new
      containing block for position:fixed descendants.  That would override
      our top/left viewport coordinates and break the extraction position
      math.  opacity < 1 creates a stacking context but NOT a containing
      block, so it is safe to apply to .shelf__items while the book is fixed.

      By the time _dimShelf() is called the book has also been reparented
      to document.body (see Step 4b), so there is zero risk of containment.
    */
    function _dimShelf() {
      gsap.to('.shelf__items', {
        opacity:  0.70,
        duration: 0.55,
        delay:    0.20,
        ease:     'power2.out',
      });
    }

    function _restoreShelf() {
      gsap.to('.shelf__items', {
        opacity:  1,
        duration: 0.50,
        ease:     'power2.inOut',
        onComplete() {
          gsap.set('.shelf__items', { clearProps: 'opacity' });
        },
      });
    }

    /* ── Reusable: build & destroy idle float on the floating book ──────── */
    function _startFloat(el) {
      floatTween = gsap.to(el, {
        y:        '-=5',
        duration: 3.0,
        repeat:   -1,
        yoyo:     true,
        ease:     'sine.inOut',
      });
    }

    function _stopFloat() {
      if (floatTween) { floatTween.kill(); floatTween = null; }
    }

    /* ════════════════════════════════════════════════════════════════════
       extractBook(bookEl)
       Reusable, timeline-driven function.  Each phase is a nested tween
       so timing relationships are legible and easy to adjust.
    ════════════════════════════════════════════════════════════════════ */
    function extractBook(bookEl) {
      if (_state !== 'idle') return;
      _state   = 'pulling';
      activeEl = bookEl;

      /* ── Step 1: Capture visual bounds ────────────────────────────────
         getBoundingClientRect() returns the actual painted rectangle,
         including any transforms already applied (e.g. hover y:-11).
         This is the exact position we need to anchor the fixed element. */
      const rect = bookEl.getBoundingClientRect();
      const vw   = window.innerWidth;
      const vh   = window.innerHeight;

      /* ── Step 2: Ghost placeholder ────────────────────────────────────
         Insert an invisible block-level sibling before the book so the
         flex layout retains the gap while the book is position:fixed. */
      ghost = document.createElement('div');
      Object.assign(ghost.style, {
        display:       'inline-block',
        width:         rect.width  + 'px',
        height:        rect.height + 'px',
        flexShrink:    '0',
        visibility:    'hidden',
        pointerEvents: 'none',
        margin:        '0',
        padding:       '0',
      });
      bookEl.parentNode.insertBefore(ghost, bookEl);

      /* ── Step 3: Lift book into the fixed layer ───────────────────────
         Setting top:rect.top with y:0 produces zero visual jump because
         rect.top already includes the hover y offset.
         transformPerspective is set on the element itself (not a parent)
         to keep the 3D context self-contained. */
      gsap.set(bookEl, {
        position:          'fixed',
        top:               rect.top,
        left:              rect.left,
        width:             rect.width,
        height:            rect.height,
        zIndex:            900,
        transformOrigin:   '50% 50%',
        transformPerspective: PERSP,
        transformStyle:    'preserve-3d',
        y:                 0,          // clear any hover-y
        rotation:          0,          // clear any hover-rotation (≤1.2°, imperceptible)
        filter:            'brightness(1)',
        margin:            0,
      });

      /* ── Step 4a: Reparent book to body ──────────────────────────────────
         This removes the book from #bookcase's descendant tree before any
         dimming filter/opacity could potentially affect our fixed position.
         The ghost already holds the layout slot, so nothing shifts visually. */
      document.body.appendChild(bookEl);

      /* ── Step 4b: Dim shelf rows — safe because book is no longer a
         descendant of any dimmed ancestor ──────────────────────────────── */
      _dimShelf();

      /* ── Step 5: Calculate arc destination ───────────────────────────
         The book's centre should end up at the viewport centre.
         dx/dy are the GSAP x/y values that achieve this:
           visual_cx = rect.left + rect.width/2  + x  →  set equal to vw/2
           visual_cy = rect.top  + rect.height/2 + y  →  set equal to vh/2  */
      const dx = (vw / 2) - (rect.left + rect.width  / 2);
      const dy = (vh / 2) - (rect.top  + rect.height / 2);

      /* ── Step 6: Target display scale ────────────────────────────────
         Aim for ~48 % of viewport height.  Cap at 3.8 to prevent
         oversized display on very tall or small viewports. */
      const targetScale = Math.min(3.8, (vh * 0.48) / rect.height);

      /* ── Step 7: Build the timeline ──────────────────────────────────
         Nested timelines per phase keep timing relationships explicit. */
      const masterTl = gsap.timeline({
        onComplete() {
          _state = 'floating';
          bookEl.classList.add('book--floating');
          _startFloat(bookEl);

          /* Escape-key return */
          document.addEventListener('keydown', _onEscape);

          /* ── Phase 3 hook: wire click-to-open here (future) ──
          bookEl.addEventListener('click', _onBookClick, { once: true });
          ── */
        },
      });

      /* ── Phase 1 · Stir ─ 0 → 0.22 s ─────────────────────────────────
         A barely-perceptible shiver: the book resists then yields to
         the grip.  Very small y and scale to avoid telegraphing motion. */
      const stirTl = gsap.timeline();
      stirTl.to(bookEl, {
        y:        -7,
        scale:    1.03,
        duration: 0.22,
        ease:     'power1.out',
      });

      /* ── Phase 2 · Break free ─ 0.18 → 0.60 s ────────────────────────
         Spine-first forward pull.  z accelerates as the book leaves the
         slot; rotationY mimics gripping the top of the spine. */
      const pullTl = gsap.timeline();
      pullTl.to(bookEl, {
        z:          90,
        rotationY:  -9,
        y:          -20,
        scale:      1.10,
        boxShadow:  `${PAGE_EDGE_SHADOW},
                     0 12px 32px rgba(28, 20, 10, 0.40),
                     0  4px 12px rgba(28, 20, 10, 0.22)`,
        duration:   0.42,
        ease:       'power3.in',
      });

      /* ── Phase 3 · Arc to centre ─ 0.55 → 1.40 s ─────────────────────
         All six degrees of freedom animate simultaneously.  power3.inOut
         front-loads the momentum (from Phase 2) then decelerates cleanly. */
      const arcTl = gsap.timeline();
      arcTl.to(bookEl, {
        x:          dx,
        y:          dy,
        z:          200,
        rotationY:  -12,   // spine readable; right edge suggests page block
        rotationX:  -2,    // barely-there gravity tilt — book has mass
        scale:      targetScale,
        boxShadow:  `${PAGE_EDGE_SHADOW},
                     0 60px 140px rgba(0, 0, 0, 0.58),
                     0 18px  48px rgba(0, 0, 0, 0.28)`,
        duration:   0.82,
        ease:       'power3.inOut',
      });

      /* ── Phase 4 · Settle ─ 1.35 → 1.68 s ───────────────────────────
         A small damping motion: book bobs up 4 px and levels out,
         like a physical object finding equilibrium in the air. */
      const settleTl = gsap.timeline();
      settleTl.to(bookEl, {
        z:          178,
        rotationX:  0,
        y:          '-=4',
        boxShadow:  `${PAGE_EDGE_SHADOW},
                     0 50px 122px rgba(0, 0, 0, 0.54),
                     0 14px  42px rgba(0, 0, 0, 0.24)`,
        duration:   0.33,
        ease:       'back.out(1.2)',
      });

      /* ── Assemble master timeline ─────────────────────────────────── */
      masterTl
        .add(stirTl)
        .add(pullTl,   '-=0.06')
        .add(arcTl,    '-=0.08')
        .add(settleTl, '-=0.06');

      /* Backdrop fires independently — slightly after pull begins */
      _showBackdrop(returnBook);
    }

    /* ════════════════════════════════════════════════════════════════════
       returnBook()
       Mirror of extractBook: animates from centre back to the fixed
       anchor point (x:0 y:0 relative to top/left), then clears all
       inline overrides and returns the book to the flex layout.
    ════════════════════════════════════════════════════════════════════ */
    function returnBook() {
      if (_state !== 'floating') return;
      _state = 'returning';

      document.removeEventListener('keydown', _onEscape);
      _stopFloat();
      activeEl.classList.remove('book--floating');

      const bookEl = activeEl;

      const returnTl = gsap.timeline({
        onComplete: _cleanup,
      });

      /* ── Phase A · Hesitate ─ 0 → 0.12 s ─────────────────────────────
         A tiny rotationX 'brace' — the book gathers itself before arcing
         back. Adds psychological weight to the return journey. */
      returnTl.to(bookEl, {
        rotationX: 1.5,
        duration:  0.12,
        ease:      'power1.in',
      });

      /* ── Phase B · Arc back ─ 0.10 → 0.80 s ──────────────────────────
         Absolute x:0 y:0 returns the book to the fixed-layer anchor.
         Power3.inOut mirrors the extraction arc for visual symmetry. */
      returnTl.to(bookEl, {
        x:          0,
        y:          0,
        z:          30,
        rotationY:  0,
        rotationX:  0,
        scale:      1,
        boxShadow:  '0 6px 16px rgba(28, 20, 10, 0.20)',
        duration:   0.70,
        ease:       'power3.inOut',
      }, '-=0.04');

      /* ── Phase C · Slot in ─ 0.76 → 1.00 s ───────────────────────────
         z returns to shelf plane; shadow fades to nothing as the book
         settles flush with the other spines. */
      returnTl.to(bookEl, {
        z:          0,
        boxShadow:  '0 0px 0px rgba(28, 20, 10, 0)',
        duration:   0.24,
        ease:       'power2.out',
      });

      /* Backdrop fade and shelf restore fire in parallel with the arc */
      _hideBackdrop();
      _restoreShelf();
    }

    /* ── Cleanup: restore book element to normal shelf state ───────────── */
    function _cleanup() {
      const bookEl = activeEl;

      /* Re-insert book into the shelf at the ghost's exact DOM position.
         At this moment the book is still position:fixed (from body), so
         inserting it before the ghost does NOT affect the flex layout yet —
         the ghost still holds the width/height slot. */
      if (ghost) {
        ghost.parentNode.insertBefore(bookEl, ghost);
      }

      /* Atomically: remove ghost + clear fixed-position styles in the same
         tick.  The ghost's slot disappears at the same moment the book
         re-enters the flow, preventing any double-wide flash. */
      if (ghost) { ghost.remove(); ghost = null; }

      /* Selectively clear only the properties we set during extraction.
         Targeting specific props avoids overwriting GSAP-managed transform
         values on other elements and preserves inherited CSS. */
      gsap.set(bookEl, {
        clearProps:      'position,top,left,width,height,zIndex,' +
                         'transformPerspective,transformStyle,margin,filter',
        x:               0,
        y:               0,
        z:               0,
        rotation:        0,
        rotationY:       0,
        rotationX:       0,
        scale:           1,
        boxShadow:       '0 0px 0px rgba(28,20,10,0)',
        transformOrigin: 'bottom center',  // restore hover-system pivot
        pointerEvents:   'auto',
      });

      /* Reset the hover timeline to progress(0) so the next mouseenter
         plays correctly.  hoverTimelines is hoisted above this IIFE and
         fully populated by System 1 before _cleanup() is ever called. */
      const hoverTl = hoverTimelines.get(bookEl);
      if (hoverTl) hoverTl.progress(0).pause();

      activeEl = null;
      _state   = 'idle';
    }

    /* ── Escape key handler ─────────────────────────────────────────────── */
    function _onEscape(e) {
      if (e.key === 'Escape') returnBook();
    }

    /* ── Public API ─────────────────────────────────────────────────────── */
    return {
      get state()    { return _state; },
      extractBook,
      returnBook,
    };

  }()); // end extraction IIFE


  /* ═══════════════════════════════════════════════════════════════════════════
     SYSTEM 1 · BOOK HOVER
     ═══════════════════════════════════════════════════════════════════════════

     For each .book--link:
       • Primary lift: translateY(-11 px), slight rotation, brightness boost,
         and a layered drop shadow that widens as the book separates.
       • Neighbour ripple: adjacent books shift a few pixels as though
         physically bumped — falloff over two positions per side.
       • z-index is elevated on enter so the lifted spine appears in front
         of the shelf planks, then restored on exit.
       • Idle float tweens (System 2) are paused for affected neighbours
         on enter and resumed on reverse-complete.

     All hover listeners check extraction.state === 'idle' before firing
     so hover effects are suppressed during any extraction flight.
  ═══════════════════════════════════════════════════════════════════════════ */

  /* Transform origin: pivots from the book's base — mimics gripping the
     top of a spine and leaning it outward rather than rotating at centre. */
  gsap.set('.book', { transformOrigin: 'bottom center' });

  /* Bake lean / yaw / depth into GSAP so idle y-tweens don't wipe CSS transforms. */
  document.querySelectorAll('.book:not(.book--link)').forEach(book => {
    const lean =
      book.classList.contains('book--lean-rr') ?  4.0 :
      book.classList.contains('book--lean-ll') ? -3.6 :
      book.classList.contains('book--lean-r')  ?  2.4 :
      book.classList.contains('book--lean-l')  ? -2.4 : 0;

    const yaw =
      book.classList.contains('book--yaw-r') ? -14 :
      book.classList.contains('book--yaw-l') ?  14 : 0;

    const z =
      book.classList.contains('book--fwd')    ?  5 :
      book.classList.contains('book--fwd-sm') ?  3 :
      book.classList.contains('book--deep')   ? -3 : 0;

    if (!lean && !yaw && !z) return;

    const origin =
      yaw < 0 && lean > 0 ? 'bottom left'  :
      yaw > 0 && lean < 0 ? 'bottom right' :
      yaw < 0             ? 'left center'  :
      yaw > 0             ? 'right center' :
                            'bottom center';

    gsap.set(book, {
      rotation: lean,
      rotationY: yaw ? yaw * (lean ? 12 / 14 : 1) : 0,
      z,
      transformOrigin: origin,
      transformPerspective: 900,
    });
  });

  /* idleTweens: decorative-book micro-oscillations (System 2 reads these too) */
  const idleTweens = new WeakMap();
  /* hoverTimelines: hoisted above this block — already declared above */

  document.querySelectorAll('.book--link').forEach(linkBook => {
    const shelfItems = linkBook.closest('.shelf__items');
    const allBooks   = [...shelfItems.querySelectorAll('.book')];
    const myIdx      = allBooks.indexOf(linkBook);

    /* Neighbour descriptors — lift and tilt fall off over distance */
    const neighbours = [
      { el: allBooks[myIdx - 2], lift: -1.0, tilt: -0.16 },
      { el: allBooks[myIdx - 1], lift: -2.8, tilt: -0.40 },
      { el: allBooks[myIdx + 1], lift: -2.8, tilt:  0.40 },
      { el: allBooks[myIdx + 2], lift: -1.0, tilt:  0.16 },
    ].filter(n => n.el != null);

    /* Prime baseline values so GSAP can interpolate on first play.
       Box-shadow layers must match the hovered state (same layer count)
       to prevent snapping on first hover. Idle layers mirror CSS book shadows. */
    const idleShadow =
      'inset 1px 0 0 rgba(255,255,255,0.28), ' +
      'inset -1.5px 0 0 rgba(28,20,10,0.20), ' +
      'inset 0 1px 0 rgba(255,255,255,0.12), ' +
      '0 1px 0 rgba(28,20,10,0.22), ' +
      '0 1px 2px rgba(28,20,10,0.30), ' +
      '2px 2px 5px rgba(28,20,10,0.11), ' +
      '3px 5px 10px rgba(28,20,10,0.04)';

    const hoverShadow =
      'inset 1px 0 0 rgba(255,255,255,0.32), ' +
      'inset -1.5px 0 0 rgba(28,20,10,0.16), ' +
      'inset 0 1px 0 rgba(255,255,255,0.14), ' +
      '0 1px 0 rgba(28,20,10,0.18), ' +
      '0 2px 3px rgba(28,20,10,0.24), ' +
      '0 8px 14px rgba(28,20,10,0.12), ' +
      '0 16px 28px rgba(28,20,10,0.06)';

    gsap.set(linkBook, {
      filter:    'brightness(1)',
      boxShadow: idleShadow,
    });

    const tl = gsap.timeline({
      paused: true,

      onReverseComplete() {
        neighbours.forEach(({ el }) => {
          const t = idleTweens.get(el);
          if (t) t.resume();
        });
        gsap.set(linkBook, { zIndex: 'auto' });
      },
    });

    /* ── Primary book ──────────────────────────────────────────────── */
    tl.to(linkBook, {
      y:         -11,
      rotation:   1.2,
      filter:    'brightness(1.07)',
      boxShadow: hoverShadow,
      duration:   0.40,
      ease:      'power2.out',
    }, 0);

    /* ── Neighbour ripple ──────────────────────────────────────────── */
    neighbours.forEach(({ el, lift, tilt }) => {
      tl.to(el, {
        y:        lift,
        rotation: tilt,
        duration: 0.34,
        ease:     'power2.out',
      }, 0);
    });

    /* Store for access in the click handler */
    hoverTimelines.set(linkBook, tl);

    /* ── Event listeners ───────────────────────────────────────────── */
    linkBook.addEventListener('mouseenter', () => {
      if (extraction.state !== 'idle') return;

      gsap.set(linkBook, { zIndex: 10 });
      neighbours.forEach(({ el }) => {
        const t = idleTweens.get(el);
        if (t) t.pause();
      });
      tl.play();
    });

    linkBook.addEventListener('mouseleave', () => {
      if (extraction.state !== 'idle') return;
      tl.reverse();
    });

    /* ── Click → extraction ────────────────────────────────────────── */
    linkBook.addEventListener('click', e => {
      e.preventDefault();
      if (extraction.state !== 'idle') return;

      /* Pause the hover timeline in its current state.
         DO NOT seek(0) here — that would snap the book back to y:0 for
         one frame before extraction takes over.  The timeline is reset to
         progress(0) inside _cleanup() after the book returns to shelf. */
      tl.pause();

      extraction.extractBook(linkBook);
    });
  });


  /* ═══════════════════════════════════════════════════════════════════════════
     SYSTEM 2 · IDLE FLOAT
     ═══════════════════════════════════════════════════════════════════════════

     A sparse subset of decorative books oscillate with small amplitude and
     staggered random timing.  Link books are excluded — they have GSAP hover
     timelines that manage their y position.
  ═══════════════════════════════════════════════════════════════════════════ */

  [...document.querySelectorAll('.book:not(.book--link)')].forEach((book, i) => {
    if (i % 2 !== 0) return;

    const tween = gsap.to(book, {
      y:        gsap.utils.random(-1.4, -0.5),
      duration: gsap.utils.random(3.5, 6.5),
      repeat:   -1,
      yoyo:     true,
      ease:     'sine.inOut',
      delay:    i * 0.48,
    });

    idleTweens.set(book, tween);
  });


  /* ═══════════════════════════════════════════════════════════════════════════
     SYSTEM 3 · MOUSE PARALLAX
     ═══════════════════════════════════════════════════════════════════════════

     The alcove shifts very slightly opposite the cursor, giving the impression
     it is a physical object with depth.  Maximum displacement ±1.8 px (x)
     and ±1.2 px (y).  Parallax is suppressed during extraction so the shelf
     doesn't drift while the book is floating at centre.
  ═══════════════════════════════════════════════════════════════════════════ */

  const alcove = document.getElementById('bookcase');

  const moveX = gsap.quickTo(alcove, 'x', { duration: 1.6, ease: 'power1.out' });
  const moveY = gsap.quickTo(alcove, 'y', { duration: 1.6, ease: 'power1.out' });

  document.addEventListener('mousemove', ({ clientX, clientY }) => {
    /* Suppress parallax while a book is off the shelf */
    if (extraction.state !== 'idle') return;

    const nx = (clientX - window.innerWidth  / 2) / (window.innerWidth  / 2);
    const ny = (clientY - window.innerHeight / 2) / (window.innerHeight / 2);
    moveX(nx * -1.8);
    moveY(ny * -1.2);
  });


  /* ═══════════════════════════════════════════════════════════════════════════
     SYSTEM 5 · PIXEL HEATMAP
     ═══════════════════════════════════════════════════════════════════════════

     A fine gray pixel grid fills the wall behind the bookcase.  Cursor
     proximity heats pixels to pink; heat decays back to cool gray when the
     cursor leaves.  pointer-events stay off so books remain clickable.
  ═══════════════════════════════════════════════════════════════════════════ */

  (function initHeatmap() {
    const canvas = document.getElementById('heatmap');
    if (!canvas) return;

    const CELL   = 8;    /* CSS pixels per heat cell — fine grid */
    const RADIUS = 4.5;  /* brush radius in cell units */
    const DECAY  = 0.05;
    const GAIN   = 0.62;

    /* Cool gray → warm pink */
    const COOL = [184, 180, 174];
    const HOT  = [232, 145, 168];

    const ctx = canvas.getContext('2d', { alpha: false });
    let cols = 0;
    let rows = 0;
    let heat = null;
    let image = null;
    let mouseX = -1;
    let mouseY = -1;
    let running = false;
    let viewW = 0;
    let viewH = 0;

    function resize() {
      viewW = window.innerWidth;
      viewH = window.innerHeight;
      cols = Math.ceil(viewW / CELL);
      rows = Math.ceil(viewH / CELL);

      canvas.width  = cols;
      canvas.height = rows;
      heat  = new Float32Array(cols * rows);
      image = ctx.createImageData(cols, rows);

      /* Seed a quiet grain so the cool field isn't a flat slab */
      const d = image.data;
      for (let i = 0; i < cols * rows; i++) {
        const n = ((i * 17) & 7);
        const o = i * 4;
        d[o]     = COOL[0] - n;
        d[o + 1] = COOL[1] - n;
        d[o + 2] = COOL[2] - (n * 0.8);
        d[o + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);
    }

    function deposit(cx, cy) {
      const gx = (cx / viewW) * cols;
      const gy = (cy / viewH) * rows;
      const x0 = Math.max(0, Math.floor(gx - RADIUS));
      const x1 = Math.min(cols - 1, Math.ceil(gx + RADIUS));
      const y0 = Math.max(0, Math.floor(gy - RADIUS));
      const y1 = Math.min(rows - 1, Math.ceil(gy + RADIUS));
      const r2 = RADIUS * RADIUS;

      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - gx;
          const dy = y + 0.5 - gy;
          const d2 = dx * dx + dy * dy;
          if (d2 > r2) continue;
          const falloff = 1 - d2 / r2;
          const i = y * cols + x;
          heat[i] = Math.min(1, heat[i] + GAIN * falloff * falloff);
        }
      }
    }

    function tick() {
      if (!running) return;

      if (mouseX >= 0) deposit(mouseX, mouseY);

      const d = image.data;
      let alive = mouseX >= 0;

      for (let i = 0; i < heat.length; i++) {
        let h = heat[i];
        if (h > 0.002) {
          h = heat[i] = h * (1 - DECAY);
          alive = true;
        } else {
          heat[i] = 0;
          h = 0;
        }

        const n = ((i * 17) & 7);
        const o = i * 4;
        d[o]     = ((COOL[0] - n) + (HOT[0] - COOL[0]) * h) | 0;
        d[o + 1] = ((COOL[1] - n) + (HOT[1] - COOL[1]) * h) | 0;
        d[o + 2] = ((COOL[2] - n * 0.8) + (HOT[2] - COOL[2]) * h) | 0;
        d[o + 3] = 255;
      }

      ctx.putImageData(image, 0, 0);

      if (alive) {
        requestAnimationFrame(tick);
      } else {
        running = false;
      }
    }

    function start() {
      if (running) return;
      running = true;
      requestAnimationFrame(tick);
    }

    window.addEventListener('resize', resize, { passive: true });

    if (reduced) {
      resize();
      return;
    }

    document.addEventListener('mousemove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      start();
    }, { passive: true });

    document.documentElement.addEventListener('mouseleave', () => {
      mouseX = -1;
      mouseY = -1;
      start(); /* keep ticking so the trail cools to gray */
    });

    resize();
  })();

})();
