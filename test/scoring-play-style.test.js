import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fieldBranding } from "../public/field-branding.js";
import { scoringPlayColor } from "../public/scoring-style.js";

test("every scoring play has a persistent translucent white row highlight", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const rule = css.match(/#recent-plays li\.scoring-play\s*\{([^}]*)\}/);
  assert.ok(rule, "all scoring plays use the same row style");
  assert.match(rule[1], /background:\s*rgba\(255,\s*255,\s*255,\s*\.08\)/);
  assert.match(rule[1], /color:\s*#f4f1e8/);
  assert.match(rule[1], /border-left:\s*3px solid var\(--scoring-team-color, rgba\(255,\s*255,\s*255,\s*\.65\)\)/);
  assert.doesNotMatch(css, /\.scoring-needs-highlight \.play-description|--scoring-color/);
  assert.match(app, /item\.classList\.toggle\("scoring-play", play\.scoring\)/);
  assert.match(app, /const scoringColor = scoringPlayColor\(game, play\)/);
  assert.match(app, /if \(scoringColor\) item\.style\.setProperty\("--scoring-team-color", scoringColor\)/);
  assert.doesNotMatch(app, /scoringNeedsHighlight|scoring-needs-highlight/);
});

function matchup(home, away, homeAway = "home") {
  return { homeAway, selectedTeam: homeAway === "home" ? home : away, opponent: homeAway === "home" ? away : home };
}

test("scoring lines match each team's end zone regardless of the selected team", () => {
  const home = { id: "home", color: "#14213D", alternateColor: "#CE1126" };
  const away = { id: "away", color: "#F26522", alternateColor: "#FFFFFF" };
  for (const homeAway of ["home", "away"]) {
    const game = matchup(home, away, homeAway);
    assert.equal(scoringPlayColor(game, { scoring: true, scoringTeamId: home.id }), fieldBranding(home).color);
    assert.equal(scoringPlayColor(game, { scoring: true, scoringTeamId: away.id }), fieldBranding(away, home).color);
  }
});

test("similar primaries use the away secondary for both the scoring line and end zone", () => {
  for (const [homeColor, awayColor, alternateColor] of [
    ["#14213D", "#0C2340", "#F26522"],
    ["#DA291C", "#CC0033", "#003366"],
    ["#18453B", "#154733", "#FEE123"],
  ]) {
    const home = Object.freeze({ id: "home", color: homeColor });
    const away = Object.freeze({ id: "away", color: awayColor, alternateColor });
    for (const homeAway of ["home", "away"]) {
      const game = matchup(home, away, homeAway);
      assert.equal(scoringPlayColor(game, { scoring: true, scoringTeamId: away.id }), alternateColor);
      assert.equal(scoringPlayColor(game, { scoring: true, scoringTeamId: away.id }), fieldBranding(away, home).color);
      assert.equal(scoringPlayColor(game, { scoring: true, scoringTeamId: home.id }), homeColor);
    }
  }
});

test("defensive scores use the scorer, not the drive's offense or current possession", () => {
  const game = { ...matchup({ id: "1", color: "#14213D" }, { id: "2", color: "#F26522" }), possessionTeamId: "1" };
  assert.equal(scoringPlayColor(game, { scoring: true, scoringTeamId: 2, teamId: "1" }), "#F26522");
});

test("non-scoring plays and unconfirmed scoring teams keep a neutral line", () => {
  const game = matchup({ id: "home", color: "#14213D" }, { id: "away", color: "#F26522" });
  for (const play of [
    { scoring: false, scoringTeamId: "home" },
    { scoring: true },
    { scoring: true, scoringTeamId: null },
    { scoring: true, scoringTeamId: "unknown" },
  ]) assert.equal(scoringPlayColor(game, play), null);
});
