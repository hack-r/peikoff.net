// Render cost on phones: where to start the pixel ratio, and a governor that lowers it when frames run slow.
// (The viewer draws no shadows, so the pixel ratio is the one big lever; the Compatibility-mode self-test in main.js already covers GPUs that cannot instance.)

export const PR_FLOOR = 0.75;
export const SLOW_MS = 30;          // an average frame slower than this (under about 33 fps) steps the pixel ratio down
export const WINDOW = 90;           // frames measured per decision
export const WARMUP = 90;           // frames ignored at the start (models and textures are still arriving)

/** Where to start. Desktop keeps up to 2; a phone or tablet caps at 1.75; a small-memory or few-core device, or Save-Data, caps at 1.5. */
export function initialPixelRatio({ dpr = 1, coarse = false, saveData = false, memory = 8, cores = 8 } = {}) {
  let cap = coarse ? 1.75 : 2;
  if (saveData || memory <= 4 || cores <= 4) cap = Math.min(cap, 1.5);
  return Math.max(PR_FLOOR, Math.min(dpr || 1, cap));
}

/** Multisampling on a 2x+ touch screen costs more than it shows; keep it for desktop and low-density screens. */
export const useAntialias = ({ dpr = 1, coarse = false } = {}) => !(coarse && dpr >= 2);

/** The next pixel ratio for an average frame time: down by a fifth when slow, never below the floor, unchanged otherwise. */
export function nextPixelRatio(current, avgMs, floor = PR_FLOOR) {
  if (!(avgMs > SLOW_MS) || current <= floor) return current;
  return Math.max(floor, Math.round(current * 0.8 * 100) / 100);
}

/** Feed it every frame's duration (ms); it calls onChange(newRatio) when the ratio should drop. Pauses (hidden tab) are ignored. */
export function createGovernor({ ratio, floor = PR_FLOOR, onChange }) {
  let skip = WARMUP, sum = 0, n = 0;
  return {
    get ratio() { return ratio; },
    frame(ms) {
      if (!(ms > 0) || ms > 250) { skip = Math.max(skip, 10); sum = 0; n = 0; return; }   // a stall or a background tab says nothing about the GPU
      if (skip > 0) { skip--; return; }
      sum += ms; n++;
      if (n < WINDOW) return;
      const next = nextPixelRatio(ratio, sum / n, floor); sum = 0; n = 0;
      if (next !== ratio) { ratio = next; skip = 30; onChange?.(ratio); }                  // let the new size settle before measuring again
    },
  };
}
