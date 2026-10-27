import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { normalizeGame } from "../src/scoreboard.js";
import { enrichGame } from "../src/gamecast.js";
import { createBallPositionTracker } from "../public/ball-position.js";

const summary = JSON.parse(gunzipSync(await readFile(new URL("./fixtures/games/college-football/401856835.json.gz", import.meta.url))));
const drive = [...summary.drives.previous, summary.drives.current].find((item) => item?.plays.some((play) => play.id === "401856835462"));
const nullified = drive.plays.find((play) => play.id === "401856835462");
const prior = drive.plays.find((play) => play.id === "401856835457");
const next = drive.plays.find((play) => play.id === "401856835470");

function frame(plays, situation) {
  const competition = summary.header.competitions[0];
  const last = plays.at(-1);
  return {
    header: { ...summary.header, competitions: [{ ...competition,
      competitors: competition.competitors.map((team) => ({ ...team, score: String(team.homeAway === "home" ? nullified.homeScore : nullified.awayScore) })),
      status: { period: 3, displayClock: last.clock.displayValue, type: { state: "in", completed: false } },
    }] },
    situation,
    drives: { current: { ...drive, plays }, previous: [] },
  };
}

function enrich(plays, teamId, situation) {
  const snapshot = frame(plays, situation);
  const competition = snapshot.header.competitions[0];
  const game = normalizeGame({ id: summary.header.id, date: competition.date, competitions: [competition] }, { league: "college-football", teamId });
  return enrichGame(game, snapshot);
}

for (const teamId of ["252", "2116"]) {
  test(`nullified BYU touchdown retains UCF 1 in adapter and browser, selected ${teamId}`, () => {
    const plays = drive.plays.slice(0, drive.plays.indexOf(nullified) + 1);
    const result = enrich(plays, teamId);
    assert.equal(result.ball?.percent, 99);
    assert.equal(result.ball.label, "UCF 1");
    assert.equal(result.ball.downDistance, "2nd & Goal at UCF 1");
    assert.equal(result.ball.firstDownPercent, 100);
    assert.equal(result.possessionTeamId, "252");
    assert.equal(next.start.possessionText, result.ball.label, "next snap independently confirms the retained spot");
    const tracker = createBallPositionTracker();
    tracker.observe({ spotlight: enrich(plays.slice(0, -1), teamId) });
    assert.equal(tracker.observe({ spotlight: result }).ball.percent, 99);
    const pause = { ...nullified, id: "pause", sequenceNumber: "102", type: { text: "Timeout" }, text: "Timeout", clock: { displayValue: "10:31" } };
    const paused = enrich([...plays, pause], teamId);
    assert.equal(paused.ball.percent, 99);
    assert.equal(tracker.observe({ spotlight: paused }).ball.percent, 99);
  });

  test(`nullification uses only defensible start/prior spots, selected ${teamId}`, () => {
    for (const text of ["TOUCHDOWN nullified by penalty. NO PLAY", "TOUCHDOWN nullified. Penalty declined. NO PLAY", "PENALTY offsetting. NO PLAY"]) {
      const play = { ...nullified, text };
      assert.equal(enrich([play], teamId).ball?.percent, 99);
      if (/declined|offsetting/i.test(text)) {
        const misleadingEnd = { ...prior.start, possessionText: "UCF 4", yardsToEndzone: 4 };
        assert.equal(enrich([{ ...play, end: misleadingEnd }], teamId).ball?.percent, 99, "a plausible but nullified end still cannot move the ball");
      }
      const missing = { ...play, start: undefined };
      assert.equal(enrich([prior, missing], teamId).ball?.percent, 99);
      assert.equal(enrich([missing], teamId).ball, null);
      const inconsistent = { ...play, start: { ...play.start, yardsToEndzone: 70 } };
      assert.equal(enrich([prior, inconsistent], teamId).ball?.percent, 99);
      assert.equal(enrich([inconsistent], teamId).ball, null);
      const invalid = { ...play, start: { ...play.start, possessionText: undefined, yardsToEndzone: 0, down: -1 } };
      assert.equal(enrich([invalid], teamId).ball, null);
    }
    const homePossession = { ...nullified, start: { ...nullified.start, team: { id: "2116" }, possessionText: "BYU 1" } };
    assert.equal(enrich([homePossession], teamId).ball?.percent, 1);
    assert.equal(enrich([homePossession], teamId).ball?.direction, "left");
    const score = { ...prior, scoringPlay: true, end: nullified.end };
    assert.equal(enrich([score, { ...nullified, start: undefined }], teamId).ball, null, "never reach back across a real score");
  });

  test(`accepted No Play enforcement is retained, selected ${teamId}`, () => {
    const end = { ...nullified.start, possessionText: "UCF 6", yardsToEndzone: 6, distance: 6, downDistanceText: "2nd & Goal at UCF 6" };
    for (const metadata of [
      { isPenalty: true, penalty: { status: { slug: "accepted" }, type: { text: "False Start" }, yards: 5 } },
      {}, // College feed: explicit penalty prose, no structured penalty metadata.
    ]) {
      const play = { ...nullified, ...metadata, type: { text: "Penalty" }, text: "PENALTY BYU False Start 5 yards to the UCF06. NO PLAY", end };
      assert.equal(enrich([prior, play], teamId).ball?.percent, 94);
      assert.equal(enrich([play], teamId).ball?.label, "UCF 6");
      assert.equal(enrich([{ ...play, type: { text: "Rush" } }], teamId).ball?.percent, 94, "explicit enforcement need not have Penalty type");
      assert.equal(enrich([{ ...play, end: { ...end, down: 0 } }], teamId).ball?.percent, 94, "try penalties can have down zero");
      if (metadata.penalty) {
        assert.equal(enrich([{ ...play, text: `${play.text}. Other penalty declined.` }], teamId).ball?.percent, 94, "a separate declined foul does not cancel structured acceptance");
      }
      assert.equal(enrich([{ ...play, end: nullified.end }], teamId).ball, null, "unknown enforcement must wait, not reuse invalid touchdown or pre-enforcement spot");
    }
  });

  test(`live situations and real scores retain priority, selected ${teamId}`, () => {
    const live = enrich([nullified], teamId, { possession: "2116", possessionText: "UCF 25", down: 1, distance: 10 });
    assert.equal(live.ball.percent, 75);
    assert.equal(live.possessionTeamId, "2116");
    assert.equal(live.ball.source, "current situation");
    const realScore = { ...nullified, text: "TOUCHDOWN. PENALTY UCF Offside declined", scoringPlay: true, type: { text: "Rushing Touchdown" } };
    const scored = enrich([prior, realScore], teamId);
    assert.equal(scored.ball, null);
    assert.equal(createBallPositionTracker().observe({ spotlight: scored }).ball, null);
  });
}

test("real text-only BYU–UCF No Play penalties retain their enforced spots", () => {
  const plays = [...summary.drives.previous, summary.drives.current].filter(Boolean).flatMap((item) => item.plays);
  for (const [id, percent, label] of [
    ["401856835390", 18, "BYU 18"],
    ["401856835671", 6, "BYU 6"],
    ["401856835821", 5, "BYU 5"], // A nullified made field goal, followed by accepted enforcement.
  ]) {
    const play = plays.find((item) => item.id === id);
    assert.equal(play.penalty, undefined);
    for (const teamId of ["252", "2116"]) {
      const result = enrich([play], teamId);
      assert.equal(result.ball?.percent, percent);
      assert.equal(result.ball.label, label);
    }
  }
});
