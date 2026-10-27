import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createReplayFrames } from "../src/replay.js";
import { createBallPositionTracker } from "../public/ball-position.js";
import { normalizeGame } from "../src/scoreboard.js";
import { enrichGame } from "../src/gamecast.js";

test("a two-minute warning cannot move the ball from the last actual play", async () => {
  const summary = JSON.parse(gunzipSync(await readFile(new URL("fixtures/games/nfl/401873012.json.gz", import.meta.url))));
  const competition = summary.header.competitions[0];
  const drive = [...summary.drives.previous, summary.drives.current]
    .find((item) => item?.plays?.some((play) => play.id === "4018730121636"));
  const pass = drive.plays.find((play) => play.id === "4018730121623");
  const warning = drive.plays.find((play) => play.id === "4018730121636");
  const next = drive.plays.find((play) => play.id === "4018730121648");
  assert.equal(pass.end.possessionText, "CIN 33");
  assert.equal(warning.end.possessionText, "CIN 34");
  assert.equal(next.start.possessionText, "CIN 33");
  const base = normalizeGame({ id: summary.header.id, date: competition.date, competitions: [competition] },
    { league: "nfl", teamId: "4" });
  const frame = (plays) => ({
    header: { ...summary.header, competitions: [{ ...competition,
      status: { period: 2, displayClock: plays.at(-1).clock.displayValue, type: { state: "in", completed: false } },
    }] },
    drives: { current: { ...drive, plays }, previous: [] },
    scoringPlays: [],
  });
  const tracker = createBallPositionTracker();
  const before = tracker.observe({ spotlight: enrichGame(base, frame([pass])) });
  const after = tracker.observe({ spotlight: enrichGame(base, frame([pass, warning])) });
  assert.equal(before.ball?.label, "CIN 33");
  assert.equal(after.fieldContext.pause, true);
  assert.equal(after.ball?.label, "CIN 33");
  assert.equal(after.ballHeld, true);
});

test("an overtime timeout misattached to an old drive cannot resurrect its second-quarter punt spot", async () => {
  const summary = JSON.parse(gunzipSync(await readFile(new URL("fixtures/games/college-football/401858496.json.gz", import.meta.url))));
  const frames = createReplayFrames(summary, { id: "401858496", league: "college-football", teamId: "84" });
  const index = frames.findIndex((frame) => frame.spotlight.fieldContext.lastPlayId === "401858496688");
  assert.ok(index > 0);
  assert.equal(frames[index - 1].spotlight.fieldContext.lastPlayId, "401858496678", "the immediately preceding football event was the OT touchdown");
  const game = frames[index].spotlight;
  assert.equal(game.period, 5);
  assert.equal(game.fieldContext.pause, true);
  assert.equal(game.ball, null, "the latest actual play in the misattached current drive is an old Q2 punt, not an OT position");
  const tracker = createBallPositionTracker();
  tracker.observe(frames[index - 1]);
  assert.equal(tracker.observe(frames[index]).ball, null);
});

const confirmedBall = { percent: 35, direction: "right", firstDownPercent: 45, label: "AWY 35" };
function orderedFrame(id, clock, order, overrides = {}) {
  return { spotlight: {
    id: "order-test", league: "college-football", state: "live", homeAway: "away",
    selectedTeam: { id: "1", score: 0 }, opponent: { id: "2", score: 0 },
    ball: confirmedBall, possessionTeamId: "1", latestPlayOrder: order,
    ...overrides,
    fieldContext: { driveId: "drive", lastPlayId: id, lastPlayPeriod: 5,
      lastPlayClock: clock, lastPlayType: "Rush", ...overrides.fieldContext },
  } };
}

test("the browser follows confirmed play order when a later timeout restores the clock", () => {
  const tracker = createBallPositionTracker();
  tracker.observe(orderedFrame("run", "0:00", ["run"]));
  const pause = orderedFrame("pause", "15:00", ["run", "pause"], {
    ball: { ...confirmedBall, percent: 0 }, fieldContext: { pause: true, lastPlayType: "Timeout" },
  });
  assert.deepEqual(tracker.observe(pause).ball, confirmedBall, "an increasing clock cannot turn a new timeout's placeholder into a confirmed spot");
});

test("the browser still clears a new score when corrected clocks increase", () => {
  const tracker = createBallPositionTracker();
  tracker.observe(orderedFrame("run", "1:37", ["run"]));
  const score = orderedFrame("td", "1:38", ["run", "td"], {
    selectedTeam: { id: "1", score: 6 },
    fieldContext: { lastPlayType: "Rushing Touchdown", scoring: true },
  });
  assert.equal(tracker.observe(score).ball, null, "ordered touchdown must clear a repeated pre-score situation spot");
});

test("a shortened drive-gap payload uses retained order to recognize an older score", () => {
  const tracker = createBallPositionTracker();
  tracker.observe(orderedFrame("pause", "15:00", ["old-td", "run", "pause"], {
    fieldContext: { pause: true, lastPlayType: "Timeout" },
  }));
  const gap = orderedFrame("old-td", "0:00", ["old-td"], {
    ball: null, possessionTeamId: null,
    fieldContext: { driveId: null, lastPlayType: "Rushing Touchdown", scoring: true },
  });
  for (let poll = 0; poll < 3; poll++) assert.deepEqual(tracker.observe(gap).ball, confirmedBall);
});
