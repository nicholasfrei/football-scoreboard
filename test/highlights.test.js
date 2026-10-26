import test from "node:test";
import assert from "node:assert/strict";
import { gameHighlights } from "../src/highlights.js";
import { createHighlightTracker } from "../public/highlights.js";

const now = Date.parse("2026-10-31T23:55:00Z");
function play(overrides = {}) {
  return {
    id: "p1", sequenceNumber: "10", type: { text: "Passing Touchdown" },
    scoringPlay: true, start: { team: { id: "8" } }, end: { team: { id: "8" } },
    text: "Pass complete for a touchdown", wallclock: new Date(now).toISOString(),
    ...overrides,
  };
}
function classify(value, scoring = []) {
  return gameHighlights([value], scoring, ["8", "238"]);
}

test("touchdowns name the scoring team, including a pick-six", () => {
  assert.equal(classify(play())[0].teamId, "8");
  const pickSix = play({ type: { text: "Interception Return Touchdown" }, start: { team: { id: "238" } } });
  const events = classify(pickSix, [{ id: "p1", team: { id: "8" } }]);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "touchdown");
  assert.equal(events[0].teamId, "8");
});

test("interceptions use the receiving team even when ESPN isTurnover is false", () => {
  const event = classify(play({ type: { text: "Interception" }, scoringPlay: false,
    isTurnover: false, start: { team: { id: "238" } } }))[0];
  assert.equal(event.kind, "interception");
  assert.equal(event.teamId, "8");
});

test("unknown interception and safety attribution never credits the offense", () => {
  assert.equal(classify(play({ type: { text: "Interception" }, scoringPlay: false }))[0].teamId, null);
  assert.equal(classify(play({ type: { text: "Safety" } }))[0].teamId, null);
  assert.equal(classify(play({ type: { text: "Safety" } }), [{ id: "p1", team: { id: "238" } }])[0].teamId, "238");
});

test("own and opponent fumble recoveries are identified without inventing a turnover", () => {
  for (const type of ["Fumble Recovery (Own)", "Fumble Recovery (Opponent)"]) {
    const event = classify(play({ type: { text: type }, scoringPlay: false }))[0];
    assert.equal(event.kind, "fumble");
    assert.equal(event.teamId, "8");
  }
});

test("made field goals qualify but misses, extra points, and nullified plays do not", () => {
  assert.equal(classify(play({ type: { text: "Field Goal Good" } }))[0].kind, "field-goal");
  for (const p of [
    play({ type: { text: "Field Goal Missed" }, scoringPlay: false }),
    play({ type: { text: "Extra Point Good" } }),
    play({ text: "Touchdown nullified, no play" }),
    play({ type: { text: "Pass Reception" }, scoringPlay: false, text: "Touchdown overturned" }),
    play({ scoringPlay: false }),
  ]) assert.deepEqual(classify(p), []);
});

function event(sequence, overrides = {}) {
  return { id: `p${sequence}`, sequence, kind: "touchdown", teamId: "8", occurredAt: new Date(now).toISOString(), ...overrides };
}
function payload(sequence, highlights = [], overrides = {}) {
  return { spotlight: { id: "game", state: "live", latestPlaySequence: sequence, highlights, ...overrides } };
}

test("startup is silent; new live events display exactly once", () => {
  const tracker = createHighlightTracker();
  assert.equal(tracker.observe(payload(10, [event(10)]), now), null);
  assert.equal(tracker.observe(payload(11, [event(10), event(11)]), now + 30_000).id, "p11");
  assert.equal(tracker.observe(payload(11, [event(11)]), now + 60_000), null);
});

test("pregame baseline allows the first live touchdown; final loads stay silent", () => {
  const tracker = createHighlightTracker();
  tracker.observe(payload(0, [], { state: "scheduled" }), now);
  assert.equal(tracker.observe(payload(1, [event(1)]), now + 30_000).id, "p1");
  assert.equal(tracker.observe(payload(2, [event(2)], { state: "final" }), now + 60_000), null);
});

test("poll batches show the newest big play, not a queue of old celebrations", () => {
  const tracker = createHighlightTracker();
  tracker.observe(payload(10), now);
  assert.equal(tracker.observe(payload(14, [event(11), event(13)]), now + 30_000).id, "p13");
  assert.equal(tracker.observe(payload(14, [event(11), event(13)]), now + 60_000), null);
});

test("reconnects, summary outages, and long polling gaps rebaseline silently", () => {
  for (const outage of [null, { stale: true }, { gamecastUnavailable: true }]) {
    const tracker = createHighlightTracker();
    tracker.observe(payload(10), now);
    tracker.observe(outage, now + 30_000);
    assert.equal(tracker.observe(payload(11, [event(11)]), now + 60_000), null);
  }
  const tracker = createHighlightTracker();
  tracker.observe(payload(10), now);
  assert.equal(tracker.observe(payload(11, [event(11)]), now + 100_000), null);
});

test("changed games, backfilled history, and old wallclock events do not trigger", () => {
  const tracker = createHighlightTracker();
  tracker.observe(payload(10), now);
  assert.equal(tracker.observe(payload(11, [event(9)]), now + 30_000), null);
  assert.equal(tracker.observe(payload(12, [event(12, { occurredAt: new Date(now - 180_000).toISOString() })]), now + 60_000), null);
  assert.equal(tracker.observe(payload(13, [event(13)], { id: "other-game" }), now + 90_000), null);
});
