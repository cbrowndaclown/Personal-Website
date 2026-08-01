# Pixel FS Engineering Rules

## Absolute Rule

Preserve existing functionality unless this task explicitly requires modifying it.

Never sacrifice a working feature to implement a new one.

---

# Architectural Stability Rule

Once a subsystem has been implemented, tested, and accepted by the user, it becomes part of the project's stable architecture.

Future tasks should build upon that subsystem rather than redesigning, replacing, or refactoring it unless the user explicitly requests an architectural change.

Assume that previously accepted functionality is intentional.

Avoid modifying accepted systems simply because another implementation appears cleaner or more convenient.

New features should integrate with stable systems rather than replacing them.

When in doubt, preserve the existing implementation and ask for clarification before making architectural changes.

---

# Principle of Least Change

When implementing any task, modify only the smallest amount of code necessary to satisfy the requested objective.

Do not perform opportunistic refactoring, cleanup, optimization, renaming, architectural improvements, or code reorganization outside the explicit scope of the current task.

Avoid changing unrelated files simply because they are convenient to edit at the same time.

If an unrelated improvement, optimization, or cleanup opportunity is identified, do not implement it automatically.

Instead, report it separately as a recommendation for future consideration.

Maintain the existing architecture whenever possible.

Every change should have a direct and obvious relationship to the requested feature or bug fix.

---

# Single Source of Truth Rule

Whenever a requested feature overlaps with an existing system, extend the existing implementation rather than creating a new one.

Do not introduce duplicate state, duplicate rendering logic, duplicate event listeners, duplicate configuration systems, duplicate animation pipelines, or parallel implementations that solve the same problem.

Before introducing new architecture, first determine whether the existing architecture can be safely extended.

Reuse existing utilities, shared state, rendering systems, settings, and event pipelines whenever practical.

Maintain one authoritative source of truth for each major subsystem.

If extending an existing system is not practical, explain why before introducing new architecture.

---

# Before Writing Code

Before making changes:

1. Read the relevant project documentation.

2. Identify which systems will be affected.

3. Identify which systems must remain untouched.

4. Plan the smallest possible implementation.

Only then begin coding.

---

# Modification Philosophy

Prefer extending existing systems.

Do not rewrite working implementations.

Avoid replacing entire files.

Avoid unnecessary refactoring.

Avoid renaming existing APIs.

Avoid changing established data structures.

Avoid changing state management unless required.

---

# Minimal Changes

Only modify files that are directly related to the requested feature.

Do not make cosmetic code changes in unrelated files.

Do not reorganize code simply because it "looks cleaner."

---

# Protected Systems

The following systems are considered stable architecture.

They have been implemented, tested, and accepted.

Unless the user explicitly requests an architectural change, do not redesign, replace, or refactor them.

New work must integrate with these systems rather than replacing them.

## Application layout and navigation

- Two-screen application layout
- Native CSS scroll snapping between full-screen sections
- Screen transition state machine (Screen 1 ↔ Screen 2, including navigation visibility)
- Screen initialization flow
- Screen 1 ↔ Screen 2 architecture
- Existing navigation behavior
- Rule that each deliberate scroll gesture advances exactly one application state

## Pixel FS screens and framing

- Pixel FS Screen 1 as the primary landing experience
- Pixel FS Screen 2 as the continuation of the Pixel FS experience
- Ribbon boundary architecture
- Ribbon banner

## Boot, render, and interaction

- Boot pipeline
- Boot animation
- Intro animation
- Renderer integration between Screen 1 and Screen 2
- Pixel renderer
- Pixel presets
- RGB controls
- Heat mode
- Wave mode
- Lightning mode
- Density recalibration
- Keyboard shortcuts
- Existing animations
- Existing saved settings
- Settings panel

## Project documentation

- Documentation system (`docs/PROJECT_GUIDE.md`, `docs/ENGINEERING_RULES.md`, `docs/DESIGN_SPEC.md`, `docs/TECHNICAL_SPEC.md`) as part of the project architecture

---

# Existing Features

The Protected Systems section above is the authoritative list of stable systems.

The items listed there must remain untouched unless the user explicitly requests changes.

---

# Bug Fixes

Do not immediately begin changing code.

Instead:

1. Diagnose the cause.

2. Explain the root cause.

3. Describe the smallest possible fix.

4. Implement only that fix.

---

# New Features

New features should integrate into existing architecture.

Avoid creating duplicate systems.

Avoid creating parallel implementations.

Reuse existing utilities whenever possible.

---

# Performance

Never reduce rendering performance.

Avoid unnecessary re-renders.

Avoid unnecessary listeners.

Avoid unnecessary state updates.

Avoid unnecessary DOM operations.

---

# Animation Rules

Do not remove animations.

Do not simplify animations.

Maintain visual quality.

Animation timing should remain consistent.

---

# Completion Checklist

Before considering a task complete:

✓ Existing functionality still works.

✓ No unrelated regressions.

✓ Existing animations remain intact.

✓ Existing settings remain functional.

✓ Existing interactions remain unchanged unless requested.

✓ Stable architecture listed under Protected Systems remains intact unless the task explicitly changes it.

If any regression exists, the task is not complete.
