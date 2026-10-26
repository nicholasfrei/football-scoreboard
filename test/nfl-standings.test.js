import test from "node:test";
import assert from "node:assert/strict";
import { getNflDivisionStandings } from "../src/nfl-standings.js";

function payload({ season = 2026, name = "NFC North", ids = ["16", "3", "8", "9"], isConference = false } = {}) {
  return { season: { year: season }, children: [{ children: [{ name, isConference,
    standings: { entries: ids.map((id) => ({ team: { id }, stats: [{ name: "wins", value: 4 }] })) },
  }] }] };
}

test("NFL division positions follow ESPN's published table, not a local sort of tied W-L records", async () => {
  const result = await getNflDivisionStandings(2026, async () => ({ ok: true, json: async () => payload() }));
  assert.deepEqual([...result], [["16", "1st in NFC North"], ["3", "2nd in NFC North"], ["8", "3rd in NFC North"], ["9", "4th in NFC North"]]);
});

test("wrong seasons, conference tables, partial divisions, and duplicate teams do not invent division places", async () => {
  for (const options of [{ season: 2025 }, { name: "National Football Conference", isConference: true }, { ids: ["9"] }, { ids: ["9", "9", "8", "3"] }, { ids: ["9", null, "8", "3"] }]) {
    const result = await getNflDivisionStandings(2026, async () => ({ ok: true, json: async () => payload(options) }));
    assert.equal(result.size, 0);
  }
});

test("standings outages preserve available cached data without mixing seasons", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  let available = true;
  const fetchImpl = async () => ({ ok: available, json: async () => payload() });
  assert.equal((await getNflDivisionStandings(2026, fetchImpl)).get("9"), "4th in NFC North");
  available = false;
  now += 61_000;
  assert.equal((await getNflDivisionStandings(2026, fetchImpl)).get("9"), "4th in NFC North");
  assert.equal((await getNflDivisionStandings(2027, fetchImpl)).size, 0);
});
