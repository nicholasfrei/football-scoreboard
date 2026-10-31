import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { teamRecordLabel } from "../public/team-record.js";
import { halftimeCountdown } from "../public/game-timing.js";

const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

function element() {
  let text = "";
  const classes = new Set();
  return {
    children: [], hidden: false, dataset: {}, classList: {
      toggle(name, force) { if (force) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
    get textContent() { return text + this.children.map((child) => child.textContent).join(""); },
    set textContent(value) { text = value; this.children = []; },
    replaceChildren(...children) { text = ""; this.children = children; },
    append(...children) { this.children.push(...children); },
  };
}

function gameView() {
  const nodes = new Map();
  const querySelector = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, element());
    return nodes.get(selector);
  };
  const document = { querySelector, createElement: element };
  const elements = Object.fromEntries(["gameClock", "gameDetail", "gameLabel", "gameVenue", "nextOpponent", "nextDetail"]
    .map((key) => [key, element()]));
  const noop = () => {};
  const updateGameSource = source.slice(source.indexOf("function updateGame("), source.indexOf("function updateCountdown("));
  const updateGame = runInNewContext(`${updateGameSource}; updateGame`, {
    document, elements, updateCountdown: noop, updatePossession: noop, renderNextDetails: noop,
    renderLeaders: noop, renderTeam: noop, updateField: noop, renderDrives: noop, setStatus: noop,
    kickoffText: () => "MON, OCT 26 · 7:15 PM CDT", formatDate: () => "MON, OCT 26", halftimeCountdown,
  });
  return { updateGame, elements, querySelector };
}

const game = {
  state: "live", league: "nfl", homeAway: "away", period: 3, clock: "8:42", status: "3rd Quarter",
  selectedTeam: { id: "6" }, opponent: { id: "21" }, venue: "Lincoln Financial Field", broadcasts: ["ESPN", "ABC"],
};

test("broadcast clock keeps regulation, halftime, and overtime readable without losing kickoff or TV details", () => {
  const { updateGame, elements, querySelector } = gameView();
  for (const [period, clock, status, expectedPeriod, expectedTime] of [
    [3, "8:42", "3rd Quarter", "Q3", "8:42"],
    [2, "0:00", "Halftime", "HALFTIME", null],
    [5, "3:00", "Overtime", "OT1", "3:00"],
    [6, null, "Overtime", "OT2", null],
  ]) {
    updateGame({ ...game, period, clock, status });
    assert.equal(elements.gameClock.hidden, false);
    assert.equal(elements.gameClock.children[0].className, "clock-period");
    assert.equal(elements.gameClock.children[0].textContent, expectedPeriod);
    assert.equal(elements.gameClock.children[1]?.textContent ?? null, expectedTime);
    if (expectedTime) assert.equal(elements.gameClock.children[1].className, "clock-time");
    assert.equal(elements.gameLabel.textContent, "MON, OCT 26 · 7:15 PM CDT");
    assert.equal(querySelector("#game-broadcast").textContent, "ESPN / ABC");
  }
  for (const state of ["final", "scheduled"]) {
    updateGame({ ...game, state });
    assert.equal(elements.gameClock.hidden, true);
    assert.equal(elements.gameClock.textContent, "");
  }
});

test("clock turns red only in the final two minutes of Q2 and Q4", () => {
  const { updateGame, elements } = gameView();
  for (const [period, clock, status, expected] of [
    [2, "2:01", "2nd Quarter", false],
    [2, "2:00", "2nd Quarter", true],
    [2, "0:32", "2nd Quarter", true],
    [4, "2:00", "4th Quarter", true],
    [4, "0:00", "4th Quarter", true],
    [4, "2:01", "4th Quarter", false],
    [1, "0:32", "1st Quarter", false],
    [3, "0:32", "3rd Quarter", false],
    [5, "0:32", "Overtime", false],
    [2, "0:00", "Halftime", false],
    [2, "invalid", "2nd Quarter", false],
    [4, null, "4th Quarter", false],
  ]) {
    updateGame({ ...game, period, clock, status });
    assert.equal(elements.gameClock.children[1]?.classList.contains("is-two-minute-warning") ?? false,
      expected, `${period}: ${clock} (${status})`);
  }
});

