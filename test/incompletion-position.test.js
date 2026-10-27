import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createReplayFrames, REPLAY_GAMES } from "../src/replay.js";
import { createBallPositionTracker } from "../public/ball-position.js";
import { normalizeGame } from "../src/scoreboard.js";
import { enrichGame } from "../src/gamecast.js";

const option = REPLAY_GAMES.college;
const summary = JSON.parse(gunzipSync(await readFile(new URL(`fixtures/games/${option.file}`, import.meta.url))));
const frames = createReplayFrames(summary, option);
const index = frames.findIndex((frame) => frame.spotlight.period === 4 && frame.spotlight.clock === "12:54"
  && /pass incomplete.*H\.Fields.*MISS47/i.test(frame.caption));
const source = [...summary.drives.previous, summary.drives.current].filter(Boolean)
  .flatMap((drive) => drive.plays).find((play) => play.id === "401856732698");

function singlePlay(play, { situation, teamId = "145" } = {}) {
  const competition = summary.header.competitions[0];
  const snapshot = {
    header: { ...summary.header, competitions: [{ ...competition,
      status: { period: 4, displayClock: "12:54", type: { state: "in", completed: false } },
    }] },
    situation,
    drives: { previous: [], current: { id: "minimal", plays: [play] } },
  };
  const base = normalizeGame({ id: summary.header.id, date: competition.date, competitions: snapshot.header.competitions },
    { league: "college-football", teamId });
  return enrichGame(base, snapshot);
}

test("the pictured Q4 incompletion stays at MISS 27 and advances to third-and-three", () => {
  assert.ok(index > 0, "the exact pictured play exists in the stored game");
  assert.equal(frames[index - 1].spotlight.clock, "13:17");
  assert.equal(frames[index - 1].spotlight.ball.label, "MISS 27");
  const game = frames[index].spotlight;
  assert.equal(game.ball?.percent, 27, "an incomplete pass cannot move the ball to MISS 0");
  assert.equal(game.ball.label, "MISS 27");
  assert.equal(game.ball.downDistance, "3rd & 3 at MISS 27");
  assert.equal(game.ball.firstDownPercent, 30);
  assert.equal(game.possessionTeamId, "145");
});

test("the browser displays MISS 27 for the pictured incompletion, after a run and on direct load", () => {
  assert.ok(index > 0);
  for (const withPrevious of [false, true]) {
    const tracker = createBallPositionTracker();
    if (withPrevious) tracker.observe(frames[index - 1]);
    const displayed = tracker.observe(frames[index]);
    assert.equal(displayed.ball?.percent, 27);
    assert.equal(displayed.ball.label, "MISS 27");
    assert.equal(displayed.ball.firstDownPercent, 30);
  }
});

test("the exact play alone restores its start spot and next down without any prior or future plays", () => {
  for (const teamId of ["145", "251"]) {
    const game = singlePlay(source, { teamId });
    assert.equal(game.ball?.label, "MISS 27");
    assert.equal(game.ball.downDistance, "3rd & 3 at MISS 27");
    assert.equal(game.ball.firstDownPercent, 30);
    assert.equal(game.ball.direction, "right");
  }
});

test("ordinary incompletions recover from missing or goal-line placeholder endpoints", () => {
  for (const end of [
    undefined,
    { ...source.end, possessionText: "MISS 0", yardsToEndzone: 100 },
    { ...source.end, possessionText: "TEX 0", yardsToEndzone: 0 },
    { ...source.end, yardsToEndzone: undefined },
  ]) {
    const game = singlePlay({ ...source, end });
    assert.equal(game.ball?.percent, 27);
    assert.equal(game.ball.downDistance, "3rd & 3 at MISS 27");
    assert.equal(game.ball.firstDownPercent, 30);
  }
  const goal = singlePlay({ ...source, start: { ...source.start, possessionText: "TEX 5", yardsToEndzone: 5,
    distance: 5, downDistanceText: "2nd & Goal at TEX 5", shortDownDistanceText: "2nd & Goal" } });
  assert.equal(goal.ball?.label, "TEX 5");
  assert.equal(goal.ball.downDistance, "3rd & Goal at TEX 5");
  assert.equal(goal.ball.firstDownPercent, 100);
});

