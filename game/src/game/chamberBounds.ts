export interface BoundaryEdge {
  ax: number; az: number; bx: number; bz: number;
  /** Unit normal pointing into the chamber. */
  nx: number; nz: number; length: number;
}

/** Convex, flat chambers keep navigation simple and make every visible wall
 * authoritative. No Three.js state or cosmetic geometry enters these queries. */
export class ChamberBounds {
  readonly edges: readonly BoundaryEdge[];

  constructor(readonly points: readonly (readonly [number, number])[]) {
    this.edges = points.map(([ax,az], i) => {
      const [bx,bz] = points[(i+1)%points.length];
      const length = Math.hypot(bx-ax,bz-az);
      return { ax,az,bx,bz,nx:-(bz-az)/length,nz:(bx-ax)/length,length };
    });
  }

  clearance(x: number, z: number): number {
    let distance = Infinity;
    for (const e of this.edges) distance = Math.min(distance,(x-e.ax)*e.nx+(z-e.az)*e.nz);
    return distance;
  }

  /** Circle versus the inward-offset planes, including stable sliding at corners. */
  resolve(point: { x: number; z: number }, radius: number): void {
    for (let pass=0;pass<8;pass++) {
      let moved = false;
      for (const e of this.edges) {
        const depth = radius-(point.x-e.ax)*e.nx-(point.z-e.az)*e.nz;
        if (depth <= 0) continue;
        point.x += e.nx*(depth+0.00001); point.z += e.nz*(depth+0.00001);
        moved = true;
      }
      if (!moved) return;
    }
  }

  /** Earliest exit along a swept circle. Infinity means no wall was reached. */
  firstHit(ax: number, az: number, bx: number, bz: number, radius: number): number {
    let first = Infinity;
    for (const e of this.edges) {
      const start = (ax-e.ax)*e.nx+(az-e.az)*e.nz-radius;
      const end = (bx-e.ax)*e.nx+(bz-e.az)*e.nz-radius;
      if (start < -0.0001) return 0;
      if (end < 0 && end < start) first = Math.min(first,Math.max(0,start/(start-end)));
    }
    return first;
  }
}
