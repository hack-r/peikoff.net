import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';
import { createMusic } from './music.js';
import { createChat, isDoubleTap, LONG_PRESS_MS, LONG_PRESS_PX } from './chat.js';
import { createMinimap } from './minimap.js';
import { smileMouth } from './kira-face.js';
import { BRIDGE, deckHeight, makeWetGrid, wetStretches, streamFrame, makeBridge, deckHeightAt, nearestDry, findPath, withHeights, wetOnSegment } from './bridges.js';
import { loadFigure3d, figureActive, fitScale } from './figures.js';
import { makeArch, planLegs, planEventLegs } from './paths.js';
import { loadBuilding, loadFigure, loadRaw, loadScene, tintLargeFaces, dropTriangles, withRoof } from './models.js';
let modelsJson = null;   // models/models.json says which ready-made .glb files (if any) to use; no file named, no request, no 404
const modelFile = async key => { try { modelsJson ||= fetch(new URL('./models/models.json', import.meta.url)).then(r => r.json()); const f = (await modelsJson)[key]; return f ? new URL('./models/' + f, import.meta.url).href : null; } catch (e) { return null; } };

let COL_IN = 0xffb454, COL_ST = 0x4cc9f0, COL_SEL = 0xffffff;   // re-set by applyTheme()
const SKIN = 0xe0b99a;
const THEMES = {   // scene + sign colors; the page chrome is styled by CSS variables under [data-theme] in index.html
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
    for (let i = 0; i < N; i++) im.setColorAt(i, new THREE.Color(0xff0000)); im.instanceColor.needsUpdate = true;   // what Color by does at runtime
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
const bridges = []; let waterGrid = null;      // bridges over the streams (planned and built once the places exist; see water() and withBridges() below)
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
const eggs = [];       // Easter eggs: scenery-only things you can find, hover and click (never searchable, never a row in the data)
const eggMeshes = [];
const mountains = [];  // the mountain cones, so a click or hover cannot reach an egg hidden behind one
{
  let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;   // fixed seed: the same skyline every visit
  const mtMat = new THREE.MeshStandardMaterial({ color: 0x26334f, roughness: 1, flatShading: true });
  const snowMat = new THREE.MeshStandardMaterial({ color: 0xa9b8d6, roughness: 1, flatShading: true });
  const lakeMat = new THREE.MeshStandardMaterial({ color: 0x17375e, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.93 });
  const shoreMat = new THREE.MeshStandardMaterial({ color: 0x2a3550, roughness: 1 });
  scenery.userData.mats = { mtMat, snowMat, lakeMat, shoreMat };
  const LA = 3.75, LD = E * 2.05, LRX = E * 0.75, LRZ = E * 0.45;      // lake: direction (rad), distance from the city center, half-axes of the shore
  const inLake = (x, z) => { const dx = x - E / 2, dz = z - E / 2, u = dx * Math.cos(LA) + dz * Math.sin(LA) - LD, v = -dx * Math.sin(LA) + dz * Math.cos(LA); return (u / (LRX * 1.25)) ** 2 + (v / (LRZ * 1.25)) ** 2 < 1; };
  const passHalf = r => r * 0.55 + E * 0.06;                            // the pass: ring mountains keep clear of the inflow so the stream can be seen coming down
  const inPass = (x, z, r) => { const dx = x - E / 2, dz = z - E / 2, u = dx * Math.cos(LA) + dz * Math.sin(LA), v = -dx * Math.sin(LA) + dz * Math.cos(LA); return u > E * 2.2 && Math.abs(v) < passHalf(r); };
  const peaks = [];                                                  // every mountain cone (x, z, height, radius): the cottages find the slope under them from this
  const peak = (x, z, h, r, seg, wall = false) => {
    if (inLake(x, z)) return false;                                   // no mountains standing in the water
    if (!wall && inPass(x, z, r)) return false;
    peaks.push({ x, z, h, r });
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg, 1), mtMat);
    m.position.set(x, h / 2 - 2, z); m.rotation.y = rnd() * 6.28; scenery.add(m); mountains.push(m);
    if (h > E * 0.7) {                                               // snow cap on the tall ones: the top 36 % of the cone
      const c = new THREE.Mesh(new THREE.ConeGeometry(r * 0.375, h * 0.36, seg, 1), snowMat);
      c.position.set(x, h * 0.82 - 2, z); c.rotation.y = m.rotation.y; scenery.add(c);
    }
    return true;
  };
  const N = 44; let far = null;                                      // far = the main peak furthest from the city (home of the Easter egg below)
  for (let i = 0; i < N; i++) {
    const a = (i + rnd() * 0.8) / N * Math.PI * 2, R = E * (2.75 + rnd() * 0.55), h = E * (0.5 + rnd() * 0.6), r = h * (0.9 + rnd() * 0.5), seg = 5 + Math.floor(rnd() * 3);
    const x = E / 2 + Math.cos(a) * R, z = E / 2 + Math.sin(a) * R;
    if (peak(x, z, h, r, seg) && h > E * 0.8 && (!far || R > far.R)) far = { x, z, h, R, r };    // furthest of the tall (snow-capped) peaks, so she stays visible above the nearer ring
    for (const side of [-1, 1]) if (rnd() < 0.7) {                      // foothills either side of the main peak
      const t = a + side * (0.5 * r / R), hh = h * (0.4 + rnd() * 0.3), rr = r * (0.6 + rnd() * 0.3);
      peak(E / 2 + Math.cos(t) * (R - rnd() * E * 0.2), E / 2 + Math.sin(t) * (R - rnd() * E * 0.2), hh, rr, seg);
    }
  }
  // --- Easter egg: Kira Peikoff, an NPC princess, sits on a ledge on the far (back) slope of the most distant tall mountain writing a book, hidden from the city side. Scenery only: she is
  // not a row in the data, so she is never searchable, selectable or hoverable (the name over her head is just a sprite). She is built at human
  // scale (1.75 units standing) and scaled up so a sharp-eyed visitor can spot her.
  if (far) {
    const col = (geo, hex) => { const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
      for (let j = 0; j < n; j++) a.set([c.r, c.g, c.b], j * 3); geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo; };
    const PINK = '#f08cc0', GOLD_ = '#ffd23f', SKIN_ = '#f2c7a5', HAIR = '#4a2e1a';
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide });
    const part = (geo, parent) => { const m = new THREE.Mesh(geo, mat); parent.add(m); return m; };
    const princess = new THREE.Group(), upper = new THREE.Group(), armR = new THREE.Group(), hairBack = new THREE.Group();
    princess.add(upper); upper.position.y = -0.52;                                    // sitting: everything above the lap drops half a metre
    const gown = part(mergeGeometries([                                             // gown pooled around her on the rock, gold hem (stretched to the ground when she stands)
      col(new THREE.CylinderGeometry(0.2, 0.5, 0.56, 20, 1, true).translate(0, 0.28, 0), PINK),
      col(new THREE.TorusGeometry(0.5, 0.017, 6, 24).rotateX(Math.PI / 2).translate(0, 0.02, 0), GOLD_)]), princess);
    upper.add(armR, hairBack);
    part(mergeGeometries([                                                          // bodice, sash, shoulders, left arm (resting on the book), head, face, hair, crown
      col(new THREE.CylinderGeometry(0.15, 0.13, 0.4, 12).translate(0, 1.28, 0), '#f4a6d0'),
      col(new THREE.CylinderGeometry(0.152, 0.152, 0.05, 12).translate(0, 1.1, 0), GOLD_),
      col(new THREE.SphereGeometry(0.065, 8, 6).translate(-0.19, 1.43, 0), PINK),
      col(new THREE.CylinderGeometry(0.04, 0.035, 0.46, 8).rotateX(-1.15).translate(-0.2, 1.22, 0.2), SKIN_),
      col(new THREE.SphereGeometry(0.115, 14, 10).translate(0, 1.62, 0), SKIN_),
      col(new THREE.SphereGeometry(0.017, 8, 6).translate(-0.04, 1.625, 0.102), '#2f7be0'), col(new THREE.SphereGeometry(0.017, 8, 6).translate(0.04, 1.625, 0.102), '#2f7be0'),   // blue eyes,
      col(new THREE.SphereGeometry(0.007, 6, 4).translate(-0.04, 1.625, 0.117), '#0a0a14'), col(new THREE.SphereGeometry(0.007, 6, 4).translate(0.04, 1.625, 0.117), '#0a0a14'),   // with pupils
      col(new THREE.TorusGeometry(0.03, 0.0055, 5, 14, Math.PI).rotateZ(Math.PI).translate(0, 1.585, 0.103), '#c0405a'),   // a smile: the lower half of a ring
      col(new THREE.SphereGeometry(0.125, 14, 8, 0, Math.PI * 2, 0, 1.0).translate(0, 1.62, 0), HAIR),                 // hair on top, with a fringe
      col(new THREE.CylinderGeometry(0.12, 0.12, 0.05, 14, 1, true).translate(0, 1.76, 0), GOLD_),
      ...Array.from({ length: 5 }, (_, n) => { const a = n * Math.PI * 2 / 5; return col(new THREE.ConeGeometry(0.03, 0.1, 5).translate(Math.cos(a) * 0.115, 1.83, Math.sin(a) * 0.115), GOLD_); })]), upper);
    const book = new THREE.Group(), flap = new THREE.Group(); book.position.set(0, 1.06, 0.34); flap.position.y = 0.04; book.add(flap); upper.add(book);   // the book open on her lap; its right half (flap) folds over onto the left to close it
    part(mergeGeometries([col(new THREE.BoxGeometry(0.15, 0.025, 0.22).translate(-0.075, 0, 0), '#6b3b1f'), col(new THREE.BoxGeometry(0.13, 0.02, 0.2).rotateZ(0.12).translate(-0.075, 0.025, 0), '#f3ecd6')]), book);            // left cover and page
    part(mergeGeometries([col(new THREE.BoxGeometry(0.15, 0.025, 0.22).translate(0.075, -0.04, 0), '#6b3b1f'), col(new THREE.BoxGeometry(0.13, 0.02, 0.2).rotateZ(-0.12).translate(0.075, -0.015, 0), '#f3ecd6')]), flap);    // right cover and page
    part(col(new THREE.CylinderGeometry(0.126, 0.09, 0.55, 14, 1, true, Math.PI - 1.7, 3.4).translate(0, -0.27, 0), HAIR), hairBack);   // long hair down the back (swings from the head)
    hairBack.position.set(0, 1.62, 0);
    part(mergeGeometries([col(new THREE.SphereGeometry(0.065, 8, 6), PINK), col(new THREE.CylinderGeometry(0.04, 0.035, 0.5, 8).translate(0, -0.25, 0), SKIN_),   // right arm: a pivot at the shoulder, holding a pen
      col(new THREE.CylinderGeometry(0.006, 0.006, 0.16, 6).rotateX(0.6).translate(0, -0.55, 0.04), '#202020'), col(new THREE.ConeGeometry(0.008, 0.03, 6).rotateX(Math.PI - 0.6).translate(0, -0.63, 0.1), GOLD_)]), armR);
    armR.position.set(0.19, 1.43, 0);
    princess.scale.setScalar(26);
    const ox = (far.x - E / 2) / far.R, oz = (far.z - E / 2) / far.R;                 // unit vector pointing away from the city
    const rho = far.r * 0.5, px = far.x + ox * rho, pz = far.z + oz * rho;            // half-way down the back slope: the mountain itself hides her from the city side
    const apex = far.h * (1 - rho / far.r) - 2;                                       // height of the cone surface there
    const base = Math.atan2(ox, oz);                                                  // yaw that makes her face away from the city, out over the far valley
    const rock = new THREE.Mesh(new THREE.CylinderGeometry(6, 11, 14, 8), mtMat); rock.position.set(px, apex - 6.7, pz);   // a flat ledge cut into the slope to sit on
    princess.position.set(px, apex + 0.3, pz); princess.rotation.y = base;
    const nm = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture('Kira Peikoff', { bg: 'rgba(255,240,248,.95)', fg: '#7a1f4a', border: '#f08cc0' }), transparent: true, depthWrite: false, fog: false }));   // her name floats above her
    nm.scale.set(70, 17.5, 1); nm.position.set(px, apex + 0.3 + 26 * 1.31 + 15, pz); nm.renderOrder = 6; nm.raycast = () => {};
    scenery.add(rock, princess, nm); princess.traverse(o => { o.raycast = () => {}; }); rock.raycast = () => {};
    const kiraHit = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.9, 1.2).translate(0, 0.85, 0), new THREE.MeshBasicMaterial({ visible: false }));   // she is only a clickable Easter egg, not a person in the data
    princess.add(kiraHit); kiraHit.userData.egg = eggs.length; eggMeshes.push(kiraHit);
    eggs.push({ hidden: true, tip: '<b>Kira Peikoff</b><br>author \u00b7 click for her books', title: 'Kira Peikoff', rows: () => [['About', 'Thriller author and science journalist'], ['Website', linkify('https://www.kirapeikoff.com/')], ['Baby X', linkify('https://www.barnesandnoble.com/w/baby-x-kira-peikoff/1143604735') + ' (Barnes &amp; Noble)']] });
    scenery.userData.princess = princess;
    const near = (c_, r, g, b) => Math.abs(c_.r - r) < 0.04 && Math.abs(c_.g - g) < 0.04 && Math.abs(c_.b - b) < 0.04;
    modelFile('princess').then(u => u && loadFigure(u, c_ => near(c_, 1, 0.83, 0.04) ? new THREE.Color(HAIR) : near(c_, 0, 0.34, 0.79) ? new THREE.Color('#2f7be0') : null)).then(geo0 => {   // optional ready-made princess (models.json "princess"): Kira exactly as before (same seat, pose, book, pen, brown hair, blue eyes) wearing the model's gown and face; same spot, name, click and card
      if (!geo0) return;
      const geo = dropTriangles(geo0, (r, g, b, cx, cy) => r > 0.95 && g > 0.95 && b > 0.95 && cy > 0.12 && cy < 0.72);   // the model's own white gloves and arms go: Kira's arms (below) replace them
      geo.userData.height = geo0.userData.height;
      smileMouth(geo.attributes.position.array, geo.attributes.color.array);   // the model's open "o" mouth becomes a closed smile (nothing is drawn over it)
      const fig = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide, flatShading: true }));
      fig.scale.setScalar(1.5); fig.rotation.y = Math.PI; fig.position.y = 0.47; fig.raycast = () => {};   // the model faces -z, Kira faces +z; scaled so its head and shoulders sit where Kira's did
      for (const ch of [...princess.children]) if (ch !== kiraHit && ch !== upper) princess.remove(ch);
      for (const ch of [...upper.children]) if (ch !== armR && ch !== hairBack && ch !== book) upper.remove(ch);   // built-in gown, body and head go; her pen arm and her book stay
      part(col(new THREE.CylinderGeometry(0.04, 0.035, 0.46, 8).rotateX(-1.15).translate(-0.2, 1.22, 0.2), SKIN_), upper);   // the same left arm resting on the book as the built-in Kira
      upper.add(fig); scenery.userData.princessModel = true; scenery.userData.princessHeight = geo.userData.height * 1.5;   // her standing height at scale 1 (the model, scaled by 1.5 above)
    });
    const ARM_P = new THREE.Vector3(0.19, 1.43, 0), PEN_U = new THREE.Vector3(0, -0.645, 0.105).normalize(), PEN_L = Math.hypot(0.645, 0.105), PEN_TARGET = new THREE.Vector3(), PEN_DIR = new THREE.Vector3();   // shoulder, direction and length from the shoulder to the pen tip (arm local space)
    // /home: she closes her book, stands up and walks to Peikoff Manor (shrinking to everyone else's size on the way down the mountain) and hangs out with Ason in front of it; /work: she walks back to her ledge, sits and writes again
    const surfK = (x, z) => { let y = 0; for (const p of peaks) { const d = Math.hypot(x - p.x, z - p.z); if (d < p.r) y = Math.max(y, p.h * (1 - d / p.r) - 2); } return y; };
    const SC0 = 26, LEDGE = [px, pz], SHRINK = 260, I0 = new THREE.Quaternion();
    const kira = { want: 'ledge', where: 'ledge', c: 0, s: 0, pts: null, d: 0, phase: 0, front: null, last: null };   // c = how closed the book is, s = how far she has stood up (0..1)
    scenery.userData.kira = kira;
    scenery.userData.kiraGo = (home, front) => {                                      // front = frontSpots(the manor): where Ason and she stand
      if (home && !front) return;                                                    // no manor (it needs open ground): she stays and writes
      if (front) kira.front = front;
      kira.want = home ? 'home' : 'ledge';
      if (kira.where === 'walk') startWalk();                                        // turn round where she is
    };
    const startWalk = () => {
      const cur = [princess.position.x, princess.position.z];
      const goal = kira.want === 'home' ? kira.front.kira.xy : LEDGE;
      kira.pts = findPath(water(), bridges, cur, goal) || [cur, goal];               // round the water, or over a bridge, never through it
      kira.d = 0; kira.where = 'walk'; princess.visible = nm.visible = true;
    };
    const personK = () => +(document.getElementById('sz')?.value || 3) * 1.72 / (scenery.userData.princessHeight || 1.85);   // scale that makes her as tall as everyone else (a person is about 1.72 high at scale 1; the built-in Kira about 1.85)
    const scaleAt = (x, z) => { const f = Math.min(1, Math.hypot(x - LEDGE[0], z - LEDGE[1]) / SHRINK), e = f * f * (3 - 2 * f); return SC0 + (personK() - SC0) * e; };
    const place = (x, z, sc) => {                                                    // her feet on the ground (or the ledge), the name over her head
      princess.position.set(x, (Math.hypot(x - px, z - pz) < 8 ? apex + 0.3 : surfK(x, z) + 0.3) + deckHeightAt(bridges, x, z), z); princess.scale.setScalar(sc);   // on the ledge, or on the slope / ground
      const lift = scenery.userData.princessModel ? 0 : 0.52 * kira.s, lab = Math.max(0.15, sc / SC0);
      nm.scale.set(70 * lab, 17.5 * lab, 1); nm.position.set(x, princess.position.y + sc * (1.31 + lift) + 15 * lab, z);
    };
    const toward = (v, goal, rate, dt) => v < goal ? Math.min(goal, v + rate * dt) : Math.max(goal, v - rate * dt);
    scenery.userData.stepPrincess = t => {                                           // idle animation: every motion is just a sine wave of time
      const dt = kira.last == null ? 0 : Math.min(0.1, Math.max(0, t - kira.last)); kira.last = t;
      if (kira.where === 'ledge') {
        if (kira.want === 'home') { if (kira.c < 1) kira.c = toward(kira.c, 1, 0.8, dt); else if (kira.s < 1) kira.s = toward(kira.s, 1, 0.7, dt); else startWalk(); }   // close the book, then stand up, then go
        else if (kira.s > 0) kira.s = toward(kira.s, 0, 0.7, dt); else kira.c = toward(kira.c, 0, 0.8, dt);                                                           // sit down, then open the book
      } else if (kira.where === 'home') {
        if (kira.want === 'ledge') startWalk();
      }
      if (kira.where === 'walk') {
        let rest = (16 + 24 * princess.scale.x / SC0) * dt; kira.phase += rest / Math.max(0.5, princess.scale.x * 0.35);   // bigger strides while she is big
        while (rest > 0 && kira.pts.length > 1) { const [a, b] = kira.pts, seg = Math.hypot(b[0] - a[0], b[1] - a[1]), left = seg - kira.d;
          if (rest < left) { kira.d += rest; rest = 0; } else { rest -= left; kira.pts.shift(); kira.d = 0; } }
        if (kira.pts.length > 1) { const [a, b] = kira.pts, seg = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, f = kira.d / seg, x = a[0] + (b[0] - a[0]) * f, z = a[1] + (b[1] - a[1]) * f;
          place(x, z, scaleAt(x, z)); princess.rotation.y = Math.atan2(b[0] - a[0], b[1] - a[1]);
          princess.position.y += Math.abs(Math.sin(kira.phase * Math.PI)) * 0.03 * princess.scale.x; princess.rotation.z = Math.sin(kira.phase * Math.PI) * 0.04; }
        else if (kira.want === 'home') { kira.where = 'home'; princess.rotation.z = 0; }                                 // arrived: she stays out front, beside Ason
        else { kira.where = 'ledge'; princess.rotation.z = 0; place(LEDGE[0], LEDGE[1], SC0); }                           // back on her ledge
      }
      flap.rotation.z = Math.PI * kira.c * kira.c * (3 - 2 * kira.c);
      if (!scenery.userData.princessModel) { upper.position.y = -0.52 * (1 - kira.s); gown.scale.y = 1 + 0.96 * kira.s; }   // standing: the body rises and the gown reaches the ground
      const writing = kira.where === 'ledge' && kira.c === 0 && kira.s === 0;
      if (kira.where === 'ledge') { princess.rotation.y = base + (writing ? Math.sin(t * 0.25) * 0.35 : 0); place(LEDGE[0], LEDGE[1], SC0); }   // slowly glances left and right
      else if (kira.where === 'home') { const K_ = kira.front.kira; place(K_.xy[0], K_.xy[1], personK()); princess.rotation.y = K_.yaw + Math.sin(t * 0.4) * 0.12; }   // out front, turned toward Ason, at everyone else's size
      upper.rotation.x = kira.where === 'walk' ? 0.04 : 0.12 * (1 - kira.s) + Math.sin(t * 0.5) * 0.03;                  // leans over the page, breathing
      hairBack.rotation.x = Math.sin(t * (kira.where === 'walk' ? 3 : 1.1)) * 0.05;                                       // hair swings
      if (!writing) { armR.quaternion.slerp(I0, Math.min(1, dt * 4)); armR.scale.setScalar(1); return; }                // the pen arm rests while she is not writing
      const px = 0.08 + 0.035 * Math.sin(t * 7), pz = 0.34 + 0.055 * Math.sin(t * 3.5);               // the pen scribbles across the right page and always touches it
      PEN_TARGET.set(px, 1.095 - 0.12 * (px - 0.075) + 0.002, pz); PEN_DIR.copy(PEN_TARGET).sub(ARM_P);   // the page top (a box tilted -0.12 rad), a hair above it
      armR.quaternion.setFromUnitVectors(PEN_U, PEN_DIR.clone().normalize()); armR.scale.setScalar(PEN_DIR.length() / PEN_L);   // aim the pen tip at that point (the arm stretches by a couple of percent)
    };
    scenery.userData.stepPrincess(0);
  }
  const lake = new THREE.Group(); lake.rotation.y = -LA; lake.position.set(E / 2, 0, E / 2); scenery.add(lake);   // south-west of the city: behind it from the default view
  const ellipse = (rx, rz, mat, y) => { const g = new THREE.CircleGeometry(1, 72); g.scale(rx, rz, 1); const m = new THREE.Mesh(g, mat); m.rotation.x = -Math.PI / 2; m.position.set(LD, y, 0); lake.add(m); };
  ellipse(LRX, LRZ, shoreMat, 0.05);
  ellipse(LRX * 0.92, LRZ * 0.86, lakeMat, 0.25);
  // the gulch: a stream comes down out of the mountains into the lake and leaves it again, winding past the city (u = along the lake direction, v = sideways)
  const W = (u, v) => new THREE.Vector3(E / 2 + u * Math.cos(LA) - v * Math.sin(LA), 0.22, E / 2 + u * Math.sin(LA) + v * Math.cos(LA));
  const streamMat = lakeMat.clone(); streamMat.side = THREE.DoubleSide; scenery.userData.mats.streamMat = streamMat;
  const ribbon = (pts, w0, w1) => {
    const curve = new THREE.CatmullRomCurve3(pts), n = 90, P_ = curve.getPoints(n), pos = [], idx = [];
    P_.forEach((p, i) => {
      const t = curve.getTangent(i / n), w = (w0 + (w1 - w0) * i / n) / 2, nx = -t.z, nz = t.x;
      pos.push(p.x + nx * w, 0.22, p.z + nz * w, p.x - nx * w, 0.22, p.z - nz * w);
      if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, streamMat); m.renderOrder = 0; scenery.add(m); return curve;
  };
  const inflow = ribbon([W(E * 3.45, E * 0.04), W(E * 3.2, -E * 0.05), W(E * 3.0, E * 0.03), W(E * 2.8, 0)], E * 0.03, E * 0.06);      // out of the mountains, into the lake
  const X = (x, y) => new THREE.Vector3(x, 0.22, y);   // plain city coordinates
  const outflow = ribbon([X(-E * 0.65, -E * 0.3), X(-E * 0.46, -E * 0.35), X(-E * 0.25, -E * 0.32), X(-E * 0.07, -E * 0.22), X(E * 0.07, -E * 0.12), X(E * 0.25, -E * 0.09), X(E * 0.5, -E * 0.09), X(E * 0.77, -E * 0.09), X(E * 1.04, -E * 0.03), X(E * 1.12, E * 0.25), X(E * 1.13, E * 0.6), X(E * 1.08, E * 0.95), X(E * 1.14, E * 1.4)], E * 0.06, E * 0.045);   // out of the lake, behind the outskirts, along the city's outer side
  scenery.userData.streams = [{ curve: outflow, w0: E * 0.06, w1: E * 0.045 }, { curve: inflow, w0: E * 0.03, w1: E * 0.06 }];
  scenery.userData.terrain = { peaks, inLake, W, LA, LD, LRX, LRZ };   // for the cottages below
  for (let i = 0; i < 16; i++) for (const side of [-1, 1]) {                                          // the gulch walls: small rocky hills lining the inflow
    const t = i / 15, p = inflow.getPoint(t), tg = inflow.getTangent(t), d = E * (0.05 + rnd() * 0.04), hh = 30 + rnd() * 55;
    peak(p.x - tg.z * side * d, p.z + tg.x * side * d, hh, hh * (0.9 + rnd() * 0.5), 5 + Math.floor(rnd() * 3), true);
  }
  // "Welcome to Atlantis": a city sign planted in the ground beside the road into town (a front and a back face, so it reads correctly from both sides; scaled up to be readable from the hill)
  {
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 300; const g = cv.getContext('2d');
    g.fillStyle = '#1f5f3a'; g.fillRect(0, 0, 1024, 300); g.strokeStyle = '#ffffff'; g.lineWidth = 12; g.strokeRect(12, 12, 1000, 276);
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '700 96px system-ui, sans-serif'; g.fillText('WELCOME TO', 512, 90); g.font = '800 130px system-ui, sans-serif'; g.fillText('ATLANTIS', 512, 200);
    g.font = '600 42px system-ui, sans-serif'; g.fillText('Pop. ' + city.ids.length, 512, 252);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const sw = 46, sh = sw * 300 / 1024, ph = 9, sign = new THREE.Group();
    const bm = new THREE.MeshBasicMaterial({ map: tex }), board = new THREE.Group(), face = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), bm), back = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), bm);   // two faces, the second turned half a circle: the text reads left to right from both sides
    face.position.z = 0.1; back.position.z = -0.1; back.rotation.y = Math.PI; board.add(face, back); board.position.y = ph + sh / 2 - 1;
    const postMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1 });
    for (const dx of [-sw * 0.36, sw * 0.36]) { const post = new THREE.Mesh(new THREE.BoxGeometry(1.4, ph, 1.4), postMat); post.position.set(dx, ph / 2, 0); sign.add(post); }
    sign.add(board);
    const at = W(E * 0.62, -E * 0.07); sign.position.set(at.x, 0, at.z); sign.rotation.y = Math.atan2(Math.cos(LA), Math.sin(LA)); scenery.add(sign);   // faces up the road toward the lake
  }
}
scene.add(scenery);

