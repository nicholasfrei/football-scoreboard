import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

function fieldView() {
  const nodes = new Map();
  const node = (selector) => {
    if (!nodes.has(selector)) {
      const attributes = new Map();
      nodes.set(selector, {
        style: { transform: "" }, textContent: "",
        classList: { toggle() {} },
        setAttribute(key, value) { attributes.set(key, value); },
        getAttribute(key) { return attributes.get(key); },
        removeAttribute(key) { attributes.delete(key); },
        replaceChildren(...children) { this.children = children; },
      });
    }
    return nodes.get(selector);
  };
  const start = source.indexOf("function updateBallMarkers(game) {");
  const end = source.indexOf("\nfunction renderDrives(game)", start);
  const functions = source.slice(start, end);
  const { updateBallMarkers, updateFootballMarker } = runInNewContext(
    `${functions}; ({ updateBallMarkers, updateFootballMarker })`,
    { document: { querySelector: node, createElement: () => ({ classList: { toggle() {} }, textContent: "" }) },
      ballPositionFallback: () => "Awaiting ball position" },
  );
  return { node, updateBallMarkers, updateFootballMarker };
}

const game = {
  state: "live", homeAway: "home", possessionTeamId: "home",
  selectedTeam: { id: "home", abbreviation: "DAL", logo: "home.png", logos: ["home-alt.png"] },
  opponent: { id: "away", abbreviation: "PHI", logo: "away.png" },
  ball: { percent: 50, direction: "left", possession: "DAL", downDistance: "1st & 10" },
};

test("possession pin sits above the ball line and moves with its marker", () => {
  assert.match(html, /<g id="ball-marker"[^>]*>\s*<line[^>]*>\s*<g id="possession-pin"/);
  const offset = Number(html.match(/id="possession-pin" transform="translate\(0 (\d+)\)"/)?.[1]);
  const tip = Number(html.match(/id="possession-pin"[^>]*>\s*<path d="M0 (\d+)/)?.[1]);
  assert.match(html, /id="football-marker"[^>]*>\s*<g transform="translate\(0 220\)">\s*<path id="football-direction" d="M-9 -4 H-2 V-9 L9 0 L-2 9 V4 H-9 Z"/);
  const arrowTop = 220 - 9 - 1;
  assert.ok(arrowTop - (offset + tip) >= 0 && arrowTop - (offset + tip) <= 8,
    "the pin tip sits immediately above the arrow");
  const view = fieldView();
  view.updateBallMarkers(game);
  view.updateFootballMarker(game);
  assert.equal(view.node("#possession-pin").getAttribute("visibility"), "visible");
  assert.equal(view.node("#possession-pin-logo").getAttribute("href"), "home.png");
  assert.equal(view.node("#ball-marker").style.transform, "translateX(500px)");
  assert.equal(view.node("#football-direction").getAttribute("transform"), "scale(-1 1)");
  view.updateFootballMarker({ ...game, ball: { ...game.ball, direction: "right" } });
  assert.equal(view.node("#football-direction").getAttribute("transform"), "scale(1 1)");
  view.updateFootballMarker(game, { hidden: true });
  assert.equal(view.node("#ball-marker").getAttribute("visibility"), "hidden");
});

test("pin follows the possessing team and falls back to its abbreviation", () => {
  const view = fieldView();
  view.updateBallMarkers(game);
  const logo = view.node("#possession-pin-logo");
  logo.onerror();
  assert.equal(logo.getAttribute("href"), "home-alt.png");
  logo.onerror();
  assert.equal(logo.getAttribute("href"), undefined);
  assert.equal(view.node("#possession-pin-fallback").textContent, "DAL");
  view.updateBallMarkers({ ...game, possessionTeamId: "away" });
  assert.equal(logo.getAttribute("href"), "away.png");
  assert.equal(view.node("#possession-pin-fallback").textContent, "");
});

test("pin hides when possession or a live ball is unavailable", () => {
  const view = fieldView();
  for (const change of [{ possessionTeamId: null }, { ball: null }, { state: "final" }]) {
    view.updateBallMarkers({ ...game, ...change });
    assert.equal(view.node("#possession-pin").getAttribute("visibility"), "hidden");
    assert.equal(view.node("#possession-pin-logo").getAttribute("href"), undefined);
  }
});

test("the arrow uses the light route color and replaces a dot at the live ball spot", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(css, /--display-background: #22272e;/);
  assert.match(css, /\.display \{[\s\S]*?background: var\(--display-background\);/);
  assert.match(css, /\.field-wrap \{ --drive-line-color: #f5f4eb; \}/);
  assert.match(css, /#football-direction \{ fill: var\(--drive-line-color\); \}/);
  assert.doesNotMatch(source, /class: "drive-start"/, "the drive starting dot is not drawn");
  assert.match(source, /if \(!overlapsCurrentBall\(game, drive, current\.finish, current\.y\)\)/);
  const start = source.indexOf("function overlapsCurrentBall(");
  const end = source.indexOf("\nfunction renderFieldDrive(", start);
  const overlaps = runInNewContext(`${source.slice(start, end)}; overlapsCurrentBall`);
  const drive = { id: "current" };
  const active = { ball: { percent: 50 }, drives: [drive] };
  assert.ok(overlaps(active, drive, 500, 220));
  assert.ok(!overlaps(active, drive, 520, 220));
  assert.ok(!overlaps(active, drive, 500, 180));
  assert.ok(!overlaps(active, { id: "old" }, 500, 220));
  assert.ok(!overlaps({ ...active, ball: null }, drive, 500, 220));
});
