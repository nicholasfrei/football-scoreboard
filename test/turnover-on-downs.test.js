import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { gameHighlights } from "../src/highlights.js";
import { createHighlightTracker, HIGHLIGHT_LABELS, highlightDetail, highlightDuration } from "../public/highlights.js";

const root = new URL("./fixtures/games/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
const expectedIds = new Set([
  "401873010224", "4018730122836", "4018730123724", "4018730201680",
  "4018730203025", "4018730203808", "4018730223780", "401856835682",
  "401856835858", "401858496719", "401856731581", "401856731728",
  "4018730131386", "401873014129", "4018730182889", "4018730183549",
  "4018730183687", "4018730193495", "4018730194791", "401856840823",
  "401856728785", "401858500716", "401858500734", "401858500802",
]);

test("all 24 audited fourth-down takeovers credit the gaining team, despite isTurnover false", async () => {
  const found = new Set();
  for (const entry of manifest) {
    const summary = JSON.parse(gunzipSync(await readFile(new URL(entry.file, root))));
    const teamIds = summary.header.competitions[0].competitors.map((team) => String(team.id));
    const drives = [...(summary.drives?.previous ?? []), summary.drives?.current].filter(Boolean);
    const plays = [...new Map(drives.flatMap((drive) => drive.plays ?? []).map((play) => [String(play.id), play])).values()];
    for (const play of plays.filter((play) => expectedIds.has(String(play.id)))) {
      found.add(String(play.id));
      assert.equal(play.isTurnover, false, play.id);
      const events = gameHighlights([play], summary.scoringPlays, teamIds);
      assert.equal(events.length, 1, play.id);
      assert.equal(events[0].kind, "turnover-on-downs", play.id);
      assert.equal(events[0].teamId, String(play.end.team.id), play.id);
    }
  }
  assert.deepEqual(found, expectedIds);
});

test("all 75 recorded fourth-down takeovers in the expanded corpus credit the gaining team", async () => {
  let checked = 0;
  for (const entry of manifest) {
    const summary = JSON.parse(gunzipSync(await readFile(new URL(entry.file, root))));
    const teamIds = [entry.homeTeamId, entry.awayTeamId];
    const plays = [...new Map([...(summary.drives?.previous ?? []), summary.drives?.current].filter(Boolean)
      .flatMap((drive) => drive.plays ?? []).map((play) => [play.id, play])).values()];
    for (const play of plays) {
      const event = gameHighlights([play], summary.scoringPlays, teamIds)[0];
      if (event?.kind !== "turnover-on-downs") continue;
      assert.equal(play.start.down, 4, play.id);
      assert.equal(play.end.down, 1, play.id);
      assert.notEqual(String(play.start.team.id), String(play.end.team.id), play.id);
      assert.equal(event.teamId, String(play.end.team.id), play.id);
      checked++;
    }
  }
  assert.equal(checked, 75);
});

function play(overrides = {}) {
  return {
    id: "downs", sequenceNumber: "20", type: { text: "Rush" },
    text: "Rush stopped short", scoringPlay: false, isTurnover: false,
    start: { down: 4, team: { id: "8" } }, end: { down: 1, team: { id: "9" } },
    ...overrides,
  };
}
const classify = (value, teamIds = ["8", "9"], scoring = []) => gameHighlights([value], scoring, teamIds);

test("only confirmed fourth-down scrimmage possession changes qualify", () => {
  for (const type of ["Rush", "Pass Reception", "Pass Completion", "Pass Incompletion", "Sack"]) {
    assert.equal(classify(play({ type: { text: type } }))[0].kind, "turnover-on-downs", type);
  }
  assert.equal(classify(play({ isTurnover: true }))[0].kind, "turnover-on-downs");
  assert.equal(classify(play({ start: { down: 4, team: { id: 8 } }, end: { down: 1, team: { id: 9 } } }))[0].teamId, "9");
  for (const value of [
    play({ start: undefined }), play({ end: undefined }),
    ...[undefined, null, "4", 0, 1, 2, 3, 5].map((down) => play({ start: { down, team: { id: "8" } } })),
    ...[undefined, null, "1", -1, 0, 2, 4].map((down) => play({ end: { down, team: { id: "9" } } })),
    play({ start: { down: 4 } }), play({ end: { down: 1 } }),
    play({ end: { down: 1, team: { id: "8" } } }),
    play({ start: { down: 4, team: { id: "99" } } }),
    play({ end: { down: 1, team: { id: "99" } } }),
    play({ scoringPlay: true }), play({ text: "Rush, TOUCHDOWN" }),
    play({ text: "Rush fumbled and recovered" }), play({ text: "Pass intercepted" }),
    play({ text: "Rush nullified" }), play({ text: "Rush, NO PLAY" }),
    play({ text: "Rush overturned" }),
    play({ penalty: { status: { slug: "accepted" } } }),
    play({ text: "PENALTY enforced, loss of down" }),
    ...["Punt", "Kickoff", "Field Goal Missed", "Blocked Field Goal", "Blocked Punt", "Interception", "Fumble Recovery (Opponent)", "Penalty", "Timeout", "Two Point Rush"].map((text) => play({ type: { text } })),
  ]) assert.ok(!classify(value).some((event) => event.kind === "turnover-on-downs"), JSON.stringify(value));
  for (const ids of [[], ["8"], ["8", "8"], ["8", "9", "99"]]) {
    assert.ok(!classify(play(), ids).some((event) => event.kind === "turnover-on-downs"));
  }
});

test("existing scoring, interception, fumble and accepted-penalty precedence is retained", () => {
  for (const [value, kind] of [
    [play({ type: { text: "Rushing Touchdown" }, scoringPlay: true }), "touchdown"],
    [play({ type: { text: "Interception" } }), "interception"],
    [play({ type: { text: "Fumble Recovery (Opponent)" } }), "fumble"],
    [play({ penalty: { status: { slug: "accepted" }, type: { text: "Holding" }, yards: 10 } }), "penalty"],
  ]) assert.equal(classify(value)[0].kind, kind);
  assert.equal(classify(play(), ["8", "9"], [{ id: "downs", team: { id: "8" } }])[0].teamId, "9");
});

test("the browser accepts the new label and renders a confirmed defensive takeover for 15 seconds", () => {
  assert.equal(HIGHLIGHT_LABELS["turnover-on-downs"], "TURNOVER ON DOWNS");
  assert.equal(highlightDuration("turnover-on-downs"), 15_000);
  const event = classify(play())[0];
  const game = { id: "game", league: "nfl", state: "live", selectedTeam: { id: "8" }, opponent: { id: "9" }, highlights: [], latestPlaySequence: 19 };
  assert.equal(highlightDetail(event, game), "TAKEOVER BY");
  assert.equal(highlightDetail({ ...event, teamId: null }, game), "TEAM NOT CONFIRMED");
  const tracker = createHighlightTracker();
  const now = Date.parse("2026-10-27T18:00:00Z");
  assert.equal(tracker.observe({ spotlight: game }, now), null);
  assert.equal(tracker.observe({ spotlight: { ...game, latestPlaySequence: 20, highlights: [event] } }, now + 1000)?.kind, "turnover-on-downs");
});
