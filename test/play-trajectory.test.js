import test from "node:test";
import assert from "node:assert/strict";
import { playTrajectory, driveTrack } from "../public/play-trajectory.js";
import { illustratedDrive, lastDriveSnap, yardageLabel } from "../public/drive-illustration.js";
import { createReplayFrames, REPLAY_GAMES } from "../src/replay.js";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const away = { id: "1", abbreviation: "AWY" };
const home = { id: "2", abbreviation: "HME" };
const spot = (team, label, yardsToEndzone, down = 1) => ({ team: { id: team }, possessionText: label, yardsToEndzone, down });
const play = (type, start, end, extra = {}) => ({ type: { text: type }, text: type,
  start: spot("1", start, 100 - Number(start.split(" ").at(-1))),
  end: spot("1", end, 100 - Number(end.split(" ").at(-1))), ...extra });

test("away and home runs gain yards in their own attacking directions", () => {
  assert.deepEqual(playTrajectory(play("Rush", "AWY 25", "AWY 31"), "1", home, away),
    { kind: "run", start: 25, end: 31, yards: 6, yac: null, catchPercent: null, label: "RUN" });
  const reverse = { type: { text: "Rush" }, text: "Rush", start: spot("2", "HME 25", 75), end: spot("2", "HME 32", 68) };
  assert.equal(playTrajectory(reverse, "2", home, away).yards, 7);
  assert.equal(playTrajectory(play("Rush", "AWY 31", "AWY 25"), "1", home, away).yards, -6);
});

test("passes arc at a fixed height regardless of gain and never move off the center at their ends", () => {
  const pass = playTrajectory(play("Pass Reception", "AWY 40", "HME 30", {
    end: spot("1", "HME 30", 70),
  }), "1", home, away);
  assert.equal(pass.end, 70);
  assert.equal(yardageLabel(pass), "PASS · +30 YDS");
  const short = playTrajectory(play("Pass Reception", "AWY 40", "AWY 43"), "1", home, away);
  for (const trajectory of [pass, short]) {
    const { segment } = illustratedDrive({ plays: [{ id: "p", trajectory }] });
    assert.equal(segment.path, `M ${segment.from} 220 Q ${(segment.from + segment.to) / 2} 70 ${segment.to} 220`);
  }
  const reverse = playTrajectory({ type: { text: "Pass Reception" }, text: "pass deep left to receiver for 18 yards",
    start: spot("2", "HME 30", 70), end: spot("2", "HME 48", 52) }, "2", home, away);
  assert.match(illustratedDrive({ plays: [{ id: "home", trajectory: reverse }] }).segment.path, / 220 Q .* 70 .* 220$/);
  const caughtAtSnap = playTrajectory(play("Pass Reception", "AWY 30", "AWY 38", {
    text: "pass short right to receiver for 8 yards", statYardage: 8, yardsAfterCatch: 8,
  }), "1", home, away);
  const zeroAir = illustratedDrive({ plays: [{ id: "zero", trajectory: caughtAtSnap }] }).segment;
  assert.equal(zeroAir.from, zeroAir.to);
  assert.match(zeroAir.path, / 220 C .* 120 .* 120 .* 220$/);
});

test("incomplete passes with no reported target never claim an estimated yard line", () => {
  const miss = playTrajectory(play("Pass Incompletion", "AWY 40", "AWY 40", { end: {} }), "1", home, away);
  assert.equal(miss.end, miss.start);
  assert.equal(miss.yards, 0);
  assert.equal(yardageLabel(miss), "INCOMPLETE · 0 YDS");
  const track = illustratedDrive({ direction: "right", plays: [{ id: "p", trajectory: miss }] });
  assert.equal(track.segment.path, null);
  assert.equal(track.segment.target, null);
  assert.equal(track.start, 40);
  assert.equal(track.end, 40);
  assert.equal(track.progressPath, null);
  const left = illustratedDrive({ direction: "left", plays: [{ id: "p", trajectory: miss }] });
  assert.equal(left.segment.target, null);
  const nearGoal = illustratedDrive({ direction: "right", plays: [{ id: "p", trajectory: { ...miss, start: 96, end: 96 } }] });
  assert.equal(nearGoal.segment.target, null);
});

test("NFL short and deep incompletions have a schematic arc without a claimed landing spot", () => {
  for (const [depth, distance] of [["short", 10], ["deep", 30]]) {
    const miss = playTrajectory(play("Pass Incompletion", "AWY 40", "AWY 40", {
      text: `(Shotgun) QB pass incomplete ${depth} right to Receiver (Defender).`,
    }), "1", home, away);
    const { segment } = illustratedDrive({ plays: [{ id: depth, trajectory: miss }] });
    assert.equal(miss.targetPercent, null);
    assert.equal(segment.target, null);
    assert.equal(segment.to, 104 + (40 + distance) * 7.92);
    assert.equal(segment.path, `M ${segment.from} 220 Q ${(segment.from + segment.to) / 2} 70 ${segment.to} 220`);
    assert.equal(yardageLabel(segment), "INCOMPLETE · 0 YDS");
  }
  const goal = playTrajectory(play("Pass Incompletion", "AWY 95", "AWY 95", {
    text: "QB pass incomplete deep right to Receiver.",
  }), "1", home, away);
  assert.equal(illustratedDrive({ plays: [{ id: "goal", trajectory: goal }] }).segment.to, 104 + 100 * 7.92);
});

test("NFL pass wording covers both depths and all three directions for each outcome", () => {
  for (const offense of [away, home]) {
    const direction = offense === away ? 1 : -1;
    const start = spot(offense.id, `${offense.abbreviation} 40`, 60);
    const end = spot(offense.id, `${offense.abbreviation} 48`, 52);
    const defense = offense === away ? home : away;
    for (const depth of ["short", "deep"]) for (const side of ["left", "middle", "right"]) {
      const base = { start, end, statYardage: 8, yardsAfterCatch: 3 };
      const completed = playTrajectory({ ...base, type: { text: "Pass Reception" },
        text: `QB pass ${depth} ${side} to Receiver for 8 yards.` }, offense.id, home, away);
      assert.equal(completed?.kind, "pass");
      assert.equal(completed.yards, 8);
      assert.equal(completed.catchPercent, completed.start + 5 * direction);
      const incomplete = playTrajectory({ ...base, end: {}, type: { text: "Pass Incompletion" },
        text: `QB pass incomplete ${depth} ${side} to Receiver.` }, offense.id, home, away);
      assert.equal(incomplete?.kind, "incomplete");
      assert.equal(incomplete.schematicYards, depth === "short" ? 10 : 30);
      const graphic = illustratedDrive({ direction: direction === 1 ? "right" : "left",
        plays: [{ id: "miss", trajectory: incomplete }] });
      assert.equal(graphic.segment.to, 104 + (incomplete.start + incomplete.schematicYards * direction) * 7.92);
      const intercepted = playTrajectory({ ...base, type: { text: "Pass Interception Return" },
        text: `QB pass ${depth} ${side} intended for Receiver INTERCEPTED by Defender at ${offense.abbreviation} 48.`,
        isTurnover: true, statYardage: 0, end: { ...end, team: { id: defense.id } } }, offense.id, home, away);
      assert.equal(intercepted?.kind, "interception");
      assert.equal(intercepted.catchPercent, completed.end);
      assert.equal(intercepted.returnYards, 0);
    }
  }
});

