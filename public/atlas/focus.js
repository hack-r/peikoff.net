// Double-click on scenery: where to put the camera so the thing is framed. Pure maths (plain {x,y,z} objects), unit-tested in node.

/** Anything flatter than this (metres) and lying on the ground counts as floor: water, road, asphalt. */
export const FLOOR_THICKNESS = 3;

/** Is a hit the floor? `hit` = { normalY, size: {x,y,z}, minY }. A double click on the floor never moves the camera. */
export function isFloorHit(hit) {
  return hit.normalY > 0.85 && hit.size.y < FLOOR_THICKNESS && hit.minY < FLOOR_THICKNESS;
}

/**
 * The view that frames a thing, from the same direction (so the same tilt and heading) the camera looks from now.
 * center, size: the thing's bounding box; camera, target: the current view. Returns { toT, toC }.
 */
export function framedView(center, size, camera, target, fovDeg = 55, minDist = 40) {
  const off = { x: camera.x - target.x, y: camera.y - target.y, z: camera.z - target.z }, len = Math.hypot(off.x, off.y, off.z) || 1;
  const radius = Math.max(size.x, size.y, size.z) / 2, dist = Math.max(minDist, radius / Math.tan(fovDeg * Math.PI / 360) * 1.25);
  const k = dist / len, toC = { x: center.x + off.x * k, y: center.y + off.y * k, z: center.z + off.z * k };
  if (toC.y < 4) { toC.y = 4; }          // never dip into the ground
  return { toT: { ...center }, toC };
}
