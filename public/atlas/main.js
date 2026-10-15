import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';

let COL_IN = 0xffb454, COL_ST = 0x4cc9f0, COL_SEL = 0xffffff;   // re-set by applyTheme()
const SKIN = 0xe0b99a;
const THEMES = {   // scene + sign colours; the page chrome is styled by CSS variables under [data-theme] in index.html
  night: { bg: 0x0f1420, ground: 0x1b2233, hemiSky: 0xcfd8ff, hemiGround: 0x1b2233, hemi: 1.1, sun: 1.6, inCol: 0xffb454, stCol: 0x4cc9f0, sel: 0xffffff,
           bld: h => [0.62, 0.18, 0.45 + 0.3 * h], sign: { bg: 'rgba(15,20,32,.88)', fg: '#e8ecf4', border: '#ffb454' },
           mt: 0x26334f, snow: 0xa9b8d6, lake: 0x17375e, shore: 0x2a3550 },
  day:   { bg: 0xcfe6fa, ground: 0xe3e8df, hemiSky: 0xffffff, hemiGround: 0xb9c3b2, hemi: 1.5, sun: 1.9, inCol: 0xe07000, stCol: 0x0a7fb0, sel: 0x111111,
           bld: h => [0.6, 0.2, 0.42 + 0.22 * h], sign: { bg: 'rgba(255,255,255,.93)', fg: '#1b2433', border: '#c2410c' },
           mt: 0x7890ab, snow: 0xffffff, lake: 0x5aa9d6, shore: 0xd9d2b4 },
};
let TH = THEMES.night;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

let city;
const CFG = window.VIEWER_CONFIG || {};   // optional embedding config: { city, title, homeUrl, homeLabel } (see scripts/sync_atlas.py)
if (CFG.title) { document.title = CFG.title; $('title').textContent = CFG.title; }
if (CFG.homeUrl) { const a = document.createElement('a'); a.href = CFG.homeUrl; a.textContent = CFG.homeLabel || 'Home'; a.className = 'home'; $('help').after(a); }
try { city = await (await fetch(`./data/${new URLSearchParams(location.search).get('city') || CFG.city || 'city'}.json`)).json(); }
catch (e) { $('err').style.display = 'grid'; throw e; }

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.prepend(renderer.domElement);

// --- compatibility mode: some GPU/driver/browser combinations draw nothing for InstancedMesh (signs and ground still show).
// A tiny offscreen test decides; ?safe=1 / ?safe=0 or the menu checkbox override it. Safe mode uses one plain Mesh per building / person.
const qp = new URLSearchParams(location.search);
function instancingWorks() {
  try {
    const rt = new THREE.WebGLRenderTarget(8, 8), sc = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
    cam.position.z = 5; sc.add(new THREE.AmbientLight(0xffffff, 3));
    const geo = new THREE.PlaneGeometry(2, 2), n = geo.attributes.position.count, col = new Float32Array(n * 3).fill(1);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const N = 600, im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true }), N), mm = new THREE.Matrix4();
    for (let i = 0; i < N; i++) { im.setMatrixAt(i, mm.makeTranslation(0, 0, i * 0.001)); im.setColorAt(i, new THREE.Color(0x0000ff)); }
    sc.add(im);
    const prev = renderer.getRenderTarget(), px = new Uint8Array(4);
    const draw = () => { renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(sc, cam); renderer.readRenderTargetPixels(rt, 4, 4, 1, 1, px); };
    draw();
    const blueFirst = px[2] > 40 && px[0] < px[2];
    for (let i = 0; i < N; i++) im.setColorAt(i, new THREE.Color(0xff0000)); im.instanceColor.needsUpdate = true;   // what Colour by does at runtime
    draw();
    const redAfter = px[0] > 40 && px[2] < px[0];
    renderer.setRenderTarget(prev); rt.dispose(); geo.dispose(); im.dispose();
    return blueFirst && redAfter;
  } catch (e) { console.warn('instancing test failed', e); return false; }
}
const instOK = instancingWorks();
let storedSafe = null; try { storedSafe = localStorage.getItem('atlasSafe'); } catch (e) {}
const SAFE = qp.has('safe') ? qp.get('safe') !== '0' : storedSafe !== null ? storedSafe === '1' : !instOK;
class SafeInstanced extends THREE.Group {   // the slice of the InstancedMesh API this viewer uses, backed by plain Meshes
  constructor(geometry, material, count, perInstanceColor = false) {
    super();
    this.count = count; this.instanceMatrix = { needsUpdate: false }; this.instanceColor = { needsUpdate: false }; this.perInstanceColor = perInstanceColor;
    this.base = geometry.attributes.color ? geometry.attributes.color.array.slice() : null;
    for (let i = 0; i < count; i++) {
      const g = perInstanceColor ? geometry.clone() : geometry, mesh = new THREE.Mesh(g, material);
      if (perInstanceColor && !g.attributes.color) { this.base = this.base || new Float32Array(g.attributes.position.count * 3).fill(1); g.setAttribute('color', new THREE.BufferAttribute(this.base.slice(), 3)); }
      mesh.matrixAutoUpdate = false; mesh.userData.i = i; this.add(mesh);
    }
  }
  setMatrixAt(i, m) { const o = this.children[i]; o.matrix.copy(m); o.matrixWorldNeedsUpdate = true; }
  setColorAt(i, col) {
    const a = this.children[i].geometry.attributes.color, b = this.base;
    for (let j = 0; j < a.count; j++) { a.array[j * 3] = b[j * 3] * col.r; a.array[j * 3 + 1] = b[j * 3 + 1] * col.g; a.array[j * 3 + 2] = b[j * 3 + 2] * col.b; }
    a.needsUpdate = true;
  }
}
const makeInstanced = (geo, mat, n, perColor = false) => SAFE ? new SafeInstanced(geo, mat, n, perColor) : new THREE.InstancedMesh(geo, mat, n);
const instOf = h => h.instanceId ?? h.object.userData.i;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f1420);
const E = city.extent;
scene.fog = new THREE.Fog(0x0f1420, E * 1.6, E * 4.6);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.5, E * 9);
camera.position.set(E * 0.95, E * 0.55, E * 1.35);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(E / 2, 20, E / 2);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.499;
controls.screenSpacePanning = false;

