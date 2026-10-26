import test from "node:test";
import assert from "node:assert/strict";
import { selectScoreboard } from "../src/scoreboard.js";

const NOW = new Date("2026-10-26T17:00:00.000Z");

function event({ id, date, state, status, opponentId, opponentName, opponentShort, homeAway, arkScore, opponentScore }) {
  const arkansasHome = homeAway === "home";
  const arkansas = {
    id: "8",
    homeAway,
    score: arkScore === null ? null : { value: arkScore, displayValue: String(arkScore) },
    team: { id: "8", displayName: "Arkansas Razorbacks", shortDisplayName: "Arkansas", abbreviation: "ARK" },
  };
  const opponent = {
    id: opponentId,
    homeAway: arkansasHome ? "away" : "home",
    score: opponentScore === null ? null : { value: opponentScore, displayValue: String(opponentScore) },
    team: { id: opponentId, displayName: opponentName, shortDisplayName: opponentShort, abbreviation: opponentId },
  };

  return {
    id,
    date,
    name: `${opponentName} at Arkansas Razorbacks`,
    competitions: [{
      status: { displayClock: state === "live" ? "08:42" : "0:00", period: state === "live" ? 3 : 0, type: { state, completed: state === "final", detail: status } },
      competitors: arkansasHome ? [arkansas, opponent] : [opponent, arkansas],
      venue: { fullName: "Razorback Stadium" },
    }],
  };
}

const payload = (events) => ({
  team: { displayName: "Arkansas Razorbacks", abbreviation: "ARK", recordSummary: "3-4", logo: "https://example.test/ark.png" },
  events,
});

test("spotlights Arkansas's latest final and carries the next scheduled game", () => {
  const scoreboard = selectScoreboard(payload([
    event({ id: "old", date: "2026-10-10T20:00:00Z", state: "post", status: "Final", opponentId: "2633", opponentName: "Tennessee Volunteers", opponentShort: "Tennessee", homeAway: "home", arkScore: 17, opponentScore: 24 }),
    event({ id: "latest", date: "2026-10-17T23:00:00Z", state: "post", status: "Final", opponentId: "238", opponentName: "Vanderbilt Commodores", opponentShort: "Vanderbilt", homeAway: "away", arkScore: 31, opponentScore: 21 }),
    event({ id: "next", date: "2026-10-31T23:45:00Z", state: "pre", status: "Sat, Oct 31", opponentId: "142", opponentName: "Missouri Tigers", opponentShort: "Missouri", homeAway: "home", arkScore: null, opponentScore: null }),
  ]), NOW);

  assert.equal(scoreboard.spotlight.id, "latest");
  assert.equal(scoreboard.spotlight.selectedTeam.score, 31);
  assert.equal(scoreboard.spotlight.opponent.score, 21);
  assert.equal(scoreboard.spotlight.homeAway, "away");
  assert.equal(scoreboard.nextGame.id, "next");
  assert.equal(scoreboard.team.record, "3-4");
});

test("a live game takes priority over completed games", () => {
  const scoreboard = selectScoreboard(payload([
    event({ id: "final", date: "2026-10-17T23:00:00Z", state: "post", status: "Final", opponentId: "238", opponentName: "Vanderbilt Commodores", opponentShort: "Vanderbilt", homeAway: "away", arkScore: 31, opponentScore: 21 }),
    event({ id: "live", date: "2026-10-31T23:45:00Z", state: "in", status: "3rd · 08:42", opponentId: "142", opponentName: "Missouri Tigers", opponentShort: "Missouri", homeAway: "home", arkScore: 24, opponentScore: 17 }),
  ]), NOW);

  assert.equal(scoreboard.spotlight.id, "live");
  assert.equal(scoreboard.spotlight.state, "live");
});

test("before the first completed game, the next scheduled matchup is the spotlight", () => {
  const scoreboard = selectScoreboard(payload([
    event({ id: "first", date: "2026-09-05T20:15:00Z", state: "pre", status: "Sat, Sep 5", opponentId: "2453", opponentName: "North Alabama Lions", opponentShort: "North Alabama", homeAway: "home", arkScore: null, opponentScore: null }),
    event({ id: "second", date: "2026-09-12T20:00:00Z", state: "pre", status: "Sat, Sep 12", opponentId: "254", opponentName: "Utah Utes", opponentShort: "Utah", homeAway: "away", arkScore: null, opponentScore: null }),
  ]), NOW);

  assert.equal(scoreboard.spotlight.id, "first");
  assert.equal(scoreboard.spotlight.state, "scheduled");
  assert.equal(scoreboard.nextGame.id, "second");
});

test("ignores malformed events without both Arkansas and an opponent", () => {
  const scoreboard = selectScoreboard(payload([{ id: "bad", competitions: [] }]), NOW);

  assert.equal(scoreboard.spotlight, null);
  assert.equal(scoreboard.nextGame, null);
});
