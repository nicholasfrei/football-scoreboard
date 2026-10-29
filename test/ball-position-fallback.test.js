import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { ballPositionFallback } from "../public/ball-position.js";
import { createReplayFrames, REPLAY_GAMES } from "../src/replay.js";

test("the recorded Cowboys return uses its confirmed spot, not a timeout caption", async () => {
  const option = REPLAY_GAMES.nfl;
  const summary = JSON.parse(gunzipSync(await readFile(new URL(`fixtures/games/${option.file}`, import.meta.url))));
  const kickoff = createReplayFrames(summary, option)[0].spotlight;
  assert.equal(kickoff.ball?.label, "DAL 35");
  assert.equal(kickoff.fieldContext.lastPlayType, "Kickoff");
  assert.equal(ballPositionFallback(kickoff), "Awaiting ball position");
  assert.equal(ballPositionFallback({ state: "live", fieldContext: { lastPlayType: "", scoring: false } }), "Awaiting ball position");
});

test("actual timeouts and scoring plays retain their distinct labels", () => {
  assert.equal(ballPositionFallback({ state: "live", fieldContext: { lastPlayType: "Timeout", scoring: false } }), "TIMEOUT · awaiting ball position");
  assert.equal(ballPositionFallback({ state: "live", fieldContext: { lastPlayType: "Touchdown", scoring: true } }), "TOUCHDOWN · awaiting next play");
  assert.equal(ballPositionFallback({ state: "live", fieldContext: { lastPlayType: "Field Goal", scoring: true } }), "SCORING PLAY · awaiting next play");
  assert.equal(ballPositionFallback({ state: "final" }), "FINAL");
  assert.equal(ballPositionFallback({ state: "scheduled" }), "Ball position appears during play");
});
