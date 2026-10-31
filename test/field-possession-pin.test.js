import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { enrichGame } from "../src/gamecast.js";
import { createBallPlacement } from "../public/field-animation.js";

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
  assert.match(html, /id="football-marker"[^>]*>\s*<ellipse cx="0" cy="220" rx="20" ry="12"/);
  const footballTop = 220 - 12 - 1.5;
  assert.ok(footballTop - (offset + tip) >= 0 && footballTop - (offset + tip) <= 8,
    "the unchanged pin tip sits immediately above the original football");
  const view = fieldView();
  view.updateBallMarkers(game);
  view.updateFootballMarker(game);
  assert.equal(view.node("#possession-pin").getAttribute("visibility"), "visible");
  assert.equal(view.node("#possession-pin-logo").getAttribute("href"), "home.png");
  assert.equal(view.node("#ball-marker").style.transform, "translateX(500px)");
  assert.equal(view.node("#football-marker").style.transform, "translateX(500px)");
  view.updateFootballMarker({ ...game, ball: { ...game.ball, direction: "right" } });
  assert.equal(view.node("#football-marker").style.transform, "translateX(500px)");
  view.updateFootballMarker(game, { hidden: true });
  assert.equal(view.node("#ball-marker").getAttribute("visibility"), "hidden");
});

test("the entire team logo fits inside the pin without a circular crop", () => {
  const image = html.match(/<image id="possession-pin-logo"([^>]+)\/>/)?.[1];
  assert.ok(image);
  const attribute = (name) => Number(image.match(new RegExp(`\\b${name}="(-?\\d+)"`))?.[1]);
  const { x, y, width, height } = Object.fromEntries(["x", "y", "width", "height"].map((name) => [name, attribute(name)]));
  assert.equal(image.includes('preserveAspectRatio="xMidYMid meet"'), true);
  assert.doesNotMatch(image, /clip-path/);
  assert.equal(width, 42);
  assert.equal(height, 42);
  assert.match(html, /<path d="M0 109 L-23 78 A32 32 0 1 1 23 78 Z"/,
    "the teardrop shape and size have not changed");
  // The 32-radius arc through (+/-23, 78) has its center at this y.
  // Reserve the inside half of the 3-unit border, even for a solid square logo.
  const centerY = 78 - Math.sqrt(32 ** 2 - 23 ** 2);
  for (const cornerX of [x, x + width]) {
    for (const cornerY of [y, y + height]) {
      assert.ok(Math.hypot(cornerX, cornerY - centerY) < 32 - 1.5,
        "enlarged square logo corners remain inside the pin border");
    }
  }
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

test("the original brown football with white laces replaces the arrow and live endpoint dot", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(css, /--display-background: #22272e;/);
  assert.match(css, /\.display \{[\s\S]*?background: var\(--display-background\);/);
  assert.match(css, /\.field-wrap \{ --drive-line-color: #f5f4eb; \}/);
  assert.match(html, /<ellipse cx="0" cy="220" rx="20" ry="12" fill="#6e331b" stroke="white" stroke-width="3"/);
  assert.match(html, /<path d="M-10 220h20 M-5 215v10 M0 215v10 M5 215v10" stroke="white" stroke-width="2"/);
  for (const content of [html, source, css]) assert.doesNotMatch(content, /football-direction/);
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

const arizona = { id: "12", abbreviation: "ARIZ", location: "Arizona", name: "Wildcats" };
const texasTech = { id: "2641", abbreviation: "TTU", location: "Texas Tech", name: "Red Raiders" };
const spot = (team, possessionText, down = 1) => ({ team: { id: team.id }, possessionText, down, distance: 10 });

function reportedPlay(play, situation) {
  const summary = {
    header: { id: "401856842", competitions: [{
      status: { period: 1, displayClock: "4:47", type: { state: "in", detail: "1st Quarter" } },
      competitors: [
        { homeAway: "home", score: "0", team: texasTech },
        { homeAway: "away", score: "0", team: arizona },
      ],
    }] },
    situation,
    drives: { current: { id: "drive", team: { id: play.start.team.id }, plays: [
      { id: "play", sequenceNumber: "1", ...play },
    ] } },
  };
  return enrichGame({ id: summary.header.id, league: "college-football", selectedTeam: arizona }, summary);
}

test("Ridley's 41-yard punt places the football at TTU41 on that play, not ARIZ18", () => {
  const punt = {
    type: { text: "Punt Return" }, statYardage: 0,
    text: "(04:54) #37 C.Ridley punt 41 yards to the TTU41 #2 K.Johnson return 0 yards to the TTU41 (#15 M.Hartzog)",
    start: { ...spot(arizona, "ARIZ 18", 4), distance: 17 }, end: spot(texasTech, "TTU 41"),
  };
  for (const situation of [undefined, { possession: texasTech.id, possessionText: "TTU 41", down: 1, distance: 10 }]) {
    const result = reportedPlay(punt, situation);
    assert.equal(result.ball.percent, 59);
    assert.equal(result.ball.label, "TTU 41");
    assert.equal(result.possessionTeamId, texasTech.id);
    assert.equal(result.drives[0].plays[0].trajectory.end, 59);
    const view = fieldView();
    const placement = createBallPlacement({ render: view.updateFootballMarker, schedule: () => 1, cancel() {} });
    const element = new EventTarget();
    placement.update({ key: "punt", game: result, startGame: { ...result, ball: { ...result.ball, percent: 18 } },
      animation: { element, durationMs: 1100 } });
    element.dispatchEvent(new Event("animationend"));
    assert.equal(view.node("#football-marker").getAttribute("visibility"), "visible");
    assert.equal(view.node("#football-marker").style.transform, `translateX(${104 + 59 * 7.92}px)`);
    assert.equal(view.node("#ball-marker").style.transform, view.node("#football-marker").style.transform);
  }
});

test("the football uses final spots for gains, losses, incompletions, kicks and turnovers", () => {
  const cases = [
    ["Rush", arizona, "ARIZ 30", "ARIZ 36", 36],
    ["Sack", arizona, "ARIZ 30", "ARIZ 24", 24],
    ["Pass Reception", arizona, "ARIZ 30", "ARIZ 45", 45],
    ["Pass Incompletion", arizona, "ARIZ 30", "ARIZ 30", 30],
    ["Rush", texasTech, "TTU 30", "TTU 36", 64],
    ["Sack", texasTech, "TTU 30", "TTU 24", 76],
    ["Pass Reception", texasTech, "TTU 30", "TTU 45", 55],
    ["Pass Interception Return", texasTech, "ARIZ 30", "TTU 41", 59],
    ["Punt Return", texasTech, "ARIZ 18", "TTU 33", 67],
    ["Kickoff", arizona, "TTU 35", "ARIZ 25", 25],
  ];
  for (const [type, receiver, start, finish, percent] of cases) {
    const result = reportedPlay({ type: { text: type }, text: type === "Kickoff"
      ? "Kickoff to ARIZ 0, return 25 yards to the ARIZ25" : type,
    start: spot(start.startsWith("TTU") ? texasTech : arizona, start), end: spot(receiver, finish) });
    assert.equal(result.ball?.percent, percent, type);
    const view = fieldView();
    view.updateFootballMarker(result);
    assert.equal(view.node("#football-marker").style.transform, `translateX(${104 + percent * 7.92}px)`, type);
  }
});
