import test from "node:test";
import assert from "node:assert/strict";
import { parseConfig } from "../src/config.js";
import { getScoreboard } from "../src/espn.js";

const arkansasUrl = "https://www.espn.com/college-football/team/_/id/8/arkansas-razorbacks";
const dallasUrl = "https://www.espn.com/nfl/team/_/name/dal/dallas-cowboys";

test("configuration accepts college IDs and NFL abbreviations or IDs", () => {
  assert.deepEqual(parseConfig({ teamUrl: arkansasUrl }), {
    teamUrl: arkansasUrl, league: "college-football", teamKey: "8", timeZone: "America/Chicago",
  });
  assert.equal(parseConfig({ teamUrl: dallasUrl }).teamKey, "dal");
  assert.equal(parseConfig({ teamUrl: "https://espn.com/nfl/team/_/id/6/dallas-cowboys" }).league, "nfl");
  assert.equal(parseConfig({ teamUrl: dallasUrl, timeZone: "America/Los_Angeles" }).timeZone, "America/Los_Angeles");
});

test("invalid config fails clearly instead of silently following the wrong team", () => {
  for (const value of [null, {}, { teamUrl: "dal" }, { teamUrl: "http://www.espn.com/nfl/team/_/name/dal" },
    { teamUrl: "https://example.com/nfl/team/_/name/dal" },
    { teamUrl: "https://www.espn.com/nba/team/_/name/dal" },
    { teamUrl: "https://www.espn.com/nfl/scoreboard" },
    { teamUrl: "https://www.espn.com/college-football/team/_/name/ark" },
    { teamUrl: dallasUrl, timeZone: "Not/AZone" }]) {
    assert.throws(() => parseConfig(value));
  }
});

function fakeEspn() {
  const calls = [];
  const clubs = {
    "college-football": {
      "8": { id: "8", location: "Arkansas", name: "Razorbacks", displayName: "Arkansas Razorbacks", abbreviation: "ARK", color: "a32136", groups: { id: "8", isConference: true } },
      "61": { id: "61", location: "Georgia", name: "Bulldogs", displayName: "Georgia Bulldogs", abbreviation: "UGA", color: "ba0c2f", groups: { id: "8", isConference: true } },
    },
    nfl: {
      "6": { id: "6", location: "Dallas", name: "Cowboys", displayName: "Dallas Cowboys", abbreviation: "DAL", color: "002a5c", groups: { id: "1", isConference: false, parent: { id: "7" } } },
      "8": { id: "8", location: "Detroit", name: "Lions", displayName: "Detroit Lions", abbreviation: "DET", color: "0076b6", groups: { id: "10", isConference: false, parent: { id: "7" } } },
    },
  };
  function event(league, selectedId) {
    const opponentId = league === "nfl" ? selectedId === "6" ? "8" : "6" : selectedId === "8" ? "61" : "8";
    return {
      id: `${league}-${selectedId}`, date: "2026-10-26T23:00Z", competitions: [{
        status: { displayClock: "08:00", period: 3, type: { state: "in", detail: "3rd Quarter" } },
        competitors: [selectedId, opponentId].map((id, index) => ({
          team: clubs[league][id], homeAway: index === 0 ? "home" : "away", score: index === 0 ? "31" : "21",
          curatedRank: { current: 5 }, record: [{ type: "total", summary: league === "nfl" ? "3-2-1" : "3-4" }],
        })),
      }],
    };
  }
  const fetchImpl = async (url) => {
    calls.push(url);
    const league = url.includes("/nfl/") ? "nfl" : "college-football";
    if (url.includes("/groups/")) return { ok: true, json: async () => ({ id: league === "nfl" ? "7" : "8", isConference: true, shortName: league === "nfl" ? "NFC" : "SEC" }) };
    const path = new URL(url).pathname;
    const schedule = /\/teams\/([^/]+)\/schedule$/.exec(path);
    if (schedule) {
      const id = schedule[1] === "dal" ? "6" : schedule[1];
      return { ok: true, json: async () => ({ team: clubs[league][id], events: [event(league, id)], season: { year: 2026 } }) };
    }
    if (url.includes("/summary?")) {
      const id = new URL(url).searchParams.get("event").split("-").at(-1);
      const header = event(league, id);
      const opponent = header.competitions[0].competitors[1].team;
      return { ok: true, json: async () => ({
        header,
        situation: { possession: id, possessionText: `${clubs[league][id].abbreviation} 25` },
        predictor: { homeTeam: { id, gameProjection: "60" }, awayTeam: { id: opponent.id, gameProjection: "40" } },
        drives: { current: { plays: [{ id: "touchdown", sequenceNumber: "10", text: "Touchdown", type: { text: "Passing Touchdown" }, scoringPlay: true, end: { team: { id } } }] } },
      }) };
    }
    const id = path.split("/").at(-1);
    return { ok: true, json: async () => ({ team: { ...clubs[league][id], logos: [{ href: `https://example.test/${league}/${id}.png` }] } }) };
  };
  return { fetchImpl, calls };
}