// --- Galt's Gulch: the city is Atlantis, the hidden valley of Atlas Shrugged (Mulligan's Valley, ringed by mountains). A gold sign hangs in the gap behind the lake.
{
  const gold = { bg: 'rgba(36,26,12,.9)', fg: '#f4d98d', border: '#c9a24a' };
  const mk = (text, w, y, tilt) => {
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture(text, gold), transparent: true, depthWrite: false, depthTest: false, fog: false }));
    spr.scale.set(w, w / 4, 1); spr.renderOrder = 6;
    spr.position.set(E / 2 + Math.cos(3.75) * E * 2.3, y, E / 2 + Math.sin(3.75) * E * 2.3 + tilt); scenery.add(spr);
  };
  mk("Galt's Gulch", E * 0.85, E * 0.42, 0);
}

// --- websites as fish: one fish per row of the websites table, swimming round and round the stream (colored by kind of site; click or hover for the link).
// A defunct site (dead domain, for sale, hijacked, taken over by spam ...) is a pale skeleton that drifts more slowly.
const fish = [];
const fishGroup = new THREE.Group(); scenery.add(fishGroup);
{
  const body = new THREE.SphereGeometry(0.5, 12, 8); body.scale(1, 0.4, 0.3);
  const tail = new THREE.ConeGeometry(0.25, 0.4, 4); tail.rotateZ(-Math.PI / 2); tail.translate(-0.55, 0, 0); tail.scale(1, 1, 0.25);
  const parts = [body.toNonIndexed(), tail.toNonIndexed()], geo = new THREE.BufferGeometry();
  for (const a of ['position', 'normal']) {
    const n = parts.reduce((s, g) => s + g.attributes[a].array.length, 0), arr = new Float32Array(n); let o = 0;
    for (const g of parts) { arr.set(g.attributes[a].array, o); o += g.attributes[a].array.length; }
    geo.setAttribute(a, new THREE.BufferAttribute(arr, 3));
  }
  // the skeleton: spine, skull and jaw, ribs, a fan of tail bones (head points along +x like the live fish)
  const bone = (r, len, rz, x, y) => new THREE.CylinderGeometry(r, r, len, 5).rotateZ(rz).translate(x, y, 0);
  const skel = mergeGeometries([
    bone(0.03, 1.0, Math.PI / 2, -0.02, 0),
    new THREE.SphereGeometry(0.11, 8, 6).scale(1.5, 1, 0.9).translate(0.52, 0.01, 0), new THREE.BoxGeometry(0.16, 0.025, 0.07).translate(0.55, -0.075, 0),
    ...Array.from({ length: 7 }, (_, i) => [bone(0.02, 0.26, -0.3, 0.38 - i * 0.12, 0.1), bone(0.02, 0.26, 0.3, 0.38 - i * 0.12, -0.1)]).flat(),
    ...[-0.55, -0.25, 0, 0.25, 0.55].map(a => bone(0.018, 0.34, Math.PI / 2 - a, -0.5 - 0.17 * Math.cos(a), 0.17 * Math.sin(a)))]);
  const hitGeo = new THREE.BoxGeometry(1.3, 0.5, 0.5), hitMat = new THREE.MeshBasicMaterial({ visible: false });     // thin bones are hard to click: an invisible box does the picking
  const boneMat = new THREE.MeshStandardMaterial({ color: 0xe6e1d0, roughness: 0.85 });
  const KIND = { organization: 0xf4d98d, substack: 0xff8a3d, personal: 0x4fd1c5, forum: 0x7bd88f, store: 0xf27fb5, publication: 0xb894ff };
  const KIND_OF = { org: 'organization', general: 'organization', academic: 'organization', org_site: 'organization', charitable: 'organization', students: 'organization', law: 'organization', education: 'organization', event: 'organization', business: 'organization', club: 'organization', site: 'organization', substack: 'substack', personal: 'personal', forum: 'forum', blog: 'forum', portal: 'forum', store: 'store', magazine: 'publication', journal: 'publication', publication: 'publication', reference: 'publication', resource: 'publication' };
  const mats = {}, kindOf = w => KIND_OF[w.type] || 'organization';
  for (const [k, c] of Object.entries(KIND)) mats[k] = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.25, roughness: 0.5 });
  let seed = 11; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const S = scenery.userData.streams, LEN = 7;
  (city.websites || []).forEach((w, i) => {
    const st = i % 6 === 5 ? 1 : 0, dead = !!w.defunct, m = new THREE.Mesh(dead ? skel : geo, dead ? boneMat : mats[kindOf(w)]), sc = LEN * (0.8 + rnd() * 0.5) * (dead ? 1.2 : 1);
    m.userData.fish = fish.length;
    if (dead) { const hit = new THREE.Mesh(hitGeo, hitMat); hit.userData.fish = fish.length; m.add(hit); }
    fishGroup.add(m); fish.push({ w, m, kind: dead ? 'defunct' : kindOf(w), dead, sc, st, t: rnd(), off: (rnd() - 0.5) * 0.55, ph: rnd() * 6.28, v: (1.2 + rnd() * 3.3) * (dead ? 0.7 : 1) });
  });
  const P3 = new THREE.Vector3(), T3 = new THREE.Vector3(), ramp = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
  scenery.userData.stepFish = (dt, time) => {                          // 1.2-4.5 m/s, each fish at its own constant pace; at the end of a stream a fish dissolves into the mist and a new one rises at the spring: the same fish, looping forever
    for (const f of fish) {
      const s = S[f.st], len = s.curve.getLength();
      f.t += f.v * Math.max(0, dt || 0) / len; f.t = f.t - Math.floor(f.t);   // dt can be negative or NaN on the first frame: keep t inside [0, 1)
      s.curve.getPointAt(f.t, P3); s.curve.getTangentAt(f.t, T3);
      const width = s.w0 + (s.w1 - s.w0) * f.t, side = f.off * width + Math.sin(time * 0.4 + f.ph) * width * 0.05;
      f.m.position.set(P3.x - T3.z * side, f.dead ? 0.35 : 0.5, P3.z + T3.x * side);
      f.m.rotation.y = Math.atan2(-T3.z, T3.x) + Math.sin(time * 2 + f.ph) * (f.dead ? 0.04 : 0.12);
      f.m.rotation.x = f.dead ? Math.sin(time * 0.7 + f.ph) * 0.35 : 0;      // a skeleton rolls over as it drifts
      f.m.scale.setScalar(f.sc * Math.max(0.001, ramp(f.t / 0.03) * ramp((1 - f.t) / 0.03)));
    }
  };
  scenery.userData.stepFish(0, 0);
  scenery.userData.fishLegend = KIND;
}

// --- social media groups as cottages: one cottage per group / community (Meetup, Facebook, Reddit, LinkedIn, Goodreads, Google Groups), scattered over the
// gulch floor beside the streams and the lake and up the mountainsides. Roof color = platform, size = member count. Hover or click for the card.
const cottages = [];
const cottageGroup = new THREE.Group(); scenery.add(cottageGroup);
const COTTAGE_PLATFORM = { meetup: ['Meetup', '#f2c230'], facebook: ['Facebook', '#2f6fe0'], reddit: ['Reddit', '#ff8c1a'], linkedin: ['LinkedIn', '#16a3d8'], goodreads: ['Goodreads', '#8b5a2b'], google_groups: ['Google Groups', '#2fa36b'] };
{
  const T = scenery.userData.terrain, S = scenery.userData.streams, peaks = T.peaks;
  let seed = 23; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;          // its own random stream: adding cottages never moves a mountain
  const paintG = (geo, hex) => { const c_ = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
    for (let j = 0; j < n; j++) a.set([c_.r, c_.g, c_.b], j * 3); geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo; };
  const cottageGeo = (roof, door) => mergeGeometries([                         // door faces +z; floor at y = 0, stone footing buried below it so it sits on a slope
    paintG(new THREE.BoxGeometry(1.12, 0.9, 0.92).translate(0, -0.35, 0), '#6b6f78'),
    paintG(new THREE.BoxGeometry(1, 0.6, 0.8).translate(0, 0.4, 0), '#eadcc0'),
    paintG(new THREE.ConeGeometry(0.8, 0.55, 4).rotateY(Math.PI / 4).scale(1.0, 1, 0.82).translate(0, 0.975, 0), roof),
    paintG(new THREE.BoxGeometry(0.1, 0.3, 0.1).translate(0.28, 1.05, -0.12), '#8a4b3a'),
    paintG(new THREE.BoxGeometry(0.18, 0.34, 0.03).translate(0, 0.27, 0.4), door),
    paintG(new THREE.BoxGeometry(0.15, 0.15, 0.03).translate(-0.29, 0.45, 0.4), '#ffe9a0'), paintG(new THREE.BoxGeometry(0.15, 0.15, 0.03).translate(0.29, 0.45, 0.4), '#ffe9a0')]);
  const geos = {}, cMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  const surf = (x, z) => { let y = 0; for (const p of peaks) { const d = Math.hypot(x - p.x, z - p.z); if (d < p.r) y = Math.max(y, p.h * (1 - d / p.r) - 2); } return y; };   // height of the mountains under (x, z)
  // roofs come in many colors; red is reserved for Peikoff properties (a group of a Peikoff building, or with the Peikoffs in its name). The platform is the door color.
  const ROOF_RED = '#d0242b', ROOF_PALETTE = ['#2f6fe0', '#2fa36b', '#e8a317', '#8b5fd6', '#16a3d8', '#e87aa8', '#7a5c3a', '#3b8f8f', '#6b7a99', '#c9722b', '#4d9c3a', '#a35a8f'];
  const peikoffB = new Set((city.highlight?.buildings || []).map(i => city.buildings[i]?.org_id)), peikoff = g => (g.org_id != null && peikoffB.has(g.org_id)) || /peikoff|don'?t let it go|legalizing privacy|postsocialist|poso press/i.test(g.name);
  const taken = [], free = (x, z, gap) => taken.every(t => Math.hypot(t[0] - x, t[1] - z) > gap);
  const inCity = (x, z) => x > -E * 0.1 && x < E * 1.1 && z > -E * 0.1 && z < E * 1.1;
  const groups = (city.groups || []).slice().sort((a, b) => (a.platform === 'meetup' ? 0 : 1) - (b.platform === 'meetup' ? 0 : 1) || (b.members || 0) - (a.members || 0));
  const floorSpot = () => {                                            // gulch floor: beside the inflow or outflow stream, or on the lake shore
    for (let tries = 0; tries < 400; tries++) {
      let x, z; const r = rnd();
      if (r < 0.2) { const th = rnd() * 6.283, k = 1.28 + rnd() * 0.5, v = Math.sin(th) * T.LRZ * k, u = T.LD + Math.cos(th) * T.LRX * k, P_ = T.W(u, v); x = P_.x; z = P_.z; }
      else { const si = r < 0.8 ? 1 : 0, s = S[si], t = si ? 0.04 + rnd() * 0.9 : 0.3 + rnd() * 0.65, p = s.curve.getPointAt(t), tg = s.curve.getTangentAt(t), w = s.w0 + (s.w1 - s.w0) * t, side = rnd() < 0.5 ? -1 : 1, d = w / 2 + 16 + rnd() * E * 0.12;
        x = p.x - tg.z * side * d; z = p.z + tg.x * side * d; }
      if (T.inLake(x, z) || inCity(x, z) || surf(x, z) > 2 || !free(x, z, 22)) continue;
      return [x, z, 0];
    }
    return null;
  };
  const slopeSpot = (high) => {                                        // mountainside: on the inner slope of a ring mountain, on the cone surface
    for (let tries = 0; tries < 600; tries++) {
      const p = peaks[Math.floor(rnd() * peaks.length)]; if (p.h < E * 0.25) continue;
      const toC = Math.atan2(E / 2 - p.z, E / 2 - p.x), ang = toC + (rnd() - 0.5) * 2.6, rho = p.r * (high ? 0.2 + rnd() * 0.25 : 0.35 + rnd() * 0.4);
      const x = p.x + Math.cos(ang) * rho, z = p.z + Math.sin(ang) * rho, y = surf(x, z);
      if (T.inLake(x, z) || inCity(x, z) || y < 4 || !free(x, z, 16)) continue;
      return [x, z, y];
    }
    return null;
  };
  groups.forEach((g, i) => {
    const spot = (g.platform === 'meetup' ? floorSpot() : slopeSpot(g.platform === 'reddit')) || floorSpot() || slopeSpot(false); if (!spot) return;
    const [x, z, y] = spot, size = (g.members == null ? 0.9 : 0.75 + 0.2 * Math.log10(1 + g.members)) * 11;
    taken.push([x, z]);
    const door = (COTTAGE_PLATFORM[g.platform] || ['', '#9aa4b8'])[1], roof = peikoff(g) ? ROOF_RED : ROOF_PALETTE[g.id % ROOF_PALETTE.length], m_ = new THREE.Mesh(geos[roof + door] ||= cottageGeo(roof, door), cMat);
    m_.scale.setScalar(size); m_.position.set(x, y, z); m_.rotation.y = Math.atan2(E / 2 - x, E / 2 - z) + (rnd() - 0.5) * 0.9;          // door roughly toward the city
    m_.userData.cottage = cottages.length; cottageGroup.add(m_); cottages.push({ g, m: m_, roof });
  });
  // optional ready-made model (see models.js): when public/atlas/models/cottage.glb (or ?model=URL) loads, every cottage uses it; otherwise the built-in house stays
  const wanted = async () => { const q = new URLSearchParams(location.search).get('model'); if (q) return q;
    try { const f = (await (await fetch(new URL('./models/models.json', import.meta.url))).json()).cottage; return f ? new URL('./models/' + f, import.meta.url).href : null; } catch (e) { return null; } };   // models.json says which file, if any: no file, no request, no 404
  wanted().then(url => url && loadBuilding(url).then(base => url && base && { url, base })).then(r => {
    if (!r) return; const base = r.base, modelUrl = r.url;
    const byRoof = {};
    for (const c_ of cottages) { c_.m.geometry = byRoof[c_.roof] ||= withRoof(base, c_.roof); }
    scenery.userData.cottageModel = modelUrl;
  });
}

// --- Easter egg: a toy pirate ship for theVault (the-vault.website: not an Objectivist site, but tied to the Peikoffs). It is not a row of the websites table, so it is no fish and
// not searchable; it sails round the outflow stream among the fish. Click it for the card.
{
  const S = scenery.userData.streams[0];
  const paintG = (geo, hex) => { const c_ = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
    for (let j = 0; j < n; j++) a.set([c_.r, c_.g, c_.b], j * 3); geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo; };
  const cyl = (r, len, hex, rz, x, y, z = 0) => paintG(new THREE.CylinderGeometry(r, r, len, 6).rotateZ(rz).translate(x, y, z), hex);
  const box = (w, h, d, hex, x, y, z = 0) => paintG(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex);
  const ship = new THREE.Group(), hull = new THREE.Mesh(mergeGeometries([                          // bow points along +x; 1 unit long before scaling
    box(0.95, 0.16, 0.34, '#8a3b1b', 0, 0.1), box(1.0, 0.035, 0.37, '#ffd23f', 0, 0.2), box(0.28, 0.14, 0.32, '#7a3216', -0.36, 0.27), box(0.2, 0.03, 0.34, '#ffd23f', -0.36, 0.35),
    paintG(new THREE.ConeGeometry(0.17, 0.3, 4).rotateZ(-Math.PI / 2).rotateX(Math.PI / 4).scale(1, 0.55, 1).translate(0.6, 0.1, 0), '#8a3b1b'),
    cyl(0.014, 0.8, '#5a3a22', 0, 0.1, 0.55), cyl(0.012, 0.6, '#5a3a22', 0, -0.22, 0.45), cyl(0.012, 0.36, '#5a3a22', Math.PI / 2 - 0.35, 0.78, 0.26),                    // masts, bowsprit
    box(0.02, 0.4, 0.4, '#f5ecd2', 0.12, 0.62), box(0.021, 0.06, 0.41, '#d12b2b', 0.12, 0.62), box(0.02, 0.3, 0.3, '#f5ecd2', -0.2, 0.5), box(0.021, 0.05, 0.31, '#d12b2b', -0.2, 0.5),   // sails with a red stripe
    box(0.012, 0.13, 0.2, '#15151a', 0.1, 0.99, 0.1), paintG(new THREE.SphereGeometry(0.026, 8, 6).translate(0.1, 1.0, 0.1), '#f4f4f0'),                                        // the flag with a skull
    cyl(0.006, 0.07, '#f4f4f0', 0.9, 0.1, 0.975, 0.1), cyl(0.006, 0.07, '#f4f4f0', -0.9, 0.1, 0.975, 0.1),
    ...[-0.25, 0, 0.25].flatMap(x => [0.2, -0.2].map(z => paintG(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 6).rotateX(Math.PI / 2).translate(x, 0.14, z), '#222')))                          // cannons
  ]), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide, flatShading: true }));
  const SHIP_SC = 7.5;                                                                              // about the size of a big fish (the fish are 6-10 m long)
  ship.add(hull); ship.scale.setScalar(SHIP_SC);
  const hit = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.2, 0.6).translate(0.05, 0.5, 0), new THREE.MeshBasicMaterial({ visible: false })); ship.add(hit);
  hit.userData.egg = eggs.length; eggMeshes.push(hit);
  eggs.push({ hidden: false, tip: '<b>theVault</b><br>a toy pirate ship · click', title: 'theVault', rows: () => [
    ['What', 'A toy pirate ship: an Easter egg, not a fish'],
    ['About', 'An open-source prototype vendor store, inspired by the Goldhat Free Market and the thriller Baby X by Kira Peikoff. Not an Objectivist site.'],
    ['Website', linkify('https://the-vault.website/')], ['Source code', linkify('https://github.com/hack-r/theVault-Darknet-Market')],
    ['Status', 'On 2026-10-15 the website was showing a "be right back, securing new hosting" page']] });
  scenery.add(ship);
  let t = 0.15; const P3 = new THREE.Vector3(), T3 = new THREE.Vector3(), ramp = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
  scenery.userData.stepShip = (dt, time) => {
    const len = S.curve.getLength(); t += 1.6 * Math.max(0, dt || 0) / len; t -= Math.floor(t);
    S.curve.getPointAt(t, P3); S.curve.getTangentAt(t, T3);
    const w = S.w0 + (S.w1 - S.w0) * t, side = -0.12 * w;
    ship.position.set(P3.x - T3.z * side, 0.6 + Math.sin(time * 1.3) * 0.15, P3.z + T3.x * side);
    ship.rotation.set(Math.sin(time * 1.1) * 0.06, Math.atan2(-T3.z, T3.x), Math.sin(time * 0.9) * 0.1);                    // pitch and roll on the water
    ship.scale.setScalar(SHIP_SC * Math.max(0.001, ramp(t / 0.03) * ramp((1 - t) / 0.03)));
  };
  scenery.userData.stepShip(0, 0);
}

// --- Easter egg: Midas Peikoff, a dog, flies a red plane in slow circles high above the gulch (models.json "midas": the .glb is "Dog in plane"; its plane is recolored Peikoff red). Scenery only: no data row.
modelFile('midas').then(u => u && loadFigure(u, (c_, g_) => c_.r < 0.05 && c_.g < 0.05 ? tintLargeFaces(g_, new THREE.Color('#a8501c'), c_) : (Math.abs(c_.r - 0.87) < 0.05 && Math.abs(c_.g - 0.12) < 0.05 && Math.abs(c_.b - 0.29) < 0.05) ? new THREE.Color('#c8141c') : (Math.abs(c_.r - 0.74) < 0.05 && Math.abs(c_.g - 0.33) < 0.05) ? new THREE.Color('#d9a066') : null, (g_, m_) => m_?.name === 'mat15')).then(geo => {   // red/sable coat (eyes and nose stay dark), tan points, a true red plane
  if (!geo) return;
  const plane = new THREE.Group(), body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide, flatShading: true }));
  const MIDAS_SC = 13;                                                                                // longest side 13 units (half his earlier size): the nose (propeller) points along +x
  body.position.y = -geo.userData.height / 2; plane.add(body); plane.scale.setScalar(MIDAS_SC);
  let spin = null;                                                                                    // the propeller (material mat15 of the model) is its own mesh, turning about the nose axis (+x) through its centre
  if (geo.userData.side) { const sg = geo.userData.side; sg.computeBoundingBox(); const c = sg.boundingBox.getCenter(new THREE.Vector3()); sg.translate(-c.x, -c.y, -c.z);
    spin = new THREE.Group(); spin.position.set(c.x, c.y - geo.userData.height / 2, c.z); const blades = new THREE.Mesh(sg, body.material); blades.raycast = () => {}; spin.add(blades); plane.add(spin); }
  const hit = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 1.1), new THREE.MeshBasicMaterial({ visible: false })); plane.add(hit);
  hit.userData.egg = eggs.length; eggMeshes.push(hit); body.raycast = () => {};
  eggs.push({ hidden: false, tip: '<b>Midas Peikoff</b><br>a dog in a red plane \u00b7 click', title: 'Midas Peikoff', rows: () => [
    ['What', 'A dog flying a red plane: an Easter egg, not a person in the data']] });
  scenery.add(plane);
  const R1 = E * 0.42, R0 = E * 1.5, H = 150, APPROACH = 80;                                       // starts well out from the city and spirals in toward it, then circles
  const at = time => { const k = Math.min(1, time / APPROACH), e = k * k * (3 - 2 * k), r = R0 + (R1 - R0) * e, a = 0.9 + time * 0.04 * (0.6 + 0.4 * e);
    return [E / 2 + Math.cos(a) * r, H + 40 * (1 - e) + Math.sin(time * 0.5) * 6, E / 2 + Math.sin(a) * r]; };
  let t0 = null;                                                                                      // the flight starts when the loop first runs it
  const halfH = geo.userData.height * MIDAS_SC / 2, LAND = 30, TAKEOFF = 25;                                // seconds to come down / to climb back out; halfH = the plane's centre above the ground when parked
  let spot = null, want = 0, w = 0, lastT = null;                                                    // spot = { x, z, dx, dz } beside the castle; want = 1 land, 0 fly; w = how far down (0 in the air, 1 parked)
  const ease = k => k * k * (3 - 2 * k), wrapA = d => Math.atan2(Math.sin(d), Math.cos(d));
  scenery.userData.midasLand = (land, where) => { want = land && where ? 1 : 0; if (where) spot = where; };   // /home lands him beside the castle, /work (or anything else) sends him up again
  scenery.userData.midasParked = () => w >= 1;
  scenery.userData.midasPlane = { plane, spin };                                                      // for tests: the plane and its turning propeller
  scenery.userData.stepMidas = time => {
    if (time > 0 && t0 === null) t0 = time; const T = t0 === null ? 0 : time - t0;
    const dtm = lastT === null ? 0 : Math.max(0, Math.min(1, T - lastT)); lastT = T;
    if (want > w) w = Math.min(1, w + dtm / LAND); else if (want < w) w = Math.max(0, w - dtm / TAKEOFF);
    if (spin) spin.rotation.x += 32 * dtm * (1 - ease(w));                                               // flat out in the air, winding down as he lands, still when parked
    const e = ease(w), c0 = at(T), c1 = at(T + 0.2);
    const g = (k) => spot ? [c0[0] + (spot.x - c0[0]) * k, c0[1] + (halfH - c0[1]) * k * k, c0[2] + (spot.z - c0[2]) * k] : c0;   // from the circle toward the touchdown spot, steepest at the end
    const p0 = g(e), p1 = g(ease(Math.min(1, w + 0.004 * (want > w ? 1 : want < w ? -1 : 0))));
    plane.position.set(p0[0], p0[1], p0[2]);
    const air = Math.atan2(-(c1[2] - c0[2]), c1[0] - c0[0]);                                          // heading of the circling flight
    let yaw = air;
    if (spot && w > 0) { const run = Math.atan2(-spot.dz, spot.dx), mv = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) > 1e-4 ? Math.atan2(-(p1[2] - p0[2]), p1[0] - p0[0]) : run; const k = ease(Math.max(0, (w - 0.8) / 0.2)); yaw = w < 1 && want !== w ? mv + wrapA(run - mv) * k : run; if (want < w) yaw = mv + wrapA(run - mv) * k; }
    plane.rotation.order = 'YXZ'; plane.rotation.set(0, yaw, (0.18 + Math.sin(T * 0.9) * 0.05) * (1 - e) - 0.08 * Math.sin(Math.PI * e));   // banked in the air, nose slightly down on the way in, level on the ground
  };
  scenery.userData.stepMidas(0);
});

