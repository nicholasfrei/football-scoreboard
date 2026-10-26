import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGame } from "../src/scoreboard.js";
import { enrichGame } from "../src/gamecast.js";
import { getScoreboard } from "../src/espn.js";

function event({ rank = 5, state = "post", records = true } = {}) {
  return {
    id: "game", date: "2026-10-17T23:00Z", competitions: [{
      status: { type: { state, detail: "Final" } },
      competitors: [
        { homeAway: "away", score: "31", curatedRank: { current: 99 },
          team: { id: "8", displayName: "Arkansas Razorbacks", location: "Arkansas", name: "Razorbacks", groups: { id: "8" } },
          record: records ? [{ type: "total", displayValue: "3-4" }, { type: "vsconf", displayValue: "1-3" }] : [] },
        { homeAway: "home", score: "21", curatedRank: { current: rank },
          team: { id: "61", displayName: "Georgia Bulldogs", location: "Georgia", name: "Bulldogs", groups: { id: "8" } },
          record: records ? [{ type: "total", summary: "6-1" }, { type: "vsconf", summary: "4-0" }] : [] },
      ],
    }],
  };
}

test("matchup ranks and overall/conference records normalize from both ESPN shapes", () => {
  const game = normalizeGame(event());
  assert.equal(game.selectedTeam.rank, null);
  assert.equal(game.opponent.rank, 5);
  assert.deepEqual(game.selectedTeam.record, { overall: "3-4", conference: "1-3" });
  assert.deepEqual(game.opponent.record, { overall: "6-1", conference: "4-0" });
  for (const rank of [0, 26, 99, null, "", "NR"]) assert.equal(normalizeGame(event({ rank })).opponent.rank, null);
  assert.equal(normalizeGame(event({ rank: 25 })).opponent.rank, 25);
});

test("summary omissions preserve schedule rankings/records; explicit unranked clears a rank", () => {
  const schedule = normalizeGame(event());
  const summaryEvent = event({ records: false });
  for (const team of summaryEvent.competitions[0].competitors) delete team.curatedRank;
  const summary = { header: summaryEvent };
  const game = enrichGame(schedule, summary);
  assert.equal(game.opponent.rank, 5);
  assert.deepEqual(game.opponent.record, { overall: "6-1", conference: "4-0" });
  summaryEvent.competitions[0].competitors[1].curatedRank = { current: 99 };
  assert.equal(enrichGame(schedule, summary).opponent.rank, null);
});

test("provider resolves conference names and does not replace historical records with today's", async () => {
  const e = event();
  const result = await getScoreboard({ fetchImpl: async (url) => {
    if (url.includes("/schedule?")) return { ok: true, json: async () => ({ events: [e] }) };
    if (url.includes("/summary?")) return { ok: true, json: async () => ({ header: e }) };
    if (url.endsWith("/groups/8")) return { ok: true, json: async () => ({ id: "8", isConference: true, shortName: "SEC" }) };
    const id = url.split("/").at(-1);
    const team = e.competitions[0].competitors.find((c) => c.team.id === id).team;
    return { ok: true, json: async () => ({ team: { ...team, record: { items: [{ type: "total", summary: "9-0" }] } } }) };
  } });
  assert.equal(result.spotlight.selectedTeam.conferenceName, "SEC");
  assert.equal(result.spotlight.opponent.conferenceName, "SEC");
  assert.equal(result.spotlight.selectedTeam.record.overall, "3-4");
  assert.equal(result.spotlight.opponent.rank, 5);
});

test("missing historical records stay unknown; upcoming records can use current team data", async () => {
  for (const state of ["post", "pre"]) {
    const e = event({ records: false, state });
    const result = await getScoreboard({ fetchImpl: async (url) => {
      if (url.includes("/schedule?")) return { ok: true, json: async () => ({ events: [e] }) };
      if (url.includes("/summary?") || url.includes("/groups/")) return { ok: false, status: 503 };
      const id = url.split("/").at(-1);
      const team = e.competitions[0].competitors.find((c) => c.team.id === id).team;
      return { ok: true, json: async () => ({ team: { ...team, record: { items: [{ type: "total", summary: "9-0" }] } } }) };
    } });
    assert.equal(result.spotlight.selectedTeam.record.overall, state === "post" ? null : "9-0");
    assert.equal(result.spotlight.selectedTeam.record.conference, null);
  }
});
