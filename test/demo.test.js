import test from "node:test";
import assert from "node:assert/strict";
import { createDemoFrames } from "../public/demo.js";
import { createHighlightTracker } from "../public/highlights.js";

test("Cowboys playback delivers first downs, TD, NFL XP, FG, punt, and blocked punt", () => {
  const frames = createDemoFrames();
  assert.equal(frames[0].team.name, "Dallas Cowboys");
  assert.equal(frames[0].league, "nfl");
  const tracker = createHighlightTracker();
  const events = frames.flatMap((frame, index) => {
    const event = tracker.observe(frame, index * 5_000);
    return event ? [{ ...event, game: frame.spotlight }] : [];
  });
  assert.equal(events.filter((event) => event.kind === "first-down").length, 6);
  const td = events.find((event) => event.kind === "touchdown");
  assert.equal(td.game.selectedTeam.score, 6);
  assert.equal(td.game.ball.percent, 100);
  assert.equal(events.find((event) => event.kind === "extra-point").game.selectedTeam.score, 7);
  const fg = events.find((event) => event.kind === "field-goal");
  assert.equal(fg.teamId, "21");
  assert.equal(fg.game.opponent.score, 3);
  const xpSetup = frames.find(({ spotlight }) => spotlight.ball?.downDistance === "XP attempt");
  assert.equal(xpSetup.spotlight.ball.label, "PHI 15");
  const punt = events.find((event) => event.kind === "punt");
  assert.equal(punt.teamId, "6");
  assert.equal(punt.game.possessionTeamId, "21");
  assert.equal(punt.game.ball.label, "PHI 35");
  const blocked = events.find((event) => event.kind === "blocked-punt");
  assert.equal(blocked.teamId, "6");
  assert.equal(blocked.game.possessionTeamId, "6");
  assert.equal(blocked.game.ball.label, "PHI 28");
  assert.equal(frames.at(-1).spotlight.selectedTeam.score, 7);
  assert.equal(frames.at(-1).spotlight.opponent.score, 3);
  for (const { spotlight: { ball } } of frames) {
    if (!ball) continue;
    assert.ok(ball.percent >= 0 && ball.percent <= 100);
    if (ball.firstDownPercent === null) continue;
    assert.ok(ball.direction === "right" ? ball.firstDownPercent >= ball.percent : ball.firstDownPercent <= ball.percent);
  }
});

test("demo snapshots are repeatable and earlier frames retain their own scores and plays", () => {
  const frames = createDemoFrames();
  assert.deepEqual(createDemoFrames(), frames);
  assert.equal(frames[0].spotlight.selectedTeam.score, 0);
  assert.equal(frames[0].spotlight.highlights.length, 0);
  assert.equal(frames[0].spotlight.plays.length, 1);
  assert.equal(frames.at(-1).spotlight.plays.length, 5);
});
