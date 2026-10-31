import test from "node:test";
import assert from "node:assert/strict";
import { possessionBranding } from "../public/possession-branding.js";

const game = {
  state: "live",
  possessionTeamId: "phi",
  selectedTeam: { id: "dal", color: "#002244" },
  opponent: { id: "phi", color: "#004C54", alternateColor: "#FFFFFF" },
};

test("possession badge follows the same matchup color as either team's end zone", () => {
  assert.deepEqual(possessionBranding(game), { color: "#004C54", ink: "#FFFFFF" });
  assert.deepEqual(possessionBranding({ ...game, possessionTeamId: "dal" }), { color: "#002244", ink: "#FFFFFF" });
});

test("away possession uses the contrasting alternate when its primary matches the home end zone", () => {
  const matchup = { ...game, homeAway: "home", selectedTeam: { id: "dal", color: "#00205B" },
    opponent: { id: "phi", color: "#0C2340", alternateColor: "#C99700" } };
  assert.deepEqual(possessionBranding(matchup), { color: "#C99700", ink: "#000000" });
  assert.deepEqual(possessionBranding({ ...matchup, possessionTeamId: "dal" }), {
    color: "#00205B", ink: "#FFFFFF",
  });
  assert.deepEqual(possessionBranding({ ...matchup, homeAway: "away", possessionTeamId: "dal" }), {
    color: "#00205B", ink: "#FFFFFF",
  });
});

test("light primary colors get contrasting dark text", () => {
  assert.deepEqual(possessionBranding({ ...game, opponent: { id: "phi", color: "#FFCC00" } }), {
    color: "#FFCC00", ink: "#000000",
  });
});

test("unknown possession, inactive games, and unavailable colors reset to neutral", () => {
  const neutral = { color: "#373e47", ink: "#cdd9e5" };
  for (const value of [null, { ...game, state: "final" }, { ...game, state: "scheduled" },
    { ...game, possessionTeamId: null }, { ...game, possessionTeamId: "unknown" },
    { ...game, opponent: { id: "phi" } }]) {
    assert.deepEqual(possessionBranding(value), neutral);
  }
});
