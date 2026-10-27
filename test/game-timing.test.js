import test from "node:test";
import assert from "node:assert/strict";
import { kickoffCountdown, needsRapidRefresh, nextRefreshDelay, createRefreshLoop } from "../public/game-timing.js";
import { createScoreboardCache } from "../src/scoreboard-cache.js";

const kickoff = Date.parse("2026-10-31T23:45:00Z");
const game = { state: "scheduled", kickoffAt: new Date(kickoff).toISOString() };
const payload = (spotlight = game, nextGame = null) => ({ spotlight, nextGame });

test("countdown starts at exactly 24 hours, ticks in HH:MM:SS, and clamps at zero", () => {
  for (const [remaining, expected] of [
    [86_400_001, null], [86_400_000, "24:00:00"], [86_399_000, "23:59:59"],
    [3_661_000, "01:01:01"], [60_000, "00:01:00"], [1, "00:00:01"],
    [0, "00:00:00"], [-600_000, "00:00:00"],
  ]) assert.equal(kickoffCountdown(game, kickoff - remaining), expected);
});

test("only confirmed, scheduled kickoffs get countdowns; live/final/exceptional/TBD dates do not", () => {
  for (const value of [null, { ...game, timeTbd: true }, { ...game, kickoffAt: null },
    { ...game, kickoffAt: "bad date" }, ...["live", "final", "unknown"].map((state) => ({ ...game, state }))]) {
    assert.equal(kickoffCountdown(value, kickoff - 1000), null);
  }
});

test("rapid refresh starts five minutes before kickoff, including a next game behind a final", () => {
  assert.equal(needsRapidRefresh(payload(), kickoff - 300_001), false);
  assert.equal(needsRapidRefresh(payload(), kickoff - 300_000), true);
  assert.equal(nextRefreshDelay(payload(), kickoff - 301_000), 1000);
  assert.equal(nextRefreshDelay(payload(), kickoff - 300_000), 15_000);
  assert.equal(nextRefreshDelay(payload({ state: "final" }, game), kickoff - 1), 15_000);
  assert.equal(nextRefreshDelay(payload(), kickoff + 3_600_000), 15_000, "overdue pregame keeps checking until provider confirms play");
  assert.equal(nextRefreshDelay(payload(), kickoff - 86_401_000), 1000, "wake at the 24-hour display boundary");
});

test("all live periods and temporary delays stay fast; finals, canceled games and TBD stay normal", () => {
  for (const period of [1, 2, 3, 4, 5, 6, 8]) {
    assert.equal(nextRefreshDelay(payload({ ...game, state: "live", period }), kickoff + 24 * 3_600_000), 15_000);
  }
  for (const status of ["Halftime", "End of 3rd Quarter"]) {
    assert.equal(nextRefreshDelay(payload({ ...game, state: "live", status }), kickoff), 15_000);
  }
  for (const status of ["Delayed", "Suspended"]) {
    assert.equal(nextRefreshDelay(payload({ ...game, state: "unknown", status }), kickoff), 15_000);
  }
  for (const value of [null, { ...game, state: "final" }, { ...game, timeTbd: true },
    { ...game, state: "unknown", status: "Postponed" }, { ...game, state: "unknown", status: "Canceled" }]) {
     assert.equal(nextRefreshDelay(payload(value), kickoff), 300_000);
  }
});

test("polling is start-to-start, shares manual refreshes, retries failures, and stops cleanly", async () => {
  let now = kickoff - 300_000;
  let scheduled;
  let cleared;
  let calls = 0;
  let complete;
  let current = payload();
  const loop = createRefreshLoop({
    now: () => now, getPayload: () => current,
    setTimer: (fn, delay) => { scheduled = { fn, delay }; return 42; },
    clearTimer: (id) => { cleared = id; },
    refresh: async () => { calls++; await new Promise((resolve) => { complete = resolve; }); },
  });
  const first = loop.start();
  await Promise.resolve();
  assert.equal(loop.refreshNow(), first);
  assert.equal(calls, 1);
  now += 2000;
  complete();
  await first;
  assert.equal(scheduled.delay, 13_000, "request duration does not add to the 15-second interval");
  now += 13_000;
  const second = scheduled.fn();
  await Promise.resolve();
  assert.equal(calls, 2);
  // An outage that leaves the last payload unchanged must preserve rapid polling.
  complete();
  await second;
  assert.equal(scheduled.delay, 15_000);
  current = payload({ ...game, state: "final" });
  const final = loop.refreshNow();
  await Promise.resolve();
  complete();
  await final;
   assert.equal(scheduled.delay, 300_000);
  loop.stop();
  assert.equal(cleared, 42);
});

test("server bypasses cached results during rapid polling and preserves stale data on errors", async () => {
  let now = kickoff - 330_000;
  let calls = 0;
  let fail = false;
  const load = createScoreboardCache(async () => {
    calls++;
    if (fail) throw new Error("ESPN offline");
    return payload();
  }, { now: () => now });
  await load();
  now += 15_000;
  await load();
  assert.equal(calls, 1, "normal requests share the 20-second cache");
  now += 15_000;
  await load();
  now += 15_000;
  await load();
  assert.equal(calls, 3, "each pregame poll fetches new upstream data");
  fail = true;
  now += 15_000;
  const stale = await load();
  assert.equal(calls, 4);
  assert.equal(stale.stale, true);
  assert.equal(stale.warning, "ESPN offline");
});

test("server cache expires at the countdown boundary and deduplicates concurrent upstream work", async () => {
  let now = kickoff - 86_401_000;
  let calls = 0;
  const load = createScoreboardCache(async () => { calls++; return payload(); }, { now: () => now });
  await Promise.all([load(), load(), load()]);
  assert.equal(calls, 1);
  now += 1000;
  await load();
  assert.equal(calls, 2);
  const offline = createScoreboardCache(async () => { throw new Error("No feed"); });
  await assert.rejects(offline(), /No feed/);
});

test("a rejected refresh schedules a retry and stopping an in-flight request prevents rescheduling", async () => {
  let delay;
  let finish;
  let fail = true;
  const loop = createRefreshLoop({
    now: () => kickoff,
    getPayload: () => payload({ ...game, state: "live" }),
    setTimer: (_, value) => { delay = value; }, clearTimer: () => {},
    refresh: async () => {
      if (fail) throw new Error("Network unavailable");
      await new Promise((resolve) => { finish = resolve; });
    },
  });
  await assert.rejects(loop.start(), /Network unavailable/);
  assert.equal(delay, 15_000);
  fail = false;
  delay = undefined;
  const pending = loop.refreshNow();
  await Promise.resolve();
  loop.stop();
  finish();
  await pending;
  assert.equal(delay, undefined);
});
