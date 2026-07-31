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

---

# Screen Architecture

Pixel FS consists of multiple full-screen sections.

Each screen has a specific responsibility.

Transitions between screens should always feel smooth and intentional.

---

# Boot Sequence

The boot sequence is a core identity feature.

It should never be modified unless explicitly requested.

The boot sequence establishes the visual language for the rest of the website.

---

# Pixel Engine

The pixel renderer is considered the heart of the project.

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