test("unknown or contradictory starts do not establish an incompletion spot", () => {
  for (const start of [undefined, { ...source.start, yardsToEndzone: 40 },
    { ...source.start, team: { id: "unknown" } }]) {
    assert.equal(singlePlay({ ...source, start }).ball, null);
  }
});

test("live situations, penalty enforcement and fourth-down possession changes retain priority", () => {
  const live = singlePlay(source, { situation: { possession: "145", possessionText: "MISS 40", down: 3, distance: 3 } });
  assert.equal(live.ball?.label, "MISS 40");
  assert.equal(live.ball.source, "current situation");
  const enforcement = { ...source, isPenalty: true,
    penalty: { status: { slug: "accepted" }, type: { text: "Roughing the Passer" }, yards: 15 },
    text: `${source.text} PENALTY TEX Roughing the Passer 15 yards from MISS27 to MISS42`,
    end: { ...source.end, down: 1, distance: 10, possessionText: "MISS 42", yardsToEndzone: 58 },
  };
  assert.equal(singlePlay(enforcement).ball?.label, "MISS 42");
  const fourth = { ...source, start: { ...source.start, down: 4 },
    end: { ...source.end, down: 1, distance: 10, team: { id: "251" }, possessionText: "MISS 27", yardsToEndzone: 27 },
  };
  const turnover = singlePlay(fourth);
  assert.equal(turnover.ball?.label, "MISS 27");
  assert.equal(turnover.possessionTeamId, "251");
  assert.equal(turnover.ball.direction, "left");
});

test("all 1,110 ordinary incompletions with trustworthy starts stay at their scrimmage spot", async () => {
  const root = new URL("fixtures/games/", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  let checked = 0;
  for (const entry of manifest) {
    const saved = JSON.parse(gunzipSync(await readFile(new URL(entry.file, root))));
    const replay = new Map(createReplayFrames(saved, { id: entry.id, league: entry.league, teamId: entry.awayTeamId })
      .map((frame) => [frame.spotlight.fieldContext.lastPlayId, frame.spotlight]));
    const competition = saved.header.competitions[0];
    const home = competition.competitors.find((team) => team.homeAway === "home").team;
    const away = competition.competitors.find((team) => team.homeAway === "away").team;
    const plays = [...new Map([...(saved.drives.previous ?? []), saved.drives.current].filter(Boolean)
      .flatMap((drive) => drive.plays).map((play) => [play.id, play])).values()];
    for (const play of plays) {
      if (play.type.text !== "Pass Incompletion" || play.scoringPlay || play.isPenalty || play.penalty
          || /\b(?:penalty|no play|nullified|overturned)\b/i.test(play.text)) continue;
      if (play.id === "401858274811") {
        assert.equal(play.start.possessionText, "MIA 5");
        assert.equal(play.start.yardsToEndzone, 0, "contradictory goal-line coordinate cannot confirm a spot");
        assert.equal(replay.get(play.id).ball, null);
        continue;
      }
      // Independent football invariant: an ordinary incompletion cannot move
      // the line of scrimmage. Do not copy the provider's end coordinate as
      // the expected result, which is exactly how this bug escaped the audit.
      const start = play.start;
      const match = /^(.*?)\s+(\d{1,2})$/.exec(start.possessionText ?? "");
      const expected = start.possessionText === "50" ? 50
        : match?.[1] === home.abbreviation ? 100 - Number(match[2])
          : match?.[1] === away.abbreviation ? Number(match[2]) : null;
      assert.notEqual(expected, null, `${play.id}: independently named scrimmage spot`);
      const game = replay.get(play.id);
      assert.equal(game.ball?.percent, expected, `${entry.id}/${play.id}: incompletion must not move the ball`);
      if (start.down < 4) {
        assert.equal(game.possessionTeamId, String(start.team.id), `${play.id}: retain offense before fourth down`);
        assert.match(game.ball.downDistance, new RegExp(`^${["1st", "2nd", "3rd", "4th"][start.down]} & `));
      }
      checked++;
    }
  }
  assert.equal(checked, 1110);
});
