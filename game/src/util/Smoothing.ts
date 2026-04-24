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
