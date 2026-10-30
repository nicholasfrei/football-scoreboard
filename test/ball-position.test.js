import test from "node:test";
import assert from "node:assert/strict";
import { createBallPositionTracker } from "../public/ball-position.js";

const ball = { percent: 35, firstDownPercent: 41, possession: "Home", direction: "right", downDistance: "2nd & 6", label: "HOM 35", source: "last reported play" };
function game(overrides = {}) {
  return {
    id: "123", league: "nfl", state: "live", homeAway: "home",
    selectedTeam: { id: "1", score: 0 }, opponent: { id: "2", score: 0 },
    ball: { ...ball }, possessionTeamId: "1",
    fieldContext: { driveId: "drive-1", lastPlayId: "run", lastPlayType: "Rush", possessionTeamId: "1" },
    ...overrides,
  };
}
const payload = (spotlight, extra = {}) => ({ spotlight, ...extra });

test("halftime clears the last first-half ball and possession", () => {
  const tracker = createBallPositionTracker();
  tracker.observe(payload(game()));
  const half = tracker.observe(payload(game({ period: 2, status: "Halftime", ball: null })));
  assert.equal(half.ball, null);
  assert.equal(half.possessionTeamId, null);
  const resumed = tracker.observe(payload(game({ period: 3, status: "3rd Quarter", ball: null })));
  assert.equal(resumed.ball, null);
});

test("missing possession ID follows field direction, never the opposite team's end zone", () => {
  for (const homeAway of ["home", "away"]) {
    const homeId = homeAway === "home" ? "1" : "2";
    const awayId = homeAway === "home" ? "2" : "1";
    for (const [direction, expectedId, percent, firstDownPercent] of [
      ["right", awayId, 43, 44], ["left", homeId, 57, 56],
    ]) {
      const tracker = createBallPositionTracker();
      const initial = tracker.observe(payload(game({ homeAway, possessionTeamId: null, fieldContext: {},
        ball: { ...ball, direction, percent, firstDownPercent } })));
      assert.equal(initial.possessionTeamId, expectedId);
      assert.equal(initial.ball.firstDownPercent > initial.ball.percent, direction === "right");
      const paused = tracker.observe(payload(game({ homeAway, possessionTeamId: null, ball: null,
        fieldContext: { pause: true, lastPlayType: "Timeout" } })));
      assert.equal(paused.possessionTeamId, expectedId);
      assert.equal(paused.ball.percent, percent);
    }
  }
});

test("a confirmed Dallas possession does not inherit Philadelphia's leftward spot", () => {
  const tracker = createBallPositionTracker();
  const eagles = game({ homeAway: "away", possessionTeamId: null, fieldContext: {},
    ball: { ...ball, possession: "Philadelphia", direction: "left", percent: 57, firstDownPercent: 56, label: "DAL 43" } });
  assert.equal(tracker.observe(payload(eagles)).possessionTeamId, "2");
  const cowboys = game({ homeAway: "away", possessionTeamId: "1", ball: null,
    fieldContext: { possessionTeamId: "1", lastPlayId: "change" } });
  const result = tracker.observe(payload(cowboys));
  assert.equal(result.ball, null);
  assert.equal(result.possessionTeamId, "1");
});

test("fresh missing position preserves the confirmed ball and line to gain across repeated polls", () => {
  const tracker = createBallPositionTracker();
  const initial = game();
  const original = structuredClone(initial);
  tracker.observe(payload(initial));
  for (let index = 0; index < 5; index++) {
    const result = tracker.observe(payload(game({ ball: null, possessionTeamId: null, fieldContext: {} })));
    assert.deepEqual(result.ball, ball);
    assert.equal(result.ballHeld, true);
    assert.equal(result.possessionTeamId, "1");
  }
  assert.deepEqual(initial, original, "never mutate the raw scoreboard or cached snapshots");
});

test("timeout placeholder coordinates cannot move a confirmed ball; the next real play can", () => {
  const tracker = createBallPositionTracker();
  tracker.observe(payload(game()));
  const timeout = game({ ball: { ...ball, percent: 0, firstDownPercent: null }, fieldContext: {
    driveId: "drive-1", lastPlayId: "timeout", lastPlayType: "Official Timeout", pause: true,
  } });
  assert.deepEqual(tracker.observe(payload(timeout)).ball, ball);
  const next = game({ ball: { ...ball, percent: 48, firstDownPercent: 58 }, fieldContext: {
    driveId: "drive-1", lastPlayId: "pass", lastPlayType: "Pass Reception",
  } });
  const result = tracker.observe(payload(next));
  assert.equal(result.ball.percent, 48);
  assert.equal(result.ball.firstDownPercent, 58);
  assert.equal(result.ballHeld, false);
});

test("first load without a spot never invents one, even during a media timeout", () => {
  const tracker = createBallPositionTracker();
  const result = tracker.observe(payload(game({ ball: null, possessionTeamId: null, fieldContext: { pause: true, lastPlayType: "Timeout" } })));
  assert.equal(result.ball, null);
  assert.equal(result.possessionTeamId, null);
});

