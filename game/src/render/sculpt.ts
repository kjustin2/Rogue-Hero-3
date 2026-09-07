import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export interface Section { y: number; x: number; z: number; offsetZ?: number; }

/** Broad, stable pigment variation across a sculpt. This supplies a cool
 * underside and a worn upper edge without animated shaders or noisy textures. */
export function sculptPigment(root: THREE.Object3D, materials: readonly THREE.MeshStandardMaterial[]): void {
  root.updateMatrixWorld(true);
  const point = new THREE.Vector3(), normal = new THREE.Vector3(), normalMatrix = new THREE.Matrix3();
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh) || node instanceof THREE.InstancedMesh || !materials.includes(node.material as THREE.MeshStandardMaterial)) return;
    const mat=node.material as THREE.MeshStandardMaterial, geometry=node.geometry;
    const positions=geometry.getAttribute("position"), normals=geometry.getAttribute("normal");
    if(!normals)return;
    mat.vertexColors=true;
    normalMatrix.getNormalMatrix(node.matrixWorld);
    const colors=new Float32Array(positions.count*3);
    for(let i=0;i<positions.count;i++) {
      point.fromBufferAttribute(positions,i).applyMatrix4(node.matrixWorld);
      normal.fromBufferAttribute(normals,i).applyMatrix3(normalMatrix).normalize();
      const up=Math.max(0,normal.y), down=Math.max(0,-normal.y);
      const brush=Math.sin(point.x*4.7+point.y*3.1)*Math.sin(point.z*4.3-point.y*2.8)*.035;
      const value=.84+up*.14-down*.18+brush;
      colors[i*3]=value*(1-down*.06);colors[i*3+1]=value;colors[i*3+2]=Math.min(1,value+down*.06);
    }
    geometry.setAttribute("color",new THREE.BufferAttribute(colors,3));
  });
}

/** Batch rigid pieces within each joint without flattening the animated hierarchy. */
export function batchSculpt(root: THREE.Object3D, animated: readonly THREE.Object3D[] = []): void {
  for (const child of [...root.children]) if (child instanceof THREE.Group) batchSculpt(child, animated);
  const batches = new Map<THREE.Material, THREE.Mesh[]>();
  for (const child of root.children) {
    if (!(child instanceof THREE.Mesh) || child instanceof THREE.InstancedMesh || child.children.length > 0 || Array.isArray(child.material) || animated.includes(child)) continue;
    const list = batches.get(child.material) ?? []; list.push(child); batches.set(child.material,list);
  }
  for (const [mat, meshes] of batches) {
    if (meshes.length < 2) continue;
    const parts = meshes.map(m => {
      m.updateMatrix(); const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      return g.applyMatrix4(m.matrix);
    });
    const geometry = mergeGeometries(parts,false); parts.forEach(g=>g.dispose());
    if (!geometry) continue;
    const merged = new THREE.Mesh(geometry,mat); merged.castShadow = merged.receiveShadow = true;
    meshes.forEach(m=>{root.remove(m);m.geometry.dispose();}); root.add(merged);
  }
}

/** Lofted cross-sections give armor and anatomy a deliberate taper and curved planes. */
export function loft(sections: readonly Section[], sides = 20, squareness = 1): THREE.BufferGeometry {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let row = 0; row < sections.length; row++) {
    const s = sections[row];
    for (let i = 0; i <= sides; i++) {
      const a = i / sides * Math.PI * 2;
      const cx = Math.cos(a), cz = Math.sin(a);
      positions.push(Math.sign(cx) * Math.pow(Math.abs(cx), squareness) * s.x, s.y, Math.sign(cz) * Math.pow(Math.abs(cz), squareness) * s.z + (s.offsetZ ?? 0));
      uvs.push(i / sides, row / (sections.length - 1));
      if (row && i < sides) {
        const p = row * (sides + 1) + i, q = p - sides - 1;
        indices.push(q, p, q + 1, p, p + 1, q + 1);
      }
    }
  }
  // Separate cap vertices keep broad ends flat and the curved sides smooth.
  for (const end of [0, sections.length - 1]) {
    const b = positions.length / 3, src = end * (sides + 1) * 3;
    for (let i = 0; i < sides; i++) {
      positions.push(positions[src + i * 3], positions[src + i * 3 + 1], positions[src + i * 3 + 2]);
      uvs.push(0.5 + Math.cos(i / sides * Math.PI * 2) * 0.5, 0.5 + Math.sin(i / sides * Math.PI * 2) * 0.5);
    }
    for (let i = 1; i < sides - 1; i++) {
      if (end === 0) indices.push(b, b + i, b + i + 1);
      else indices.push(b, b + i + 1, b + i);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Beveled outline in the XY plane, extending backward from its front face. */
export function relief(points: readonly (readonly [number, number])[], depth = 0.05, bevel = 0.012): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: bevel, bevelThickness: bevel, curveSegments: 8 });
  geo.translate(0, 0, -depth);
  return geo;
}

export function tube(points: readonly (readonly [number, number, number])[], radius: number, segments = 24): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  return new THREE.TubeGeometry(curve, segments, radius, 6, false);
}

/** Horns and claws taper to a point along their curved centerline. */
export function horn(points: readonly (readonly [number, number, number])[], radius: number, segments = 24): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  const geo = new THREE.TubeGeometry(curve,segments,radius,10,false);
  const positions=geo.getAttribute("position"),center=new THREE.Vector3();
  for(let row=0;row<=segments;row++) {
    const t=row/segments,taper=Math.max(0.002,Math.pow(1-t,0.68));curve.getPointAt(t,center);
    for(let side=0;side<=10;side++) {
      const i=row*11+side;
      positions.setXYZ(i,center.x+(positions.getX(i)-center.x)*taper,center.y+(positions.getY(i)-center.y)*taper,center.z+(positions.getZ(i)-center.z)*taper);
    }
  }
  geo.computeVertexNormals();return geo;
}

/** Stable brushed metal roughness, with fine scratches and broad worn patches. */
export function metalFinish(): THREE.CanvasTexture {
  const canvas=document.createElement("canvas");canvas.width=canvas.height=256;
  const g=canvas.getContext("2d")!,data=g.createImageData(256,256);let seed=4219;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let y=0;y<256;y++)for(let x=0;x<256;x++) {
    const p=(y*256+x)*4;
    const patina=Math.sin(x*.036+Math.sin(y*.027)*1.4)*Math.cos(y*.039)*24;
    const v=165+patina+random()*20;
    data.data[p]=data.data[p+1]=data.data[p+2]=v;data.data[p+3]=255;
  }
  g.putImageData(data,0,0);g.lineWidth=.55;
  for(let i=0;i<130;i++) {
    const x=random()*256,y=random()*256;g.strokeStyle=i%3===0?"#6b6b6b":"#cccccc";
    g.beginPath();g.moveTo(x,y);g.lineTo(x+random()*3-1.5,y+2+random()*18);g.stroke();
  }
  const tex=new THREE.CanvasTexture(canvas);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.anisotropy=4;return tex;
}

/** Fixed mesh detail for leather/cloth: no animated texture and no asset request. */
export function weaveTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const g = canvas.getContext("2d")!;
  const data = g.createImageData(128, 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const n = (Math.imul(x + y * 131, 1597334677) >>> 24) / 255;
    const v = 160 + n * 25 + ((x + y) % 3 === 0 ? 24 : 0);
    const k = (y * 128 + x) * 4;
    data.data[k] = data.data[k + 1] = data.data[k + 2] = v;
    data.data[k + 3] = 255;
  }
  g.putImageData(data, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  texture.anisotropy = 4;
  return texture;
}