test("NFL abbreviation selects Dallas across scores, field position, predictor, and highlights", async () => {
  const { fetchImpl, calls } = fakeEspn();
  const result = await getScoreboard({ config: parseConfig({ teamUrl: dallasUrl }), fetchImpl });
  assert.equal(result.team.id, "6");
  assert.equal(result.team.name, "Dallas Cowboys");
  assert.equal(result.team.color, "#002a5c");
  assert.equal(result.spotlight.selectedTeam.score, 31);
  assert.equal(result.spotlight.selectedTeam.record.overall, "3-2-1");
  assert.equal(result.spotlight.selectedTeam.conferenceName, "NFC");
  assert.equal(result.spotlight.selectedTeam.rank, null);
  assert.equal(result.spotlight.ball.percent, 75);
  assert.equal(result.spotlight.matchupPredictor.selectedTeam, 60);
  assert.equal(result.spotlight.highlights[0].teamId, "6");
  assert.ok(calls.some((url) => url.includes("/nfl/teams/dal/schedule")));
  assert.ok(calls.every((url) => !url.includes("college-football")));
});

test("switching leagues never reuses Arkansas metadata or branding for Detroit ID 8", async () => {
  const { fetchImpl, calls } = fakeEspn();
  const arkansas = await getScoreboard({ config: parseConfig({ teamUrl: arkansasUrl }), fetchImpl });
  assert.equal(arkansas.team.logo, "/assets/arkansas.png");
  const detroit = await getScoreboard({ config: parseConfig({ teamUrl: "https://www.espn.com/nfl/team/_/id/8/detroit-lions" }), fetchImpl });
  assert.equal(detroit.team.name, "Detroit Lions");
  assert.equal(detroit.team.color, "#0076b6");
  assert.equal(detroit.team.logo, "https://example.test/nfl/8.png");
  assert.equal(detroit.spotlight.selectedTeam.conferenceName, "NFC");
  assert.ok(calls.some((url) => url.endsWith("/college-football/teams/8")));
  assert.ok(calls.some((url) => url.endsWith("/nfl/teams/8")));
});

test("another college team can be followed with rankings and both teams correctly identified", async () => {
  const { fetchImpl } = fakeEspn();
  const result = await getScoreboard({ config: parseConfig({ teamUrl: "https://www.espn.com/college-football/team/_/id/61/georgia-bulldogs" }), fetchImpl });
  assert.equal(result.team.name, "Georgia Bulldogs");
  assert.equal(result.spotlight.selectedTeam.id, "61");
  assert.equal(result.spotlight.selectedTeam.rank, 5);
  assert.equal(result.spotlight.opponent.id, "8");
  assert.equal(result.spotlight.matchupPredictor.selectedTeam, 60);
});

test("January queries use the football season that began the preceding year", async () => {
  const { fetchImpl, calls } = fakeEspn();
  await getScoreboard({ config: parseConfig({ teamUrl: dallasUrl }), fetchImpl, now: new Date("2027-01-20T12:00Z") });
  assert.ok(calls.some((url) => url.endsWith("schedule?season=2026")));
});
