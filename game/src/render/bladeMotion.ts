import { BLADE_MOTION } from "../game/bladeMotionData";

/** Curves were evaluated in Blender; runtime owns phase and never advances a second clock. */
export function sampleBladeMotion(stage: number, phase: number, target: Float32Array): void {
  const clip = BLADE_MOTION[Math.max(0, Math.min(3, stage))];
  const cursor = Math.max(0, Math.min(1, phase)) * 100;
  const lo = Math.floor(cursor), hi = Math.min(100, lo + 1), t = cursor - lo;
  for (let i = 0; i < target.length; i++) target[i] = clip.frames[lo][i] + (clip.frames[hi][i] - clip.frames[lo][i]) * t;
}
