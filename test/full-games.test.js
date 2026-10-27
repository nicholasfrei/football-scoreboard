import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { normalizeGame } from "../src/scoreboard.js";
import { enrichGame } from "../src/gamecast.js";
import { getScoreboard } from "../src/espn.js";
import { gameHighlights } from "../src/highlights.js";
import { createHighlightTracker, highlightDetail } from "../public/highlights.js";
import { kickoffCountdown, nextRefreshDelay } from "../public/game-timing.js";
import { createBallPositionTracker } from "../public/ball-position.js";
import { comparePlays } from "../src/play-order.js";

const root = new URL("./fixtures/games/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
const fixtures = await Promise.all(manifest.map(async (entry) => {
  const raw = gunzipSync(await readFile(new URL(entry.file, root)));
  const summary = JSON.parse(raw);
  const drives = [...(summary.drives?.previous ?? []), summary.drives?.current].filter(Boolean);
  const plays = [...new Map(drives.flatMap((drive) => drive.plays ?? []).map((play) => [play.id, play])).values()]
    .sort(comparePlays);
  return { entry, raw, summary, drives, plays };
}));

function gameFromSummary(summary, league, teamId) {
  const competition = summary.header.competitions[0];
  return normalizeGame({ id: summary.header.id, date: competition.date, competitions: [competition] }, { league, teamId });
}

// Historical summaries are NOT captured live snapshots. These prefixes replay
// their actual plays/scores through the current-drive fallback without claiming
// to reproduce ESPN's live situation, revisions, or network delivery timing.
function replaySummary(fixture, index) {
  const { summary, drives, plays } = fixture;
  const play = plays[index];
  const visible = new Set(plays.slice(0, index + 1).map((item) => item.id));
  const current = drives.find((drive) => drive.plays?.some((item) => item.id === play.id));
  const prefix = (drive) => ({ ...drive, plays: plays.slice(0, index + 1).filter((item) => drive.plays.some((original) => original.id === item.id)) });
  const competition = summary.header.competitions[0];
  return {
    header: { ...summary.header, competitions: [{
      ...competition,
      competitors: competition.competitors.map((team) => ({ ...team, score: String(team.homeAway === "home" ? play.homeScore : play.awayScore) })),
      status: { period: play.period.number, displayClock: play.clock.displayValue, type: { state: "in", completed: false, detail: "Replay" } },
    }] },
    gameInfo: summary.gameInfo,
    scoringPlays: summary.scoringPlays.filter((item) => visible.has(item.id)),
    drives: { current: prefix(current), previous: drives.filter((drive) => drive !== current).map(prefix).filter((drive) => drive.plays.length) },
  };
}

test("fixture corpus contains five full NFL and five full NCAAF games, including the requested examples", () => {
  assert.equal(fixtures.length, 10);
  for (const league of ["nfl", "college-football"]) assert.equal(fixtures.filter(({ entry }) => entry.league === league).length, 5);
  for (const id of ["401873010", "401856732"]) assert.ok(manifest.some((entry) => entry.id === id));
  assert.equal(fixtures.reduce((sum, { plays }) => sum + plays.length, 0), 1849);
  assert.ok(manifest.some((entry) => entry.league === "nfl" && entry.periods.includes(5)));
  assert.ok(manifest.some((entry) => entry.league === "college-football" && entry.periods.includes(6)));
});

for (const fixture of fixtures) {
  const { entry, raw, summary, drives, plays } = fixture;
  test(`${entry.league}: ${entry.name} — complete, unmodified source and final API result`, async () => {
    assert.equal(createHash("sha256").update(raw).digest("hex"), entry.sha256);
    assert.equal(plays.length, entry.playCount);
    assert.equal(drives.length, entry.driveCount);
    assert.ok(plays.length >= 100);
    for (const period of [1, 2, 3, 4]) assert.ok(plays.some((play) => play.period?.number === period));
    assert.ok(summary.boxscore);
    assert.ok(summary.gameInfo);
    assert.ok(summary.scoringPlays.length);
    assert.equal(summary.header.competitions[0].playByPlaySource, "full");
    const competition = summary.header.competitions[0];
    const result = await getScoreboard({
      config: { league: entry.league, teamKey: entry.awayTeamId, timeZone: "America/Chicago" },
      now: new Date(Date.parse(competition.date) + 86_400_000),
      fetchImpl: async (url) => {
        if (url.includes("/schedule?")) return { ok: true, json: async () => ({
          team: competition.competitors.find((team) => team.homeAway === "away").team,
          season: summary.header.season,
          events: [{ id: entry.id, date: competition.date, competitions: [competition] }],
        }) };
        if (url.endsWith(`/summary?event=${entry.id}`)) return { ok: true, json: async () => summary };
        return { ok: false, status: 503 }; // No network or current metadata in historical tests.
      },
    });
    assert.equal(result.spotlight.state, "final");
    assert.equal(result.spotlight.selectedTeam.score, entry.awayScore);
    assert.equal(result.spotlight.opponent.score, entry.homeScore);
    assert.equal(result.spotlight.selectedTeam.id, entry.awayTeamId);
    assert.equal(result.spotlight.opponent.id, entry.homeTeamId);
    assert.equal(result.spotlight.venue, summary.gameInfo.venue.fullName);
    assert.ok(result.spotlight.broadcasts.length > 0);
    assert.equal(result.spotlight.ball, null);
    assert.equal(result.spotlight.drives.length, drives.length);
    for (const [category, name] of [["passingYards", "Passing Yards"], ["rushingYards", "Rushing Yards"], ["receivingYards", "Receiving Yards"]]) {
      const group = result.spotlight.leaders.find((item) => item.category === category);
      assert.ok(group);
      const expected = summary.leaders.flatMap((team) => team.leaders.filter((item) => item.displayName === name));
      assert.ok(group.leaders.length <= expected.length);
      for (const leader of group.leaders) {
        assert.ok(leader.name && leader.value && leader.team);
        assert.ok([entry.homeTeamId, entry.awayTeamId].includes(leader.teamId));
        const source = summary.leaders.find((team) => String(team.team.id) === leader.teamId)
          ?.leaders.find((item) => item.name === category)?.leaders[0];
        assert.equal(leader.yards, source.value);
        assert.equal(leader.shortName, source.athlete.shortName);
        assert.equal(leader.position, source.athlete.position.abbreviation);
        assert.equal(leader.summary, source.summary);
        assert.equal(leader.headshot, source.athlete.headshot?.href ?? null);
        assert.equal(leader.attempts, category === "passingYards" ? source.summary.match(/\b\d+\/\d+/)?.[0]
          : source.summary.match(category === "rushingYards" ? /\b\d+ CAR\b/ : /\b\d+ REC\b/)?.[0]);
        assert.equal(leader.touchdowns, Number(source.summary.match(/\b(\d+) TD\b/)?.[1] ?? 0));
      }
    }
    assert.equal(result.spotlight.currentDriveId, result.spotlight.drives.at(-1).id);
    for (const [index, drive] of result.spotlight.drives.entries()) {
      assert.equal(drive.id, String(drives[index].id));
      assert.equal(drive.teamId, String(drives[index].team.id));
      assert.equal(drive.description, drives[index].description);
      assert.equal(drive.plays.length, drives[index].plays.length);
      for (const play of drive.plays) {
        const source = drives.flatMap((item) => item.plays).findLast((item) => String(item.id) === play.id);
        const grounding = /\bPENALTY\s+(?:\S+\s+)?intentional grounding\b/i.test(source.text)
          && !/\b(?:declined|offsetting|offset)\b/i.test(source.text)
          && (!source.penalty?.status?.slug || source.penalty.status.slug === "accepted");
        assert.equal(play.penalty, source.penalty?.type?.text ?? (grounding ? "Intentional Grounding"
          : /penalty/i.test(source.type?.text ?? "") ? "Penalty" : null));
        const scoringTeam = summary.scoringPlays.find((item) => String(item.id) === play.id)?.team?.id;
        assert.equal(play.scoringTeamId, source.scoringPlay && scoringTeam != null ? String(scoringTeam) : null);
      }
    }
    assert.equal(result.spotlight.possessionTeamId, null);
    assert.equal(result.gamecastUnavailable, undefined);
    assert.equal(createHighlightTracker().observe(result), null);
    assert.equal(nextRefreshDelay(result), 300_000);
  });

  test(`${entry.league}: ${entry.name} — every play from both teams' perspectives`, () => {
    for (const teamId of [entry.homeTeamId, entry.awayTeamId]) {
      const base = gameFromSummary(summary, entry.league, teamId);
      const tracker = createHighlightTracker();
      const ballTracker = createBallPositionTracker();
      let replayNow = Date.parse(entry.kickoffAt);
      for (let index = 0; index < plays.length; index++) {
        const source = plays[index];
        const frame = replaySummary(fixture, index);
        const game = enrichGame(base, frame);
        assert.equal(game.state, "live");
        assert.equal(game.period, source.period.number);
        assert.equal(game.clock, source.clock.displayValue);
        assert.equal(game.selectedTeam.score, teamId === entry.homeTeamId ? source.homeScore : source.awayScore);
        assert.equal(game.opponent.score, teamId === entry.homeTeamId ? source.awayScore : source.homeScore);
        assert.deepEqual(game.plays, plays.slice(Math.max(0, index - 4), index + 1).reverse().map((play) => ({
          id: String(play.id), text: play.text, period: play.period.number, clock: play.clock.displayValue, scoring: Boolean(play.scoringPlay),
        })));
        assert.equal(game.currentDriveId, String(frame.drives.current.id));
        assert.deepEqual(game.drives.find((drive) => drive.id === game.currentDriveId).plays.map((item) => item.id),
          frame.drives.current.plays.map((item) => String(item.id)));
        assert.equal(game.latestPlaySequence, Math.max(...plays.slice(0, index + 1).map((play) => Number(play.sequenceNumber))));
        assert.equal(kickoffCountdown(game, replayNow), null);
        assert.equal(nextRefreshDelay({ spotlight: game }, replayNow), 15_000);
        if (/End of Game|Extra Point/i.test(source.type.text) || source.scoringPlay
            || (/Kickoff/i.test(source.type.text) && !/touchback|fair catch/i.test(`${source.type.text} ${source.text}`))) {
          assert.equal(game.ball, null, `${source.id}: no spurious ball between plays/periods`);
        }
        if (game.ball) {
          const positionPlay = frame.drives.current.plays.findLast((play) => !/Timeout|Two-minute warning|End Period|End of Half|End of Regulation/i.test(play.type.text));
          // Independently checked retained spots: an offsetting/nullified TD at
          // UCF 1 and an incompletion at MISS 27 both have invalid goal-line ends.
          const restoredSpot = { "401856835462": "UCF 1", "401856732698": "MISS 27" }[positionPlay.id];
          // ESPN's end coordinates disagree with the reported enforcement and
          // the following snap on these five plays; assert the actual spot.
          const enforcedSpot = {
            "401856732398": "TEX 5", "401856732535": "TEX 24", "401856835223": "BYU 33",
            "401856731182": "SC 3", "401856731356": "TENN 45",
          }[positionPlay.id];
          const positionEnd = restoredSpot ? positionPlay.start : positionPlay.end;
          if (restoredSpot) assert.equal(game.ball.label, restoredSpot);
          if (enforcedSpot) assert.equal(game.ball.label, enforcedSpot);
          const homePossession = positionEnd.team.id === entry.homeTeamId;
          const home = base.homeAway === "home" ? base.selectedTeam : base.opponent;
          const away = base.homeAway === "home" ? base.opponent : base.selectedTeam;
          const spot = /^(.*?)\s+(\d{1,2})$/.exec(enforcedSpot ?? positionEnd.possessionText ?? "");
          const named = spot && Number(spot[2]) <= 50 ? spot[1] === home.abbreviation ? 100 - Number(spot[2])
            : spot[1] === away.abbreviation ? Number(spot[2]) : null : null;
          if (game.ball.source !== "kick rule") {
            assert.equal(game.ball.percent, named ?? (homePossession ? positionEnd.yardsToEndzone : 100 - positionEnd.yardsToEndzone));
          }
          assert.equal(game.ball.direction, homePossession ? "left" : "right");
          assert.ok(["last reported play", "kick rule"].includes(game.ball.source));
          assert.equal(game.possessionTeamId, String(positionEnd.team.id));
          assert.ok(game.ball.percent >= 0 && game.ball.percent <= 100);
          if (game.ball.firstDownPercent !== null) assert.ok(game.ball.firstDownPercent >= 0 && game.ball.firstDownPercent <= 100);
        }
        const displayed = ballTracker.observe({ spotlight: game });
        if (displayed.ball && !game.fieldContext.scoring) {
          const gapSummary = { ...frame, drives: { previous: frame.drives.previous } };
          const gapGame = enrichGame(base, gapSummary);
          const held = ballTracker.observe({ spotlight: gapGame });
          assert.deepEqual(held.ball, displayed.ball, `${source.id}: an omitted current drive must not move or erase the ball`);
          assert.equal(held.ballHeld, true);
        }
        for (const event of game.highlights) {
          assert.ok(event.teamId === null || [entry.homeTeamId, entry.awayTeamId].includes(event.teamId));
          assert.equal(typeof highlightDetail(event, game), "string");
        }
        replayNow = Math.max(replayNow + 15_000, Date.parse(source.wallclock) || 0);
        tracker.observe({ spotlight: game }, replayNow);
        assert.equal(tracker.observe({ spotlight: game }, replayNow + 1), null, "repeated polls never replay a celebration");
      }
      const final = enrichGame(base, summary);
      assert.equal(final.state, "final");
      assert.equal(tracker.observe({ spotlight: final }, replayNow + 15_000), null);
      assert.equal(final.ball, null);
      assert.equal(final.possessionTeamId, null);
    }
  });
}

test("QB interceptions and QB/RB fumbles come from box scores, not assumed play text", () => {
  const fixture = fixtures.find(({ entry }) => entry.id === "401873020");
  const game = enrichGame(gameFromSummary(fixture.summary, "nfl", fixture.entry.awayTeamId), fixture.summary);
  const leader = (category, name) => game.leaders.find((item) => item.category === category)
    .leaders.find((item) => item.name === name);
  assert.equal(leader("passingYards", "Jordan Love").interceptions, 1);
  assert.equal(leader("passingYards", "Jared Goff").fumbles, 2);
  assert.equal(leader("rushingYards", "Jahmyr Gibbs").fumbles, 1);
  assert.equal(leader("receivingYards", "Amon-Ra St. Brown").fumbles, null);
});

test("every newly eligible saved play reaches the browser tracker, independently of sequence reuse", () => {
  for (const fixture of fixtures) {
    const { entry, summary, plays } = fixture;
    const base = gameFromSummary(summary, entry.league, entry.awayTeamId);
    let previous = enrichGame(base, replaySummary(fixture, 0));
    for (let index = 1; index < plays.length; index++) {
      const source = plays[index];
      const game = enrichGame(base, replaySummary(fixture, index));
      const tracker = createHighlightTracker();
      // These are controlled adjacent fresh polls, not claimed historical live
      // delivery times. Keep source timestamps intact and isolate event identity
      // from real-game pauses and late provider revisions.
      const now = Date.parse(source.wallclock);
      assert.ok(Number.isFinite(now), `${source.id}: this audit requires a recorded timestamp`);
      tracker.observe({ spotlight: previous }, now - 15_000);
      const emitted = tracker.observe({ spotlight: game }, now);
      const expected = gameHighlights([source], summary.scoringPlays, [entry.homeTeamId, entry.awayTeamId])[0];
      assert.equal(emitted?.id ?? null, expected?.id ?? null, `${entry.id}/${source.id}: a distinct eligible play must not be suppressed`);
      assert.equal(tracker.observe({ spotlight: game }, now + 1), null, `${source.id}: repeated polls stay silent`);
      previous = game;
    }
  }
});

test("missed field goals use the next possession spot instead of ESPN's line-of-scrimmage placeholder", () => {
  for (const [id, pattern, expected] of [
    ["401873010", /C\.Santos 53 yard field goal is No Good/, "NE 43"],
    ["401873020", /T\.Smack 26 yard field goal is No Good/, "DET 20"],
    ["401856727", /C\.Talty field goal attempt from 36 yards NO GOOD/, "TA&M 20"],
  ]) {
    const fixture = fixtures.find(({ entry }) => entry.id === id);
    const index = fixture.plays.findIndex((play) => pattern.test(play.text));
    assert.ok(index >= 0);
    const game = enrichGame(gameFromSummary(fixture.summary, fixture.entry.league, fixture.entry.awayTeamId), replaySummary(fixture, index));
    assert.equal(game.ball?.label, expected, fixture.plays[index].text);
    const nextPlay = fixture.plays.slice(index + 1).find((play) => !/Timeout|End Period/i.test(play.type.text));
    assert.equal(nextPlay?.start?.possessionText, expected, "the next recorded play confirms the spot");
  }
});

test("actual penalties, nullified plays, scoring attribution, turnovers and missed/blocked kicks remain distinct", () => {
  const types = new Set();
  const penaltyTypes = new Set();
  let nullified = 0;
  let pickSix = 0;
  let bundledConversions = 0;
  for (const { entry, summary, plays } of fixtures) {
    for (const play of plays) {
      types.add(play.type.text);
      if (play.penalty?.type?.text) penaltyTypes.add(play.penalty.type.text);
      const events = gameHighlights([play], summary.scoringPlays, [entry.homeTeamId, entry.awayTeamId]);
      const explicitCollegePenalty = entry.league === "college-football" && play.type.text === "Penalty"
        && !play.penalty && /\bPENALTY\b/i.test(play.text) && !/\b(?:declined|offsetting)\b/i.test(play.text);
      if (/no play|nullified/i.test(play.text) && play.penalty?.status?.slug !== "accepted" && !explicitCollegePenalty) {
        nullified++;
        assert.deepEqual(events, [], play.text);
      } else if (/no play|nullified/i.test(play.text)) {
        assert.equal(events.length, 1, play.text);
        assert.equal(events[0].kind, "penalty");
        assert.equal(events[0].teamId, null);
        if (play.penalty) {
          assert.equal(events[0].penaltyType, play.penalty.type.text);
          assert.equal(events[0].penaltyYards, Number.isFinite(play.penalty.yards) ? play.penalty.yards : null);
        } else {
          assert.ok(events[0].penaltyType && play.text.includes(events[0].penaltyType), "the infraction is explicitly reported");
          assert.ok(Number.isFinite(events[0].penaltyYards), "these college fixtures explicitly report enforcement yardage");
          assert.match(play.text, new RegExp(`\\b${events[0].penaltyYards}\\s+yards?\\b`, "i"));
        }
      } else if (/Touchdown/.test(play.type.text) && play.scoringPlay) {
        assert.equal(events.length, 1);
        assert.equal(events[0].kind, "touchdown");
        assert.equal(events[0].teamId, summary.scoringPlays.find((score) => score.id === play.id)?.team.id ?? String(play.end.team.id));
        if (/Interception/.test(play.type.text)) pickSix++;
        if (/kick|two.point|2.point/i.test(play.text)) bundledConversions++;
      } else if (/Field Goal Missed/.test(play.type.text)) {
        assert.deepEqual(events, [], "a failed kick is not a made-field-goal celebration");
      } else if (/Blocked Field Goal/.test(play.type.text)) {
        assert.equal(events[0]?.kind, "blocked-field-goal");
      }
    }
  }
  for (const type of ["Penalty", "Timeout", "End Period", "Sack", "Punt", "Punt Return", "Pass Interception Return", "Fumble Recovery (Own)", "Fumble Recovery (Opponent)", "Blocked Field Goal", "Field Goal Missed", "Interception Return Touchdown"]) assert.ok(types.has(type), type);
  for (const type of ["Offensive Holding", "False Start", "Defensive Pass Interference", "Roughing the Passer", "Offsetting", "Intentional Grounding"]) assert.ok(penaltyTypes.has(type), type);
  assert.ok(nullified > 0);
  assert.ok(pickSix > 0);
  assert.ok(bundledConversions > 0, "provider bundles some XP/two-point attempts into TD prose; do not infer extra plays");
});
