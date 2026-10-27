import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createReplayFrames, REPLAY_GAMES } from "../src/replay.js";
import { createBallPositionTracker } from "../public/ball-position.js";
import { highlightDetail } from "../public/highlights.js";

for (const [key, option] of Object.entries(REPLAY_GAMES)) {
  test(`${option.label}: replay uses every recorded play without future scores or drives`, async () => {
    const raw = await readFile(new URL(`fixtures/games/${option.file}`, import.meta.url));
    const summary = JSON.parse(gunzipSync(raw));
    const frames = createReplayFrames(summary, option);
    const allPlays = [...new Map((summary.drives.previous ?? [])
      .flatMap((drive) => drive.plays ?? []).map((play) => [String(play.id), play])).values()];
    assert.equal(frames.length, allPlays.length);
    assert.ok(frames.length > 180);
    assert.equal(frames[0].spotlight.selectedTeam.score, 0);
    assert.equal(frames[0].spotlight.opponent.score, 0);
    assert.equal(frames[0].spotlight.drives.length, 1);
    assert.equal(frames[0].spotlight.drives[0].result, null, "unfinished drive must not reveal its outcome");
    assert.equal(frames[0].spotlight.drives[0].description, null);
    assert.equal(frames.at(-1).spotlight.state, "final");
    const selected = summary.header.competitions[0].competitors.find((team) => String(team.team.id) === option.teamId);
    const opponent = summary.header.competitions[0].competitors.find((team) => team !== selected);
    assert.equal(frames.at(-1).spotlight.selectedTeam.score, Number(selected.score));
    assert.equal(frames.at(-1).spotlight.opponent.score, Number(opponent.score));
    assert.ok(frames.some((frame) => frame.event?.kind === "touchdown"));
    assert.ok(frames.some((frame) => frame.event?.kind === "field-goal"));
    assert.ok(frames.some((frame) => frame.event?.kind === "penalty"));
    for (const [index, frame] of frames.entries()) {
      const source = allPlays.find((play) => play.text === frame.caption && play.clock?.displayValue === frame.spotlight.clock);
      assert.ok(source, `play ${index} is in the recorded source`);
      assert.equal(frame.spotlight.drives.reduce((total, drive) => total + drive.plays.length, 0), index + 1);
      if (frame.spotlight.ball) assert.ok(frame.spotlight.ball.percent >= 0 && frame.spotlight.ball.percent <= 100);
    }
  });
}

test("Texas–Ole Miss replay holds the ball at Texas 29 after a zero-yard rush", async () => {
  const option = REPLAY_GAMES.college;
  const summary = JSON.parse(gunzipSync(await readFile(new URL(`fixtures/games/${option.file}`, import.meta.url))));
  const frames = createReplayFrames(summary, option);
  assert.match(frames[22].caption, /K\.Lacy rush left for 0 yards to the TEXAS29/);
  assert.equal(frames[22].spotlight.ball?.label, "TEX 29");
  assert.equal(frames[22].spotlight.ball?.percent, 71, "away offense at the home 29 belongs near the right end zone");
  assert.equal(frames[22].spotlight.ball?.direction, "right");
});

test("Texas–Ole Miss replay places touchbacks and fair catches", async () => {
  const option = REPLAY_GAMES.college;
  const summary = JSON.parse(gunzipSync(await readFile(new URL(`fixtures/games/${option.file}`, import.meta.url))));
  const frames = createReplayFrames(summary, option);
  for (const [pattern, label, percent] of [
    [/kickoff 65 yards to the MISS00, Touchback/i, "MISS 25", 25],
    [/kickoff 61 yards to the MISS04 fair catch/i, "MISS 25", 25],
    [/punt 36 yards to the TEXAS17 fair catch/i, "TEX 17", 83],
  ]) {
    const frame = frames.find((entry) => pattern.test(entry.caption));
    assert.ok(frame, `missing recorded play: ${pattern}`);
    assert.equal(frame.spotlight.ball?.label, label, frame.caption);
    assert.equal(frame.spotlight.ball?.percent, percent, frame.caption);
    assert.equal(createBallPositionTracker().observe({ spotlight: frame.spotlight }).ball?.percent, percent);
  }
});

