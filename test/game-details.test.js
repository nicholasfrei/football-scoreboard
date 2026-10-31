import test from "node:test";
import assert from "node:assert/strict";
import { broadcastNetworks, matchupPredictor } from "../src/game-details.js";
import { getScoreboard } from "../src/espn.js";

const game = { selectedTeam: { id: "8" }, opponent: { id: "142" } };
const beforeNextGame = new Date("2026-10-26T17:00:00Z");
const prediction = (arkansas, opponent, away = false) => ({
  homeTeam: { id: away ? "142" : "8", gameProjection: away ? opponent : arkansas },
  awayTeam: { id: away ? "8" : "142", gameProjection: away ? arkansas : opponent },
});

test("predictor matches team IDs regardless of home/away order", () => {
  for (const away of [false, true]) {
    assert.deepEqual(matchupPredictor(prediction("26.6", "73.4", away), game), {
      selectedTeam: 26.6, opponent: 73.4, source: "ESPN Analytics",
    });
  }
  assert.equal(matchupPredictor(prediction("0", "100"), game).selectedTeam, 0);
});

test("missing, malformed, out-of-range or wrong-team predictions stay unavailable", () => {
  for (const p of [null, {}, prediction(null, "100"), prediction(" ", "100"),
    prediction("NaN", "80"), prediction("-1", "101"), prediction("40", "40"),
    { homeTeam: { id: "99", gameProjection: "26.6" }, awayTeam: { id: "142", gameProjection: "73.4" } }]) {
    assert.equal(matchupPredictor(p, game), null);
  }
});

test("NFL predictor preserves room for ties without inferring a complement", () => {
  const nflGame = { ...game, league: "nfl" };
  assert.deepEqual(matchupPredictor(prediction("47.5", "50"), nflGame), {
    selectedTeam: 47.5, opponent: 50, source: "ESPN Analytics",
  });
  assert.equal(matchupPredictor(prediction("70", "70"), nflGame), null);
});

test("TV and streaming networks normalize without duplicate or radio channels", () => {
  assert.deepEqual(broadcastNetworks([
    { type: { shortName: "TV" }, media: { shortName: "SEC Network" } },
    { names: ["SEC Network", "ESPN+"] },
    { type: { shortName: "Radio" }, media: { shortName: "Local radio" } },
  ]), ["SEC Network", "ESPN+"]);
  assert.deepEqual(broadcastNetworks(null), []);
});

function event(id, state) {
  return {
    id, date: state === "post" ? "2026-10-17T23:00Z" : "2026-10-31T23:45Z",
    competitions: [{
      status: { type: { state } }, broadcasts: [{ media: { shortName: "SEC Network" } }],
      competitors: [
        { team: { id: "8", displayName: "Arkansas Razorbacks", location: "Arkansas", name: "Razorbacks" }, homeAway: "home", score: "31" },
        { team: { id: "142", displayName: "Missouri Tigers", location: "Missouri", name: "Tigers" }, homeAway: "away", score: "21" },
      ],
    }],
  };
}

test("next-game summary supplies predictor separately from the displayed completed game", async () => {
  const previous = event("previous", "post");
  const next = event("next", "pre");
  const calls = [];
  const result = await getScoreboard({ now: beforeNextGame, fetchImpl: async (url) => {
    calls.push(url);
    if (url.includes("/schedule?")) return { ok: true, json: async () => ({ events: [previous, next] }) };
    if (url.includes("summary?event=previous")) return { ok: true, json: async () => ({ header: previous }) };
    if (url.includes("summary?event=next")) return { ok: true, json: async () => ({ header: next, predictor: prediction("26.6", "73.4") }) };
    return { ok: false, status: 503 };
  } });
  assert.equal(result.spotlight.id, "previous");
  assert.equal(result.spotlight.matchupPredictor, null);
  assert.equal(result.nextGame.matchupPredictor.selectedTeam, 26.6);
  assert.deepEqual(result.nextGame.broadcasts, ["SEC Network"]);
  assert.equal(calls.filter((url) => url.includes("summary?event=next")).length, 1);
});

test("next-summary failure preserves the schedule network and available scoreboard", async () => {
  const result = await getScoreboard({ now: beforeNextGame, fetchImpl: async (url) => {
    if (url.includes("/schedule?")) return { ok: true, json: async () => ({ events: [event("previous", "post"), event("next", "pre")] }) };
    return { ok: false, status: 503 };
  } });
  assert.equal(result.spotlight.selectedTeam.score, 31);
  assert.deepEqual(result.nextGame.broadcasts, ["SEC Network"]);
  assert.equal(result.nextGame.matchupPredictor, undefined);
  assert.equal(result.nextGameDetailsUnavailable, true);
});
