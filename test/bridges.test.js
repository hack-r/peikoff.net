import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BRIDGE, deckHeight, makeWetGrid, wetOnSegment, wetStretches, streamFrame, makeBridge, deckHeightAt, onDeck, nearestDry, findPath, withHeights } from "../public/atlas/bridges.js";

// A straight stream along z = 0 (x from -200 to 200), 10 m wide.
const samples = Array.from({ length: 401 }, (_, i) => [-200 + i, 0, 5]);
const grid = makeWetGrid({ minX: -300, minZ: -300, maxX: 300, maxZ: 300, cell: 2, streams: [samples] });
const frame = streamFrame(samples, 20, 3);
const bridge = makeBridge(frame, grid);
const wet = (x, z) => grid.get(x, z);

test("the deck rises to its crest in the middle and meets the ground at both ends", () => {
  assert.ok(deckHeight(0) < 1e-9 && deckHeight(1) < 1e-9);
  assert.ok(Math.abs(deckHeight(0.5) - BRIDGE.rise) < 1e-9);
  assert.equal(deckHeight(-1), 0);
});

test("the wet grid has water in the stream only", () => {
  assert.ok(wet(0, 0) && wet(50, 3) && wet(-120, -4));
  assert.ok(!wet(0, 12) && !wet(0, -12) && !wet(250, 0), "dry beside the stream and past its end");
  assert.ok(wetOnSegment(grid, [0, -20], [0, 20]));
  assert.ok(!wetOnSegment(grid, [0, 10], [100, 10]));
  const [st] = wetStretches(grid, [0, -20], [0, 20]);
  assert.ok(Math.abs((st.t0 + st.t1) / 2 - 0.5) < 0.05 && st.t1 - st.t0 > 0.2 && st.t1 - st.t0 < 0.3, JSON.stringify(st));
});

test("a bridge lies across the stream and lands on dry ground at both ends", () => {
  assert.ok(Math.abs(bridge.C[0] - 20) < 1.5);
  assert.ok(Math.abs(bridge.dir[0]) < 0.05 && Math.abs(Math.abs(bridge.dir[1]) - 1) < 0.05, "at right angles to the stream");
  assert.ok(!wet(...bridge.P) && !wet(...bridge.Q));
  assert.ok(bridge.L >= 2 * (5 + BRIDGE.landing) - 0.01);
  assert.ok(deckHeightAt([bridge], bridge.C[0], bridge.C[1]) > BRIDGE.rise - 0.05, "crest over the middle");
  assert.equal(deckHeightAt([bridge], 100, 0), 0);
  assert.ok(onDeck([bridge], bridge.C[0], bridge.C[1]) && !onDeck([bridge], bridge.C[0] + BRIDGE.width, bridge.C[1]));
});

test("nearestDry moves a point from the water to the bank and leaves dry or decked points alone", () => {
  assert.deepEqual(nearestDry(grid, [], 0, 12), [0, 12]);
  const d = nearestDry(grid, [], 1, 1, 40);
  assert.ok(d && !wet(...d) && Math.hypot(d[0] - 1, d[1] - 1) < 9);
  assert.deepEqual(nearestDry(grid, [bridge], bridge.C[0], bridge.C[1]), bridge.C, "the deck counts as ground");
});

test("findPath crosses the stream only over the bridge, and goes straight when nothing is in the way", () => {
  const a = [20 + 0.4, -40], b = [20 + 0.4, 40];
  assert.equal(findPath(grid, [], a, b), null, "no bridge and no way round inside the search box: null");
  const way = findPath(grid, [bridge], a, b);
  assert.ok(way && way[0] === a && way.at(-1) === b);
  for (let k = 0; k + 1 < way.length; k++) {
    const len = Math.hypot(way[k + 1][0] - way[k][0], way[k + 1][1] - way[k][1]);
    for (let d = 0; d <= len; d += 1) { const x = way[k][0] + (way[k + 1][0] - way[k][0]) * d / len, z = way[k][1] + (way[k + 1][1] - way[k][1]) * d / len; assert.ok(!wet(x, z) || onDeck([bridge], x, z), `wades at ${x.toFixed(1)}, ${z.toFixed(1)}`); }
  }
  const far = findPath(grid, [bridge], [-30, -40], [-30, 40]);                   // 50 m from the bridge: walks to it and back
  assert.ok(far && far.some(p => Math.abs(p[0] - bridge.C[0]) < 8), JSON.stringify(far));
  assert.deepEqual(findPath(grid, [bridge], [0, 20], [60, 20]), [[0, 20], [60, 20]]);
  assert.equal(findPath(grid, [], [0, -40], [0, 40], { maxCells: 10 }), null, "too large to search: null");
});

test("withHeights puts people on the arch: ground outside, the deck height on the bridge, extra points along it", () => {
  const way = withHeights([[bridge.P[0], bridge.P[1]], [bridge.Q[0], bridge.Q[1]]], [bridge]);
  assert.ok(way.length > 4, "points along the span");
  assert.equal(way[0][2], 0);
  assert.ok(Math.max(...way.map(p => p[2])) > BRIDGE.rise - 0.3);
  assert.ok(Math.abs(way.at(-1)[2]) < 0.05);
  assert.deepEqual(withHeights([[0, 10], [50, 10]], [bridge]).map(p => p[2]), [0, 0]);
});

test("the viewer routes every walk round the water (source checks)", () => {
  const main = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");
  assert.match(main, /from '\.\/bridges\.js'/);
  assert.match(main, /return withBridges\(legs\)/, "event routes");
  assert.match(main, /withBridges\(planLegs\(/, "ordinary walks");
  assert.match(main, /findPath\(water\(\), bridges, cur, goal\)/, "Kira");
  assert.match(main, /deckHeightAt\(bridges, x, z\)/, "Kira climbs the arch");
});
