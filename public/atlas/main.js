import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';
import { createMusic } from './music.js';
import { makeArch, planLegs } from './paths.js';
import { loadBuilding, loadFigure, loadRaw, tintLargeFaces, dropTriangles, withRoof } from './models.js';
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
    part(mergeGeometries([                                                          // gown pooled around her on the rock, gold hem
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
      ...Array.from({ length: 5 }, (_, n) => { const a = n * Math.PI * 2 / 5; return col(new THREE.ConeGeometry(0.03, 0.1, 5).translate(Math.cos(a) * 0.115, 1.83, Math.sin(a) * 0.115), GOLD_); }),
      col(new THREE.BoxGeometry(0.3, 0.025, 0.22).translate(0, 1.06, 0.34), '#6b3b1f'),                                 // the book open on her lap: cover,
      col(new THREE.BoxGeometry(0.13, 0.02, 0.2).rotateZ(0.12).translate(-0.075, 1.085, 0.34), '#f3ecd6'),            // left page,
      col(new THREE.BoxGeometry(0.13, 0.02, 0.2).rotateZ(-0.12).translate(0.075, 1.085, 0.34), '#f3ecd6')]), upper);   // right page
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
      const fig = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide, flatShading: true }));
      fig.scale.setScalar(1.5); fig.rotation.y = Math.PI; fig.position.y = 0.47; fig.raycast = () => {};   // the model faces -z, Kira faces +z; scaled so its head and shoulders sit where Kira's did
      for (const ch of [...princess.children]) if (ch !== kiraHit && ch !== upper) princess.remove(ch);
      for (const ch of [...upper.children]) if (ch !== armR && ch !== hairBack) upper.remove(ch);   // built-in gown, body and head go; her pen arm stays and keeps scribbling
      part(mergeGeometries([                                                                      // the same left arm resting on the book, and the same book as the built-in Kira
        col(new THREE.CylinderGeometry(0.04, 0.035, 0.46, 8).rotateX(-1.15).translate(-0.2, 1.22, 0.2), SKIN_),
        col(new THREE.BoxGeometry(0.3, 0.025, 0.22).translate(0, 1.06, 0.34), '#6b3b1f'),
        col(new THREE.BoxGeometry(0.13, 0.02, 0.2).rotateZ(0.12).translate(-0.075, 1.085, 0.34), '#f3ecd6'), col(new THREE.BoxGeometry(0.13, 0.02, 0.2).rotateZ(-0.12).translate(0.075, 1.085, 0.34), '#f3ecd6')]), upper);
      upper.add(fig); scenery.userData.princessModel = true;
    });
    scenery.userData.stepPrincess = t => {                                           // idle animation: every motion is just a sine wave of time
      princess.rotation.y = base + Math.sin(t * 0.25) * 0.35;                         // slowly glances left and right
      upper.rotation.x = 0.12 + Math.sin(t * 0.5) * 0.03;                             // leans over the page, breathing
      hairBack.rotation.x = Math.sin(t * 1.1) * 0.05;                                 // hair swings
      armR.rotation.x = -1.15 + Math.sin(t * 7) * 0.07; armR.rotation.z = 0.1 + Math.sin(t * 3.5) * 0.08;   // the pen scribbles across the page
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
    fishGroup.add(m); fish.push({ w, m, kind: dead ? 'defunct' : kindOf(w), dead, sc, st, t: rnd(), off: (rnd() - 0.5) * 0.55, ph: rnd() * 6.28, v: (2.0 + rnd() * 1.2) * (dead ? 0.7 : 1) });
  });
  const P3 = new THREE.Vector3(), T3 = new THREE.Vector3(), ramp = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
  scenery.userData.stepFish = (dt, time) => {                          // 2-3 m/s; at the end of a stream a fish dissolves into the mist and a new one rises at the spring: the same fish, looping forever
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
  ship.add(hull); ship.scale.setScalar(14);
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
    ship.position.set(P3.x - T3.z * side, 0.9 + Math.sin(time * 1.3) * 0.25, P3.z + T3.x * side);
    ship.rotation.set(Math.sin(time * 1.1) * 0.06, Math.atan2(-T3.z, T3.x), Math.sin(time * 0.9) * 0.1);                    // pitch and roll on the water
    ship.scale.setScalar(14 * Math.max(0.001, ramp(t / 0.03) * ramp((1 - t) / 0.03)));
  };
  scenery.userData.stepShip(0, 0);
}

