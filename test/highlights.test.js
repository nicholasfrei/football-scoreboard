import test from "node:test";
import assert from "node:assert/strict";
import { gameHighlights } from "../src/highlights.js";
import { createHighlightTracker, highlightDetail, highlightDuration, HIGHLIGHT_LABELS } from "../public/highlights.js";

test("every live takeover uses its configured duration", () => {
  const expected = {
    touchdown: 180_000,
    "field-goal": 180_000,
    "missed-field-goal": 60_000,
    safety: 150_000,
    "first-down": 15_000,
    interception: 60_000,
    fumble: 60_000,
    "turnover-on-downs": 60_000,
    sack: 15_000,
    "tackle-for-loss": 15_000,
    penalty: 15_000,
    "blocked-punt": 60_000,
    "blocked-field-goal": 60_000,
    "extra-point": 15_000,
    "extra-point-missed": 15_000,
    "two-point-conversion": 15_000,
    punt: 15_000,
  };
  assert.deepEqual(Object.keys(expected).sort(), Object.keys(HIGHLIGHT_LABELS).sort());
  for (const [kind, duration] of Object.entries(expected)) assert.equal(highlightDuration(kind), duration, kind);
});

const now = Date.parse("2026-10-31T23:55:00Z");

test("touchdown details show the current score with the selected team first, never +6", () => {
  const game = { selectedTeam: { id: "6", abbreviation: "DAL", score: 20 }, opponent: { id: "21", abbreviation: "PHI", score: 17 } };
  for (const teamId of ["6", "21", null]) {
    assert.equal(highlightDetail({ kind: "touchdown", teamId, detail: "+6 POINTS" }, game), "DAL 20-17 PHI");
  }
  assert.equal(highlightDetail({ kind: "field-goal", teamId: "6" }, game), "DAL 20-17 PHI");
  assert.equal(highlightDetail({ kind: "touchdown" }, { ...game, homeAway: "away" }), "DAL 20-17 PHI");
  game.selectedTeam.score = 0;
  game.opponent.score = null;
  assert.equal(highlightDetail({ kind: "touchdown" }, game), "DAL 0-— PHI");
});

test("other highlight details retain their labels and unknown-team safeguards", () => {
  const game = { selectedTeam: { id: "6" }, opponent: { id: "21" } };
  for (const [kind, label] of Object.entries({ fumble: "RECOVERED BY", punt: "PUNTING TEAM", "blocked-punt": "BLOCKED BY", "blocked-field-goal": "BLOCKED BY" })) {
    assert.equal(highlightDetail({ kind, teamId: "21" }, game), label);
    assert.equal(highlightDetail({ kind, teamId: null }, game), "TEAM NOT CONFIRMED");
  }
  assert.equal(highlightDetail({ kind: "interception", player: "#0 J.Crawford", teamId: "21" }, game), "INTERCEPTED BY #0 J.Crawford");
  assert.equal(highlightDetail({ kind: "interception", teamId: "21" }, game), "");
  assert.equal(highlightDetail({ kind: "extra-point", detail: "IT’S GOOD · +1" }, game), "IT’S GOOD · +1");
  assert.equal(highlightDetail({ kind: "penalty", penaltyType: "Defensive Pass Interference", penaltyYards: 15 }, game), "15 YDS");
  assert.equal(highlightDetail({ kind: "penalty", penaltyType: "False Start", penaltyYards: null }, game), "");
  assert.equal(highlightDetail({ kind: "penalty", penaltyType: "Offsides" }, game), "");
});

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

test("missed field goals are highlighted with their configured minute duration", () => {
  const event = classify(play({
    type: { text: "Field Goal Missed" }, scoringPlay: false, text: "Field Goal Missed",
  }))[0];
  assert.equal(event.kind, "missed-field-goal");
  assert.equal(highlightDuration(event.kind), 60_000);
});

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

