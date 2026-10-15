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
export function flattenScene(scene, recolor) {   // recolor(color, geometry) may return a replacement THREE.Color, a Float32Array of per-vertex colors, or nothing, for each material
  scene.updateMatrixWorld(true);
  const parts = [];
  scene.traverse(o => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    if (!g.attributes.normal) g.computeVertexNormals();
    const mat = Array.isArray(o.material) ? o.material[0] : o.material, base0 = mat?.color ? mat.color : new THREE.Color(0xcccccc), swap = recolor?.(base0, g), n = g.attributes.position.count, col = new Float32Array(n * 3), vc = g.attributes.color;
    const base = swap && swap.isColor ? swap : base0, per = swap && !swap.isColor ? swap : null;                  // swap: a Color for the whole mesh, or a Float32Array of per-vertex colors
    for (let i = 0; i < n; i++) { const r = per ? per[i * 3] : base.r, gg = per ? per[i * 3 + 1] : base.g, b = per ? per[i * 3 + 2] : base.b; col[i * 3] = r * (vc ? vc.getX(i) : 1); col[i * 3 + 1] = gg * (vc ? vc.getY(i) : 1); col[i * 3 + 2] = b * (vc ? vc.getZ(i) : 1); }
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

/** A character or vehicle (Easter eggs): flattened like a cottage, centered on x/z, standing on y = 0, scaled so its longest side is 1 unit. `recolor` may swap material colors. Resolves to a geometry, or null. */
export async function loadFigure(url, recolor) {
  try {
    const gltf = await new GLTFLoader().loadAsync(url), flat = flattenScene(gltf.scene, recolor); if (!flat) return null;
    flat.computeBoundingBox(); const b = flat.boundingBox, s = 1 / Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z, 1e-6), hgt = (b.max.y - b.min.y) * s;
    flat.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2); flat.scale(s, s, s); flat.userData.height = hgt;
    return flat;
  } catch (e) { return null; }
}

/** Per-vertex colors for `geo` (non-indexed): `keep` stays for triangles smaller than `frac` of the median triangle area (eyes, pupils, nose), every other triangle becomes `to`. */
export function tintLargeFaces(geo, to, keep, frac = 0.25) {
  const p = geo.attributes.position, tri = p.count / 3, areas = new Float32Array(tri), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < tri; t++) { a.fromBufferAttribute(p, t * 3); b.fromBufferAttribute(p, t * 3 + 1).sub(a); c.fromBufferAttribute(p, t * 3 + 2).sub(a); areas[t] = b.cross(c).length() / 2; }
  const med = [...areas].sort((x, y) => x - y)[tri >> 1], out = new Float32Array(p.count * 3);
  for (let t = 0; t < tri; t++) { const k = areas[t] < med * frac ? keep : to; for (let v = 0; v < 3; v++) out.set([k.r, k.g, k.b], (t * 3 + v) * 3); }
  return out;
}

/** A copy of non-indexed `geo` without the triangles for which drop(r, g, b, cx, cy, cz) is true (color attribute and triangle centroid). */
export function dropTriangles(geo, drop) {
  const P = geo.attributes.position, C = geo.attributes.color, N = geo.attributes.normal, keep = [];
  for (let t = 0; t < P.count / 3; t++) {
    let cx = 0, cy = 0, cz = 0; for (let v = 0; v < 3; v++) { cx += P.getX(t * 3 + v) / 3; cy += P.getY(t * 3 + v) / 3; cz += P.getZ(t * 3 + v) / 3; }
    if (!drop(C.getX(t * 3), C.getY(t * 3), C.getZ(t * 3), cx, cy, cz)) keep.push(t);
  }
  const out = new THREE.BufferGeometry();
  for (const [name, a] of [['position', P], ['normal', N], ['color', C]]) { const arr = new Float32Array(keep.length * 9); keep.forEach((t, k) => arr.set(a.array.subarray(t * 9, t * 9 + 9), k * 9)); out.setAttribute(name, new THREE.BufferAttribute(arr, 3)); }
  out.userData = { ...geo.userData }; return out;
}

/** A model at its own scale (train cars, track): flattened, centered on x/z, standing on y = 0. Resolves to a geometry (its size is in userData.size = [x, y, z]), or null. */
export async function loadRaw(url, recolor) {
  try {
    const gltf = await new GLTFLoader().loadAsync(url), flat = flattenScene(gltf.scene, recolor); if (!flat) return null;
    flat.computeBoundingBox(); const b = flat.boundingBox, size = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z];
    flat.userData.center = [(b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2]; flat.translate(-flat.userData.center[0], -b.min.y, -flat.userData.center[1]); flat.userData.size = size; return flat;
  } catch (e) { return null; }
}
