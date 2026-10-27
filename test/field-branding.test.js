import test from "node:test";
import assert from "node:assert/strict";
import { endzoneTextLayout, fieldBranding } from "../public/field-branding.js";

test("green teams keep their primary colors with white end-zone text", () => {
  for (const color of ["#154733", "#18453B", "#203731", "#004C54", "#008000"]) {
    assert.deepEqual(fieldBranding({ color, alternateColor: "#FEE123" }), { color, ink: "#FFFFFF" });
    assert.deepEqual(fieldBranding({ color, alternateColor: "#000000" }), { color, ink: "#FFFFFF" });
  }
});

test("non-green teams keep their primary colors, regardless of alternates", () => {
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
    assert.ok(box.height * fit.scale <= 50);
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
  assert.equal(layout[1].scale, 50 / 70);
});