test("Texas–Ole Miss quarter breaks preserve the drive without replaying old plays", async () => {
  const option = REPLAY_GAMES.college;
  const summary = JSON.parse(gunzipSync(await readFile(new URL(`fixtures/games/${option.file}`, import.meta.url))));
  const frames = createReplayFrames(summary, option);
  const misplaced = frames.findIndex((frame) => frame.spotlight.fieldContext.lastPlayId === "401856732650");
  assert.ok(misplaced >= 0);
  assert.equal(frames[misplaced].spotlight.period, 3);
  assert.equal(frames[misplaced].spotlight.clock, "14:58");
  assert.equal(frames[misplaced - 1].spotlight.clock, "15:00");
  assert.equal(frames[misplaced + 1].spotlight.clock, "14:47");
  assert.equal(frames[misplaced].spotlight.selectedTeam.score, frames[misplaced - 1].spotlight.selectedTeam.score);
  assert.equal(frames[misplaced].spotlight.opponent.score, frames[misplaced - 1].spotlight.opponent.score);
  for (const [quarter, text] of [[1, "1st"], [3, "3rd"]]) {
    const index = frames.findIndex((frame) => frame.caption === `End of ${text} quarter.`);
    assert.ok(index > 0);
    const before = frames[index - 1].spotlight;
    const atBreak = frames[index].spotlight;
    const after = frames[index + 1].spotlight;
    assert.equal(atBreak.currentDriveId, before.currentDriveId);
    assert.deepEqual(atBreak.ball, before.ball);
    assert.equal(atBreak.possessionTeamId, before.possessionTeamId);
    assert.equal(after.period, quarter + 1, "next replay frame must be from the next quarter");
    assert.equal(after.currentDriveId, before.currentDriveId);
    assert.equal(after.possessionTeamId, before.possessionTeamId);
    if (quarter === 3) assert.equal(after.ball?.label, "MISS 47", "the first Q4 play moves the ball one yard");
  }
});

test("Texas–Ole Miss intentional grounding is a penalty, not a sack", async () => {
  const option = REPLAY_GAMES.college;
  const summary = JSON.parse(gunzipSync(await readFile(new URL(`fixtures/games/${option.file}`, import.meta.url))));
  const frame = createReplayFrames(summary, option).find((entry) => /PENALTY MISS Intentional Grounding/i.test(entry.caption));
  assert.ok(frame, "the recorded intentional grounding play is present");
  assert.equal(frame.event?.kind, "penalty");
  assert.equal(frame.event?.penaltyType, "Intentional Grounding");
  assert.equal(frame.event?.penaltyYards, null, "do not infer the penalty yardage");
  assert.equal(frame.spotlight.highlights.at(-1)?.kind, "penalty", "live highlights use the same classification");
  assert.equal(frame.spotlight.drives.at(-1).plays.at(-1).penalty, "Intentional Grounding");
});

test("Texas–Ole Miss interception identifies the player", async () => {
  const option = REPLAY_GAMES.college;
  const summary = JSON.parse(gunzipSync(await readFile(new URL(`fixtures/games/${option.file}`, import.meta.url))));
  const frame = createReplayFrames(summary, option).find((item) => /intercepted by #0 J\.Crawford at TEXAS33/i.test(item.caption));
  assert.ok(frame);
  assert.match(highlightDetail(frame.event, frame.spotlight), /J\.Crawford/i);
});

test("Texas–Ole Miss zero-yard rush is not a tackle for loss", async () => {
  const option = REPLAY_GAMES.college;
  const summary = JSON.parse(gunzipSync(await readFile(new URL(`fixtures/games/${option.file}`, import.meta.url))));
  const frame = createReplayFrames(summary, option).find((item) => /M\.Frazier rush middle for 0 yards to the TEXAS45/i.test(item.caption));
  assert.ok(frame);
  assert.notEqual(frame.event?.kind, "tackle-for-loss");
});

test("Texas–Ole Miss blocked field goal alerts without mistaking the kick endpoint for the next spot", async () => {
  const option = REPLAY_GAMES.college;
  const summary = JSON.parse(gunzipSync(await readFile(new URL(`fixtures/games/${option.file}`, import.meta.url))));
  const frame = createReplayFrames(summary, option).find((item) => /field goal attempt from 58 yards NO GOOD blocked/i.test(item.caption));
  assert.ok(frame);
  assert.equal(frame.event?.kind, "blocked-field-goal");
  assert.equal(frame.event?.teamId, "251");
  assert.equal(highlightDetail(frame.event, frame.spotlight), "BLOCKED BY #97 A.January");
  assert.equal(frame.spotlight.ball, null, "the out-of-bounds kick endpoint is not a confirmed succeeding scrimmage spot");
});
