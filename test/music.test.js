import assert from "node:assert/strict";
import test from "node:test";
import { BPM, KEYS, composeWaltz } from "../public/atlas/music.js";

test("the waltz is deterministic, three beats to the bar, and ends on the tonic", () => {
  const a = composeWaltz(1000, 60), b = composeWaltz(1000, 60), c = composeWaltz(1001, 60);
  assert.deepEqual(a, b, "same seed, same tune");
  assert.notDeepEqual(a.events, c.events, "another seed, another tune");
  assert.equal(a.beats, 48);
  for (const e of a.events) { assert.ok(e.beat >= 0 && e.beat < a.beats, "inside the cycle"); assert.ok(e.dur > 0 && e.midi >= 28 && e.midi <= 100, `note ${e.midi} is playable`); assert.ok(["mel", "chord", "bass"].includes(e.voice)); }
  const mel = a.events.filter((e) => e.voice === "mel"), last = mel[mel.length - 1];
  assert.equal(last.midi % 12, 60 % 12, "the melody ends on the tonic");
  assert.equal(a.events.filter((e) => e.voice === "bass").length, 16, "one oom per bar");
  assert.ok(BPM > 100 && KEYS.length >= 2);
});