test("interceptions name only the player explicitly reported in play text", () => {
  for (const [text, player] of [
    ["Pass intercepted by #0 J.Crawford at TEXAS33", "#0 J.Crawford"],
    ["Pass INTERCEPTED by D.Jackson at CHI -7. Touchback.", "D.Jackson"],
    ["Pass INTERCEPTED by D.Knight (B.Carter) at BLT 38", "D.Knight"],
    ["Pass intercepted by #19 C.McDonald III at TAM41", "#19 C.McDonald III"],
    ["Pass intercepted; player unreported", null],
  ]) assert.equal(classify(play({ type: { text: "Interception" }, scoringPlay: false, text,
    start: { team: { id: "238" } }, end: { team: { id: "8" } } }))[0].player, player, text);
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
  assert.deepEqual(classify(play({ type: { text: "Fumble" }, scoringPlay: false })), []);
});

test("sacks and negative rushes credit the defense, without flagging ordinary stops or nullified plays", () => {
  const rush = play({ type: { text: "Rush" }, scoringPlay: false,
    start: { team: { id: "8" }, yardsToEndzone: 70 },
    end: { team: { id: "8" }, yardsToEndzone: 73 } });
  assert.equal(classify(rush)[0].kind, "tackle-for-loss");
  assert.equal(classify(rush)[0].teamId, "238");
  const sack = { ...rush, type: { text: "Sack" } };
  assert.equal(classify(sack)[0].kind, "sack");
  assert.equal(classify(sack)[0].teamId, "238");
  for (const value of [
    { ...rush, end: { ...rush.end, yardsToEndzone: 70 } },
    { ...rush, end: { ...rush.end, team: { id: "238" } } },
    { ...rush, text: "Penalty, no play" },
  ]) assert.deepEqual(classify(value), []);
  assert.equal(classify({ ...sack, start: undefined })[0].teamId, null);
  assert.deepEqual(classify({ ...rush, statYardage: 0 }), [], "reported zero beats flipped coordinates");
  assert.deepEqual(classify({ ...rush, statYardage: 2 }), [], "a gain is not a loss");
  assert.deepEqual(classify({ ...rush, text: "Rush for 0 yards" }), [], "explicit zero is not a loss");
  assert.deepEqual(classify({ ...rush, start: { ...rush.start, possessionText: "ARK 45" },
    end: { ...rush.end, possessionText: "ARK 45" } }), [], "unchanged named spot is not a loss");
  assert.equal(classify({ ...rush, statYardage: -1 })[0].kind, "tackle-for-loss");
});

test("accepted penalties alert without guessing the penalized team; declined and offsetting ones do not", () => {
  const penalty = play({ type: { text: "Penalty" }, scoringPlay: false, text: "Holding - No Play",
    penalty: { status: { slug: "accepted" }, type: { text: "Offensive Holding" }, yards: 10 } });
  assert.deepEqual(classify(penalty).map(({ kind, teamId, detail }) => ({ kind, teamId, detail })), [
    { kind: "penalty", teamId: null, detail: "Offensive Holding · 10 YDS" },
  ]);
  assert.equal(classify(penalty)[0].penaltyType, "Offensive Holding");
  assert.equal(classify(penalty)[0].penaltyYards, 10);
  for (const slug of ["declined", "offsetting"]) assert.deepEqual(classify({ ...penalty, penalty: {
    ...penalty.penalty, status: { slug },
  } }), []);
});

test("explicit intentional grounding text overrides a sack without guessing yardage", () => {
  const grounding = play({ type: { text: "Sack" }, scoringPlay: false,
    text: "Incomplete pass PENALTY MISS Intentional Grounding (#6 T.Chambliss)",
    start: { team: { id: "8" } }, end: { team: { id: "8" } } });
  const event = classify(grounding)[0];
  assert.equal(event.kind, "penalty");
  assert.equal(event.penaltyType, "Intentional Grounding");
  assert.equal(event.penaltyYards, null);
  assert.equal(event.teamId, null);
  for (const suffix of [" declined", " offsetting", " offset"]) {
    assert.notEqual(classify({ ...grounding, text: grounding.text + suffix })[0]?.kind, "penalty");
  }
  for (const slug of ["declined", "offsetting"]) {
    assert.notEqual(classify({ ...grounding, penalty: { status: { slug } } })[0]?.kind, "penalty");
  }
  assert.equal(classify({ ...grounding, text: "Quarterback sacked; possible intentional grounding" })[0].kind, "sack");
});

