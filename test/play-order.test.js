import test from "node:test";
import assert from "node:assert/strict";
import { comparePlays } from "../src/play-order.js";

test("plays sort by period and game clock before unreliable wallclock", () => {
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
