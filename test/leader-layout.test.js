import test from "node:test";
import assert from "node:assert/strict";
import { leaderCellItems } from "../public/leader-layout.js";

test("home leader cell mirrors away with positions between names and attempts", () => {
  const parts = { portrait: "portrait", name: "name", position: "position", attempts: "attempts", yards: "yards", touchdowns: "touchdowns", extras: "extras" };
  const away = leaderCellItems("away", parts);
  const home = leaderCellItems("home", parts);
  assert.deepEqual(away, ["portrait", "name", "position", "attempts", "yards", "touchdowns", "extras"]);
  assert.deepEqual(home, [...away].reverse());
});
