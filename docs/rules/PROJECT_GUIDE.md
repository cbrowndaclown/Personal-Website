# Pixel FS Project Guide

## Purpose

Pixel FS is an interactive portfolio website built around a custom pixel rendering engine.

The project prioritizes:

- Fluidity
- Responsiveness
- Visual polish
- Animation quality
- Stability
- Consistency

Every implementation decision should improve one or more of these goals.

---

# Development Philosophy

The website should feel like software, not a traditional webpage.

Animations should feel intentional.

Every transition should have purpose.

Nothing should appear abrupt unless explicitly designed to.

---

# Core Principles

Visual polish is more important than adding new features.

Working systems should not be rewritten.

Features should be extended rather than replaced.

Small targeted changes are preferred over large refactors.

Accepted subsystems are stable architecture. Build upon them; do not redesign them unless explicitly requested.

---

# Screen Architecture

Pixel FS uses an established two-screen full-screen layout.

- **Screen 1** (`#pixel-fs-screen-1`) is the primary landing experience: boot, intro, pixel stage, settings, and first impression.

- **Screen 2** (`#pixel-fs-screen-2`) is the continuation of the Pixel FS experience within the same application frame.

Both screens live in `#app-scroll`. Native CSS scroll snapping defines full-screen resting points. A Screen 1 ↔ Screen 2 navigation state machine advances application state. Each deliberate scroll gesture advances exactly one state.

Transitions between screens should always feel smooth and intentional.

This layout and navigation model are protected architecture.

---

# Boot Sequence

The boot sequence is a core identity feature.

It should never be modified unless explicitly requested.

The current Screen 1 boot pipeline is:

powering on → grid generation → calibration → typography construction → stabilizing → ready

The boot sequence establishes the visual language for the rest of the website.

---

# Ribbon and Framing

The ribbon banner and page-shell boundary frame the active Pixel FS region.

Screen 1 opens at the bottom; Screen 2 opens at the top — one continuous display.

Ribbon boundary architecture is protected.

---

# Pixel Engine

The pixel renderer is considered the heart of the project.

The renderer is one shared engine with display surfaces on Screen 1 and Screen 2. Both screens reuse the same simulation, state, settings, interaction pipeline, and framing rather than creating parallel renderers.

Changes to rendering should always preserve:

- performance
- responsiveness
- animation quality
- existing visual behaviors

---

# Settings

Settings should always remain persistent.

Changing one setting should never unexpectedly modify another.

Resetting settings should always restore the project's intended defaults.

---

# Documentation Architecture

Project documentation is part of the architecture:

- `docs/PROJECT_GUIDE.md` — purpose, philosophy, high-level structure
- `docs/ENGINEERING_RULES.md` — how to change the codebase safely
- `docs/DESIGN_SPEC.md` — design and motion language
- `docs/TECHNICAL_SPEC.md` — implementation source of truth

Treat these documents as authoritative. Keep them aligned when accepted systems change because the user requested it.

---

# User Experience Goals

Every interaction should feel:

- polished

- responsive

- satisfying

- premium

- cohesive

The user should never notice implementation details.

Everything should feel intentional.

---

# Long-Term Goal

Pixel FS should feel like an interactive desktop application rather than a standard portfolio website.

Every addition should move the project toward that goal.

New work should integrate with the stable two-screen Pixel FS architecture rather than replacing it.
