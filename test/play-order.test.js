import test from "node:test";
import assert from "node:assert/strict";
import { comparePlays } from "../src/play-order.js";

test("plays sort by period and sequence before unreliable wallclock", () => {
  const play = (id, period, clock, wallclock, sequenceNumber) => ({ id, period: { number: period },
    clock: { displayValue: clock }, wallclock, sequenceNumber });
  const plays = [
    play("q4", 4, "14:55", "2026-10-25T02:37:53Z", 147),
    play("late-revision", 3, "14:58", "2026-10-25T02:36:43Z", 102),
    { ...play("quarter-end", 3, "0:00", "2026-10-25T02:33:56Z", 146), type: { text: "End Period" } },
    play("next-play", 3, "14:47", "2026-10-25T01:50:21Z", 103),
    play("same-clock-later", 3, "14:47", "2026-10-25T01:50:22Z", 104),
    play("missing-clock", 3, "unknown", null, 200),
  ];
  assert.deepEqual(plays.sort(comparePlays).map((item) => item.id),
    ["late-revision", "next-play", "same-clock-later", "missing-clock", "quarter-end", "q4"]);
});

test("reused sequences use wallclock before corrected or untimed clocks", () => {
  const play = (id, clock, wallclock) => ({ id, period: { number: 5 }, sequenceNumber: "151",
    clock: { displayValue: clock }, wallclock });
  assert.deepEqual([
    play("rush", "0:00", "2026-10-24T19:26:27Z"),
    play("timeout", "15:00", "2026-10-24T19:25:24Z"),
  ].sort(comparePlays).map((play) => play.id), ["timeout", "rush"]);
});

test("all terminal marker types follow ordinary plays even with reused sequences or nonzero clocks", () => {
  for (const text of ["End Period", "End of Half", "End of Regulation", "End of Game"]) {
    const plays = [
      { id: "end", period: { number: 5 }, sequenceNumber: "42", type: { text }, clock: { displayValue: "7:25" } },
      { id: "last-snap", period: { number: 5 }, sequenceNumber: "158", clock: { displayValue: "0:00" } },
    ];
    assert.deepEqual(plays.sort(comparePlays).map((play) => play.id), ["last-snap", "end"], text);
  }
});

test("unsequenced fallback is deterministic, clock-first in regulation and time-first in overtime", () => {
  const play = (id, clock, wallclock) => ({ id, clock: { displayValue: clock }, wallclock });
  const plays = [
    play("early", "1:00", "2026-10-24T19:25:24Z"),
    play("later", "2:00", "2026-10-24T19:26:27Z"),
    play("unknown", "unknown", "invalid"),
  ];
  for (const [period, expected] of [[4, ["later", "early", "unknown"]], [5, ["early", "later", "unknown"]]]) {
    assert.deepEqual(plays.map((play) => ({ ...play, period: { number: period } })).sort(comparePlays)
      .map((play) => play.id), expected);
  }
});

test("mixed missing metadata cannot create pairwise comparison cycles", () => {
  const plays = [
    { id: "a", sequenceNumber: 1, clock: { displayValue: "1:00" }, wallclock: "2026-10-24T19:26:27Z" },
    { id: "b", sequenceNumber: 2, clock: { displayValue: "3:00" }, wallclock: "2026-10-24T19:25:24Z" },
    { id: "c", clock: { displayValue: "2:00" } },
    { id: "d", sequenceNumber: "invalid", clock: { displayValue: "unknown" } },
    { id: "e", sequenceNumber: null },
    { id: "f", sequenceNumber: "", type: { text: "End of Game" } },
  ];
  for (const a of plays) for (const b of plays) {
    assert.equal(comparePlays(a, b) + comparePlays(b, a), 0);
    for (const c of plays) {
      if (comparePlays(a, b) <= 0 && comparePlays(b, c) <= 0) assert.ok(comparePlays(a, c) <= 0);
    }
  }
  assert.deepEqual([...plays].reverse().sort(comparePlays).map((play) => play.id), ["a", "b", "c", "d", "e", "f"]);
});
