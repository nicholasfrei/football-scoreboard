import test from "node:test";
import assert from "node:assert/strict";
import { fieldBranding } from "../public/field-branding.js";

test("green home fields use alternate colors with contrasting end-zone text", () => {
  for (const color of ["#154733", "#18453B", "#203731", "#004C54", "#008000"]) {
    assert.deepEqual(fieldBranding({ color, alternateColor: "#FEE123" }), { color: "#FEE123", ink: "#000000" });
    assert.deepEqual(fieldBranding({ color, alternateColor: "#000000" }), { color: "#000000", ink: "#FFFFFF" });
  }
});

test("non-green colors retain their home branding; unavailable alternates fall back", () => {
  for (const color of ["#A41F35", "#500000", "#002244", "#000000", "#808080", "#FFFFFF", "#F1B82D"]) {
    assert.equal(fieldBranding({ color, alternateColor: "#FFFFFF" }).color, color);
  }
  assert.equal(fieldBranding({ color: "#154733" }).color, "#154733");
});
