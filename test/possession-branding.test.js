import test from "node:test";
import assert from "node:assert/strict";
import { possessionBranding } from "../public/possession-branding.js";

const game = {
  state: "live",
  possessionTeamId: "phi",
  selectedTeam: { id: "dal", color: "#002244" },
  opponent: { id: "phi", color: "#004C54", alternateColor: "#FFFFFF" },
};

test("possession badge follows either team's primary color, not its alternate", () => {
  assert.deepEqual(possessionBranding(game), { color: "#004C54", ink: "#FFFFFF" });
  assert.deepEqual(possessionBranding({ ...game, possessionTeamId: "dal" }), { color: "#002244", ink: "#FFFFFF" });
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
