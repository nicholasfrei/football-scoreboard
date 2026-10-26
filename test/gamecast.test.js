import test from "node:test";
import assert from "node:assert/strict";
import { enrichGame } from "../src/gamecast.js";
import { getScoreboard } from "../src/espn.js";

function summary({ arkHome = false, state = "in", situation, current, previous = [] } = {}) {
  return {
    header: {
      id: "401856726",
      competitions: [{
        date: "2026-10-17T23:00Z",
        status: { period: 3, displayClock: "8:42", type: { state, detail: state === "post" ? "Final" : "3rd Quarter" } },
        competitors: [
          { homeAway: arkHome ? "home" : "away", score: "31", team: { id: "8", location: "Arkansas", name: "Razorbacks", displayName: "Arkansas Razorbacks", abbreviation: "ARK" } },
          { homeAway: arkHome ? "away" : "home", score: "21", team: { id: "238", location: "Vanderbilt", name: "Commodores", displayName: "Vanderbilt Commodores", abbreviation: "VAN" } },
        ],
      }],
    },
    situation,
    drives: { current, previous },
  };
}
const game = { id: "401856726", name: "Arkansas at Vanderbilt", venue: "FirstBank Stadium" };

test("home possession positions map to both halves of the field", () => {
  for (const [label, expected] of [["VAN 25", 25], ["ARK 32", 68], ["VAN 50", 50]]) {
    const result = enrichGame(game, summary({ situation: { possession: "238", possessionText: label } }));
    assert.equal(result.ball.percent, expected);
    assert.equal(result.ball.direction, "right");
    assert.equal(result.selectedTeam.score, 31);
  }
});

test("away possession uses fixed field coordinates and points left", () => {
  const result = enrichGame(game, summary({ situation: { possession: "8", possessionText: "ARK 25", downDistanceText: "1st & 10" } }));
  assert.equal(result.ball.percent, 75);
  assert.equal(result.ball.direction, "left");
  assert.equal(result.ball.downDistance, "1st & 10");
});

test("home/away branding follows the matchup, including Arkansas home games", () => {
  const road = enrichGame(game, summary());
  assert.equal(road.homeAway, "away");
  assert.equal(road.opponent.logo, "/assets/vanderbilt.png");
  assert.equal(road.opponent.mascot, "Commodores");
  const home = enrichGame(game, summary({ arkHome: true, situation: { possession: "8", possessionText: "ARK 25" } }));
  assert.equal(home.homeAway, "home");
  assert.equal(home.selectedTeam.color, "#A41F35");
  assert.equal(home.selectedTeam.logo, "/assets/arkansas.png");
  assert.equal(home.ball.percent, 25);
});

test("turnover fallback uses the end possession, not the drive team", () => {
  const result = enrichGame(game, summary({ current: { team: { id: "238" }, plays: [{
    id: "interception", sequenceNumber: "5", text: "Intercepted by Arkansas", type: { text: "Interception Return" },
    end: { team: { id: "8" }, yardsToEndzone: 65, possessionText: "ARK 35" },
  }] } }));
  assert.equal(result.ball.percent, 65);
  assert.equal(result.ball.direction, "left");
  assert.equal(result.ball.source, "last reported play");
});

test("final, missing and invalid position data never invent a live ball", () => {
  for (const options of [
    { state: "post", situation: { possession: "8", possessionText: "ARK 25" } },
    {},
    { situation: { possession: "8", possessionText: "ARK 75" } },
    { situation: { possession: "unknown", possessionText: "ARK 25" } },
    { situation: { possession: "8" }, current: { plays: [{ end: { team: { id: "8" }, yardsToEndzone: 50 } }] } },
  ]) assert.equal(enrichGame(game, summary(options)).ball, null);
});

test("plays deduplicate across drives and stay newest-first, limited to five", () => {
  const plays = Array.from({ length: 7 }, (_, index) => ({ id: `p${index}`, sequenceNumber: String(index), text: `Play ${index}` }));
  const result = enrichGame(game, summary({ previous: [{ plays }], current: { plays: [plays[6]] } }));
  assert.deepEqual(result.plays.map((play) => play.id), ["p6", "p5", "p4", "p3", "p2"]);
});

test("a summary outage keeps the schedule score and flags missing gamecast", async () => {
  const data = summary({ state: "post" });
  const result = await getScoreboard({
    now: new Date("2026-10-26T12:00Z"),
    fetchImpl: async (url) => url.includes("/schedule?")
      ? { ok: true, json: async () => ({ events: [{ id: game.id, date: "2026-10-17T23:00Z", competitions: data.header.competitions }] }) }
      : { ok: false, status: 503 },
  });
  assert.equal(result.spotlight.selectedTeam.score, 31);
  assert.equal(result.gamecastUnavailable, true);
  assert.equal(result.spotlight.ball, undefined);
});