// --- Easter egg: Midas Peikoff, a dog, flies a red plane in slow circles high above the gulch (models.json "midas": the .glb is "Dog in plane"; its plane is recolored Peikoff red). Scenery only: no data row.
modelFile('midas').then(u => u && loadFigure(u, (c_, g_) => c_.r < 0.05 && c_.g < 0.05 ? tintLargeFaces(g_, new THREE.Color('#a8501c'), c_) : (Math.abs(c_.r - 0.87) < 0.05 && Math.abs(c_.g - 0.12) < 0.05 && Math.abs(c_.b - 0.29) < 0.05) ? new THREE.Color('#c8141c') : (Math.abs(c_.r - 0.74) < 0.05 && Math.abs(c_.g - 0.33) < 0.05) ? new THREE.Color('#d9a066') : null)).then(geo => {   // red/sable coat (eyes and nose stay dark), tan points, a true red plane
  if (!geo) return;
  const plane = new THREE.Group(), body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide, flatShading: true }));
  body.position.y = -geo.userData.height / 2; plane.add(body); plane.scale.setScalar(26);                       // longest side 26 units: the nose (propeller) points along +x
  const hit = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 1.1), new THREE.MeshBasicMaterial({ visible: false })); plane.add(hit);
  hit.userData.egg = eggs.length; eggMeshes.push(hit); body.raycast = () => {};
  eggs.push({ hidden: false, tip: '<b>Midas Peikoff</b><br>a dog in a red plane \u00b7 click', title: 'Midas Peikoff', rows: () => [
    ['What', 'A dog flying a red plane: an Easter egg, not a person in the data'], ['Model', 'Dog in plane by Nikki Morin (see models/README.md)']] });
  scenery.add(plane);
  const R1 = E * 0.42, R0 = E * 1.5, H = 150, APPROACH = 50;                                       // starts well out from the city and spirals in toward it, then circles
  const at = time => { const k = Math.min(1, time / APPROACH), e = k * k * (3 - 2 * k), r = R0 + (R1 - R0) * e, a = 0.9 + time * 0.06 * (0.6 + 0.4 * e);
    return [E / 2 + Math.cos(a) * r, H + 40 * (1 - e) + Math.sin(time * 0.5) * 6, E / 2 + Math.sin(a) * r]; };
  let t0 = null;                                                                                      // the flight starts when the loop first runs it
  scenery.userData.stepMidas = time => {
    if (time > 0 && t0 === null) t0 = time; time = t0 === null ? 0 : time - t0;
    const p0 = at(time), p1 = at(time + 0.2); plane.position.set(p0[0], p0[1], p0[2]);
    plane.rotation.order = 'YXZ'; plane.rotation.set(0, Math.atan2(-(p1[2] - p0[2]), p1[0] - p0[0]), 0.18 + Math.sin(time * 0.9) * 0.05);   // nose along the direction of travel, banked into the turn
  };
  scenery.userData.stepMidas(0);
});

