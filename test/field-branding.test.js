import test from "node:test";
import assert from "node:assert/strict";
import { endzoneTextLayout, fieldBranding } from "../public/field-branding.js";

test("green teams keep their primary colors with white end-zone text", () => {
  for (const color of ["#154733", "#18453B", "#203731", "#004C54", "#008000"]) {
    assert.deepEqual(fieldBranding({ color, alternateColor: "#FEE123" }), { color, ink: "#FFFFFF" });
    assert.deepEqual(fieldBranding({ color, alternateColor: "#000000" }), { color, ink: "#FFFFFF" });
  }
});

test("without a matchup comparison, teams keep their primary colors regardless of alternates", () => {
  for (const color of ["#A41F35", "#500000", "#002244", "#000000", "#808080", "#FFFFFF", "#F1B82D"]) {
    assert.equal(fieldBranding({ color, alternateColor: "#FFFFFF" }).color, color);
    assert.equal(fieldBranding({ color }).ink, "#FFFFFF");
  }
  assert.equal(fieldBranding({ color: "#154733" }).color, "#154733");
});

test("Packers green end zones use white lettering", () => {
  assert.deepEqual(fieldBranding({ color: "#203731", alternateColor: "#FFB612" }), {
    color: "#203731", ink: "#FFFFFF",
  });
});

test("Auburn at Ole Miss uses Auburn orange only for the away end zone", () => {
  const away = Object.freeze({ color: "#0C2340", alternateColor: "#F26522" });
  const home = Object.freeze({ color: "#14213D", alternateColor: "#CE1126" });
  assert.deepEqual(fieldBranding(away, home), { color: "#F26522", ink: "#FFFFFF" });
  assert.deepEqual(fieldBranding(home), { color: "#14213D", ink: "#FFFFFF" });
  assert.equal(fieldBranding(away).color, "#0C2340", "team branding remains unchanged");
});

test("Arizona at Texas Tech uses Arizona navy only for the away end zone", () => {
  // Colors from the recorded ESPN summaries for teams 12 and 2641.
  const away = Object.freeze({ color: "#CC0033", alternateColor: "#003366" });
  const home = Object.freeze({ color: "#DA291C", alternateColor: "#000000" });
  assert.deepEqual(fieldBranding(away, home), { color: "#003366", ink: "#FFFFFF" });
  assert.deepEqual(fieldBranding(home), { color: "#DA291C", ink: "#FFFFFF" });
  assert.equal(fieldBranding(away).color, "#CC0033", "team branding remains unchanged");
});

test("close green and red primaries also use a more distinct away secondary", () => {
  for (const [away, home] of [["#154733", "#18453B"], ["#A41F35", "#9E1B32"]]) {
    assert.equal(fieldBranding({ color: away, alternateColor: "#FEE123" }, { color: home }).color, "#FEE123");
  }
});

test("distinct primaries stay primary even when the away secondary is farther away", () => {
  assert.equal(fieldBranding({ color: "#F26522", alternateColor: "#FFFFFF" }, { color: "#14213D" }).color, "#F26522");
});

test("close primaries stay primary if the away secondary is closer or equally distant", () => {
  for (const alternateColor of ["#14213D", "#13223E", "#0C2340"]) {
    assert.equal(fieldBranding({ color: "#0C2340", alternateColor }, { color: "#14213D" }).color, "#0C2340");
  }
  assert.equal(fieldBranding({ color: "#14213D", alternateColor: "#14213D" }, { color: "#14213D" }).color, "#14213D");
});

test("identical primaries switch only the away end zone to a distinct secondary", () => {
  assert.equal(fieldBranding({ color: "#14213D", alternateColor: "#CE1126" }, { color: "#14213D" }).color, "#CE1126");
});

test("missing or invalid colors safely preserve the primary", () => {
  for (const alternateColor of [undefined, null, "", "invalid", "#12345G"]) {
    assert.equal(fieldBranding({ color: "#0C2340", alternateColor }, { color: "#14213D" }).color, "#0C2340");
  }
  for (const color of [undefined, null, "", "invalid"]) {
    assert.equal(fieldBranding({ color: "#0C2340", alternateColor: "#F26522" }, { color }).color, "#0C2340");
    assert.equal(fieldBranding({ color, alternateColor: "#F26522" }, { color: "#14213D" }).color, color);
  }
});

test("end-zone names share one scale without stretching shorter names to fill the length", () => {
  const bounds = [
    { x: 0, y: -70, width: 500, height: 70 },
    { x: 2, y: -70, width: 900, height: 70 },
  ];
  const [school, mascot] = endzoneTextLayout(bounds);
  assert.equal(school.scale, mascot.scale);
  assert.equal(mascot.scale, 320 / 900);
  assert.ok(bounds[0].width * school.scale < 320);
  assert.equal(bounds[0].height * school.scale, bounds[1].height * mascot.scale);
});

test("uniform end-zone fitting preserves proportions, stays centered, and respects both margins", () => {
  for (const width of [200, 600, 1200, 2400]) {
    const box = { x: 3, y: -74, width, height: 74 };
    const [fit] = endzoneTextLayout([box]);
    assert.ok(box.width * fit.scale <= 320);
    assert.ok(box.height * fit.scale <= 56);
    assert.equal((box.x + box.width / 2) * fit.scale + fit.x, 0);
    assert.equal((box.y + box.height / 2) * fit.scale + fit.y, 0);
    assert.ok(Math.abs((box.width * fit.scale) / (box.height * fit.scale) - box.width / box.height) < .0001);
  }
});

test("empty end-zone labels do not introduce invalid transforms or prevent fitting the other name", () => {
  const empty = { x: 0, y: 0, width: 0, height: 0 };
  assert.deepEqual(endzoneTextLayout([]), []);
  assert.deepEqual(endzoneTextLayout([empty, empty]), [null, null]);
  const layout = endzoneTextLayout([empty, { x: 0, y: -70, width: 400, height: 70 }]);
  assert.equal(layout[0], null);
  assert.equal(layout[1].scale, 56 / 70);
});
