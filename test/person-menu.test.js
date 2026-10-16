import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { menuItems, menuPosition, LONG_PRESS_MS, LONG_PRESS_PX } from "../public/atlas/chat.js";

test("the menu's first item depends on who is asking: chat, an invitation to sign up, or an upgrade nudge", () => {
  const admin = menuItems({ id: "admin", admin: true, paid: true }, "Leonard Peikoff");
  assert.deepEqual(admin.map((i) => i.id), ["chat", "details"]);
  assert.equal(admin[0].label, "Chat with Leonard Peikoff");
  const visitor = menuItems(null, "Leonard Peikoff");
  assert.deepEqual(visitor.map((i) => i.id), ["signup", "details"]);
  assert.equal(visitor[0].label, "Sign up to chat with Leonard Peikoff");
  assert.match(visitor[0].note, /Registration is opening soon/);
  const free = menuItems({ id: "u1" }, "Leonard Peikoff");
  assert.deepEqual(free.map((i) => i.id), ["upgrade", "details"]);
  assert.match(free[0].note, /paid plan/);
  for (const items of [admin, visitor, free]) assert.ok(items[0].primary && !items[1].primary, "the first item is the highlighted one; details is always there");
});

test("the menu opens beside the finger and never leaves the screen", () => {
  const w = 300, h = 190, vw = 390, vh = 664;
  assert.deepEqual(menuPosition(100, 100, w, h, 800, vh), { left: 110, top: 110 }, "below-right of the point when it fits");
  assert.deepEqual(menuPosition(100, 100, w, h, vw, vh), { left: 8, top: 110 }, "on a phone it does not fit to the right of x = 100, so it shifts left and stays on screen");
  const right = menuPosition(350, 100, w, h, vw, vh);
  assert.ok(right.left + w <= vw - 8 && right.left >= 8, "flips left near the right edge");
  const low = menuPosition(100, 600, w, h, vw, vh);
  assert.ok(low.top + h <= vh - 8 && low.top < 600, "flips above near the bottom");
  for (const [x, y] of [[0, 0], [vw, vh], [-50, 900], [389, 2]]) { const p = menuPosition(x, y, w, h, vw, vh); assert.ok(p.left >= 8 && p.top >= 8 && p.left + w <= vw - 8 && p.top + h <= vh - 8, `on screen for (${x}, ${y})`); }
  const tiny = menuPosition(10, 10, 500, 900, 320, 480);
  assert.deepEqual(tiny, { left: 8, top: 8 }, "bigger than the screen: pinned to the corner");
});

test("a long press is a deliberate half-second hold that a wobble cancels", () => {
  assert.ok(LONG_PRESS_MS >= 350 && LONG_PRESS_MS <= 600);
  assert.ok(LONG_PRESS_PX >= 8 && LONG_PRESS_PX <= 16, "a finger wobbles more than a mouse");
});

test("the viewer opens the menu on long press, double tap, a second tap on the card, and right-click", () => {
  const js = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");
  assert.ok(js.includes("import { createChat, isDoubleTap, LONG_PRESS_MS, LONG_PRESS_PX } from './chat.js';"));
  assert.ok(js.includes(": select(i),"), "Show details opens the person's card");
  assert.ok(js.includes("setTimeout(() => { pressed = true; down = null; lastTap = null; chat.menu(pi, x, y); }, LONG_PRESS_MS)"), "press and hold");
  assert.ok(js.includes("el.addEventListener('contextmenu'") && js.includes("chat.menu(pi, e.clientX, e.clientY)"), "right-click");
  assert.ok(js.includes("if (isDoubleTap(lastTap, t)) { lastTap = null; chat.menu(t.pi, t.x, t.y); return; }"), "double click / tap on the canvas");
  assert.ok(js.includes("$('card').addEventListener('pointerup'"), "the second tap of a double tap lands on the card the first tap opened");
  assert.ok(!js.includes("chat.open(t.pi)"), "a double tap no longer jumps straight into chat");
  assert.ok(js.includes("(e.pointerType === 'mouse' ? 5 : 12)"), "a finger may wobble 12 px and still be a tap");
  assert.ok(js.includes("nearestPerson(e.clientX, e.clientY, 28)") && js.includes("e.pointerType === 'mouse' ? pi"), "touch and pen get a fingertip's worth of slack, a mouse does not");
});
