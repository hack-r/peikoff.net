// Ready-made animated characters (models.json "person_<id>" slots) for a few named people. A figure replaces the plain instanced person while that person stands or walks;
// sitting down (the chairs of the salon and the forum) or playing the guitar uses the plain person again, because these models have no sitting clips.
// pickClip(), figureActive() and fitScale() are pure, so they are unit-tested in node.
import * as THREE from 'three';
import { GLTFLoader } from './vendor/GLTFLoader.js';

export const PERSON_HEIGHT = 1.72;                                   // a plain person at size 1

/** Which of the model's clip names plays for a state ('idle' | 'walk'): the first that matches, or null. Names look like "CharacterArmature|Walk", "Armature|Walking" or "HumanArmature|Man_Walk". */
export function pickClip(names, state) {
  const want = state === 'walk' ? [/(^|[|_])walk(ing)?$/i] : [/(^|[|_])idle$/i, /(^|[|_])idle_neutral$/i, /(^|[|_])standing$/i];
  for (const re of want) { const hit = names.find(n => re.test(n)); if (hit) return hit; }
  return null;
}

/** Is the figure drawn (true) or the plain person (false)? */
export const figureActive = ({ shown, hidden, seated, playing }) => !!shown && !hidden && !seated && !playing;

/** Scale that makes a model of height h as tall as a plain person at size k. */
export const fitScale = (h, k) => h > 0 ? k * PERSON_HEIGHT / h : k;

/** Loads one character: { root (a Group at the feet), proxy (the invisible mesh people are picked by), mixer, play(state, speed), height } or null if the file is missing or unreadable. */
export async function loadFigure3d(url) {
  try {
    const gltf = await new GLTFLoader().loadAsync(url), inner = gltf.scene, box = new THREE.Box3().setFromObject(inner), height = box.max.y - box.min.y;
    inner.position.y = -box.min.y; const root = new THREE.Group(); root.add(inner); inner.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.raycast = () => {}; } });   // a skinned mesh's bind-pose bounds are tiny: picking uses the invisible capsule-like proxy below
    const proxy = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, height, 8), new THREE.MeshBasicMaterial({ visible: false })); proxy.position.y = height / 2; root.add(proxy);
    const mixer = new THREE.AnimationMixer(inner), names = gltf.animations.map(a => a.name), acts = {};
    for (const s of ['idle', 'walk']) { const n = pickClip(names, s), clip = n && gltf.animations.find(a => a.name === n); if (clip) acts[s] = mixer.clipAction(clip); }
    let cur = null;
    const play = (state, speed = 1) => { const a = acts[state] || acts.idle; if (!a) return; if (cur !== a) { cur?.fadeOut(0.25); a.reset().fadeIn(0.25).play(); cur = a; } a.timeScale = state === 'walk' ? speed : 1; };
    return { root, proxy, mixer, play, height };
  } catch (e) { return null; }
}
