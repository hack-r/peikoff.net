import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const js = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");

test("on /home Ason stays outside in front of Peikoff Manor with his guitar instead of going in", () => {
  assert.ok(js.includes("function frontSpots(cs)"), "a spot in front of the door for each of them");
  assert.ok(js.includes("if (q.i === guitarI && key === 'castle')") && js.includes("front: true, target: { type: 'stand'"), "Ason's destination is a standing spot, not the door");
  assert.ok(js.includes("dest.front ? (dest.via || []) : [place.doorIn, ...(dest.via || [])]"), "a front destination stops outside");
});

test("Kira walks to the spot beside him and stays, at everyone else's height, so KP can always find her", () => {
  assert.ok(js.includes("kira.pts = kira.want === 'home' ? [cur, kira.front.kira.xy] : [cur, LEDGE];"), "straight to her spot, and back to the ledge on /work");
  assert.ok(js.includes("else if (kira.where === 'home') { const K_ = kira.front.kira; place(K_.xy[0], K_.xy[1], personK());"), "she stands there, turned toward Ason");
  assert.ok(js.includes("scenery.userData.princessHeight = geo.userData.height * 1.5"), "her model height is known");
  assert.ok(js.includes("* 1.72 / (scenery.userData.princessHeight || 1.85)"), "scaled so she is as tall as a person");
  assert.ok(!js.includes("princess.visible = nm.visible = false"), "she is never hidden");
});

test("the secret KP shortcut frames her the same way at ledge size and at person size", () => {
  const fn = js.slice(js.indexOf("function secretKira()"), js.indexOf("\n}\n", js.indexOf("function secretKira()")));
  assert.ok(fn.includes("const f = Math.max(0.3, pr.scale.x / 26);"), "distances scale with her size");
  assert.ok(fn.includes("* 62 * f") && fn.includes("40 * f") && fn.includes("16 * f"));
  assert.ok(!fn.includes("is at home in Peikoff Manor"), "no more 'she is inside' dead end");
});