const hemi = new THREE.HemisphereLight(0xcfd8ff, 0x1b2233, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(E, E * 1.2, -E * 0.3);
scene.add(sun);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(E * 18, E * 18), new THREE.MeshStandardMaterial({ color: 0x1b2233, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.position.set(E / 2, -0.05, E / 2);
scene.add(ground);

// --- scenery: a ring of low-poly mountains and a lake beyond the city. Decoration only: it is never picked or hovered; ?scenery=0 hides it.
const scenery = new THREE.Group();
{
  let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;   // fixed seed: the same skyline every visit
  const mtMat = new THREE.MeshStandardMaterial({ color: 0x26334f, roughness: 1, flatShading: true });
  const snowMat = new THREE.MeshStandardMaterial({ color: 0xa9b8d6, roughness: 1, flatShading: true });
  const lakeMat = new THREE.MeshStandardMaterial({ color: 0x17375e, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.93 });
  const shoreMat = new THREE.MeshStandardMaterial({ color: 0x2a3550, roughness: 1 });
  scenery.userData.mats = { mtMat, snowMat, lakeMat, shoreMat };
  const LA = 3.75, LD = E * 2.05, LRX = E * 0.75, LRZ = E * 0.45;      // lake: direction (rad), distance from the city centre, half-axes of the shore
  const inLake = (x, z) => { const dx = x - E / 2, dz = z - E / 2, u = dx * Math.cos(LA) + dz * Math.sin(LA) - LD, v = -dx * Math.sin(LA) + dz * Math.cos(LA); return (u / (LRX * 1.25)) ** 2 + (v / (LRZ * 1.25)) ** 2 < 1; };
  const peak = (x, z, h, r, seg) => {
    if (inLake(x, z)) return;                                         // no mountains standing in the water
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg, 1), mtMat);
    m.position.set(x, h / 2 - 2, z); m.rotation.y = rnd() * 6.28; scenery.add(m);
    if (h > E * 0.7) {                                               // snow cap on the tall ones: the top 36 % of the cone
      const c = new THREE.Mesh(new THREE.ConeGeometry(r * 0.375, h * 0.36, seg, 1), snowMat);
      c.position.set(x, h * 0.82 - 2, z); c.rotation.y = m.rotation.y; scenery.add(c);
    }
  };
  const N = 44;
  for (let i = 0; i < N; i++) {
    const a = (i + rnd() * 0.8) / N * Math.PI * 2, R = E * (2.75 + rnd() * 0.55), h = E * (0.5 + rnd() * 0.6), r = h * (0.9 + rnd() * 0.5), seg = 5 + Math.floor(rnd() * 3);
    const x = E / 2 + Math.cos(a) * R, z = E / 2 + Math.sin(a) * R;
    peak(x, z, h, r, seg);
    for (const side of [-1, 1]) if (rnd() < 0.7) {                      // foothills either side of the main peak
      const t = a + side * (0.5 * r / R), hh = h * (0.4 + rnd() * 0.3), rr = r * (0.6 + rnd() * 0.3);
      peak(E / 2 + Math.cos(t) * (R - rnd() * E * 0.2), E / 2 + Math.sin(t) * (R - rnd() * E * 0.2), hh, rr, seg);
    }
  }
  const lake = new THREE.Group(); lake.rotation.y = -LA; lake.position.set(E / 2, 0, E / 2); scenery.add(lake);   // south-west of the city: behind it from the default view
  const ellipse = (rx, rz, mat, y) => { const g = new THREE.CircleGeometry(1, 72); g.scale(rx, rz, 1); const m = new THREE.Mesh(g, mat); m.rotation.x = -Math.PI / 2; m.position.set(LD, y, 0); lake.add(m); };
  ellipse(LRX, LRZ, shoreMat, 0.05);
  ellipse(LRX * 0.92, LRZ * 0.86, lakeMat, 0.25);
}
scene.add(scenery);
if (new URLSearchParams(location.search).get('scenery') === '0') scenery.visible = false;

// sim (x, y, z-up) -> three (x, z, y): sim y maps to three z (up is y)
const P = (x, y, z) => new THREE.Vector3(x, z, y);

// --- buildings: one InstancedMesh, unit box with its base on y=0
const B = city.buildings;
// highlight group (city.highlight): these people and buildings are always drawn in one colour, whatever Colour/Shade by says
const HL = city.highlight && { color: city.highlight.color, label: city.highlight.label || 'Highlighted', buildings: new Set(city.highlight.buildings), people: new Set(city.highlight.people.map(id => city.ids.indexOf(id))) };
const boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const bMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false, roughness: .85, vertexColors: SAFE });
const bMesh = makeInstanced(boxGeo, bMat, B.length, true);
const m = new THREE.Matrix4(), c = new THREE.Color(), q = new THREE.Quaternion(), ONE = new THREE.Vector3(1, 1, 1);
const hMax = Math.max(...B.map(b => b.h));
B.forEach((b, i) => {
  m.compose(P((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, 0), q.identity(), new THREE.Vector3(b.x1 - b.x0, b.h, b.y1 - b.y0));
  bMesh.setMatrixAt(i, m);
});
function paintBuildings() {
  B.forEach((b, i) => bMesh.setColorAt(i, HL && HL.buildings.has(i) ? c.set(HL.color) : c.setHSL(...TH.bld(b.h / hMax))));
  bMesh.instanceColor.needsUpdate = true;
}
paintBuildings();
bMesh.renderOrder = 2; // draw after people so x-ray blending shows them
scene.add(bMesh);

// --- signs: name plates floating above each building (only buildings that have a name)
function signTexture(text, sg = TH.sign) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
  const g = cv.getContext('2d'); g.fillStyle = sg.bg; g.fillRect(0, 0, 512, 128);
  g.strokeStyle = sg.border; g.lineWidth = 6; g.strokeRect(3, 3, 506, 122);
  g.fillStyle = sg.fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let size = 54; size >= 22; size -= 2) {
    g.font = `600 ${size}px system-ui, sans-serif`;
    const words = text.split(' '), lines = [''];
    for (const w of words) { const t = (lines.at(-1) + ' ' + w).trim(); if (g.measureText(t).width <= 480 || !lines.at(-1)) lines[lines.length - 1] = t; else lines.push(w); }
    if (lines.length <= 2 && lines.every(l => g.measureText(l).width <= 480) && lines.length * size * 1.15 <= 116) {
      lines.forEach((l, n) => g.fillText(l, 256, 64 + (n - (lines.length - 1) / 2) * size * 1.15)); break;
    }
    if (size === 22) g.fillText(text.slice(0, 30) + '…', 256, 64);
  }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; return tex;
}
const signs = new THREE.Group(); signs.renderOrder = 3;
B.forEach(b => {
  if (!b.name) return;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture(b.name), transparent: true, depthWrite: false }));
  const w = Math.max(18, Math.min(30, (b.x1 - b.x0) * 1.3));
  spr.scale.set(w, w / 4, 1); spr.renderOrder = 3; spr.userData.bi = B.indexOf(b); spr.userData.text = b.name;
  spr.position.copy(P((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.h + w / 8 + 1.5));
  signs.add(spr);
});
scene.add(signs);
$('cbSign').parentElement.style.display = signs.children.length ? '' : 'none';
$('cbSafe').checked = SAFE;
$('cbSafe').oninput = () => { try { localStorage.setItem('atlasSafe', $('cbSafe').checked ? '1' : '0'); } catch (e) {} const u = new URL(location.href); u.searchParams.delete('safe'); location.href = u; };
$('cbSign').oninput = () => { signs.visible = $('cbSign').checked; };

