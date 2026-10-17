// The collectivist writers: a circle of five seated figures (Marx and Engels types, men and women) on the mountain slope below Princess Kira, each bent over a
// page with a pen. Scenery only, like Kira: never searchable, selectable or hoverable. Gray uniforms; no red (red is reserved for Peikoffs).
// The layout and the scribble are pure (unit-tested in node); buildWriter() takes three.js as an argument so this file loads in node too.

export const WRITER_SCALE = 26;     // the same scale as Kira, so they read as her neighbours
export const CIRCLE_R = 38;         // radius of the circle of seats
export const PAD_R = 14;            // radius of the rock each one sits on (nothing may clip into a neighbour's)
export const KIRA_GAP = 96;         // from Kira's ledge to the middle of the circle, down the slope in the direction she faces

export const WRITERS = [
  { name: 'bearded elder',  woman: false, skin: '#e6b999', hair: '#d8d8d8', beard: 'full',  uniform: '#6f7782', hairStyle: 'wild',  phase: 0.0 },
  { name: 'bearded young', woman: false, skin: '#f0c9a8', hair: '#5a3a22', beard: 'full',  uniform: '#59606b', hairStyle: 'short', phase: 1.3 },
  { name: 'long hair',     woman: true,  skin: '#f2cdb0', hair: '#2a1d16', beard: 'none',  uniform: '#7b828c', hairStyle: 'long',  phase: 2.1 },
  { name: 'bearded stout', woman: false, skin: '#d9a47f', hair: '#3a3a3e', beard: 'full',  uniform: '#656c77', hairStyle: 'short', phase: 3.4 },
  { name: 'long hair 2',   woman: true,  skin: '#e8bd9a', hair: '#8a8c90', beard: 'none',  uniform: '#6a717c', hairStyle: 'long',  phase: 4.6, glasses: true },
];

/** n seats evenly round a circle of radius r about (cx, cz); each faces the middle (yaw as THREE's rotation.y with +z forward). */
export function circleLayout(cx, cz, r, n = WRITERS.length, start = 0) {
  return Array.from({ length: n }, (_, i) => {
    const a = start + i * Math.PI * 2 / n, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    return { x, z, yaw: Math.atan2(cx - x, cz - z) };
  });
}

/** Middle of the circle: from Kira's ledge, `gap` units further down the back slope (unit vector (ox, oz) points away from the city). */
export function circleCentre(kx, kz, ox, oz, gap = KIRA_GAP) { return [kx + ox * gap, kz + oz * gap]; }

/** The pen hand's tiny back-and-forth (radians about the elbow) while writing. */
export function scribble(t, phase = 0) { return { yaw: Math.sin(t * 7 + phase) * 0.1, pitch: Math.sin(t * 3.4 + phase) * 0.04 }; }

