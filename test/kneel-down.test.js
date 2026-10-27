import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { gameHighlights } from "../src/highlights.js";

const root = new URL("./fixtures/games/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
const kneelIds = [
  "4018730104206", "4018730204202", "401856732438", "401856732441",
  "401856835416", "401856727407", "401856727758", "401856727761",
];
const kneels = new Map();
for (const entry of manifest) {
  const summary = JSON.parse(gunzipSync(await readFile(new URL(entry.file, root))));
  const drives = [...(summary.drives?.previous ?? []), summary.drives?.current].filter(Boolean);
  for (const play of drives.flatMap((drive) => drive.plays ?? [])) {
    if (kneelIds.includes(String(play.id))) kneels.set(String(play.id), { play, entry });
  }
}

test("all eight recorded voluntary kneels stay silent without changing their rushing yardage", async (t) => {
  assert.equal(kneels.size, 8);
  assert.equal(new Set([...kneels.values()].map(({ entry }) => entry.id)).size, 5);
  for (const id of kneelIds) {
    await t.test(id, () => {
      const { play, entry } = kneels.get(id);
      const original = structuredClone(play);
      assert.ok(play.statYardage < 0);
      assert.deepEqual(gameHighlights([play], [], [entry.homeTeamId, entry.awayTeamId]), []);
      assert.deepEqual(play, original, "highlight filtering must not rewrite provider rushing statistics");
    });
  }
});

function rush(overrides = {}) {
  return {
    id: "rush", sequenceNumber: "10", type: { text: "Rush" },
    scoringPlay: false, isTurnover: false, statYardage: -1,
    text: "A.Runner rushes for a loss of 1 yard",
    start: { team: { id: "8" }, down: 1, yardsToEndzone: 70 },
    end: { team: { id: "8" }, down: 2, yardsToEndzone: 71 },
    ...overrides,
  };
}

function classify(play) {
  return gameHighlights([play], [], ["8", "238"]);
}

test("explicit kneel spellings and provider descriptions never celebrate a defensive loss", () => {
  for (const text of [
    "A.Quarterback kneels for -1 yard.",
    "(00:12) Kneel down by #10 A.Quarterback for loss of 1 yard",
    "A.Quarterback KNEEL-DOWN for -1 yard.",
    "A.Quarterback kneeldown for -1 yard.",
    "A.Quarterback kneeling to end the half for -1 yard.",
    "A.Quarterback kneeled for -1 yard.",
    "A.Quarterback knelt for a loss of 1 yard.",
    "A.Quarterback takes a knee for -1 yard.",
    "A.Quarterback took a knee for -1 yard.",
  ]) assert.deepEqual(classify(rush({ text })), [], text);
});

test("genuine short rushing losses still credit the defense, including knee injury commentary", () => {
  for (const text of [
    "A.Runner rushes for a loss of 1 yard",
    "A.Runner tackled for -1 yard; injured his knee on the play.",
    "A.Runner loses 1 yard; his knee was down before the ball came loose.",
    "A.Runner loses 1 yard; teammate Kneeland helps him up.",
  ]) {
    const [event] = classify(rush({ text }));
    assert.equal(event?.kind, "tackle-for-loss", text);
    assert.equal(event.teamId, "238", text);
  }
});

test("missing yardage or description preserves conservative loss fallback without reviving kneels", () => {
  assert.deepEqual(classify(rush({ text: "Kneel down by the quarterback", statYardage: undefined })), []);
  assert.deepEqual(classify(rush({ text: "Quarterback takes a knee", start: { team: { id: "8" } },
    end: { team: { id: "8" } } })), []);
  for (const overrides of [
    { text: undefined },
    { text: undefined, statYardage: undefined },
    { statYardage: undefined },
  ]) {
    const [event] = classify(rush(overrides));
    assert.equal(event?.kind, "tackle-for-loss", "do not infer kneels from one-yard losses alone");
    assert.equal(event.teamId, "238");
  }
  assert.deepEqual(classify(rush({ text: undefined, statYardage: undefined,
    start: { team: { id: "8" } }, end: { team: { id: "8" } } })), []);
});
