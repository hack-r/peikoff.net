// Optional 3D model for the social-group cottages (proof of concept for ready-made glTF models, e.g. from Poly Pizza / Quaternius / Kenney, which are CC0).
//
// Drop a .glb at public/atlas/models/cottage.glb (or try one with ?model=URL) and every cottage uses it instead of the built-in box-and-pyramid house.
// If the file is missing or cannot be read, nothing changes. The model is normalized so any file works: it is centered, set on the ground, scaled to a
// footprint of 1 (and no taller than 1.6), flattened to one mesh with its material colors as vertex colors (textures are ignored), and given a stone footing so it
// sits on a slope. The top of the model (above 62 % of its height) is painted in the cottage's roof color.
import * as THREE from 'three';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';

/** Flatten a loaded glTF scene into one non-indexed geometry with position, normal and color; returns null if it has no meshes. */
export function flattenScene(scene) {
  scene.updateMatrixWorld(true);
  const parts = [];
  scene.traverse(o => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    if (!g.attributes.normal) g.computeVertexNormals();
    const mat = Array.isArray(o.material) ? o.material[0] : o.material, base = mat?.color ? mat.color : new THREE.Color(0xcccccc), n = g.attributes.position.count, col = new Float32Array(n * 3), vc = g.attributes.color;
    for (let i = 0; i < n; i++) { col[i * 3] = base.r * (vc ? vc.getX(i) : 1); col[i * 3 + 1] = base.g * (vc ? vc.getY(i) : 1); col[i * 3 + 2] = base.b * (vc ? vc.getZ(i) : 1); }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', g.attributes.position); out.setAttribute('normal', g.attributes.normal); out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(out);
  });
  return parts.length ? mergeGeometries(parts) : null;
}

/** Center on x/z, put the lowest point at y = 0, scale to footprint 1 (height capped at 1.6). Returns the geometry; its height is in geometry.userData.height. */
export function normalize(geo) {
  geo.computeBoundingBox(); const b = geo.boundingBox, w = Math.max(b.max.x - b.min.x, b.max.z - b.min.z, 1e-6);
  geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  let s = 1 / w; if ((b.max.y - b.min.y) * s > 1.6) s = 1.6 / (b.max.y - b.min.y);
  geo.scale(s, s, s); geo.userData.height = (b.max.y - b.min.y) * s;
  return geo;
}

/** The model with its top painted `roofHex`, plus a stone footing below it. */
export function withRoof(base, roofHex, topFrom = 0.62) {
  const g = base.clone(), h = base.userData.height, roof = new THREE.Color(roofHex), p = g.attributes.position, c = g.attributes.color;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > topFrom * h) { c.setXYZ(i, roof.r, roof.g, roof.b); }
  const foot = new THREE.BoxGeometry(1.1, 0.9, 1.1).translate(0, -0.4, 0).toNonIndexed(), n = foot.attributes.position.count, fc = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) fc.set([0.42, 0.44, 0.47], i * 3);
  foot.setAttribute('color', new THREE.BufferAttribute(fc, 3)); foot.deleteAttribute('uv');
  const out = mergeGeometries([g, foot]); out.userData.height = h; return out;
}

/** Load and normalize a .glb. Resolves to the normalized geometry, or null if it is missing or unreadable. */
export async function loadBuilding(url) {
  try { const gltf = await new GLTFLoader().loadAsync(url), flat = flattenScene(gltf.scene); return flat ? normalize(flat) : null; }
  catch (e) { return null; }
}
