import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createReplayFrames } from "../src/replay.js";
import { enrichGame } from "../src/gamecast.js";
import { normalizeGame } from "../src/scoreboard.js";

const cases = [
  { id: "401873020", league: "nfl", teamId: "8", kickId: "4018730203900", nextId: "4018730203921", start: "DET 25", end: "DET 27" },
  { id: "401856732", league: "college-football", teamId: "251", kickId: "401856732782", nextId: "401856732788", start: "TEX 41", end: "TEX 44" },
];

async function fixture(option) {
  return JSON.parse(gunzipSync(await readFile(new URL(`fixtures/games/${option.league}/${option.id}.json.gz`, import.meta.url))));
}

for (const option of cases) {
  test(`${option.league}: blocked kick waits for a confirmed spot, including intervening timeouts`, async () => {
    const summary = await fixture(option);
    const frames = createReplayFrames(summary, option);
    const index = frames.findIndex((frame) => frame.spotlight.fieldContext.lastPlayId === option.kickId);
    const next = frames.findIndex((frame) => frame.spotlight.fieldContext.lastPlayId === option.nextId);
    assert.ok(index >= 0 && next > index);
    for (const frame of frames.slice(index, next)) {
      assert.equal(frame.spotlight.ball, null, frame.caption);
    }
    const snap = summary.drives.previous.flatMap((drive) => drive.plays).find((play) => play.id === option.nextId);
    assert.equal(snap.start.possessionText, option.start, "the next snap independently confirms the succeeding spot");
    assert.equal(frames[next].spotlight.ball?.label, option.end, "resume at the actual snap result, not a guessed kick rule");
  });
}

async function synthetic() {
  const option = cases[0];
  const summary = await fixture(option);
  const competition = summary.header.competitions[0];
  competition.status = { period: 4, displayClock: "3:25", type: { state: "in", completed: false } };
  const kick = structuredClone(summary.drives.previous.flatMap((drive) => drive.plays).find((play) => play.id === option.kickId));
  summary.drives = { current: { id: "blocked", team: { id: "9" }, plays: [kick] }, previous: [] };
  delete summary.situation;
  delete competition.situation;
  const base = normalizeGame({ id: option.id, date: competition.date, competitions: [competition] }, option);
  return { summary, kick, base, run: () => enrichGame(base, summary) };
}

test("blocked field goals are detected from type or blocked missed-kick prose", async () => {
  const { kick, run } = await synthetic();
  for (const type of [{ text: "Blocked Field Goal" }, { text: "Field Goal Missed" }, { text: "blockedFieldGoal" }]) {
    kick.type = type;
    assert.equal(run().ball, null);
  }
  kick.text = "Kick attempt.";
  assert.equal(run().ball, null, "explicit type is sufficient without blocked prose");
});

test("a valid live situation always wins, including penalty-enforced spots", async () => {
  const { summary, run } = await synthetic();
  summary.situation = { possession: "8", possessionText: "DET 40", down: 1, distance: 10, downDistanceText: "1st & 10" };
  assert.equal(run().ball?.label, "DET 40");
  assert.equal(run().ball?.source, "current situation");
  summary.header.competitions[0].situation = summary.situation;
  delete summary.situation;
  assert.equal(run().ball?.label, "DET 40");
});

test("incomplete live situations cannot turn a blocked kick endpoint into a spot", async () => {
  const { summary, run } = await synthetic();
  summary.situation = { possession: "8", down: 1, distance: 10 };
  assert.equal(run().ball, null);
});

test("explicit recoveries and returns retain their actual possession spots", async () => {
  const { kick, run } = await synthetic();
  for (const [text, teamId] of [
    ["Field goal BLOCKED, recovered by DET at DET 17.", "8"],
    ["Field goal BLOCKED, recovered by GB at DET 17.", "9"],
    ["Field goal BLOCKED, returned by DET for 5 yards to DET 17.", "8"],
  ]) {
    kick.text = text;
    kick.end.team.id = teamId;
    assert.equal(run().ball?.label, "DET 17", text);
    assert.equal(run().possessionTeamId, teamId, text);
  }
});

test("no return or recovery alone is not evidence of an actual possession spot", async () => {
  const { kick, run } = await synthetic();
  for (const text of ["Field goal BLOCKED, no return.", "Field goal BLOCKED, not recovered, out of bounds at DET 17.", "Field goal BLOCKED, not recovered by DET."]) {
    kick.text = text;
    assert.equal(run().ball, null, text);
  }
});

test("an unresolved kick stays unknown through same-drive timeouts until an actual snap", async () => {
  const { summary, kick, run } = await synthetic();
  const timeout = { ...structuredClone(kick), id: "timeout", sequenceNumber: "390100", type: { text: "Timeout" }, text: "Timeout", clock: { displayValue: "3:24" } };
  summary.drives.current.plays.push(timeout);
  assert.equal(run().ball, null, "timeout coordinates do not establish the succeeding spot");
  const snap = { ...structuredClone(kick), id: "snap", sequenceNumber: "390200", type: { text: "Rush" }, text: "Rush for 2 yards", clock: { displayValue: "3:20" } };
  snap.start = { ...snap.end, possessionText: "DET 25" };
  snap.end.possessionText = "DET 27";
  summary.drives.current.plays.push(snap);
  assert.equal(run().ball?.label, "DET 27");
});

test("unconfirmed recovery down is not a succeeding scrimmage spot", async () => {
  const { kick, run } = await synthetic();
  kick.text = "Field goal BLOCKED, recovered by DET.";
  kick.end.down = -1;
  assert.equal(run().ball, null);
});

test("ordinary missed kicks and blocked punts are outside the field-goal guard", async () => {
  const { kick, run } = await synthetic();
  kick.type.text = "Field Goal Missed";
  kick.text = "Field goal attempt short.";
  assert.equal(run().ball?.label, "DET 17");
  kick.type.text = "Blocked Punt";
  kick.text = "Punt BLOCKED, out of bounds at DET 17.";
  assert.equal(run().ball?.label, "DET 17");
});

test("blocked kick guard does not discard valid penalty enforcement", async () => {
  const { kick, run } = await synthetic();
  for (const metadata of [{ isPenalty: true }, { penalty: { accepted: true } }, {}]) {
    Object.assign(kick, metadata);
    kick.text = "Field goal BLOCKED. PENALTY DET Offside enforced at DET 12, NO PLAY.";
    kick.end.possessionText = "DET 12";
    kick.end.team.id = "9";
    kick.end.down = 4;
    assert.equal(run().ball?.label, "DET 12");
    delete kick.penalty;
    kick.isPenalty = false;
  }
});