export function buildWriter(THREE, mergeGeometries, spec, mat) {
  const col = (geo, hex) => { const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
    for (let j = 0; j < n; j++) a.set([c.r, c.g, c.b], j * 3); geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo; };
  const part = (geo, parent) => { const m = new THREE.Mesh(geo, mat); parent.add(m); return m; };
  const limb = (a, b, r0, r1) => { const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), len = d.length();
    const g = new THREE.CylinderGeometry(r1, r0, len, 8); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    return g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); };
  const SKIN = spec.skin, HAIR = spec.hair, U = spec.uniform, DARK = '#26282d';
  const root = new THREE.Group(), upper = new THREE.Group(), head = new THREE.Group(), fore = new THREE.Group();
  root.add(upper); upper.position.set(0, 0.16, 0); upper.rotation.x = 0.28;                       // hips on the rock; the body leans over the page
  // legs: crossed in the lap of a gray skirt (women) or trousers (men)
  if (spec.woman) part(col(new THREE.CylinderGeometry(0.2, 0.52, 0.45, 14, 1, true).translate(0, 0.225, 0), U), root);
  else part(mergeGeometries([
    col(limb([-0.12, 0.13, 0.05], [-0.34, 0.12, 0.5], 0.09, 0.08), U), col(limb([0.12, 0.13, 0.05], [0.34, 0.12, 0.5], 0.09, 0.08), U),
    col(limb([-0.34, 0.12, 0.5], [0.1, 0.1, 0.38], 0.075, 0.065), U), col(limb([0.34, 0.12, 0.5], [-0.1, 0.1, 0.38], 0.075, 0.065), U),
    col(new THREE.BoxGeometry(0.1, 0.05, 0.16).translate(0.1, 0.07, 0.4), DARK), col(new THREE.BoxGeometry(0.1, 0.05, 0.16).translate(-0.1, 0.07, 0.4), DARK)]), root);
  // torso, shoulders, collar, neck (origin of `upper` is the hips)
  part(mergeGeometries([
    col(new THREE.CylinderGeometry(0.17, 0.16, 0.55, 12).translate(0, 0.28, 0), U),
    col(new THREE.SphereGeometry(0.07, 8, 6).translate(-0.19, 0.53, 0), U), col(new THREE.SphereGeometry(0.07, 8, 6).translate(0.19, 0.53, 0), U),
    col(new THREE.CylinderGeometry(0.075, 0.085, 0.1, 8).translate(0, 0.6, 0), SKIN),
    col(new THREE.CylinderGeometry(0.09, 0.1, 0.035, 10).translate(0, 0.565, 0), '#e9e9ec'),
    col(new THREE.CylinderGeometry(0.172, 0.172, 0.04, 12).translate(0, 0.05, 0), '#3b3f47')]), upper);   // a dark belt
  // left arm resting on the page; right upper arm reaching to the elbow (the forearm, hand and pen scribble)
  part(mergeGeometries([
    col(limb([-0.19, 0.53, 0], [-0.22, 0.3, 0.18], 0.045, 0.04), U), col(limb([-0.22, 0.3, 0.18], [-0.1, 0.22, 0.42], 0.038, 0.032), U), col(new THREE.SphereGeometry(0.035, 6, 5).translate(-0.1, 0.22, 0.42), SKIN),
    col(limb([0.19, 0.53, 0], [0.22, 0.3, 0.18], 0.045, 0.04), U)]), upper);
  fore.position.set(0.22, 0.3, 0.18); upper.add(fore);                                              // pivot at the right elbow
  part(mergeGeometries([
    col(limb([0, 0, 0], [-0.1, -0.06, 0.24], 0.038, 0.032), U), col(new THREE.SphereGeometry(0.034, 6, 5).translate(-0.1, -0.06, 0.24), SKIN),
    col(limb([-0.1, -0.06, 0.24], [-0.13, -0.075, 0.33], 0.006, 0.006), DARK), col(new THREE.ConeGeometry(0.008, 0.03, 5).rotateX(Math.PI / 2).translate(-0.135, -0.078, 0.35), '#b9a15a')]), fore);   // forearm, hand, pen and its nib
  // the page: a board across the knees with a sheet on it and lines of writing
  const page = new THREE.Group(); page.position.set(0, 0.2, 0.36); page.rotation.x = -0.32; upper.add(page);
  part(mergeGeometries([
    col(new THREE.BoxGeometry(0.42, 0.02, 0.32), '#4a3a2a'), col(new THREE.BoxGeometry(0.38, 0.012, 0.29).translate(0, 0.016, 0), '#f1ead6'),
    ...[-0.09, -0.03, 0.03, 0.09].map((z, k) => col(new THREE.BoxGeometry(0.3 - k * 0.03, 0.004, 0.012).translate(-0.02 - k * 0.0, 0.024, z), '#3a3a52'))]), page);
  upper.updateMatrixWorld();
  // head (turned down to the page), face, hair, beard
  head.position.set(0, 0.68, 0.02); head.rotation.x = 0.4; upper.add(head);
  const pieces = [
    col(new THREE.SphereGeometry(0.115, 14, 10).translate(0, 0.1, 0), SKIN),
    col(new THREE.SphereGeometry(0.014, 6, 4).translate(-0.04, 0.115, 0.098), DARK), col(new THREE.SphereGeometry(0.014, 6, 4).translate(0.04, 0.115, 0.098), DARK),
    col(new THREE.SphereGeometry(0.022, 6, 4).translate(0, 0.09, 0.112), SKIN),
    col(new THREE.TorusGeometry(0.026, 0.005, 5, 12, Math.PI).rotateZ(Math.PI).translate(0, 0.045, 0.104), '#9a4b4b')];
  if (!spec.woman || spec.hairStyle === 'long') pieces.push(col(new THREE.SphereGeometry(0.126, 14, 8, 0, Math.PI * 2, 0, spec.hairStyle === 'wild' ? 1.5 : 1.05).translate(0, 0.1, -0.005), HAIR));   // hair cap
  if (spec.hairStyle === 'wild') pieces.push(col(new THREE.SphereGeometry(0.15, 10, 8).scale(1, 0.9, 0.85).translate(0, 0.14, -0.1), HAIR));          // a big mane, swept back off the face
  if (spec.beard === 'full') pieces.push(col(new THREE.SphereGeometry(0.12, 12, 8, 0, Math.PI * 2, 1.35, 1.7).scale(1.05, 1.5, 1.05).translate(0, 0.06, 0.03), HAIR),   // full beard from the ears to the chin
    col(new THREE.BoxGeometry(0.1, 0.02, 0.03).translate(0, 0.068, 0.112), HAIR));                                                       // moustache
  if (spec.beard === 'goatee') pieces.push(col(new THREE.ConeGeometry(0.045, 0.12, 6).rotateX(Math.PI).translate(0, -0.03, 0.09), HAIR), col(new THREE.BoxGeometry(0.1, 0.018, 0.03).translate(0, 0.068, 0.112), HAIR));
  if (spec.glasses) pieces.push(col(new THREE.TorusGeometry(0.03, 0.004, 5, 14).translate(-0.04, 0.115, 0.108), DARK), col(new THREE.TorusGeometry(0.03, 0.004, 5, 14).translate(0.04, 0.115, 0.108), DARK));
  part(mergeGeometries(pieces), head);
  if (spec.hairStyle === 'long') {                                                                    // long hair: down the back and in two locks over the shoulders
    const back = new THREE.Group(); back.position.set(0, 0.1, 0); back.rotation.x = -0.4; head.add(back);   // counter-rotated so it hangs straight down
    part(col(new THREE.CylinderGeometry(0.13, 0.11, 0.62, 12, 1, true, Math.PI - 1.9, 3.8).translate(0, -0.3, 0), HAIR), back);
    part(mergeGeometries([col(limb([-0.115, 0.08, 0.03], [-0.16, -0.32, 0.03], 0.03, 0.022), HAIR), col(limb([0.115, 0.08, 0.03], [0.16, -0.32, 0.03], 0.03, 0.022), HAIR)]), head);
    root.userData.hairBack = back;
  }
  root.userData.fore = fore; root.userData.head = head; root.userData.upper = upper;
  return root;
}
