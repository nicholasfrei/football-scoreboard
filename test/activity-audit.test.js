import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { playTrajectory } from "../public/play-trajectory.js";
import { kickPosition } from "../src/kick-position.js";
import { gameHighlights } from "../src/highlights.js";
import { reportedEnforcement } from "../src/penalty.js";
import { ballPositionFallback } from "../public/ball-position.js";
import { enrichGame } from "../src/gamecast.js";
import { normalizeGame } from "../src/scoreboard.js";
import { blockedFieldGoalReturnPosition } from "../src/blocked-kick-position.js";

const manifest = JSON.parse(readFileSync(new URL("./fixtures/games/manifest.json", import.meta.url)));
const fixture = (id, playId) => {
  const entry = manifest.find((item) => item.id === id);
  assert.ok(entry, id);
  const summary = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/games/${entry.file}`, import.meta.url))));
  const sides = summary.header.competitions[0].competitors;
  const home = sides.find((side) => side.homeAway === "home").team;
  const away = sides.find((side) => side.homeAway === "away").team;
  const drive = [...(summary.drives?.previous ?? []), summary.drives?.current].filter(Boolean)
    .find((item) => item.plays?.some((play) => play.id === playId));
  const play = drive?.plays.find((item) => item.id === playId);
  assert.ok(play, `${id}/${playId}`);
  return { entry, summary, home, away, drive, play,
    motion: () => playTrajectory(play, String(drive.team.id), home, away),
    event: () => gameHighlights([play], summary.scoringPlays, [home.id, away.id])[0],
    kick: () => kickPosition(play, entry.league, home, away, summary.header.season?.year) };
};

test("punt audit: a kicking-team foul advances the receiver; a blocked punt credits the blocker", () => {
  for (const [id, playId, label] of [
    ["401873001", "401873001587", "NYJ 42"],
    ["401873005", "4018730053999", "LV 49"],
    ["401872986", "4018729861164", "NE 28"],
  ]) assert.equal(fixture(id, playId).kick()?.label, label, playId);
  const blocked = fixture("401858497", "40185849723");
  assert.equal(blocked.event().kind, "blocked-punt");
  assert.equal(blocked.event().teamId, "135");
  assert.equal(blocked.motion(), null);
  for (const [id, playId, yards] of [["401856835", "401856835193", -2],
    ["401872999", "4018729992755", -1]]) {
    const returned = fixture(id, playId);
    assert.equal(returned.motion()?.returnYards, yards, playId);
    assert.notEqual(returned.motion()?.catchPercent, returned.motion()?.end, playId);
  }
  for (const [id, playId, expected] of [["401858497", "401858497731", "IOWA 32"],
    ["401858270", "401858270282", "CAL 20"], ["401856834", "401856834632", "KU 34"],
    ["401862811", "40186281161", "UTSA 44"], ["401858495", "401858495151", "ILL 20"]]) {
    const repaired = fixture(id, playId);
    assert.equal(repaired.motion()?.landingLabel, expected, playId);
  }
});

test("pass and loss audit: a named negative catch beats a corrupted goal-line endpoint", () => {
  const loss = fixture("401858497", "401858497583");
  assert.match(loss.play.text, /3 yards loss to the MINN07/);
  assert.deepEqual([loss.motion()?.kind, loss.motion()?.start, loss.motion()?.end, loss.motion()?.yards],
    ["pass", 90, 93, -3]);
  for (const [id, playId, expected] of [
    ["401856723", "40185672331", 41],
    ["401856720", "40185672016", 29],
    ["401856827", "40185682725", 38],
  ]) {
    const candidate = fixture(id, playId);
    assert.equal(candidate.motion()?.catchPercent, expected, playId);
  }
});

test("run and loss audit: declined fouls preserve confirmed motion and defensive takeovers", () => {
  const run = fixture("401873015", "4018730151134");
  assert.match(run.play.text, /declined/i);
  assert.deepEqual([run.motion()?.kind, run.motion()?.yards], ["run", 11]);
  const negative = fixture("401856732", "401856732330");
  assert.equal(negative.motion()?.yards, -2);
  const kneel = fixture("401873010", "4018730104206");
  assert.match(kneel.play.text, /kneels/i);
  assert.equal(kneel.motion(), null, "clock management must not be labeled as a run");
  const downs = fixture("401856718", "401856718407");
  assert.equal(downs.event()?.kind, "turnover-on-downs");
  assert.equal(downs.event()?.teamId, String(downs.play.end.team.id));
  const nullified = fixture("401872981", "40187298139");
  assert.equal(nullified.motion(), null);
});

test("fumble and kickoff audit: only confirmed kicking-team recoveries announce a fumble", () => {
  for (const [id, playId] of [["401872976", "4018729763845"], ["401866446", "401866446659"]]) {
    const recovery = fixture(id, playId);
    assert.equal(recovery.event()?.kind, "fumble", playId);
    assert.equal(recovery.event()?.teamId, String(recovery.play.end.team.id), playId);
  }
  const sack = fixture("401856827", "401856827187");
  assert.equal(sack.event()?.kind, "fumble");
  assert.equal(sack.event()?.teamId, "2305");
  const returnPlay = fixture("401858499", "401858499288");
  assert.deepEqual([returnPlay.motion()?.kind, returnPlay.motion()?.returnYards], ["fumble-return", 56]);
  const kickoff = fixture("401866450", "401866450487");
  const competition = kickoff.summary.header.competitions[0];
  const game = normalizeGame({ id: kickoff.entry.id, date: competition.date, competitions: [competition] },
    { league: kickoff.entry.league, teamId: kickoff.entry.awayTeamId });
  const prefix = { ...kickoff.summary, drives: { previous: [], current: { ...kickoff.drive, plays: kickoff.drive.plays
    .slice(0, kickoff.drive.plays.findIndex((play) => play.id === kickoff.play.id) + 1) } } };
  const displayed = enrichGame(game, { ...prefix, header: { ...prefix.header, competitions: [{ ...competition,
    status: { period: 1, displayClock: "14:47", type: { state: "in" } } }] } });
  assert.equal(ballPositionFallback(displayed), "TOUCHDOWN · awaiting next play");
});

test("field goal and punt foul audit: malformed kick endpoints do not become goal-line spots", () => {
  const blocked = fixture("401872975", "4018729752223");
  assert.equal(blocked.play.end.possessionText, "DEN 36");
  assert.equal(blockedFieldGoalReturnPosition(blocked.play, blocked.home, blocked.away)?.label, "DEN 46");
  for (const [id, playId, label] of [["401858488", "401858488554", "OSU 37"],
    ["401858500", "401858500612", "WIS 41"], ["401872975", "4018729752223", "DEN 46"]]) {
    const { summary, entry, drive, play } = fixture(id, playId);
    const competition = summary.header.competitions[0];
    const game = normalizeGame({ id: entry.id, date: competition.date, competitions: [competition] },
      { league: entry.league, teamId: entry.awayTeamId });
    const frame = { ...summary, header: { ...summary.header, competitions: [{ ...competition,
      status: { period: play.period.number, displayClock: play.clock.displayValue, type: { state: "in" } } }] },
      drives: { previous: [], current: { ...drive, plays: drive.plays.slice(0, drive.plays.indexOf(play) + 1) } } };
    const ball = enrichGame(game, frame).ball;
    assert.ok(ball && ball.percent > 0 && ball.percent < 100, playId);
    assert.equal(ball.label, label, playId);
  }
  for (const [id, playId, label] of [["401856834", "401856834632", "KU"],
    ["401862811", "40186281161", "TSA"], ["401856833", "401856833650", "UTAH"]]) {
    const { play } = fixture(id, playId);
    assert.ok(reportedEnforcement(play)?.to.side.startsWith(label), playId);
  }
});

test("kickoff audit: a confirmed return differs from an out-of-bounds kick", () => {
  const returned = fixture("401873010", "40187301040");
  assert.equal(returned.kick()?.label, "NE 31");
  const invalid = fixture("401856731", "401856731271");
  assert.equal(invalid.kick(), null);
  const fairCatch = fixture("401866450", "401866450800");
  assert.equal(fairCatch.kick()?.label, "WMU 25");
  assert.equal(fairCatch.kick()?.downDistance, null, "a corrected spot must not carry ESPN's stale caption");
});
