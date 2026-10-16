// Rasterises the SVG favicons into PNG and ICO sizes. Run with: node tools/make-icons.mjs
// Needs playwright + chromium (the dev container has both); the outputs are committed.
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const SETS = [
  { dir: "public", svg: "public/favicon.svg" },
  { dir: "public/atlas", svg: "public/atlas/favicon.svg" },
];

const browser = await chromium.launch();
const page = await browser.newPage();
const png = async (svg, size, inset = 0) => {
  const pad = Math.round(size * inset);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;background:#0000"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}" style="position:absolute;left:${pad}px;top:${pad}px;width:${size - 2 * pad}px;height:${size - 2 * pad}px">`);
  await page.waitForFunction(() => document.images[0].complete);
  return page.screenshot({ omitBackground: true });
};
// PNG-in-ICO container (supported by every browser since IE9)
const ico = (entries) => {
  const head = Buffer.alloc(6 + 16 * entries.length);
  head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
  let off = head.length;
  entries.forEach(({ size, data }, i) => {
    const o = 6 + 16 * i;
    head[o] = size; head[o + 1] = size; head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(data.length, o + 8); head.writeUInt32LE(off, o + 12); off += data.length;
  });
  return Buffer.concat([head, ...entries.map((e) => e.data)]);
};

for (const { dir, svg: path } of SETS) {
  const svg = readFileSync(path, "utf8");
  writeFileSync(`${dir}/favicon-32.png`, await png(svg, 32));
  writeFileSync(`${dir}/apple-touch-icon.png`, await png(svg.replace(/<rect width="64" height="64" rx="14"/, '<rect width="64" height="64" rx="0"'), 180));
  writeFileSync(`${dir}/icon-192.png`, await png(svg, 192));
  writeFileSync(`${dir}/icon-512.png`, await png(svg, 512));
  writeFileSync(`${dir}/favicon.ico`, ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(svg, size) })))));
}
await browser.close();
