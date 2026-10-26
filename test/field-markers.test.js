import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("horizontal white lines stop at the end-zone boundaries", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const endzones = [...html.matchAll(/<rect class="endzone" x="(\d+)"[^>]*width="(\d+)"/g)];
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
