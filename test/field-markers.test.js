import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("horizontal white lines stop at the end-zone boundaries", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const endzones = [...html.matchAll(/<rect class="endzone (?:away|home)-endzone" x="(\d+)"[^>]*width="(\d+)"/g)];
  assert.equal(endzones.length, 2);
  const start = Number(endzones[0][1]) + Number(endzones[0][2]);
  const end = Number(endzones[1][1]);
  const sidelines = html.match(/<path d="([^"]+)" stroke-opacity="\.28"/);
  assert.ok(sidelines, "horizontal field lines exist");
  const segments = [...sidelines[1].matchAll(/M(\d+) (\d+)h(\d+)/g)];
  assert.equal(segments.length, 2);
  for (const segment of segments) {
    assert.equal(Number(segment[1]), start, "line starts after the left end zone");
    assert.equal(Number(segment[1]) + Number(segment[3]), end, "line ends before the right end zone");
  }
});

test("away end zone is left, home end zone is right, and midfield has the home logo", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(html, /class="endzone away-endzone" x="12"/);
  assert.match(html, /class="endzone home-endzone" x="896"/);
  assert.match(css, /\.away-endzone \{ fill: var\(--away-color/);
  assert.match(css, /\.home-endzone \{ fill: var\(--home-color/);
  assert.match(app, /\["#endzone-school", away\.mascot\]/);
  assert.match(app, /\["#endzone-mascot", home\.mascot\]/);
  assert.match(app, /if \(home\.logo\) logo\.setAttribute\("href", home\.logo\)/);
});

test("possession and first-down lines reach both edges of the turf", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const turf = html.match(/<rect[^>]*y="(\d+)"[^>]*height="(\d+)"[^>]*fill="url\(#turf\)"/);
  assert.ok(turf, "field turf exists");
  const top = Number(turf[1]);
  const bottom = top + Number(turf[2]);

  for (const id of ["ball-marker", "first-down-marker"]) {
    const line = html.match(new RegExp(`<g id="${id}"[^>]*>\\s*<line[^>]*y1="(\\d+)"[^>]*y2="(\\d+)"`));
    assert.ok(line, `${id} has a vertical line`);
    assert.equal(Number(line[1]), top, `${id} reaches the top edge`);
    assert.equal(Number(line[2]), bottom, `${id} reaches the bottom edge`);
  }
});

test("grass stripes start at the goal line and alternate at every numbered yard line", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const pattern = html.match(/<pattern id="mow-stripes" x="([\d.]+)" width="([\d.]+)"[^>]*>\s*<rect width="([\d.]+)"/);
  const overlay = html.match(/<rect x="([\d.]+)"[^>]*width="([\d.]+)"[^>]*fill="url\(#mow-stripes\)"/);
  assert.ok(pattern);
  assert.ok(overlay);
  const origin = Number(pattern[1]);
  const stripe = Number(pattern[3]);
  assert.equal(origin, 104);
  assert.equal(Number(pattern[2]), stripe * 2, "one light and one dark ten-yard band per pattern");
  assert.equal(Number(overlay[1]), origin, "stripes start after the left end zone");
  assert.equal(Number(overlay[2]), stripe * 10, "ten bands end at the opposite goal line");
  const numbers = [...html.matchAll(/<text x="([\d.]+)" y="90">(\d+)<\/text>/g)];
  assert.equal(numbers.length, 9);
  numbers.forEach((label, index) => {
    assert.ok(Math.abs(Number(label[1]) - (origin + (index + 1) * stripe)) < 0.0001, `${label[2]} is on a stripe boundary`);
  });
});
