import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/** Small bevels catch the key light without subdividing the broad armor faces. */
export function beveledBox(w: number, h: number, d: number): THREE.BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, 1, Math.min(w, h, d) * 0.16);
}

/** Stable mineral grain. Shared by stonework; no external textures or frame work. */
export function stoneTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const g = canvas.getContext("2d")!;
  const pixels = g.createImageData(256, 256);
  let seed = 1709;
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const grain = (seed >>> 24) / 255;
    const u = x / 256 * Math.PI * 2, v = y / 256 * Math.PI * 2;
    const mineral = Math.sin(u * 2 + Math.sin(v * 3) * 1.2) * Math.sin(v * 3) * 11
      + Math.sin(u * 7 + v * 5) * Math.cos(v * 4 - u) * 4;
    const value = 205 + grain * 7 + mineral;
    const i = (y * 256 + x) * 4;
    pixels.data[i] = value;
    pixels.data[i + 1] = value - 3;
    pixels.data[i + 2] = value - 6;
    pixels.data[i + 3] = 255;
  }
  g.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}
