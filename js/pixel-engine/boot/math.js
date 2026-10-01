/* Shared math helpers for density lattice reveals. */

export function hash01(i, salt) {
  let x = Math.imul(i ^ (salt | 0), 0x27d4eb2d);
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x >>> 0) / 4294967296);
}

export function clamp01(u) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return u;
}

export function smootherstep(u) {
  const t = clamp01(u);
  return t * t * t * (t * (t * 6 - 15) + 10);
}
