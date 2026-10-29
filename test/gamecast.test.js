import test from "node:test";
import assert from "node:assert/strict";
import { enrichGame } from "../src/gamecast.js";
import { getScoreboard } from "../src/espn.js";
import { illustratedDrive } from "../public/drive-illustration.js";

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

test("accepted penalty yardage reaches the drive illustration, but declined and bundled plays do not", () => {
  const spot = (label) => ({ team: { id: "8" }, possessionText: `ARK ${label}`, down: 1 });
  const foul = { id: "flag", sequenceNumber: "1", type: { text: "Penalty" },
    text: "PENALTY ARK False Start 5 yards. NO PLAY", start: spot(25), end: spot(20),
    penalty: { status: { slug: "accepted" }, type: { text: "False Start" }, yards: 5 } };
  const drive = (play) => enrichGame(game, summary({ current: { id: "drive", team: { id: "8" }, plays: [play] } })).drives.at(-1);
  const motion = drive(foul).plays[0].penaltyMotion;
  assert.deepEqual(motion, { start: 25, end: 20 });
  const chart = illustratedDrive({ ...drive(foul), direction: "right" });
  assert.deepEqual(chart.penaltyPaths, [`M ${104 + 25 * 7.92} 220 L ${104 + 20 * 7.92} 220`]);
  assert.equal(chart.finalMarker.x, 104 + 20 * 7.92);
  const homeFoul = { ...foul, start: { team: { id: "238" }, possessionText: "VAN 25", down: 1 },
    end: { team: { id: "238" }, possessionText: "VAN 20", down: 1 } };
  const homeDrive = enrichGame(game, summary({ current: { id: "home-drive", team: { id: "238" }, plays: [homeFoul] } })).drives.at(-1);
  assert.deepEqual(homeDrive.plays[0].penaltyMotion, { start: 75, end: 80 });
  assert.equal(illustratedDrive({ ...homeDrive, direction: "left" }).finalMarker.x, 104 + 80 * 7.92);
  const following = { id: "rush", sequenceNumber: "2", type: { text: "Rush" }, text: "Rush for 5",
    start: spot(20), end: spot(25) };
  const later = enrichGame(game, summary({ current: { id: "drive", team: { id: "8" }, plays: [foul, following] } })).drives.at(-1);
  const laterChart = illustratedDrive({ ...later, direction: "right" });
  assert.deepEqual(laterChart.penaltyPaths, [], "the next play replaces the yellow line with solid progress");
  assert.equal(laterChart.progressPath, `M ${104 + 25 * 7.92} 220 L ${104 + 20 * 7.92} 220`);
  const between = illustratedDrive({ ...drive(foul), direction: "right", plays: [...drive(foul).plays,
    { id: "timeout", type: "Timeout", snapPercent: null }] });
  assert.deepEqual(between.penaltyPaths, [], "a later non-snap event also ends the current penalty display");
  assert.equal(between.progressPath, `M ${104 + 25 * 7.92} 220 L ${104 + 20 * 7.92} 220`);
  assert.equal(drive({ ...foul, penalty: { ...foul.penalty, status: { slug: "declined" } } }).plays[0].penaltyMotion, null);
  assert.equal(drive({ ...foul, type: { text: "Rush" }, text: "Rush for 5, penalty enforced" }).plays[0].penaltyMotion, null);
  assert.equal(drive({ ...foul, end: spot(25) }).plays[0].penaltyMotion, null);
});

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

