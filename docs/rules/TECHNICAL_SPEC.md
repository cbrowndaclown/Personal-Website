# Pixel FS Technical Specification

Version: 1.1

This document defines the architecture, interaction model, animation philosophy, and technical behavior of Pixel FS.

This specification is considered the source of truth for the project.

Any implementation that conflicts with this document should be considered incorrect unless the user explicitly requests an architectural change.

The documentation system itself (`docs/PROJECT_GUIDE.md`, `docs/ENGINEERING_RULES.md`, `docs/DESIGN_SPEC.md`, and this file) is part of the project architecture. Future agents must treat these documents as authoritative and keep them aligned with accepted systems.

---

# Project Overview

Pixel FS is an interactive portfolio experience built around a custom pixel rendering engine.

The website should feel like a piece of software rather than a traditional webpage.

The pixel engine is not simply a background effect.

It is the core interface of the website.

Every interaction should reinforce that concept.

---

# Design Goals

The project prioritizes:

• responsiveness

• fluid animation

• premium visual polish

• subtle detail

• consistency

• extensibility

• stability

The project does not prioritize adding features quickly.

Maintaining quality is more important than increasing feature count.

---

# Overall Architecture

Pixel FS uses an established two-screen full-screen layout.

The two screens are:

• Pixel FS Screen 1 (`#pixel-fs-screen-1`) — primary landing experience

• Pixel FS Screen 2 (`#pixel-fs-screen-2`) — continuation of the Pixel FS experience

Both screens live inside `#app-scroll`, the sole vertical scrollport.

The outer ribbon frame (`.page-shell`) stays fixed. It is never the scroll container.

Scrolling transitions between screens through a state machine backed by native CSS scroll snapping.

The screens feel connected as parts of one application rather than independent webpages.

This two-screen layout, scroll snapping, and Screen 1 ↔ Screen 2 architecture are stable and protected.

---

# Pixel FS Screen 1

Screen 1 is the primary landing experience.

This role is established architecture.

Responsibilities:

• boot sequence

• intro animation

• navigation

• ribbon banner (Screen 1 boundary: top + sides, open bottom)

• settings panel

• pixel interactions

• first impression

• hosting the authoritative Pixel FS simulation surface

This screen establishes the visual language used throughout the project.

---

# Pixel FS Screen 2

Screen 2 is the continuation of the Pixel FS experience.

This role is established architecture.

Responsibilities:

• continuation of the same application frame after Screen 1

• secondary content

• portfolio expansion

• additional interactive elements

• future feature growth within this screen (not a replacement layout)

• hosting a display surface powered by the shared Pixel FS engine beneath an independent content overlay

Screen 2 should visually feel like a continuation of Screen 1 rather than an entirely new page.

The ribbon boundary mirrors for Screen 2 (bottom + sides, open top) so both screens read as one continuous Pixel FS display.

---

# Scroll System

Scrolling is state driven.

Scrolling should never feel like traditional webpage scrolling.

Instead, scrolling transitions between application states.

This philosophy is implemented and protected.

## Implementation

Authority lives in `js/app-scroll/`:

• `scroll-state.js` — pure `(screen × nav)` transition rules

• `index.js` — sole controller that mutates step / nav DOM and programmatically settles `#app-scroll`

Native CSS scroll snapping (`scroll-snap-type: y mandatory` on `#app-scroll`, with `scroll-snap-align: start` and `scroll-snap-stop: always` on each `.pixel-fs-screen`) defines resting points between full-screen sections.

Free scrolling between screens is prevented. Deliberate gestures are consumed so native snap cannot skip states.

## One gesture, one state

Each deliberate scroll gesture (wheel, touch, or keyboard) advances exactly one application state edge.

No implementation may skip intermediate states.

## Current state order

Canonical cycle (never skip):

Screen 1 + Navigation Open

↓ scroll down

Screen 1 + Navigation Closed

↓ scroll down

Screen 2 + Navigation Closed

↑ scroll up

Screen 2 + Navigation Open

↑ scroll up

Screen 1 + Navigation Open

Load / unlock park at Screen 1 + Navigation Closed so the pixel field stays flush through boot and intro. Navigation Open is one up-gesture away.

Reverse scrolling returns through the same states.

Home returns to the parked landing (Screen 1 + Navigation Closed).

Unlock mirrors prior topnav gates: `pixeldirectory*` / `pixelbootready`.

---

# Boot Sequence

The boot sequence is one of the defining characteristics of Pixel FS.

It is considered a protected system.

Unless explicitly requested, its behavior should remain unchanged.

## Current boot pipeline

The ordered Screen 1 boot pipeline is:

1. `powering_on`

2. `grid_generation`

3. `calibration`

4. `typography_construction`

5. `stabilizing`

6. `ready`

Stage definitions live in `js/pixel-engine/boot/stages/`. The boot controller owns advancement, overlaps, interaction gating, and field compositing.

The boot sequence establishes:

• rendering

• visual identity

• transition into the application

Future features should integrate with the boot pipeline rather than replacing it.

---

# Intro Animation

The intro animation begins only after boot completion.

The intro animation introduces the user to the website.

It should feel welcoming while maintaining the project's visual style.

