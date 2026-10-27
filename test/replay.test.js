import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createReplayFrames, REPLAY_GAMES } from "../src/replay.js";

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