test("kick touchbacks and fair catches use the receiving team's correct spot", () => {
  for (const arkHome of [false, true]) {
    const expected = (yards) => arkHome ? 100 - yards : yards;
    for (const [league, type, text, endSpot, yards] of [
      ["college-football", "Kickoff", "Kickoff, Touchback", null, 25],
      ["college-football", "Punt", "Punt, Touchback", null, 20],
      ["nfl", "Punt", "Punt, Touchback", null, 20],
      ["nfl", "Kickoff", "Kickoff lands in the end zone, Touchback", null, 35],
      ["nfl", "Kickoff", "Kickoff bounces into the end zone, Touchback", null, 20],
      ["nfl", "Kickoff", "Kickoff, Touchback", "ARK 35", 35],
      ["nfl", "Kickoff", "Kickoff fair catch at ARK04", null, 4],
      ["college-football", "Kickoff", "Kickoff fair catch at ARK04", null, 25],
      ["college-football", "Kickoff", "Kickoff fair catch at ARK24", null, 25],
      ["college-football", "Kickoff", "Kickoff fair catch at ARK23", "ARK 33", 25],
      ["college-football", "Kickoff", "Kickoff fair catch at ARK26", null, 26],
      ["college-football", "Punt", "Punt fair catch at ARK17", null, 17],
      ["nfl", "Punt", "Punt fair catch at ARK17", null, 17],
    ]) {
      const kick = { id: "kick", sequenceNumber: "1", type: { text: type }, text,
        start: { team: { id: "238" } }, end: { team: { id: "8" }, possessionText: endSpot, down: 1, distance: 10 } };
      const frame = summary({ arkHome, current: { id: "drive", team: { id: "238" }, plays: [kick] } });
      frame.header.season = { year: 2026 };
      const result = enrichGame({ ...game, league }, frame);
      assert.equal(result.ball?.percent, expected(yards), `${league}: ${text}`);
      assert.equal(result.ball?.label, `ARK ${yards}`);
      assert.equal(result.possessionTeamId, "8");
      assert.equal(result.ball.direction, arkHome ? "left" : "right");
      assert.equal(result.ball.firstDownPercent, expected(yards) + (arkHome ? -10 : 10), `${league}: ${text}, arkHome=${arkHome}`);
    }
  }
});

test("interception touchbacks start the confirmed receiving team at its own 20", () => {
  for (const league of ["nfl", "college-football"]) {
    for (const arkHome of [false, true]) {
      const pick = { id: "touchback", sequenceNumber: "1", type: { text: "Interception" },
        text: "Pass intercepted by the defense at ARK 0, Touchback",
        start: { team: { id: "238" } }, end: { team: { id: "8" },
          possessionText: "ARK 0", down: 1, distance: 10, yardsToEndzone: 100 } };
      const frame = summary({ arkHome, current: { id: "drive", team: { id: "238" }, plays: [pick] } });
      const result = enrichGame({ ...game, league }, frame);
      assert.equal(result.ball?.label, "ARK 20");
      assert.equal(result.ball?.percent, arkHome ? 80 : 20);
      assert.equal(result.ball?.source, "touchback rule");
      assert.equal(result.possessionTeamId, "8");
      frame.situation = { possession: "8", possessionText: "ARK 25", down: 1, distance: 10 };
      assert.equal(enrichGame({ ...game, league }, frame).ball?.label, "ARK 25", "live situation still wins");
    }
  }
});

test("kick fallback defers to the live situation and avoids uncertain or penalized plays", () => {
  const kick = { id: "kick", sequenceNumber: "1", type: { text: "Kickoff" }, text: "Kickoff, Touchback",
    start: { team: { id: "238" } }, end: { team: { id: "8" } } };
  const options = { current: { id: "drive", plays: [kick] } };
  assert.equal(enrichGame({ ...game, league: "nfl" }, summary(options)).ball, null, "unknown NFL landing is not guessed");
  assert.equal(enrichGame({ ...game, league: "nfl" }, summary({ current: { id: "drive", plays: [{ ...kick,
    text: "Kickoff lands in the end zone, Touchback" }] } })).ball, null, "unknown season is not guessed");
  const midfield = summary({ current: { id: "drive", plays: [{ ...kick, text: "Kickoff lands in the end zone, Touchback",
    start: { ...kick.start, yardsToEndzone: 50 } }] } });
  midfield.header.season = { year: 2026 };
  assert.equal(enrichGame({ ...game, league: "nfl" }, midfield).ball?.label, "ARK 20");
  assert.equal(enrichGame(game, summary({ ...options, situation: { possession: "8", possessionText: "ARK 40" } })).ball.label, "ARK 40");
  for (const text of ["Kickoff, Touchback PENALTY ARK holding", "Kickoff, Touchback, no play", "Kickoff, muff and fumble, Touchback"]) {
    assert.equal(enrichGame(game, summary({ current: { id: "drive", plays: [{ ...kick, text }] } })).ball, null, text);
  }
  assert.equal(enrichGame(game, summary({ current: { id: "drive", plays: [{ ...kick, start: {}, end: {} }] } })).ball, null);
  assert.equal(enrichGame(game, summary({ current: { id: "drive", plays: [{ ...kick, end: { team: { id: "238" } } }] } })).ball, null);
});

