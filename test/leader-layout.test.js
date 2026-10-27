import test from "node:test";
import assert from "node:assert/strict";
import { leaderCellItems, showGameLeaders } from "../public/leader-layout.js";

test("home leader cell mirrors away with positions between names and attempts", () => {
  const parts = { portrait: "portrait", name: "name", position: "position", attempts: "attempts", yards: "yards", touchdowns: "touchdowns", extras: "extras" };
  const away = leaderCellItems("away", parts);
  const home = leaderCellItems("home", parts);
  assert.deepEqual(away, ["portrait", "name", "position", "attempts", "yards", "touchdowns", "extras"]);
  assert.deepEqual(home, [...away].reverse());
});

test("leaders stay after the final but give way to the next kickoff countdown", () => {
  const leaders = [{ category: "passingYards", leaders: [{ teamId: "2", name: "M. Reed" }] }];
  assert.equal(showGameLeaders({ state: "live", leaders: [] }), true);
  assert.equal(showGameLeaders({ state: "final", leaders }), true);
  assert.equal(showGameLeaders({ state: "final", leaders: [{ category: "passingYards", leaders: [] }] }), false);
  assert.equal(showGameLeaders({ state: "scheduled", leaders }), false);
  assert.equal(showGameLeaders(null), false);
});