// --- Atlantis Railway (models.json "train": a folder of the Modular Train Pack .glb files): a closed track round the whole city, with three trains running on it (a locomotive set, a high-speed set and a cargo
// train). Pieces are used at 3x so they read from the hill. The loop is a rounded rectangle just outside the buildings (the margin is chosen to keep clear of mountains, the lake and cottages); scenery only.
modelFile('train').then(async base => {
  if (!base) return;
  const names = ['railway-track-straight', 'railway-track-curve', 'locomotive-front', 'locomotive-wagon', 'locomotive-passenger-carriage', 'high-speed-front', 'high-speed-wagon', 'cargo-train-front', 'cargo-train-wagon', 'cargo-train-container', 'cargo-train-coal-conta'];
  const G = {}; await Promise.all(names.map(async n => { G[n] = await loadRaw(base + n + '.glb'); })); if (names.some(n => !G[n])) return;
  G['railway-track-curve'] = G['railway-track-curve'].clone().translate(G['railway-track-curve'].userData.center[0], 0, G['railway-track-curve'].userData.center[1]);   // the curve piece starts at its origin, heading +x, and turns toward -z
  G['railway-track-curve'].userData.size = [18, 0.14, 18];
  const T = scenery.userData.terrain, TS = 3, R = 18 * TS, bx0 = Math.min(...B.map(b => b.x0)), bx1 = Math.max(...B.map(b => b.x1)), bz0 = Math.min(...B.map(b => b.y0)), bz1 = Math.max(...B.map(b => b.y1));
  const surf = (x, z) => { let y = 0; for (const p of T.peaks) { const d = Math.hypot(x - p.x, z - p.z); if (d < p.r) y = Math.max(y, p.h * (1 - d / p.r) - 2); } return y; };
  const wet = scenery.userData.streams.map(S_ => Array.from({ length: 240 }, (_, i) => { const q = S_.curve.getPointAt(i / 239); return [q.x, q.z, S_.w0 + (S_.w1 - S_.w0) * i / 239]; }));
  // the track must never touch water, mountains, cottages or buildings: mark every 8-unit cell of the plain as free or blocked, then look for the biggest closed loop (a rounded rectangle) near the city whose track and 4-unit edges are all free
  const CELL = 8, LO = -1000, NC = 250, blocked = new Uint8Array(NC * NC);
  const bad = (x, z) => surf(x, z) > 0.3 || T.inLake(x, z) || cottages.some(q => Math.hypot(q.m.position.x - x, q.m.position.z - z) < 16) || wet.some(a => a.some(q => Math.hypot(q[0] - x, q[1] - z) < q[2] * 0.8 + 14)) || B.some(b => x > b.x0 - 14 && x < b.x1 + 14 && z > b.y0 - 14 && z < b.y1 + 14);
  for (let i = 0; i < NC; i++) for (let j = 0; j < NC; j++) blocked[i * NC + j] = bad(LO + i * CELL, LO + j * CELL) ? 1 : 0;
  const isBad = (x, z) => { const i = Math.round((x - LO) / CELL), j = Math.round((z - LO) / CELL); return i < 0 || j < 0 || i >= NC || j >= NC || blocked[i * NC + j] === 1; };
  const clear = (x, z) => !(isBad(x, z) || isBad(x + 4, z) || isBad(x - 4, z) || isBad(x, z + 4) || isBad(x, z - 4));
  const loopFree = (x0, x1, z0, z1) => {
    const side = (ax, az, bx, bz) => { const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 6); for (let i = 0; i <= n; i++) if (!clear(ax + (bx - ax) * i / n, az + (bz - az) * i / n)) return false; return true; };
    if (!(side(x0 + R, z0, x1 - R, z0) && side(x1, z0 + R, x1, z1 - R) && side(x1 - R, z1, x0 + R, z1) && side(x0, z1 - R, x0, z0 + R))) return false;
    for (const [cx, cz, a0] of [[x1 - R, z1 - R, 0], [x1 - R, z0 + R, 3], [x0 + R, z0 + R, 2], [x0 + R, z1 - R, 1]]) for (let i = 0; i <= 10; i++) { const a = i / 10 * Math.PI / 2 + a0 * Math.PI / 2; if (!clear(cx + Math.cos(a) * R, cz + Math.sin(a) * R)) return false; }
    return true; };
  let r = null, bestScore = -1e9; const ccx = (bx0 + bx1) / 2, ccz = (bz0 + bz1) / 2;
  for (let x0 = -700; x0 <= 300; x0 += 40) for (let z0 = -400; z0 <= 600; z0 += 40) for (let W = 300; W <= 900; W += 60) for (let H = 240; H <= 800; H += 60) {
    const score = W * H - 500 * Math.hypot(x0 + W / 2 - ccx, z0 + H / 2 - ccz); if (score > bestScore && loopFree(x0, x0 + W, z0, z0 + H)) { bestScore = score; r = { x0, x1: x0 + W, z0, z1: z0 + H }; } }
  if (!r) return;                                                                                       // no clear ground for a loop: no railway
  const W = r.x1 - r.x0, H = r.z1 - r.z0, nx = Math.max(2, Math.round((W - 2 * R) / (18 * TS))), nz = Math.max(2, Math.round((H - 2 * R) / (18 * TS)));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.1, flatShading: true, side: THREE.DoubleSide }), rail = new THREE.Group(); rail.position.y = 0.15; scenery.add(rail);
  const put = (g, x, z, th, sx = 1) => { const mesh = new THREE.Mesh(g, mat); mesh.scale.set(TS * sx, TS, TS); mesh.position.set(x, 0, z); mesh.rotation.y = th; mesh.raycast = () => {}; rail.add(mesh); return mesh; };
  // the loop as a list of pieces: [type, start x, start z, heading]; headings: +x = 0, -z = pi/2, -x = pi, +z = 3pi/2
  const edges = [[r.x0 + R, r.z1, 0, W - 2 * R, nx], [r.x1, r.z1 - R, Math.PI / 2, H - 2 * R, nz], [r.x1 - R, r.z0, Math.PI, W - 2 * R, nx], [r.x0, r.z0 + R, 3 * Math.PI / 2, H - 2 * R, nz]];
  const pathSeg = [];                                                                                  // for trains: straights and arcs with their arc lengths
  edges.forEach(([sx, sz, th, len, n], k) => {
    const ux = Math.cos(th), uz = -Math.sin(th), piece = len / n;
    for (let i = 0; i < n; i++) put(G['railway-track-straight'], sx + ux * (piece * (i + 0.5)), sz + uz * (piece * (i + 0.5)), th, piece / (18 * TS));
    pathSeg.push({ kind: 'line', x: sx, z: sz, ux, uz, len });
    const ex = sx + ux * len, ez = sz + uz * len; put(G['railway-track-curve'], ex, ez, th);
    const lx = Math.cos(th + Math.PI / 2), lz = -Math.sin(th + Math.PI / 2);   // the curve turns left: its centre lies to the left of the heading
    pathSeg.push({ kind: 'arc', cx: ex + lx * R, cz: ez + lz * R, a0: Math.atan2(ez - (ez + lz * R), ex - (ex + lx * R)), th, len: R * Math.PI / 2 });
  });
  const total = pathSeg.reduce((a, s_) => a + s_.len, 0);
  const at = (s0, out) => {                                                                              // position and heading at arc length s0 along the loop
    let s = ((s0 % total) + total) % total; for (const g of pathSeg) { if (s <= g.len) {
      if (g.kind === 'line') { out.x = g.x + g.ux * s; out.z = g.z + g.uz * s; out.h = Math.atan2(-g.uz, g.ux); }
      else { const a = g.a0 - (s / R) , px = g.cx + Math.cos(a) * R, pz = g.cz + Math.sin(a) * R; out.x = px; out.z = pz; out.h = g.th + s / R; } return out; } s -= g.len; } return out; };
  const sizeOf = n => G[n].userData.size[0] * TS, CAR = n => ({ n, len: sizeOf(n) });
  const consists = [
    { name: 'Atlantis Express (locomotive set)', speed: 20, s: 0, cars: ['locomotive-front', 'locomotive-passenger-carriage', 'locomotive-wagon', 'locomotive-passenger-carriage', 'locomotive-wagon'].map(CAR) },
    { name: 'High-speed set', speed: 34, s: total / 3, cars: ['high-speed-front', 'high-speed-wagon', 'high-speed-wagon', 'high-speed-front'].map(CAR) },
    { name: 'Freight', speed: 14, s: 2 * total / 3, cars: ['cargo-train-front', 'cargo-train-wagon', 'cargo-train-container', 'cargo-train-coal-conta', 'cargo-train-container', 'cargo-train-wagon'].map(CAR) }];
  const GAP = 0.25 * TS, O = {}, O2 = {};                                                                // cars sit nearly buffer to buffer
  for (const tr of consists) {
    tr.meshes = tr.cars.map((c, i) => { const mesh = new THREE.Mesh(G[c.n], mat); mesh.scale.setScalar(TS); mesh.raycast = () => {}; if (tr.name.startsWith('High') && i === tr.cars.length - 1) mesh.userData.flip = true; rail.add(mesh); return mesh; });
    tr.span = tr.cars.reduce((a, c) => a + c.len + GAP, -GAP);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(tr.span * 0.9, 3 * TS, 2.4 * TS).translate(0, 1.5 * TS, 0), new THREE.MeshBasicMaterial({ visible: false })); hit.userData.egg = eggs.length; eggMeshes.push(hit); rail.add(hit); tr.hit = hit;
    eggs.push({ hidden: false, tip: '<b>' + tr.name + '</b><br>Atlantis Railway · click', title: tr.name, rows: () => [['What', 'A train on the Atlantis Railway, a loop of track on the plain: scenery, not data'], ['Models', 'Modular Train Pack (see models/README.md)']] });
  }
  // steam: the locomotive's funnel puffs smoke that rises, swells and fades in the air (world space, so it trails behind as the train moves on)
  const puffTex = (() => { const c_ = document.createElement('canvas'); c_.width = c_.height = 64; const g = c_.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 31); gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(0.55, 'rgba(235,235,235,.55)'); gr.addColorStop(1, 'rgba(235,235,235,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c_); })();
  const puffs = Array.from({ length: 34 }, () => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, opacity: 0 })); sp.visible = false; sp.raycast = () => {}; scenery.add(sp); return { sp, age: 99 }; });
  const PUFF_LIFE = 3.4, STACK = [-1.55, 3.55, 0];                                                       // the funnel in the locomotive model's own units (the front is toward -x)
  let puffNext = 0, puffAcc = 0;
  const emitPuff = (x, z, vx, vz, age) => { const q = puffs[puffNext++ % puffs.length]; q.age = age; q.x = x; q.z = z; q.vx = vx; q.vz = vz; q.sp.visible = true; };
  scenery.userData.stepTrains = dt => {
    dt = Math.max(0, dt || 0);
    for (const tr of consists) {
      tr.s += tr.speed * dt;                                                                             // tr.s is the position of the front of the train; cars follow behind
      let back = 0;
      tr.cars.forEach((c, i) => {                                                                        // a car lies on the chord between the track points under its two ends, so on a curve it stays joined to its neighbours
        at(tr.s - back, O); at(tr.s - back - c.len, O2); back += c.len + GAP;
        const mesh = tr.meshes[i]; mesh.position.set((O.x + O2.x) / 2, 0, (O.z + O2.z) / 2);
        mesh.rotation.y = Math.atan2(-(O.z - O2.z), O.x - O2.x) + Math.PI + (mesh.userData.flip ? Math.PI : 0);   // the models' own fronts face -x
      });
      at(tr.s - tr.span / 2, O); tr.hit.position.set(O.x, 0, O.z); tr.hit.rotation.y = O.h;
    }
    const loco = consists[0], lm = loco.meshes[0], th = lm.rotation.y, ct = Math.cos(th), st = Math.sin(th), hx = -ct, hz = st;   // the funnel's world position, and the way the loco heads
    const fx = lm.position.x + (STACK[0] * ct + STACK[2] * st) * TS, fz = lm.position.z + (-STACK[0] * st + STACK[2] * ct) * TS;
    puffAcc += dt; while (puffAcc >= 0.16) { puffAcc -= 0.16; const late = puffAcc; emitPuff(fx - hx * loco.speed * late, fz - hz * loco.speed * late, hx * loco.speed * 0.25, hz * loco.speed * 0.25, late); }
    for (const q of puffs) { if (q.age >= PUFF_LIFE) { q.sp.visible = false; continue; } q.age += dt; const k = Math.min(1, q.age / PUFF_LIFE);
      q.sp.position.set(q.x + q.vx * q.age, STACK[1] * TS + 2.5 + q.age * 5.5, q.z + q.vz * q.age); q.sp.scale.setScalar(5 + 16 * k); q.sp.material.opacity = 0.62 * (1 - k) * Math.min(1, q.age * 5); }
  };
  scenery.userData.stepTrains(0); scenery.userData.railway = { total, rect: r, trains: consists };
});

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
const hairIdx = new Int32Array(people.length).fill(-1), hairWho = (city.hair || []).map(id => ids.indexOf(id)).filter(i => i >= 0);
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
hairWho.forEach((i, n) => hairMesh.setColorAt(n, new THREE.Color(HAIR_COLORS[(+ids[i].slice(1) * 7 + 3) % HAIR_COLORS.length])));
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
    const mesh = makeInstanced(REGALIA_GEO[k], new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .5, metalness: ['robe', 'hair', 'face', 'dress'].includes(k) ? 0 : .5, side: THREE.DoubleSide }), who.length);
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
function placeOne(i) {            // matrices of one person from its current people[i] position + heading + pose
  const [x, y, z, kind, heading] = people[i], p = pose[i];
  const k = (kind === 1 ? elIn.checked : elSt.checked) ? +elSz.value : 0.0001;
  m.compose(P(x, y, z), q.setFromAxisAngle(UP, heading * Math.PI / 180 + p[IYAW]), sc.set(k, k, k));
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
function secretKira() {                                              // Easter egg shortcut: fly to Kira Peikoff on the far side of the mountain and show her card
  const pr = scenery.userData.princess; if (!pr) return false;
  const ry = pr.rotation.y, tgt = pr.position.clone().add(new THREE.Vector3(0, 16, 0)), to = pr.position.clone().add(new THREE.Vector3(Math.sin(ry) * 62, 40, Math.cos(ry) * 62));
  fly = { t: 0, fromT: controls.target.clone(), fromC: camera.position.clone(), toT: tgt, toC: to };
  const ei = eggs.findIndex(e => e.title === 'Kira Peikoff'); if (ei >= 0) selectEgg(eggs[ei]);
  return true;
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
  } else if (e.key === 'Enter') { if (fold(box.value.trim()) === 'kp' && secretKira()) { box.value = ''; list.style.display = 'none'; box.blur(); } else pick(active); }   // a secret: KP + Enter flies to the princess
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
  const legs = planLegs({ B, arch, bA, bT, from: people[w.i].slice(0, 3), tx: rnd(T.x0 + 1, T.x1 - 1), ty: rnd(T.y0 + 1, T.y1 - 1), tz, o: w.off, pitch: PITCHP });
  w.path = { legs, li: 0, d: 0, hold: legs.length ? legs[0].hold : 0, next: nk, walked: 0 };
  if (!legs.length) w.path.li = 0;
}
function stepWalkers(dt) {
  if (!walkers.length || !$('cbWalk').checked) return;
  const speed = +$('walkSpeed').value, k = Math.max(0.1, +elSz.value);
  for (const w of walkers) {
    const p = people[w.i];
    if (w.phase === 'dwell') {
      w.wait -= dt;
      if (w.wait <= 0) { planPath(w); w.phase = 'walk'; }
      continue;
    }
    const P_ = w.path; let leg = P_.legs[P_.li];
    walkStamp[w.i] = tick;
    if (leg && P_.hold > 0) { P_.hold -= dt; walkRide[w.i] = 1; }                                       // waiting for the elevator
    else if (leg) {
      P_.d += (leg.ride ? speed * 2.5 : speed) * dt;
      if (!leg.ride) P_.walked += speed * dt;
      const f = Math.min(1, P_.d / leg.len), a = leg.a, b = leg.b;
      p[0] = a[0] + (b[0] - a[0]) * f; p[1] = a[1] + (b[1] - a[1]) * f; p[2] = a[2] + (b[2] - a[2]) * f;
      walkRide[w.i] = leg.ride ? 1 : 0;
      if (leg.ride) { cabZ[leg.bi] = p[2]; cabBusy[leg.bi] = tick; placeCab(leg.bi); }
      else p[4] += wrap180(Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI - p[4]) * Math.min(1, dt * 12);   // turn to face where they are going
      if (P_.d >= leg.len) { P_.li++; P_.d = 0; P_.hold = P_.legs[P_.li]?.hold || 0; }
    }
    walkPh[w.i] = P_.walked / (k * 0.7);                                                                 // the walk cycle (stepLife) advances with distance walked
    if (P_.li >= P_.legs.length) { w.k = P_.next; p[5] = w.route[w.k]; w.phase = 'dwell'; w.wait = rnd(4, 14); w.path = null; walkRide[w.i] = 0; }
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
    case 'walk': {
      if (walkRide[i]) { T[0] = 0.01 + breath * 0.006; break; }                       // standing in the elevator
      const w = Math.sin(walkPh[i]);
      setLeg(T, -1, w * 0.6, 0); setLeg(T, 1, -w * 0.6, 0); setArm(T, -1, -w * 0.5, -0.05, -0.25); setArm(T, 1, w * 0.5, -0.05, -0.25);
      T[0] = 0.06; T[2] = Math.sin(walkPh[i] * 2) * 0.02; break; }
  }
  if (ri) { const yaw = T[IYAW]; T.set(REST); T[IYAW] = a.s === 'idle' ? Math.sin(t * 0.3 + ph) * 0.12 : yaw; return; }       // costume parts are rigid: turn only
  if (a.s !== 'idle' && a.s !== 'talk' && a.s !== 'walk') for (let j = 0; j < NP; j++) T[j] = REST[j] + (T[j] - REST[j]) * (j === IYAW || a.s === 'look' ? 1 : e);
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
  const hit = ray.intersectObjects(personMeshes, true)[0];
  if (!hit) return -1;
  if (bMat.opacity > 0.95) { const wall = ray.intersectObject(bMesh, true)[0]; if (wall && wall.distance < hit.distance) return -1; }
  return instOf(hit);
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
let down = null;
const el = renderer.domElement;
el.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
el.addEventListener('pointerup', e => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) { down = null; return; } // it was a drag
  down = null; setRay(e);
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
renderer.setAnimationLoop(t => { const dt = Math.min(Math.max((t - last) / 1000, 0), 0.1); tick++; move(dt); stepFly(dt); stepWalkers(dt); stepLife(dt, (t || 0) / 1000); scenery.userData.stepFish(dt, (t || 0) / 1000); scenery.userData.stepShip?.(dt, (t || 0) / 1000); scenery.userData.stepLab?.((t || 0) / 1000, camera); scenery.userData.stepPrincess?.((t || 0) / 1000); scenery.userData.stepMidas?.((t || 0) / 1000); scenery.userData.stepTrains?.(dt); last = t; hover(); controls.update(); renderer.render(scene, camera); });

// small hook for automated screenshots/tests
window.__viewer = { hairWho, buildings: B, scenery, eggs, eggMeshes, cottages, fish, music, walkers, stepWalkers, life: { anim, pose, pairs, rigid, stepLife }, personMeshes, planPath, signScreen(n) { const spr = signs.children[n], v = spr.position.clone().project(camera); return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, name: B[spr.userData.bi].name }; }, camera, controls, select, selectBuilding, flyToBuilding, ids, people, flyTo, search: q => { box.value = q; renderResults(); return hits.map(h => h.label); },
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
