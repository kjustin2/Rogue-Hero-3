export const TAU = Math.PI * 2;

/** Earliest segment contact with a circle, including contact at the origin. */
export function segmentCircleContact(ax: number, az: number, bx: number, bz: number, x: number, z: number, radius: number): number {
  const dx=bx-ax,dz=bz-az,ox=ax-x,oz=az-z,c=ox*ox+oz*oz-radius*radius;
  if(c<=0)return 0;
  const a=dx*dx+dz*dz;if(a<1e-10)return Infinity;
  const b=ox*dx+oz*dz,discriminant=b*b-a*c;if(discriminant<0)return Infinity;
  const t=(-b-Math.sqrt(discriminant))/a;
  return t>=0&&t<=1?t:Infinity;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Frame-rate independent exponential smoothing. `rate` ≈ how fast it converges (higher = snappier). */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

export function dampAngle(current: number, target: number, rate: number, dt: number): number {
  let delta = (target - current) % TAU;
  if (delta > Math.PI) delta -= TAU;
  if (delta < -Math.PI) delta += TAU;
  return current + delta * (1 - Math.exp(-rate * dt));
}

export function angleDelta(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Ease helpers for animation curves. */
export const ease = {
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  outQuart: (t: number) => 1 - Math.pow(1 - t, 4),
  inCubic: (t: number) => t * t * t,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outElastic: (t: number) => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },
};
