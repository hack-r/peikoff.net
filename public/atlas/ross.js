// Ross Ulbricht, a character who lives only in the Atlas: he stands in the Atlas jail. A visitor who chats with him (as an admin or paid user) can sign the in-world petition,
// the "Help free Ross" button in the chat window; then the cell opens and he walks out. The jail is a game inside the Atlas (the real Ross Ulbricht was pardoned in January 2025).
// The pure helpers (pickClip, petitionState, walkOut) are unit-tested in node; loadRoss() builds the animated figure from the ready-made character in models.json ("ross").
import * as THREE from 'three';
import { GLTFLoader } from './vendor/GLTFLoader.js';

import { pickClip } from './ross-story.js';
export { ROSS, petitionState, walkOut } from './ross-story.js';

/** Loads the character: { root (a Group at the feet), proxy (the invisible mesh he is picked by), play(state), mixer, height } or null. */
export async function loadRoss(url) {
  try {
    const gltf = await new GLTFLoader().loadAsync(url), inner = gltf.scene, box = new THREE.Box3().setFromObject(inner), height = box.max.y - box.min.y;
    inner.position.y = -box.min.y; const root = new THREE.Group(); root.add(inner);
    inner.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.raycast = () => {}; } });          // a skinned mesh's bind-pose bounds are tiny: he is picked by the proxy
    const proxy = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, height, 8), new THREE.MeshBasicMaterial({ visible: false })); proxy.position.y = height / 2; root.add(proxy);
    const mixer = new THREE.AnimationMixer(inner), names = gltf.animations.map(a => a.name), acts = {};
    for (const s of ['idle', 'walk']) { const n = pickClip(names, s), clip = n && gltf.animations.find(a => a.name === n); if (clip) acts[s] = mixer.clipAction(clip); }
    let cur = null;
    const play = state => { const a = acts[state] || acts.idle; if (!a) return; if (cur !== a) { cur?.fadeOut(0.25); a.reset().fadeIn(0.25).play(); cur = a; } };
    return { root, proxy, mixer, play, height };
  } catch (e) { return null; }
}