test("a temporarily missing current drive does not mistake an old scoring entry for a new touchdown", () => {
  for (const useTime of [true, false]) {
    const tracker = createBallPositionTracker();
    tracker.observe(payload(game({ fieldContext: { driveId: "drive-2", lastPlayId: "run", lastPlayType: "Rush",
      lastPlaySequence: 50, lastPlayAt: useTime ? "2026-10-25T20:30Z" : null } })));
    for (let index = 0; index < 3; index++) {
      const result = tracker.observe(payload(game({ ball: null, possessionTeamId: null, fieldContext: {
        lastPlayId: "old-td", lastPlayType: "Passing Touchdown", scoring: true,
        lastPlaySequence: 40, lastPlayAt: useTime ? "2026-10-25T20:25Z" : null,
      } })));
      assert.deepEqual(result.ball, ball);
    }
  }
});

test("new drives, confirmed possession changes, and score changes clear held positions", () => {
  for (const next of [
    game({ ball: null, possessionTeamId: null, fieldContext: { driveId: "drive-2" } }),
    game({ ball: null, possessionTeamId: "2", fieldContext: {} }),
    game({ ball: null, possessionTeamId: null, fieldContext: { possessionTeamId: "2" } }),
    game({ ball: null, possessionTeamId: null, selectedTeam: { id: "1", score: 6 } }),
  ]) {
    const tracker = createBallPositionTracker();
    tracker.observe(payload(game()));
    assert.equal(tracker.observe(payload(next)).ball, null);
    assert.equal(tracker.observe(payload(game({ ...next, ball: null }))).ball, null, "old spot cannot resurrect on a repeated poll");
  }
});

test("scoring plays clear markers even when the feed repeats pre-score situation coordinates", () => {
  const tracker = createBallPositionTracker();
  tracker.observe(payload(game()));
  const td = game({ fieldContext: { lastPlayId: "td", lastPlayType: "Passing Touchdown", scoring: true } });
  for (let index = 0; index < 2; index++) {
    const result = tracker.observe(payload(td));
    assert.equal(result.ball, null);
    assert.equal(result.possessionTeamId, null);
  }
});

test("known kicks and turnovers never reuse the old offense's unconfirmed spot", () => {
  for (const type of ["Kickoff", "Punt", "Pass Interception Return", "Fumble Recovery (Opponent)", "Field Goal Good", "Extra Point Good", "End of Game"]) {
    const tracker = createBallPositionTracker();
    tracker.observe(payload(game()));
    const result = tracker.observe(payload(game({ ball: null, possessionTeamId: null, fieldContext: { lastPlayId: "new", lastPlayType: type } })));
    assert.equal(result.ball, null, type);
  }
  const tracker = createBallPositionTracker();
  tracker.observe(payload(game()));
  const result = tracker.observe(payload(game({ ball: { ...ball, percent: 70, direction: "left" }, possessionTeamId: "2",
    fieldContext: { lastPlayId: "pick", lastPlayType: "Pass Interception Return", possessionTeamId: "2" } })));
  assert.equal(result.ball.percent, 70, "a confirmed turnover spot updates immediately");
  assert.equal(result.possessionTeamId, "2");
});

test("new football events follow game clock when a provider wallclock was revised late", () => {
  const tracker = createBallPositionTracker();
  tracker.observe(payload(game({ fieldContext: { driveId: "drive-1", lastPlayId: "late-time", lastPlayType: "Pass Incompletion",
    lastPlayPeriod: 3, lastPlayClock: "14:58", lastPlayAt: "2026-10-25T02:36:43Z" } })));
  const kickoff = game({ ball: null, possessionTeamId: null, fieldContext: { driveId: "drive-1", lastPlayId: "kick",
    lastPlayType: "Kickoff", lastPlayPeriod: 3, lastPlayClock: "14:47", lastPlayAt: "2026-10-25T01:50:21Z" } });
  assert.equal(tracker.observe(payload(kickoff)).ball, null, "new kick must clear the old spot");
});

test("games, leagues, home/away orientation, and non-live states cannot share a held spot", () => {
  for (const next of [
    game({ id: "456" }), game({ league: "college-football" }), game({ homeAway: "away" }),
    game({ state: "final" }), game({ state: "scheduled" }), game({ state: "unknown" }),
    game({ selectedTeam: { id: "3", score: 0 } }),
  ]) {
    const tracker = createBallPositionTracker();
    tracker.observe(payload(game()));
    assert.equal(tracker.observe(payload({ ...next, ball: null })).ball, null);
  }
});

test("stale feeds, summary failures, offline resets and empty schedules discard held spots", () => {
  for (const extra of [{ stale: true }, { gamecastUnavailable: true }]) {
    const tracker = createBallPositionTracker();
    tracker.observe(payload(game()));
    assert.equal(tracker.observe(payload(game(), extra)).ball, null);
    assert.equal(tracker.observe(payload(game({ ball: null }))).ball, null);
  }
  const tracker = createBallPositionTracker();
  tracker.observe(payload(game()));
  tracker.reset();
  assert.equal(tracker.observe(payload(game({ ball: null }))).ball, null);
  tracker.observe(payload(game()));
  assert.equal(tracker.observe(payload(null)), null);
  assert.equal(tracker.observe(payload(game({ ball: null }))).ball, null);
});
