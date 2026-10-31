import test from "node:test";
import assert from "node:assert/strict";
import { playTrajectory, driveTrack } from "../public/play-trajectory.js";
import { illustratedDrive, yardageLabel } from "../public/drive-illustration.js";
import { playDownDistance } from "../public/drive-summary.js";

const arizona = { id: "12", abbreviation: "ARIZ" };
const texasTech = { id: "2641", abbreviation: "TTU" };
const spot = (team, possessionText, down, distance) => ({
  team: { id: team.id }, possessionText, down, distance,
});

test("the touchback kickoff has no scrimmage down in the play-by-play header", () => {
  assert.equal(playDownDistance({ type: "Kickoff", down: 1, distance: 10 }), "");
  assert.equal(playDownDistance({ type: "Kickoff Return", down: 1, distance: 10 }), "");
  assert.equal(playDownDistance({ type: "Rush", down: 1, distance: 10 }), " · 1st & 10");
  assert.equal(playDownDistance({ type: "Sack", down: 3, distance: 7 }), " · 3rd & 7");
  assert.equal(playDownDistance({ type: "Field Goal Good", down: 4, distance: 15 }), " · 4th & 15");
});

test("Arizona's third-down sack retreats from TTU 10 to TTU 18 before the field goal", () => {
  const sack = {
    type: { text: "Sack" },
    text: "(12:11) Shotgun #1 N.Fifita sacked for loss of 8 yards to the TTU18 (#2 T.White)",
    statYardage: -8,
    start: spot(arizona, "TTU 10", 3, 7),
    end: spot(arizona, "TTU 18", 4, 15),
  };
  const motion = playTrajectory(sack, arizona.id, texasTech, arizona);
  assert.deepEqual([motion.kind, motion.start, motion.end, motion.yards], ["sack", 90, 82, -8]);
  assert.equal(yardageLabel(motion), "SACK · -8 YDS");

  const drive = { direction: "right", plays: [
    { id: "kickoff", snapPercent: null, trajectory: null },
    { id: "run", snapPercent: 25, trajectory: { kind: "run", start: 25, end: 30 } },
    { id: "sack", snapPercent: 90, trajectory: motion },
  ] };
  const view = illustratedDrive(drive);
  assert.equal(driveTrack(drive).start, 25, "the kickoff does not set the drive origin");
  assert.equal(view.progressPath, `M ${104 + 25 * 7.92} 220 L ${104 + 90 * 7.92} 220`);
  assert.equal(view.segment.path, `M ${104 + 90 * 7.92} 220 L ${104 + 82 * 7.92} 220`);
  assert.equal(view.segment.finish, 104 + 82 * 7.92);
  assert.equal(view.finalMarker, undefined, "a confirmed sack has a real destination, not a ring at the snap");

  const fieldGoal = playTrajectory({ type: { text: "Field Goal Good" },
    text: "#19 M.Salgado-Medina field goal attempt from 35 yards GOOD",
    start: spot(arizona, "TTU 18", 4, 15), end: { team: { id: arizona.id } },
  }, arizona.id, texasTech, arizona);
  const final = illustratedDrive({ ...drive, plays: [...drive.plays,
    { id: "field-goal", snapPercent: 82, trajectory: fieldGoal }] });
  assert.equal(final.segment.from, view.segment.finish);
  assert.equal(final.segment.to, 988);
  assert.equal(yardageLabel(final.segment), "FIELD GOAL · GOOD");

  for (const change of [
    { statYardage: -7 }, { statYardage: undefined }, { isTurnover: true },
    { end: spot(texasTech, "TTU 18", 1, 10) },
    { text: `${sack.text} PENALTY TTU, 5 yards enforced` },
  ]) assert.equal(playTrajectory({ ...sack, ...change }, arizona.id, texasTech, arizona), null);
});

test("a home-team sack retreats toward its own end zone", () => {
  const motion = playTrajectory({ type: { text: "Sack" }, text: "QB sacked at ARIZ 32 for -7 yards",
    statYardage: -7, start: spot(arizona, "ARIZ 39", 2, 6),
    end: spot(arizona, "ARIZ 32", 3, 13) }, arizona.id, arizona, texasTech);
  assert.deepEqual([motion.start, motion.end, motion.yards], [61, 68, -7]);
  const { segment } = illustratedDrive({ direction: "left", plays: [{ id: "home-sack", trajectory: motion }] });
  assert.equal(segment.path, `M ${104 + 61 * 7.92} 220 L ${104 + 68 * 7.92} 220`);
});
