import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { normalizeGame } from "../src/scoreboard.js";
import { enrichGame } from "../src/gamecast.js";
import { comparePlays } from "../src/play-order.js";

const root = new URL("./fixtures/games/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
const cases = [
  ["401856732", "401856732398", "TEX 5"],
  ["401856732", "401856732535", "TEX 24"],
  ["401856835", "401856835223", "BYU 33"],
  ["401856731", "401856731182", "SC 3"],
  ["401856731", "401856731356", "TENN 45"],
];

function snapshot(summary, drive, play, situation) {
  const competition = summary.header.competitions[0];
  return {
    header: { ...summary.header, competitions: [{ ...competition,
      competitors: competition.competitors.map((team) => ({ ...team,
        score: String(team.homeAway === "home" ? play.homeScore : play.awayScore) })),
      status: { period: play.period.number, displayClock: play.clock.displayValue,
        type: { state: "in", completed: false } },
    }] },
    situation,
    drives: { current: { ...drive, plays: [play] }, previous: [] },
    scoringPlays: [],
  };
}

test("five recorded enforced spots override contradictory fallback ends for both teams", async () => {
  for (const [gameId, playId, expected] of cases) {
    const entry = manifest.find((item) => item.id === gameId);
    const summary = JSON.parse(gunzipSync(await readFile(new URL(entry.file, root))));
    const drives = [...summary.drives.previous, summary.drives.current].filter(Boolean);
    const drive = drives.find((item) => item.plays?.some((play) => play.id === playId));
    const plays = [...new Map(drives.flatMap((item) => item.plays ?? []).map((play) => [play.id, play])).values()]
      .sort(comparePlays);
    const play = plays.find((item) => item.id === playId);
    const next = plays.slice(plays.indexOf(play) + 1).find((item) => !/Timeout|End Period|End of Half|End of Regulation/i.test(item.type.text));
    assert.equal(next?.start?.possessionText, expected, `${playId}: the following snap confirms the enforced spot`);
    for (const teamId of [entry.homeTeamId, entry.awayTeamId]) {
      const competition = summary.header.competitions[0];
      const base = normalizeGame({ id: gameId, date: competition.date, competitions: [competition] },
        { league: entry.league, teamId });
      const frame = snapshot(summary, drive, play);
      const result = enrichGame(base, frame);
      assert.equal(result.ball?.label, expected, `${playId}: fallback for ${teamId}`);
      assert.equal(result.possessionTeamId, String(play.end.team.id));
      const live = enrichGame(base, snapshot(summary, drive, play,
        { possession: String(play.end.team.id), possessionText: play.start.possessionText, down: 1, distance: 10 }));
      assert.equal(live.ball?.label, play.start.possessionText, `${playId}: live situation takes precedence`);
      assert.equal(live.ball?.source, "current situation");
    }
  }
});

test("uncorroborated aliases, rejected fouls and incomplete descriptions never override a provider spot", async () => {
  const entry = manifest.find((item) => item.id === "401856731");
  const summary = JSON.parse(gunzipSync(await readFile(new URL(entry.file, root))));
  const drive = [...summary.drives.previous, summary.drives.current]
    .find((item) => item?.plays?.some((play) => play.id === "401856731356"));
  const original = drive.plays.find((play) => play.id === "401856731356");
  const competition = summary.header.competitions[0];
  const base = normalizeGame({ id: summary.header.id, date: competition.date, competitions: [competition] },
    { league: entry.league, teamId: entry.awayTeamId });
  for (const text of [
    original.text.replace("from UTK30 to UTK45", "from XYZ30 to XYZ45"),
    original.text.replace("to UTK45", "to UTK45?"),
    `${original.text} declined`,
  ]) {
    const result = enrichGame(base, snapshot(summary, drive, { ...original, text }));
    assert.equal(result.ball?.label, "TENN 44", text);
  }
});