test("clock uses the score color and shares the fourth-down warning red", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.clock-time\s*\{[^}]*color: #f5f4eb;/);
  assert.match(css, /\.score-number\s*\{[^}]*color: #f5f4eb;/);
  assert.match(css, /\.clock-time\.is-two-minute-warning, \.down-distance\.is-fourth-down\s*\{ color: #f56367; \}/);
});

test("a reported halftime marker shows an estimated break timer below the score", () => {
  const { updateGame, elements } = gameView();
  updateGame({ ...game, period: 2, clock: "0:00", status: "Halftime",
    halftimeStartedAt: new Date(Date.now() - 17_000).toISOString() });
  assert.match(elements.gameClock.children[1].textContent, /^12:4[23]$/);
  assert.equal(elements.gameClock.children[2].textContent, "EST. TO 2ND HALF");
  assert.equal(elements.gameClock.children[1].classList.contains("is-two-minute-warning"), false);
});

test("neutral-site team labels identify designated sides rather than claiming a home stadium", () => {
  const { updateGame, querySelector } = gameView();
  updateGame({ ...game, neutralSite: true });
  assert.equal(querySelector("#away-side").textContent, "DESIGNATED AWAY");
  assert.equal(querySelector("#home-side").textContent, "DESIGNATED HOME");
  updateGame(game);
  assert.equal(querySelector("#away-side").textContent, "AWAY");
  assert.equal(querySelector("#home-side").textContent, "HOME");
});

test("team headings use full NFL names while retaining college event rankings and complete records", () => {
  const { querySelector } = gameView();
  const teamSource = source.slice(source.indexOf("function rankedName("), source.indexOf("function renderNextDetails("));
  const renderTeam = runInNewContext(`${teamSource}; renderTeam`, {
    document: { querySelector }, selectedTeamId: "6", teamRecordLabel, setTeamLogo() {},
  });
  renderTeam("away", { id: "6", name: "Dallas Cowboys", location: "Dallas", record: { overall: "3-4" },
    divisionStanding: "2nd in NFC East", score: 17 }, "nfl");
  assert.equal(querySelector("#away-name").textContent, "Dallas Cowboys");
  assert.equal(querySelector("#away-score").textContent, "17");
  assert.equal(querySelector("#away-record").textContent, "3-4 · 2nd in NFC East");
  renderTeam("home", { id: "251", location: "Texas", rank: 19, rankSource: "ESPN event ranking",
    record: { overall: "5-2", conference: "2-2" }, conferenceName: "SEC", score: 24 }, "college-football");
  assert.equal(querySelector("#home-name").textContent, "#19 Texas");
  assert.equal(querySelector("#home-name").title, "ESPN event ranking");
  assert.equal(querySelector("#home-record").textContent, "5-2 (2-2 SEC)");
});

test("score possession footballs match the field football's displayed size", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.score-readout\s*\{[^}]*grid-template-columns: 54px minmax\(0, 1fr\) 156px minmax\(0, 1fr\) 54px;/);
  assert.match(css, /\.possession-ball\s*\{[^}]*width: 100%;[^}]*height: auto;/);
});

test("the broadcast layout preserves the boxed channel, full drive list, and complete leaders footer", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(html, /id="game-broadcast" class="broadcast-badge"/);
  assert.match(html, /id="drive-content" class="drive-content">\s*<ol id="recent-plays"/);
  assert.match(css, /\.drive-content\s*\{[^}]*min-height: 0;[^}]*overflow-y: auto;/);
  assert.match(css, /\.gamecast-layout\s*\{[^}]*flex: none;[^}]*min-height: 0;/);
  assert.match(css, /\.gamecast-layout\s*\{[^}]*grid-template-columns: minmax\(0, 2fr\) minmax\(0, 1fr\);/);
  assert.doesNotMatch(html, /field-heading|field-direction|field-legend|field-drive-caption|THE FIELD/);
  assert.doesNotMatch(source, /#field-direction/);
  assert.match(css, /\.footer-bar\s*\{[^}]*flex: none;/);
  assert.match(source, /for \(const play of selected \? \[\.\.\.selected\.plays\]\.reverse\(\)/);
  for (const metric of ["attempts", "yards", "touchdowns", "interceptions", "fumbles"]) {
    assert.ok(source.includes(`leader?.${metric}`), `${metric} remains in the game-leader renderer`);
  }
});