// --- Atlantis Railway (models.json "train": a folder of the Modular Train Pack .glb files): a closed track round the whole city, with one freight train running on it (it hauls the ore of the Atlantis Mine). Pieces are used at 3x so they read from the hill. The loop is a rounded rectangle just outside the buildings (the margin is chosen to keep clear of mountains, the lake and cottages); scenery only.
let resolveRailway; scenery.userData.railwayDone = new Promise(r_ => { resolveRailway = r_; });   // the car lot waits for the railway to know where the track is
modelFile('train').then(async base => {
  if (!base) return;
  const names = ['railway-track-straight', 'railway-track-curve', 'cargo-train-front', 'cargo-train-wagon', 'cargo-train-container', 'cargo-train-coal-conta'];
  const G = {}; await Promise.all(names.map(async n => { G[n] = await loadRaw(base + n + '.glb'); })); if (names.some(n => !G[n])) return;
  G['railway-track-curve'] = G['railway-track-curve'].clone().translate(G['railway-track-curve'].userData.center[0], 0, G['railway-track-curve'].userData.center[1]);   // the curve piece starts at its origin, heading +x, and turns toward -z
  G['railway-track-curve'].userData.size = [18, 0.14, 18];
  const T = scenery.userData.terrain, TS = 3, PIECE = 27, bx0 = Math.min(...B.map(b => b.x0)), bx1 = Math.max(...B.map(b => b.x1)), bz0 = Math.min(...B.map(b => b.y0)), bz1 = Math.max(...B.map(b => b.y1));
  const surf = (x, z) => { let y = 0; for (const p of T.peaks) { const d = Math.hypot(x - p.x, z - p.z); if (d < p.r) y = Math.max(y, p.h * (1 - d / p.r) - 2); } return y; };
  const peakH = (x, z) => { let h = 0; for (const p of T.peaks) if (Math.hypot(x - p.x, z - p.z) < p.r) h = Math.max(h, p.h); return h; };           // the tallest peak over a point
  const wet = scenery.userData.streams.map(S_ => Array.from({ length: 240 }, (_, i) => { const q = S_.curve.getPointAt(i / 239); return [q.x, q.z, S_.w0 + (S_.w1 - S_.w0) * i / 239]; }));
  // a freight line, not a loop: from a depot beside the city, over open ground and through a tall mountain by tunnel, to the Atlantis Mine on the far side. Every 8-unit cell of the map is free, mountain (tall enough to tunnel) or
  // forbidden (water, cottages, buildings, low hills a tunnel could not go under). For each tall mountain near the city a route is searched (A*, mountain cells cost 4, free cells 1) from the depot to a point beyond it, smoothed
  // so the curves are gentle, and checked: it must touch nothing forbidden and go under the mountain in one tunnel of sensible length. The shortest such route wins.
  const CELL = 8, LO = -1700, NC = 425, cls = new Uint8Array(NC * NC);                                         // 0 free, 1 mountain, 2 forbidden
  const forbidden = (x, z) => T.inLake(x, z) || cottages.some(q => Math.hypot(q.m.position.x - x, q.m.position.z - z) < 16) || wet.some(a => a.some(q => Math.hypot(q[0] - x, q[1] - z) < q[2] * 0.8 + 14)) || B.some(b => x > b.x0 - 14 && x < b.x1 + 14 && z > b.y0 - 14 && z < b.y1 + 14);
  for (let i = 0; i < NC; i++) for (let j = 0; j < NC; j++) { const x = LO + i * CELL, z = LO + j * CELL; cls[i * NC + j] = forbidden(x, z) ? 2 : surf(x, z) > 0.3 ? (peakH(x, z) >= 30 ? 1 : 2) : 0; }
  const kind = (x, z) => { const i = Math.round((x - LO) / CELL), j = Math.round((z - LO) / CELL); return i < 0 || j < 0 || i >= NC || j >= NC ? 2 : cls[i * NC + j]; };
  const kindWide = (x, z) => Math.max(kind(x, z), kind(x + 4, z), kind(x - 4, z), kind(x, z + 4), kind(x, z - 4));
  const free = (x, z) => kindWide(x, z) === 0 && !B.some(b => x > b.x0 - 40 && x < b.x1 + 40 && z > b.y0 - 40 && z < b.y1 + 40);
  const nearestFree = (x, z, rad) => { const gx = LO + Math.round((x - LO) / CELL) * CELL, gz = LO + Math.round((z - LO) / CELL) * CELL; let best = null, bd = 1e18; for (let dx = -rad; dx <= rad; dx += CELL) for (let dz = -rad; dz <= rad; dz += CELL) { const d = Math.hypot(dx, dz); if (d < bd && free(gx + dx, gz + dz)) { best = [gx + dx, gz + dz]; bd = d; } } return best; };   // on the grid's own cell centres
  const astar = (a, g) => {                                                                              // cell path from a to g over free (1) and mountain (4) ground, 8 neighbours; null if none
    const idx = (i, j) => i * NC + j, ci = v => Math.round((v - LO) / CELL), si = ci(a[0]), sj = ci(a[1]), gi = ci(g[0]), gj = ci(g[1]), gs = new Float32Array(NC * NC).fill(1e18), from = new Int32Array(NC * NC).fill(-1), done = new Uint8Array(NC * NC), heap = [];
    const push = (f, k) => { heap.push([f, k]); let c = heap.length - 1; while (c > 0) { const q = (c - 1) >> 1; if (heap[q][0] <= heap[c][0]) break; [heap[q], heap[c]] = [heap[c], heap[q]]; c = q; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
    gs[idx(si, sj)] = 0; push(0, idx(si, sj)); const goal = idx(gi, gj);
    while (heap.length) { const [, k] = pop(); if (done[k]) continue; done[k] = 1; if (k === goal) break; const i = Math.floor(k / NC), j = k % NC;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { if (!di && !dj) continue; const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= NC || nj >= NC) continue;
        const kw = kindWide(LO + ni * CELL, LO + nj * CELL); if (kw === 2) continue; const nk = idx(ni, nj), ng = gs[k] + (di && dj ? 1.4142 : 1) * (kw === 1 ? 4 : 1); if (ng < gs[nk]) { gs[nk] = ng; from[nk] = k; push(ng + Math.hypot(ni - gi, nj - gj), nk); } } }
    if (gs[goal] >= 1e18) return null; const out = []; for (let k = goal; k >= 0; k = from[k]) out.push([LO + Math.floor(k / NC) * CELL, LO + (k % NC) * CELL]); return out.reverse(); };
  const smooth = (pts, passes) => { let q = pts.map(p => p.slice()); for (let pass = 0; pass < passes; pass++) q = q.map((p, i) => i === 0 || i === q.length - 1 ? p : [(q[i - 1][0] + p[0] * 2 + q[i + 1][0]) / 4, (q[i - 1][1] + p[1] * 2 + q[i + 1][1]) / 4]); return q; };
  let tunLen = 0; const tunnelsOf = pts => { let inMt = false, run = 0, peak_ = 0, n = 0; tunLen = 0;                                    // the number of tunnels on the route, or -1 if it touches anything forbidden or a tunnel is too short, too long or under a low hill
    for (let i = 0; i < pts.length; i++) { const [x, z] = pts[i], k = kindWide(x, z); if (k === 2) return -1; const seg = i ? Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]) : 0;
      if (surf(x, z) > 0.3) { inMt = true; run += seg; peak_ = Math.max(peak_, surf(x, z)); } else if (inMt) { if (run < 24 || run > 900 || peak_ < 26) return -1; n++; tunLen += run; inMt = false; run = 0; peak_ = 0; } }
    if (inMt) return -1; return n; };
  const ccx = (bx0 + bx1) / 2, ccz = (bz0 + bz1) / 2, halfC = Math.max(bx1 - bx0, bz1 - bz0) / 2 + 80; let route = null, routeLen = 1e18;
  const cands = T.peaks.filter(p => p.h >= 30 && p.r <= 260 && Math.hypot(p.x - ccx, p.z - ccz) < 1500).sort((p, q) => Math.hypot(p.x - ccx, p.z - ccz) - Math.hypot(q.x - ccx, q.z - ccz)).slice(0, 16);
  for (const p of cands) { const d = Math.hypot(p.x - ccx, p.z - ccz) || 1, ux = (p.x - ccx) / d, uz = (p.z - ccz) / d;
    const D = nearestFree(ccx + ux * halfC, ccz + uz * halfC, 200); if (!D) continue;
    for (const rot of [0, -0.5, 0.5, -1, 1]) { const c_ = Math.cos(rot), s_ = Math.sin(rot), vx = ux * c_ - uz * s_, vz = ux * s_ + uz * c_;   // aimed at the mountain, or past one side of it: a shorter tunnel through its flank
      const G = nearestFree(p.x + vx * (p.r + 400), p.z + vz * (p.r + 400), 160); if (!G) continue;
      const raw = astar(D, G); if (!raw) continue;
      for (const passes of [16, 10, 5, 2]) { const pts = smooth(raw, passes), len = pts.reduce((a, q, i) => a + (i ? Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) : 0), 0);   // as gentle a curve as stays clear of everything
        if (tunnelsOf(pts) >= 1) { const score = len + 2.5 * tunLen; if (score < routeLen) { route = pts; routeLen = score; } break; } } } }
  if (!route) return;                                                                                   // no ground for a line that touches nothing of ours and goes through a mountain: no railway
  const cum = [0]; for (let i = 1; i < route.length; i++) cum.push(cum[i - 1] + Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]));
  const total = cum.at(-1), r = { x0: Math.min(...route.map(q => q[0])), x1: Math.max(...route.map(q => q[0])), z0: Math.min(...route.map(q => q[1])), z1: Math.max(...route.map(q => q[1])) };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.1, flatShading: true, side: THREE.DoubleSide }), rail = new THREE.Group(); rail.position.y = 0.15; scenery.add(rail);
  const put = (g, x, z, th, sx = 1) => { const mesh = new THREE.Mesh(g, mat); mesh.scale.set(TS * sx, TS, TS); mesh.position.set(x, 0, z); mesh.rotation.y = th; mesh.raycast = () => {}; rail.add(mesh); return mesh; };
  const atRaw = (s0, out) => {                                                                           // position and heading at arc length s0 along the line (clamped to its ends)
    const s = Math.min(total, Math.max(0, s0)); let lo = 0, hi = cum.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    const f = (s - cum[lo]) / ((cum[hi] - cum[lo]) || 1), ux = route[hi][0] - route[lo][0], uz = route[hi][1] - route[lo][1]; out.x = route[lo][0] + ux * f; out.z = route[lo][1] + uz * f; out.h = Math.atan2(-uz, ux); return out; };
  const O = {}, O2 = {}, at = atRaw;
  for (let s_ = 0; s_ < total; s_ += PIECE) { const len = Math.min(PIECE, total - s_); atRaw(s_ + len / 2, O); put(G['railway-track-straight'], O.x, O.z, O.h, len / (18 * TS)); }   // the track: straight pieces along the line
  // tunnels: wherever the track goes under a mountain it does so through a stone portal; the approach is a cutting with retaining walls that rise with the slope
  const tunnels = []; { let start = -1; for (let s_ = 0; s_ <= total; s_ += 2) { at(Math.min(s_, total), O); const inM = surf(O.x, O.z) > 0.3;
    if (inM && start < 0) start = s_; if ((!inM || s_ >= total) && start >= 0) { let a_ = start, b_ = s_ - 2; let pin = a_, pout = b_;
      for (let q = a_; q <= b_; q += 2) { at(q, O); if (surf(O.x, O.z) >= 10) { pin = q; break; } } for (let q = b_; q >= a_; q -= 2) { at(q, O); if (surf(O.x, O.z) >= 10) { pout = q; break; } }
      tunnels.push({ a: a_, b: b_, pin, pout }); start = -1; } } }
  const stone = new THREE.MeshStandardMaterial({ color: 0x80848b, roughness: 0.95, flatShading: true }), black = new THREE.MeshBasicMaterial({ color: 0x07070a });
  const portal = (sP, sB) => {                                                                            // a facade at track position sP, with wedge walls reaching out to sB where the ground is level again
    const dir = Math.sign(sB - sP), face = new THREE.Group(); at(sP, O); face.position.set(O.x, 0, O.z); face.rotation.y = O.h + (dir < 0 ? Math.PI : 0);   // local +x points out of the mountain
    const bx = (w, h, d, x, y, z, m = stone) => { const b_ = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b_.position.set(x, y, z); b_.raycast = () => {}; face.add(b_); return b_; };
    bx(3, 13, 3.2, 0, 6.5, 7.4); bx(3, 13, 3.2, 0, 6.5, -7.4); bx(3.4, 3, 18, 0, 13.4, 0); bx(0.6, 11.5, 12.4, -1.2, 5.75, 0, black);
    const n = Math.max(2, Math.ceil(Math.abs(sB - sP) / 4)); for (let i = 1; i <= n; i++) { const sq = sP + (sB - sP) * i / n; at(sq, O2); const h = surf(O2.x, O2.z) + 1.2, lx = (sq - sP) * dir;
      for (const z of [8.9, -8.9]) bx(4.2, h + 1, 2.6, lx, h / 2 - 0.5, z); }
    face.children.forEach(c => { c.position.x += 0; }); rail.add(face); };
  for (const t_ of tunnels) { portal(t_.pin, t_.a); portal(t_.pout, t_.b); }
  const underground = s_ => { const m = Math.min(total, Math.max(0, s_)); return tunnels.some(t_ => m >= t_.pin && m <= t_.pout); };
  // the two ends of the line: a buffer stop, and at the depot a loading platform and a sign
  { const buf = (sEnd, dir) => { at(sEnd, O); const b_ = new THREE.Group(); b_.position.set(O.x, 0, O.z); b_.rotation.y = O.h; const m_ = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.9 });
      const bx_ = (w, h, d, x, y, z) => { const q_ = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m_); q_.position.set(x, y, z); q_.raycast = () => {}; b_.add(q_); }; bx_(1.4, 4.2, 9, dir * 1.4, 2.1, 0); bx_(4, 0.8, 1.2, dir * -0.8, 1.2, 3.4); bx_(4, 0.8, 1.2, dir * -0.8, 1.2, -3.4); rail.add(b_); };
    buf(-2, -1); buf(total + 2, 1);
    at(0, O); const dpx = O.x, dpz = O.z, dh = O.h, pl = new THREE.Mesh(new THREE.BoxGeometry(60, 1.2, 12), new THREE.MeshStandardMaterial({ color: 0x8d9097, roughness: 0.95 }));
    pl.position.set(dpx + Math.cos(dh) * 40 + Math.sin(dh) * 10, 0.6, dpz - Math.sin(dh) * 40 + Math.cos(dh) * 10); pl.rotation.y = dh; pl.raycast = () => {}; rail.add(pl);   // beside the track, 10 m to one side, running 40 m along it
    const lab = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture('Atlantis Freight Depot', { bg: 'rgba(255,248,232,.95)', fg: '#2a2f38', border: '#8d9097' }), transparent: true, depthWrite: false, fog: false })); lab.scale.set(48, 12, 1); lab.position.set(pl.position.x, 14, pl.position.z); lab.raycast = () => {}; scenery.add(lab); }
  const sizeOf = n => G[n].userData.size[0] * TS, CAR = n => ({ n, len: sizeOf(n) });
  const consists = [{ name: 'Freight', speed: 14, s: 0, cars: ['cargo-train-front', 'cargo-train-wagon', 'cargo-train-container', 'cargo-train-coal-conta', 'cargo-train-container', 'cargo-train-wagon', 'cargo-train-front'].map(CAR) }];   // one train on one line: it hauls the ore from the mine to the depot and back; a locomotive at each end, so it never has to turn round
  const GAP = 0.25 * TS;                                                                // cars sit nearly buffer to buffer
  for (const tr of consists) {
    tr.meshes = tr.cars.map((c, i) => { const mesh = new THREE.Mesh(G[c.n], mat); mesh.scale.setScalar(TS); mesh.raycast = () => {}; if (i === tr.cars.length - 1) mesh.userData.flip = true; rail.add(mesh); return mesh; });   // the rear locomotive faces the other way
    tr.span = tr.cars.reduce((a, c) => a + c.len + GAP, -GAP); tr.s = tr.span + 14;                                              // it starts docked at the depot, 14 m from the buffers
    { let st = 'go', dir = 1, v = 0, wait = 0; const V = tr.speed, ACC = 1.4;                                                         // the default drive (the mine replaces it): shuttle between the depot and the far end of the line
      tr.drive = dt => { const target = dir > 0 ? total - 30 : tr.span + 14, d = Math.abs(target - tr.s);
        if (st === 'run') { v = Math.min(V, Math.sqrt(2 * ACC * d)); if (d < 0.25) { tr.s = target; v = 0; wait = 0; st = 'stop'; } } else if (st === 'stop') { v = 0; wait += dt; if (wait > 8) { dir = -dir; st = 'go'; } }
        else { v = Math.min(V, v + ACC * dt); if (v >= V && d > V * V / ACC) st = 'run'; } return v * dir; }; }
    const hit = new THREE.Mesh(new THREE.BoxGeometry(tr.span * 0.9, 3 * TS, 2.4 * TS).translate(0, 1.5 * TS, 0), new THREE.MeshBasicMaterial({ visible: false })); hit.userData.egg = eggs.length; eggMeshes.push(hit); rail.add(hit); tr.hit = hit;
    eggs.push({ hidden: false, tip: '<b>' + tr.name + '</b><br>Atlantis Railway · click', title: tr.name, rows: () => [['What', 'A train on the Atlantis Railway: scenery, not data']] });
  }
  scenery.userData.stepTrains = dt => {
    dt = Math.max(0, dt || 0);
    for (const tr of consists) {
      tr.s += (tr.drive ? tr.drive(dt) : tr.speed) * dt;                                                 // tr.s is the position of the front of the train; cars follow behind (the freight train drives itself: it stops at the mine)
      let back = 0;
      tr.cars.forEach((c, i) => {                                                                        // a car lies on the chord between the track points under its two ends, so on a curve it stays joined to its neighbours
        at(tr.s - back, O); at(tr.s - back - c.len, O2); back += c.len + GAP;
        const mesh = tr.meshes[i]; mesh.position.set((O.x + O2.x) / 2, 0, (O.z + O2.z) / 2);
        mesh.rotation.y = Math.atan2(-(O.z - O2.z), O.x - O2.x) + Math.PI + (mesh.userData.flip ? Math.PI : 0);   // the models' own fronts face -x
      });
      at(tr.s - tr.span / 2, O); tr.hit.position.set(O.x, 0, O.z); tr.hit.rotation.y = O.h;
    }
  };
  scenery.userData.stepTrains(0); scenery.userData.railway = { total, rect: r, trains: consists, tunnels, underground, GAP, pos: s_ => { const o = {}; at(s_, o); return o; } };
}).then(() => resolveRailway(), () => resolveRailway());

// --- Easter egg: a secret lab labeled "City Forum", tucked behind a gulch hill where the city cannot see it. Its sign only appears when you are close.
{
  const T = scenery.userData.terrain, S = scenery.userData.streams, peaks = T.peaks;
  const surf = (x, z) => { let y = 0; for (const p of peaks) { const d = Math.hypot(x - p.x, z - p.z); if (d < p.r) y = Math.max(y, p.h * (1 - d / p.r) - 2); } return y; };
  const hidden = (x, z) => { for (let k = 1; k < 40; k++) { const f = k / 40; if (surf(x + (E / 2 - x) * f, z + (E / 2 - z) * f) > 10) return true; } return false; };   // is a mountain between this spot and the city center?
  let spot = null;
  const flat = (x, z) => [[0, 0], [11, 0], [-11, 0], [0, 11], [0, -11]].every(([a, b]) => surf(x + a, z + b) < 1);
  for (const si of [1, 0]) for (let d = E * 0.1; d <= E * 0.9 && !spot; d += E * 0.02) for (let t = 0.1; t <= 0.9 && !spot; t += 0.02) for (const side of [1, -1]) {
    const p = S[si].curve.getPointAt(t), tg = S[si].curve.getTangentAt(t), x = p.x - tg.z * side * d, z = p.z + tg.x * side * d;
    if (!T.inLake(x, z) && flat(x, z) && hidden(x, z) && (x < -E * 0.1 || x > E * 1.1 || z < -E * 0.1 || z > E * 1.1)) { spot = [x, z]; break; }       // flat, outside the city, with a mountain between it and the city
  }
  if (spot) {
    const paintG = (geo, hex) => { const c_ = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
      for (let j = 0; j < n; j++) a.set([c_.r, c_.g, c_.b], j * 3); geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo; };
    const box = (w, h, d, hex, x, y, z = 0) => paintG(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex);
    const lab = new THREE.Group(), K = 4;
    lab.add(new THREE.Mesh(mergeGeometries([                                                                          // lit parts
      box(7.4, 0.3, 5.4, '#59616e', 0, 0.15), box(6, 2.2, 4, '#8a95a3', 0, 1.4), box(6.3, 0.15, 4.3, '#4a525e', 0, 2.55),
      paintG(new THREE.SphereGeometry(1.5, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(1.7, 2.6, 0), '#cfd8e3'), box(0.35, 1.2, 0.05, '#2a3340', 1.7, 3.3, 1.46),
      paintG(new THREE.CylinderGeometry(0.07, 0.07, 1.8, 6).translate(-2.1, 3.4, 0), '#8a95a3'), paintG(new THREE.SphereGeometry(0.75, 10, 6, 0, Math.PI * 2, 0, 1.0).rotateX(Math.PI / 2 + 0.5).translate(-2.1, 4.4, 0.2), '#e8eef5'),
      paintG(new THREE.CylinderGeometry(0.2, 0.2, 0.7, 8).translate(-2.3, 3.0, -1.2), '#8a95a3')]),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide, flatShading: true })));
    const glow = new THREE.Mesh(mergeGeometries([                                                                       // unlit, so they glow: door frame, windows, skylight, flask
      box(1.3, 1.85, 0.06, '#3ff0d0', 0, 1.12, 2.02), box(1.0, 1.6, 0.08, '#0b1a22', 0, 1.1, 2.04),
      ...[-2.1, -1.2, 1.2, 2.1].map(x => box(0.7, 0.5, 0.06, '#9ff7ff', x, 1.8, 2.03)), box(2.2, 0.1, 1.6, '#7fe9ff', -0.9, 2.68, 0.3),
      paintG(new THREE.SphereGeometry(0.5, 12, 8).translate(-2.3, 3.7, -1.2), '#5ff2b0'), paintG(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 8).translate(-2.3, 4.3, -1.2), '#5ff2b0')]),
      new THREE.MeshBasicMaterial({ vertexColors: true }));
    lab.add(glow);
    const bubbles = Array.from({ length: 6 }, (_, i) => { const b = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 5), new THREE.MeshBasicMaterial({ color: 0x9dffd8 })); b.userData.i = i; lab.add(b); return b; });
    lab.scale.setScalar(K);
    const [x, z] = spot; lab.position.set(x, 0, z); lab.rotation.y = Math.atan2(S[1].curve.getPoint(0.5).x - x, S[1].curve.getPoint(0.5).z - z);        // door toward the stream
    scenery.add(lab);
    const hitL = new THREE.Mesh(new THREE.BoxGeometry(7.4, 6, 5.4).translate(0, 3, 0), new THREE.MeshBasicMaterial({ visible: false })); lab.add(hitL);
    hitL.userData.egg = eggs.length; eggMeshes.push(hitL);
    eggs.push({ hidden: true, tip: '<b>City Forum</b><br>a secret lab', title: 'City Forum', rows: () => [['What', 'A secret lab']] });
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture('City Forum', { bg: 'rgba(8,24,30,.92)', fg: '#7ff7e0', border: '#3ff0d0' }), transparent: true, depthWrite: false, fog: false }));
    sign.scale.set(60, 15, 1); sign.position.set(x, 30, z); sign.renderOrder = 6; sign.raycast = () => {}; sign.visible = false; scenery.add(sign);
    scenery.userData.lab = lab;
    scenery.userData.stepLab = (time, cam) => {
      sign.visible = scenery.visible && cam.position.distanceTo(sign.position) < 420;                               // secret: the name only appears when you are near
      bubbles.forEach((b, i) => { const f = ((time * 0.5 + i / bubbles.length) % 1); b.position.set(-2.3 + Math.sin(time * 2 + i * 2) * 0.18, 4.5 + f * 2.4, -1.2 + Math.cos(time * 1.7 + i) * 0.18); b.scale.setScalar(1 - f * 0.7); });
    };
    scenery.userData.stepLab(0, camera);
  } else console.warn('no hidden spot found for the lab');
}

if (new URLSearchParams(location.search).get('scenery') === '0') scenery.visible = false;

// sim (x, y, z-up) -> three (x, z, y): sim y maps to three z (up is y)
const P = (x, y, z) => new THREE.Vector3(x, z, y);

// --- buildings: one InstancedMesh, unit box with its base on y=0
const B = city.buildings;
// highlight group (city.highlight): these people and buildings are always drawn in one color, whatever Color/Shade by says
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
$('nCot').textContent = cottages.length; $('cotRow').style.display = cottages.length ? '' : 'none';
$('cbCot').oninput = () => { cottageGroup.visible = $('cbCot').checked; };
const music = createMusic();                                           // optional: nothing plays (and no audio is created) until the box is ticked
$('cbMusic').oninput = () => { if ($('cbMusic').checked) music.start(); else music.stop(); };
$('musicVol').oninput = e => music.setVolume(+e.target.value);