test("saved NFL fourth-down completions keep their pass arc when possession changes", () => {
  for (const [game, id, yards] of [
    ["401873020", "4018730201680", 0], ["401873022", "4018730223780", 3],
    ["401873019", "4018730193495", 6], ["401873002", "401873002721", 2],
    ["401873006", "4018730063602", 5], ["401872987", "4018729873545", 6],
    ["401872992", "4018729924158", 9], ["401872969", "4018729694490", 9],
  ]) {
    const summary = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/games/nfl/${game}.json.gz`, import.meta.url))));
    const sides = summary.header.competitions[0].competitors;
    const h = sides.find((side) => side.homeAway === "home").team;
    const a = sides.find((side) => side.homeAway === "away").team;
    const raw = summary.drives.previous.flatMap((drive) => drive.plays).find((play) => play.id === id);
    const offenseId = String(raw.start.team.id);
    const motion = playTrajectory(raw, offenseId, h, a);
    assert.equal(motion?.kind, "pass", id);
    assert.equal(motion.yards, yards, id);
    assert.ok(illustratedDrive({ plays: [{ id, trajectory: motion }] }).segment.path, id);
    for (const variant of [
      { start: { ...raw.start, down: 3 } },
      { statYardage: yards + 1 },
      { start: { ...raw.start, distance: yards } },
      { text: `${raw.text} FUMBLES, recovered by defense.` },
    ]) assert.equal(playTrajectory({ ...raw, ...variant }, offenseId, h, a), null, id);
  }
});

test("NFL interceptions recognize WAS prose with WSH structured spots", () => {
  const summary = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/games/nfl/401872965.json.gz", import.meta.url))));
  const sides = summary.header.competitions[0].competitors;
  const h = sides.find((side) => side.homeAway === "home").team;
  const a = sides.find((side) => side.homeAway === "away").team;
  for (const [id, pick, end, yards] of [["4018729651368", 66, 63, 3], ["4018729652279", 73, 80, 7]]) {
    const raw = summary.drives.previous.flatMap((drive) => drive.plays).find((play) => play.id === id);
    const motion = playTrajectory(raw, String(raw.start.team.id), h, a);
    assert.equal(motion?.kind, "interception", id);
    assert.deepEqual([motion.catchPercent, motion.end, motion.returnYards], [pick, end, yards], id);
  }
});

test("reported incompletion targets resolve both sides, zero, midfield and provider team aliases", () => {
  const teams = [{ id: "251", abbreviation: "TEX" }, { id: "145", abbreviation: "MISS" }];
  const candidate = (text, start, offenseId = "145") => ({ type: { text: "Pass Incompletion" }, text,
    start: { ...spot(offenseId, start, 75), down: 2 }, end: {} });
  const target = (text, start, offenseId) => playTrajectory(candidate(text, start, offenseId), offenseId ?? "145", ...teams);
  assert.equal(target("pass incomplete thrown to MISS28", "MISS 25").targetPercent, 28);
  assert.equal(target("pass incomplete thrown to TEXAS04", "TEX 29").targetPercent, 96);
  assert.equal(target("pass incomplete thrown to MISS00", "MISS 5", "251").targetPercent, 0);
  assert.equal(target("pass incomplete thrown to MISS50", "MISS 25").targetPercent, 50);
  assert.equal(target("pass incomplete to receiver", "MISS 25").targetPercent, null);
  assert.equal(target("pass incomplete thrown to UNKNOWN30", "MISS 25").targetPercent, null);
  const miss = target("pass incomplete thrown to TEXAS04", "TEX 29");
  const graphic = illustratedDrive({ direction: "right", plays: [{ id: "p", trajectory: miss }] });
  assert.equal(graphic.segment.target, 96);
  assert.equal(graphic.segment.path, `M ${104 + 71 * 7.92} 220 Q ${(graphic.segment.from + graphic.segment.to) / 2} 70 ${graphic.segment.to} 220`);
  assert.equal(yardageLabel(graphic.segment), "INCOMPLETE · 0 YDS · TARGET TEX 4");
});

test("NFL YAC places the catch before the reported final spot; unknown splits stay unknown", () => {
  const completed = play("Pass Reception", "AWY 30", "HME 28", {
    statYardage: 42, yardsAfterCatch: 8,
  });
  const motion = playTrajectory(completed, "1", home, away);
  assert.equal(motion.catchPercent, 64);
  assert.equal(motion.yac, 8);
  assert.equal(yardageLabel(motion), "PASS · +42 YDS · 8 YAC");
  const graphic = illustratedDrive({ direction: "right", plays: [{ id: "p", trajectory: motion }] });
  assert.equal(graphic.segment.to, 104 + 64 * 7.92);
  assert.equal(graphic.segment.finish, 104 + 72 * 7.92);
  assert.match(graphic.segment.yacPath, / L /);
  assert.equal(graphic.segment.path, `M ${104 + 30 * 7.92} 220 Q ${(graphic.segment.from + graphic.segment.to) / 2} 70 ${graphic.segment.to} 220`);

  const reverse = { ...completed, start: spot("2", "HME 30", 70), end: spot("2", "AWY 28", 72) };
  assert.equal(playTrajectory(reverse, "2", home, away).catchPercent, 36);
  for (const variant of [{ yardsAfterCatch: undefined }, { statYardage: 41 }, { yardsAfterCatch: 90 }]) {
    const unknown = playTrajectory({ ...completed, ...variant }, "1", home, away);
    assert.equal(unknown.yac, null);
    assert.equal(unknown.catchPercent, null);
  }
});

test("college caught-at spot supplies the air route and YAC without NFL structured YAC", () => {
  const collegeHome = { id: "251", abbreviation: "TEX" };
  const collegeAway = { id: "145", abbreviation: "MISS" };
  const candidate = { type: { text: "Pass Reception" },
    text: "A.Manning pass complete short left caught at TEXAS40, for 12 yards to the TEXAS44",
    statYardage: 12, start: spot("251", "TEX 32", 68), end: spot("251", "TEX 44", 56) };
  const motion = playTrajectory(candidate, "251", collegeHome, collegeAway);
  assert.equal(motion.catchPercent, 60);
  assert.equal(motion.yac, 4);
  assert.equal(yardageLabel(motion), "PASS · +12 YDS · 4 YAC");
  const graphic = illustratedDrive({ plays: [{ id: "college", trajectory: motion }] });
  assert.equal(graphic.segment.to, 104 + 60 * 7.92);
  assert.equal(graphic.segment.finish, 104 + 56 * 7.92);
  assert.match(graphic.segment.path, / 220 Q .* 70 .* 220$/);
  assert.ok(graphic.segment.yacPath);
});

test("Texas–Ole Miss bundled touchdown reaches MISS 0 after the catch at MISS 8", () => {
  const summary = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/games/college-football/401856732.json.gz", import.meta.url))));
  const sides = summary.header.competitions[0].competitors;
  const h = sides.find((side) => side.homeAway === "home").team;
  const a = sides.find((side) => side.homeAway === "away").team;
  const raw = summary.drives.previous.flatMap((drive) => drive.plays).find((play) => play.id === "401856732254");
  assert.equal(raw.end.yardsToEndzone, 8, "provider retains the catch spot as the numeric endpoint");
  const trajectory = playTrajectory(raw, "251", h, a);
  assert.deepEqual([trajectory.kind, trajectory.start, trajectory.catchPercent, trajectory.end, trajectory.yac],
    ["pass", 50, 8, 0, 8]);
  const segment = illustratedDrive({ direction: "left", plays: [{ id: raw.id, trajectory }] }).segment;
  assert.equal(segment.yacPath, `M ${104 + 8 * 7.92} 220 L ${104} 220`);
});

test("defensive fumble touchdowns use a red route, not a white offensive gain", () => {
  for (const [file, id, offenseId, expected] of [
    ["401856732", "401856732476", "251", [77, 100, null]],
    ["401856718", "401856718447", "238", [87, 100, 95]],
  ]) {
    const summary = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/games/college-football/${file}.json.gz`, import.meta.url))));
    const sides = summary.header.competitions[0].competitors;
    const h = sides.find((side) => side.homeAway === "home").team;
    const a = sides.find((side) => side.homeAway === "away").team;
    const raw = summary.drives.previous.flatMap((drive) => drive.plays).find((play) => play.id === id);
    const motion = playTrajectory(raw, offenseId, h, a);
    assert.deepEqual([motion.kind, motion.start, motion.end, motion.catchPercent], ["fumble-return", ...expected]);
    const { segment } = illustratedDrive({ direction: "left", plays: [{ id, trajectory: motion }] });
    assert.equal(segment.path, motion.catchPercent === null ? null : `M ${segment.from} 220 L ${segment.to} 220`);
    assert.equal(segment.returnPath, `M ${motion.catchPercent === null ? segment.from : segment.to} 220 L ${segment.finish} 220`);
    assert.equal(yardageLabel(segment), "FUMBLE RETURN");
  }
  assert.equal(playTrajectory(play("Rush", "AWY 25", "AWY 31", { scoringPlay: true,
    text: "Rush for 6 yards TOUCHDOWN" }), "1", home, away)?.kind, "run");
});