// --- people: a simple human figure (~1.75 m, feet on y=0) built from primitives, drawn as two instanced meshes
function tinted(geo, shade) { // vertex colour = how much of the instance colour this part takes (pants darker than shirt)
  const n = geo.attributes.position.count, a = new Float32Array(n * 3).fill(shade);
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
const cyl = (r0, r1, h, x, y, z, shade, rz = 0) => tinted(new THREE.CylinderGeometry(r0, r1, h, 8).rotateZ(rz).translate(x, y, z), shade);
const bodyGeo = mergeGeometries([
  cyl(0.085, 0.065, 0.82, -0.105, 0.41, 0, 0.35), cyl(0.085, 0.065, 0.82, 0.105, 0.41, 0, 0.35),       // legs
  tinted(new THREE.BoxGeometry(0.42, 0.6, 0.24).translate(0, 1.12, 0), 1),                              // torso
  cyl(0.05, 0.04, 0.62, -0.27, 1.1, 0, 1, 0.12), cyl(0.05, 0.04, 0.62, 0.27, 1.1, 0, 1, -0.12),       // arms
  tinted(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 8).translate(0, 1.47, 0), 0.8),                   // neck
]);
const headGeo = new THREE.SphereGeometry(0.115, 12, 10).translate(0, 1.6, 0);
const people = city.people, ids = city.ids;
const bodyMesh = makeInstanced(bodyGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .7 }), people.length, true);
const headMesh = makeInstanced(headGeo, new THREE.MeshStandardMaterial({ color: SKIN, roughness: .8 }), people.length);
bodyMesh.renderOrder = headMesh.renderOrder = 1;
scene.add(bodyMesh, headMesh);

// --- regalia (city.regalia = { personId: ["crown" | "robe" | "staff"] }): extra instanced parts that follow the wearer
const paint = (geo, hex) => { const col = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let j = 0; j < n; j++) a.set([col.r, col.g, col.b], j * 3); geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo; };
const GOLD = '#ffd23f';
const REGALIA_GEO = {
  crown: mergeGeometries([paint(new THREE.CylinderGeometry(0.15, 0.14, 0.08, 16, 1, true).translate(0, 1.73, 0), GOLD),
    ...Array.from({ length: 6 }, (_, n) => { const a = n * Math.PI / 3; return paint(new THREE.ConeGeometry(0.035, 0.12, 6).translate(Math.cos(a) * 0.145, 1.83, Math.sin(a) * 0.145), GOLD); })]),
  // "college professor": tweed jacket with elbow patches, round glasses, bow tie, a book in the hand
  jacket: mergeGeometries([paint(new THREE.BoxGeometry(0.47, 0.62, 0.29).translate(0, 1.12, 0), '#7b5a3c'),
    paint(new THREE.BoxGeometry(0.46, 0.12, 0.28).translate(0, 0.76, 0), '#6d4f34'),
    paint(new THREE.CylinderGeometry(0.066, 0.056, 0.6, 8).rotateZ(0.12).translate(-0.27, 1.1, 0), '#7b5a3c'),
    paint(new THREE.CylinderGeometry(0.066, 0.056, 0.6, 8).rotateZ(-0.12).translate(0.27, 1.1, 0), '#7b5a3c'),
    paint(new THREE.BoxGeometry(0.03, 0.1, 0.08).translate(-0.318, 0.93, 0), '#b08a57'),
    paint(new THREE.BoxGeometry(0.03, 0.1, 0.08).translate(0.318, 0.93, 0), '#b08a57')]),
  glasses: mergeGeometries([paint(new THREE.TorusGeometry(0.034, 0.006, 6, 16).translate(-0.05, 1.618, 0.106), '#1a1a1a'),
    paint(new THREE.TorusGeometry(0.034, 0.006, 6, 16).translate(0.05, 1.618, 0.106), '#1a1a1a'),
    paint(new THREE.CylinderGeometry(0.004, 0.004, 0.03, 4).rotateZ(Math.PI / 2).translate(0, 1.625, 0.108), '#1a1a1a'),
    paint(new THREE.CylinderGeometry(0.004, 0.004, 0.1, 4).rotateX(Math.PI / 2).translate(-0.11, 1.618, 0.05), '#1a1a1a'),
    paint(new THREE.CylinderGeometry(0.004, 0.004, 0.1, 4).rotateX(Math.PI / 2).translate(0.11, 1.618, 0.05), '#1a1a1a')]),
  bowtie: mergeGeometries([paint(new THREE.SphereGeometry(0.02, 8, 6).translate(0, 1.4, 0.158), '#a0182a'),
    paint(new THREE.ConeGeometry(0.04, 0.075, 8).rotateZ(Math.PI / 2).translate(-0.05, 1.4, 0.158), '#a0182a'),
    paint(new THREE.ConeGeometry(0.04, 0.075, 8).rotateZ(-Math.PI / 2).translate(0.05, 1.4, 0.158), '#a0182a')]),
  book: mergeGeometries([paint(new THREE.BoxGeometry(0.05, 0.24, 0.18).translate(-0.335, 0.8, 0.09), '#7a1f1f'),
    paint(new THREE.BoxGeometry(0.04, 0.22, 0.165).translate(-0.325, 0.8, 0.1), '#efe6c8')]),
  robe: paint(new THREE.CylinderGeometry(0.27, 0.42, 1.38, 16, 1, true).translate(0, 0.74, 0), '#6a1fa8'),
  staff: mergeGeometries([paint(new THREE.CylinderGeometry(0.022, 0.022, 2.0, 8).translate(0.42, 1.0, 0.1), '#7a4a1e'),
    paint(new THREE.SphereGeometry(0.075, 12, 10).translate(0.42, 2.06, 0.1), GOLD)]),
};
const regalia = [];     // { mesh, who: [person index] }
{ const byKind = {};
  for (const [pid, kinds] of Object.entries(city.regalia || {})) { const i = city.ids.indexOf(pid); if (i < 0) continue;
    for (const k of kinds) if (REGALIA_GEO[k]) (byKind[k] ||= []).push(i); }
  for (const [k, who] of Object.entries(byKind)) {
    const mesh = makeInstanced(REGALIA_GEO[k], new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .5, metalness: k === 'robe' ? 0 : .5, side: THREE.DoubleSide }), who.length);
    mesh.renderOrder = 1; mesh.traverse(o => { o.raycast = () => {}; }); mesh.frustumCulled = false; scene.add(mesh); regalia.push({ mesh, who });
  } }

