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

test("home possession attacks left across the field", () => {
  for (const [label, expected] of [["VAN 25", 75], ["ARK 32", 32], ["VAN 50", 50]]) {
    const result = enrichGame(game, summary({ situation: { possession: "238", possessionText: label } }));
    assert.equal(result.ball.percent, expected);
    assert.equal(result.ball.direction, "left");
    assert.equal(result.selectedTeam.score, 31);
  }
});

test("away possession attacks right across the field", () => {
  const result = enrichGame(game, summary({ situation: { possession: "8", possessionText: "ARK 25", downDistanceText: "1st & 10" } }));
  assert.equal(result.ball.percent, 25);
  assert.equal(result.ball.direction, "right");
  assert.equal(result.ball.downDistance, "1st & 10");
  assert.equal(result.possessionTeamId, "8");
});

test("score possession follows confirmed live possession, even without a yard-line spot", () => {
  const result = enrichGame(game, summary({ situation: { possession: "238" } }));
  assert.equal(result.ball, null);
  assert.equal(result.possessionTeamId, "238");
  for (const options of [
    { state: "post", situation: { possession: "8", possessionText: "ARK 25" } },
    { situation: { possession: "unknown" } },
    {},
    { current: { plays: [{ id: "td", text: "Touchdown", scoringPlay: true, end: { team: { id: "8" }, yardsToEndzone: 0 } }] } },
  ]) assert.equal(enrichGame(game, summary(options)).possessionTeamId, null);
});

test("line to gain follows possession and only uses valid down/distance metadata", () => {
  for (const [possession, possessionText, down, distance, expected] of [
    ["238", "VAN 25", 1, 10, 65],
    ["8", "ARK 25", 2, 6, 31],
    ["238", "ARK 5", 1, 5, 0],
    ["8", "VAN 5", 1, 5, 100],
    ["8", "ARK 25", undefined, undefined, null],
    ["8", "ARK 25", 0, 10, null],
  ]) {
    const result = enrichGame(game, summary({ situation: { possession, possessionText, down, distance } }));
    assert.equal(result.ball.firstDownPercent, expected);
  }
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
  assert.equal(home.ball.percent, 75);
});

test("turnover fallback uses the end possession, not the drive team", () => {
  const result = enrichGame(game, summary({ current: { team: { id: "238" }, plays: [{
    id: "interception", sequenceNumber: "5", text: "Intercepted by Arkansas", type: { text: "Interception Return" },
    end: { team: { id: "8" }, yardsToEndzone: 65, possessionText: "ARK 35" },
  }] } }));
  assert.equal(result.ball.percent, 35);
  assert.equal(result.ball.direction, "right");
  assert.equal(result.ball.source, "last reported play");
  assert.equal(result.possessionTeamId, "8");
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
  const result = enrichGame(game, summary({ previous: [{ id: "previous", team: { id: "8", abbreviation: "ARK" }, plays }], current: {
    id: "current", team: { id: "238", abbreviation: "VAN" }, description: "1 play, 7 yards, 0:30",
    displayResult: "Punt", yards: 7, timeElapsed: { displayValue: "0:30" }, plays: [plays[6]],
  } }));
  assert.deepEqual(result.plays.map((play) => play.id), ["p6", "p5", "p4", "p3", "p2"]);
  assert.equal(result.currentDriveId, "current");
  assert.deepEqual(result.drives.map((drive) => drive.id), ["previous", "current"]);
  assert.deepEqual(result.drives[0].plays.map((play) => play.id), plays.map((play) => play.id));
  assert.deepEqual(result.drives[1].plays.map((play) => play.id), ["p6"]);
  assert.equal(result.drives[1].description, "1 play, 7 yards, 0:30");
  assert.equal(result.drives[1].result, "Punt");
});

test("drive scoring colors follow the scoring team, not a turnover's starting offense", () => {
  const frame = summary({ current: { id: "drive", team: { id: "8" }, plays: [{
    id: "pick-six", text: "Interception returned for touchdown", scoringPlay: true,
    sequenceNumber: "1", type: { text: "Interception Return Touchdown" },
    start: { team: { id: "8" } }, end: { team: { id: "238" } },
  }] } });
  frame.scoringPlays = [{ id: "pick-six", team: { id: "238" } }];
  assert.equal(enrichGame(game, frame).drives[0].plays[0].scoringTeamId, "238");
  frame.scoringPlays = [];
  assert.equal(enrichGame(game, frame).drives[0].plays[0].scoringTeamId, null);
});