// --- people: a simple human figure (~1.75 m, feet on y=0) built from primitives, drawn as two instanced meshes
function tinted(geo, shade) { // vertex color = how much of the instance color this part takes (pants darker than shirt)
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
// nobody may stand inside anybody else: bodies are about half a metre wide, so two people closer than SEP are pushed apart (same building and floor, or both on the street)
const SEP = 1.1, sameSpot = (a, b) => a[3] === b[3] && a[5] === b[5] && Math.abs(a[2] - b[2]) < 1;
const fixedIdx = new Set([...(city.stand || []).map(q_ => q_.id), ...(city.meet || []).flat()].map(id => ids.indexOf(id)).filter(i => i >= 0));   // the guitar player and the two who chat keep their places
const clampTo = p => { if (p[3] === 1 && B[p[5]]) { const b = B[p[5]]; p[0] = Math.min(b.x1 - 0.7, Math.max(b.x0 + 0.7, p[0])); p[1] = Math.min(b.y1 - 0.7, Math.max(b.y0 + 0.7, p[1])); } };
function separateAll() {
  for (let it = 0; it < 12; it++) {
    const grid = new Map(), key = (x, y) => Math.floor(x / SEP) + ',' + Math.floor(y / SEP); let moved = 0;
    people.forEach((p, i) => { const k = key(p[0], p[1]); (grid.get(k) || grid.set(k, []).get(k)).push(i); });
    people.forEach((p, i) => {
      const cx = Math.floor(p[0] / SEP), cy = Math.floor(p[1] / SEP);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const j of grid.get((cx + dx) + ',' + (cy + dy)) || []) {
        if (j <= i) continue; const q = people[j]; if (!sameSpot(p, q)) continue;
        let ex = q[0] - p[0], ey = q[1] - p[1], d = Math.hypot(ex, ey); if (d >= SEP) continue;
        if (d < 1e-6) { ex = Math.cos(i * 2.399); ey = Math.sin(i * 2.399); d = 1; }                       // exactly on top of each other: split along a fixed per-person direction
        const push = (SEP - d) / 2 + 0.01, ux = ex / d, uy = ey / d, fi = fixedIdx.has(i), fj = fixedIdx.has(j);
        if (fi && fj) continue;
        const wi = fi ? 0 : fj ? 2 : 1, wj = fj ? 0 : fi ? 2 : 1;
        p[0] -= ux * push * wi; p[1] -= uy * push * wi; q[0] += ux * push * wj; q[1] += uy * push * wj; clampTo(p); clampTo(q); moved++;
      }
    });
    if (!moved) break;
  }
}
separateAll();
function nudgeFrom(i) {                                                                             // a walker has just arrived: step clear of anyone already standing there
  const p = people[i];
  for (let it = 0; it < 4; it++) { let moved = false;
    for (let j = 0; j < people.length; j++) { if (j === i) continue; const q = people[j]; if (!sameSpot(p, q) || hidden[j]) continue;
      const ex = p[0] - q[0], ey = p[1] - q[1], d = Math.hypot(ex, ey); if (d >= SEP) continue;
      const ux = d < 1e-6 ? 1 : ex / d, uy = d < 1e-6 ? 0 : ey / d; p[0] += ux * (SEP - d + 0.01); p[1] += uy * (SEP - d + 0.01); clampTo(p); moved = true; }
    if (!moved) break; }
}
// The figure is split at its joints so the idle animation can move them: torso, two legs (pivot = hip), two arms in two segments (pivots = shoulder,
// elbow) and the head (pivot = neck). Every limb is modelled hanging straight down from its pivot at the origin; the pose rotates it about that pivot.
// In safe mode (no instancing) the old single rigid body + head is kept: one object per person per part would be far too many meshes.
const LIMBS = !SAFE;
const SH_X = 0.307, SH_Y = 1.408, HIP_X = 0.105, HIP_Y = 0.82, NECK_Y = 1.5, SEG = 0.31;
const limb = (r0, r1, len, shade) => tinted(new THREE.CylinderGeometry(r0, r1, len, 8).translate(0, -len / 2, 0), shade);
const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .7 });
const headMat = new THREE.MeshStandardMaterial({ color: SKIN, roughness: .8 });
const bodyMesh = makeInstanced(LIMBS ? mergeGeometries([tinted(new THREE.BoxGeometry(0.42, 0.6, 0.24).translate(0, 1.12, 0), 1), tinted(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 8).translate(0, 1.47, 0), 0.8)]) : bodyGeo, bodyMat, people.length, true);
const headMesh = makeInstanced(LIMBS ? headGeo.clone().translate(0, -NECK_Y, 0) : headGeo, headMat, people.length);
const rig = LIMBS ? {          // one instanced mesh per joint segment; A = the side with x < 0, B = x > 0
  legA: makeInstanced(limb(0.085, 0.065, 0.82, 0.35), bodyMat, people.length, true), legB: makeInstanced(limb(0.085, 0.065, 0.82, 0.35), bodyMat, people.length, true),
  upA: makeInstanced(limb(0.05, 0.045, SEG, 1), bodyMat, people.length, true), upB: makeInstanced(limb(0.05, 0.045, SEG, 1), bodyMat, people.length, true),
  foreA: makeInstanced(limb(0.045, 0.04, SEG, 1), bodyMat, people.length, true), foreB: makeInstanced(limb(0.045, 0.04, SEG, 1), bodyMat, people.length, true),
} : {};
const limbMeshes = Object.values(rig), colorMeshes = [bodyMesh, ...limbMeshes], personMeshes = [bodyMesh, headMesh, ...limbMeshes];
for (const mesh of personMeshes) { mesh.renderOrder = 1; scene.add(mesh); }
// long hair for people with a feminine first name (city.hair, decided in atlas/decisions.json): a cap, a curtain down the back and over the shoulders, riding on the head
const hairIdx = new Int32Array(people.length).fill(-1), hairWho = (city.hair || []).filter(id => !(city.regalia?.[id] || []).includes('bouffant')).map(id => ids.indexOf(id)).filter(i => i >= 0);   // anyone with their own hairdo (regalia 'bouffant') skips the generic long hair
const HAIR_OVERRIDE = { P139: '#8b7e70' };                              // Amy Peikoff: a blend of brown and gray (after the photo on her card)
hairWho.forEach((i, n) => { hairIdx[i] = n; });
const HAIR_COLORS = ['#2b1a10', '#4a2e1a', '#6b4423', '#8a5a2b', '#b98b3d', '#d8b26a', '#1a1a1a', '#8a3b1b'];
const hairGeo = (() => { const col = (g, hex) => { const c_ = new THREE.Color(hex); g.setAttribute('color', new THREE.BufferAttribute(Float32Array.from({ length: g.attributes.position.count * 3 }, (_, k) => [c_.r, c_.g, c_.b][k % 3]), 3)); return g; };
  const g = mergeGeometries([col(new THREE.SphereGeometry(0.126, 16, 10, 0, Math.PI * 2, 0, 0.95).translate(0, 1.6, 0), '#ffffff'),
    col(new THREE.SphereGeometry(0.127, 16, 12, Math.PI / 2 + 0.85, Math.PI * 2 - 1.7, 0, 2.3).translate(0, 1.6, 0), '#ffffff'),
    col(new THREE.CylinderGeometry(0.135, 0.175, 0.62, 16, 1, true, Math.PI - 1.9, 3.8).translate(0, 1.6 - 0.31, 0), '#ffffff')]);
  return LIMBS ? g.translate(0, -NECK_Y, 0) : g; })();
const hairMesh = makeInstanced(hairGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide }), Math.max(1, hairWho.length), true);
hairMesh.count = hairWho.length; hairMesh.renderOrder = 1; hairMesh.frustumCulled = false; hairMesh.traverse(o => { o.raycast = () => {}; }); scene.add(hairMesh);
const updMeshes = [...personMeshes, hairMesh];                     // meshes whose matrices change every frame (the hair is not pickable: it is not a person)
hairWho.forEach((i, n) => hairMesh.setColorAt(n, new THREE.Color(HAIR_OVERRIDE[ids[i]] || HAIR_COLORS[(+ids[i].slice(1) * 7 + 3) % HAIR_COLORS.length])));
if (hairMesh.instanceColor) hairMesh.instanceColor.needsUpdate = true;

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
  // Ayn Rand: short dark bob with straight bangs, dark intense eyes and heavy brows, black dress, gold dollar-sign brooch, cigarette holder
  hair: mergeGeometries([paint(new THREE.SphereGeometry(0.126, 16, 10, 0, Math.PI * 2, 0, 0.95).translate(0, 1.6, 0), '#1c1512'),
    paint(new THREE.SphereGeometry(0.127, 16, 12, Math.PI / 2 + 0.85, Math.PI * 2 - 1.7, 0, 2.3).translate(0, 1.6, 0), '#1c1512')]),
  // Barbara Branden Peikoff, after the first photo on barbarapeikoff.com: champagne blonde, full, swept-up and out, a high bouffant with side puffs and soft curled ends at the jaw, and bangs swept off the forehead
  bouffant: mergeGeometries([paint(new THREE.SphereGeometry(0.152, 18, 12, 0, Math.PI * 2, 0, 1.05).translate(0, 1.618, -0.01), '#e8d3a6'),
    paint(new THREE.SphereGeometry(0.154, 18, 12, Math.PI / 2 + 0.8, Math.PI * 2 - 1.6, 0, 2.15).translate(0, 1.6, -0.012), '#e8d3a6'),
    paint(new THREE.SphereGeometry(0.09, 12, 10).scale(0.75, 1.1, 1).translate(-0.128, 1.58, -0.012), '#f0e0bb'), paint(new THREE.SphereGeometry(0.09, 12, 10).scale(0.75, 1.1, 1).translate(0.128, 1.58, -0.012), '#f0e0bb'),
    paint(new THREE.SphereGeometry(0.04, 10, 8).translate(-0.118, 1.5, 0.012), '#dcc391'), paint(new THREE.SphereGeometry(0.04, 10, 8).translate(0.118, 1.5, 0.012), '#dcc391'),
    paint(new THREE.SphereGeometry(0.11, 12, 10).translate(0, 1.55, -0.085), '#dcc391'),
    paint(new THREE.SphereGeometry(0.1, 12, 10).scale(1.2, 0.7, 1.15).translate(0, 1.7, -0.02), '#f0e0bb')]),
  face: mergeGeometries([paint(new THREE.SphereGeometry(0.017, 8, 6).translate(-0.042, 1.608, 0.104), '#0b0b0b'), paint(new THREE.SphereGeometry(0.017, 8, 6).translate(0.042, 1.608, 0.104), '#0b0b0b'),
    paint(new THREE.BoxGeometry(0.058, 0.011, 0.012).rotateZ(0.12).translate(-0.045, 1.638, 0.104), '#120d0a'), paint(new THREE.BoxGeometry(0.058, 0.011, 0.012).rotateZ(-0.12).translate(0.045, 1.638, 0.104), '#120d0a'),
    paint(new THREE.BoxGeometry(0.05, 0.012, 0.01).translate(0, 1.545, 0.108), '#8a2a2a')]),
  dress: mergeGeometries([paint(new THREE.BoxGeometry(0.46, 0.62, 0.28).translate(0, 1.12, 0), '#141416'),
    paint(new THREE.CylinderGeometry(0.235, 0.34, 0.5, 16, 1, true).translate(0, 0.58, 0), '#141416'),
    paint(new THREE.CylinderGeometry(0.066, 0.056, 0.66, 8).rotateZ(0.12).translate(-0.27, 1.1, 0), '#141416'),
    paint(new THREE.CylinderGeometry(0.066, 0.056, 0.66, 8).rotateZ(-0.12).translate(0.27, 1.1, 0), '#141416'),
    paint(new THREE.CylinderGeometry(0.1, 0.075, 0.5, 8).translate(-0.105, 0.25, 0), '#1b1b1f'), paint(new THREE.CylinderGeometry(0.1, 0.075, 0.5, 8).translate(0.105, 0.25, 0), '#1b1b1f'),   // dark stockings
    paint(new THREE.BoxGeometry(0.09, 0.05, 0.285).translate(0, 1.43, 0), '#d9d2c3')]),   // pale collar
  dollarpin: mergeGeometries([paint(new THREE.CylinderGeometry(0.034, 0.034, 0.008, 16).rotateX(Math.PI / 2).translate(0.1, 1.3, 0.143), GOLD),
    paint(new THREE.BoxGeometry(0.006, 0.07, 0.006).translate(0.1, 1.3, 0.152), '#6b4b00'),
    paint(new THREE.TorusGeometry(0.0115, 0.004, 6, 12, Math.PI * 1.5).rotateZ(Math.PI * 0.75).translate(0.1, 1.312, 0.152), '#6b4b00'),
    paint(new THREE.TorusGeometry(0.0115, 0.004, 6, 12, Math.PI * 1.5).rotateZ(-Math.PI * 0.25).translate(0.1, 1.288, 0.152), '#6b4b00')]),
  holder: mergeGeometries([paint(new THREE.CylinderGeometry(0.006, 0.006, 0.24, 6).rotateX(Math.PI / 2 - 0.5).translate(0.33, 0.86, 0.14), '#101010'),
    paint(new THREE.CylinderGeometry(0.008, 0.008, 0.07, 6).rotateX(Math.PI / 2 - 0.5).translate(0.33, 0.915, 0.255), '#f2efe6'),
    paint(new THREE.SphereGeometry(0.009, 6, 4).translate(0.33, 0.94, 0.29), '#ff6a1a')]),
  robe: paint(new THREE.CylinderGeometry(0.27, 0.42, 1.38, 16, 1, true).translate(0, 0.74, 0), '#6a1fa8'),
  staff: mergeGeometries([paint(new THREE.CylinderGeometry(0.022, 0.022, 2.0, 8).translate(0.42, 1.0, 0.1), '#7a4a1e'),
    paint(new THREE.SphereGeometry(0.075, 12, 10).translate(0.42, 2.06, 0.1), GOLD)]),
};
const regalia = [];     // { mesh, who: [person index] }
{ const byKind = {};
  for (const [pid, kinds] of Object.entries(city.regalia || {})) { const i = city.ids.indexOf(pid); if (i < 0) continue;
    for (const k of kinds) if (REGALIA_GEO[k]) (byKind[k] ||= []).push(i); }
  for (const [k, who] of Object.entries(byKind)) {
    const mesh = makeInstanced(REGALIA_GEO[k], new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .5, metalness: ['robe', 'hair', 'bouffant', 'face', 'dress'].includes(k) ? 0 : .5, side: THREE.DoubleSide }), who.length);
    mesh.renderOrder = 1; mesh.traverse(o => { o.raycast = () => {}; }); mesh.frustumCulled = false; scene.add(mesh); regalia.push({ mesh, who });
  } }

const nIn = people.filter(p => p[3] === 1).length;
$('nIn').textContent = nIn; $('nSt').textContent = people.length - nIn;
let selected = -1;

// --- color / shade by a categorical variable (dropdowns in the HUD). Every variable maps a person to a category label;
// categories are ranked by head-count, the top 7 get palette colors and the rest are merged into "Other".
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
let colorVar = null, shadeVar = null;     // variable objects (null = default inside/street colors / no shading)
const shadeAt = (v, n) => n >= v.named ? 0.75 : 1 - 0.55 * n / Math.max(1, v.named - 1);   // Other / none stay mid-bright
const shadeFactor = (v, i) => shadeAt(v, v.cat[i]);
const baseColor = i => {
  if (HL && HL.people.has(i)) return c.set(HL.color);   // fixed color: ignores Color by and Shade by
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
// Pose of one person = NP numbers (radians), see LIFE below. Rotations are about each joint: x swings a limb forward (negative) / back (positive),
// z moves it sideways. REST is the pose people were drawn in before they had joints (arms hang tilted slightly in).
const NP = 19, IYAW = 5, REST = new Float32Array(NP);
const armAt = sgn => sgn < 0 ? 6 : 10, legAt = sgn => sgn < 0 ? 14 : 16;        // index of [shoulder x, shoulder z, elbow x, elbow z] / [hip x, hip z]
for (const sgn of [-1, 1]) REST[armAt(sgn) + 1] = -sgn * 0.12;
const pose = people.map(() => REST.slice());
const rigid = new Set();                                                          // people wearing regalia: those parts are rigid, so they only turn, never move limbs
for (const r of regalia) for (const n of r.who) rigid.add(n);
const mA = new THREE.Matrix4(), mB = new THREE.Matrix4(), mC = new THREE.Matrix4(), mU = new THREE.Matrix4(), eu = new THREE.Euler(), qq = new THREE.Quaternion(), v3 = new THREE.Vector3();
const rotM = (out, rx, ry, rz, order) => out.makeRotationFromEuler(eu.set(rx, ry, rz, order));
const at = (out, x, y, z) => out.makeTranslation(x, y, z);
const elSz = $('sz'), elIn = $('cbIn'), elSt = $('cbSt');
const LIMB_OF = LIMBS ? [{ up: rig.upA, fore: rig.foreA, leg: rig.legA }, { up: rig.upB, fore: rig.foreB, leg: rig.legB }] : [];
const hidden = new Uint8Array(people.length);     // 1 = indoors at home (a house, a castle or the apartment building): not drawn
const figOn = new Uint8Array(people.length);        // 1 = a ready-made character (figures.js) stands in for this person: the plain person is drawn tiny
const seated = new Uint8Array(people.length);     // 1 = sitting in a venue: the body is lowered onto the chair (the hips drop to seat height)
function placeOne(i) {            // matrices of one person from its current people[i] position + heading + pose
  const [x, y, z, kind, heading] = people[i], p = pose[i];
  const k = !hidden[i] && !figOn[i] && (kind === 1 ? elIn.checked : elSt.checked) ? +elSz.value : 0.0001;
  m.compose(P(x, y, z - (seated[i] ? 0.25 * k : 0)), q.setFromAxisAngle(UP, heading * Math.PI / 180 + p[IYAW]), sc.set(k, k, k));
  for (const r of regalia) { const n = r.who.indexOf(i); if (n >= 0) { r.mesh.setMatrixAt(n, m); r.mesh.instanceMatrix.needsUpdate = true; } }
  if (!LIMBS) { bodyMesh.setMatrixAt(i, m); headMesh.setMatrixAt(i, m); if (hairIdx[i] >= 0) hairMesh.setMatrixAt(hairIdx[i], m); return; }
  // upper body (torso, head, arms) hangs from the hips and can lean; legs hang from the hips of the base matrix
  mU.copy(m).multiply(at(mA, 0, HIP_Y, 0)).multiply(rotM(mA, p[0], 0, p[1], 'XYZ')).multiply(at(mA, 0, -HIP_Y, 0));
  bodyMesh.setMatrixAt(i, mU);
  headMesh.setMatrixAt(i, mA.copy(mU).multiply(at(mB, 0, NECK_Y, 0)).multiply(rotM(mB, p[2], p[3], p[4], 'YXZ')));
  if (hairIdx[i] >= 0) hairMesh.setMatrixAt(hairIdx[i], mA);
  for (const sgn of [-1, 1]) {
    const L = LIMB_OF[sgn < 0 ? 0 : 1], a = armAt(sgn), l = legAt(sgn);
    mA.copy(mU).multiply(at(mB, sgn * SH_X, SH_Y, 0)).multiply(rotM(mB, p[a], 0, p[a + 1], 'XYZ'));        // shoulder
    L.up.setMatrixAt(i, mA);
    L.fore.setMatrixAt(i, mC.copy(mA).multiply(at(mB, 0, -SEG, 0)).multiply(rotM(mB, p[a + 2], 0, p[a + 3], 'XYZ')));   // elbow
    L.leg.setMatrixAt(i, mA.copy(m).multiply(at(mB, sgn * HIP_X, HIP_Y, 0)).multiply(rotM(mB, p[l], 0, p[l + 1], 'XYZ')));   // hip
  }
}
function layoutPeople() {
  people.forEach((_, i) => {
    placeOne(i);
    const col = i === selected ? c.set(COL_SEL) : baseColor(i);
    for (const mesh of colorMeshes) mesh.setColorAt(i, col);
  });
  for (const mesh of updMeshes) { mesh.instanceMatrix.needsUpdate = true; mesh.boundingSphere = null; mesh.boundingBox = null; }
  for (const mesh of colorMeshes) mesh.instanceColor.needsUpdate = true;
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
  for (const [k, v] of Object.entries(meta)) if (k !== nameKey && k !== 'Relationships' && k !== 'Image') rows.push([k, linkify(String(v))]);
  const rels = Array.isArray(meta.Relationships) ? meta.Relationships : [];
  if (Object.keys(meta).length <= (nameKey ? 1 : 0) && !rels.length) rows.push(['Metadata', 'none yet']);
  const photo = /^https:\/\//i.test(meta.Image || '') ? `<img class="photo" src="${esc(meta.Image)}" alt="${esc(nameKey ? meta[nameKey] : 'Person')}" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '';   // the picture from the database; hidden if it fails to load
  $('card').innerHTML = `<h2><span>${esc(nameKey ? meta[nameKey] : 'Person')}</span><button id="x" aria-label="Close">\u2715</button></h2>${photo}<table>` +
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
  const links = [].concat(b.urls || []);
  if (links.length) rows.push(['Links', links.map(linkify).join('<br>')]);
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
// defaults: color = role type (Peikoffs always red), no shading (override: ?colorBy=..&shadeBy=..)
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
  { const m = scenery.userData.mats; m.mtMat.color.set(TH.mt); m.snowMat.color.set(TH.snow); m.lakeMat.color.set(TH.lake); m.streamMat.color.set(TH.lake); m.shoreMat.color.set(TH.shore); }
  hemi.color.set(TH.hemiSky); hemi.groundColor.set(TH.hemiGround); hemi.intensity = TH.hemi; sun.intensity = TH.sun;
  COL_IN = TH.inCol; COL_ST = TH.stCol; COL_SEL = TH.sel;
  ring.material.color.set(TH.sel); beam.material.color.set(TH.sel); outline.material.color.set(TH.sel);
  paintBuildings();
  for (const spr of signs.children) { spr.material.map.dispose(); spr.material.map = signTexture(spr.userData.text); spr.material.needsUpdate = true; }
  for (const k of Object.keys(varCache)) delete varCache[k];            // the Location palette uses the theme colors
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
{ const hud = $('hud'), tab = $('hudTab');                                                       // slide the whole menu off to the left (handy on a phone); a small tab brings it back
  const slide = away => { hud.classList.toggle('away', away); tab.classList.toggle('show', away); };
  $('hudSlide').onclick = () => slide(true); tab.onclick = () => slide(false); }
const HOME_VIEW = { c: camera.position.clone(), t: controls.target.clone() };                  // the starting camera, for "Reset view"
function stopCamera() {                                                                           // halt every camera movement: a fly-to, held keys, and the orbit's coasting
  fly = null; keys.clear();
  const d = controls.enableDamping; controls.enableDamping = false; controls.update(); controls.enableDamping = d;
}
function resetView() { fly = { t: 0, fromT: controls.target.clone(), fromC: camera.position.clone(), toT: HOME_VIEW.t.clone(), toC: HOME_VIEW.c.clone() }; }
$('camStop').onclick = stopCamera; $('camReset').onclick = resetView;
function flyToPoint(x, z, instant = false) {   // the minimap: look at the ground point (x, z) from the same angle and distance as now (instant while dragging on the map)
  let g = 0; for (const p of scenery.userData.terrain.peaks) { const d = Math.hypot(x - p.x, z - p.z); if (d < p.r) g = Math.max(g, p.h * (1 - d / p.r) - 2); }
  const toT = new THREE.Vector3(x, Math.max(20, g), z), off = camera.position.clone().sub(controls.target); off.y = Math.max(off.y, 6);
  const toC = toT.clone().add(off);
  if (instant) { fly = null; controls.target.copy(toT); camera.position.copy(toC); return; }
  fly = { t: 0, fromT: controls.target.clone(), fromC: camera.position.clone(), toT, toC };
}
scenery.userData.minimap = createMinimap({ camera, controls, scenery, buildings: B, highlighted: i => !!HL?.buildings.has(i), goTo: flyToPoint });   // a corner map: tap or drag to fly there
addEventListener('keydown', e => { if (document.activeElement === box) return; if (e.key === ' ') { e.preventDefault(); stopCamera(); } else if (e.key === 'Home') { e.preventDefault(); resetView(); } });
function secretKira() {                                              // Easter egg shortcut: fly to Kira Peikoff on the far side of the mountain and show her card
  const pr = scenery.userData.princess; if (!pr) return false;
  const f = Math.max(0.3, pr.scale.x / 26);                                   // she is Easter-egg sized on her ledge and person sized when she is out with Ason: keep the same framing
  const ry = pr.rotation.y, tgt = pr.position.clone().add(new THREE.Vector3(0, 16 * f, 0)), to = pr.position.clone().add(new THREE.Vector3(Math.sin(ry) * 62 * f, 40 * f, Math.cos(ry) * 62 * f));
  fly = { t: 0, fromT: controls.target.clone(), fromC: camera.position.clone(), toT: tgt, toC: to };
  const ei = eggs.findIndex(e => e.title === 'Kira Peikoff'); if (ei >= 0) selectEgg(eggs[ei]);
  return true;
}
const box = $('q'), list = $('results');
let hits = [], active = 0, cmdHits = [];
const COMMANDS = [['/speak', 'everyone follows Leonard to the Ford Hall Forum'], ['/salon', "Ayn Rand and her guests at the lakeside villa"], ['/home', 'everyone goes home'], ['/work', 'everyone goes back to work']];
const rank = (hay, t) => hay.startsWith(t) ? 0 : hay.includes(' ' + t) ? 1 : hay.includes(t) ? 2 : 3; // name start > word start > anywhere
function renderResults() {
  const t = fold(box.value.trim());
  if (t.startsWith('/')) {                                                                                   // a command: offer the matching slash commands
    const q = t.slice(1).split(/\s+/)[0]; cmdHits = COMMANDS.filter(c => c[0].slice(1).startsWith(q)); hits = cmdHits.map(c => ({ cmd: c[0] })); active = 0;
    list.innerHTML = cmdHits.map((c, n) => `<div data-n="${n}" class="${n === 0 ? 'on' : ''}"><b>${esc(c[0])}</b><span>${esc(c[1])}</span></div>`).join('') + (cmdHits.length ? '<div class="more">Enter runs it \u00b7 Tab completes</div>' : '<div class="more">Unknown command. Try /speak, /salon, /home or /work</div>');
    list.style.display = 'block'; return;
  }
  cmdHits = [];
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
  if (r.cmd) { runCommand(r.cmd); box.value = ''; list.style.display = 'none'; box.blur(); return; }
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
  } else if (e.key === 'Tab' && cmdHits.length && box.value.trim().startsWith('/')) {
    e.preventDefault(); box.value = cmdHits[active][0]; renderResults();                                    // complete the highlighted command
  } else if (e.key === 'Enter') { if (box.value.trim().startsWith('/')) { runCommand(cmdHits[active] && box.value.trim() !== cmdHits[active][0] ? cmdHits[active][0] : box.value.trim()); box.value = ''; list.style.display = 'none'; box.blur(); } else if (fold(box.value.trim()) === 'kp' && secretKira()) { box.value = ''; list.style.display = 'none'; box.blur(); } else pick(active); }   // a secret: KP + Enter flies to the princess
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
// --- doors and elevators: every building has a lit door on its south wall, and every building of two or more floors an elevator shaft just inside it. People use them (see paths.js): they walk to the
// elevator, ride down, leave by the door, walk the streets, come in by the next building's door, ride up. The cabin follows its rider.
const arch = makeArch(B, PITCHP);
const cabZ = new Float32Array(B.length), cabBusy = new Int32Array(B.length).fill(-1), walkRide = new Uint8Array(people.length);      // cabin height, last tick a cabin was ridden, "standing in an elevator"
const doorMesh = makeInstanced(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: 0xffcf5a, transparent: true, opacity: 0.9 }), B.length);
const shaftMesh = makeInstanced(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.14, depthWrite: false }), B.length);
const cabMesh = makeInstanced(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: 0x6fc7ff, transparent: true, opacity: 0.55, depthWrite: false }), B.length);
for (const mesh of [doorMesh, shaftMesh, cabMesh]) { mesh.frustumCulled = false; mesh.renderOrder = 2; mesh.traverse(o => { o.raycast = () => {}; }); scene.add(mesh); }
function placeCab(bi) { const a = arch[bi], k = +elSz.value, tall = B[bi].floors >= 2; cabMesh.setMatrixAt(bi, m.compose(P(a.ex, a.ey, cabZ[bi]), q.identity(), sc.set(tall ? 0.9 * k : 0, tall ? 1.9 * k : 0, tall ? 0.9 * k : 0))); cabMesh.instanceMatrix.needsUpdate = true; }
function layoutArch() {
  const k = +elSz.value;
  B.forEach((b, i) => {
    const a = arch[i];
    doorMesh.setMatrixAt(i, m.compose(P(a.cx, b.y0 - 0.05, 0), q.identity(), sc.set(1.1 * k, 2.0 * k, 0.3)));
    shaftMesh.setMatrixAt(i, m.compose(P(a.ex, a.ey, 0), q.identity(), b.floors >= 2 ? sc.set(1.0 * k, b.h, 1.0 * k) : sc.set(0, 0, 0)));
    placeCab(i);
  });
  for (const mesh of [doorMesh, shaftMesh]) mesh.instanceMatrix.needsUpdate = true;
}
layoutArch(); elSz.addEventListener('input', layoutArch);
function planPath(w) {            // the legs of one trip: elevator, door, sidewalk, streets, door, elevator
  const bA = w.route[w.k], nk = (w.k + 1) % w.route.length, bT = w.route[nk], T = B[bT];
  const tz = Math.floor(rnd(0, T.floors)) * city.floor_h;
  const legs = withBridges(planLegs({ B, arch, bA, bT, from: people[w.i].slice(0, 3), tx: rnd(T.x0 + 1, T.x1 - 1), ty: rnd(T.y0 + 1, T.y1 - 1), tz, o: w.off, pitch: PITCHP }));
  w.path = { legs, li: 0, d: 0, hold: legs.length ? legs[0].hold : 0, next: nk, walked: 0 };
  if (!legs.length) w.path.li = 0;
}
function stepWalkers(dt) {
  if (!walkers.length || !$('cbWalk').checked) return;
  const speed = +$('walkSpeed').value, k = Math.max(0.1, +elSz.value);
  for (const w of walkers) {
    const p = people[w.i];
    if (w.ev) { stepEv(w, dt, speed); continue; }                                                      // taking part in /speak or /salon
    if (w.phase === 'dwell') {
      w.wait -= dt;
      if (w.wait <= 0) { planPath(w); w.phase = 'walk'; }
      continue;
    }
    const P_ = w.path; let leg = P_.legs[P_.li];
    walkStamp[w.i] = tick;
    if (leg && P_.hold > 0) { P_.hold -= dt; walkRide[w.i] = 1; }                                       // waiting for the elevator
    else if (leg) {
      const spd = w.i === scootI ? speed * 2.4 : speed;                                                  // the scooter rider is faster
      P_.d += (leg.ride ? spd * 2.5 : spd) * dt;
      if (!leg.ride) P_.walked += spd * dt;
      const f = Math.min(1, P_.d / leg.len), a = leg.a, b = leg.b;
      p[0] = a[0] + (b[0] - a[0]) * f; p[1] = a[1] + (b[1] - a[1]) * f; p[2] = a[2] + (b[2] - a[2]) * f;
      walkRide[w.i] = leg.ride ? 1 : 0;
      if (leg.ride) { cabZ[leg.bi] = p[2]; cabBusy[leg.bi] = tick; placeCab(leg.bi); }
      else p[4] += wrap180(Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI - p[4]) * Math.min(1, dt * 12);   // turn to face where they are going
      if (P_.d >= leg.len) { P_.li++; P_.d = 0; P_.hold = P_.legs[P_.li]?.hold || 0; }
    }
    walkPh[w.i] = P_.walked / (k * 0.7);                                                                 // the walk cycle (stepLife) advances with distance walked
    if (P_.li >= P_.legs.length) { w.k = P_.next; p[5] = w.route[w.k]; nudgeFrom(w.i); w.phase = 'dwell'; w.wait = rnd(4, 14); w.path = null; walkRide[w.i] = 0; }
    placeOne(w.i);
  }
  for (let i = 0; i < B.length; i++) if (cabZ[i] > 0 && cabBusy[i] !== tick) { cabZ[i] = Math.max(0, cabZ[i] - 12 * dt); placeCab(i); }   // empty cabins sink back to the ground floor
  for (const mesh of updMeshes) { mesh.instanceMatrix.needsUpdate = true; mesh.boundingSphere = null; }
  if (selected >= 0 && walkers.some(w => w.i === selected)) placeRing();
}