test("saved NFL defensive fumble scores distinguish recovery from the red return", () => {
  for (const [file, id] of [["401873018", "4018730181087"], ["401872987", "4018729872643"],
    ["401872992", "4018729922147"], ["401872993", "401872993486"]]) {
    const summary = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/games/nfl/${file}.json.gz`, import.meta.url))));
    const sides = summary.header.competitions[0].competitors;
    const h = sides.find((side) => side.homeAway === "home").team;
    const a = sides.find((side) => side.homeAway === "away").team;
    const drive = summary.drives.previous.find((item) => item.plays.some((play) => play.id === id));
    const raw = drive.plays.find((play) => play.id === id);
    const motion = playTrajectory(raw, String(drive.team.id), h, a);
    assert.equal(motion?.kind, "fumble-return", id);
    const { segment } = illustratedDrive({ direction: String(drive.team.id) === h.id ? "left" : "right",
      plays: [{ id, trajectory: motion }] });
    assert.ok(segment.returnPath, id);
    assert.equal(segment.finish, 104 + motion.end * 7.92);
    if (motion.catchPercent !== null) assert.equal(segment.to, 104 + motion.catchPercent * 7.92);
  }
});

test("Tulane's named TLN 28 incompletion overrides the schematic 10-yard depth", () => {
  const summary = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/games/college-football/401862811.json.gz", import.meta.url))));
  const sides = summary.header.competitions[0].competitors;
  const h = sides.find((side) => side.homeAway === "home").team;
  const a = sides.find((side) => side.homeAway === "away").team;
  const raw = summary.drives.previous.flatMap((drive) => drive.plays).find((play) => play.id === "401862811781");
  const motion = playTrajectory(raw, "2655", h, a);
  assert.deepEqual([motion.kind, motion.start, motion.targetPercent, motion.targetLabel],
    ["incomplete", 78, 72, "TULN 28"]);
  const { segment } = illustratedDrive({ direction: "left", plays: [{ id: raw.id, trajectory: motion }] });
  assert.equal(segment.to, 104 + 72 * 7.92);
  assert.equal(yardageLabel(segment), "INCOMPLETE · 0 YDS · TARGET TULN 28");
});

test("the three Cowboys–Eagles NFL pass descriptions use schematic miss, structured YAC and goal-line TD", () => {
  const summary = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/games/nfl/401873009.json.gz", import.meta.url))));
  const sides = summary.header.competitions[0].competitors;
  const h = sides.find((side) => side.homeAway === "home").team;
  const a = sides.find((side) => side.homeAway === "away").team;
  const plays = [...(summary.drives?.previous ?? []), summary.drives?.current].filter(Boolean)
    .flatMap((drive) => drive.plays ?? []);
  const trajectory = (id) => playTrajectory(plays.find((candidate) => String(candidate.id) === id), "6", h, a);
  const miss = trajectory("401873009515"); // Pickens: short, but no reported landing yard line.
  assert.equal(miss.targetPercent, null);
  assert.equal(illustratedDrive({ plays: [{ id: "miss", trajectory: miss }] }).segment.to, 104 + 41 * 7.92);
  assert.equal(yardageLabel(miss), "INCOMPLETE · 0 YDS");
  const deep = trajectory("401873009538"); // Flournoy: PHI 34, 35 yards, 18 YAC.
  assert.deepEqual([deep.start, deep.catchPercent, deep.end, deep.yac], [31, 48, 66, 18]);
  assert.match(illustratedDrive({ plays: [{ id: "deep", trajectory: deep }] }).segment.path, / 220 Q .* 70 .* 220$/);
  const touchdown = trajectory("401873009658"); // Lamb: nine yards to the end zone, no named end spot.
  assert.deepEqual([touchdown.start, touchdown.end, touchdown.yards], [91, 100, 9]);
  assert.match(illustratedDrive({ plays: [{ id: "td", trajectory: touchdown }] }).segment.path, / 220 Q .* 70 .* 220$/);
});

test("punt arcs land at the reported next-possession spot, not the kick's catch or the punter's end-team ID", () => {
  const punt = play("Punt", "AWY 35", "HME 26", {
    text: "Punter punts to HME 19. Returner to HME 26 for 7 yards.",
    end: spot("1", "HME 26", 74, 1),
  });
  const motion = playTrajectory(punt, "1", home, away);
  assert.equal(motion.kind, "punt");
  assert.equal(motion.start, 35);
  assert.equal(motion.end, 74);
  const { segment } = illustratedDrive({ direction: "right", plays: [{ id: "punt", snapPercent: 35, trajectory: motion }] });
  assert.equal(segment.path, `M ${104 + 35 * 7.92} 220 Q ${(segment.from + segment.to) / 2} 70 ${104 + 74 * 7.92} 220`);
  assert.equal(segment.finish, 104 + 74 * 7.92);
  assert.equal(yardageLabel(segment), "PUNT · TO HME 26");
  assert.equal(segment.yacPath, null);
  const unconfirmed = playTrajectory({ ...punt, end: { team: { id: "1" }, yardsToEndzone: 74 } }, "1", home, away);
  assert.equal(unconfirmed, null, "a kicker-owned numeric endpoint cannot establish the receiver's spot");
});

test("Texas's punt to MISS 28 arcs to the catch, then shows the 18-yard return to MISS 46", () => {
  const summary = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/games/college-football/401856732.json.gz", import.meta.url))));
  const sides = summary.header.competitions[0].competitors;
  const h = sides.find((side) => side.homeAway === "home").team;
  const a = sides.find((side) => side.homeAway === "away").team;
  const raw = summary.drives.previous.flatMap((drive) => drive.plays).find((play) => play.id === "401856732582");
  const motion = playTrajectory(raw, "251", h, a);
  assert.deepEqual([motion.kind, motion.start, motion.catchPercent, motion.end, motion.returnYards],
    ["punt", 75, 28, 46, 18]);
  assert.equal(motion.landingLabel, "MISS 28");
  const { segment } = illustratedDrive({ direction: "left", plays: [{ id: raw.id, snapPercent: 75, trajectory: motion }] });
  assert.equal(segment.path, `M ${segment.from} 220 Q ${(segment.from + segment.to) / 2} 70 ${segment.to} 220`);
  assert.equal(segment.to, 104 + 28 * 7.92);
  assert.equal(segment.yacPath, `M ${segment.to} 220 L ${104 + 46 * 7.92} 220`);
  assert.equal(segment.returnPath, null, "a punt return uses the catch-to-end line, not an interception's red line");
  assert.equal(yardageLabel(segment), "PUNT · TO MISS 28 · 18 YD RETURN TO MISS 46");
});

test("NFL punt return language with 'to' and 'pushed ob at' also splits the kick from the return", () => {
  const summary = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/games/nfl/401873010.json.gz", import.meta.url))));
  const sides = summary.header.competitions[0].competitors;
  const h = sides.find((side) => side.homeAway === "home").team;
  const a = sides.find((side) => side.homeAway === "away").team;
  for (const [id, offense, expected] of [
    ["401873010694", "17", [81, 74, 7]],
    ["4018730102915", "3", [7, 26, 19]],
  ]) {
    const raw = summary.drives.previous.flatMap((drive) => drive.plays).find((play) => play.id === id);
    const motion = playTrajectory(raw, offense, h, a);
    assert.deepEqual([motion.catchPercent, motion.end, motion.returnYards], expected, id);
    const { segment } = illustratedDrive({ direction: offense === h.id ? "left" : "right",
      plays: [{ id, trajectory: motion }] });
    assert.ok(segment.yacPath, id);
  }
});

test("a punt with a contradictory return spot or yardage does not invent a split", () => {
  const punt = play("Punt Return", "AWY 40", "HME 26", {
    text: "Punter punts 34 yards to HME 26. Returner return 7 yards to HME 19",
    end: spot("2", "HME 26", 74), statYardage: 7,
  });
  const motion = playTrajectory(punt, "1", home, away);
  assert.equal(motion.catchPercent, null);
  assert.equal(illustratedDrive({ plays: [{ id: "unsafe", trajectory: motion }] }).segment.yacPath, null);
});

test("a post-play receiving-team penalty on a punt still draws the arc to the post-penalty possession spot", () => {
  const summary = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/games/college-football/401862811.json.gz", import.meta.url))));
  const sides = summary.header.competitions[0].competitors;
  const h = sides.find((side) => side.homeAway === "home").team;
  const a = sides.find((side) => side.homeAway === "away").team;
  const raw = summary.drives.previous.flatMap((drive) => drive.plays).find((play) => play.id === "401862811713");
  // UTSA punts from their 30, TLN returns 0 yards to TLN38, PENALTY TLN Holding 10 yards → TLN28 (100-28=72).
  const motion = playTrajectory(raw, a.id, h, a);
  assert.deepEqual([motion?.kind, motion?.start, motion?.end, motion?.landingLabel],
    ["punt", 30, 72, "TULN 28"]);
  assert.equal(motion.catchPercent, null, "a 0-yard return with penalty does not split the arc");
  assert.equal(motion.returnYards, null);
});

test("a muffed punt recovered by the kicking team draws a punt arc to the recovery spot", () => {
  const summary = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/games/college-football/401862811.json.gz", import.meta.url))));
  const sides = summary.header.competitions[0].competitors;
  const h = sides.find((side) => side.homeAway === "home").team;
  const a = sides.find((side) => side.homeAway === "away").team;
  const raw = summary.drives.previous.flatMap((drive) => drive.plays).find((play) => play.id === "401862811644");
  // UTSA punts from their 33, ball muffed at TLN26, recovered by UTSA at TLN17 (100-17=83).
  const motion = playTrajectory(raw, a.id, h, a);
  assert.deepEqual([motion?.kind, motion?.start, motion?.end, motion?.landingLabel],
    ["punt", 33, 83, "TULN 17"]);
  assert.equal(motion.catchPercent, null, "a muffed-and-recovered punt does not split the arc");
  assert.equal(motion.returnYards, null);
});

test("field-goal arcs end at the back of the attacking end zone, not at a new possession", () => {
  const kick = playTrajectory(play("Field Goal Good", "AWY 35", "AWY 35", {
    text: "Kicker 53 yard field goal is GOOD", scoringPlay: true, end: {},
  }), "1", home, away);
  const right = illustratedDrive({ direction: "right", plays: [{ id: "fg", snapPercent: 35, trajectory: kick }] }).segment;
  assert.equal(right.kind, "field-goal");
  assert.equal(right.to, 988);
  assert.equal(right.finish, 988);
  assert.equal(right.path, `M ${104 + 35 * 7.92} 220 Q ${(right.from + 988) / 2} 70 988 220`);
  assert.equal(yardageLabel(right), "FIELD GOAL · GOOD");
  const reverse = playTrajectory({ type: { text: "Field Goal Missed" }, text: "Kicker missed wide right",
    start: spot("2", "AWY 35", 35, 4), end: spot("1", "AWY 35", 65) }, "2", home, away);
  const left = illustratedDrive({ direction: "left", plays: [{ id: "miss", snapPercent: 35, trajectory: reverse }] }).segment;
  assert.equal(left.to, 12);
  assert.equal(yardageLabel(left), "FIELD GOAL · MISSED");
});

test("the pictured Texas–Ole Miss interceptions arc to the pick, then return to the confirmed final spot", () => {
  const summary = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/games/college-football/401856732.json.gz", import.meta.url))));
  const sides = summary.header.competitions[0].competitors;
  const h = sides.find((side) => side.homeAway === "home").team;
  const a = sides.find((side) => side.homeAway === "away").team;
  const plays = [...(summary.drives?.previous ?? []), summary.drives?.current].filter(Boolean)
    .flatMap((drive) => drive.plays ?? []);
  for (const [id, offense, start, pick, finish, yards, spotLabel] of [
    ["401856732127", "251", 72, 67, 68, 1, "TEX 33"],
    ["401856732134", "145", 68, 74, 59, 15, "TEX 26"],
  ]) {
    const raw = plays.find((candidate) => String(candidate.id) === id);
    const trajectory = playTrajectory(raw, offense, h, a);
    assert.equal(trajectory.kind, "interception", id);
    assert.deepEqual([trajectory.start, trajectory.catchPercent, trajectory.end, trajectory.returnYards],
      [start, pick, finish, yards]);
    const { segment } = illustratedDrive({ direction: offense === h.id ? "left" : "right",
      plays: [{ id, snapPercent: start, trajectory }] });
    assert.equal(segment.path, `M ${segment.from} 220 Q ${(segment.from + segment.to) / 2} 70 ${104 + pick * 7.92} 220`);
    assert.equal(segment.returnPath, `M ${104 + pick * 7.92} 220 L ${104 + finish * 7.92} 220`);
    assert.equal(yardageLabel(segment), `INTERCEPTION · AT ${spotLabel} · ${yards} YD RETURN`);
  }
});

test("interceptions with no confirmed pick or a nullified result do not invent a return", () => {
  const candidate = { type: { text: "Pass Interception Return" }, text: "Pass INTERCEPTED at AWY 40. Returned to AWY 20.",
    isTurnover: true, start: spot("1", "AWY 30", 70), end: spot("2", "AWY 20", 80) };
  assert.equal(playTrajectory({ ...candidate, text: "Pass INTERCEPTED with no pick location" }, "1", home, away), null);
  assert.equal(playTrajectory({ ...candidate, text: `${candidate.text} PENALTY enforced - No Play` }, "1", home, away), null);
  const inconsistent = playTrajectory({ ...candidate, statYardage: 99 }, "1", home, away);
  assert.equal(inconsistent.kind, "interception", "a confirmed pick still has a pass flight");
  assert.deepEqual([inconsistent.catchPercent, inconsistent.end, inconsistent.returnYards], [40, 40, 0],
    "a return endpoint that disagrees with reported yardage is not a confirmed runback");
  assert.equal(illustratedDrive({ plays: [{ id: "uncertain", trajectory: inconsistent }] }).segment.returnPath, null);
  const missingEnd = playTrajectory({ ...candidate, end: {} }, "1", home, away);
  assert.deepEqual([missingEnd.catchPercent, missingEnd.end, missingEnd.returnYards], [40, 40, 0]);
  const stopped = playTrajectory({ ...candidate, type: { text: "Interception" },
    text: "Pass intercepted by defender at AWY 40, End Of Play",
    end: spot("2", "AWY 40", 60), statYardage: 0 }, "1", home, away);
  assert.equal(stopped.kind, "interception");
  assert.equal(illustratedDrive({ plays: [{ id: "stopped", trajectory: stopped }] }).segment.returnPath, null);
});

test("NFL aliases, touchbacks and college pick-sixes use the pick spot without inventing a runback", () => {
  for (const [file, id, offenseId, expected] of [
    ["nfl/401873012.json.gz", "4018730123462", "33", { pick: 62, end: 76, returnYards: 14 }],
    ["nfl/401873010.json.gz", "4018730101658", "17", { pick: 100, end: 80, returnYards: null }],
    ["college-football/401856732.json.gz", "401856732903", "145", { pick: 100, end: 80, returnYards: null }],
    ["college-football/401856727.json.gz", "40185672747", "245", { pick: 39, end: 0, returnYards: 39 }],
  ]) {
    const summary = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/games/${file}`, import.meta.url))));
    const sides = summary.header.competitions[0].competitors;
    const h = sides.find((side) => side.homeAway === "home").team;
    const a = sides.find((side) => side.homeAway === "away").team;
    const raw = [...(summary.drives?.previous ?? []), summary.drives?.current].filter(Boolean)
      .flatMap((drive) => drive.plays ?? []).find((entry) => String(entry.id) === id);
    const motion = playTrajectory(raw, offenseId, h, a);
    assert.equal(motion.kind, "interception", id);
    assert.deepEqual({ pick: motion.catchPercent, end: motion.end, returnYards: motion.returnYards }, expected, id);
    const { segment } = illustratedDrive({ direction: offenseId === h.id ? "left" : "right",
      plays: [{ id, trajectory: motion }] });
    assert.equal(segment.to, 104 + expected.pick * 7.92);
    assert.equal(segment.returnPath === null, expected.returnYards === null || expected.returnYards === 0);
    if (expected.returnYards != null && expected.returnYards > 0) {
      assert.equal(segment.finish, 104 + expected.end * 7.92);
    } else assert.equal(segment.finish, segment.to, "a touchback is not a return from the end zone to the 20");
  }
});

