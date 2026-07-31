# Pixel FS Engineering Rules

## Absolute Rule

Preserve existing functionality unless this task explicitly requires modifying it.

Never sacrifice a working feature to implement a new one.

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

# Existing Features

The following systems are considered stable.

Unless explicitly requested, do not modify:

- Boot animation
- Intro animation
- Ribbon banner
- Settings panel
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

If any regression exists, the task is not complete.