test("a straightforward missed college field goal can use the previous spot when the result spot is missing", () => {
  for (const [arkHome, label, expectedLabel, percent] of [
    [false, "VAN 35", "VAN 35", 65], [false, "VAN 8", "VAN 20", 80],
    [true, "VAN 35", "VAN 35", 35], [true, "VAN 8", "VAN 20", 20],
  ]) {
    const kick = { id: "miss", sequenceNumber: "1", type: { text: "Field Goal Missed" },
      text: "Field goal is no good, wide right", start: { team: { id: "8" }, possessionText: label }, end: {} };
    const result = enrichGame(game, summary({ arkHome, current: { id: "drive", plays: [kick] } }));
    assert.equal(result.ball?.label, expectedLabel);
    assert.equal(result.ball?.percent, percent);
    assert.equal(result.possessionTeamId, "238");
    assert.equal(result.ball.firstDownPercent, null, "do not invent down/distance");
  }
});

test("missed and blocked kicks do not invent a spot when their outcome is ambiguous", () => {
  const kick = { id: "kick", sequenceNumber: "1", type: { text: "Field Goal Missed" },
    text: "Field goal is no good, wide right", start: { team: { id: "8" }, possessionText: "VAN 35" }, end: {} };
  for (const variant of [
    { ...kick, type: { text: "Blocked Field Goal" }, text: "Field goal blocked" },
    { ...kick, text: "Field goal is no good, returned 30 yards" },
    { ...kick, text: "Field goal is no good, PENALTY defensive offside" },
    { ...kick, text: "Field goal is no good, short" },
    { ...kick, start: { possessionText: "VAN 35" } },
  ]) assert.equal(enrichGame(game, summary({ current: { id: "drive", plays: [variant] } })).ball, null);
  assert.equal(enrichGame({ ...game, league: "nfl" }, summary({ current: { id: "drive", plays: [kick] } })).ball, null,
    "NFL kick spot is not inferred from the line of scrimmage");
  const withSituation = summary({ situation: { possession: "238", possessionText: "VAN 10" }, current: { id: "drive", plays: [kick] } });
  assert.equal(enrichGame(game, withSituation).ball.label, "VAN 10", "confirmed situation wins");
});

test("NFL field goal miss uses a reported kick distance, not the line of scrimmage", () => {
  for (const [arkHome, start, distance, expected] of [
    [false, "VAN 35", 53, "VAN 43"], [false, "VAN 8", 26, "VAN 20"],
    [false, "VAN 45", 63, "ARK 47"], [true, "VAN 35", 53, "VAN 43"],
  ]) {
    const kick = { id: "kick", sequenceNumber: "1", type: { text: "Field Goal Missed" },
      text: `${distance} yard field goal is No Good, Wide Right`,
      start: { team: { id: "8" }, possessionText: start },
      end: { team: { id: "238" }, possessionText: start, down: 1, distance: 10 } };
    assert.equal(enrichGame({ ...game, league: "nfl" }, summary({ arkHome, current: { id: "drive", plays: [kick] } })).ball?.label, expected);
    const reported = { ...kick, end: { ...kick.end, possessionText: "VAN 30" } };
    assert.equal(enrichGame({ ...game, league: "nfl" }, summary({ arkHome, current: { id: "drive", plays: [reported] } })).ball?.label, "VAN 30",
      "a different reported end spot takes precedence");
  }
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

test("periods and terminal markers keep a reused overtime sequence out of the second quarter", () => {
  const result = enrichGame(game, summary({ previous: [{ plays: [
    { id: "q2", text: "Second quarter", sequenceNumber: "42", period: { number: 2 }, wallclock: "2026-10-17T23:45Z" },
    { id: "end", text: "End of OT.", type: { text: "End of Game" }, sequenceNumber: "42", period: { number: 5 }, wallclock: "2026-10-18T02:35Z" },
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