test("an end-of-game marker copied from a no-return interception leaves its pass arc and red pick dot visible", () => {
  const summary = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/games/college-football/401856732.json.gz", import.meta.url))));
  const lastDrive = summary.drives.previous.find((drive) => drive.plays.some((play) => play.id === "401856732903"));
  const interception = lastDrive.plays.find((play) => play.id === "401856732903");
  const marker = lastDrive.plays.find((play) => play.id === "401856732909");
  const sides = summary.header.competitions[0].competitors;
  const h = sides.find((side) => side.homeAway === "home").team;
  const a = sides.find((side) => side.homeAway === "away").team;
  const motion = playTrajectory(interception, "145", h, a);
  assert.deepEqual([motion.start, motion.catchPercent, motion.end, motion.returnYards], [71, 100, 80, null]);
  const plays = [{ id: interception.id, snapPercent: 71, trajectory: motion },
    { id: marker.id, type: marker.type.text, snapPercent: 71, trajectory: null }];
  assert.equal(lastDriveSnap(plays).id, interception.id);
  const { segment } = illustratedDrive({ direction: "right", plays });
  assert.equal(segment.kind, "interception");
  assert.equal(segment.to, 104 + 100 * 7.92);
  assert.equal(segment.path, `M ${segment.from} 220 Q ${(segment.from + segment.to) / 2} 70 ${segment.to} 220`);
  assert.equal(segment.returnPath, null);
  assert.equal(segment.finish, segment.to, "the touchback is not a return route to TEX 20");
  assert.equal(yardageLabel(segment), "INTERCEPTION · AT TEX 0 · TOUCHBACK · TEX 20");
  const final = createReplayFrames(summary, REPLAY_GAMES.college).at(-1).spotlight.drives.at(-1);
  assert.equal(final.plays.at(-1).id, marker.id);
  assert.equal(lastDriveSnap(final.plays).id, interception.id);
  assert.equal(illustratedDrive({ ...final, direction: "right" }).segment?.path, segment.path);
});