// --- LIFE: people standing still are not statues. Each one runs a tiny state machine (idle / look around / stretch / yawn / hand on hip / cross legs /
// fold arms) and every state is just a target pose (angles for head, lean, shoulders, elbows, hips) that the current pose eases towards. Neighbours
// standing within talking distance are paired: now and then they turn to face each other and hold a conversation (the speaker gestures, the listener
// nods) and, when they stand close enough to reach, one puts a hand on the other's shoulder. Walkers swing arms and legs in time with the distance
// they cover. People with regalia (Ayn Rand's dress, a professor's jacket, ...) have rigid costume parts, so they only turn, they do not move limbs.
const anim = people.map(() => ({ s: 'idle', t0: -Math.random() * 6, dur: 0, side: Math.random() < .5 ? -1 : 1, ph: Math.random() * 100, pair: null, fold: false, think: false }));
const walkStamp = new Int32Array(people.length).fill(-1), walkPh = new Float32Array(people.length);
let tick = 0;
const smooth = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x), clamp01 = x => Math.max(0, Math.min(1, x)), wrap180 = d => ((d % 360) + 540) % 360 - 180;
const setArm = (T, sgn, sx, out, ex, outE = 0) => { const a = armAt(sgn); T[a] = sx; T[a + 1] = sgn * out; T[a + 2] = ex; T[a + 3] = sgn * outE; };   // out > 0 = away from the body
const setLeg = (T, sgn, sx, out) => { const l = legAt(sgn); T[l] = sx; T[l + 1] = sgn * out; };
const PAIR_D = 4.5;                                                  // neighbours closer than this (data units, same floor) can talk
const pairs = [];
{ const walking = new Set(walkers.map(w => w.i)), idx = people.map((_, i) => i).filter(i => !walking.has(i)), cand = [], used = new Set();
  for (let x = 0; x < idx.length; x++) for (let y = x + 1; y < idx.length; y++) {
    const i = idx[x], j = idx[y], a = people[i], b = people[j];
    if (a[3] !== b[3] || a[5] !== b[5] || Math.abs(a[2] - b[2]) > 0.5) continue;
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (d < PAIR_D) cand.push([d, i, j]);
  }
  cand.sort((a, b) => a[0] - b[0]);
  for (const [d, a, b] of cand) if (!used.has(a) && !used.has(b)) { used.add(a); used.add(b);
    pairs.push({ a, b, d, state: 'wait', next: Math.random() * 25, until: 0, spk: 0, swap: 0, touchBy: -1, touchUntil: 0, touchNext: 0 }); }
}
for (const [pa, pb] of city.meet || []) {                            // pairs the data wants chatting (data key `meet`: Amy Peikoff and Barbara Branden Peikoff stand between their buildings): they talk most of the time
  const i = city.ids.indexOf(pa), j = city.ids.indexOf(pb), pr = pairs.find(q => (q.a === i && q.b === j) || (q.a === j && q.b === i)); if (pr) { pr.chatty = true; pr.next = Math.random() * 2; } }
function nextState(i, a, t) {        // pick what a free person does next
  const r = Math.random(), ri = rigid.has(i);
  a.t0 = t; a.side = Math.random() < .5 ? -1 : 1; a.fold = false;
  if (r < .40 || (ri && r > .55)) { a.s = 'idle'; a.dur = 3 + Math.random() * 6; }
  else if (r < .54) { a.s = 'look'; a.dur = 2.6 + Math.random() * 2; }
  else if (r < .62) { a.s = 'stretch'; a.dur = 3.6; }
  else if (r < .68) { a.s = 'yawn'; a.dur = 3.2; }
  else if (r < .80) { a.s = 'hip'; a.dur = 6 + Math.random() * 8; }
  else { a.s = 'cross'; a.dur = 8 + Math.random() * 12; a.fold = Math.random() < .5; }
}
function stepPairs(t) {
  const k = +elSz.value;
  for (const pr of pairs) {
    const A = anim[pr.a], Bn = anim[pr.b];
    if (pr.state === 'wait') {
      if (t < pr.next || walkStamp[pr.a] === tick || walkStamp[pr.b] === tick) continue;
      pr.state = 'talk'; pr.until = t + (pr.chatty ? 50 + Math.random() * 30 : 14 + Math.random() * 26); pr.spk = Math.random() < .5 ? 0 : 1; pr.swap = t + 3 + Math.random() * 4; pr.touchNext = t + 5 + Math.random() * 8; pr.touchBy = -1;
      for (const w of [A, Bn]) { w.pair = pr; w.s = 'talk'; w.t0 = t; w.dur = 1e9; w.think = Math.random() < .25; w.side = Math.random() < .5 ? -1 : 1; }
    } else if (t >= pr.until) {
      pr.state = 'wait'; pr.next = t + (pr.chatty ? 2 + Math.random() * 4 : 10 + Math.random() * 50); pr.touchBy = -1;
      for (const w of [A, Bn]) { w.pair = null; w.s = 'idle'; w.t0 = t; w.dur = 1.5 + Math.random() * 2; }
    } else {
      if (t >= pr.swap) { pr.spk = 1 - pr.spk; pr.swap = t + 3 + Math.random() * 5; }
      if (t >= pr.touchNext) {                                       // a hand on the shoulder, but only if they stand within arm's reach
        if (pr.d / k < 0.85) { pr.touchBy = Math.random() < .5 ? pr.a : pr.b; pr.touchUntil = t + 2.6 + Math.random() * 2; pr.touchNext = t + 12 + Math.random() * 20; }
        else pr.touchNext = t + 8;
      }
    }
  }
}
function aim(T, i, a, t, k) {        // fill T with the pose person i wants right now
  T.set(REST);
  if (seated[i]) { a.s = 'sit'; a.pair = null; } else if (evLecture === i) { a.s = 'lecture'; a.pair = null; } else if (i === guitarI && walkStamp[i] !== tick) { a.s = 'guitar'; a.pair = null; } else if (i === scootI && a.s === 'walk' && !walkRide[i]) a.s = 'scoot';
  const el = t - a.t0, e = smooth(Math.min(el, a.dur - el) / 0.9), ph = a.ph, sd = a.side, breath = Math.sin(t * 1.7 + ph), ri = rigid.has(i);
  switch (a.s) {
    case 'idle':
      T[0] = 0.012 + breath * 0.012; T[1] = Math.sin(t * 0.35 + ph) * 0.03; T[2] = Math.sin(t * 0.4 + ph * 2) * 0.04; T[3] = Math.sin(t * 0.27 + ph) * 0.15;
      T[armAt(-1)] = Math.sin(t * 0.9 + ph) * 0.04; T[armAt(1)] = -T[armAt(-1)]; break;
    case 'look': T[3] = sd * 0.9 * e; T[IYAW] = sd * 0.35 * e; T[2] = 0.05 * e; break;
    case 'stretch':
      setArm(T, -1, -2.85, 0.18, 0); setArm(T, 1, -2.85, 0.18, 0); setLeg(T, -1, 0, 0.05); setLeg(T, 1, 0, 0.05);
      T[0] = -0.14; T[2] = -0.35; T[armAt(-1)] += Math.sin(t * 13) * 0.015; T[armAt(1)] += Math.sin(t * 13 + 1) * 0.015; break;
    case 'yawn':
      setArm(T, sd, -0.75, 0.1, -2.5); T[0] = -0.07; T[2] = -0.38 * smooth((a.dur * 0.8 - el) / 0.5); break;
    case 'hip':
      setArm(T, sd, 0, 0.8, 0, -1.55); setLeg(T, sd, 0, 0.1); T[1] = 0.05 * sd; T[0] = breath * 0.01; T[3] = Math.sin(t * 0.3 + ph) * 0.2; break;
    case 'cross':
      setLeg(T, sd, -0.1, -0.34); setLeg(T, -sd, 0, 0.04); T[1] = -0.04 * sd; T[0] = 0.015 + breath * 0.01; T[3] = Math.sin(t * 0.3 + ph) * 0.2;
      if (a.fold) { setArm(T, -1, -0.45, -0.05, -2.2, -1.0); setArm(T, 1, -0.45, -0.05, -2.2, -1.0); } break;
    case 'talk': {
      const pr = a.pair, mine = pr.a === i ? 0 : 1, spk = pr.spk === mine, touching = pr.touchBy === i && t < pr.touchUntil, touched = pr.touchBy === (mine ? pr.a : pr.b) && t < pr.touchUntil;
      T[0] = 0.02 + breath * 0.008;
      if (touching) { setArm(T, sd, -1.5, 0, -clamp01((0.62 - pr.d / k) * 3.5) * 1.3); T[0] = 0.05; }
      else if (spk) { setArm(T, sd, -0.75 + Math.sin(t * 2.6 + ph) * 0.35, 0.25, -1.15 + Math.sin(t * 4.1 + ph) * 0.45); T[armAt(-sd)] = Math.sin(t * 1.7 + ph) * 0.1; }
      else if (a.think) setArm(T, sd, -0.5, 0, -2.3);
      T[2] = touched ? 0.1 : spk ? Math.sin(t * 3.1 + ph) * 0.07 : 0.05 + Math.max(0, Math.sin(t * 1.25 + ph)) * 0.14; T[3] = Math.sin(t * 0.9 + ph) * 0.12; break; }
    case 'sit':                                                                      // in a chair: legs forward, hands in the lap, now and then a look around
      setLeg(T, -1, -1.45, 0.04); setLeg(T, 1, -1.45, 0.04); setArm(T, -1, -0.5, 0.06, -1.05); setArm(T, 1, -0.5, 0.06, -1.05);
      T[0] = 0.02 + breath * 0.008; T[2] = 0.08; T[3] = Math.sin(t * 0.3 + ph) * 0.2; break;
    case 'lecture':                                                                  // the speaker: one hand gesturing, a few steps' worth of rocking
      setArm(T, sd, -0.75 + Math.sin(t * 2.6 + ph) * 0.35, 0.25, -1.15 + Math.sin(t * 4.1 + ph) * 0.45); T[armAt(-sd)] = Math.sin(t * 1.7 + ph) * 0.1;
      T[0] = 0.03; T[2] = Math.sin(t * 3.1 + ph) * 0.07; T[3] = Math.sin(t * 0.9 + ph) * 0.2; break;
    case 'guitar':                                                                   // playing: the left hand frets near the neck, the right forearm strums over the body
      setArm(T, 1, -0.78, 0.18, -0.2); setArm(T, -1, -0.38, 0.05, -0.55 + Math.sin(t * 8) * 0.22); setLeg(T, 1, 0, 0.08); setLeg(T, -1, 0, 0.08);
      T[0] = 0.03 + breath * 0.008; T[2] = 0.2; T[3] = 0.4 + Math.sin(t * 0.7 + ph) * 0.08; break;
    case 'scoot':                                                                    // on a scooter: both hands on the handlebar, leaning in, now and then a push
      setArm(T, -1, -1.05, 0.06, -0.2); setArm(T, 1, -1.05, 0.06, -0.2); setLeg(T, 1, 0, 0.05); setLeg(T, -1, 0.35 * Math.max(0, Math.sin(t * 2.2)), 0.05);
      T[0] = 0.12; T[2] = 0.05; break;
    case 'walk': {
      if (walkRide[i]) { T[0] = 0.01 + breath * 0.006; break; }                       // standing in the elevator
      const w = Math.sin(walkPh[i]);
      setLeg(T, -1, w * 0.6, 0); setLeg(T, 1, -w * 0.6, 0); setArm(T, -1, -w * 0.5, -0.05, -0.25); setArm(T, 1, w * 0.5, -0.05, -0.25);
      T[0] = 0.06; T[2] = Math.sin(walkPh[i] * 2) * 0.02; break; }
  }
  if (ri) { const yaw = T[IYAW]; T.set(REST); T[IYAW] = a.s === 'idle' ? Math.sin(t * 0.3 + ph) * 0.12 : yaw; if (seated[i]) { setLeg(T, -1, -1.45, 0.04); setLeg(T, 1, -1.45, 0.04); } return; }       // costume parts are rigid: turn only (a seated costumed person still sits: the body is lowered with the costume and the legs go forward)
  if (a.s !== 'idle' && a.s !== 'talk' && a.s !== 'walk' && a.s !== 'guitar' && a.s !== 'scoot' && a.s !== 'sit' && a.s !== 'lecture') for (let j = 0; j < NP; j++) T[j] = REST[j] + (T[j] - REST[j]) * (j === IYAW || a.s === 'look' ? 1 : e);
}
const T_ = new Float32Array(NP);
function stepLife(dt, t) {
  const on = $('cbLife').checked, show = [elSt.checked, elIn.checked], kk = 1 - Math.exp(-dt * 9), k = +elSz.value;
  if (on) stepPairs(t);
  for (let i = 0; i < people.length; i++) {
    const a = anim[i], p = pose[i], pe = people[i], walking = walkStamp[i] === tick;
    if (!show[pe[3] === 1 ? 1 : 0]) continue;
    if (!on && !walking) {                                           // switched off: ease back to the old rigid stance
      let moving = false; for (let j = 0; j < NP; j++) if (Math.abs(p[j] - REST[j]) > 1e-3) { p[j] += (REST[j] - p[j]) * kk; moving = true; }
      if (moving) placeOne(i);
      continue;
    }
    if (walking) { if (a.s !== 'walk') { a.pair = null; a.s = 'walk'; } }
    else if (a.s === 'walk') { a.s = 'idle'; a.t0 = t; a.dur = 1 + Math.random() * 3; }
    else if (!a.pair && t - a.t0 >= a.dur) nextState(i, a, t);
    aim(T_, i, a, t, k);
    if (a.s === 'talk') { const o = people[a.pair.a === i ? a.pair.b : a.pair.a]; pe[4] += wrap180(Math.atan2(o[0] - pe[0], o[1] - pe[1]) * 180 / Math.PI - pe[4]) * (1 - Math.exp(-dt * 2.5)); }
    for (let j = 0; j < NP; j++) p[j] += (T_[j] - p[j]) * kk;
    placeOne(i);
  }
  for (const mesh of updMeshes) mesh.instanceMatrix.needsUpdate = true;
}

// --- ready-made characters for a few named people (models.json "person_P1" ...): drawn while the person stands or walks; seated, or playing the guitar, the plain person is drawn
const figs = [];
for (const id of ['P1', 'P2', 'P4', 'P139']) { const i = ids.indexOf(id); if (i < 0) continue;
  modelFile('person_' + id).then(u => u && loadFigure3d(u)).then(f => { if (!f) return; f.root.visible = false; f.root.userData.person = i; scene.add(f.root); figs.push({ i, f }); }); }
function stepFigures(dt) {
  const spd = Math.min(3, Math.max(0.5, (+$('walkSpeed').value || 1.5) / 1.5)), k = +elSz.value;
  for (const { i, f } of figs) {
    const pe = people[i], on = figureActive({ shown: (pe[3] === 1 ? elIn : elSt).checked, hidden: hidden[i], seated: seated[i], playing: i === guitarI && walkStamp[i] !== tick });
    if (on !== !!figOn[i]) { figOn[i] = on ? 1 : 0; f.root.visible = on; placeOne(i); }
    if (!on) continue;
    f.root.position.set(pe[0], pe[2], pe[1]); f.root.rotation.y = pe[4] * Math.PI / 180; f.root.scale.setScalar(fitScale(f.height, k));
    f.play(walkStamp[i] === tick ? 'walk' : 'idle', spd); f.mixer.update(dt);
  }
}
const figRoots = () => figs.filter(g => g.f.root.visible).map(g => g.f.proxy);
const figIndex = o => { for (let n = o; n; n = n.parent) if (n.userData.person !== undefined) return n.userData.person; return -1; };

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
  const plain = ray.intersectObjects(personMeshes, true)[0], fr = figRoots(), fig = fr.length ? ray.intersectObjects(fr, true)[0] : null, hit = fig && (!plain || fig.distance < plain.distance) ? fig : plain;
  if (!hit) return -1;
  if (bMat.opacity > 0.95) { const wall = ray.intersectObject(bMesh, true)[0]; if (wall && wall.distance < hit.distance) return -1; }
  return hit === fig ? figIndex(fig.object) : instOf(hit);
}
function pickFish() {   // a website fish under the cursor: { w, distance } or null
  if (!scenery.visible || !fish.length) return null;
  const h = ray.intersectObjects(fishGroup.children, true)[0];
  return h ? { f: fish[h.object.userData.fish], distance: h.distance } : null;
}
function pickCottage() {   // a social-group cottage under the cursor: { c, distance } or null
  if (!scenery.visible || !cottageGroup.visible || !cottages.length) return null;
  const h = ray.intersectObjects(cottageGroup.children, false)[0];
  return h ? { c: cottages[h.object.userData.cottage], distance: h.distance } : null;
}
function pickEgg() {   // an Easter egg under the cursor (Kira, the toy pirate ship, the secret lab, Midas's plane): { e, distance } or null. Eggs behind a mountain cannot be reached.
  if (!scenery.visible || !eggMeshes.length) return null;
  const h = ray.intersectObjects(eggMeshes, false)[0]; if (!h) return null;
  const e = eggs[h.object.userData.egg], wall = e.hidden && ray.intersectObjects(mountains, false)[0];
  return wall && wall.distance < h.distance ? null : { e, distance: h.distance };
}
function selectEgg(e) {
  selected = -1; layoutPeople(); outline.visible = false;
  $('card').innerHTML = `<h2><span>${esc(e.title)}</span><button id="x" aria-label="Close">\u2715</button></h2><table>` + e.rows().map(([k, v]) => `<tr><td>${esc(k)}</td><td>${/^<|https?:/.test(v) ? v : esc(v)}</td></tr>`).join('') + `</table>`;
  $('card').style.display = 'block'; $('card').scrollTop = 0; $('x').onclick = () => select(-1);
}
const WHY = { spam_takeover: 'taken over by spam', hijacked: 'domain taken over by someone else', for_sale: 'domain is for sale', dns_failed: 'domain no longer resolves', dead_archived: 'gone; only an archived copy survives', unreachable: 'no longer reachable', repurposed: 'repurposed for something unrelated', stale: 'abandoned' };
function groupRows(g) {
  const b = g.org_id != null ? B.find(x => x.org_id === g.org_id) : null, pl = (COTTAGE_PLATFORM[g.platform] || [g.platform])[0];
  return [['Platform', esc(pl + (g.kind === 'community' ? ' community' : ' group'))], g.where && ['Where', esc(g.where)], g.members != null && ['Members', g.members.toLocaleString()],
    g.private && ['Access', 'private group'], b && ['Organization', esc(b.name)], g.about && ['About', esc(g.about)], g.url && ['Link', linkify(g.url)]].filter(Boolean);
}
function selectCottage(c) {
  selected = -1; layoutPeople(); outline.visible = false;
  $('card').innerHTML = `<h2><span>${esc(c.g.name)}</span><button id="x" aria-label="Close">\u2715</button></h2><table>` + groupRows(c.g).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('') + `</table>`;
  $('card').style.display = 'block'; $('card').scrollTop = 0; $('x').onclick = () => select(-1);
}
function fishOwner(w) {
  const b = w.org_id != null ? B.find(x => x.org_id === w.org_id) : null, pm = w.person_id != null ? city.meta?.['P' + w.person_id]?.Name : null;
  return [b && ['Organization', esc(b.name)], pm && ['Person', esc(pm)]].filter(Boolean);
}
function selectFish(f) {
  selected = -1; layoutPeople(); outline.visible = false;
  const w = f.w, rows = w.defunct
    ? [['Status', 'defunct: ' + esc(WHY[w.why] || w.why || 'no longer the original site')], ['Kind', esc(w.type || 'website')], ...fishOwner(w), ['Was at', esc(w.url)], w.archive && ['Archive copy', linkify(w.archive)]].filter(Boolean)   // the dead address is shown as text, never as a link
    : [['Kind', esc(w.type || 'website')], ...fishOwner(w), ['Link', linkify(w.url)]];
  $('card').innerHTML = `<h2><span>${esc(w.title || w.url)}</span><button id="x" aria-label="Close">\u2715</button></h2><table>` + rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('') + `</table>`;
  $('card').style.display = 'block'; $('card').scrollTop = 0; $('x').onclick = () => select(-1);
}
const personLabel = i => index[i]?.label || ids[i] || 'this person';   // `index` (the search list) is defined further down, read only when called
const chat = createChat({ nameOf: personLabel, idOf: i => ids[i], toast, details: i => select(i) });
if (new URLSearchParams(location.search).has('admin')) chat.admin();                      // ?admin: the admin sign-in box (same as typing /admin)
let lastTap = null;     // for double click / double tap on a person
let down = null, pressTimer = 0, pressed = false;
const el = renderer.domElement;
el.style.webkitTouchCallout = 'none'; el.style.userSelect = 'none'; el.style.webkitUserSelect = 'none';   // a long press on a phone must not select text or pop up the browser's own menu
function nearestPerson(x, y, r) {   // a fingertip is wider than a person: the visible person whose head is nearest the touch, within r pixels (and not hidden behind a wall)
  const k = +$('sz').value, v3_ = new THREE.Vector3(); let best = -1, bd = r * r;
  for (let i = 0; i < people.length; i++) { const p = people[i]; if (hidden[i] || !(p[3] === 1 ? elIn.checked : elSt.checked)) continue;
    v3_.set(p[0], p[2] + 0.9 * k, p[1]).project(camera); if (v3_.z > 1) continue;
    const d = ((v3_.x + 1) / 2 * innerWidth - x) ** 2 + ((1 - v3_.y) / 2 * innerHeight - y) ** 2; if (d < bd) { bd = d; best = i; } }
  if (best >= 0 && bMat.opacity > 0.95) { const p = people[best], tgt = new THREE.Vector3(p[0], p[2] + 0.9 * k, p[1]), dist = camera.position.distanceTo(tgt); ray.set(camera.position, tgt.sub(camera.position).normalize()); const wall = ray.intersectObject(bMesh, true)[0]; if (wall && wall.distance < dist - 0.5) return -1; }
  return best;
}
function personAt(e) { setRay(e); const pi = pickPerson(); return pi >= 0 || e.pointerType === 'mouse' ? pi : nearestPerson(e.clientX, e.clientY, 28); }   // touch and pen get a fingertip's worth of slack
el.addEventListener('pointerdown', e => {
  down = [e.clientX, e.clientY]; pressed = false; clearTimeout(pressTimer);
  if (!e.isPrimary || e.pointerType === 'mouse' && e.button !== 0) return;
  const pi = personAt(e), x = e.clientX, y = e.clientY;                                                // press and hold on a person (a force press on a phone): the person menu
  if (pi >= 0) pressTimer = setTimeout(() => { pressed = true; down = null; lastTap = null; chat.menu(pi, x, y); }, LONG_PRESS_MS);
});
el.addEventListener('pointermove', e => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > LONG_PRESS_PX) clearTimeout(pressTimer); });
el.addEventListener('pointercancel', () => { clearTimeout(pressTimer); down = null; });
el.addEventListener('contextmenu', e => { e.preventDefault(); const pi = personAt(e); if (pi >= 0) { clearTimeout(pressTimer); pressed = true; chat.menu(pi, e.clientX, e.clientY); } });   // right-click
$('card').addEventListener('pointerup', e => {                                                         // the first tap opens the card over the spot, so the second tap of a double tap lands on the card
  const t = { pi: lastTap ? lastTap.pi : -1, t: performance.now(), x: e.clientX, y: e.clientY };
  if (isDoubleTap(lastTap, t)) { lastTap = null; chat.menu(t.pi, t.x, t.y); } });
