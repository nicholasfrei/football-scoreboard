import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { gameHighlights } from "../src/highlights.js";
import { enrichGame } from "../src/gamecast.js";
import { createHighlightTracker, highlightDetail } from "../public/highlights.js";

const root = new URL("./fixtures/games/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
const games = await Promise.all(manifest.map(async (entry) => {
  const summary = JSON.parse(gunzipSync(await readFile(new URL(entry.file, root))));
  const plays = [...new Map([...(summary.drives?.previous ?? []), summary.drives?.current].filter(Boolean)
    .flatMap((drive) => drive.plays ?? []).map((play) => [String(play.id), play])).values()];
  return { entry, summary, plays, teamIds: [entry.homeTeamId, entry.awayTeamId] };
}));

// Independently transcribed examples: single/shared credits, initials, jersey
// numbers, multi-word/apostrophized/hyphenated surnames, suffixes and reviews.
const expectedPlayers = new Map([
  ["4018730101297", "L.Taylor"],
  ["401873010647", "M.Muhammad & D.Jackson"],
  ["4018730103547", "D.Thieneman & D.Hardy"],
  ["4018730103918", "C.Barmore"],
  ["401873016431", "H.To'oTo'o"],
  ["401873016770", "H.To'oTo'o & D.Hunter"],
  ["401873016975", "D.Alexander & A.Reese"],
  ["4018730161798", "M.McFadden"],
  ["4018730162892", "M.McFadden"],
  ["4018730141120", "K.Van Noy & C.Banks"],
  ["4018730141706", "A.Van Ginkel"],
  ["4018730074347", "L.Van Ness"],
  ["4018729971462", "D.Thomas & M.Collins"],
  ["401873001805", "L.Taylor & Dr.Jones"],
  ["4018730221507", "G.Karlaftis & C.Roland-Wallace"],
  ["40185673254", "#11 K.Thomas & #12 L.Ferrelli"],
  ["401856732330", "#92 C.Vasek"],
  ["401856732573", "#5 K.Franklin"],
  ["401856727623", "#3 M.Ratcliffe & #10 M.Jones"],
  ["401856731445", "#17 J.Okoronkwo"],
  ["401856731667", "#33 J.Norman & #18 T.Weathersby"],
  ["401856840526", "#15 A.Romaine & #10 A.Holmes Jr."],
  ["401856840733", "#44 M.Weedon & #17 B.Simms III"],
  ["401858495730", "#3 K.Perich & #28 A.Jones Jr."],
  ["401858500376", "#91 H.Russell IV"],
  ["401858274650", "#25 J.Dunnigan"],
  ["401866450436", "#2 S.Gardner, Jr. & #4 A.Alexander"],
  ["401866476242", "#30 A.Cherry, Jr. & #32 J.Reinbold"],
  ["401866476570", "#30 A.Cherry, Jr. & #48 N.VanTimmeren"],
  ["401856835101", null],
  ["40185672886", null],
  ["401858500806", null],
  ["401858270226", null],
]);

test("audited NFL and NCAAF defensive stop players reach the API and browser unchanged", () => {
  const found = new Set();
  for (const { entry, summary, plays } of games) {
    for (const play of plays.filter((item) => expectedPlayers.has(String(item.id)))) {
      const id = String(play.id);
      found.add(id);
      const original = structuredClone(play);
      const frame = enrichGame({ id: entry.id, league: entry.league, selectedTeam: { id: entry.homeTeamId } }, { ...summary,
        drives: { previous: [], current: { id: "audit", team: play.start.team, plays: [play] } },
      });
      const event = frame.highlights.find((item) => item.id === id);
      assert.ok(["sack", "tackle-for-loss"].includes(event?.kind), id);
      assert.equal(event.player, expectedPlayers.get(id), id);
      assert.equal(event.teamId, [entry.homeTeamId, entry.awayTeamId].find((team) => team !== String(play.start.team.id)), id);
      const label = event.kind === "sack" ? "SACK BY" : "STOPPED BY";
      assert.equal(highlightDetail(event, frame), event.player ? `${label} ${event.player}` : label, id);
      assert.deepEqual(play, original, "player extraction must not alter the provider play");
    }
  }
  assert.deepEqual(found, new Set(expectedPlayers.keys()));
});

test("defensive stop events across all 100 games retain every reported defender", () => {
  assert.equal(games.length, 100);
  const counts = {};
  const missing = [];
  for (const [index, { entry, summary, plays, teamIds }] of games.entries()) {
    for (const play of plays) {
      const event = gameHighlights([play], summary.scoringPlays, teamIds)[0];
      if (!["sack", "tackle-for-loss"].includes(event?.kind)) continue;
      // Independently read the first player-credit parentheses, skipping clock,
      // formation and prose groups. Pin the one changed attribution separately.
      const credit = [...play.text.split(/\(Original Play:/i)[0].matchAll(/\(([^()]*)\)/g)].map((match) => match[1])
        .find((group) => /^(?:sack split by |#\d+ )?[A-Z][a-zA-Z]{0,2}\./.test(group));
      const expected = String(play.id) === "4018730162892" ? "M.McFadden"
        : credit?.replace(/^sack split by /, "").replaceAll("; ", " & ").replaceAll(" and ", " & ")
          .replace(/, (?=(?:#\d+ )?[A-Z][a-zA-Z]{0,2}\.[A-Z])/g, " & ") ?? null;
      assert.equal(event.player, expected, `${play.id}: ${play.text}`);
      const key = `${entry.league}:${event.kind}`;
      if (index < 50) {
        counts[key] ??= { total: 0, named: 0, shared: 0 };
        counts[key].total++;
        if (event.player) {
          counts[key].named++;
          if (event.player.includes(" & ")) counts[key].shared++;
        } else missing.push(String(play.id));
      }
    }
  }
  assert.deepEqual(counts, {
    "nfl:tackle-for-loss": { total: 113, named: 113, shared: 33 },
    "nfl:sack": { total: 99, named: 99, shared: 13 },
    "college-football:tackle-for-loss": { total: 119, named: 115, shared: 32 },
    "college-football:sack": { total: 92, named: 92, shared: 16 },
  });
  assert.deepEqual(missing.sort(), ["401856835101", "40185672886", "401858500806", "401858270226"].sort());
});

function stop(text, type = "Sack") {
  return {
    id: "stop", sequenceNumber: "10", type: { text: type },
    text, statYardage: -2, scoringPlay: false, isTurnover: false,
    start: { team: { id: "8" }, down: 1 }, end: { team: { id: "8" }, down: 2 },
  };
}

test("missing, malformed and unrelated player mentions never become defender credits", () => {
  for (const text of [
    undefined,
    "Quarterback sacked; player unreported",
    "(Shotgun) A.QB sacked at ARK 20 for -2 yards. FUMBLES (B.Forcer).",
    "A.QB sacked at ARK 20 for -2 yards. Injury (C.Player).",
    "A.QB sacked at ARK 20 for -2 yards (TEAM).",
    "A.QB sacked at ARK 20 for -2 yards (unknown).",
    "A.QB sacked at ARK 20 for -2 yards (B.Defender; unknown).",
    "A.QB sacked at ARK 20 for -2 yards (B.Defender injured).",
    "A.QB sacked at ARK 20 for -2 yards (B.Defender). The play was REVERSED.",
    "A.QB sacked for loss of 2 yards to the ARK20, End Of Play (Original Play: A.QB sacked for loss of 2 yards to the ARK20 (B.Defender))",
  ]) {
    const event = gameHighlights([stop(text)], [], ["8", "238"])[0];
    assert.equal(event?.kind, "sack", text);
    assert.equal(event.player, null, text);
  }
  const rush = stop("A.Runner left end for -2 yards. Penalty declined (D.Player).", "Rush");
  assert.equal(gameHighlights([rush], [], ["8", "238"])[0].player, null);
});

test("named stops reach the live tracker once, without changing classification precedence", () => {
  for (const type of ["Sack", "Rush"]) {
    const play = stop("A.Runner for -2 yards (B.Defender, C.Helper).", type);
    const event = gameHighlights([play], [], ["8", "238"])[0];
    const game = { id: "game", league: "nfl", state: "live", latestPlaySequence: 9, highlights: [],
      selectedTeam: { id: "8" }, opponent: { id: "238" } };
    const tracker = createHighlightTracker();
    const now = Date.parse("2026-10-27T18:00:00Z");
    assert.equal(tracker.observe({ spotlight: game }, now), null);
    const payload = { spotlight: { ...game, latestPlaySequence: 10, highlights: [event] } };
    assert.equal(tracker.observe(payload, now + 1000)?.player, "B.Defender & C.Helper");
    assert.equal(tracker.observe(payload, now + 2000), null);
    assert.equal(highlightDetail({ ...event, teamId: null }, game), `${type === "Sack" ? "SACK" : "STOPPED"} BY B.Defender & C.Helper`);
    for (const text of ["A.QB sacked, NO PLAY", "A.QB sacked, nullified"]) {
      assert.deepEqual(gameHighlights([{ ...play, text }], [], ["8", "238"]), []);
    }
    const penalty = { ...play, penalty: { status: { slug: "accepted" }, type: { text: "Holding" }, yards: 10 } };
    assert.equal(gameHighlights([penalty], [], ["8", "238"])[0].player, null);
    const downs = { ...play, start: { down: 4, team: { id: "8" } }, end: { down: 1, team: { id: "238" } } };
    assert.equal(gameHighlights([downs], [], ["8", "238"])[0].kind, "turnover-on-downs");
  }
});