test("receiving leaders can show provider-confirmed fumbles without inventing INTs", () => {
  const frame = summary();
  frame.leaders = [{ team: { id: "8" }, leaders: [{ name: "receivingYards", leaders: [{
    athlete: { id: "wr", displayName: "Example Receiver", shortName: "E. Receiver", position: { abbreviation: "WR" } },
    summary: "5 REC", displayValue: "5 REC, 70 YDS", value: 70,
  }] }] }];
  frame.boxscore = { players: [{ team: { id: "8" }, statistics: [{
    name: "fumbles", labels: ["FUM", "LOST", "REC"], athletes: [{ athlete: { id: "wr" }, stats: ["1", "0", "1"] }],
  }] }] };
  const leader = enrichGame(game, frame).leaders.find((item) => item.category === "receivingYards").leaders[0];
  assert.equal(leader.fumbles, 1);
  assert.equal(leader.interceptions, null);
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

test("period and play timestamps keep a reused overtime sequence out of the second quarter", () => {
  const result = enrichGame(game, summary({ previous: [{ plays: [
    { id: "q2", text: "Second quarter", sequenceNumber: "42", period: { number: 2 }, wallclock: "2026-10-17T23:45Z" },
    { id: "end", text: "End of OT.", sequenceNumber: "42", period: { number: 5 }, wallclock: "2026-10-18T02:35Z" },
    { id: "ot", text: "Overtime play", sequenceNumber: "158", period: { number: 5 }, wallclock: "2026-10-18T02:34Z" },
  ] }] }));
  assert.deepEqual(result.plays.map((play) => play.id), ["end", "ot", "q2"]);
});

test("timeouts and quarter breaks use the current drive's real spot, not marker placeholder yardage", () => {
  const realPlay = { id: "run", text: "Rush to VAN 35", sequenceNumber: "1", type: { text: "Rush" },
    end: { team: { id: "238" }, yardsToEndzone: 65, possessionText: "VAN 35", down: 2, distance: 6, downDistanceText: "2nd & 6 at VAN 35" } };
  for (const type of ["Timeout", "Official Timeout", "End Period", "End of Half", "End of Regulation"]) {
    const marker = { id: "pause", text: type, sequenceNumber: "2", type: { text: type },
      end: { team: { id: "8" }, yardsToEndzone: 0, down: 0, distance: 0 } };
    const result = enrichGame(game, summary({ current: { id: "drive-1", plays: [realPlay, marker] } }));
    assert.equal(result.ball.percent, 65, type);
    assert.equal(result.ball.firstDownPercent, 59);
    assert.equal(result.possessionTeamId, "238");
    assert.equal(result.fieldContext.pause, true);
    assert.equal(result.fieldContext.driveId, "drive-1");
    assert.equal(result.fieldContext.lastPlayType, type);
    assert.equal(result.fieldContext.lastPlayId, "pause");
  }
});

test("timeout fallback never crosses a touchdown, kickoff, or drive boundary", () => {
  const realPlay = { id: "run", text: "Rush", sequenceNumber: "1", type: { text: "Rush" },
    end: { team: { id: "8" }, yardsToEndzone: 50 } };
  const timeout = { id: "timeout", text: "Timeout", sequenceNumber: "3", type: { text: "Timeout" },
    end: { team: { id: "8" }, yardsToEndzone: 0 } };
  for (const barrier of [
    { id: "td", text: "Touchdown", sequenceNumber: "2", type: { text: "Passing Touchdown" }, scoringPlay: true },
    { id: "kick", text: "Kickoff", sequenceNumber: "2", type: { text: "Kickoff" } },
  ]) {
    const result = enrichGame(game, summary({ current: { plays: [realPlay, barrier, timeout] } }));
    assert.equal(result.ball, null);
  }
  const result = enrichGame(game, summary({ previous: [{ plays: [realPlay] }], current: { plays: [timeout] } }));
  assert.equal(result.ball, null);
});