el.addEventListener('pointerup', e => {
  clearTimeout(pressTimer); if (pressed) { pressed = false; down = null; return; }                    // the long press already opened the menu
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > (e.pointerType === 'mouse' ? 5 : 12)) { down = null; return; } // it was a drag (a finger wobbles more than a mouse)
  down = null; setRay(e);
  { const t = { pi: personAt(e), t: performance.now(), x: e.clientX, y: e.clientY }; if (isDoubleTap(lastTap, t)) { lastTap = null; chat.menu(t.pi, t.x, t.y); return; } lastTap = t; }
  const pi = pickPerson(), sg = pi < 0 ? pickSign() : -1, bh = pi < 0 && sg < 0 && ray.intersectObject(bMesh, true)[0], fh = pi < 0 && sg < 0 ? pickFish() : null, ch = pi < 0 && sg < 0 ? pickCottage() : null, eh = pi < 0 && sg < 0 ? pickEgg() : null;
  if (eh && (!bh || eh.distance < bh.distance) && (!fh || eh.distance < fh.distance) && (!ch || eh.distance < ch.distance)) selectEgg(eh.e);
  else if (ch && (!bh || ch.distance < bh.distance) && (!fh || ch.distance < fh.distance)) selectCottage(ch.c);
  else if (fh && (!bh || fh.distance < bh.distance)) selectFish(fh.f);
  else if (pi >= 0) select(pi); else if (sg >= 0) selectBuilding(sg); else if (bh) selectBuilding(instOf(bh)); else select(-1);
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
  const fh = pi < 0 ? pickFish() : null, ch = pi < 0 ? pickCottage() : null, eh = pi < 0 ? pickEgg() : null;
  el.style.cursor = pi >= 0 || pickSign() >= 0 || fh || ch || eh ? 'pointer' : '';
  const hit = pi < 0 && ray.intersectObject(bMesh, true)[0];
  if (eh && (!hit || eh.distance < hit.distance) && (!fh || eh.distance < fh.distance) && (!ch || eh.distance < ch.distance)) {
    tip.innerHTML = eh.e.tip; tip.style.left = e.clientX + 14 + 'px'; tip.style.top = e.clientY + 14 + 'px'; tip.style.display = 'block'; return;
  }
  if (ch && (!hit || ch.distance < hit.distance) && (!fh || ch.distance < fh.distance)) {
    const g = ch.c.g;
    tip.innerHTML = `<b>${esc(g.name)}</b><br>${esc((COTTAGE_PLATFORM[g.platform] || [g.platform])[0])} ${g.kind === 'community' ? 'community' : 'group'}${g.members != null ? ' \u00b7 ' + g.members.toLocaleString() + ' members' : ''}`;
    tip.style.left = e.clientX + 14 + 'px'; tip.style.top = e.clientY + 14 + 'px'; tip.style.display = 'block'; return;
  }
  if (fh && (!hit || fh.distance < hit.distance)) {
    const w = fh.f.w;
    tip.innerHTML = `<b>${esc(w.title || w.url)}</b><br>${w.defunct ? 'defunct website \u00b7 ' + esc(WHY[w.why] || '') : 'website \u00b7 ' + esc(w.type || '')}`;
    tip.style.left = e.clientX + 14 + 'px'; tip.style.top = e.clientY + 14 + 'px'; tip.style.display = 'block'; return;
  }
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
// --- props (models.json "guitar", "scooter", "car", "motorcycle"): Ason Peikoff plays his guitar outside Postsocialist Press, one pedestrian rides a scooter, and a car lot of Range Rovers and motorcycles waits on open ground.
const guitarI = (() => { const s_ = (city.stand || []).find(q_ => q_.prop === 'guitar'); return s_ ? ids.indexOf(s_.id) : -1; })();
let scootI = (() => { const red = new Set(city.highlight?.people || []), w = walkers.find(w_ => !rigid.has(w_.i) && !red.has(ids[w_.i]) && w_.i !== guitarI); return w ? w.i : -1; })();
const guitarObj = new THREE.Group(), scooterObj = new THREE.Group(); for (const o_ of [guitarObj, scooterObj]) { o_.visible = false; o_.matrixAutoUpdate = false; scene.add(o_); }
for (let n_ = pairs.length - 1; n_ >= 0; n_--) if (pairs[n_].a === guitarI || pairs[n_].b === guitarI) pairs.splice(n_, 1);   // he plays, he does not chat
modelFile('guitar').then(u => u && loadScene(u, 0.95, 'y', true)).then(g_ => { if (g_) guitarObj.add(g_); });
modelFile('scooter').then(u => u && loadScene(u, 1.0, 'y', false)).then(g_ => { if (g_) { g_.rotation.y = Math.PI; scooterObj.add(g_); } });   // the model's handlebar is at -z; the rider faces +z
const gDir = new THREE.Vector3(0.88, 0.32, 0.30).normalize(), gX = new THREE.Vector3(0, 0, 1), gZ = new THREE.Vector3(), gBasis = new THREE.Matrix4();   // the neck points to the player's left, up and forward
gX.addScaledVector(gDir, -gX.dot(gDir)).normalize(); gZ.crossVectors(gX, gDir); gBasis.makeBasis(gX, gDir, gZ).setPosition(0.08, 0.98, 0.27);
function stepProps() {
  const show = elSt.checked, k = +elSz.value;
  if (guitarI >= 0) { const on = !!guitarObj.children.length && show && $('cbLife').checked && walkStamp[guitarI] !== tick && !seated[guitarI]; guitarObj.visible = on;
    if (on) { const [x, y, z, , h] = people[guitarI]; m.compose(P(x, y, z), q.setFromAxisAngle(UP, h * Math.PI / 180 + pose[guitarI][IYAW]), sc.set(k, k, k)).multiply(gBasis); guitarObj.matrix.copy(m); guitarObj.matrixWorldNeedsUpdate = true; } }
  if (scootI >= 0) { const p_ = people[scootI], out = !B.some(b => p_[0] > b.x0 - 0.5 && p_[0] < b.x1 + 0.5 && p_[1] > b.y0 - 0.5 && p_[1] < b.y1 + 0.5), on = !!scooterObj.children.length && $('cbWalk').checked && elIn.checked && out && !walkRide[scootI] && walkStamp[scootI] === tick;
    scooterObj.visible = on;
    if (on) { m.compose(P(p_[0], p_[1], p_[2]), q.setFromAxisAngle(UP, p_[4] * Math.PI / 180), sc.set(k, k, k)).multiply(mA.makeTranslation(0, 0, 0.1)); scooterObj.matrix.copy(m); scooterObj.matrixWorldNeedsUpdate = true; } }
}
// --- the Atlantis Mine (issue #81): a mine shaft at the foot of a mountain beside the railway. A few people with no organization (they stood on the sidewalks) work it: they carry ore
// out of the shaft to a pile beside the track. The freight train stops there, the pile and the miners' loads go into its open (coal) car, and the train leaves loaded. When the loaded car
// is out of sight (in a tunnel, or off screen and well away from the mine) the ore is gone, so the train comes back empty and the process repeats.
const minerSet = new Set(), miners = [];
let stepMine = () => {};
scenery.userData.railwayDone.then(() => {
  const RW = scenery.userData.railway, T_ = scenery.userData.terrain; if (!RW) return;
  const fr = RW.trains.find(t_ => t_.name === 'Freight'), ci = fr ? fr.cars.findIndex(c_ => c_.n === 'cargo-train-coal-conta') : -1; if (ci < 0) return;
  const surf_ = (x, z) => { let y = 0; for (const p of T_.peaks) { const d = Math.hypot(x - p.x, z - p.z); if (d < p.r) y = Math.max(y, p.h * (1 - d / p.r) - 2); } return y; };
  const wet_ = scenery.userData.streams.map(S_ => Array.from({ length: 160 }, (_, i) => { const q_ = S_.curve.getPointAt(i / 159); return [q_.x, q_.z, S_.w0 + (S_.w1 - S_.w0) * i / 159]; }));
  const railPts = Array.from({ length: Math.ceil(RW.total / 10) }, (_, n) => RW.pos(n * 10));
  const clear = (x, z, sLoad) => !T_.inLake(x, z) && !wet_.some(a_ => a_.some(q_ => Math.hypot(q_[0] - x, q_[1] - z) < q_[2] * 0.6 + 6)) && !cottages.some(c_ => Math.hypot(c_.m.position.x - x, c_.m.position.z - z) < 20)
    && !B.some(b => x > b.x0 - 10 && x < b.x1 + 10 && z > b.y0 - 10 && z < b.y1 + 10) && !railPts.some((q_, n) => Math.abs(n * 10 - sLoad) > 30 && Math.hypot(q_.x - x, q_.z - z) < 14);
  const total = RW.total, mod = v => ((v % total) + total) % total;
  const tries = RW.tunnels.length ? RW.tunnels.flatMap(t_ => Array.from({ length: 30 }, (_, k) => ({ s: t_.b + 14 + k * 10, pen: k * 1.5 }))) : Array.from({ length: Math.floor(total / 20) }, (_, k) => ({ s: k * 20, pen: 0 }));   // just out of the tunnel, on the far side of the mountain from the depot
  let best = null;
  for (const { s, pen } of tries) {
    const L = RW.pos(s), a = RW.pos(s - 1), b = RW.pos(s + 1), tl = Math.hypot(b.x - a.x, b.z - a.z) || 1, tx = (b.x - a.x) / tl, tz = (b.z - a.z) / tl;
    if (surf_(L.x, L.z) > 0.3 || RW.underground(s) || s > total - 60) continue;                       // the loading spot is on the line, out of the tunnel, with room to run on
    for (const side of [-1, 1]) for (let lat = 22; lat <= 74; lat += 4) {
      const nx = -tz * side, nz = tx * side, x = L.x + nx * lat, z = L.z + nz * lat, h = surf_(x, z);
      if (h < 4) continue; if (h > 18) break;                                                        // the foot of a slope: high enough to dig into, low enough to walk to
      let ok = true; for (let d = 8; d <= lat && ok; d += 4) ok = clear(L.x + nx * d, L.z + nz * d, s);
      if (ok && (!best || lat + pen < best.cost)) best = { cost: lat + pen, s, L, tx, tz, nx, nz, lat, x, z, h };
      break;
    }
  }
  if (!best) return;                                                                                   // no slope beside the track: no mine
  const { s: sLoad, L, nx, nz, lat } = best, coal = fr.meshes[ci];
  coal.geometry.computeBoundingBox(); const bb = coal.geometry.boundingBox, TS = coal.scale.x, halfW = (bb.max.z - bb.min.z) / 2 * TS;
  const shaft = [best.x - nx * 3, best.z - nz * 3], mouth = [L.x + nx * (lat - 7), L.z + nz * (lat - 7)];   // the entrance, set into the slope; the miners come out in front of it
  const pileAt = [L.x + nx * (halfW + 7), L.z + nz * (halfW + 7)], carAt = [L.x + nx * (halfW + 1.6), L.z + nz * (halfW + 1.6)];
  // the entrance: a timber frame (posts and lintel) round a black opening, a heap of rock behind it, and a sign
  const yaw = Math.atan2(-nx, -nz), wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.95 }), ent = new THREE.Group();
  const bx = (w, h, d, x, y, z, m_) => { const b_ = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m_); b_.position.set(x, y, z); b_.raycast = () => {}; ent.add(b_); return b_; };
  bx(1.3, 11, 1.3, -5, 5.5, 0, wood); bx(1.3, 11, 1.3, 5, 5.5, 0, wood); bx(12.5, 1.4, 1.6, 0, 11.4, 0, wood); bx(9, 10.6, 0.4, 0, 5.3, -0.9, new THREE.MeshBasicMaterial({ color: 0x07070a }));
  const heap = new THREE.Mesh(new THREE.ConeGeometry(17, 20, 7), scenery.userData.mats.mtMat); heap.position.set(0, 7, -11); heap.raycast = () => {}; ent.add(heap);
  ent.position.set(shaft[0], surf_(shaft[0], shaft[1]), shaft[1]); ent.rotation.y = yaw; scenery.add(ent);
  { const lab = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture('Atlantis Mine', { bg: 'rgba(255,248,232,.95)', fg: '#4a2e1a', border: '#8a5a2b' }), transparent: true, depthWrite: false, fog: false }));
    lab.scale.set(40, 10, 1); lab.position.set(shaft[0], ent.position.y + 22, shaft[1]); lab.raycast = () => {}; scenery.add(lab); }
  // ore: rusty lumps. The pile beside the track, the load in the open car (in the car model's own units, so it rides along), one lump in each miner's hands and a few in flight
  const oreGeo = new THREE.DodecahedronGeometry(1, 0), oreMat = new THREE.MeshStandardMaterial({ color: 0x8a4b2a, roughness: 0.9, metalness: 0.15, flatShading: true });
  const lump = (parent, r, x, y, z) => { const m_ = new THREE.Mesh(oreGeo, oreMat); m_.scale.setScalar(r); m_.position.set(x, y, z); m_.rotation.set(x * 3.1, z * 1.7, y * 2.3); m_.raycast = () => {}; parent.add(m_); return m_; };
  const PILE_MAX = 12, FULL = 12; let pile = 6, load = 0;
  const pileG = new THREE.Group(); pileG.position.set(pileAt[0], 0, pileAt[1]); scenery.add(pileG);
  const pileLumps = Array.from({ length: PILE_MAX }, (_, j) => { const ring = j < 6 ? 0 : j < 10 ? 1 : 2, a = j * 2.4, r = [2.6, 1.5, 0][ring]; return lump(pileG, 1.3 - ring * 0.1, Math.cos(a) * r, 0.7 + ring * 1.3, Math.sin(a) * r); });
  const cw = bb.max.x - bb.min.x, cd = bb.max.z - bb.min.z, cx0 = (bb.max.x + bb.min.x) / 2, cz0 = (bb.max.z + bb.min.z) / 2, top = bb.max.y, lr = Math.min(cw, cd) * 0.16;
  const carLumps = Array.from({ length: FULL }, (_, j) => lump(coal, lr * (j < 8 ? 1 : 0.9), cx0 + ((j % 4) - 1.5) * cw * 0.2, top - lr * 0.2 + (j < 8 ? 0 : lr * 0.9), cz0 + ((Math.floor(j / 4) % 2) - 0.5) * cd * 0.35));
  const fly = Array.from({ length: 3 }, () => { const m_ = lump(scenery, 1.1, 0, -50, 0); m_.visible = false; return { m: m_, t: 1, from: null }; });
  const throwLump = (from, to) => { const f_ = fly.find(q_ => q_.t >= 1); if (f_) { f_.t = 0; f_.from = from; f_.to = to; f_.m.visible = true; } };
  // the miners: a few people with no organization, standing on the sidewalks, not anyone the city treats specially
  const special = new Set([...(city.highlight?.people || []), ...(city.salon || []), ...Object.values(city.homes || {}).flat(), ...Object.keys(city.regalia || {}), ...(city.meet || []).flat(), ...(city.stand || []).map(q_ => q_.id)]);
  const pick = people.map((p, i) => i).filter(i => people[i][3] === 0 && !special.has(ids[i]) && !metaOf(i).Organization && !walkers.some(w => w.i === i) && i !== guitarI && i !== scootI && loc[i] === 'work' && !hidden[i]).slice(0, 4);
  if (!pick.length) return;
  for (let n_ = pairs.length - 1; n_ >= 0; n_--) if (pick.includes(pairs[n_].a) || pick.includes(pairs[n_].b)) pairs.splice(n_, 1);   // they work, they do not chat
  pick.forEach((i, n) => { minerSet.add(i); miners.push({ i, n, st: 'in', t: 1 + n * 2.2, to: null, carry: lump(scene, 1, 0, -50, 0), toCar: false }); });
  for (const m_ of miners) m_.carry.visible = false;
  // the freight train's own drive, a shuttle: from the depot through the mountain to the mine, brake to a stop with the coal car beside the pile, wait while it is loaded, run back (the locomotive at its other end now leads),
  // stop at the depot, unload there and go again
  let tr = { st: 'go', v: 0, wait: 0, dir: 1 }; const ACC = 1.4, V = fr.speed;
  const coalOff = fr.cars.slice(0, ci).reduce((a_, c_) => a_ + c_.len + RW.GAP, 0) + fr.cars[ci].len / 2, sPile = sLoad + coalOff, sDepot = fr.span + 14;
  const dep = RW.pos(fr.span / 2 + 14), dep2 = RW.pos(fr.span / 2 + 15), dtl = Math.hypot(dep2.x - dep.x, dep2.z - dep.z) || 1, dnx = -(dep2.z - dep.z) / dtl, dnz = (dep2.x - dep.x) / dtl, depotAt = [dep.x + dnx * 13, dep.z + dnz * 13];
  const depotG = new THREE.Group(); depotG.position.set(depotAt[0], 1.2, depotAt[1]); scenery.add(depotG); let depotN = 0, delivered = 0;                       // the ore delivered so far heaps up beside the depot platform
  const depotLumps = Array.from({ length: 10 }, (_, j) => { const ring = j < 6 ? 0 : j < 9 ? 1 : 2, a = j * 2.4, r = [3.4, 1.9, 0][ring]; return lump(depotG, 1.5 - ring * 0.1, Math.cos(a) * r, 0.8 + ring * 1.4, Math.sin(a) * r); });
  fr.drive = dt => {
    const target = tr.dir > 0 ? sPile : sDepot, d = Math.abs(target - fr.s);                           // how far the front still has to go: to bring the coal car to the pile, or the train to its stop at the depot
    if (tr.st === 'run') { tr.v = Math.min(V, Math.sqrt(2 * ACC * d)); if (d < 0.25) { fr.s = target; tr.st = tr.dir > 0 ? 'stop' : 'unload'; tr.v = 0; tr.wait = 0; } }
    else if (tr.st === 'stop') { tr.v = 0; tr.wait += dt; if ((load >= FULL && tr.wait > 6) || tr.wait > 45) { tr.dir = -1; tr.st = 'go'; } }
    else if (tr.st === 'unload') { tr.v = 0; tr.wait += dt; if (tr.wait > 3 && load > 0) { delivered += load; depotN = depotN >= 10 ? 3 : Math.min(10, depotN + 4); load = 0; } if (tr.wait > 9) { tr.dir = 1; tr.st = 'go'; } }
    else { tr.v = Math.min(V, tr.v + ACC * dt); if (tr.v >= V && d > V * V / ACC) tr.st = 'run'; }
    return tr.v * tr.dir;
  };
  const frus = new THREE.Frustum(), pv = new THREE.Matrix4(), sph = new THREE.Sphere(), wp = new THREE.Vector3();
  let shovel = 0;
  stepMine = dt => {
    dt = Math.max(0, dt || 0);
    if (tr.st === 'stop' && pile > 0 && load < FULL && (shovel -= dt) <= 0) { shovel = 0.9; pile--; load++; throwLump([pileAt[0], 1.5, pileAt[1]], [L.x, 8, L.z]); }   // the pile goes into the car
    for (const f_ of fly) if (f_.t < 1) { f_.t = Math.min(1, f_.t + dt / 0.7); const k_ = f_.t; f_.m.position.set(f_.from[0] + (f_.to[0] - f_.from[0]) * k_, f_.from[1] + (f_.to[1] - f_.from[1]) * k_ + Math.sin(Math.PI * k_) * 6, f_.from[2] + (f_.to[2] - f_.from[2]) * k_); if (k_ >= 1) f_.m.visible = false; }
    pileLumps.forEach((m_, j) => { m_.visible = j < pile; }); carLumps.forEach((m_, j) => { m_.visible = j < load; }); depotLumps.forEach((m_, j) => { m_.visible = j < depotN; });
    if (!$('cbWalk').checked) return;
    const k = Math.max(0.1, +elSz.value), spd = +$('walkSpeed').value * 0.6;
    for (const m_ of miners) {
      const p = people[m_.i];
      if (m_.st === 'in') { hidden[m_.i] = 1; m_.carry.visible = false; if ((m_.t -= dt) <= 0) { m_.st = 'out'; hidden[m_.i] = 0; p[0] = mouth[0]; p[1] = mouth[1]; p[3] = 0; p[5] = -1;
          m_.toCar = tr.st === 'stop' && load < FULL; const tgt = m_.toCar ? carAt : pileAt, o_ = (m_.n - 1.5) * 2.4; m_.to = [tgt[0] + best.tx * o_ - nx * (m_.toCar ? 0 : 3.5), tgt[1] + best.tz * o_ - nz * (m_.toCar ? 0 : 3.5)]; m_.walked = 0; } }
      else if (m_.st === 'out' || m_.st === 'back') {
        const dx = m_.to[0] - p[0], dy = m_.to[1] - p[1], d = Math.hypot(dx, dy), step = Math.min(d, (m_.st === 'out' ? spd : spd * 1.4) * dt);
        if (d > 0.01) { p[0] += dx / d * step; p[1] += dy / d * step; p[4] = Math.atan2(dx, dy) * 180 / Math.PI; m_.walked += step; walkStamp[m_.i] = tick; walkPh[m_.i] = m_.walked / (k * 0.7); }
        if (d - step < 0.05) { if (m_.st === 'out') { m_.st = 'drop'; m_.t = 0.8; } else { m_.st = 'in'; m_.t = 2 + Math.random() * 3; } }
      } else if (m_.st === 'drop' && (m_.t -= dt) <= 0) {                                                // tip the ore onto the pile, or straight into the car
        if (m_.toCar && tr.st === 'stop' && load < FULL) { load++; throwLump([p[0], 1.6 * k, p[1]], [L.x, 8, L.z]); } else { pile = Math.min(PILE_MAX, pile + 1); }
        m_.st = 'back'; m_.to = mouth.slice(); m_.walked = 0;
      }
      p[2] = surf_(p[0], p[1]);
      const h_ = p[4] * Math.PI / 180, on = !hidden[m_.i] && elSt.checked && (m_.st === 'out' || m_.st === 'drop');
      m_.carry.visible = on; if (on) { m_.carry.scale.setScalar(0.24 * k); m_.carry.position.set(p[0] + Math.sin(h_) * 0.34 * k, p[2] + 1.02 * k, p[1] + Math.cos(h_) * 0.34 * k); }
      placeOne(m_.i);
    }
    for (const mesh of updMeshes) { mesh.instanceMatrix.needsUpdate = true; mesh.boundingSphere = null; }
    if (selected >= 0 && minerSet.has(selected)) placeRing();
  };
  scenery.userData.mine = { sLoad, shaft, pileAt, miners: () => miners.map(m_ => ({ id: ids[m_.i], st: m_.st })), state: () => ({ train: tr.st, dir: tr.dir, s: fr.s, pile, load, delivered, depotN }), step: dt => stepMine(dt) };
});
scenery.userData.taken = []; scenery.userData.lotDone = (async () => {                                                                                       // the car lot: the nearest open patch of ground (no water, mountain, cottage, building or track)
  const carUrl = await modelFile('car'), motoUrl = await modelFile('motorcycle'); if (!carUrl) return;
  const [car, moto] = await Promise.all([loadScene(carUrl, 15, 'xz'), motoUrl ? loadScene(motoUrl, 6.3, 'xz') : null]); if (!car) return;
  await scenery.userData.railwayDone;
  const T_ = scenery.userData.terrain, surf_ = (x, z) => { let y = 0; for (const p of T_.peaks) { const d = Math.hypot(x - p.x, z - p.z); if (d < p.r) y = Math.max(y, p.h * (1 - d / p.r) - 2); } return y; };
  const wet_ = scenery.userData.streams.map(S_ => Array.from({ length: 240 }, (_, i) => { const q_ = S_.curve.getPointAt(i / 239); return [q_.x, q_.z, S_.w0 + (S_.w1 - S_.w0) * i / 239]; }));
  const rail_ = scenery.children.find(c_ => c_.isGroup && c_.position.y === 0.15 && c_.children.length > 10), railPts = rail_ ? rail_.children.map(c_ => [c_.position.x, c_.position.z]) : [];
  const bad_ = (x, z) => surf_(x, z) > 0.3 || T_.inLake(x, z) || cottages.some(c_ => Math.hypot(c_.m.position.x - x, c_.m.position.z - z) < 24) || wet_.some(a_ => a_.some(q_ => Math.hypot(q_[0] - x, q_[1] - z) < q_[2] * 0.8 + 24)) || railPts.some(q_ => Math.hypot(q_[0] - x, q_[1] - z) < 70)
    || B.some(b => x > b.x0 - 24 && x < b.x1 + 24 && z > b.y0 - 24 && z < b.y1 + 24);
  const LW = 72, LD = 46, cx0 = E / 2, cz0 = E / 2; let best = null, bd = 1e9;
  for (let x = -500; x <= 900; x += 20) for (let z = -500; z <= 900; z += 20) { const d = Math.hypot(x - cx0, z - cz0); if (d >= bd || d < 150) continue;
    let ok = true; for (let a_ = -LW / 2; a_ <= LW / 2 && ok; a_ += 12) for (let b_ = -LD / 2; b_ <= LD / 2 && ok; b_ += 12) if (bad_(x + a_, z + b_)) ok = false;
    if (ok) { best = [x, z]; bd = d; } }
  if (!best) return;
  const lot = new THREE.Group(); lot.position.set(best[0], 0, best[1]); scenery.add(lot);
  const asph = new THREE.Mesh(new THREE.BoxGeometry(LW, 0.4, LD), new THREE.MeshStandardMaterial({ color: 0x3b3e44, roughness: 1 })); asph.position.y = 0.2; asph.raycast = () => {}; lot.add(asph);
  const lineM = new THREE.MeshBasicMaterial({ color: 0xe9e9e9 });
  for (let i = 0; i <= 4; i++) { const l_ = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 17), lineM); l_.position.set(-LW / 2 + 6 + i * 15, 0.43, -LD / 4); l_.raycast = () => {}; lot.add(l_); }   // stall lines, one row
  for (let i = 0; i <= 6; i++) { const l_ = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 11), lineM); l_.position.set(-LW / 2 + 6 + i * 10, 0.43, LD / 4 + 1); l_.raycast = () => {}; lot.add(l_); }
  for (let i = 0; i < 4; i++) { const c_ = car.clone(); c_.position.set(-LW / 2 + 13.5 + i * 15, 0.4, -LD / 4); c_.rotation.y = Math.PI / 2; c_.traverse(o => { o.raycast = () => {}; }); lot.add(c_); }
  if (moto) for (let i = 0; i < 6; i++) { const m_ = moto.clone(); m_.position.set(-LW / 2 + 11 + i * 10, 0.4, LD / 4 + 1); m_.rotation.y = Math.PI / 2; m_.traverse(o => { o.raycast = () => {}; }); lot.add(m_); }
  const lab = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture('Car lot', { bg: 'rgba(255,255,255,.92)', fg: '#1b2433', border: '#9aa7bb' }), transparent: true, depthWrite: false, fog: false })); lab.scale.set(36, 9, 1); lab.position.set(0, 20, 0); lab.raycast = () => {}; lot.add(lab);
  scenery.userData.carLot = { x: best[0], z: best[1], LW, LD }; scenery.userData.taken.push({ x: best[0], z: best[1], r: Math.hypot(LW, LD) / 2 + 20 });
})();

