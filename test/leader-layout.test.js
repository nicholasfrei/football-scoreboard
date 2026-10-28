import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { leaderCardTeams, showGameLeaders } from "../public/leader-layout.js";

test("leader cards always stack the away team before the home team, regardless of the selected team", () => {
  const away = { id: "6", name: "Dallas Cowboys", location: "Dallas", abbreviation: "DAL" };
  const home = { id: "21", name: "Philadelphia Eagles", location: "Philadelphia", abbreviation: "PHI" };
  assert.deepEqual(leaderCardTeams({ homeAway: "away", selectedTeam: away, opponent: home }), [away, home]);
  assert.deepEqual(leaderCardTeams({ homeAway: "home", selectedTeam: home, opponent: away }), [away, home]);
});

test("leaders stay after the final but give way to the next kickoff countdown", () => {
  const leaders = [{ category: "passingYards", leaders: [{ teamId: "2", name: "M. Reed" }] }];
  assert.equal(showGameLeaders({ state: "live", leaders: [] }), true);
  assert.equal(showGameLeaders({ state: "final", leaders }), true);
  assert.equal(showGameLeaders({ state: "final", leaders: [{ category: "passingYards", leaders: [] }] }), false);
  assert.equal(showGameLeaders({ state: "scheduled", leaders }), false);
  assert.equal(showGameLeaders(null), false);
});

function element() {
  let text = "";
  return {
    children: [], dataset: {}, attributes: {}, hidden: false, className: "",
    classList: { add() {} },
    setAttribute(name, value) { this.attributes[name] = value; },
    get textContent() { return text + this.children.map((child) => child.textContent).join(" "); },
    set textContent(value) { text = String(value); this.children = []; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { text = ""; this.children = children; },
  };
}

async function leaderView() {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const nodes = new Map();
  const querySelector = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, element());
    return nodes.get(selector);
  };
  const renderer = source.slice(source.indexOf("function renderLeaders("), source.indexOf("function updateGame("));
  const render = runInNewContext(`${renderer}; renderLeaders`, {
    document: { querySelector, createElement: element }, leaderCardTeams, showGameLeaders,
    setTeamLogo(node, team) { node.textContent = `${team.abbreviation} logo`; },
  });
  return { render, querySelector };
}

const away = { id: "6", name: "Dallas Cowboys", location: "Dallas", abbreviation: "DAL" };
const home = { id: "21", name: "Philadelphia Eagles", location: "Philadelphia", abbreviation: "PHI" };
const categories = ["passingYards", "rushingYards", "receivingYards"];

test("three category cards retain both players, identities, attempts, yards, TDs, INTs, and fumbles", async () => {
  const { render, querySelector } = await leaderView();
  const leaders = categories.map((category) => ({ category, leaders: [
    { teamId: "21", shortName: "J. Hurts", position: "QB", attempts: "22/31", yards: 249, touchdowns: 3, interceptions: 1, fumbles: 1 },
    { teamId: "6", shortName: "D. Prescott", position: "QB", attempts: "14/21", yards: 163, touchdowns: 1, interceptions: 2, fumbles: 3 },
  ] }));
  for (const homeAway of ["away", "home"]) {
    render({ state: "live", homeAway, selectedTeam: homeAway === "away" ? away : home,
      opponent: homeAway === "away" ? home : away, leaders });
    const cards = querySelector("#leader-list").children;
    assert.equal(cards.length, 3);
    assert.equal(querySelector("#leader-matchup").textContent, "Dallas / Philadelphia");
    for (const [index, card] of cards.entries()) {
      assert.equal(card.children[0].textContent, ["Passing", "Rushing", "Receiving"][index]);
      assert.equal(card.children[1].dataset.side, "away");
      assert.equal(card.children[2].dataset.side, "home");
      for (const text of ["DAL", "D. Prescott", "QB", "14/21", "163 YDS", "1 TD", "2 INT · 3 FUM"])
        assert.ok(card.children[1].textContent.includes(text), `away retains ${text}`);
      for (const text of ["PHI", "J. Hurts", "QB", "22/31", "249 YDS", "3 TD", "1 INT · 1 FUM"])
        assert.ok(card.children[2].textContent.includes(text), `home retains ${text}`);
    }
  }
});

test("missing leaders keep the correct team slot and yardage fallback without inventing statistics", async () => {
  const { render, querySelector } = await leaderView();
  render({ state: "live", homeAway: "away", selectedTeam: away, opponent: home,
    leaders: [{ category: "receivingYards", leaders: [
      { teamId: "21", shortName: "A. Brown", position: "WR", attempts: "6 REC", value: "156 YDS", touchdowns: 0 },
    ] }] });
  const card = querySelector("#leader-list").children[0];
  assert.ok(card.children[1].textContent.includes("DAL"));
  assert.ok(card.children[1].textContent.includes("Stats unavailable"));
  assert.ok(card.children[1].textContent.includes("— YDS"));
  assert.ok(card.children[2].textContent.includes("6 REC"));
  assert.ok(card.children[2].textContent.includes("156 YDS"));
  assert.ok(card.children[2].textContent.includes("0 TD"));
  assert.ok(!card.textContent.includes("INT"));
  assert.ok(!card.textContent.includes("FUM"));
  render({ state: "scheduled", homeAway: "away", selectedTeam: away, opponent: home });
  assert.equal(querySelector("#game-leaders").hidden, true);
  assert.equal(querySelector(".next-game").hidden, false);
  assert.equal(querySelector("#leader-matchup").textContent, "");
  assert.equal(querySelector("#leader-list").children.length, 0);
});
