import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("yard hashes sit inside the numbers at one-yard intervals", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const pattern = html.match(/<pattern id="hash-marks" x="([\d.]+)" width="([\d.]+)" height="\d+" patternUnits="userSpaceOnUse">\s*<path d="M0 ([\d.]+)v([\d.]+) M0 ([\d.]+)v([\d.]+)"/);
  const hashes = html.match(/<rect x="([\d.]+)" y="12" width="([\d.]+)" height="416" fill="url\(#hash-marks\)"\s*\/>/);
  assert.ok(pattern, "the hash pattern has two short rows of marks");
  assert.ok(hashes, "hash marks are drawn on the field");
  assert.equal(Number(pattern[1]), 111.92, "hashes start one yard past the goal line");
  assert.equal(Number(pattern[2]), 7.92, "hashes repeat every yard");
  assert.deepEqual([Number(pattern[3]), Number(pattern[3]) + Number(pattern[4])], [171, 177]);
  assert.deepEqual([Number(pattern[5]), Number(pattern[5]) + Number(pattern[6])], [263, 269]);
  assert.equal(Number(hashes[1]), 111.92);
  assert.equal(Number(hashes[1]) + Number(hashes[2]), 896, "hashes stop at the opposite goal line");
  assert.doesNotMatch(html, /M104 48h792 M104 392h792/, "the old continuous lines are removed");
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

test("the first-down line turns red on fourth down and resets on other downs", async () => {
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(app, /lineToGain\.classList\.toggle\("is-fourth-down", isFourthDown\)/);
  assert.match(app, /down\.classList\.toggle\("is-fourth-down", isFourthDown\)/);
  assert.match(css, /#first-down-marker\.is-fourth-down line\s*\{\s*stroke:\s*#f56367/);
});

test("YAC renders above the yard-to-gain and scrimmage lines, without raising other routes", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  const order = ["drive-illustration", "first-down-marker", "ball-marker", "drive-yac-overlay", "football-marker"];
  const positions = order.map((id) => html.indexOf(`id="${id}"`));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b), "YAC overlays both lines but not the football");
  assert.match(app, /yacOverlay\.append\(yac\)/);
  assert.match(app, /yacOverlay\.append\(label\)/);
  assert.match(app, /yacOverlay\.replaceChildren\(\)/, "old YAC is removed when the drive changes");
  assert.match(css, /\.field-wrap\.is-feed-delayed #drive-yac-overlay \{ visibility: hidden; \}/);
});

test("drive paths and marks share a light color with a thin dark border", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(css, /--drive-line-color: #f5f4eb;/);
  const outlined = css.match(/([^{}]+)\{ filter: url\(#drive-outline\); \}/)?.[1];
  for (const selector of ["#football-direction", ".drive-progress", ".drive-route", ".drive-yac-route", ".drive-return-route", ".drive-catch", ".drive-pick", ".drive-end", ".drive-final"]) {
    assert.ok(outlined?.includes(selector), `${selector} has a thin outline`);
  }
  assert.match(html, /<filter id="drive-outline" filterUnits="userSpaceOnUse"/);
  assert.match(html, /<feMorphology in="SourceAlpha" operator="dilate" radius="1"/);
  assert.match(html, /<feFlood flood-color="#16212a"/);
  for (const className of ["drive-progress", "drive-route", "drive-yac-route", "drive-return-route", "drive-final"]) {
    assert.match(css, new RegExp(`\\.${className} \\{[^}]*stroke: var\\(--drive-line-color\\)`), className);
  }
  for (const className of ["drive-end", "drive-catch", "drive-pick"]) {
    assert.match(css, new RegExp(`\\.${className} \\{[^}]*fill: var\\(--drive-line-color\\)`), className);
  }
  for (const className of ["drive-yac-label", "drive-return-label"]) {
    assert.match(css, new RegExp(`\\.${className} \\{ fill: #fff;`), `${className} stays legible over the dark route`);
  }
  assert.match(css, /\.drive-penalty \{ stroke: #efc744/);
});

test("incompletions and missed field goals end in a red X rather than a dot", async () => {
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(app, /if \(current\.kind === "incomplete" \|\| current\.kind === "field-goal" && current\.landingLabel === "MISSED"\) \{\s*const cross = svgElement\("g", \{ class: "drive-miss" \}\)/);
  assert.match(css, /\.drive-miss \{ fill: none; stroke: #ff666b;/);
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
