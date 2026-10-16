import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const city = JSON.parse(readFileSync(new URL("../public/atlas/data/whoneedsit.json", import.meta.url), "utf8"));
const center = (b) => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];

test("atlas data is internally consistent", () => {
  assert.ok(city.buildings.length > 100 && city.people.length > 500);
  assert.equal(city.ids.length, city.people.length);
  for (const [i, p] of city.people.entries()) {
    assert.ok(p.slice(0, 5).every(Number.isFinite), `person ${city.ids[i]} has a finite position`);
    if (p[3] === 1) assert.ok(city.buildings[p[5]], `person ${city.ids[i]} stands in a real building`);
  }
  for (const [pid, route] of Object.entries(city.routes)) {
    assert.ok(city.ids.includes(pid));
    assert.ok(route.length >= 2 && route.every((b) => city.buildings[b]), `route of ${pid} uses real buildings`);
  }
});

test("ARI is in the center, the Peikoffs are red and their buildings touch ARI", () => {
  const ari = city.buildings.find((b) => b.org_id === 1);
  const [ax, ay] = center(ari);
  assert.ok(Math.hypot(ax - city.extent / 2, ay - city.extent / 2) < 40, "ARI near the middle");
  for (const pid of ["P1", "P2", "P4", "P108", "P139"]) assert.ok(city.highlight.people.includes(pid), `${pid} is highlighted`);
  const near = city.highlight.buildings.map((b) => center(city.buildings[b])).filter(([x, y]) => Math.hypot(x - ax, y - ay) < 60);
  assert.equal(near.length, city.highlight.buildings.length, "every Peikoff building is within a cell of ARI");
});

test("Ason is in Postsocialist Press; Amy and Barbara stand and talk in the street between Don't Let It Go and The Culture of Reason Center", () => {
  const person = (pid) => city.people[city.ids.indexOf(pid)];
  assert.equal(city.meta.P108.Organization, "Postsocialist Press");
  assert.equal(city.meta.P139.Organization, "Don't Let It Go");
  assert.equal(city.meta.P4.Organization, "The Culture of Reason Center");
  assert.deepEqual(city.meet, [["P139", "P4"]]);
  const [a, b] = [person("P139"), person("P4")];
  assert.equal(a[3], 0, "Amy is outdoors"); assert.equal(b[3], 0, "Barbara is outdoors");
  assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 4.5, "close enough to talk");
  assert.ok(!city.routes.P139 && !city.routes.P4, "they stand, they do not walk");
  const bld = (name) => city.buildings.find((x) => x.name === name), c = (x) => [(x.x0 + x.x1) / 2, (x.y0 + x.y1) / 2];
  const [d, k] = [c(bld("Don't Let It Go")), c(bld("The Culture of Reason Center"))];
  assert.equal(Math.hypot(d[0] - k[0], d[1] - k[1]), 36, "the two buildings are neighbours across one street");
  assert.ok(city.highlight.buildings.includes(bld("The Culture of Reason Center").id), "The Culture of Reason Center is drawn red");
});

test("regalia: Ayn Rand and Leonard Peikoff are crowned; Carl Barney looks like a college professor", () => {
  assert.deepEqual(city.regalia.P1, ["crown", "hair", "face", "dress", "dollarpin", "holder"]);   // crown plus her dark bob, dress, dollar-sign brooch and cigarette holder
  assert.deepEqual(city.regalia.P2, ["crown"]);
  for (const pid of ["P160"]) assert.deepEqual(city.regalia[pid], ["jacket", "glasses", "bowtie", "book"]);
});


test("Critics is not an org any more; Grossman keeps only her Atlas Society link and the Critics author (Jennifer Burns) stays", () => {
  const burns = city.meta.P519;
  assert.equal(burns.Name, "Jennifer Burns");
  assert.match(burns["Major works"], /Goddess of the Market/);
  assert.ok(!city.buildings.some((b) => b.name === "Critics"), "no Critics building");
  assert.ok(!JSON.stringify(city.meta).includes("Critics"), "no Critics link or relationship left on any card");
  const i = city.ids.indexOf("P22");
  assert.ok(i >= 0, "person is still in the city");
  assert.equal(city.meta.P22.Name, "Jennifer A. Grossman");
  assert.equal(city.buildings[city.people[i][5]].name, "The Atlas Society");
});