test("made field goals and extra points qualify; missed field goals alert, but other misses and nullified plays do not", () => {
  assert.equal(classify(play({ type: { text: "Field Goal Good" } }))[0].kind, "field-goal");
  assert.equal(classify(play({ type: { text: "Extra Point Good" } }))[0].kind, "extra-point");
  assert.equal(classify(play({ type: { text: "Field Goal Missed" }, scoringPlay: false }))[0].kind, "missed-field-goal");
  for (const p of [
    play({ type: { text: "Extra Point Missed" }, scoringPlay: false }),
    play({ type: { text: "Extra Point Blocked" }, scoringPlay: false }),
    play({ type: { text: "Two Point Pass" } }),
    play({ text: "Touchdown nullified, no play" }),
    play({ type: { text: "Pass Reception" }, scoringPlay: false, text: "Touchdown overturned" }),
    play({ scoringPlay: false }),
  ]) assert.deepEqual(classify(p), []);
});

test("a confirmed touchdown survives a NO PLAY on its bundled conversion attempt", () => {
  const touchdown = play({ text: "Pass for TOUCHDOWN. Pass attempt failed. PENALTY on defense. NO PLAY. Retry failed.",
    scoringType: { name: "touchdown" } });
  assert.equal(classify(touchdown, [{ id: "p1", team: { id: "8" } }])[0]?.kind, "touchdown");
  assert.deepEqual(classify({ ...touchdown, text: "TOUCHDOWN nullified by penalty. NO PLAY" }, []), []);
});

test("a touchdown retains its own identity as ESPN appends a conversion and a flag", () => {
  const touchdown = play({ scoringType: { name: "touchdown" }, text: "Rush for TOUCHDOWN." });
  const scoring = [{ id: "p1", team: { id: "8" } }];
  assert.deepEqual(classify(touchdown, scoring).map(({ kind, phase }) => [kind, phase]), [["touchdown", undefined]]);
  const revised = { ...touchdown, text: "Rush for TOUCHDOWN. Kicker extra point is GOOD.",
    penalty: { status: { slug: "accepted" }, type: { text: "Offside" }, yards: 5 } };
  assert.deepEqual(classify(revised, scoring).map(({ id, kind, phase }) => [id, kind, phase]), [
    ["p1", "touchdown", undefined], ["p1", "extra-point", "conversion"], ["p1", "penalty", "penalty"],
  ]);
  assert.equal(classify({ ...revised, text: "Rush for TOUCHDOWN. Kicker extra point is NO GOOD." }, scoring)[1].kind,
    "extra-point-missed");
  assert.equal(classify({ ...revised, text: "TOUCHDOWN nullified. PENALTY on offense." }, scoring)[0].kind, "penalty");
});

test("a separate defensive two-point conversion credits the scoring defense", () => {
  const conversion = play({ type: { text: "Defensive 2pt Conversion" },
    scoringType: { name: "defensive-two-point-conversion" },
    text: "Defensive PAT Conversion", wallclock: undefined,
    start: { team: { id: "8" } }, end: { team: { id: "238" } } });
  const event = classify(conversion, [{ id: "p1", team: { id: "238" } }])[0];
  assert.equal(event?.kind, "two-point-conversion");
  assert.equal(event.teamId, "238");
  assert.equal(event.occurredAt, null);
  assert.equal(highlightDuration(event.kind), 15_000);
});

test("a confirmed muffed punt recovered by the other team triggers one fumble recovery", () => {
  const muff = play({ type: { text: "Muffed Punt Recovery (Opponent)" },
    scoringPlay: false, text: "Punt muffed, recovered by the kicking team",
    start: { team: { id: "8" } }, end: { team: { id: "8" } } });
  assert.equal(classify(muff)[0]?.kind, "fumble");
  assert.equal(classify(muff)[0]?.teamId, "8");
});

