import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGame } from "../src/scoreboard.js";
import { enrichGame } from "../src/gamecast.js";
import { getScoreboard } from "../src/espn.js";
import { teamStats } from "../src/team-stats.js";
import { parseConfig } from "../src/config.js";

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

test("NFL division standings normalize provider text, not college ranks or conference records", () => {
  for (const standing of ["1st in AFC South", "2nd in NFC East", "3rd in NFC West", "4th in AFC North", "Tied for 1st in NFC South"]) {
    assert.equal(teamStats({ team: { standingSummary: standing } }, "nfl").divisionStanding, standing);
    assert.equal(teamStats({ standingSummary: standing }, "nfl").divisionStanding, standing);
    assert.equal(teamStats({ team: { standingSummary: standing } }, "college-football").divisionStanding, null);
  }
  assert.equal(teamStats({ team: { standingSummary: "  2nd  in NFC East " } }, "nfl").divisionStanding, "2nd in NFC East");
  for (const standingSummary of [undefined, null, 2, "", "2nd in NFC", "1st in SEC", "5th in NFC East", "2nd in Unknown Division"]) {
    assert.equal(teamStats({ team: { standingSummary } }, "nfl").divisionStanding, null);
  }
});

test("summary omissions preserve confirmed NFL division standings", () => {
  const e = event();
  e.competitions[0].competitors[0].team.standingSummary = "2nd in NFC East";
  const schedule = normalizeGame(e, { teamId: "8", league: "nfl" });
  const summaryEvent = event({ records: false });
  assert.equal(enrichGame(schedule, { header: summaryEvent }).selectedTeam.divisionStanding, "2nd in NFC East");
  summaryEvent.competitions[0].competitors[0].team.standingSummary = "1st in NFC East";
  assert.equal(enrichGame(schedule, { header: summaryEvent }).selectedTeam.divisionStanding, "1st in NFC East");
});

test("NFL metadata supplies current division standings without replacing historical W-L records", async (t) => {
  const e = event();
  e.competitions[0].competitors[0].team = { id: "6", location: "Dallas", name: "Cowboys", displayName: "Dallas Cowboys" };
  e.competitions[0].competitors[1].team = { id: "21", location: "Philadelphia", name: "Eagles", displayName: "Philadelphia Eagles" };
  e.competitions[0].competitors[0].team.standingSummary = "4th in NFC East";
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes("/schedule?")) return { ok: true, json: async () => ({ events: [e] }) };
    if (url.includes("/summary?")) return { ok: true, json: async () => ({ header: e }) };
    if (url.includes("/standings?")) return { ok: true, json: async () => ({ season: { year: new Date().getUTCFullYear() }, children: [{ children: [{ name: "NFC East", isConference: false,
      standings: { entries: ["21", "19", "6", "28"].map((id) => ({ team: { id } })) } }] }] }) };
    if (url.includes("/groups/")) return { ok: false, status: 503 };
    const id = url.split("/").at(-1);
    const team = e.competitions[0].competitors.find((c) => c.team.id === id).team;
    return { ok: true, json: async () => ({ team: { ...team, standingSummary: id === "6" ? "2nd in NFC East" : "11th in National Football Conference", record: { items: [{ type: "total", summary: "9-0" }] } } }) };
  };
  const config = parseConfig({ teamUrl: "https://www.espn.com/nfl/team/_/id/6/dallas-cowboys" });
  const result = await getScoreboard({ config, fetchImpl });
  assert.equal(result.spotlight.selectedTeam.divisionStanding, "2nd in NFC East");
  assert.equal(result.spotlight.opponent.divisionStanding, "1st in NFC East");
  assert.equal(result.spotlight.selectedTeam.record.overall, "3-4");
  await getScoreboard({ config, fetchImpl });
  assert.equal(calls.filter((url) => url.endsWith("/nfl/teams/6")).length, 1, "standings metadata is cached across immediate polls");
  assert.equal(calls.filter((url) => url.includes("/standings?")).length, 1, "the division-table fallback is cached across polls");
  now += 61_000;
  await getScoreboard({ config, fetchImpl });
  assert.equal(calls.filter((url) => url.endsWith("/nfl/teams/6")).length, 2, "NFL standings metadata refreshes after one minute, not a day");
  assert.equal(calls.filter((url) => url.includes("/standings?")).length, 2);
});