test("outskirts: Prometheus Foundation and OSI stand outside the grid, and Carl Barney walks between Prometheus, OSI and TOS", () => {
  const b = (id) => city.buildings.find((x) => x.org_id === id);
  for (const id of [8, 3]) assert.ok(b(id).x1 < 0 && b(id).y1 < 0, `org ${id} is outside the city grid`);
  assert.deepEqual(city.routes.P160.map((i) => city.buildings[i].org_id), [8, 3, 108]);
  assert.ok(!city.ids.includes("P755"), "the duplicate Carl B. Barney record is gone");
});

test("websites: every fish has a title and a link, and none belongs to a dropped org", () => {
  assert.ok(city.websites.length > 100);
  for (const w of city.websites) {
    assert.ok(w.title && /^https?:\/\//.test(w.url), `site ${w.id} has a title and an http(s) link`);
    assert.ok(![55, 33, 48, 50, 54, 34, 36, 37, 38, 44, 47, 49, 107].includes(w.org_id), `site ${w.id} is not an excluded org`);
  }
});

test("cards carry no confidence labels or machine bylines; non-Objectivist think tanks are gone; David Salazar is one person", () => {
  for (const m of Object.values(city.meta)) {
    assert.ok(!/\((verified|reported|unverified|single_source|medium|retired)\)/.test(m["Role at org"] || ""), "no confidence label on Role at org");
    for (const r of m.Relationships || []) {
      assert.equal(r.confidence, undefined, "no confidence on relationship rows");
      assert.ok(!/^Byline on \d+ .*article\(s\) in D1/.test(r.evidence || ""), "no machine-written bylines");
    }
  }
  const names = city.buildings.map((b) => b.name);
  for (const n of ["Cato Institute", "Adam Smith Institute", "Foundation for Economic Education", "Goldwater Institute", "PragerU", "Students For Liberty", "CEVRO Institute"]) assert.ok(!names.includes(n), `${n} is dropped`);
  assert.ok(names.includes("Atlas Network"), "Atlas Network stays");
  assert.equal(Object.values(city.meta).filter((m) => /Salazar/.test(m.Name)).length, 1);
  assert.ok(Object.values(city.meta).every((m) => m.Name), "every person has a name");
});

test("the mountain princess is scenery only: no person, id or building carries her name", () => {
  assert.ok(!city.ids.some((id) => /princess/i.test(id)));
  assert.ok(!Object.values(city.meta).some((m) => /princess/i.test(m.Name || "")));
  assert.ok(!city.buildings.some((b) => /princess/i.test(b.name || "")));
});

test("no sourcing or hedging notes leak onto cards (unverified, directory sheet, unconfirmed)", () => {
  const bad = /otherwise unverified|directory sheet|unconfirmed|current status unverified/i;
  for (const [id, m] of Object.entries(city.meta)) {
    for (const [k, v] of Object.entries(m)) if (k !== "Relationships") assert.ok(!bad.test(String(v)), `${id} ${k}`);
    for (const r of m.Relationships || []) assert.ok(!bad.test(r.evidence || ""), `${id} relationship note`);
  }
});

test("the viewer has an idle-motion switch and the rig splits people at their joints", () => {
  const html = readFileSync(new URL("../public/atlas/index.html", import.meta.url), "utf8");
  const js = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");
  assert.match(html, /id="cbLife"/);
  for (const part of ["legA", "upA", "foreA", "headMesh", "stepLife", "stepPairs"]) assert.ok(js.includes(part), part);
});

test("social media groups: 68 cottages from the groups and communities in the database, each with a platform and a name", () => {
  assert.ok(city.groups.length >= 60);
  const platforms = new Set(city.groups.map((g) => g.platform));
  for (const p of ["meetup", "facebook", "reddit", "linkedin"]) assert.ok(platforms.has(p), p);
  for (const g of city.groups) { assert.ok(g.name && g.platform && ["group", "community"].includes(g.kind), `group ${g.id}`); if (g.url) assert.match(g.url, /^https?:\/\//); }
  assert.ok(city.groups.find((g) => g.name === "r/Objectivism").members > 10000);
});

test("defunct websites are skeleton fish: flagged, titled by their owner (never by spam), and linked only to an archive copy", () => {
  const dead = city.websites.filter((w) => w.defunct);
  assert.equal(dead.length, 11);
  for (const w of dead) { assert.ok(w.why, `site ${w.id} says why`); assert.ok(!/^\(spam\)/i.test(w.title), `site ${w.id} title is not spam advertising`); if (w.archive) assert.match(w.archive, /^https:\/\/web\.archive\.org\//); }
  assert.ok(city.websites.some((w) => !w.defunct), "live sites still swim");
});

test("Easter eggs (Kira, the theVault pirate ship, the City Forum lab) are scenery only: no row of the data carries them", () => {
  assert.ok(!city.websites.some((w) => /the-vault\.website/i.test(w.url)), "theVault is a ship, not a fish");
  assert.ok(!city.buildings.some((b) => /city forum/i.test(b.name || "")), "the lab is not a building of the city");
  assert.ok(!city.groups.some((g) => /vault|city forum/i.test(g.name)));
});

test("pictures from the database appear on cards: https only, never a link-preview graphic", () => {
  const imgs = Object.values(city.meta).map((m) => m.Image).filter(Boolean);
  assert.ok(imgs.length > 50, "most picture urls survive");
  for (const u of imgs) { assert.match(u, /^https:\/\//); assert.ok(!/subscribe-card|Ghate_Onkar_and_Salmieri/.test(u), u); }
  const js = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");
  assert.ok(js.includes('class="photo"') && js.includes("this.remove()"), "the card shows the picture and drops it if it does not load");
  assert.ok(js.includes("ROOF_RED") && js.includes("ROOF_PALETTE"), "cottage roofs are many colors, red reserved for Peikoff properties");
});

test("optional cottage model: nothing is requested unless models.json names a file; the loader is vendored", () => {
  const manifest = JSON.parse(readFileSync(new URL("../public/atlas/models/models.json", import.meta.url), "utf8"));
  assert.equal(manifest.cottage, "", "no model by default, so the built-in house is used and no 404 is logged");
  for (const f of ["models.js", "vendor/GLTFLoader.js"]) assert.ok(readFileSync(new URL(`../public/atlas/${f}`, import.meta.url), "utf8").length > 1000, f);
  assert.ok(!readFileSync(new URL("../public/atlas/vendor/GLTFLoader.js", import.meta.url), "utf8").includes("../utils/"), "the loader imports the vendored utils");
});

test("long hair goes to people with a clearly feminine first name, nobody else; ambiguous names and costumed people are left alone", () => {
  assert.ok(city.hair.length > 100 && city.hair.length < 250);
  const first = (id) => city.meta[id].Name.replace(/^(Dr|Prof)\.?\s+/i, "").split(/\s+/)[0];
  for (const id of city.hair) assert.ok(city.meta[id], id);
  const names = city.hair.map(first);
  for (const n of ["Amy", "Barbara", "Samantha", "Jennifer"]) assert.ok(names.includes(n), n);
  for (const n of ["Alex", "Jean", "Robin", "Casey", "Sam", "David", "Leonard", "Ason"]) assert.ok(!names.includes(n), `${n} is not given long hair`);
  assert.ok(!city.hair.includes("P1"), "Ayn Rand keeps her own bob (regalia)");
  for (const n of ["Michele", "Taylor"]) assert.ok(names.includes(n), `${n} was added on request`);
});

test("Ason Peikoff plays his guitar inside Postsocialist Press and does not walk", () => {
  assert.deepEqual(city.stand, [{ id: "P108", prop: "guitar" }]);
  assert.ok(!city.routes.P108, "he plays, he does not walk");
});

test("/salon invites Ayn Rand, the Peikoffs and the top executives of OSI, The Atlas Society and Prometheus", () => {
  const names = city.salon.map((id) => city.meta[id].Name);
  for (const n of ["Ayn Rand", "Leonard Peikoff", "Amy Peikoff", "Ason Peikoff", "Barbara Branden Peikoff", "Alan Greenspan", "David Kelley", "Katarina Vasiljevi\u0107", "Carl B. Barney", "David Hardy"]) assert.ok(names.includes(n), `${n} is invited`);
  assert.equal(new Set(city.salon).size, city.salon.length, "no duplicates");
  assert.ok(city.salon.every((id) => city.ids.includes(id)), "every invited person exists");
  assert.ok(!city.salon.includes("P24"), "a director of programs is not a top executive");
  assert.ok(!names.includes("Kira Peikoff"), "Kira is in the VR world (the princess), not in the database");
  assert.ok(!names.includes("Craig Biddle") && !names.includes("Sarah Biddle"), "the Biddles are left off (SALON_EXCLUDE)");
});

test("Midas lands beside the castle on /home and takes off on /work", () => {
  const js = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");
  assert.ok(js.includes("scenery.userData.midasLand"), "midasLand is exposed");
  assert.ok(/kind === 'home' && cs\)/.test(js) && js.includes("u.midasLand(false)"), "home lands him, anything else sends him up");
});

test("Barbara's card is named Barbara Branden Peikoff and the old name stays searchable", () => {
  assert.equal(city.meta.P4.Name, "Barbara Branden Peikoff");
  assert.match(city.meta.P4.Nicknames, /Barbara Branden/);
});

test("Barbara has her own champagne bouffant instead of the generic long hair; Amy's hair is brown and gray", () => {
  const js = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");
  assert.deepEqual(city.regalia.P4, ["bouffant"]);
  assert.ok(!city.hair.includes("P4") || js.includes("includes('bouffant')"), "bouffant people skip the generic hair");
  assert.ok(/HAIR_OVERRIDE = \{ P139: '#8b7e70' \}/.test(js), "Amy's hair is a brown-gray blend");
  const bouffant = js.slice(js.indexOf("  bouffant: mergeGeometries("), js.indexOf("  face: mergeGeometries("));
  assert.ok(bouffant.includes("'#e8d3a6'") && !bouffant.includes("'#ddd6c9'"), "Barbara's hair is champagne, no longer ash");
});

test("Ason Peikoff plays his guitar inside Postsocialist Press, not on the street", () => {
  const i = city.ids.indexOf("P108"), p = city.people[i], b = city.buildings[p[5]];
  assert.equal(p[3], 1, "inside a building");
  assert.equal(b.name, "Postsocialist Press");
  assert.equal(p[2], 0, "ground floor");
  assert.ok(p[0] > b.x0 && p[0] < b.x1 && p[1] > b.y0 && p[1] < b.y1, "within its walls");
  assert.deepEqual(city.stand, [{ id: "P108", prop: "guitar" }]);
});

test("nobody starts on top of anybody else (the viewer separates people closer than SEP)", () => {
  const js = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");
  assert.ok(js.includes("function separateAll()") && js.includes("separateAll();"), "separation pass runs at load");
  assert.ok(js.includes("nudgeFrom(w.i)"), "walkers step clear on arrival");
});

test("search box: clearer placeholder and slash-command completion", () => {
  const html = readFileSync(new URL("../public/atlas/index.html", import.meta.url), "utf8");
  const js = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");
  assert.ok(html.includes('placeholder="Type a search or / command"'));
  for (const c of ["/speak", "/salon", "/home", "/work"]) assert.ok(js.includes(`['${c}',`), `${c} is offered`);
  assert.ok(js.includes("e.key === 'Tab' && cmdHits.length"), "Tab completes the highlighted command");
});

test("Kira smiles (her own mouth is reshaped, nothing is drawn over it) and her pen is aimed at the page of her book", () => {
  const js = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");
  assert.ok(js.includes("smileMouth(geo.attributes.position.array, geo.attributes.color.array)"), "the model's mouth vertices are reshaped");
  assert.ok(!js.includes("SMILE_Z") && !js.includes("TorusGeometry(0.026"), "no red arc over her face");
  assert.ok(js.includes("PEN_TARGET") && js.includes("armR.quaternion.setFromUnitVectors(PEN_U"), "the pen tip is aimed at the page each frame");
});

test("Peikoff Manor labels, a camera stop button and a reset-view button", () => {
  const js = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../public/atlas/index.html", import.meta.url), "utf8");
  assert.ok(js.includes("'Peikoff Manor', 6)") && js.includes("'Peikoff Manor Cottage', 4)"), "castle and suite labels");
  assert.ok(html.includes('id="camStop"') && html.includes('id="camReset"'), "camera buttons exist");
  assert.ok(js.includes("function stopCamera()") && js.includes("function resetView()"), "and are wired");
});

test("/salon: Kira, the princess, walks to the lawn and stands outside the ring of chairs", () => {
  const js = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");
  assert.ok(js.includes("function salonSpot(v)") && js.includes("venueXY(v, 0, 16)"), "a spot outside the ring (radius 11)");
  assert.ok(js.includes("kind === 'salon') scenery.userData.kiraGo?.(true, salonSpot(places.salon))"), "the command sends her");
});

test("Ayn Rand wears a colored dress: not black, and never Peikoff red", () => {
  const src = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");
  const block = src.slice(src.indexOf("  dress: mergeGeometries("), src.indexOf("  dollarpin:"));
  const hexes = [...block.matchAll(/'#([0-9a-f]{6})'/gi)].map((m) => m[1]);
  assert.ok(hexes.length >= 6, "the dress has a bodice, skirt, sleeves, belt, collar and stockings");
  for (const h of hexes) {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    assert.ok(Math.max(r, g, b) > 70, `#${h} is not black`);
    assert.ok(!(r > g * 1.4 && r > b * 1.4), `#${h} is not red`);
  }
});
