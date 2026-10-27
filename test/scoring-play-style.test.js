import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { scoringNeedsHighlight } from "../public/scoring-style.js";

test("dark scoring colors get a white highlight while light colors do not", () => {
  for (const color of ["#002244", "#000000", "#BF5700"]) assert.equal(scoringNeedsHighlight(color), true, color);
  for (const color of ["#FFFFFF", "#FFCC00"]) assert.equal(scoringNeedsHighlight(color), false, color);
  for (const color of [null, "", "bad"]) assert.equal(scoringNeedsHighlight(color), false);
});

test("scoring play text uses the team color with a conditional white highlight", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  const rule = css.match(/#recent-plays \.scoring-play\.has-scoring-team \.play-description\s*\{([^}]*)\}/);
  assert.ok(rule, "scoring plays with an identified team have a text style");
  assert.match(rule[1], /color:\s*var\(--scoring-color\)/);
  assert.doesNotMatch(rule[1], /background|box-shadow/);
  assert.match(css, /\.scoring-needs-highlight \.play-description\s*\{[^}]*background:\s*#fff\b/);
});
