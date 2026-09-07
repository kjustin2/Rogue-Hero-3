interface Circle { x: number; z: number; r: number; }

/** Local detour around the first blocking pillar. The target-relative shoulder
 * stays stable as a pursuer moves, instead of flipping its route every frame. */
export function pursuitTarget(ax: number, az: number, tx: number, tz: number, radius: number, obstacles: readonly Circle[], preference: number): { x: number; z: number } {
  const dx = tx - ax, dz = tz - az, lengthSq = dx * dx + dz * dz;
  if (lengthSq < 0.01) return { x: tx, z: tz };
  let blocker: Circle | null = null, first = Infinity;
  for (const o of obstacles) {
    const t = ((o.x - ax) * dx + (o.z - az) * dz) / lengthSq;
    if (t <= 0 || t >= 1) continue;
    const r = o.r + radius + 0.16;
    if ((ax + dx*t - o.x)**2 + (az + dz*t - o.z)**2 < r*r && t < first) { blocker = o; first = t; }
  }
  if (!blocker) return { x: tx, z: tz };
  const o = blocker, r = o.r + radius + 0.32;
  const toGoal = Math.hypot(tx - o.x, tz - o.z) || 1;
  const gx = (tx - o.x) / toGoal, gz = (tz - o.z) / toGoal;
  let best = Infinity, point = { x: tx, z: tz };
  for (const side of [preference, -preference]) {
    const x = o.x + gz*r*1.28*side + gx*r*0.35;
    const z = o.z - gx*r*1.28*side + gz*r*0.35;
    const crowd = obstacles.some(other => other !== o && Math.hypot(x-other.x,z-other.z) < other.r+radius+0.2);
    const cost = Math.hypot(x-ax,z-az) + Math.hypot(tx-x,tz-z) + (crowd ? 50 : 0);
    if (cost < best - 0.03) { best = cost; point = { x, z }; }
  }
  return point;
}
