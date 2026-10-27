import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { normalizeGame } from "../src/scoreboard.js";
import { enrichGame } from "../src/gamecast.js";
import { createHighlightTracker } from "../public/highlights.js";

const summary = JSON.parse(gunzipSync(await readFile(new URL("./fixtures/games/college-football/401856732.json.gz", import.meta.url))));
const drives = [...summary.drives.previous, summary.drives.current].filter(Boolean);
// For this Q4 prefix, clocks establish the timeout (1:25) before the FG (1:22),
// even though ESPN stores them in the reverse array order. Do not derive the
// test's visible-play boundary from the production comparator under test elsewhere.
const seconds = (play) => play.clock.displayValue.split(":").reduce((minutes, value) => minutes * 60 + Number(value), 0);
const plays = [...new Map(drives.flatMap((drive) => drive.plays).map((play) => [play.id, play])).values()]
  .sort((a, b) => a.period.number - b.period.number || seconds(b) - seconds(a));
const competition = summary.header.competitions[0];
const base = normalizeGame({ id: summary.header.id, date: competition.date, competitions: [competition] },
  { league: "college-football", teamId: "145" });
const timeoutId = "401856732856";
const fieldGoalId = "401856732854";
const now = Date.parse(plays.find((play) => play.id === fieldGoalId).wallclock);

function prefix(id) {
  const index = plays.findIndex((play) => play.id === id);
  assert.ok(index >= 0);
  const visible = new Set(plays.slice(0, index + 1).map((play) => play.id));
  const current = drives.find((drive) => drive.plays.some((play) => play.id === id));
  const trim = (drive) => ({ ...drive, plays: drive.plays.filter((play) => visible.has(play.id)) });
  return enrichGame(base, {
    header: { ...summary.header, competitions: [{ ...competition,
      status: { period: 4, displayClock: "1:22", type: { state: "in", completed: false } },
    }] },
    gameInfo: summary.gameInfo,
    scoringPlays: summary.scoringPlays.filter((play) => visible.has(play.id)),
    drives: { previous: drives.filter((drive) => drive !== current).map(trim).filter((drive) => drive.plays.length), current: trim(current) },
  });
}

test("the actual timeout/FG prefixes emit a distinct field goal with a reused sequence", () => {
  const tracker = createHighlightTracker();
  const before = prefix(timeoutId);
  const after = prefix(fieldGoalId);
  assert.equal(before.fieldContext.lastPlayId, timeoutId);
  assert.equal(after.fieldContext.lastPlayId, fieldGoalId);
  assert.equal(before.latestPlaySequence, 192);
  assert.equal(after.highlights.find((item) => item.id === fieldGoalId).sequence, 192);
  assert.equal(tracker.observe({ spotlight: before }, now - 15_000), null);
  assert.equal(tracker.observe({ spotlight: after }, now)?.id, fieldGoalId);
  assert.equal(tracker.observe({ spotlight: after }, now + 15_000), null);
});

function event(id, sequence, occurredAt = new Date(now).toISOString()) {
  return { id, sequence, kind: "field-goal", occurredAt };
}
function payload(order, highlights = [], overrides = {}) {
  return { spotlight: { id: "game", league: "college-football", state: "live",
    latestPlaySequence: Math.max(0, ...highlights.map((item) => item.sequence)),
    latestPlayOrder: order, highlights, ...overrides } };
}

test("a sequence reset still emits a distinct appended play without wallclock metadata", () => {
  const tracker = createHighlightTracker();
  tracker.observe(payload(["old"], [event("old", 192, null)]), now - 15_000);
  assert.equal(tracker.observe(payload(["old", "new"], [event("old", 192, null), event("new", 1, null)]), now)?.id, "new");
});

test("batch newest follows ordered play IDs, not event array order or numeric sequence", () => {
  const tracker = createHighlightTracker();
  tracker.observe(payload(["timeout"]), now - 15_000);
  assert.equal(tracker.observe(payload(["timeout", "first", "last"], [event("last", 1), event("first", 192)]), now)?.id, "last");
  assert.equal(tracker.observe(payload(["timeout", "first", "last"], [event("first", 999), event("last", 1000)]), now + 15_000), null);
});

test("ordered context rejects fresh and timestamp-less backfills while allowing timestamp-less appended plays", () => {
  const tracker = createHighlightTracker();
  tracker.observe(payload(["latest"]), now - 15_000);
  assert.equal(tracker.observe(payload(["old", "older", "latest"], [event("old", 500), event("older", 501, null)]), now), null);
  assert.equal(tracker.observe(payload(["old", "older", "latest", "new"], [event("new", 1, null)]), now + 15_000)?.id, "new");
});

test("newly classified known plays and sequence inflation cannot manufacture new alerts", () => {
  const tracker = createHighlightTracker();
  tracker.observe(payload(["known"]), now - 15_000);
  assert.equal(tracker.observe(payload(["known", "timeout"], [event("known", 999)]), now), null);
  assert.equal(tracker.observe(payload(["known", "timeout", "new"], [event("new", 1)]), now + 15_000)?.id, "new");
  assert.equal(tracker.observe(payload(["known", "timeout", "new"], [event("new", 1001)]), now + 30_000), null);
});

test("ordered identity preserves silent baselines, age checks, game switches, and missing-context safety", () => {
  for (const interruption of [null, { stale: true }, { gamecastUnavailable: true }]) {
    const tracker = createHighlightTracker();
    tracker.observe(payload(["start"]), now - 30_000);
    tracker.observe(interruption, now - 15_000);
    assert.equal(tracker.observe(payload(["start", "new"], [event("new", 1)]), now), null);
  }
  const tracker = createHighlightTracker();
  assert.equal(tracker.observe(payload(["first"], [event("first", 192)]), now), null);
  assert.equal(tracker.observe(payload(["first", "gap"], [event("gap", 1)]), now + 100_000), null);
  assert.equal(tracker.observe(payload(["first", "gap", "old"], [event("old", 2, new Date(now - 180_000).toISOString())]), now + 115_000), null);
  assert.equal(tracker.observe(payload(["unrelated"], [event("unrelated", 999)]), now + 130_000), null);
  assert.equal(tracker.observe(payload(["unrelated", "switch"], [event("switch", 1000)], { id: "other" }), now + 145_000), null);
});

test("empty ordered pregame baselines allow the first live play", () => {
  const tracker = createHighlightTracker();
  tracker.observe(payload([], [], { state: "scheduled" }), now - 15_000);
  assert.equal(tracker.observe(payload(["first"], [event("first", 1)]), now)?.id, "first");
});
