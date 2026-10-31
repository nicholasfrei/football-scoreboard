import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { illustratedDrive } from "../public/drive-illustration.js";

const x = (percent) => 104 + percent * 7.92;
const view = (trajectory, direction = "right") => illustratedDrive({ direction, plays: [
  { id: "play", snapPercent: trajectory.start, trajectory },
] });

test("sacks and tackles for loss use a straight loss route in either direction", () => {
  for (const [kind, start, end, direction] of [
    ["sack", 60, 53, "right"], ["run", 35, 32, "right"],
    ["sack", 40, 47, "left"], ["run", 65, 69, "left"],
  ]) {
    const { segment } = view({ kind, start, end, yards: -Math.abs(end - start) }, direction);
    assert.equal(segment.loss, true);
    assert.equal(segment.path, `M ${x(start)} 220 L ${x(end)} 220`);
    assert.equal(segment.finish, x(end));
  }
});

test("negative completions show the net loss rather than a white pass and YAC leg", () => {
  const { segment } = view({ kind: "pass", start: 40, end: 36, yards: -4,
    catchPercent: 45, yac: -9 });
  assert.equal(segment.loss, true);
  assert.equal(segment.path, `M ${x(40)} 220 L ${x(36)} 220`);
  assert.equal(segment.yacPath, null);
  assert.equal(segment.finish, x(36));
});

test("gains and no-gain plays retain their existing routes; penalties stay separate", () => {
  for (const yards of [0, 5]) {
    const { segment } = view({ kind: "run", start: 40, end: 40 + yards, yards });
    assert.equal(segment.loss, false);
  }
  const { segment, penaltyPaths } = illustratedDrive({ direction: "right", plays: [
    { id: "penalty", snapPercent: 40, penaltyMotion: { start: 40, end: 35 } },
  ] });
  assert.equal(segment, null);
  assert.equal(penaltyPaths.length, 1);
});

test("the loss route is solid red instead of inheriting the dotted play stroke", () => {
  const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.drive-latest \.drive-route\.is-loss\s*\{[^}]*stroke:\s*#ff666b;[^}]*stroke-dasharray:\s*none;/);
});
