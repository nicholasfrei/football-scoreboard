import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DISPLAY_WIDTH, DISPLAY_HEIGHT, displayScale } from "../public/display-size.js";

test("the landscape layout stays 1920 by 1200 and never enlarges", () => {
  assert.equal(DISPLAY_WIDTH, 1920);
  assert.equal(DISPLAY_HEIGHT, 1200);
  for (const [width, height, expected] of [
    [1920, 1200, 1], [2560, 1600, 1], [3840, 2160, 1],
    [960, 600, .5], [1280, 720, .6], [1200, 1920, .625],
  ]) {
    const scale = displayScale(width, height);
    assert.equal(scale, expected);
    assert.ok(DISPLAY_WIDTH * scale <= width && DISPLAY_HEIGHT * scale <= height);
  }
});

test("the layout is fixed rather than reflowing at browser breakpoints", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.mount\s*\{[^}]*width: 1920px;[^}]*height: 1200px;/);
  assert.doesNotMatch(css, /@media\s*\((?:min|max)-(?:width|height)|\b\d+vw\b/);
});
