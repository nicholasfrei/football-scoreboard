import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { winChanceTeams } from "../public/win-chance.js";

const home = { id: "8", abbreviation: "ARK", color: "#A32136", alternateColor: "#FFFFFF" };
const away = { id: "142", abbreviation: "MIZ", color: "#F1B82D", alternateColor: "#000000" };

test("watched matchup colors only the higher-chance team with its end-zone color", () => {
  const game = { selectedTeam: home, opponent: away, homeAway: "home",
    matchupPredictor: { selectedTeam: 26, opponent: 74 } };
  assert.deepEqual(winChanceTeams(game), [
    { text: "ARK 26.0%", color: null, ink: null }, { text: "MIZ 74.0%", color: "#F1B82D", ink: "#000000" },
  ]);
  assert.deepEqual(winChanceTeams({ ...game, matchupPredictor: { selectedTeam: 90.2, opponent: 9.8 } }), [
    { text: "ARK 90.2%", color: "#A32136", ink: "#FFFFFF" }, { text: "MIZ 9.8%", color: null, ink: null },
  ]);
});

test("away favorite uses the alternate end-zone color when primaries are close", () => {
  const game = { homeAway: "away", selectedTeam: { id: "1", abbreviation: "AUB", color: "#0C2340", alternateColor: "#F26522" },
    opponent: { id: "2", abbreviation: "MISS", color: "#14213D" },
    matchupPredictor: { selectedTeam: 60, opponent: 40 } };
  assert.equal(winChanceTeams(game)[0].color, "#F26522");
  assert.equal(winChanceTeams(game)[0].ink, "#000000");
  assert.deepEqual(winChanceTeams({ ...game, matchupPredictor: { selectedTeam: 50, opponent: 50 } }).map((team) => team.color), [null, null]);
  assert.equal(winChanceTeams({ ...game, matchupPredictor: null }), null);
});

test("win-chance and possession badges fill with team color and use contrasting ink", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.win-chance-favorite\s*\{[^}]*background: var\(--win-chance-color\); color: var\(--win-chance-ink\);/);
  assert.match(css, /\.possession-team\s*\{[^}]*background: var\(--possession-color, #373e47\); color: var\(--possession-ink, #cdd9e5\);/);
});
