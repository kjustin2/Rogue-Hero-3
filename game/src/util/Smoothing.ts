/**
 * Frame-rate-independent exponential damping coefficient.
 *
 * Use with approach-to-target lerps:
 *   x += (target - x) * dampCoeff(k, dt);
 *
 * `k` is the rate constant — roughly "how many units per second". Larger k =
 * snappier approach. k=12 at dt=1/60 ≈ 0.181 (close to the old `dt*12` at 60Hz,
 * which capped at 0.2) but stays stable at higher refresh rates instead of
 * over-lerping.
 *
 * Do NOT use for linear integrators (`x += v * dt`, countdowns `timer -= dt`,
 * or the knockback `exp(-12*dt)` decay). Those are already frame-rate correct.
 */
export function dampCoeff(k: number, dt: number): number {
  return 1 - Math.exp(-k * dt);
}

/**
 * Approach `target` from `value` with a slight overshoot, then settle. Returns
 * the next value. Use for snappier reads on aim/scale tweens where a clean
 * exponential lerp feels mushy.
 *
 * Implemented as a 2nd-order spring step: phase[0] = value, phase[1] = velocity.
 * Pass the same `state` array each call (length 2 — value and velocity). At
 * stiffness `k=18` and damping `d=0.65` the result lands ~6% past the target
 * before pulling back, which reads as anticipation without feeling springy.
 *
 * Usage:
 *   const swordScale = [1, 0]; // [value, velocity]
 *   anticipate(swordScale, target, dt);
 *   mesh.scaling.x = swordScale[0];
 */
export function anticipate(
  state: [number, number],
  target: number,
  dt: number,
  k = 18,
  d = 0.65,
): number {
  const dx = target - state[0];
  const accel = k * dx - d * k * state[1];
  state[1] += accel * dt;
  state[0] += state[1] * dt;
  return state[0];
}