const nIn = people.filter(p => p[3] === 1).length;
$('nIn').textContent = nIn; $('nSt').textContent = people.length - nIn;
let selected = -1;

// --- colour / shade by a categorical variable (dropdowns in the HUD). Every variable maps a person to a category label;
// categories are ranked by head-count, the top 7 get palette colours and the rest are merged into "Other".
const PALETTE = ['#e69f00', '#56b4e9', '#009e73', '#f0e442', '#0072b2', '#d55e00', '#cc79a7'];
const GREY_OTHER = '#8793a8', GREY_NONE = '#4d566b', NONE_RE = /^(No |Unknown|None|Street)/;
const metaOf = i => city.meta?.[ids[i]] || {};
const yearOf = v => { const y = /\d{4}/.exec(String(v ?? '')); return y ? +y[0] : null; };
const bName = new Set(B.map(b => b.name));
const orgsOf = i => new Set((metaOf(i).Relationships || []).filter(r => r.dir === 'out' && bName.has(r.with)).map(r => r.with)).size;
const bucket = (n, edges) => { for (const [lim, lab] of edges) if (n <= lim) return lab; };
const ROLE_GROUPS = [[/author|contributor|writer/, 'Author / contributor'], [/found|donor|patron|grantee|funder/, 'Founder / patron / donor'],
  [/actor|cast|producer|dagny|rearden|galt|francisco|film|movie/, 'Film & cast'],
  [/board|advis|steering|fellow|council|trustee/, 'Board / advisor / fellow'],
  [/staff|officer|employee|ceo|director|manager|president|executive|archivist|key employee|chair/, 'Staff / officer'],
  [/professor|faculty|academic|instructor|speaker|course|teacher|student/, 'Academic / speaker']];
const roleGroup = i => { const r = String(metaOf(i)['Role at org'] || '').toLowerCase(); if (!r) return 'No org role';
  for (const [re, lab] of ROLE_GROUPS) if (re.test(r)) return lab; return 'Other role'; };
const VARS = {
  'Location (inside / street)': i => people[i][3] === 1 ? 'Inside a building' : 'Street',
  'Primary organization': i => people[i][3] === 1 ? B[people[i][5]].name || 'Building ' + people[i][5] : 'Street',
  'Organization category': i => people[i][3] === 1 ? B[people[i][5]].category || 'No category' : 'Street',
  'Role type': roleGroup,
  'Evidence confidence': i => (/\(([^)]+)\)\s*$/.exec(metaOf(i)['Role at org'] || '') || [])[1] || 'No org role',
  'Living / deceased': i => metaOf(i).Died ? 'Deceased' : 'Not recorded as deceased',
  'Birth era': i => { const y = yearOf(metaOf(i).Born); return y == null ? 'Unknown' : y < 1900 ? 'Before 1900' : y < 1950 ? '1900–1949' : y < 1980 ? '1950–1979' : '1980 or later'; },
  'Organizations (count)': i => bucket(orgsOf(i), [[0, 'No orgs'], [1, '1 org'], [2, '2 orgs'], [Infinity, '3+ orgs']]),
  'Relationships (count)': i => bucket((metaOf(i).Relationships || []).length, [[0, 'None'], [1, '1'], [3, '2–3'], [9, '4–9'], [Infinity, '10+']]),
};
const varCache = {};
function variable(name) {            // -> { cat: Int per person, labels[], colors[], counts[] }
  if (varCache[name]) return varCache[name];
  const raw = people.map((_, i) => VARS[name](i)), tally = new Map();
  raw.forEach(v => tally.set(v, (tally.get(v) || 0) + 1));
  const named = [...tally].filter(([k]) => !NONE_RE.test(k) || name.startsWith('Location')).sort((a, b) => b[1] - a[1]);
  const keep = named.slice(0, PALETTE.length).map(([k]) => k), labels = [...keep], colors = keep.map((_, n) => PALETTE[n]);
  if (name.startsWith('Location')) { labels.splice(0, labels.length, 'Inside a building', 'Street'); colors.splice(0, colors.length, '#' + COL_IN.toString(16), '#' + COL_ST.toString(16)); }
  const idx = new Map(labels.map((l, n) => [l, n]));
  const hasOther = raw.some(v => !idx.has(v) && !NONE_RE.test(v)), hasNone = raw.some(v => !idx.has(v) && NONE_RE.test(v));
  if (hasOther) { idx.set('—other', labels.length); labels.push('Other'); colors.push(GREY_OTHER); }
  if (hasNone) { const nv = new Set(raw.filter(v => !idx.has(v) && NONE_RE.test(v))); idx.set('\u2014none', labels.length); labels.push(nv.size === 1 ? [...nv][0] : 'None / unknown'); colors.push(GREY_NONE); }
  const cat = raw.map(v => idx.has(v) ? idx.get(v) : NONE_RE.test(v) ? idx.get('—none') : idx.get('—other'));
  const counts = labels.map((_, n) => cat.filter(c => c === n).length);
  const nNamed = labels.length - (hasOther ? 1 : 0) - (hasNone ? 1 : 0);
  return (varCache[name] = { cat, labels, colors, counts, named: nNamed });
}
let colorVar = null, shadeVar = null;     // variable objects (null = default inside/street colours / no shading)
const shadeAt = (v, n) => n >= v.named ? 0.75 : 1 - 0.55 * n / Math.max(1, v.named - 1);   // Other / none stay mid-bright
const shadeFactor = (v, i) => shadeAt(v, v.cat[i]);
const baseColor = i => {
  if (HL && HL.people.has(i)) return c.set(HL.color);   // fixed colour: ignores Colour by and Shade by
  c.set(colorVar ? colorVar.colors[colorVar.cat[i]] : people[i][3] === 1 ? COL_IN : COL_ST);
  return shadeVar ? c.multiplyScalar(shadeFactor(shadeVar, i)) : c;
};
function fillSelect(sel, withDefault) {
  sel.innerHTML = `<option value="">${withDefault}</option>` + Object.keys(VARS).map(k => `<option>${esc(k)}</option>`).join('');
}
function legend() {
  const rows = [];
  if (colorVar) colorVar.labels.forEach((l, n) => rows.push(`<span><i style="background:${colorVar.colors[n]}"></i>${esc(l)} <em>${colorVar.counts[n]}</em></span>`));
  else rows.push(`<span><i style="background:#${COL_IN.toString(16)}"></i>Inside <em>${nIn}</em></span><span><i style="background:#${COL_ST.toString(16)}"></i>Street <em>${people.length - nIn}</em></span>`);
  if (HL && HL.people.size) rows.push(`<span><i style="background:${HL.color}"></i>${esc(HL.label)} (always) <em>${HL.people.size}</em></span>`);
  if (shadeVar) rows.push(`<div class="sh">Shade (brightest = most common): ${shadeVar.labels.map((l, n) => { const g = Math.round(255 * shadeAt(shadeVar, n)); return `<span><i style="background:rgb(${g},${g},${g})"></i>${esc(l)}</span>`; }).join('')}</div>`);
  $('legend').innerHTML = rows.join('');
}
const UP = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3();
function placeOne(i) {            // matrix of one person from its current people[i] position + heading
  const [x, y, z, kind, heading] = people[i];
  const k = (kind === 1 ? $('cbIn').checked : $('cbSt').checked) ? +$('sz').value : 0.0001;
  m.compose(P(x, y, z), q.setFromAxisAngle(UP, heading * Math.PI / 180), sc.set(k, k, k));
  bodyMesh.setMatrixAt(i, m); headMesh.setMatrixAt(i, m);
  for (const r of regalia) { const n = r.who.indexOf(i); if (n >= 0) { r.mesh.setMatrixAt(n, m); r.mesh.instanceMatrix.needsUpdate = true; } }
}
function layoutPeople() {
  people.forEach((_, i) => {
    placeOne(i);
    bodyMesh.setColorAt(i, i === selected ? c.set(COL_SEL) : baseColor(i));
  });
  for (const mesh of [bodyMesh, headMesh]) { mesh.instanceMatrix.needsUpdate = true; mesh.boundingSphere = null; mesh.boundingBox = null; }
  bodyMesh.instanceColor.needsUpdate = true;
  placeRing();
}
// selection ring at the feet + a translucent beam so the person can be spotted from afar
const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, E, 12, 1, true).translate(0, E / 2, 0),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
beam.renderOrder = 4; beam.visible = false; scene.add(beam);
const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }));
ring.renderOrder = 5; ring.visible = false; scene.add(ring);
function placeRing() {
  ring.visible = beam.visible = selected >= 0;
  if (selected < 0) return;
  const [x, y, z] = people[selected], s = +$('sz').value;
  ring.position.copy(P(x, y, z)).y += 0.03; ring.scale.setScalar(s);
  beam.position.copy(P(x, y, z));
}

