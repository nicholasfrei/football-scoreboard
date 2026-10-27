import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createReplayFrames, REPLAY_GAMES } from "../src/replay.js";
import { createReplayLeaderTracker } from "../src/replay-leaders.js";
import { comparePlays } from "../src/play-order.js";

const summary = JSON.parse(gunzipSync(await readFile(new URL(`fixtures/games/${REPLAY_GAMES.nfl.file}`, import.meta.url))));
const plays = [...new Map((summary.drives.previous ?? []).flatMap((drive) => drive.plays ?? [])
  .map((play) => [String(play.id), play])).values()].sort(comparePlays);

test("Cowboys–Eagles replay tracks every player's passing, rushing and receiving totals to the final box score", () => {
  const tracker = createReplayLeaderTracker(summary);
  for (const play of plays) tracker.observe(play);
  for (const team of summary.boxscore.players) {
    for (const category of ["passing", "rushing", "receiving"]) {
      const group = team.statistics.find((item) => item.name === category);
      for (const { athlete, stats } of group.athletes) {
        const actual = tracker.statsFor(team.team.id, category, athlete.id);
        const expected = (label) => Number(stats[group.labels.indexOf(label)]);
        const context = `${team.team.abbreviation} ${athlete.displayName} ${category}`;
        assert.equal(actual?.yards ?? 0, expected("YDS"), `${context} yards`);
        assert.equal(actual?.touchdowns ?? 0, expected("TD"), `${context} touchdowns`);
        if (category === "passing") {
          const [completions, attempts] = stats[group.labels.indexOf("C/ATT")].split("/").map(Number);
          assert.equal(actual?.completions ?? 0, completions, `${context} completions`);
          assert.equal(actual?.attempts ?? 0, attempts, `${context} attempts`);
          assert.equal(actual?.interceptions ?? 0, expected("INT"), `${context} interceptions`);
        } else assert.equal(actual?.attempts ?? 0, expected(category === "rushing" ? "CAR" : "REC"), `${context} attempts`);
      }
    }
  }
});

test("Cowboys–Eagles replay has play-specific leaders, including the final frame", () => {
  const frames = createReplayFrames(summary, REPLAY_GAMES.nfl);
  const find = (frame, category, teamId) => frame.spotlight.leaders.find((group) => group.category === category)
    ?.leaders.find((player) => player.teamId === teamId);
  assert.equal(find(frames[0], "passingYards", "6"), undefined, "do not show final stats before the first pass");
  assert.equal(find(frames[1], "rushingYards", "6")?.yards, 6);
  assert.equal(find(frames[2], "passingYards", "6")?.attempts, "1/1");
  assert.equal(find(frames[2], "passingYards", "6")?.position, "QB");
  assert.equal(find(frames[2], "receivingYards", "6")?.yards, 5);
  assert.equal(find(frames[2], "receivingYards", "6")?.position, "TE");
  for (const [index, frame] of frames.entries()) {
    for (const group of frame.spotlight.leaders) {
      for (const player of group.leaders) assert.ok(player.position, `play ${index + 1}: ${player.name} has a position`);
    }
  }
  const nullified = frames.findIndex((frame) => /TOUCHDOWN NULLIFIED/i.test(frame.caption));
  assert.ok(nullified > 0);
  assert.deepEqual(frames[nullified].spotlight.leaders, frames[nullified - 1].spotlight.leaders);
  const final = frames.at(-1);
  for (const [category, away, home] of [["passingYards", 212, 211], ["rushingYards", 155, 62], ["receivingYards", 74, 67]]) {
    assert.equal(find(final, category, "6")?.yards, away);
    assert.equal(find(final, category, "21")?.yards, home);
  }
  assert.equal(find(final, "passingYards", "21")?.attempts, "23/35");
  assert.equal(find(final, "passingYards", "21")?.interceptions, 1);
});
