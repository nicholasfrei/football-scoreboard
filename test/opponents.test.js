import test from "node:test";
import assert from "node:assert/strict";
import { getScoreboard } from "../src/espn.js";

const arkansas = { id: "8", location: "Arkansas", name: "Razorbacks", displayName: "Arkansas Razorbacks" };
// Identity fields checked against the public team endpoints, October 26, 2026.
const teams = [
  { id: "61", location: "Georgia", name: "Bulldogs", displayName: "Georgia Bulldogs", color: "ba0c2f" },
  { id: "2393", location: "Middle Tennessee", name: "Blue Raiders", displayName: "Middle Tennessee Blue Raiders", color: "036eb7" },
  { id: "2453", location: "North Alabama", name: "Lions", displayName: "North Alabama Lions", color: "000000" },
];

function provider(opponent, { failMetadata = false, mismatchedId = false } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes("/schedule?")) return { ok: true, json: async () => ({ events: [{
      id: "game", date: "2026-10-17T23:00Z", competitions: [{
        status: { type: { state: "post", detail: "Final" } },
        competitors: [
          { team: arkansas, homeAway: "away", score: "31" },
          // Deliberately incomplete schedule fields: no mascot or colors.
          { team: { id: opponent.id, location: opponent.location, displayName: opponent.displayName, logos: [{ href: "https://example.test/schedule.png" }] }, homeAway: "home", score: "21" },
        ],
      }],
    }] }) };
    if (url.includes("/summary?")) return { ok: false, status: 503 };
    const id = url.split("/").at(-1);
    if (failMetadata && id === opponent.id) return { ok: false, status: 503 };
    return { ok: true, json: async () => ({ team: id === "8" ? arkansas : {
      ...opponent,
      id: mismatchedId ? "wrong-team" : opponent.id,
      logos: [
        { href: `https://example.test/${id}.png`, rel: ["default"] },
        { href: `https://example.test/${id}-dark.png`, rel: ["dark"] },
      ],
    } }) };
  };
  return { calls, fetchImpl };
}

for (const opponent of teams) {
  test(`resolves ${opponent.displayName} by ID even with an incomplete schedule and no summary`, async () => {
    const { fetchImpl, calls } = provider(opponent);
    const result = await getScoreboard({ fetchImpl });
    assert.equal(result.spotlight.opponent.name, opponent.displayName);
    assert.equal(result.spotlight.opponent.location, opponent.location);
    assert.equal(result.spotlight.opponent.mascot, opponent.name);
    assert.equal(result.spotlight.opponent.color, `#${opponent.color}`);
    assert.equal(result.spotlight.opponent.logo, `https://example.test/${opponent.id}-dark.png`);
    assert.equal(result.spotlight.opponent.score, 21);
    assert.equal(result.spotlight.homeAway, "away");
    assert.equal(result.gamecastUnavailable, true);
    await getScoreboard({ fetchImpl });
    assert.equal(calls.filter((url) => url.endsWith(`/teams/${opponent.id}`)).length, 1, "metadata is cached across score polls");
  });
}

test("unlisted future opponents use the same lookup, without an allowlist", async () => {
  const opponent = { id: "999999", location: "Future State", name: "Owls", displayName: "Future State Owls", color: "123456" };
  const { fetchImpl } = provider(opponent);
  const result = await getScoreboard({ fetchImpl });
  assert.equal(result.spotlight.opponent.mascot, "Owls");
  assert.equal(result.spotlight.opponent.logo, "https://example.test/999999-dark.png");
});

test("failed or mismatched metadata preserves the matchup and schedule logo", async () => {
  for (const options of [{ failMetadata: true }, { mismatchedId: true }]) {
    const { fetchImpl } = provider(teams[0], options);
    const result = await getScoreboard({ fetchImpl });
    assert.equal(result.spotlight.opponent.name, "Georgia Bulldogs");
    assert.equal(result.spotlight.opponent.logo, "https://example.test/schedule.png");
    assert.equal(result.spotlight.opponent.score, 21);
  }
});
