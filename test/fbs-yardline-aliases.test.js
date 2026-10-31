import test from "node:test";
import assert from "node:assert/strict";
import { fieldPercent, playTrajectory } from "../public/play-trajectory.js";
import { fbsYardlineAliases, additionalFbsAliases } from "../public/fbs-yardline-aliases.js";

const teams = new Map(fbsYardlineAliases.map(([id, name, abbreviation]) =>
  [id, { id, name, abbreviation }]));

function target(label, home, away) {
  const offense = away;
  return playTrajectory({ type: { text: "Pass Incompletion" },
    text: `QB pass incomplete thrown to ${label}20`,
    start: { team: { id: offense.id }, possessionText: `${offense.abbreviation} 25`,
      yardsToEndzone: 75, down: 2 }, end: {} }, offense.id, home, away);
}

test("one recorded ESPN game and play-text yard-line label for each of 138 FBS teams", () => {
  assert.equal(teams.size, 138);
  assert.equal(fbsYardlineAliases.length, 138, "team IDs must not repeat");
  for (const [id, name, abbreviation, label, game] of fbsYardlineAliases) {
    assert.match(game, /^\d{9}$/);
    assert.ok(name && abbreviation && label, id);
    const team = teams.get(id);
    const opponent = { id: "999999", abbreviation: "OTHER" };
    assert.equal(target(label, opponent, team)?.targetPercent, 20, `${name}: ${label} on own side`);
    assert.equal(target(label, team, opponent)?.targetPercent, 80, `${name}: ${label} on opponent side`);
    assert.equal(fieldPercent({ possessionText: `${label} 20` }, opponent, team), 20, name);
    assert.equal(target(label, opponent, { id: "999998", abbreviation: "OTHER" })?.targetPercent,
      null, `${name}: never resolve without the team in the matchup`);
    for (const alternate of additionalFbsAliases[id] ?? []) {
      assert.equal(target(alternate, opponent, team)?.targetPercent, 20, `${name}: ${alternate}`);
    }
  }
});

test("Arizona's ARI and ARIZ both work, without confusing NFL Kansas City (also ID 12)", () => {
  const arizona = teams.get("12");
  const opponent = { id: "2641", abbreviation: "TTU" };
  for (const label of ["ARI", "ARIZ"]) {
    assert.equal(target(label, opponent, arizona)?.targetPercent, 20);
    assert.equal(fieldPercent({ possessionText: `${label} 20` }, opponent, arizona), 20);
  }
  const chiefs = { id: "12", abbreviation: "KC" };
  assert.equal(target("ARI", opponent, chiefs)?.targetPercent, null);
  assert.equal(fieldPercent({ possessionText: "ARI 20" }, opponent, chiefs), null);
});

test("a shared label between two opponents is ambiguous, not first-team-wins", () => {
  const oregonState = teams.get("204");
  const oklahomaState = teams.get("197");
  assert.equal(target("OSU", oregonState, oklahomaState)?.targetPercent, null);
  assert.equal(fieldPercent({ possessionText: "OSU 20" }, oregonState, oklahomaState), null);
});
