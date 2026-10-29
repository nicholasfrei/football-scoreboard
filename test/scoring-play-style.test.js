import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("every scoring play has a persistent translucent white row highlight", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const rule = css.match(/#recent-plays li\.scoring-play\s*\{([^}]*)\}/);
  assert.ok(rule, "all scoring plays use the same row style");
  assert.match(rule[1], /background:\s*rgba\(255,\s*255,\s*255,\s*\.08\)/);
  assert.match(rule[1], /color:\s*#f4f1e8/);
  assert.doesNotMatch(css, /\.scoring-needs-highlight \.play-description|--scoring-color/);
  assert.match(app, /item\.classList\.toggle\("scoring-play", play\.scoring\)/);
  assert.doesNotMatch(app, /scoringNeedsHighlight|scoring-needs-highlight/);
});