$('op').oninput = e => { const v = +e.target.value; bMat.opacity = v; bMat.depthWrite = v > 0.95; bMat.needsUpdate = true; };
['sz', 'cbIn', 'cbSt'].forEach(id => $(id).oninput = layoutPeople);

// --- selection card
const linkify = s => /^https?:\/\//i.test(s) ? `<a href="${esc(s)}" target="_blank" rel="noopener noreferrer">${esc(s)}</a>` : esc(s);
function relHtml(r) {   // one relationships row: "Type -> who (dates) . confidence" + evidence + source link
  const dates = r.start_date || r.end_date ? ` (${esc(r.start_date || '?')}\u2013${esc(r.end_date || 'present')})` : '';
  return `<div class="rel"><b>${esc(r.type)}</b> ${r.dir === 'in' ? '\u2190' : '\u2192'} ${esc(r.with)}${dates}` +
    (r.confidence ? ` \u00b7 <i>${esc(r.confidence)}</i>` : '') +
    (r.evidence ? `<div class="ev">${esc(r.evidence)}</div>` : '') +
    (r.source_url ? `<div class="ev">${linkify(r.source_url)}</div>` : '') + `</div>`;
}
function showCard(i) {
  const [x, y, z, kind, , bidStored] = people[i], id = ids[i], meta = city.meta?.[id] || {};
  const nameKey = Object.keys(meta).find(k => k.toLowerCase() === 'name');
  const rows = [];
  if (kind === 1) {
    const bid = bidStored ?? +id.slice(1, id.indexOf('-')), b = B[bid];
    rows.push(['Location', `${b.name ? esc(b.name) + ', ' : 'Building ' + bid + ', '}floor ${Math.round(z / city.floor_h) + 1} of ${b.floors}`]);
  } else rows.push(['Location', 'Street']);
  const wk = walkers.find(w => w.i === i);
  if (wk) { if (wk.phase === 'walk') rows[0] = ['Location', 'Walking to ' + esc(B[wk.route[wk.path.next]].name || 'building ' + wk.route[wk.path.next])];
    rows.push(['Walks between', wk.route.map(b => esc(B[b].name || 'Building ' + b)).join(' \u2194 ')]); }
  for (const [k, v] of Object.entries(meta)) if (k !== nameKey && k !== 'Relationships') rows.push([k, linkify(String(v))]);
  const rels = Array.isArray(meta.Relationships) ? meta.Relationships : [];
  if (Object.keys(meta).length <= (nameKey ? 1 : 0) && !rels.length) rows.push(['Metadata', 'none yet']);
  $('card').innerHTML = `<h2><span>${esc(nameKey ? meta[nameKey] : 'Person')}</span><button id="x" aria-label="Close">\u2715</button></h2><table>` +
    rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('') + `</table>` +
    (rels.length ? `<h3>Relationships (${rels.length})</h3>${rels.map(relHtml).join('')}` : '');
  $('card').style.display = 'block'; $('card').scrollTop = 0;
  $('x').onclick = () => select(-1);
}
// building selection: white outline + card listing everyone inside (click a name to jump to them)
const outline = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeo), new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }));
outline.renderOrder = 6; outline.visible = false; scene.add(outline);
function selectBuilding(bi) {
  const b = B[bi], inside = [];
  people.forEach((p, i) => { if (p[3] === 1 && p[5] === bi) inside.push(i); });
  const nm = i => city.meta?.[ids[i]]?.Name || ids[i];
  inside.sort((a, c) => nm(a).localeCompare(nm(c)));
  selected = -1; layoutPeople();
  outline.position.copy(P((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, 0)); outline.scale.set(b.x1 - b.x0, b.h, b.y1 - b.y0); outline.visible = true;
  const rows = [['Floors', `${b.floors} (${b.h} m)`], ['People inside', inside.length]];
  if (b.alias) rows.unshift(['Also known as', esc(b.alias)]);
  if (b.short && b.short !== b.name) rows.unshift(['Short name', esc(b.short)]);
  if (b.category) rows.unshift(['Category', esc(b.category)]);
  $('card').innerHTML = `<h2><span>${esc(b.name || 'Building ' + b.id)}</span><button id="x" aria-label="Close">\u2715</button></h2><table>` +
    rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('') + `</table>` +
    (inside.length ? `<h3>People inside (${inside.length})</h3>${inside.map(i => `<div class="rel member" data-pi="${i}">${esc(nm(i))}</div>`).join('')}` : '');
  $('card').style.display = 'block'; $('card').scrollTop = 0;
  $('x').onclick = () => select(-1);
  $('card').querySelectorAll('[data-pi]').forEach(d => d.onclick = () => { select(+d.dataset.pi); flyTo(+d.dataset.pi); });
}
function select(i) {
  selected = i; outline.visible = false;
  if (i < 0) $('card').style.display = 'none'; else showCard(i);
  layoutPeople();
}
fillSelect($('colorBy'), 'Inside / street (default)'); fillSelect($('shadeBy'), 'None');
$('colorBy').onchange = () => { colorVar = $('colorBy').value ? variable($('colorBy').value) : null; legend(); layoutPeople(); };
$('shadeBy').onchange = () => { shadeVar = $('shadeBy').value ? variable($('shadeBy').value) : null; legend(); layoutPeople(); };
// defaults: colour = role type (Peikoffs always red), no shading (override: ?colorBy=..&shadeBy=..)
for (const [sel, key, dflt] of [['colorBy', 'colorBy', 'Role type'], ['shadeBy', 'shadeBy', '']]) {
  const want = new URLSearchParams(location.search).get(key) ?? CFG[key] ?? dflt;
  if (VARS[want] && variable(want).labels.length >= 3) $(sel).value = want;
}
colorVar = $('colorBy').value ? variable($('colorBy').value) : null; shadeVar = $('shadeBy').value ? variable($('shadeBy').value) : null;
legend();
layoutPeople();

// --- theme: night / day (URL ?theme=day|night, remembered per browser, else follows the system setting)
function applyTheme(name) {
  TH = THEMES[name] || THEMES.night;
  document.documentElement.dataset.theme = name;
  scene.background.set(TH.bg); scene.fog.color.set(TH.bg);
  ground.material.color.set(TH.ground);
  { const m = scenery.userData.mats; m.mtMat.color.set(TH.mt); m.snowMat.color.set(TH.snow); m.lakeMat.color.set(TH.lake); m.shoreMat.color.set(TH.shore); }
  hemi.color.set(TH.hemiSky); hemi.groundColor.set(TH.hemiGround); hemi.intensity = TH.hemi; sun.intensity = TH.sun;
  COL_IN = TH.inCol; COL_ST = TH.stCol; COL_SEL = TH.sel;
  ring.material.color.set(TH.sel); beam.material.color.set(TH.sel); outline.material.color.set(TH.sel);
  paintBuildings();
  for (const spr of signs.children) { spr.material.map.dispose(); spr.material.map = signTexture(spr.userData.text); spr.material.needsUpdate = true; }
  for (const k of Object.keys(varCache)) delete varCache[k];            // the Location palette uses the theme colours
  colorVar = $('colorBy').value ? variable($('colorBy').value) : null; shadeVar = $('shadeBy').value ? variable($('shadeBy').value) : null;
  legend(); layoutPeople();
  $('theme').value = name;
}
{
  let saved = null; try { saved = localStorage.getItem('viewerTheme'); } catch {}
  const asked = new URLSearchParams(location.search).get('theme') || CFG.theme || saved;
  applyTheme(THEMES[asked] ? asked : matchMedia('(prefers-color-scheme: light)').matches ? 'day' : 'night');
  $('theme').onchange = () => { applyTheme($('theme').value); try { localStorage.setItem('viewerTheme', $('theme').value); } catch {} };
}

// --- search: find a person by name (also pen/birth/married names, nicknames, id) and fly to them
const fold = t => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const NAME_KEYS = ['name', 'pen name', 'birth name', 'married name', 'nicknames'];
const index = people.map((_, i) => {
  const meta = city.meta?.[ids[i]] || {}, names = [];
  for (const [k, v] of Object.entries(meta)) if (NAME_KEYS.includes(k.toLowerCase()) && v) names.push(String(v));
  return { i, label: names[0] || ids[i], hay: fold([...names, ids[i]].join(' | ')) };
});
B.forEach((b, bi) => {
  if (b.name) index.push({ b: bi, label: b.name, hay: fold([b.name, b.alias, b.short, b.category].filter(Boolean).join(' | ')) });
});
let fly = null;
function flyToBuilding(bi) {
  const b = B[bi], tgt = P((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.h * 0.45), dist = Math.max(60, b.h * 1.3 + 40);
  const dir = camera.position.clone().sub(controls.target).setY(0);
  if (dir.lengthSq() < 1e-6) dir.set(1, 0, 1);
  dir.normalize().multiplyScalar(dist).setY(Math.max(30, b.h * 0.7));
  fly = { t: 0, fromT: controls.target.clone(), fromC: camera.position.clone(), toT: tgt, toC: tgt.clone().add(dir) };
}
function flyTo(i) {
  const [x, y, z, kind] = people[i];
  if (kind === 1 ? !$('cbIn').checked : !$('cbSt').checked) { $(kind === 1 ? 'cbIn' : 'cbSt').checked = true; }
  if (bMat.opacity > 0.3) { $('op').value = 0.3; $('op').oninput({ target: $('op') }); } // x-ray so the person is visible inside
  const tgt = P(x, y, z).add(new THREE.Vector3(0, 1, 0)), dir = camera.position.clone().sub(controls.target).setY(0);
  if (dir.lengthSq() < 1e-6) dir.set(1, 0, 1);
  dir.normalize().multiplyScalar(30).setY(18);
  fly = { t: 0, fromT: controls.target.clone(), fromC: camera.position.clone(), toT: tgt, toC: tgt.clone().add(dir) };
}
function stepFly(dt) {
  if (!fly) return;
  fly.t = Math.min(1, fly.t + dt / 1.2);
  const k = fly.t * fly.t * (3 - 2 * fly.t);
  controls.target.lerpVectors(fly.fromT, fly.toT, k); camera.position.lerpVectors(fly.fromC, fly.toC, k);
  if (fly.t >= 1) fly = null;
}
const box = $('q'), list = $('results');
let hits = [], active = 0;
const rank = (hay, t) => hay.startsWith(t) ? 0 : hay.includes(' ' + t) ? 1 : hay.includes(t) ? 2 : 3; // name start > word start > anywhere
function renderResults() {
  const t = fold(box.value.trim());
  hits = t ? index.filter(r => t.split(/\s+/).every(w => r.hay.includes(w))).map(r => ({ r, s: rank(r.hay, t) })).sort((a, b) => a.s - b.s || a.r.label.localeCompare(b.r.label)).map(o => o.r) : [];
  active = 0;
  list.innerHTML = hits.slice(0, 8).map((r, n) => {
    const where = r.b !== undefined ? `Building \u00b7 ${city.counts[B[r.b].id] ?? 0} people`
      : people[r.i][3] === 1 ? (B[people[r.i][5]]?.name || 'Building ' + people[r.i][5]) : 'Street';
    return `<div data-n="${n}" class="${n === 0 ? 'on' : ''}"><b>${esc(r.label)}</b><span>${esc(where)}</span></div>`;
  }).join('') + (hits.length > 8 ? `<div class="more">${hits.length - 8} more – keep typing</div>` : '') +
    (t && !hits.length ? '<div class="more">No match</div>' : '');
  list.style.display = t ? 'block' : 'none';
}
function pick(n) {
  const r = hits[n]; if (!r) return;
  box.value = r.label; list.style.display = 'none'; box.blur();
  if (r.b !== undefined) { selectBuilding(r.b); flyToBuilding(r.b); } else { select(r.i); flyTo(r.i); }
}
box.addEventListener('input', renderResults);
box.addEventListener('focus', renderResults);
box.addEventListener('keydown', e => {
  e.stopPropagation(); // keep WASD / Escape handlers from firing while typing
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); const shown = Math.min(hits.length, 8); if (!shown) return;
    active = (active + (e.key === 'ArrowDown' ? 1 : shown - 1)) % shown;
    [...list.children].forEach((c, n) => c.classList.toggle('on', n === active));
  } else if (e.key === 'Enter') pick(active);
  else if (e.key === 'Escape') { list.style.display = 'none'; box.blur(); }
});
box.addEventListener('keyup', e => e.stopPropagation());
list.addEventListener('mousedown', e => { const d = e.target.closest('[data-n]'); if (d) { e.preventDefault(); pick(+d.dataset.n); } });
addEventListener('keydown', e => { if (e.key === '/' && document.activeElement !== box) { e.preventDefault(); box.focus(); box.select(); } });

