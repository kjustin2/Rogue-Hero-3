import * as THREE from "three";
import { batchSculpt, loft, relief, tube } from "./sculpt";

/** Abbey furniture built inside its collision circle. The broad footing is the
 * collision silhouette; broken stone and ironwork rise within that footprint. */
export function forgeCover(radius: number, variant: number, accent: number, masonry: THREE.Texture) {
  const root = new THREE.Group();
  root.name = ["Broken choir pier", "Sealed ossuary", "Shattered column", "Votive reliquary"][variant];
  const stone = new THREE.MeshStandardMaterial({ color: 0x737b7b, map: masonry, bumpMap: masonry, bumpScale: .032, roughness: .93, transparent: true });
  const edge = new THREE.MeshStandardMaterial({ color: 0x9b947f, map: masonry, bumpMap: masonry, bumpScale: .017, roughness: .87, transparent: true });
  const iron = new THREE.MeshStandardMaterial({ color: 0x4b5155, metalness: .55, roughness: .7, transparent: true });
  const bronze = new THREE.MeshStandardMaterial({ color: 0xa28b61, metalness: .62, roughness: .53, emissive: accent, emissiveIntensity: .018, transparent: true });
  const materials = [stone, edge, iron, bronze];
  const put = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geo, mat); mesh.position.set(x, y, z); root.add(mesh); return mesh;
  };
  const course = (y: number, h: number, r: number, mat: THREE.Material, sides = 8) =>
    put(new THREE.CylinderGeometry(r, r, h, sides), mat, 0, y + h / 2);
  const r = radius;
  course(.01, .16, r * .98, stone);
  course(.17, .13, r * .92, edge);
  course(.30, .13, r * .81, stone);

  if (variant === 0 || variant === 2) {
    const h = variant === 0 ? 2.2 + r * .6 : 1.45 + r * .48;
    const sides = variant === 0 ? 8 : 64;
    const shaft = loft([{ y: .39, x: r*.74, z: r*.74 }, { y: .53, x: r*.77, z: r*.77 },
      { y: h*.42, x: r*.69, z: r*.69 }, { y: h-.25, x: r*.65, z: r*.65 }, { y: h, x: r*.66, z: r*.66 }], sides);
    const p = shaft.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      const x=p.getX(i), y=p.getY(i), z=p.getZ(i), a=Math.atan2(z,x);
      const flute = variant === 2 && y > .55 ? 1-Math.pow(Math.max(0,Math.cos(a*10)),1.5)*.1 : 1;
      const fracture = y > h-.05 ? Math.sin(a*3+.7)*.16+Math.cos(a*7)*.07 : 0;
      p.setXYZ(i,x*flute,y+fracture,z*flute);
    }
    shaft.computeVertexNormals(); put(shaft, stone);
    if (variant === 0) {
      // Recessed lancet faces and a split cornice read as salvaged architecture.
      for (let side = 0; side < 4; side++) {
        const face = new THREE.Group(); face.rotation.y = side*Math.PI/2; root.add(face);
        const outline = [[-.34,-.64],[-.34,.42],[0,.86],[.34,.42],[.34,-.64]] as const;
        const panel = new THREE.Mesh(relief(outline,.028,.012),iron);
        panel.position.set(0,1.32,r*.675); face.add(panel);
        const molding = new THREE.Mesh(tube([[-.39,-.68,0],[-.39,.45,0],[0,.95,0],[.39,.45,0],[.39,-.68,0]],.036,24),edge);
        molding.position.copy(panel.position).add(new THREE.Vector3(0,0,.028)); face.add(molding);
        const rune = new THREE.Mesh(relief([[0,.39],[.075,.11],[.035,-.33],[-.035,-.33],[-.075,.11]],.025,.006),bronze);
        rune.position.copy(panel.position).add(new THREE.Vector3(0,0,.048)); face.add(rune);
      }
      course(h-.28,.12,r*.77,edge);
      course(h-.16,.11,r*.82,stone);
    } else {
      course(.51,.05,r*.77,bronze,32);
      // A few broad seams cut through the stone; chips remain inside the footing.
      for (const side of [-1,1]) {
        const scar = put(tube([[side*r*.32,h-.01,r*.6],[side*r*.4,h-.27,r*.54],[side*r*.31,h-.58,r*.59]],.014,12),iron);
        scar.rotation.y=side*.24;
      }
    }
  } else if (variant === 1) {
    const h=1.75+r*.3;
    put(loft([{y:.43,x:r*.7,z:r*.7},{y:.62,x:r*.78,z:r*.78},{y:h-.5,x:r*.72,z:r*.72},{y:h-.18,x:r*.59,z:r*.59}],12,.88),stone);
    course(.56,.095,r*.8,bronze,12); course(h-.5,.075,r*.755,bronze,12);
    for(let i=0;i<6;i++) {
      const a=i*Math.PI/3;
      const face=put(relief([[-.16,.36],[0,.54],[.16,.36],[.12,-.3],[0,-.42],[-.12,-.3]],.04,.015),iron,Math.sin(a)*r*.74,1.09,Math.cos(a)*r*.74);
      face.rotation.y=a;
      const pin=put(new THREE.SphereGeometry(.047,8,6),bronze,Math.sin(a)*r*.77,1.3,Math.cos(a)*r*.77);pin.scale.y=1.3;
    }
    course(h-.19,.14,r*.64,edge,12);
    put(loft([{y:h-.05,x:r*.65,z:r*.65},{y:h+.12,x:r*.54,z:r*.54},{y:h+.32,x:r*.2,z:r*.2}],12,.8),iron);
    course(h+.32,.10,r*.22,bronze,8);
  } else {
    const h=2.45+r*.32;
    put(loft([{y:.43,x:r*.62,z:r*.62},{y:h-.65,x:r*.59,z:r*.59},{y:h-.43,x:r*.68,z:r*.68}],8,.9),stone);
    for(let i=0;i<4;i++) {
      const a=i*Math.PI/2;
      const inset=put(relief([[-.3,-.66],[-.3,.36],[0,.76],[.3,.36],[.3,-.66]],.04,.02),iron,Math.sin(a)*r*.60,1.4,Math.cos(a)*r*.60);inset.rotation.y=a;
      const sword=put(relief([[-.034,-.44],[-.034,-.16],[-.18,-.16],[-.18,-.1],[-.034,-.1],[-.034,.29],[0,.46],[.034,.29],[.034,-.1],[.18,-.1],[.18,-.16],[.034,-.16],[.034,-.44]],.024,.006),bronze,Math.sin(a)*(r*.60+.04),1.4,Math.cos(a)*(r*.60+.04));sword.rotation.y=a;
    }
    course(h-.44,.13,r*.75,edge,8);
    put(loft([{y:h-.31,x:r*.71,z:r*.71},{y:h-.18,x:r*.68,z:r*.68},{y:h+.18,x:r*.13,z:r*.13}],8,.9),iron);
    course(h+.18,.09,r*.16,bronze,8);
  }
  batchSculpt(root);
  const shadowCasters: THREE.Mesh[] = [];
  root.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=o.receiveShadow=true;shadowCasters.push(o);}});
  return { root, materials, shadowCasters };
}
