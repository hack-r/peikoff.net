// The story rules for Ross Ulbricht in the Atlas (see ross.js), kept free of three.js so they can be unit-tested in node.

export const ROSS = { id: 'ross', name: 'Ross Ulbricht', petitionAfter: 3, freeKey: 'atlas.rossFree' };

/** The petition button: 'hidden' once he is free, 'locked' until the visitor has said `after` things to him, then 'ready'. */
export const petitionState = (userMessages, free, after = ROSS.petitionAfter) => free ? 'hidden' : userMessages >= after ? 'ready' : 'locked';

/** Which of the model's clip names plays for a state ('idle' | 'walk'), or null. */
export function pickClip(names, state) {
  const want = state === 'walk' ? [/(^|[|_])walk(ing)?$/i] : [/(^|[|_])idle$/i, /(^|[|_])idle_neutral$/i];
  for (const re of want) { const hit = names.find(n => re.test(n)); if (hit) return hit; }
  return null;
}

/** Where he is `t` seconds after the cell opens: from the spot inside to the spot outside at `speed` m/s. Returns { x, z, walking } (heading is toward the way out). */
export function walkOut(inside, outside, t, speed = 3) {
  const len = Math.hypot(outside[0] - inside[0], outside[1] - inside[1]) || 1, f = Math.min(1, Math.max(0, t * speed / len));
  return { x: inside[0] + (outside[0] - inside[0]) * f, z: inside[1] + (outside[1] - inside[1]) * f, walking: f < 1 };
}