// --- walking: people linked to 2+ orgs (city.routes) stroll between their buildings along the street grid
const FOOTP = B[0].x1 - B[0].x0;
const PITCHP = (() => { const xs = [...new Set(B.map(b => (b.x0 + b.x1) / 2))].sort((a, b) => a - b); let d = Infinity; for (let n = 1; n < xs.length; n++) d = Math.min(d, xs[n] - xs[n - 1]); return isFinite(d) ? d : 36; })();
const walkers = [];
for (const [pid, route] of Object.entries(city.routes || {})) {
  const i = ids.indexOf(pid); if (i < 0 || people[i][3] !== 1) continue;
  walkers.push({ i, route, k: 0, phase: 'dwell', wait: Math.random() * 8, off: Math.random() < .5 ? 3 : -3, path: null });
}
$('nWalk').textContent = walkers.length;
$('walkRow').style.display = walkers.length ? '' : 'none';
const rnd = (a, b) => a + Math.random() * (b - a), sign = v => v < 0 ? -1 : 1;
function planPath(w) {            // door -> sidewalk -> street lattice -> sidewalk -> door of the next building
  const i = w.i, A = B[w.route[w.k]], nk = (w.k + 1) % w.route.length, T = B[w.route[nk]], o = w.off;
  const [x, y, z] = people[i], acx = (A.x0 + A.x1) / 2, acy = (A.y0 + A.y1) / 2, tcx = (T.x0 + T.x1) / 2, tcy = (T.y0 + T.y1) / 2;
  const corner = (cx, cy, toX, toY) => [(Math.round(cx / PITCHP - 0.5) + (toX >= cx ? 1 : 0)) * PITCHP, (Math.round(cy / PITCHP - 0.5) + (toY >= cy ? 1 : 0)) * PITCHP];
  const [ax, ay] = corner(acx, acy, tcx, tcy), [bx, by] = corner(tcx, tcy, acx, acy);
  const tx = rnd(T.x0 + 1, T.x1 - 1), ty = rnd(T.y0 + 1, T.y1 - 1), tz = Math.floor(rnd(0, T.floors)) * city.floor_h;
  const pts = [[x, y, z], [ax + o, y, 0], [ax + o, ay + o, 0], [bx + o, ay + o, 0], [bx + o, by + o, 0], [bx + o, ty, 0], [tx, ty, tz]];
  const segs = [];
  let total = 0;
  for (let n = 1; n < pts.length; n++) { const d = Math.hypot(pts[n][0] - pts[n - 1][0], pts[n][1] - pts[n - 1][1]); segs.push(d); total += d; }
  w.path = { pts, segs, total, d: 0, next: nk };
}
function stepWalkers(dt) {
  if (!walkers.length || !$('cbWalk').checked) return;
  const speed = +$('walkSpeed').value;
  for (const w of walkers) {
    const p = people[w.i];
    if (w.phase === 'dwell') {
      w.wait -= dt;
      if (w.wait <= 0) { planPath(w); w.phase = 'walk'; }
      continue;
    }
    const P_ = w.path; P_.d = Math.min(P_.total, P_.d + speed * dt);
    let n = 0, rem = P_.d;
    while (n < P_.segs.length - 1 && rem > P_.segs[n]) { rem -= P_.segs[n]; n++; }
    const f = P_.segs[n] > 0 ? rem / P_.segs[n] : 1, a = P_.pts[n], b = P_.pts[n + 1];
    p[0] = a[0] + (b[0] - a[0]) * f; p[1] = a[1] + (b[1] - a[1]) * f;
    p[2] = a[2] + (b[2] - a[2]) * f;                       // floors <-> ground only on the first / last leg (a[2], b[2] are 0 elsewhere)
    if (b[0] !== a[0] || b[1] !== a[1]) p[4] = Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI;
    if (P_.d >= P_.total) { w.k = P_.next; p[5] = w.route[w.k]; w.phase = 'dwell'; w.wait = rnd(4, 14); w.path = null; }
    placeOne(w.i);
  }
  bodyMesh.instanceMatrix.needsUpdate = headMesh.instanceMatrix.needsUpdate = true;
  bodyMesh.boundingSphere = headMesh.boundingSphere = null;
  if (selected >= 0 && walkers.some(w => w.i === selected)) placeRing();
}

