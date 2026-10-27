import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { gameHighlights } from "../src/highlights.js";
import { createReplayFrames } from "../src/replay.js";

const root = new URL("./fixtures/games/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
const fixtures = await Promise.all(manifest.filter((entry) => entry.league === "college-football").map(async (entry) => {
  const summary = JSON.parse(gunzipSync(await readFile(new URL(entry.file, root))));
  const drives = [...(summary.drives?.previous ?? []), summary.drives?.current].filter(Boolean);
  const plays = [...new Map(drives.flatMap((drive) => drive.plays ?? []).map((play) => [play.id, play])).values()];
  return { entry, summary, plays };
}));

test("college false starts and personal fouls alert live with reported enforcement, not net play yardage", () => {
  for (const [id, penaltyType, penaltyYards] of [
    ["40185849612", "False Start", 5],
    ["401856731182", "Personal Foul", 4],
  ]) {
    const { entry, plays } = fixtures.find(({ plays }) => plays.some((play) => play.id === id));
    const events = gameHighlights([plays.find((play) => play.id === id)], [], [entry.homeTeamId, entry.awayTeamId]);
    assert.equal(events.length, 1, id);
    assert.equal(events[0].kind, "penalty", id);
    assert.equal(events[0].teamId, null);
    assert.equal(events[0].penaltyType, penaltyType);
    assert.equal(events[0].penaltyYards, penaltyYards);
    assert.equal(events[0].detail, `${penaltyType} · ${penaltyYards} YDS`);
  }
});

function replayEvent(play) {
  const { entry, summary } = fixtures.find(({ entry }) => entry.id === "401858496");
  const drive = summary.drives.previous[0];
  return createReplayFrames({ ...summary, scoringPlays: [],
    drives: { previous: [], current: { ...drive, plays: [play] } },
  }, { ...entry, teamId: entry.awayTeamId })[0].event;
}

test("live and replay reject declined, offsetting, ambiguous, and merely discussed penalties", () => {
  const original = fixtures.find(({ entry }) => entry.id === "401858496").plays.find((play) => play.id === "40185849612");
  for (const text of [
    `${original.text} Penalty declined`,
    `${original.text} offsetting`,
    `${original.text} offset`,
    "Possible PENALTY IU False Start 5 yards from IU25 to IU20. NO PLAY",
    "Officials discussed PENALTY IU False Start 5 yards from IU25 to IU20. NO PLAY",
    "No PENALTY IU False Start 5 yards from IU25 to IU20. NO PLAY",
    "PENALTY IU False Start 5 yards from IU25 to IU20? NO PLAY",
    "PENALTY IU False Start. NO PLAY",
    "PENALTY IU False Start 5 yards. NO PLAY",
    "PENALTY IU False Start 5 yards from IU25 to IU20. PENALTY U-M Offside 5 yards from IU20 to IU25. NO PLAY",
    "Officials discussed a penalty after a 5 yard rush. NO PLAY",
  ]) {
    const play = { ...original, text };
    assert.deepEqual(gameHighlights([play], [], ["84", "130"]), [], text);
    assert.equal(replayEvent(play), null, text);
  }
  for (const slug of ["declined", "offsetting", "pending"]) {
    const play = { ...original, penalty: { status: { slug } } };
    assert.deepEqual(gameHighlights([play], [], ["84", "130"]), [], slug);
    assert.equal(replayEvent(play), null, slug);
  }
});

// Independently transcribed enforcement, including half-distance penalties and
// plays whose result coordinates disagree with the reported enforcement.
const expectedEnforcement = new Map(`
401856732111|Holding|10
401856732242|False Start|5
401856732287|Roughing The Passer|15
401856732308|Pass Interference|8
401856732350|False Start|5
401856732404|False Start|5
401856732429|Holding|1
401856732469|Offside|5
401856732512|Pass Interference|15
401856732550|Pass Interference|10
401856732598|Delay Of Game|5
401856732628|False Start|5
401856732665|Pass Interference|15
401856732899|Illegal Shift|5
401856835223|Personal Foul|15
401856835390|Illegal Formation|5
401856835544|Offside|5
401856835671|False Start|5
401856835771|False Start|5
401856835821|Roughing The Kicker|3
40185849612|False Start|5
40185849642|Delay Of Game|5
401858496184|Roughing The Passer|15
401858496331|Offside|5
401858496335|Pass Interference|15
401858496561|Holding|10
40185672752|False Start|5
401856727101|Pass Interference|15
401856727231|Holding|10
401856727292|Holding|4
401856727334|False Start|5
401856727342|Targeting|15
401856727347|Holding|10
401856727434|Offside|5
401856727448|False Start|5
401856727619|Pass Interference|15
401856727665|Holding|10
401856727700|Holding|10
40185673121|Offside|5
40185673160|False Start|5
40185673179|False Start|5
401856731126|Illegal Shift|5
401856731171|False Start|5
401856731182|Personal Foul|4
401856731412|Illegal Substitution|5
401856731464|Holding|10
401856731545|False Start|5
401856731556|Offside|5
401856731629|Holding|10
401856731704|Holding|10
401856731744|Offside|5
401856731748|Holding|10
401856731782|Pass Interference|7
401856731812|False Start|5
`.trim().split("\n").map((row) => {
  const [id, type, yards] = row.split("|");
  return [id, { type, yards: Number(yards) }];
}));

test("all 54 text-only college penalties alert live and match replay without guessed attribution", () => {
  const seen = new Set();
  for (const { entry, summary, plays } of fixtures) {
    const replay = new Map(createReplayFrames(summary, { ...entry, teamId: entry.awayTeamId })
      .filter((frame) => frame.event).map((frame) => [frame.event.id, frame.event]));
    for (const play of plays.filter((play) => expectedEnforcement.has(play.id))) {
      seen.add(play.id);
      const expected = expectedEnforcement.get(play.id);
      assert.ok(expected, `missing literal expectation for ${play.id}`);
      const live = gameHighlights([play], summary.scoringPlays, [entry.homeTeamId, entry.awayTeamId]);
      assert.equal(live.length, 1, play.id);
      assert.equal(live[0].kind, "penalty", play.id);
      assert.equal(live[0].teamId, null, play.id);
      assert.equal(live[0].penaltyType, expected.type, play.id);
      assert.equal(live[0].penaltyYards, expected.yards, play.id);
      assert.deepEqual(replay.get(play.id), live[0], play.id);
    }
  }
  assert.equal(seen.size, 54);
  assert.deepEqual(seen, new Set(expectedEnforcement.keys()));
});

const addedPenaltyPlays = new Map(`
401856840188|False Start|5
401856840290|Face Mask|15
401856840312|Offside|5
401856840469|Delay Of Game|5
401856840705|Pass Interference|15
401856840737|False Start|5
401856840829|Delay Of Game|5
401856729134|False Start|5
401856729237|False Start|5
401856729403|Pass Interference|9
401856729500|False Start|5
401856729535|Ineligible Downfield on Pass|5
401856729610|Pass Interference|2
401856729651|False Start|5
40185672815|Personal Foul|12
40185672830|Offside|5
401856728218|False Start|5
401856728507|Holding|10
401856728550|Pass Interference|10
401856728556|False Start|5
401856728559|Holding|10
401856728570|Delay Of Game|5
401856728723|Holding|10
401856728822|Offside|5
401856728826|False Start|5
401856728846|Illegal Formation|5
40185849591|False Start|5
401858495225|False Start|5
401858495303|False Start|5
401858495312|Offside|5
401858495479|Pass Interference|10
401858495495|Delay Of Game|5
401858495684|Delay Of Game|5
40185850036|Pass Interference|15
401858500163|Personal Foul|15
401858500258|Face Mask|1
401858500331|Holding|10
401858500341|Pass Interference|15
401858500596|Delay Of Game|6
`.trim().split("\n").map((row) => {
  const [id, type, yards] = row.split("|");
  return [id, { type, yards: Number(yards) }];
}));

test("all 39 new college Penalty plays retain reported type and yards", () => {
  const seen = new Set();
  for (const { entry, summary, plays } of fixtures) {
    const replay = new Map(createReplayFrames(summary, { ...entry, teamId: entry.awayTeamId })
      .filter((frame) => frame.event).map((frame) => [frame.event.id, frame.event]));
    for (const play of plays.filter((item) => addedPenaltyPlays.has(item.id))) {
      seen.add(play.id);
      assert.equal(play.type.text, "Penalty", play.id);
      const expected = addedPenaltyPlays.get(play.id);
      const event = gameHighlights([play], summary.scoringPlays, [entry.homeTeamId, entry.awayTeamId])[0];
      assert.equal(event?.kind, "penalty", play.id);
      assert.equal(event.penaltyType, expected.type, play.id);
      assert.equal(event.penaltyYards, expected.yards, play.id);
      assert.deepEqual(replay.get(play.id), event, play.id);
    }
  }
  assert.equal(addedPenaltyPlays.size, 39);
  assert.deepEqual(seen, new Set(addedPenaltyPlays.keys()));
});

const addedEnforcedOnPlay = new Map(`
401856840143|Unnecessary Roughness|10
401856840169|Unnecessary Roughness|15
401856840215|Holding|10
401856840252|Holding|10
401856840597|Holding|10
401856840670|Illegal Formation|5
401856840687|Illegal Bat|10
40185672997|Personal Foul|15
401856729223|Roughing The Passer|13
401856729374|Holding|10
4018567283|Personal Foul|13
40185672849|Holding|10
401858495151|Holding|10
401858495398|Offside|5
401858495544|Holding|7
401858500246|Face Mask|4
401858500420|Personal Foul|15
`.trim().split("\n").map((row) => {
  const [id, type, yards] = row.split("|");
  return [id, { type, yards: Number(yards) }];
}));

test("all 17 new unambiguous fouls attached to actual plays alert without guessing a team", () => {
  const seen = new Set();
  for (const { entry, summary, plays } of fixtures) {
    const replay = new Map(createReplayFrames(summary, { ...entry, teamId: entry.awayTeamId })
      .filter((frame) => frame.event).map((frame) => [frame.event.id, frame.event]));
    for (const play of plays.filter((item) => addedEnforcedOnPlay.has(item.id))) {
      seen.add(play.id);
      const expected = addedEnforcedOnPlay.get(play.id);
      const event = gameHighlights([play], summary.scoringPlays, [entry.homeTeamId, entry.awayTeamId])[0];
      assert.equal(event?.kind, "penalty", play.id);
      assert.equal(event.teamId, null, play.id);
      assert.equal(event.penaltyType, expected.type, play.id);
      assert.equal(event.penaltyYards, expected.yards, play.id);
      assert.deepEqual(replay.get(play.id), event, play.id);
    }
  }
  assert.equal(addedEnforcedOnPlay.size, 17);
  assert.deepEqual(seen, new Set(addedEnforcedOnPlay.keys()));
});

test("an overturned targeting call does not produce a penalty event", () => {
  const { entry, summary, plays } = fixtures.find(({ entry }) => entry.id === "401856729");
  const play = plays.find((item) => item.id === "401856729641");
  assert.match(play.text, /PENALTY.*Targeting.*CALL OVERTURNED/i);
  assert.deepEqual(gameHighlights([play], summary.scoringPlays, [entry.homeTeamId, entry.awayTeamId]), []);
});

test("new college foul names require a single reported enforcement", () => {
  for (const [id, type, yards] of [
    ["401856837397", "Illegal Motion", 5],
    ["40186090781", "Illegal Use Of Hands", 5],
    ["401856838487", "Running Into The Kicker", 5],
    ["401866476461", "Illegal Touch-Pass", 5],
  ]) {
    const { entry, summary, plays } = fixtures.find(({ plays }) => plays.some((play) => play.id === id));
    const play = plays.find((item) => item.id === id);
    const event = gameHighlights([play], summary.scoringPlays, [entry.homeTeamId, entry.awayTeamId])[0];
    assert.equal(event?.kind, "penalty", id);
    assert.equal(event.penaltyType, type, id);
    assert.equal(event.penaltyYards, yards, id);
    assert.equal(event.teamId, null, id);
  }
  for (const [id, description] of [
    ["401858497450", "missing enforcement"],
    ["401858497462", "missing enforcement"],
    ["401862809242", "two different fouls share a net enforcement"],
    ["401862809622", "missing yardage and succeeding spot"],
  ]) {
    const { entry, summary, plays } = fixtures.find(({ plays }) => plays.some((play) => play.id === id));
    const play = plays.find((item) => item.id === id);
    assert.deepEqual(gameHighlights([play], summary.scoringPlays, [entry.homeTeamId, entry.awayTeamId]), [], `${id}: ${description}`);
  }
});

test("a declined foul followed by a separately enforced identical foul retains the enforcement", () => {
  const { entry, summary, plays } = fixtures.find(({ entry }) => entry.id === "401866476");
  const play = plays.find((item) => item.id === "401866476434");
  const next = plays.find((item) => item.id === "401866476440");
  assert.equal(next.start.possessionText, "CMU 28");
  const event = gameHighlights([play], summary.scoringPlays, [entry.homeTeamId, entry.awayTeamId])[0];
  assert.equal(event?.kind, "penalty");
  assert.equal(event.penaltyType, "Holding");
  assert.equal(event.penaltyYards, 10);
  assert.equal(event.teamId, null);
  const replay = createReplayFrames(summary, { ...entry, teamId: entry.awayTeamId })
    .find((frame) => frame.event?.id === play.id);
  assert.deepEqual(replay.event, event);
  assert.equal(replay.spotlight.ball?.label, "CMU 28");
  assert.deepEqual(gameHighlights([{ ...play, text: play.text.replace("CMU Holding (#4", "UTA Holding (#4") }],
    summary.scoringPlays, [entry.homeTeamId, entry.awayTeamId]), [], "different teams cannot share this shorthand");
});

// Transcribed from explicit enforcement statements on plays ESPN labels as
// runs, passes or kicks rather than Penalty. Keep these independent of parsing.
const enforcedOnPlay = new Map(`
401856732171|Holding|10
401856732295|Face Mask|15
401856732398|Unnecessary Roughness|15
401856732451|Unsportsmanlike Conduct|13
401856732535|Roughing The Passer|15
401856732750|Personal Foul|15
401856835110|Holding|8
401856835207|Unnecessary Roughness|15
401856835308|Holding|10
401856835722|Unsportsmanlike Conduct|15
401858496285|Holding|10
40185672736|Unnecessary Roughness|15
401856727253|Illegal Forward Pass|5
401856727399|Face Mask|10
40185673190|Personal Foul|15
401856731356|Targeting|15
401856731452|Illegal Formation|5
401856731738|Face Mask|15
401856731790|Holding|10
`.trim().split("\n").map((row) => {
  const [id, type, yards] = row.split("|");
  return [id, { type, yards: Number(yards) }];
}));

test("all 19 enforced fouls attached to actual plays alert in live games and replay", () => {
  assert.equal(enforcedOnPlay.size, 19);
  const seen = new Set();
  for (const { entry, summary, plays } of fixtures) {
    const replay = new Map(createReplayFrames(summary, { ...entry, teamId: entry.awayTeamId })
      .filter((frame) => frame.event).map((frame) => [frame.event.id, frame.event]));
    for (const play of plays.filter((item) => enforcedOnPlay.has(item.id))) {
      seen.add(play.id);
      assert.notEqual(play.type.text, "Penalty", play.id);
      const expected = enforcedOnPlay.get(play.id);
      const event = gameHighlights([play], summary.scoringPlays, [entry.homeTeamId, entry.awayTeamId])[0];
      assert.equal(event?.kind, "penalty", play.id);
      assert.equal(event.teamId, null, play.id);
      assert.equal(event.penaltyType, expected.type, play.id);
      assert.equal(event.penaltyYards, expected.yards, play.id);
      assert.deepEqual(replay.get(play.id), event, play.id);
    }
  }
  assert.deepEqual(seen, new Set(enforcedOnPlay.keys()));
});

test("enforced offensive holding never celebrates a first down on inconsistent provider down metadata", () => {
  const { entry, summary, plays } = fixtures.find(({ entry }) => entry.id === "401858496");
  const hold = plays.find((play) => play.id === "401858496285");
  const next = plays.find((play) => play.id === "401858496290");
  assert.equal(hold.end.down, 1);
  assert.equal(next.start.down, 2);
  assert.equal(gameHighlights([hold], summary.scoringPlays, [entry.homeTeamId, entry.awayTeamId])[0]?.kind, "penalty");
});

test("enforcement on an underlying play must be complete, unambiguous and actually enforced", () => {
  const { entry, summary, plays } = fixtures.find(({ entry }) => entry.id === "401856835");
  const original = plays.find((play) => play.id === "401856835722");
  for (const text of [
    `${original.text} declined`,
    `${original.text} offsetting`,
    original.text.replace("PENALTY BYU", "Possible PENALTY BYU"),
    original.text.replace("to BYU28", "to BYU28?"),
    original.text.replace("from BYU43 to BYU28", "from BYU43"),
    original.text.replace("UNS: Unsportsmanlike Conduct", "UNS: Unknown Foul"),
    `${original.text} PENALTY UCF Holding 5 yards from BYU28 to BYU33`,
  ]) {
    assert.notEqual(gameHighlights([{ ...original, text }], summary.scoringPlays,
      [entry.homeTeamId, entry.awayTeamId])[0]?.kind, "penalty", text);
  }
  assert.deepEqual(gameHighlights([{ ...original, type: { text: "Timeout" } }], summary.scoringPlays,
    [entry.homeTeamId, entry.awayTeamId]), []);
});

test("accepted metadata takes precedence and only confirmed enforcement supplies yardage", () => {
  const original = fixtures.find(({ entry }) => entry.id === "401858496").plays.find((play) => play.id === "40185849612");
  for (const yards of [0, 10]) {
    const play = { ...original, text: `${original.text} A separate penalty was declined`,
      penalty: { status: { slug: "accepted" }, type: { text: "Offensive Holding" }, yards } };
    const event = gameHighlights([play], [], ["84", "130"])[0];
    assert.equal(event.penaltyType, "Offensive Holding");
    assert.equal(event.penaltyYards, yards);
    assert.deepEqual(replayEvent(play), event);
  }
  for (const yards of [undefined, "10", NaN]) {
    const play = { ...original, text: "Holding - No Play",
      penalty: { status: { slug: "accepted" }, type: { text: "Holding" }, yards } };
    const event = gameHighlights([play], [], ["84", "130"])[0];
    assert.equal(event.penaltyType, "Holding");
    assert.equal(event.penaltyYards, null, "do not infer yards from result coordinates");
    assert.deepEqual(replayEvent(play), event);
  }
});

test("recorded declined and offsetting college penalties preserve only the valid underlying play", () => {
  for (const [id, expectedKind] of [
    ["401856732330", "tackle-for-loss"],
    ["401856835462", null],
    ["401856727241", "touchdown"],
  ]) {
    const { entry, summary, plays } = fixtures.find(({ plays }) => plays.some((play) => play.id === id));
    const play = plays.find((play) => play.id === id);
    const event = gameHighlights([play], summary.scoringPlays, [entry.homeTeamId, entry.awayTeamId])[0] ?? null;
    assert.equal(event?.kind ?? null, expectedKind, id);
    const replay = createReplayFrames(summary, { ...entry, teamId: entry.awayTeamId })
      .find((frame) => frame.caption === play.text);
    assert.deepEqual(replay.event, event, id);
  }
});

test("the explicit grounding override remains available for sacks but not speculative commentary", () => {
  const original = fixtures.find(({ entry }) => entry.id === "401858496").plays.find((play) => play.id === "40185849612");
  const play = { ...original, type: { text: "Sack" },
    text: "Incomplete pass PENALTY IU Intentional Grounding (#10 J.Hoover)" };
  const event = gameHighlights([play], [], ["84", "130"])[0];
  assert.equal(event.kind, "penalty");
  assert.equal(event.penaltyType, "Intentional Grounding");
  assert.equal(event.penaltyYards, null);
  assert.equal(event.teamId, null);
  assert.deepEqual(replayEvent(play), event);
  assert.equal(gameHighlights([{ ...play, text: "Sacked; possible intentional grounding" }], [], ["84", "130"])[0].kind, "sack");
  for (const text of [
    "Possible PENALTY IU Intentional Grounding (#10 J.Hoover)",
    "Was PENALTY IU Intentional Grounding called?",
  ]) assert.equal(gameHighlights([{ ...play, text }], [], ["84", "130"])[0].kind, "sack", text);
});

test("text-only enforcement does not reclassify valid scoring plays or generic non-penalty commentary", () => {
  const original = fixtures.find(({ entry }) => entry.id === "401858496").plays.find((play) => play.id === "40185849612");
  const text = "Touchdown. PENALTY IU Personal Foul 15 yards from IU25 to IU10";
  const score = { ...original, scoringPlay: true, scoringType: { name: "touchdown" }, type: { text: "Rushing Touchdown" }, text };
  assert.equal(gameHighlights([score], [], ["84", "130"])[0].kind, "touchdown");
  const commentary = { ...original, type: { text: "Timeout" }, text: "Officials discuss PENALTY IU Holding 10 yards from IU25 to IU15" };
  assert.deepEqual(gameHighlights([commentary], [], ["84", "130"]), []);
  assert.equal(replayEvent(commentary), null);
});