Future animations should complement rather than compete with it.

---

# Ribbon Banner

The ribbon banner surrounds the active Pixel FS experience.

It serves as a framing element.

It should always visually reinforce the currently active application region.

## Current ribbon architecture

• The ribbon frame (`.page-shell`) is permanent outer chrome. It is not a scroll container.

• Chrome padding flips with the active screen: Screen 1 opens at the bottom; Screen 2 opens at the top.

• The nameplate (`Benz Grotesk` textPath) travels along the active rim. Screen 1 uses the top/left/right path; Screen 2 uses the bottom/left/right path.

• Ribbon layout listens to the scroll state machine (`appscrollchange` / `data-app-screen`) so the boundary stays continuous across screens.

Future layouts should preserve this role.

---

# Navigation

Navigation is integrated into the Pixel FS experience.

It should never feel disconnected from the pixel engine.

Navigation visibility is part of the Screen 1 ↔ Screen 2 state machine (`open` / `closed`), not a separate scroll system.

Navigation transitions use the existing site-frame transform animation.

Navigation should remain smooth.

Navigation should not unexpectedly interrupt animations.

---

# Settings Panel

The settings panel controls the behavior of the Pixel FS engine.

Settings are considered persistent.

Changing one setting should never unintentionally modify another.

Future settings should integrate into the existing architecture.

---

# Pixel Renderer

The renderer is the heart of Pixel FS.

It is responsible for:

• drawing pixels

• animation

• interactions

• rendering modes

Rendering performance is a top priority.

Future implementations should reuse the existing renderer whenever possible.

## Screen 1 ↔ Screen 2 renderer integration

Screen 1 and Screen 2 expose display surfaces powered by one Pixel FS engine.

The engine maintains one authoritative simulation, renderer, pixel state, settings model, interaction pipeline, animation system, rendering-mode registry, and performance configuration. The active screen surface displays that shared frame; it does not create a second renderer or parallel pixel engine.

Boot and intro remain owned by Screen 1. Screen 2 receives the resulting interactive Pixel FS environment without duplicating boot or renderer state.

Screen 2 content is an independent overlay layer above the shared rendering surface. New content must not be coupled to the renderer or introduce a separate render pipeline.

---

# Rendering Modes

Current rendering modes include:

Heat

Wave

Lightning

These modes are separate visual behaviors sharing one rendering system.

Future modes should extend this architecture rather than replacing it.

---

# Global Color

The selected global color represents the primary visual identity of the active rendering mode.

All rendering modes should respect this value.

Future visual systems should also respect the currently selected global color unless intentionally overridden.

---

# Pixel Density

Pixel density changes the rendering resolution.

Changing density should trigger recalibration rather than rebuilding the entire application.

Future density options should continue using the recalibration pipeline.

---

# Animation Philosophy

Animations should feel:

smooth

responsive

deliberate

natural

physically believable

Avoid robotic timing.

Avoid abrupt transitions.

Avoid unnecessary visual noise.

---

# Motion Philosophy

Movement should communicate purpose.

Small animations should reinforce larger animations.

Everything should appear intentional.

---

# Interaction Philosophy

The user should receive immediate visual feedback.

Interactions should feel tactile.

The website should always appear responsive.

---

# Performance Goals

Rendering should remain smooth.

Avoid unnecessary DOM updates.

Avoid duplicate listeners.

Avoid duplicate rendering systems.

Prefer extending existing systems.

---

# Protected Systems

Unless explicitly instructed otherwise, these systems should not be modified:

• two-screen application layout

• native CSS scroll snapping

• screen transition state machine

• screen initialization flow

• Screen 1 ↔ Screen 2 architecture

• ribbon boundary architecture

• boot pipeline

• boot sequence

• intro animation

• ribbon banner

• renderer integration between Screen 1 and Screen 2

• settings panel

• renderer architecture

• rendering modes

• saved settings

• existing navigation behavior

• animation pipeline

• density recalibration

• documentation system (project architecture docs)

---

# Feature Integration Rules

When implementing new features:

1.

Determine whether an existing system already performs the required task.

2.

Extend existing systems whenever possible.

3.

Avoid creating duplicate implementations.

4.

Minimize architectural changes.

5.

Preserve visual consistency.

6.

Maintain performance.

7.

Respect the Architectural Stability Rule, Principle of Least Change, and Single Source of Truth Rule in `ENGINEERING_RULES.md`.

---

# Regression Policy

A task is not considered complete if it introduces regressions into unrelated systems.

Before completing any task, verify:

• existing animations still function

• settings persistence still functions

• rendering modes still function

• navigation still functions

• boot sequence still functions

• ribbon banner still functions

• scroll state machine and one-gesture-one-state behavior still function

• Screen 1 ↔ Screen 2 transitions still function

• performance remains unchanged

---

# Long-Term Vision

Pixel FS should evolve into a highly polished interactive software experience.

Every new feature should reinforce the illusion that the user is interacting with a living digital system rather than browsing a traditional website.

Architecture should prioritize long-term stability over short-term convenience.

Every implementation should move the project closer to that vision.

Accepted subsystems are stable architecture. Build on them; do not redesign them unless the user explicitly requests an architectural change.