// --- picking (people first; buildings only block a person when they are (nearly) opaque)
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), tip = $('tip');
function setRay(e) {
  mouse.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, camera);
}
function pickSign() {   // a building's name plate (floats above the roof)
  if (!signs.visible) return -1;
  const hit = ray.intersectObjects(signs.children)[0];
  return hit ? hit.object.userData.bi : -1;
}
function pickPerson() {
  const hit = ray.intersectObjects([bodyMesh, headMesh], true)[0];
  if (!hit) return -1;
  if (bMat.opacity > 0.95) { const wall = ray.intersectObject(bMesh, true)[0]; if (wall && wall.distance < hit.distance) return -1; }
  return instOf(hit);
}
let down = null;
const el = renderer.domElement;
el.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
el.addEventListener('pointerup', e => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) { down = null; return; } // it was a drag
  down = null; setRay(e);
  const pi = pickPerson(), sg = pi < 0 ? pickSign() : -1, bh = pi < 0 && sg < 0 && ray.intersectObject(bMesh, true)[0];
  if (pi >= 0) select(pi); else if (sg >= 0) selectBuilding(sg); else if (bh) selectBuilding(instOf(bh)); else select(-1);
});
let pending = null;
el.addEventListener('pointermove', e => {
  if (e.buttons) { tip.style.display = 'none'; return; }
  pending = e;
});
function hover() {
  const e = pending; pending = null;
  if (!e) return;
  setRay(e);
  const pi = pickPerson();
  el.style.cursor = pi >= 0 || pickSign() >= 0 ? 'pointer' : '';
  const hit = pi < 0 && ray.intersectObject(bMesh, true)[0];
  if (!hit) { tip.style.display = 'none'; return; }
  const b = B[instOf(hit)];
  tip.innerHTML = (b.name ? `<b>${esc(b.name)}</b>${b.category ? ' · ' + esc(b.category) : ''}` : `Building <b>${b.id}</b>`) +
    `<br>${b.floors} floors · ${b.h} m<br>${city.counts[b.id] ?? 0} people inside`;
  tip.style.left = e.clientX + 14 + 'px'; tip.style.top = e.clientY + 14 + 'px'; tip.style.display = 'block';
}
addEventListener('keydown', e => { if (e.key === 'Escape') select(-1); });