// --- places and commands (type them in the search box, then Enter):
//   /speak  everyone follows Leonard Peikoff to the Ford Hall Forum        /salon  Ayn Rand and her invited guests gather beside her lakeside villa
//   /home   everyone goes home: Ason, Onkar and Yaron to the castle, Leonard, Amy and Barbara to the mother-in-law suite beside it, Carl to his house, everyone else to the apartment building, and Kira closes her book and walks to Peikoff Manor
//   /work   everyone goes back to the building they work in
// Everybody keeps a location (`loc`): work, forum, salon or one of the homes. A command re-plans the walk of everyone it concerns from wherever they are now (in a building, in a hall, hidden at home,
// or mid-way): out of the building by the elevator and door, along the street lanes, across open ground, in at the door of the place. People who go home vanish through the door and come out again when they go back.
let evLecture = -1;
const places = {};
const HOMES = city.homes || {}, homeKey = i => HOMES.castle?.includes(ids[i]) ? 'castle' : HOMES.suite?.includes(ids[i]) ? 'suite' : HOMES.carl?.includes(ids[i]) ? 'carl' : 'apartment';
const loc = new Array(people.length).fill('work'), orig = new Array(people.length).fill(null), seatOf = new Array(people.length).fill(-1);
function toast(msg, ms = 8000) {
  let t_ = $('toast'); if (!t_) { t_ = document.createElement('div'); t_.id = 'toast'; t_.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);max-width:min(600px,92vw);padding:9px 16px;border-radius:10px;background:rgba(27,36,51,.92);color:#fff;font:600 14px system-ui;z-index:50;pointer-events:none;text-align:center;transition:opacity .4s'; document.body.append(t_); }
  t_.textContent = msg; t_.style.opacity = 1; clearTimeout(t_._h); t_._h = setTimeout(() => { t_.style.opacity = 0; }, ms);
}
const venueXY = (v, u, w) => [v.cx + v.f[0] * u + v.r[0] * w, v.cz + v.f[1] * u + v.r[1] * w];   // venue frame: u runs from the door toward the stage, w across; origin at the centre
const seatHead = v => Math.atan2(v.f[0], v.f[1]) * 180 / Math.PI;                                   // heading (viewer convention) of someone facing the stage
function venueLegs(from, pts) { const legs = [], cur = from.slice(0, 3); for (const [x, y] of pts) { const len = Math.hypot(x - cur[0], y - cur[1]); if (len < 0.01) continue; legs.push({ a: cur.slice(), b: [x, y, 0], len, ride: false, bi: -1, hold: 0 }); cur[0] = x; cur[1] = y; cur[2] = 0; } return legs; }
function inVenue(v, x, y) { if (!v.f) return null; const dx = x - v.cx, dy = y - v.cz, u = dx * v.f[0] + dy * v.f[1], w = dx * v.r[0] + dy * v.r[1]; return Math.abs(u) <= v.D / 2 + 1 && Math.abs(w) <= v.W / 2 + 1 ? { u, w } : null; }
const bldAt = p => B.findIndex(b => p[0] > b.x0 - 0.3 && p[0] < b.x1 + 0.3 && p[1] > b.y0 - 0.3 && p[1] < b.y1 + 0.3);   // the building a person is physically inside, or -1
// --- bridges (issue #96): nobody wades. water() is a raster of the streams and the lake; a walk whose straight way would cross water goes over the nearest bridge instead (see bridges.js)
function water() {
  if (waterGrid) return waterGrid;
  const T = scenery.userData.terrain, S = scenery.userData.streams, c = Math.cos(T.LA), sn = Math.sin(T.LA), lcx = E / 2 + T.LD * c, lcz = E / 2 + T.LD * sn;
  const lakeAt = (x, z) => Math.hypot(((x - E / 2) * c + (z - E / 2) * sn - T.LD) / (T.LRX * 0.92), (-(x - E / 2) * sn + (z - E / 2) * c) / (T.LRZ * 0.86)) < 1;   // the blue water, not the beach
  const samples = S.map(s => Array.from({ length: 500 }, (_, i) => { const t = i / 499, q = s.curve.getPointAt(t); return [q.x, q.z, (s.w0 + (s.w1 - s.w0) * t) / 2 + BRIDGE.margin]; }));
  scenery.userData.streamSamples = samples;
  return waterGrid = makeWetGrid({ minX: -1100, minZ: -1100, maxX: 1500, maxZ: 1700, cell: 2, streams: samples, lake: { box: [lcx - T.LRX, lcz - T.LRX, lcx + T.LRX, lcz + T.LRX], test: lakeAt } });
}
let planningBridges = false;
function withBridges(legs) {          // no leg wades: waypoints in the water move to the bank, and a leg whose straight way is wet is replaced by a path round the water or over a bridge
  if (planningBridges) return legs;
  const G = water(), L2 = legs.map(L => ({ ...L, a: L.a.slice(), b: L.b.slice() }));
  const snap = (q, link) => { if (!G.get(q[0], q[1])) return; const d = nearestDry(G, bridges, q[0], q[1], 60); if (d) { q[0] = d[0]; q[1] = d[1]; if (link) { link[0] = d[0]; link[1] = d[1]; } } };
  L2.forEach((L, k) => { if (L.ride) return; snap(L.b, L2[k + 1] && !L2[k + 1].ride ? L2[k + 1].a : null); if (k > 0) snap(L.a, null); });
  const out = [];
  for (const L of L2) {
    if (L.ride || !wetOnSegment(G, [L.a[0], L.a[1]], [L.b[0], L.b[1]])) { out.push(L); continue; }
    const path = findPath(G, bridges, [L.a[0], L.a[1]], [L.b[0], L.b[1]]); if (!path) { out.push(L); continue; }
    const pts = withHeights(path, bridges); pts[0][2] = L.a[2]; pts.at(-1)[2] = L.b[2];
    for (let k = 0; k + 1 < pts.length; k++) { const a = pts[k], b = pts[k + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len > 0.01) out.push({ a, b, len, ride: false, bi: -1, hold: k === 0 ? L.hold || 0 : 0 }); }
  }
  return out;
}
const BRIDGE_STYLES = ['plank', 'log', 'panel'];   // the mix: my plank bridge with rails and stone piers; a rustic log-arch bridge (after Quaternius's "Small Bridge"); a dark slatted-panel bridge (after Pixel's "Bridge")
function buildBridge(br, n = 0) {     // planks following the arch, rails and posts, and piers in the water; local x runs from end P to end Q
  const style = BRIDGE_STYLES[n % BRIDGE_STYLES.length], g = new THREE.Group(), mat = (c, r = 0.9) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
  const wood = mat(style === 'log' ? 0x7a5524 : 0x8a5a2b), dark = mat(style === 'panel' ? 0x4a2f1c : 0x5e3d20, 0.95), stone = mat(0x80848b, 0.95), log = mat(0x6b4a1f, 1);
  const N = BRIDGE.steps * (style === 'log' ? 2 : 1), l = br.L / N, W = BRIDGE.width, rise = BRIDGE.rise;
  const box = (w, h, d, x, y, z, m, rz = 0, ry = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.rotation.z = rz; b.rotation.y = ry; b.raycast = () => {}; g.add(b); return b; };
  const rod = (len, r, x, y, z, m, rz = 0) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), m); c.position.set(x, y, z); c.rotation.z = rz + Math.PI / 2; c.raycast = () => {}; g.add(c); };   // a round log lying along local x
  for (let i = 0; i <= N; i++) {
    const s0 = i / N, h0 = deckHeight(s0), x0 = s0 * br.L;
    if (i < N) { const h1 = deckHeight((i + 1) / N), xm = (s0 + 0.5 / N) * br.L, hm = (h0 + h1) / 2, slope = Math.atan2(h1 - h0, l), len = Math.hypot(l, h1 - h0) + 0.15;
      if (style === 'log') {
        box(len - 0.25, BRIDGE.thick * 0.7, W - 0.4 - (i % 3) * 0.2, xm, hm - BRIDGE.thick * 0.35, ((i * 7) % 5 - 2) * 0.08, wood, slope);                  // loose planks, a little uneven
        for (const z of [-1, 1]) rod(len + 0.1, 0.22, xm, hm + BRIDGE.rail * 0.55 + rise * 0.18 * Math.sin(Math.PI * (s0 + 0.5 / N)), z * (W / 2 - 0.2), log, slope);   // the arched log rails
      } else if (style === 'panel') {
        box(len, BRIDGE.thick, W, xm, hm - BRIDGE.thick / 2, 0, wood, slope);
        for (const z of [-1, 1]) box(len, BRIDGE.rail * 0.95, 0.28, xm, hm + BRIDGE.rail * 0.45, z * (W / 2 - 0.15), dark, slope);                          // a solid side panel (slats below)
      } else {
        box(len, BRIDGE.thick, W, xm, hm - BRIDGE.thick / 2, 0, wood, slope);                                                                          // the planks
        for (const z of [-1, 1]) box(len, 0.26, 0.32, xm, hm + BRIDGE.rail, z * (W / 2 - 0.2), dark, slope);                                           // the rails
      } }
    if (style === 'log') { if (i % 2 === 0) for (const z of [-1, 1]) rod(BRIDGE.rail + 0.9 + rise * 0.18 * Math.sin(Math.PI * s0), 0.26, x0, h0 + (BRIDGE.rail + 0.9) / 2 - 0.3, z * (W / 2 - 0.2), log, Math.PI / 2); }   // log posts (rods turned upright)
    else if (style === 'panel') { if (i % 2 === 0) for (const z of [-1, 1]) box(0.16, BRIDGE.rail, 0.34, x0, h0 + BRIDGE.rail * 0.45, z * (W / 2 - 0.15), dark); }   // vertical slats
    else for (const z of [-1, 1]) box(0.42, BRIDGE.rail + 0.35, 0.42, x0, h0 + BRIDGE.rail / 2 - 0.15, z * (W / 2 - 0.2), dark);                          // the posts
    if (i > 2 && i < N - 2 && i % (style === 'log' ? 4 : 2) === 0) for (const z of [-1, 1]) {                                                           // piers down into the water
      if (style === 'log') rod(h0 + 1.6, 0.4, x0, (h0 - 1.6) / 2 - BRIDGE.thick, z * (W / 2 - 0.9), log, Math.PI / 2); else box(0.9, h0 + 1.2, 0.9, x0, (h0 - 1.2) / 2 - BRIDGE.thick, z * (W / 2 - 0.9), stone); }
  }
  if (style === 'panel') for (const e of [0, br.L]) box(0.7, 0.5, W + 1.6, e, 0.2, 0, dark);                                                          // a heavy beam across each end
  g.position.set(br.P[0], 0, br.P[1]); g.rotation.y = br.yaw; scenery.add(g); scenery.userData.bridgeMeshes = (scenery.userData.bridgeMeshes || []).concat(g); g.userData.style = style;
}
function routeTo(i, place, dest, o) {                              // legs from wherever person i is now to a place's door and inside, or back to the building they work in
  const p = people[i], here = places[loc[i]]; let legs = [], cur = p.slice(0, 3), fromB = bldAt(p);
  if (hidden[i] && here) { legs = venueLegs([here.doorIn[0], here.doorIn[1], 0], [here.doorOut]); cur = [here.doorOut[0], here.doorOut[1], 0]; fromB = -1; }          // out of the house or castle
  else if (here && inVenue(here, p[0], p[1])) { const at = inVenue(here, p[0], p[1]); legs = venueLegs(cur, [venueXY(here, at.u, 0), here.doorIn, here.doorOut]); cur = legs.length ? legs.at(-1).b : cur; fromB = -1; }   // out of a hall
  const work = dest.kind === 'work', h = dest.home;
  legs = legs.concat(planEventLegs({ B, arch, pitch: PITCHP, from: cur, fromB, to: work ? [h.x, h.y] : place.doorOut, toB: work && h.kind === 1 ? h.bid : -1, tz: work ? h.z : 0, o }));
  if (!work) legs = legs.concat(venueLegs(legs.length ? legs.at(-1).b : cur, dest.front ? (dest.via || []) : [place.doorIn, ...(dest.via || [])]));   // dest.front: stay outside, at the via points
  return withBridges(legs);
}
function advanceEv(w, ev, dt, spd) {                               // the shared "walk the legs" step; returns true when the path is finished
  const P_ = ev.path, i = w.i, p = people[i]; const leg = P_.legs[P_.li]; walkStamp[i] = tick;
  if (leg && P_.hold > 0) { P_.hold -= dt; walkRide[i] = 1; }
  else if (leg) {
    P_.d += (leg.ride ? spd * 2.5 : spd) * dt; if (!leg.ride) P_.walked += spd * dt;
    const f = Math.min(1, P_.d / leg.len), a = leg.a, b = leg.b;
    p[0] = a[0] + (b[0] - a[0]) * f; p[1] = a[1] + (b[1] - a[1]) * f; p[2] = a[2] + (b[2] - a[2]) * f; walkRide[i] = leg.ride ? 1 : 0;
    if (leg.ride) { cabZ[leg.bi] = p[2]; cabBusy[leg.bi] = tick; placeCab(leg.bi); }
    else p[4] += wrap180(Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI - p[4]) * Math.min(1, dt * 12);
    if (P_.d >= leg.len) { P_.li++; P_.d = 0; P_.hold = P_.legs[P_.li]?.hold || 0; }
  }
  walkPh[i] = P_.walked / (Math.max(0.1, +elSz.value) * 0.7);
  return P_.li >= P_.legs.length;
}
function stepEv(w, dt, speed) {
  const ev = w.ev, i = w.i, p = people[i];
  if (ev.phase === 'there') return;
  if (ev.phase === 'wait') { ev.delay -= dt; if (ev.delay > 0) return; ev.phase = 'walk'; hidden[i] = 0; seated[i] = 0; if (evLecture === i) evLecture = -1; const f0 = ev.path.legs[0]; if (f0) { p[0] = f0.a[0]; p[1] = f0.a[1]; p[2] = f0.a[2]; } }
  if (!advanceEv(w, ev, dt, Math.max(speed * 1.6, 12))) { placeOne(i); return; }
  walkRide[i] = 0; const t = ev.target;
  if (t.type === 'work') {                                         // back to the building they work in
    const h = ev.home; p[0] = h.x; p[1] = h.y; p[2] = h.z; p[3] = h.kind; p[4] = h.heading; p[5] = h.bid; orig[i] = null; anim[i].s = 'idle'; anim[i].t0 = performance.now() / 1000; anim[i].dur = 1; walkStamp[i] = -1;
    if (w.temp) walkers.splice(walkers.indexOf(w), 1); else { w.ev = null; w.phase = 'dwell'; w.wait = rnd(3, 9); w.path = null; }
  } else {
    p[3] = 0; p[5] = -1; p[2] = 0; ev.phase = 'there';
    if (t.type === 'inside') { hidden[i] = 1; p[0] = t.x; p[1] = t.y; }  // through the door of a house, castle or apartment building: out of sight until they come out again
    else { p[4] = t.heading; if (t.type === 'seat') seated[i] = 1; if (t.type === 'lectern') evLecture = i; }
  }
  placeOne(i);
}
function frontSpots(cs) {   // /home: Ason and Kira stand side by side a few steps in front of Peikoff Manor's door, turned a little toward each other
  const a = cs.a, side = [-a[1], a[0]], F = [cs.doorOut[0] + a[0] * 12, cs.doorOut[1] + a[1] * 12], gap = 5;
  const A = [F[0] - side[0] * gap, F[1] - side[1] * gap], K = [F[0] + side[0] * gap, F[1] + side[1] * gap];
  return { ason: { xy: A, heading: Math.atan2(a[0] + side[0] * 0.7, a[1] + side[1] * 0.7) * 180 / Math.PI }, kira: { xy: K, yaw: Math.atan2(A[0] - K[0], A[1] - K[1]) } };
}
function command(kind) {
  const target = { speak: 'forum', salon: 'salon', home: 'home', work: 'work' }[kind]; if (!target) return;
  if (target === 'forum' && !places.forum) { toast('The Ford Hall Forum is not built yet (it needs open ground).'); return; }
  if (target === 'salon' && !places.salon) { toast("Ayn Rand's villa is not built yet (it needs open ground by the lake)."); return; }
  if (!$('cbWalk').checked) { $('cbWalk').checked = true; $('cbWalk').dispatchEvent(new Event('change')); }
  const speed = Math.max(+$('walkSpeed').value * 1.6, 12), all = people.map((_, i) => i);
  const who = kind === 'salon' ? (city.salon || []).map(id => ids.indexOf(id)).filter(i => i >= 0) : all, leader = kind === 'speak' ? ids.indexOf('P2') : kind === 'salon' ? ids.indexOf('P1') : -1;
  const keyOf = i => kind === 'speak' ? 'forum' : kind === 'salon' ? 'salon' : kind === 'home' ? homeKey(i) : 'work', L = leader >= 0 ? people[leader] : null;
  const todo = who.filter(i => loc[i] !== keyOf(i) && i !== leader && !minerSet.has(i)).map(i => ({ i, d: L ? Math.hypot(people[i][0] - L[0], people[i][1] - L[1]) : Math.random() * 90 })).sort((a, b) => a.d - b.d);
  const v = places[kind === 'speak' ? 'forum' : kind === 'salon' ? 'salon' : ''], busy = new Set(); if (v && v.seats) for (let j = 0; j < people.length; j++) if (loc[j] === (kind === 'speak' ? 'forum' : 'salon') && seatOf[j] >= 0) busy.add(seatOf[j]);
  const seats = v && v.seats ? v.seats.map((s_, n) => ({ ...s_, n })).filter(s_ => !busy.has(s_.n)).sort((a, b) => a.row - b.row || Math.abs(a.w) - Math.abs(b.w) || a.w - b.w) : [];
  const make = (i, key, dest, delay, seatN = -1) => {
    let w = walkers.find(w_ => w_.i === i); const p = people[i], o = w ? w.off : (Math.random() < .5 ? 3 : -3);
    if (!w) { w = { i, route: [], k: 0, phase: 'event', wait: 0, off: o, path: null, temp: true }; walkers.push(w); }
    if (loc[i] === 'work') {                                       // remember where they work: someone on a trip goes back to the building they were heading for
      let home = { x: p[0], y: p[1], z: p[2], kind: p[3], bid: p[5], heading: p[4] };
      if (!w.temp && w.route.length && w.phase === 'walk' && w.path) { const bi = w.path.next, T = B[bi]; w.k = bi; home = { x: rnd(T.x0 + 1, T.x1 - 1), y: rnd(T.y0 + 1, T.y1 - 1), z: 0, kind: 1, bid: bi, heading: p[4] }; }
      orig[i] = home; }
    const place = key === 'work' ? null : places[key], legs = routeTo(i, place, dest, o);
    if (!legs.length && key === 'work') { loc[i] = 'work'; p[3] = orig[i].kind; p[5] = orig[i].bid; hidden[i] = 0; seated[i] = 0; if (w.temp) walkers.splice(walkers.indexOf(w), 1); else { w.ev = null; w.phase = 'dwell'; w.path = null; } return; }
    if (!legs.length) return;
    w.ev = { phase: 'wait', delay, target: dest.target, home: orig[i], path: { legs, li: 0, d: 0, hold: legs[0].hold || 0, walked: 0 } }; loc[i] = key; seatOf[i] = seatN;
  };
  if (leader >= 0 && loc[leader] !== keyOf(leader)) {
    if (kind === 'speak') make(leader, 'forum', { kind: 'place', target: { type: 'lectern', heading: seatHead(v) + 180 }, via: [venueXY(v, -v.D / 2 + 18, 0), venueXY(v, v.D / 2 - 9, 0)] }, 0);
    else make(leader, 'salon', { kind: 'place', target: { type: 'stand', heading: seatHead(v) + 180 }, via: [venueXY(v, 0, 0), venueXY(v, v.D / 2 - 7, 0)] }, 0);
  }
  todo.forEach((q, n) => {
    const key = keyOf(q.i);
    if (key === 'work') make(q.i, 'work', { kind: 'work', home: orig[q.i], target: { type: 'work' } }, Math.random() * 6);
    else if (key === 'forum' || key === 'salon') { const seat = seats[n % seats.length]; make(q.i, key, { kind: 'place', target: { type: 'seat', heading: seat.head }, via: [venueXY(v, -v.D / 2 + 18, 0), venueXY(v, seat.u, 0), [seat.x, seat.y]] }, 0.5 + q.d / (speed * 1.3) * 0.6 + Math.random() * 1.2, seat.n); }
    else { const pl = places[key]; if (!pl) return;
      if (q.i === guitarI && key === 'castle') { const f = frontSpots(pl); make(q.i, key, { kind: 'place', front: true, target: { type: 'stand', heading: f.ason.heading }, via: [f.ason.xy] }, 0.3 + Math.random() * 3); }   // Ason stays out front and plays his guitar; Kira joins him
      else make(q.i, key, { kind: 'place', target: { type: 'inside', x: pl.doorIn[0], y: pl.doorIn[1] }, via: [] }, 0.3 + Math.random() * 7); }
  });
  const msgs = { speak: 'Everyone is following Leonard Peikoff to the Ford Hall Forum. Type /home to send everyone home, or /work to send them back to work.', salon: "Ayn Rand and her guests (the Peikoffs and the top executives of OSI, The Atlas Society and Prometheus) are gathering at her lakeside villa. Type /home or /work to send them away.",
    home: 'Everyone is going home. Type /work to send everyone back.', work: 'Everyone is going back to work.' };
  toast(msgs[kind]);
  if (kind === 'home') scenery.userData.kiraGo?.(true, places.castle && frontSpots(places.castle)); else if (kind === 'work') scenery.userData.kiraGo?.(false);   // Kira closes her book and walks home too
  { const u = scenery.userData, cs = places.castle; if (u.midasLand) { if (kind === 'home' && cs) { const side = [-cs.a[1], cs.a[0]], other = places.suite || places.carl, pick = s_ => [cs.cx + side[0] * s_ * (cs.size[2] / 2 + 70), cs.cz + side[1] * s_ * (cs.size[2] / 2 + 70)], p1 = pick(1), p2 = pick(-1), far = q_ => other ? Math.hypot(q_[0] - other.cx, q_[1] - other.cz) : 0, sp = far(p1) >= far(p2) ? p1 : p2; u.midasLand(true, { x: sp[0], z: sp[1], dx: cs.a[0], dz: cs.a[1] }); } else u.midasLand(false); } }   // Midas lands beside the castle when everyone goes home
  const pl = kind === 'speak' ? places.forum : kind === 'salon' ? places.salon : null;
  if (pl) { const vc = new THREE.Vector3(pl.cx, 0, pl.cz), toCity = P(E / 2, E / 2, 0).sub(vc).setY(0).normalize(); fly = { t: 0, fromT: controls.target.clone(), fromC: camera.position.clone(), toT: vc.clone().setY(8), toC: vc.clone().addScaledVector(toCity, 170).setY(110) }; }
}
function runCommand(text) {
  const c = text.slice(1).trim().toLowerCase();
  if (c === 'speak' || c === 'salon' || c === 'home' || c === 'work') command(c); else if (c === 'city' || c === 'office' || c === 'back') command('work');
  else if (c === 'admin') chat.admin(); else if (c === 'logout') chat.logout();                // unlisted: the admin pass into the paid chat, for testing
  else toast("Commands: /speak (everyone follows Leonard to the Ford Hall Forum), /salon (Ayn Rand's villa), /home (everyone goes home), /work (everyone goes back to work).");
}
(async () => {                                                                                       // build the places on open ground beyond the street grid
  await scenery.userData.lotDone; await scenery.userData.railwayDone;
  const T_ = scenery.userData.terrain, surf_ = (x, z) => { let y = 0; for (const p of T_.peaks) { const d = Math.hypot(x - p.x, z - p.z); if (d < p.r) y = Math.max(y, p.h * (1 - d / p.r) - 2); } return y; };
  const wet_ = scenery.userData.streams.map(S_ => Array.from({ length: 240 }, (_, i) => { const q_ = S_.curve.getPointAt(i / 239); return [q_.x, q_.z, S_.w0 + (S_.w1 - S_.w0) * i / 239]; }));
  const rail_ = scenery.children.find(c_ => c_.isGroup && c_.position.y === 0.15 && c_.children.length > 10), railPts = rail_ ? rail_.children.map(c_ => [c_.position.x, c_.position.z]) : [];
  // lakeK = how many shore-radii from the lake's centre (1 = the edge of the drawn beach). T_.inLake keeps a wide margin (1.25) clear for most places; `tight` only keeps the beach itself clear
  const lakeK = (x, z) => { const dx = x - E / 2, dz = z - E / 2, c = Math.cos(T_.LA), sn = Math.sin(T_.LA); return Math.hypot((dx * c + dz * sn - T_.LD) / T_.LRX, (-dx * sn + dz * c) / T_.LRZ); };
  const bad_ = (x, z, withB, tight) => surf_(x, z) > 0.3 || (tight ? lakeK(x, z) < 1.03 : T_.inLake(x, z)) || (!tight && cottages.some(c_ => Math.hypot(c_.m.position.x - x, c_.m.position.z - z) < 24)) || wet_.some(a_ => a_.some(q_ => Math.hypot(q_[0] - x, q_[1] - z) < q_[2] * 0.8 + (tight ? 8 : 24))) || railPts.some(q_ => Math.hypot(q_[0] - x, q_[1] - z) < 70)
    || (withB && B.some(b => x > b.x0 - 24 && x < b.x1 + 24 && z > b.y0 - 24 && z < b.y1 + 24));
  const CELL = 10, LO = -1000, NC = 210, grid = (wb, tight) => { const g = new Uint8Array(NC * NC); for (let i = 0; i < NC; i++) for (let j = 0; j < NC; j++) g[i * NC + j] = bad_(LO + i * CELL, LO + j * CELL, wb, tight) ? 1 : 0; return g; };
  const gB = grid(true), gN = grid(false), at_ = (g, x, z) => { const i = Math.round((x - LO) / CELL), j = Math.round((z - LO) / CELL); return i < 0 || j < 0 || i >= NC || j >= NC ? 1 : g[i * NC + j]; };
  let tightGrids = null;                                                                           // the same grids with only the beach kept clear: built the first time something must stand against the lake
  const hx = arch.map(a => a.cx), hy = arch.map(a => a.cy), lat = { x0: Math.min(...hx) - PITCHP / 2, x1: Math.max(...hx) + PITCHP / 2, y0: Math.min(...hy) - PITCHP / 2, y1: Math.max(...hy) + PITCHP / 2 };
  const cl = (v, lo, hi) => Math.min(hi, Math.max(lo, v)), taken = scenery.userData.taken, C0 = [E / 2, E / 2];
  const discFree = (g, x, z, radius) => { for (let a = -radius; a <= radius; a += 14) for (let b = -radius; b <= radius; b += 14) if (a * a + b * b <= radius * radius && at_(g, x + a, z + b)) return false; return true; };
  const findSite = (radius, score = (x, z) => Math.hypot(x - C0[0], z - C0[1]), tight = false, lawn = null) => { let best = null, bs = 1e18;
    if (tight) tightGrids ||= { B: grid(true, true), N: grid(false, true) };
    const gb = tight ? tightGrids.B : gB, gn = tight ? tightGrids.N : gN;
    for (let x = -900; x <= 1000; x += 20) for (let z = -900; z <= 1000; z += 20) { const sc_ = score(x, z); if (sc_ >= bs) continue;
      if (x >= lat.x0 - 60 && x <= lat.x1 + 60 && z >= lat.y0 - 60 && z <= lat.y1 + 60) continue;            // beyond the street grid, never inside it
      if (taken.some(t_ => Math.hypot(t_.x - x, t_.z - z) < t_.r + radius)) continue;
      let ok = discFree(gb, x, z, radius);
      if (ok && lawn) { const a_ = toward(x, z); ok = discFree(gb, x + a_[0] * lawn.off, z + a_[1] * lawn.off, lawn.r); }   // and the lawn in front of it
      if (!ok) continue;
      const gx = cl(x, lat.x0, lat.x1), gz = cl(z, lat.y0, lat.y1), len = Math.hypot(gx - x, gz - z);
      for (let t_ = 0; t_ <= len && ok; t_ += 10) if (at_(gn, x + (gx - x) * t_ / len, z + (gz - z) * t_ / len)) ok = false;   // a clear straight walk from the street grid
      if (ok) { best = [x, z]; bs = sc_; } }
    return best; };
  const toward = (x, z) => { const gx = cl(x, lat.x0, lat.x1), gz = cl(z, lat.y0, lat.y1), a = [gx - x, gz - z], l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };   // unit vector from a site toward the street grid
  const label = (text, x, y, z, w = 64) => { const lab = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture(text, { bg: 'rgba(255,255,255,.92)', fg: '#1b2433', border: '#9aa7bb' }), transparent: true, depthWrite: false, fog: false })); lab.scale.set(w, w / 4, 1); lab.position.set(x, y, z); lab.raycast = () => {}; scenery.add(lab); };
  const stone = new THREE.MeshStandardMaterial({ color: 0x80848b, roughness: 0.95 }), glass = new THREE.MeshStandardMaterial({ color: 0xcfe3ff, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, roughness: 0.4 });
  const edge = new THREE.LineBasicMaterial({ color: 0x6f8fb8, transparent: true, opacity: 0.7 }), black = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.9 });
  const chairGeo = (() => { const col = (g, hex) => { const c_ = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let j = 0; j < n; j++) a.set([c_.r, c_.g, c_.b], j * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
    return mergeGeometries([col(new THREE.BoxGeometry(0.5, 0.07, 0.5).translate(0, 0.45, 0).toNonIndexed(), '#7a1f2b'), col(new THREE.BoxGeometry(0.5, 0.5, 0.06).translate(0, 0.72, -0.22).toNonIndexed(), '#7a1f2b'), col(new THREE.BoxGeometry(0.08, 0.42, 0.08).translate(0, 0.21, 0).toNonIndexed(), '#3a3a40')]); })();
  const addChairs = v => { v.chairs = new THREE.InstancedMesh(chairGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), Math.max(1, v.seats.length)); v.chairs.frustumCulled = false; v.chairs.raycast = () => {}; scenery.add(v.chairs);
    const layout = () => { const k = +elSz.value; v.seats.forEach((s_, n) => v.chairs.setMatrixAt(n, m.compose(P(s_.x, s_.y, 0.5), q.setFromAxisAngle(UP, s_.head * Math.PI / 180), sc.set(k, k, k)))); v.chairs.instanceMatrix.needsUpdate = true; }; layout(); elSz.addEventListener('input', layout); };
  const hall = (name, text, W, D, H, seats, extras) => {                                          // a translucent hall at a free site, its door facing the street grid
    const site = findSite(Math.hypot(W, D) / 2 + 16); if (!site) return null;
    const f = toward(site[0], site[1]).map(c => -c), r = [-f[1], f[0]];
    const v = { name, cx: site[0], cz: site[1], f, r, W, D, H, seats: [], group: new THREE.Group() }; taken.push({ x: site[0], z: site[1], r: Math.hypot(W, D) / 2 + 16 });
    v.group.position.set(v.cx, 0, v.cz); v.group.rotation.y = Math.atan2(-f[1], f[0]); scenery.add(v.group);          // local x = toward the stage, local z = across
    const box = (w, h, d, x, y, z, mm = glass, lines = true) => { const g = new THREE.BoxGeometry(w, h, d), me = new THREE.Mesh(g, mm); me.position.set(x, y, z); me.raycast = () => {}; v.group.add(me);
      if (lines) { const e = new THREE.LineSegments(new THREE.EdgesGeometry(g), edge); e.position.copy(me.position); e.raycast = () => {}; v.group.add(e); } return me; };
    box(D, 0.5, W, 0, 0.25, 0, stone, false); box(D + 2, 0.6, W + 2, 0, H + 0.3, 0);                                                   // floor slab, roof slab
    box(0.8, H, W, D / 2, H / 2, 0); box(D, H, 0.8, 0, H / 2, W / 2); box(D, H, 0.8, 0, H / 2, -W / 2);                                       // the far wall and the two sides
    const gap = 14; box(0.8, H, (W - gap) / 2, -D / 2, H / 2, -(gap / 2 + (W - gap) / 4)); box(0.8, H, (W - gap) / 2, -D / 2, H / 2, gap / 2 + (W - gap) / 4);   // the door wall with a gap in the middle
    v.doorOut = venueXY(v, -D / 2 - 10, 0); v.doorIn = venueXY(v, -D / 2 + 8, 0);
    extras(v, box); seats(v); label(text, v.cx, H + 16, v.cz); addChairs(v); return v; };
  const COLS = 28, ROWP = 4.6, SEATW = 4.0, AISLE = 5, rows = Math.ceil(people.length / COLS);
  places.forum = hall('forum', 'Ford Hall Forum', COLS * SEATW + AISLE + 24, 14 + rows * ROWP + 8 + 26, 15,
    v => { for (let j = 0; j < rows; j++) for (let c = 0; c < COLS; c++) { const side = c < COLS / 2 ? -1 : 1, w = side * (AISLE / 2 + SEATW / 2 + (c % (COLS / 2)) * SEATW), u = -v.D / 2 + 18 + j * ROWP, [x, y] = venueXY(v, u, w); v.seats.push({ x, y, row: j, w, u, head: seatHead(v) }); } },
    (v, box) => { box(26, 1.4, v.W - 8, v.D / 2 - 13, 0.9, 0, stone, false); box(3, 3.2, 6, v.D / 2 - 9, 2.6, 0, stone, false); box(0.6, 8, 40, v.D / 2 - 1.2, 5, 0, black, false); });   // the stage, the lectern and a black screen on the far wall (after the lecture hall that inspired it)
  const url = async k => await modelFile(k);
  const [villaG, castleG, suiteG, aptG] = await Promise.all([url('villa'), url('castle'), url('suite'), url('apartment')].map(async u => (await u) ? 1 : 0)).then(async () => [
    await url('villa').then(u => u && loadScene(u, 70, 'xz', false, true)), await url('castle').then(u => u && loadScene(u, 80, 'xz')), await url('suite').then(u => u && loadScene(u, 46, 'xz')), await url('apartment').then(u => u && loadScene(u, 44, 'xz'))]);
  const model = (key, g, radius, score, text, doorGap, tight, lawn) => {                                          // an opaque model at a free site, its front (+z) facing the street grid; people vanish through its door
    if (!g) return null; const site = findSite(radius, score, tight, lawn); if (!site) return null;
    const a = toward(site[0], site[1]), inst = g.clone(), hd = g.userData.size[2] / 2; inst.position.set(site[0], 0, site[1]); inst.rotation.y = Math.atan2(a[0], a[1]); inst.traverse(o => { o.raycast = () => {}; }); scenery.add(inst);
    taken.push({ x: site[0], z: site[1], r: radius }); label(text, site[0], g.userData.size[1] + 14, site[1], 48);
    return { key, cx: site[0], cz: site[1], a, size: g.userData.size, doorOut: [site[0] + a[0] * (hd + doorGap + 8), site[1] + a[1] * (hd + doorGap + 8)], doorIn: [site[0] + a[0] * Math.max(2, hd - doorGap), site[1] + a[1] * Math.max(2, hd - doorGap)] }; };
  places.castle = model('castle', castleG, 74, (x, z) => Math.abs(Math.hypot(x - C0[0], z - C0[1]) - 640), 'Peikoff Manor', 6);   // well out from the city: the open site nearest 640 m from its centre
  const cs = places.castle;
  if (cs) {                                                                                        // the mother-in-law suite right beside the castle, and Carl's house on the far side of the city
    places.suite = model('suite', suiteG, 36, (x, z) => Math.hypot(x - cs.cx, z - cs.cz), 'Peikoff Manor Cottage', 4);
    const mirror = [2 * C0[0] - cs.cx, 2 * C0[1] - cs.cz]; places.carl = model('carl', castleG, 74, (x, z) => Math.hypot(x - mirror[0], z - mirror[1]), "Carl's house", 6);
  } else { places.suite = model('suite', suiteG, 36, undefined, 'Peikoff Manor Cottage', 4); places.carl = model('carl', castleG, 74, undefined, "Carl's house", 6); }
  places.apartment = model('apartment', aptG, 44, undefined, 'Apartment building', 3);
  const vSize = villaG ? villaG.userData.size : null;                                                // the villa stands right against the lake: its footprint (and the lawn in front of it) may touch the beach but not the water; of the spots that do, the one nearest the city
  const villa = model('villa', villaG, vSize ? Math.min(vSize[0], vSize[2]) / 2 + 6 : 50, (x, z) => Math.max(0, lakeK(x, z) - 1) * Math.min(T_.LRX, T_.LRZ) + 0.03 * Math.hypot(x - C0[0], z - C0[1]), "Ayn Rand's villa", 0, true, vSize ? { off: vSize[2] / 2 + 26, r: 26 } : null);   // the salon is a ring of chairs on its lawn
  if (villa) { const a = villa.a, R_ = 11, D_ = 44, W_ = 44, cx = villa.cx + a[0] * (villa.size[2] / 2 + 26), cz = villa.cz + a[1] * (villa.size[2] / 2 + 26), f = [-a[0], -a[1]], r = [-f[1], f[0]];
    const v = { name: 'salon', cx, cz, f, r, W: W_, D: D_, seats: [], villa }; const NS = Math.max(1, (city.salon || []).length - 1);
    for (let n = 0; n < NS; n++) { const ang = Math.PI * 2 * n / NS + Math.PI / NS, u = Math.cos(ang) * R_, w = Math.sin(ang) * R_, [x, y] = venueXY(v, u, w); v.seats.push({ x, y, row: n, w, u, head: Math.atan2(-(Math.cos(ang) * f[0] + Math.sin(ang) * r[0]), -(Math.cos(ang) * f[1] + Math.sin(ang) * r[1])) * 180 / Math.PI }); }
    v.doorOut = venueXY(v, -D_ / 2 - 8, 0); v.doorIn = venueXY(v, -D_ / 2 + 8, 0); addChairs(v); places.salon = v; taken.push({ x: cx, z: cz, r: 30 });
    // the villa took its place on the beach without regard to the gulch cottages scattered along the shore: any cottage within CLEAR_VILLA of its walls (measured from the villa's own rectangle, not a circle)
    // or within CLEAR_LAWN of the middle of the salon ring is moved the shortest way to a spot with a bigger margin, never into the water, onto a mountain, or against another cottage
    // Rand's Estate, the temple-courtyard building (models.json "estate") is part of her estate: beside the villa, facing the city like it, on dry ground, never over water or a mountain; cottages keep clear of it too
    const parthG = await url('estate').then(u => u && loadScene(u, 46, 'xz')); let pth = null;
    if (parthG) { const R_p = Math.max(parthG.userData.size[0], parthG.userData.size[2]) / 2, hw0 = villa.size[0] / 2, vr0 = [-villa.a[1], villa.a[0]];
      const dry = (x, z) => lakeK(x, z) >= 1.05 && surf_(x, z) <= 0.3 && [0, 1, 2, 3, 4, 5, 6, 7].every(k => { const q = k * Math.PI / 4; return lakeK(x + Math.cos(q) * R_p, z + Math.sin(q) * R_p) >= 1.05 && surf_(x + Math.cos(q) * R_p, z + Math.sin(q) * R_p) <= 0.3; });
      for (let d = hw0 + R_p + 14; d <= hw0 + R_p + 90 && !pth; d += 8) for (const sgn of [-1, 1]) { const x = villa.cx + vr0[0] * sgn * d, z = villa.cz + vr0[1] * sgn * d;
        if (dry(x, z) && !taken.some(t_ => Math.hypot(t_.x - x, t_.z - z) < t_.r + R_p + 4)) { pth = { x, z, r: R_p + 4 }; break; } }
      if (pth) { const inst = parthG.clone(); inst.position.set(pth.x, 0, pth.z); inst.rotation.y = Math.atan2(villa.a[0], villa.a[1]); inst.traverse(o => { o.raycast = () => {}; }); scenery.add(inst);
        taken.push(pth); label("Rand's Estate", pth.x, parthG.userData.size[1] + 14, pth.z, 48); scenery.userData.estate = { x: pth.x, z: pth.z, r: pth.r }; } }
    // her Rolls-Royce (models.json "rollsroyce") is parked against the villa on the side away from Rand's Estate, parallel to the house, on dry ground
    const rollsG = await url('rollsroyce').then(u => u && loadScene(u, 14, 'xz'));
    if (rollsG) { const hw1 = villa.size[0] / 2, vr1 = [-villa.a[1], villa.a[0]], others = taken.filter(t_ => t_ !== pth && !(t_.x === villa.cx && t_.z === villa.cz)); let spot = null;                               // the strip between the villa wall and Rand's Estate, or the other side
      for (let d = hw1 + 6; d <= hw1 + 16 && !spot; d += 2) for (const sg of [1, -1]) { const x = villa.cx + vr1[0] * sg * d, z = villa.cz + vr1[1] * sg * d;
        if (lakeK(x, z) >= 1.05 && surf_(x, z) <= 0.3 && (!pth || Math.hypot(x - pth.x, z - pth.z) >= 28) && !others.some(t_ => Math.hypot(t_.x - x, t_.z - z) < t_.r + 8)) { spot = [x, z]; break; } }
      if (spot) { const inst = rollsG.clone(); inst.position.set(spot[0], 0.05, spot[1]); inst.rotation.y = Math.atan2(villa.a[0], villa.a[1]); inst.traverse(o => { o.raycast = () => {}; }); scenery.add(inst);
        scenery.userData.rollsRoyce = { x: spot[0], z: spot[1] }; } }
    const CLEAR_VILLA = 30, CLEAR_LAWN = 46, hd_ = villa.size[2] / 2, hw_ = villa.size[0] / 2, vr_ = [-villa.a[1], villa.a[0]];
    const gapVilla = (x, z) => { const dx = x - villa.cx, dz = z - villa.cz, u_ = dx * villa.a[0] + dz * villa.a[1], w_ = dx * vr_[0] + dz * vr_[1]; return Math.hypot(Math.max(0, Math.abs(u_) - hd_), Math.max(0, Math.abs(w_) - hw_)); };
    for (const c_ of cottages) { const p_ = c_.m.position; if (gapVilla(p_.x, p_.z) >= CLEAR_VILLA && Math.hypot(p_.x - cx, p_.z - cz) >= CLEAR_LAWN && !(pth && Math.hypot(p_.x - pth.x, p_.z - pth.z) < pth.r + 14)) continue;
      let best_ = null, bd_ = 1e9;
      for (let ox = -130; ox <= 130; ox += 8) for (let oz = -130; oz <= 130; oz += 8) { const d_ = Math.hypot(ox, oz), x = p_.x + ox, z = p_.z + oz; if (d_ >= bd_) continue;
        if (gapVilla(x, z) < CLEAR_VILLA + 6 || Math.hypot(x - cx, z - cz) < CLEAR_LAWN + 6 || lakeK(x, z) < 1.05 || surf_(x, z) > 0.3 || taken.some(t_ => Math.hypot(t_.x - x, t_.z - z) < t_.r + 6)
          || cottages.some(q_ => q_ !== c_ && Math.hypot(q_.m.position.x - x, q_.m.position.z - z) < 16)) continue;
        best_ = [x, z]; bd_ = d_; }
      if (best_) p_.set(best_[0], 0, best_[1]); } }
  // props sprinkled on open ground (models.json "oilpump", "rover"): an oil field of pumps inside the train loop (between the city and the track, never on the track), and rovers beside the Atlantis Mine
  { const RW = scenery.userData.railway, rail_ = scenery.children.find(c_ => c_.isGroup && c_.position.y === 0.15 && c_.children.length > 10), railPts = rail_ ? rail_.children.map(c_ => [c_.position.x, c_.position.z]) : [];
    const [pumpG, roverG] = await Promise.all([url('oilpump').then(u => u && loadScene(u, 13, 'xz')), url('rover').then(u => u && loadScene(u, 11, 'xz'))]), placed = { pumps: [], rovers: [] };
    const drop = (g, site, r, list) => { const inst = g.clone(); inst.position.set(site[0], 0, site[1]); inst.rotation.y = Math.atan2(site[1] - C0[1], site[0] - C0[0]) + Math.PI / 2; inst.traverse(o => { o.raycast = () => {}; }); scenery.add(inst); taken.push({ x: site[0], z: site[1], r }); list.push({ x: site[0], z: site[1] }); };
    const offTrack = (x, z, d) => !railPts.some(q_ => Math.hypot(q_[0] - x, q_[1] - z) < d), wetP = scenery.userData.streams.map(S_ => Array.from({ length: 160 }, (_, i) => { const q_ = S_.curve.getPointAt(i / 159); return [q_.x, q_.z, S_.w0 + (S_.w1 - S_.w0) * i / 159]; }));
    const clearAt = (x, z, r, trk) => lakeK(x, z) >= 1.05 && offTrack(x, z, trk) && [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].every(([dx, dz]) => surf_(x + dx, z + dz) <= 0.3) && !taken.some(t_ => Math.hypot(t_.x - x, t_.z - z) < t_.r + r)
      && !cottages.some(c_ => Math.hypot(c_.m.position.x - x, c_.m.position.z - z) < r + 12) && !B.some(b_ => x > b_.x0 - r - 10 && x < b_.x1 + r + 10 && z > b_.y0 - r - 10 && z < b_.y1 + r + 10)
      && !wetP.some(a_ => a_.some(q_ => Math.hypot(q_[0] - x, q_[1] - z) < q_[2] * 0.8 + r + 6));
    const spot = (want, r, trk, inside) => { let best = null, bd = 1e18; for (let x = -900; x <= 1400; x += 10) for (let z = -900; z <= 1400; z += 10) { const d = Math.hypot(x - want[0], z - want[1]); if (d >= bd || (inside && !inside(x, z)) || !clearAt(x, z, r, trk)) continue; best = [x, z]; bd = d; } return best; };
    if (pumpG && RW) { for (let n = 0; n < 3; n++) { const s0 = RW.total * (0.1 + 0.1 * n) + 60, a_ = RW.pos(s0), b_ = RW.pos(s0 + 4), tl = Math.hypot(b_.x - a_.x, b_.z - a_.z) || 1, side = n % 2 ? 1 : -1;   // an oil field beside the line between the depot and the mountain, at least 40 m from the track
        const site = spot([a_.x - (b_.z - a_.z) / tl * 80 * side, a_.z + (b_.x - a_.x) / tl * 80 * side], 16, 40, null); if (site) drop(pumpG, site, 16, placed.pumps); } }
    if (roverG) { const mine = scenery.userData.mine, want = mine ? mine.shaft : [C0[0] + 700, C0[1]];
      for (let n = 0; n < 2; n++) { const site = spot(want, 14, 30); if (site) drop(roverG, site, 14, placed.rovers); } }
    scenery.userData.props = placed; }
  // bridges: a dry run of the walks of every 4th person to every place (the street lanes round the city as well as the open ground beyond them) shows where the routes cross a stream; one bridge is built at each
  // crossing (routes that cross within 60 m of an existing bridge share it), and from then on every walk that would wade goes over the nearest bridge. Lake stretches are left alone.
  { const G = water(), SS = scenery.userData.streamSamples, t0 = performance.now();
    const note = (a, b) => { for (const st of wetStretches(G, [a[0], a[1]], [b[0], b[1]])) {
      const tm = (st.t0 + st.t1) / 2, mx = a[0] + (b[0] - a[0]) * tm, mz = a[1] + (b[1] - a[1]) * tm; let best = null;
      for (const smp of SS) { const f = streamFrame(smp, mx, mz); if (!best || f.dist < best.dist) best = f; }
      if (!best || best.dist > best.hw + 6 || (st.t1 - st.t0) * Math.hypot(b[0] - a[0], b[1] - a[1]) > 5 * best.hw + 20 || bridges.some(q => Math.hypot(q.C[0] - best.x, q.C[1] - best.z) < 60)) continue;
      bridges.push(makeBridge(best, G)); } };
    planningBridges = true;
    for (let i = 0; i < people.length; i += 4) for (const d of [places.forum, places.castle, places.suite, places.carl, places.apartment, places.salon]) if (d)
      for (const L of routeTo(i, d, { kind: 'place', target: { type: 'inside' }, via: [] }, 3)) if (!L.ride) note(L.a, L.b);
    planningBridges = false;
    bridges.forEach((br, n) => buildBridge(br, n)); scenery.userData.bridges = bridges; scenery.userData.water = water; scenery.userData.bridgePlanMs = Math.round(performance.now() - t0); }
  scenery.userData.places = places;
})();

