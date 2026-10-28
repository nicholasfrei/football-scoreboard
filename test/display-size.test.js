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

test("one native field aspect ratio determines the panel height in normal and demo views", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /class="football-field" viewBox="0 0 1000 440"/);
  assert.match(css, /\.field-canvas\s*\{[^}]*flex: none;[^}]*width: 100%;[^}]*aspect-ratio: 1000 \/ 440;/);
  assert.match(css, /\.gamecast-layout\s*\{[^}]*flex: none;/);
  assert.match(css, /\.play-panel\s*\{[^}]*contain: size;/);
  assert.doesNotMatch(css, /\.display:has\(\.demo-controls/,
    "demo-specific score or field dimensions must not compete with the common layout");
  assert.doesNotMatch(html, /preserveAspectRatio="none"/, "logos and field markings must not stretch");
});

test("replay tools use a compact shared row and reserve footer space without a refresh button", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.demo-controls\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(css, /\.feed-status\s*\{[^}]*min-height: 29px;/);
  assert.match(css, /\.score-panel\s*\{[^}]*flex: 1 0 auto;/,
    "the score panel absorbs spare vertical space, not the football field");
});