// --- WASD / arrows move camera + target along the ground plane
const keys = new Set();
addEventListener('keydown', e => keys.add(e.key.toLowerCase()));
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
function move(dt) {
  const speed = controls.getDistance() * 0.8 * dt;
  camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  right.crossVectors(fwd, up);
  const d = new THREE.Vector3();
  if (keys.has('w') || keys.has('arrowup')) d.add(fwd);
  if (keys.has('s') || keys.has('arrowdown')) d.sub(fwd);
  if (keys.has('d') || keys.has('arrowright')) d.add(right);
  if (keys.has('a') || keys.has('arrowleft')) d.sub(right);
  if (d.lengthSq()) { d.normalize().multiplyScalar(speed); camera.position.add(d); controls.target.add(d); }
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
let last = performance.now();
renderer.setAnimationLoop(t => { const dt = Math.min((t - last) / 1000, 0.1); move(dt); stepFly(dt); stepWalkers(dt); last = t; hover(); controls.update(); renderer.render(scene, camera); });

// small hook for automated screenshots/tests
window.__viewer = { walkers, stepWalkers, planPath, signScreen(n) { const spr = signs.children[n], v = spr.position.clone().project(camera); return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, name: B[spr.userData.bi].name }; }, camera, controls, select, selectBuilding, flyToBuilding, ids, people, flyTo, search: q => { box.value = q; renderResults(); return hits.map(h => h.label); },
  screenOf(i) { const v = P(...people[i].slice(0, 3)).add(new THREE.Vector3(0, 0.9 * +$('sz').value, 0)).project(camera);
    return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight }; } };
window.__ready = true;

// ?debug=1 -> on-page diagnostics (GPU, draw stats, culling, shader errors) for "nothing renders" reports
if (new URLSearchParams(location.search).has('debug')) {
  const box = document.createElement('pre'), errs = [];
  box.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:50;margin:0;padding:8px 10px;max-width:70vw;max-height:45vh;overflow:auto;background:#000c;color:#9f9;font:11px/1.35 monospace;border-radius:6px;white-space:pre-wrap';
  document.body.append(box);
  addEventListener('error', e => errs.push('JS error: ' + e.message));
  addEventListener('unhandledrejection', e => errs.push('Promise: ' + e.reason));
  renderer.debug.onShaderError = (gl, program) => errs.push('SHADER ERROR: ' + (gl.getProgramInfoLog(program) || '').slice(0, 400));
  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4();
  setInterval(() => {
    const gl = renderer.getContext(), x = gl.getExtension('WEBGL_debug_renderer_info');
    camera.updateMatrixWorld(); pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(pv);
    const inView = mesh => mesh.boundingSphere ? frustum.intersectsSphere(new THREE.Sphere().copy(mesh.boundingSphere).applyMatrix4(mesh.matrixWorld)) : 'no sphere yet';
    box.textContent = [
      'WebGL ' + (renderer.capabilities.isWebGL2 ? '2' : '1') + ' | ' + gl.getParameter(gl.VERSION),
      'mode: ' + (SAFE ? 'compatibility (plain meshes)' : 'instanced') + ' | instancing self-test: ' + (instOK ? 'pass' : 'FAIL'),
      'GPU: ' + (x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : 'n/a') + ' | maxTex ' + gl.getParameter(gl.MAX_TEXTURE_SIZE),
      'drawn last frame: calls ' + renderer.info.render.calls + ', triangles ' + renderer.info.render.triangles + ', textures ' + renderer.info.memory.textures,
      'buildings: count ' + bMesh.count + ', visible ' + bMesh.visible + ', in frustum ' + inView(bMesh) + ', sphere r ' + (bMesh.boundingSphere?.radius ?? 'null').toString().slice(0, 7),
      'people: count ' + bodyMesh.count + ', visible ' + bodyMesh.visible + ', in frustum ' + inView(bodyMesh) + ', sphere r ' + (bodyMesh.boundingSphere?.radius ?? 'null').toString().slice(0, 7),
      'camera ' + camera.position.toArray().map(v => v.toFixed(0)) + ' far ' + camera.far.toFixed(0) + ' | canvas ' + renderer.domElement.width + 'x' + renderer.domElement.height + ' dpr ' + devicePixelRatio,
      'opacity ' + bMat.opacity + ' | size slider ' + $('sz').value + ' | in/street ' + $('cbIn').checked + '/' + $('cbSt').checked,
      ...errs.slice(-5),
    ].join('\n');
  }, 1000);
}