renderer.setAnimationLoop(t => { const dt = Math.min(Math.max((t - last) / 1000, 0), 0.1); tick++; move(dt); stepFly(dt); stepWalkers(dt); stepLife(dt, (t || 0) / 1000); stepFigures(dt); scenery.userData.stepFish(dt, (t || 0) / 1000); scenery.userData.stepShip?.(dt, (t || 0) / 1000); scenery.userData.stepLab?.((t || 0) / 1000, camera); scenery.userData.stepPrincess?.((t || 0) / 1000); scenery.userData.stepMidas?.((t || 0) / 1000); stepProps(); scenery.userData.stepTrains?.(dt); stepMine(dt); last = t; hover(); controls.update(); renderer.render(scene, camera); });

// small hook for automated screenshots/tests
window.__viewer = { figs, hairWho, buildings: B, scenery, eggs, eggMeshes, cottages, fish, music, walkers, stepWalkers, life: { anim, pose, pairs, rigid, stepLife }, personMeshes, planPath, signScreen(n) { const spr = signs.children[n], v = spr.position.clone().project(camera); return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, name: B[spr.userData.bi].name }; }, camera, controls, select, selectBuilding, flyToBuilding, ids, people, flyTo, search: q => { box.value = q; renderResults(); return hits.map(h => h.label); },
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