test("a confirmed pick-six also works when ESPN labels its play Pass Interception Return", () => {
  const motion = playTrajectory({ type: { text: "Pass Interception Return" }, scoringPlay: true, isTurnover: true,
    text: "QB pass INTERCEPTED by defender at AWY 39. Defender return 39 yards to AWY 00, TOUCHDOWN",
    statYardage: 39, start: spot("1", "AWY 35", 65),
    end: { team: { id: "2" }, yardsToEndzone: 0 } }, "1", home, away);
  assert.deepEqual([motion.catchPercent, motion.end, motion.returnYards], [39, 0, 39]);
  assert.ok(illustratedDrive({ direction: "right", plays: [{ id: "six", trajectory: motion }] }).segment.returnPath);
});

test("previous plays collapse to one static center line ending at the latest snap", () => {
  const run = playTrajectory(play("Rush", "AWY 25", "AWY 31"), "1", home, away);
  const pass = playTrajectory(play("Pass Reception", "AWY 31", "AWY 45"), "1", home, away);
  const miss = playTrajectory(play("Pass Incompletion", "AWY 45", "AWY 45"), "1", home, away);
  const plays = [
    { id: "a", snapPercent: 25, trajectory: run },
    { id: "b", snapPercent: 31, trajectory: pass },
    { id: "c", snapPercent: 45, trajectory: miss },
  ];
  const track = illustratedDrive({ direction: "right", plays });
  assert.equal(track.count, 3);
  assert.equal(track.segment.kind, "incomplete");
  assert.equal(track.progressPath, `M ${104 + 25 * 7.92} 220 L ${104 + 45 * 7.92} 220`);
  const kick = illustratedDrive({ direction: "right", plays: [...plays, { id: "d", snapPercent: 45, type: "Punt" }] });
  assert.equal(kick.segment, null, "a completed earlier pass is not replayed as a final kick");
  assert.equal(kick.progressPath, track.progressPath);
  assert.deepEqual(kick.finalMarker, { x: 104 + 45 * 7.92, y: 220 });
  const rushing = illustratedDrive({ direction: "right", plays: plays.slice(0, 1) });
  assert.equal(rushing.segment.path, `M ${104 + 25 * 7.92} 220 L ${104 + 31 * 7.92} 220`);
  assert.equal(rushing.segment.y, 220);
});