test("blocked field goals credit the blocking team, independently of recovery", () => {
  for (const end of ["8", "238"]) {
    const result = classify(play({ type: { text: "Blocked Field Goal" }, scoringPlay: false,
      start: { team: { id: "8" } }, end: { team: { id: end } } }));
    assert.equal(result[0].kind, "blocked-field-goal");
    assert.equal(result[0].teamId, "238");
  }
  assert.equal(classify(play({ type: { text: "Field Goal Blocked" }, scoringPlay: false, start: undefined }))[0].teamId, null);
  assert.equal(classify(play({ type: { text: "Field Goal Missed" }, scoringPlay: false, text: "Field goal blocked" }))[0].kind, "blocked-field-goal");
  assert.equal(classify(play({ type: { text: "Blocked Field Goal" }, scoringPlay: false,
    text: "35 yard field goal is BLOCKED (D.Wonnum), Center-M.Orzech" }))[0].player, "D.Wonnum");
  assert.deepEqual(classify(play({ type: { text: "Blocked Field Goal" }, scoringPlay: false, text: "Blocked, no play" })), []);
  assert.equal(classify(play({ type: { text: "Blocked Field Goal Return Touchdown" }, scoringPlay: true }))[0].kind, "touchdown");
});

test("first downs use a confirmed new series on the same possession", () => {
  const first = play({ type: { text: "Pass Reception" }, scoringPlay: false,
    start: { team: { id: "8" }, down: 2, distance: 6, yardsToEndzone: 71 },
    end: { team: { id: "8" }, down: 1, distance: 10, yardsToEndzone: 63 } });
  assert.equal(classify(first)[0].kind, "first-down");
  assert.equal(classify(first)[0].teamId, "8");
  // A 12-yard gain on first and ten also moves the chains.
  assert.equal(classify({ ...first, start: { ...first.start, down: 1, distance: 10, yardsToEndzone: 75 } })[0].kind, "first-down");
  for (const p of [
    { ...first, type: { text: "Kickoff" } },
    { ...first, type: { text: "Timeout" } },
    { ...first, isTurnover: true },
    { ...first, text: "Penalty, no play" },
    { ...first, end: { ...first.end, team: { id: "238" } } },
    { ...first, end: { ...first.end, down: 3 } },
    { ...first, start: undefined },
    { ...first, start: { ...first.start, down: 1, distance: 10 } },
  ]) assert.deepEqual(classify(p), []);
});

function event(sequence, overrides = {}) {
  return { id: `p${sequence}`, sequence, kind: "touchdown", teamId: "8", occurredAt: new Date(now).toISOString(), ...overrides };
}

test("punts credit the kicking team, not the receiving team", () => {
  for (const type of ["Punt", "Punt Return", "Punt Fair Catch", "Punt Touchback"]) {
    const result = classify(play({ type: { text: type }, scoringPlay: false,
      start: { team: { id: "8" } }, end: { team: { id: "238" } } }));
    assert.equal(result[0].kind, "punt");
    assert.equal(result[0].teamId, "8");
  }
  assert.equal(classify(play({ type: { text: "Punt" }, scoringPlay: false, start: undefined }))[0].teamId, null);
});

test("blocked punts credit the blocking team independently of recovery", () => {
  for (const recovery of ["8", "238"]) {
    const result = classify(play({ type: { text: "Blocked Punt" }, scoringPlay: false,
      start: { team: { id: "238" } }, end: { team: { id: recovery } } }));
    assert.equal(result[0].kind, "blocked-punt");
    assert.equal(result[0].teamId, "8");
  }
  assert.equal(classify(play({ type: { text: "Punt Blocked" }, scoringPlay: false, start: undefined }))[0].teamId, null);
  assert.equal(classify(play({ type: { text: "Blocked Punt Touchdown" } }))[0].kind, "touchdown");
  assert.deepEqual(classify(play({ type: { text: "Blocked Punt" }, scoringPlay: false, text: "No play, penalty" })), []);
  assert.deepEqual(classify(play({ type: { text: "Timeout" }, scoringPlay: false, text: "Punt unit coming on" })), []);
});
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
