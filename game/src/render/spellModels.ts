import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { loft, relief } from "./sculpt";

/** Shared, recognizable weapon silhouettes for the retained spells. */
export function spiritBladeGeometry(): THREE.BufferGeometry {
  return relief([[0,1.08],[.14,.59],[.1,-.37],[.36,-.48],[.32,-.57],[.075,-.51],[.055,-.82],[-.055,-.82],[-.075,-.51],[-.32,-.57],[-.36,-.48],[-.1,-.37],[-.14,.59]],.065,.012);
}

export function rendBladeGeometry(): THREE.BufferGeometry {
  const first=relief([[-.12,-.13],[-.59,-.32],[-.85,-.22],[-.63,.16],[-.18,.46],[.35,.51],[.86,.22],[.31,.3],[-.1,.14],[.12,.13]],.065,.012);
  const second=first.clone();second.rotateZ(Math.PI);
  const geometry=mergeGeometries([first,second],false)!;first.dispose();second.dispose();
  geometry.rotateX(-Math.PI/2);return geometry;
}

export function seekerGeometry(): THREE.BufferGeometry {
  const geometry=relief([[0,.5],[.12,.04],[.27,-.22],[.055,-.12],[0,-.29],[-.055,-.12],[-.27,-.22],[-.12,.04]],.06,.006);
  geometry.rotateX(Math.PI/2);return geometry;
}

export function mineGeometry(): THREE.BufferGeometry {
  const base=new THREE.CylinderGeometry(.36,.4,.14,8);base.translate(0,-.12,0);
  const mark=relief([[0,.34],[.06,.1],[.28,0],[.06,-.1],[0,-.34],[-.06,-.1],[-.28,0],[-.06,.1]],.035,.008);
  mark.rotateX(-Math.PI/2);mark.translate(0,-.025,0);
  const flat=base.toNonIndexed(),geometry=mergeGeometries([flat,mark],false)!;flat.dispose();base.dispose();mark.dispose();return geometry;
}

/** A planted oath seal: weighted plinth, engraved shield and a suspended crown. */
export function wardTotem(honed: boolean): { group: THREE.Group; crown: THREE.Group } {
  const group = new THREE.Group(), crown = new THREE.Group();
  const iron = new THREE.MeshStandardMaterial({ color: 0x34434d, metalness: .55, roughness: .65 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xa78854, metalness: .65, roughness: .48 });
  const light = new THREE.MeshBasicMaterial({ color: honed ? 0xbfeaff : 0xffd24d });
  const base = new THREE.CylinderGeometry(.31, .46, .2, 6); base.translate(0, .1, 0);
  const shaft = loft([{ y: .16, x: .18, z: .15 }, { y: .38, x: .1, z: .09 }, { y: 1.02, x: .085, z: .08 }, { y: 1.2, x: .17, z: .11 }], 8);
  const shield = relief([[-.3,.22], [0,.34], [.3,.22], [.25,-.18], [0,-.4], [-.25,-.18]], .085, .016);
  shield.translate(0, .94, .09);
  const pieces = [base, shaft, shield].map(geometry => geometry.index ? geometry.toNonIndexed() : geometry);
  const body = new THREE.Mesh(mergeGeometries(pieces, false)!, iron);
  for (const geometry of new Set([...pieces, base, shaft, shield])) geometry.dispose();
  group.add(body);
  const sigil = relief([[0,.25],[.05,.08],[.17,.02],[.05,-.035],[.035,-.2],[0,-.25],[-.035,-.2],[-.05,-.035],[-.17,.02],[-.05,.08]], .023, .006);
  const engraving = new THREE.Mesh(sigil, brass); engraving.position.set(0, .94, .152); group.add(engraving);
  const circlet = new THREE.Mesh(new THREE.TorusGeometry(.28, .035, 6, 24), brass);
  circlet.rotation.x = Math.PI / 2; crown.add(circlet);
  const jewel = new THREE.Mesh(new THREE.OctahedronGeometry(.1), light); jewel.scale.y = 1.6; crown.add(jewel);
  crown.position.y = 1.56; group.add(crown);
  group.userData.solidity = "fx";
  return { group, crown };
}