test("unknown, penalized, nullified and change-of-possession results do not draw fictitious motion", () => {
  for (const candidate of [
    play("Rush", "AWY 25", "AWY 30", { text: "Rush, penalty enforced" }),
    play("Pass Reception", "AWY 25", "AWY 30", { text: "No Play" }),
    play("Pass Reception", "AWY 25", "AWY 30", { end: {} }),
    play("Rush", "AWY 25", "AWY 30", { isTurnover: true }),
    play("Kickoff", "AWY 25", "AWY 30"),
    play("Punt", "AWY 25", "HME 30", { text: "Punt blocked and recovered" }),
    play("Punt Return Touchdown", "AWY 25", "HME 0"),
    play("Field Goal Missed", "AWY 25", "AWY 25", { text: "Field goal was blocked" }),
    play("Field Goal Missed", "AWY 25", "AWY 25", { text: "Field goal fell short" }),
  ]) assert.equal(playTrajectory(candidate, "1", home, away), null);
  assert.equal(driveTrack({ plays: [] }).start, null);
});

test("all 100 recorded games use reported incompletion spots, never an invented target", () => {
  const root = new URL("./fixtures/games/", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", root)));
  // Independently transcribed from the saved play text, not the production parser.
  const aliases = { "251": ["TEXAS", "UT"], "130": "U-M", "245": ["TAM", "A&M"], "2633": ["UTK", "TEN"],
    "2579": "USC", "238": "VANDY", "221": "PIT", "2390": ["CANES", "UM"],
    "254": "UTA", "68": "BSU", "164": "RU", "242": "RIC", "2649": "TOLEDO",
    "239": "BU", "2006": "AKRON", "193": "MIAMI", "344": "STATE", "2655": "TLN", "2636": "TSA", "145": "OM",
    "84": "IND", "275": "WISC", "87": "UND", "194": "OhioSt", "120": "Maryla", "26": "UCL", "142": "Mizzou",
    "333": "BAMA", "344": ["STATE", "MSU"], "2305": "Kan" };
  let reported = 0;
  let unavailable = 0;
  assert.equal(manifest.length, 100);
  for (const entry of manifest) {
    const summary = JSON.parse(gunzipSync(readFileSync(new URL(entry.file, root))));
    const sides = summary.header.competitions[0].competitors;
    const h = sides.find((side) => side.homeAway === "home").team;
    const a = sides.find((side) => side.homeAway === "away").team;
    for (const drive of [...(summary.drives?.previous ?? []), summary.drives?.current].filter(Boolean)) {
      for (const candidate of drive.plays ?? []) {
        if (candidate.type?.text !== "Pass Incompletion") continue;
        const trajectory = playTrajectory(candidate, String(drive.team.id), h, a);
        if (!trajectory) continue; // Penalized, nullified, or unconfirmed offensive spot.
        const match = /\bthrown to\s+([A-Za-z&-]+)\s*(\d{1,2})\b/i.exec(candidate.text);
        const side = match && [h, a].find((team) => [team.abbreviation, aliases[team.id]].flat()
          .some((name) => name?.toUpperCase() === match[1].toUpperCase()));
        const yard = match && Number(match[2]);
        if (side && yard <= 50) {
          reported++;
          assert.equal(trajectory.targetPercent, yard === 50 ? 50 : side.id === a.id ? yard : 100 - yard,
            `${entry.id}:${candidate.id} ${candidate.text}`);
          assert.equal(yardageLabel(trajectory).includes("TARGET"), true);
        } else {
          unavailable++;
          assert.equal(trajectory.targetPercent, null, `${entry.id}:${candidate.id}`);
          assert.doesNotMatch(yardageLabel(trajectory), /TARGET|EST\./);
        }
      }
    }
  }
  assert.ok(reported > 450, `expected college target spots across the corpus, got ${reported}`);
  assert.ok(unavailable > 500, `expected NFL incompletions without yard-line targets, got ${unavailable}`);
});

test("100-game pass audit separates college caught-at spots from NFL structured YAC and schematic misses", () => {
  const root = new URL("./fixtures/games/", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", root)));
  const aliases = { "251": ["TEXAS", "UT"], "130": "U-M", "245": ["TAM", "A&M"], "2633": ["UTK", "TEN"],
    "2579": "USC", "238": "VANDY", "221": "PIT", "2390": ["CANES", "UM"],
    "254": "UTA", "68": "BSU", "164": "RU", "242": "RIC", "2649": "TOLEDO",
    "239": "BU", "2006": "AKRON", "193": "MIAMI", "344": "STATE", "2655": "TLN", "2636": "TSA", "145": "OM",
    "84": "IND", "275": "WISC", "87": "UND", "194": "OhioSt", "120": "Maryla", "26": "UCL", "142": "Mizzou",
    "333": "BAMA", "344": ["STATE", "MSU"], "2305": "Kan" };
  const observed = { collegeCaught: 0, nflYac: 0, nflMisses: 0, scoring: 0 };
  for (const entry of manifest) {
    const summary = JSON.parse(gunzipSync(readFileSync(new URL(entry.file, root))));
    const sides = summary.header.competitions[0].competitors;
    const h = sides.find((side) => side.homeAway === "home").team;
    const a = sides.find((side) => side.homeAway === "away").team;
    for (const drive of [...(summary.drives?.previous ?? []), summary.drives?.current].filter(Boolean)) {
      for (const candidate of drive.plays ?? []) {
        if (!/^(?:Pass Reception|Passing Touchdown|Pass Incompletion)$/.test(candidate.type?.text ?? "")) continue;
        const motion = playTrajectory(candidate, String(drive.team.id), h, a);
        if (!motion) continue;
        const segment = illustratedDrive({ direction: String(drive.team.id) === h.id ? "left" : "right",
          plays: [{ id: candidate.id, trajectory: motion }] }).segment;
        if (motion.kind === "incomplete") {
          if (entry.league === "nfl" && /\bpass incomplete (?:short|deep)\b/i.test(candidate.text)) {
            observed.nflMisses++;
            assert.equal(motion.targetPercent, null);
            assert.match(segment.path, / 220 (?:Q .* 70|C .* 120 .* 120) .* 220$/,
              `${entry.id}:${candidate.id}`);
            assert.doesNotMatch(yardageLabel(segment), /TARGET|EST\./);
          }
          continue;
        }
        assert.match(segment.path, / 220 (?:Q .* 70|C .* 120 .* 120) .* 220$/,
          `${entry.id}:${candidate.id}`);
        if (candidate.type.text === "Passing Touchdown") observed.scoring++;
        if (entry.league === "nfl") {
          if (Number.isInteger(candidate.yardsAfterCatch) && candidate.statYardage === motion.yards) {
            const catchAt = motion.end - candidate.yardsAfterCatch * (String(drive.team.id) === a.id ? 1 : -1);
            if (catchAt >= 0 && catchAt <= 100) {
              observed.nflYac++;
              assert.equal(motion.yac, candidate.yardsAfterCatch, `${entry.id}:${candidate.id}`);
              assert.equal(motion.catchPercent, catchAt);
            }
          }
        } else {
          const match = /\bcaught at\s+([A-Za-z&-]+)\s*(\d{1,2})\b/i.exec(candidate.text);
          const team = match && [h, a].find((side) => [side.abbreviation, aliases[side.id]].flat()
            .some((name) => name?.toUpperCase() === match[1].toUpperCase()));
          if (!team || Number(match[2]) > 50 || candidate.statYardage !== motion.yards) continue;
          const yard = Number(match[2]);
          const catchAt = yard === 50 ? 50 : team.id === a.id ? yard : 100 - yard;
          observed.collegeCaught++;
          assert.equal(motion.catchPercent, catchAt, `${entry.id}:${candidate.id} ${candidate.text}`);
          assert.equal(motion.yac, (motion.end - catchAt) * (String(drive.team.id) === a.id ? 1 : -1) || 0);
        }
      }
    }
  }
  assert.ok(observed.collegeCaught > 850, JSON.stringify(observed));
  assert.ok(observed.nflYac > 900, JSON.stringify(observed));
  assert.ok(observed.nflMisses > 500, JSON.stringify(observed));
  assert.ok(observed.scoring > 100, JSON.stringify(observed));
});

test("100 saved games route confirmed punts to the receiving spot and ordinary field goals to the back end zone", () => {
  const root = new URL("./fixtures/games/", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", root)));
  let punts = 0;
  let puntReturns = 0;
  let fieldGoals = 0;
  // Provider prose uses more yard-line names than possessionText does.
  const aliases = { "251": ["TEXAS", "UT"], "245": ["A&M", "TAM"], "2633": "TEN",
    "2390": ["UM", "CANES"], "84": "IND", "275": "WISC", "87": "UND", "194": "OhioSt",
    "120": "Maryla", "26": "UCL", "142": "Mizzou", "34": "HST", "33": "BLT",
    "22": "ARZ", "145": "OM", "2655": "TLN", "2636": "TSA",
    "130": "U-M", "14": "LA", "5": "CLV", "28": "WAS", "254": "UTA", "238": "VANDY",
    "221": "PIT", "68": "BSU", "193": "Miami", "2649": "TOLEDO" };
  for (const entry of manifest) {
    const summary = JSON.parse(gunzipSync(readFileSync(new URL(entry.file, root))));
    const sides = summary.header.competitions[0].competitors;
    const h = sides.find((side) => side.homeAway === "home").team;
    const a = sides.find((side) => side.homeAway === "away").team;
    for (const drive of [...(summary.drives?.previous ?? []), summary.drives?.current].filter(Boolean)) {
      for (const candidate of drive.plays ?? []) {
        const type = candidate.type?.text ?? "";
        if (!/^(?:Punt|Punt Return|Field Goal Good|Field Goal Missed|Blocked Field Goal|Punt Return Touchdown)$/i.test(type)) continue;
        const motion = playTrajectory(candidate, String(drive.team.id), h, a);
        const isPuntPlay = /^(?:Punt|Punt Return)$/i.test(type);
        // A post-play receiving-team penalty on a punt/punt-return is not unsafe:
        // the arc now draws to the post-penalty possession spot (isPenalty/penalty unset).
        const penalty = /\bpenalty\b/i.test(candidate.text ?? "") && !/\bdeclined\b/i.test(candidate.text ?? "")
          && !(isPuntPlay && !candidate.isPenalty && !candidate.penalty);
        const unsafe = /\b(?:blocked|muff|fumble|no play|nullified|short)\b/i.test(candidate.text ?? "") || penalty
          || candidate.isPenalty || candidate.penalty || candidate.isTurnover;
        if (unsafe || /^(?:Blocked Field Goal|Punt Return Touchdown)$/.test(type)) {
          assert.equal(motion, null, `${entry.id}:${candidate.id} ${candidate.text}`);
          continue;
        }
        if (!/^(?:Punt|Punt Return)$/.test(type) && !/^Field Goal (?:Good|Missed)$/.test(type)) continue;
        if (!Number.isFinite(candidate.start?.down) || ![1, 2, 3, 4].includes(candidate.start.down)) continue;
        const direction = String(drive.team.id) === a.id ? "right" : "left";
        const graphic = motion && illustratedDrive({ direction, plays: [{ id: candidate.id,
          snapPercent: motion.start, trajectory: motion }] });
        if (/^Punt/.test(type)) {
          const named = /^(.*?)\s+(\d{1,2})$/.exec(candidate.end?.possessionText ?? "");
          const side = [h, a].find((team) => team.abbreviation === named?.[1]);
          if (!side && candidate.end?.possessionText !== "50") continue;
          const yards = Number(named?.[2]);
          let percent = candidate.end.possessionText === "50" ? 50 : side.id === a.id ? yards : 100 - yards;
          const enforcement = /\bPENALTY\b[^]*?\b\d+\s+yards?\s+from\s+[A-Za-z][A-Za-z&-]*\s*\d{1,2}\s+to\s+([A-Za-z][A-Za-z&-]*)\s*(\d{1,2})\b/i.exec(candidate.text ?? "");
          const enforcedSide = enforcement && [h, a].find((team) => [team.abbreviation, aliases[team.id]].flat()
            .some((name) => name?.toUpperCase() === enforcement[1].toUpperCase()));
          if (enforcedSide && !candidate.isPenalty && !candidate.penalty && !/\b(?:declined|offsetting)\b/i.test(candidate.text ?? ""))
            percent = enforcedSide.id === a.id ? Number(enforcement[2]) : 100 - Number(enforcement[2]);
          // A post-play penalty punt whose end resolves to the goal line (0 or 100)
          // correctly returns null; skip rather than assert a drawable trajectory.
          if (percent === 0 || percent === 100) { assert.equal(motion, null, `${entry.id}:${candidate.id}`); continue; }
          punts++;
          assert.equal(motion?.kind, "punt", `${entry.id}:${candidate.id} ${candidate.text}`);
          assert.equal(motion.end, percent, `${entry.id}:${candidate.id}`);
          if (motion.returnYards !== null) {
            puntReturns++;
            const reported = /\bpunt(?:s|ed)?\b.*?\bto\s+(?:the\s+)?([A-Za-z][A-Za-z&-]*)\s*(\d{1,2})\b/i.exec(candidate.text);
            const landingSide = reported && [h, a].find((team) => [team.abbreviation, aliases[team.id]].flat()
              .some((name) => name?.toUpperCase() === reported[1].toUpperCase()));
            assert.ok(landingSide, `${entry.id}:${candidate.id}: reported punt landing is on the field`);
            const landing = landingSide.id === a.id ? Number(reported[2]) : 100 - Number(reported[2]);
            assert.equal(motion.catchPercent, landing, `${entry.id}:${candidate.id}`);
            if (motion.returnYards > 0 || candidate.statYardage < 0)
              assert.equal(motion.returnYards, candidate.statYardage, `${entry.id}:${candidate.id}`);
            assert.equal(Math.abs(percent - landing), Math.abs(motion.returnYards), `${entry.id}:${candidate.id}`);
            assert.equal(graphic.segment.to, 104 + landing * 7.92);
            assert.equal(graphic.segment.yacPath, `M ${graphic.segment.to} 220 L ${104 + percent * 7.92} 220`);
            assert.match(yardageLabel(graphic.segment), /YD RETURN TO/);
          } else {
            assert.equal(graphic.segment.to, 104 + percent * 7.92);
            assert.equal(graphic.segment.yacPath, null);
          }
        } else {
          fieldGoals++;
          assert.equal(motion?.kind, "field-goal", `${entry.id}:${candidate.id} ${candidate.text}`);
          assert.equal(graphic.segment.to, direction === "right" ? 988 : 12);
        }
        assert.match(graphic.segment.path, / 220 Q .* 70 .* 220$/);
      }
    }
  }
  assert.ok(punts > 300, `expected clean punt endpoints across the corpus: ${punts}`);
  assert.ok(puntReturns > 150, `expected confirmed NFL and college punt returns: ${puntReturns}`);
  assert.ok(fieldGoals > 180, `expected ordinary field goals across the corpus: ${fieldGoals}`);
});

test("100 saved games separate interception flight, confirmed returns, touchbacks and invalid revisions", () => {
  const root = new URL("./fixtures/games/", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", root)));
  // Match text-side aliases independently of the production parser.
  const aliases = { "251": ["TEXAS", "UT"], "130": "U-M", "245": ["TAM", "A&M"], "2579": "USC",
    "164": "RU", "239": "BU", "193": "MIAMI", "238": "VANDY", "2655": "TLN", "2636": "TSA", "145": "OM", "33": "BLT", "5": "CLV",
    "22": "ARZ", "14": "LA", "34": "HST", "2390": "UM", "84": "IND", "275": "WISC",
    "87": "UND", "194": "OhioSt", "120": "Maryla", "26": "UCL", "142": "Mizzou", "2633": "TEN",
    "333": "BAMA", "344": "MSU", "2305": "Kan", "2641": "TTU", "28": "WAS" };
  const counts = { total: 0, animated: 0, returned: 0, touchbacks: 0, touchdowns: 0 };
  for (const entry of manifest) {
    const summary = JSON.parse(gunzipSync(readFileSync(new URL(entry.file, root))));
    const sides = summary.header.competitions[0].competitors;
    const h = sides.find((side) => side.homeAway === "home").team;
    const a = sides.find((side) => side.homeAway === "away").team;
    for (const drive of [...(summary.drives?.previous ?? []), summary.drives?.current].filter(Boolean)) {
      for (const candidate of drive.plays ?? []) {
        if (!/^(?:Pass Interception Return|Interception|Interception Return Touchdown)$/i.test(candidate.type?.text ?? "")) continue;
        counts.total++;
        const motion = playTrajectory(candidate, String(drive.team.id), h, a);
        if (!motion) continue;
        counts.animated++;
        assert.equal(motion.kind, "interception", `${entry.id}:${candidate.id}`);
        const spot = /\bintercepted\b.*?\bat\s+(?:(50)\b|([A-Za-z&-]+)\s*(-?\d{1,2})\b)/i.exec(candidate.text);
        assert.ok(spot, `${entry.id}:${candidate.id} has a reported pick spot`);
        const team = spot[2] && [h, a].find((side) => [side.abbreviation, aliases[side.id]].flat()
          .some((name) => name?.toUpperCase() === spot[2].toUpperCase()));
        const yard = spot[3] == null ? null : Number(spot[3]);
        assert.ok(spot[1] || team, `${entry.id}:${candidate.id} has a recognizable field side`);
        const pick = spot[1] ? 50 : yard < 0 ? team.id === h.id ? 100 : 0
          : team.id === a.id ? yard : 100 - yard;
        assert.equal(motion.catchPercent, pick, `${entry.id}:${candidate.id} ${candidate.text}`);
        const graphic = illustratedDrive({ direction: String(drive.team.id) === h.id ? "left" : "right",
          plays: [{ id: candidate.id, trajectory: motion }] });
        assert.equal(graphic.segment.to, 104 + pick * 7.92);
        assert.match(graphic.segment.path, / 220 (?:Q .* 70|C .* 120 .* 120) .* 220$/);
        if (/\btouchback\b/i.test(candidate.text)) {
          counts.touchbacks++;
          assert.equal(motion.returnYards, null);
          assert.equal(graphic.segment.returnPath, null);
          assert.equal(graphic.segment.finish, graphic.segment.to);
        } else if (motion.returnYards !== 0) {
          counts.returned++;
          assert.equal(motion.returnYards, candidate.statYardage);
          assert.ok(graphic.segment.returnPath);
        } else assert.equal(graphic.segment.returnPath, null);
        if (candidate.scoringPlay) {
          counts.touchdowns++;
          assert.equal(motion.end, String(drive.team.id) === a.id ? 0 : 100);
        }
      }
    }
  }
  assert.ok(counts.total >= 75, JSON.stringify(counts));
  assert.ok(counts.animated >= 65, JSON.stringify(counts));
  assert.ok(counts.returned >= 35, JSON.stringify(counts));
  assert.ok(counts.touchbacks >= 5, JSON.stringify(counts));
  assert.ok(counts.touchdowns >= 2, JSON.stringify(counts));
});

test("adapter supplies trajectories for full-game replay drives without future plays", () => {
  const option = REPLAY_GAMES.nfl;
  const summary = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/games/${option.file}`, import.meta.url))));
  const frames = createReplayFrames(summary, option);
  const first = frames.find((frame) => frame.spotlight.drives.at(-1)?.plays.some((entry) => entry.trajectory));
  const drive = first.spotlight.drives.at(-1);
  assert.ok(drive.plays.some((entry) => entry.trajectory?.kind === "run"));
  assert.ok(frames.some((frame) => frame.spotlight.drives.at(-1)?.plays.some((entry) => entry.trajectory?.kind === "incomplete")));
  assert.ok(frames.some((frame) => frame.spotlight.drives.at(-1)?.plays.some((entry) => entry.trajectory?.kind === "pass")));
  assert.ok(frames.some((frame) => frame.spotlight.drives.at(-1)?.plays.some((entry) => entry.trajectory?.yac === 3)));
  assert.equal(drive.plays.length, first.spotlight.drives.at(-1).plays.length);
  const fieldGoal = frames.find((frame) => /field goal is GOOD/i.test(frame.caption));
  const finalPlay = fieldGoal.spotlight.drives.at(-1).plays.at(-1);
  assert.equal(finalPlay.type, "Field Goal Good");
  assert.ok(Number.isFinite(finalPlay.snapPercent), "a final kick has a reported offensive snap, not an invented landing");
  assert.equal(finalPlay.trajectory?.kind, "field-goal");
  assert.equal(illustratedDrive({ direction: finalPlay.snapPercent < 50 ? "right" : "left",
    plays: [{ ...finalPlay }] }).segment.kind, "field-goal");
});

test("the first college punt reaches TEX 26 on its own replay frame, before the next drive exists", () => {
  const option = REPLAY_GAMES.college;
  const summary = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/games/${option.file}`, import.meta.url))));
  const frames = createReplayFrames(summary, option);
  const index = frames.findIndex((frame) => frame.spotlight.drives.at(-1)?.plays.at(-1)?.id === "40185673222");
  const drive = frames[index].spotlight.drives.at(-1);
  const punt = drive.plays.at(-1);
  assert.equal(punt.type, "Punt");
  assert.deepEqual([punt.trajectory.start, punt.trajectory.end, punt.trajectory.landingLabel], [25, 74, "TEX 26"]);
  assert.equal(illustratedDrive({ direction: "right", plays: drive.plays }).segment?.to, 104 + 74 * 7.92);
  assert.equal(frames[index].spotlight.drives.length, 1, "the next Texas drive has not begun");
  assert.match(frames[index + 1].caption, /rush right for 6 yards gain to the TEXAS32/);
});

test("both pictured interceptions are available on their own replay frames, without the next possession", () => {
  const option = REPLAY_GAMES.college;
  const summary = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/games/${option.file}`, import.meta.url))));
  const frames = createReplayFrames(summary, option);
  for (const [id, pick, end] of [["401856732127", 67, 68], ["401856732134", 74, 59]]) {
    const frame = frames.find((entry) => entry.spotlight.fieldContext.lastPlayId === id);
    const latest = frame.spotlight.drives.at(-1).plays.at(-1);
    assert.equal(latest.id, id);
    assert.deepEqual([latest.trajectory?.catchPercent, latest.trajectory?.end], [pick, end]);
    assert.equal(illustratedDrive({ direction: latest.trajectory.start > pick ? "left" : "right",
      plays: frame.spotlight.drives.at(-1).plays }).segment?.kind, "interception");
    assert.ok(!frame.spotlight.latestPlayOrder.includes(frames[frames.indexOf(frame) + 1].spotlight.fieldContext.lastPlayId));
  }
});
