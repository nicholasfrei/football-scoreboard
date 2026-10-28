import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { driveStats } from "../src/drive-stats.js";
import { driveSummaryLabel } from "../public/drive-summary.js";
import { createReplayFrames, REPLAY_GAMES } from "../src/replay.js";

const away = { id: "A", abbreviation: "AWY" };
const home = { id: "H", abbreviation: "HME" };
const spot = (yardsToEndzone, id = "A") => ({ team: { id }, down: 1, yardsToEndzone });
const drive = { team: { id: "A" }, start: { text: "AWY 25", period: { number: 1 }, clock: { displayValue: "15:00" } } };
function play(type, clock, start = 75, end = 69, extra = {}) {
  return { type: { text: type }, text: "", start: spot(start), end: spot(end),
    period: { number: 1 }, clock: { displayValue: clock }, ...extra };
}

test("running drive totals count offensive snaps rather than every feed event", () => {
  const plays = [play("Kickoff", "15:00", 65, 75, { start: spot(65, "H") }),
    play("Rush", "14:55"), play("Pass Incompletion", "14:30", 69, 69),
    play("Timeout", "14:30", 0, 0)];
  assert.deepEqual(driveStats(drive, plays.slice(0, 1), home, away, "nfl"), { playCount: 0, yards: 0, time: "0:00" });
  assert.deepEqual(driveStats(drive, plays.slice(0, 2), home, away, "nfl"), { playCount: 1, yards: 6, time: "0:05" });
  assert.deepEqual(driveStats(drive, plays, home, away, "nfl"), { playCount: 2, yards: 6, time: "0:30" });
});

test("kick distance, defensive returns, and no-play fouls do not inflate offensive gains", () => {
  const rush = play("Rush", "14:55");
  const punt = play("Punt", "14:30", 69, 20, { end: spot(20, "H"), statYardage: 49 });
  assert.deepEqual(driveStats(drive, [rush, punt], home, away, "nfl"), { playCount: 2, yards: 6, time: "0:30" });
  assert.equal(driveStats(drive, [rush, punt], home, away, "college-football").playCount, 1);
  const interception = play("Pass Interception Return", "14:30", 69, 20, { end: spot(20, "H"), statYardage: 49 });
  assert.equal(driveStats(drive, [rush, interception], home, away, "nfl").yards, 6);
  const penalty = play("Penalty", "14:20", 69, 74, { text: "False start, 5 yards. NO PLAY", isPenalty: true,
    penalty: { status: { slug: "accepted" }, type: { text: "False Start" }, yards: 5 } });
  const stats = driveStats(drive, [rush, penalty], home, away, "nfl");
  assert.equal(stats.playCount, 1);
  assert.equal(stats.yards, 1, "the enforced five-yard loss still affects net drive yardage");
});

test("home-team direction, negative gains, and crossing a quarter use football coordinates and clocks", () => {
  const homeDrive = { team: { id: "H" }, start: { text: "HME 25", period: { number: 1 }, clock: { displayValue: "0:30" } } };
  const gain = play("Rush", "0:15", 75, 65, { start: spot(75, "H"), end: spot(65, "H") });
  assert.deepEqual(driveStats(homeDrive, [gain], home, away, "nfl"), { playCount: 1, yards: 10, time: "0:15" });
  const loss = play("Sack", "14:40", 65, 72, { start: spot(65, "H"), end: spot(72, "H"), period: { number: 2 } });
  assert.deepEqual(driveStats(homeDrive, [gain, loss], home, away, "nfl"), { playCount: 2, yards: 3, time: "0:50" });
  assert.equal(driveStats(drive, [play("Sack", "14:20", 75, 82)], home, away, "nfl").yards, -7);
});

test("provider totals take priority while missing/untimed values stay visibly unavailable", () => {
  const reported = { ...drive, offensivePlays: 7, yards: 28, timeElapsed: { displayValue: "2:30" } };
  assert.deepEqual(driveStats(reported, [play("Rush", "14:55")], home, away, "nfl"), { playCount: 7, yards: 28, time: "2:30" });
  assert.equal(driveSummaryLabel(driveStats({ ...drive, description: "7 plays, 28 yards, 2:30" }, [], home, away, "nfl")), "7 plays, 28 yards, 2:30");
  const overtime = { ...drive, start: { ...drive.start, period: { number: 5 }, clock: { displayValue: "0:00" } } };
  assert.equal(driveStats(overtime, [play("Rush", "0:00", 75, 69, { period: { number: 5 } })], home, away, "college-football").time, null);
  assert.equal(driveSummaryLabel({ playCount: 1, yards: -1, time: null }), "1 play, -1 yard, —:—");
  assert.equal(driveSummaryLabel({ playCount: 0, yards: null, time: "0:00" }), "0 plays, — yards, 0:00");
  assert.equal(driveSummaryLabel(null), "");
});

test("Cowboys opening drive updates each play and reaches 7 plays, 28 yards, 2:30 without future totals", async () => {
  const option = REPLAY_GAMES.nfl;
  const summary = JSON.parse(gunzipSync(await readFile(new URL(`fixtures/games/${option.file}`, import.meta.url))));
  const frames = createReplayFrames(summary, option);
  const expected = [
    "0 plays, 0 yards, 0:00", "1 play, 6 yards, 0:05", "2 plays, 11 yards, 0:38",
    "3 plays, 26 yards, 1:16", "4 plays, 26 yards, 1:36", "5 plays, 28 yards, 1:41",
    "6 plays, 28 yards, 2:22", "7 plays, 28 yards, 2:30", "7 plays, 28 yards, 2:30",
  ];
  for (const [index, label] of expected.entries()) {
    assert.equal(driveSummaryLabel(frames[index].spotlight.drives[0]), label, frames[index].caption);
  }
  assert.equal(frames[0].spotlight.drives[0].description, null, "the final provider description stays hidden until completion");
});

test("college opening drive updates throughout and does not count a punt as an offensive play", async () => {
  const option = REPLAY_GAMES.college;
  const summary = JSON.parse(gunzipSync(await readFile(new URL(`fixtures/games/${option.file}`, import.meta.url))));
  const frames = createReplayFrames(summary, option);
  assert.equal(driveSummaryLabel(frames[1].spotlight.drives[0]), "1 play, 0 yards, 0:06");
  assert.equal(driveSummaryLabel(frames[3].spotlight.drives[0]), "3 plays, 0 yards, 0:33");
  assert.equal(driveSummaryLabel(frames[4].spotlight.drives[0]), "3 plays, 0 yards, 0:42");
});
