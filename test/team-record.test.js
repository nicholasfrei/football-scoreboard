import test from "node:test";
import assert from "node:assert/strict";
import { teamRecordLabel } from "../public/team-record.js";

test("college records omit Overall but retain conference records and names", () => {
  assert.equal(teamRecordLabel({ record: { overall: "3-5", conference: "1-4" }, conferenceName: "SEC" }, "college-football"), "3-5 (1-4 SEC)");
  assert.equal(teamRecordLabel({ record: { overall: "0-0", conference: "0-0" }, conferenceName: "Big Ten" }, "college-football"), "0-0 (0-0 Big Ten)");
});

test("NFL records show division standing instead of conference record, including ties", () => {
  assert.equal(teamRecordLabel({ record: { overall: "2-4", conference: "1-3" }, conferenceName: "NFC", divisionStanding: "2nd in NFC East" }, "nfl"), "2-4 · 2nd in NFC East");
  assert.equal(teamRecordLabel({ record: { overall: "3-2-1" }, divisionStanding: "Tied for 1st in AFC North" }, "nfl"), "3-2-1 · Tied for 1st in AFC North");
});

test("unavailable records, conferences, and standings are not invented", () => {
  assert.equal(teamRecordLabel({}, "nfl"), "Record unavailable");
  assert.equal(teamRecordLabel({ record: { overall: "2-4" } }, "nfl"), "2-4");
  assert.equal(teamRecordLabel({ record: { overall: "3-5" }, conferenceName: "SEC" }, "college-football"), "3-5");
  assert.equal(teamRecordLabel({ record: { conference: "1-4" } }, "college-football"), "Record unavailable (1-4 Conf.)");
  assert.equal(teamRecordLabel({ divisionStanding: "2nd in NFC East" }, "nfl"), "Record unavailable · 2nd in NFC East");
});

test("NFL division standings never appear in college labels", () => {
  assert.equal(teamRecordLabel({ record: { overall: "3-5", conference: "1-4" }, conferenceName: "SEC", divisionStanding: "2nd in NFC East" }, "college-football"), "3-5 (1-4 SEC)");
});
