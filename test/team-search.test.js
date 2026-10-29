import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createTeamDirectory } from "../src/team-directory.js";
import { createTeamSelection } from "../src/team-selection.js";
import { parseConfig } from "../src/config.js";
import { bindFavoriteHold, filterTeams, restoreFavorites, renderTeamPicker } from "../public/team-picker.js";

const payload = (teams) => ({ sports: [{ leagues: [{ teams: teams.map((team) => ({ team })) }] }] });
const nfl = { id: "6", abbreviation: "DAL", displayName: "Dallas Cowboys", name: "Cowboys", logos: [{ href: "https://example.com/dal.png" }] };
const college = { id: "251", abbreviation: "TEX", displayName: "Texas Longhorns", name: "Longhorns" };

test("search has separate NFL and NCAAF buttons with no combined league option", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /role="group" aria-label="Search league"/);
  assert.match(html, /data-league="nfl" aria-pressed="true">NFL/);
  assert.match(html, /data-league="college-football" aria-pressed="false">NCAAF/);
  assert.doesNotMatch(html, /<select id="team-search-league"/);
  assert.doesNotMatch(html, /NFL &amp; NCAAF<\/option>/);
});

test("each league directory loads independently without waiting for the other league", async () => {
  const calls = [];
  const directory = createTeamDirectory({ fetchImpl: async (url) => {
    calls.push(url);
    if (url.includes("college-football")) throw new Error("NCAAF unavailable");
    return { ok: true, json: async () => payload([nfl]) };
  } });
  assert.equal((await directory.list("nfl"))[0].key, "nfl:dal");
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes("/nfl/"));
  await assert.rejects(directory.list("college-football"), /NCAAF unavailable/);
  assert.equal((await directory.list("nfl")).length, 1);
  assert.equal(calls.length, 2);
});

test("directory loads both leagues once, retains NFL abbreviations and separates identical IDs", async () => {
  const calls = [];
  const directory = createTeamDirectory({ fetchImpl: async (url) => {
    calls.push(url);
    return { ok: true, json: async () => payload(url.includes("/nfl/") ? [nfl] : [college, { ...college, id: "6" }]) };
  } });
  const [teams, duplicate] = await Promise.all([directory.list(), directory.list()]);
  assert.deepEqual(teams, duplicate);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((url) => url.endsWith("?limit=1000")));
  assert.equal((await directory.find("nfl:6")).key, "nfl:dal");
  assert.equal((await directory.find("college-football:6")).key, "college-football:6");
  assert.equal(await directory.find("nfl:unknown"), undefined);
  assert.equal(await directory.find("https://evil.test"), undefined);
  await assert.rejects(directory.list("nba"), /Unknown/);
});

test("failed or malformed directories retry instead of caching failure", async () => {
  let calls = 0;
  const directory = createTeamDirectory({ fetchImpl: async () => {
    calls++;
    if (calls === 1) return { ok: false, status: 503 };
    return { ok: true, json: async () => calls === 2 ? {} : payload([nfl]) };
  } });
  await assert.rejects(directory.list("nfl"), /503/);
  await assert.rejects(directory.list("nfl"), /unavailable/);
  assert.equal((await directory.list("nfl")).length, 1);
  assert.equal(calls, 3);
});

test("new directory teams get isolated scoreboard caches with the configured timezone", async () => {
  const directory = createTeamDirectory({ fetchImpl: async (url) => ({ ok: true,
    json: async () => payload(url.includes("/nfl/") ? [nfl] : [college]),
  }) });
  const calls = [];
  const registry = createTeamSelection(parseConfig({ teamUrl: "https://www.espn.com/nfl/team/_/name/phi", timeZone: "America/Denver" }), {
    directory, load: async ({ config }) => { calls.push(config); return { league: config.league }; },
  });
  const [one, two] = await Promise.all([registry.resolve("nfl:dal"), registry.resolve("nfl:6")]);
  assert.equal(one, two);
  assert.equal((await one()).league, "nfl");
  assert.equal((await two()).league, "nfl");
  assert.equal((await (await registry.resolve("college-football:251"))()).league, "college-football");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].timeZone, "America/Denver");
  assert.equal(await registry.resolve("nfl:unknown"), undefined);
});

const teams = [
  { key: "nfl:dal", name: "Dallas Cowboys", mascot: "Cowboys", abbreviation: "DAL" },
  { key: "college-football:251", name: "Texas Longhorns", mascot: "Longhorns", abbreviation: "TEX" },
];
test("favorite storage preserves additions, deletions and the empty list, rejecting corrupt data", () => {
  const catalog = { teams };
  assert.deepEqual(restoreFavorites(JSON.stringify([teams[1]]), catalog), [teams[1]]);
  assert.deepEqual(restoreFavorites("[]", catalog), []);
  assert.deepEqual(restoreFavorites(JSON.stringify([teams[0], teams[0]]), catalog), [teams[0]]);
  for (const saved of [null, "broken", "{}", '[null]', JSON.stringify([{ ...teams[0], logo: "javascript:alert(1)" }])]) {
    assert.deepEqual(restoreFavorites(saved, catalog), teams);
  }
});

test("search matches names, mascots and abbreviations case-insensitively with league filters", () => {
  assert.deepEqual(filterTeams(teams, " DALLAS cow "), [teams[0]]);
  assert.deepEqual(filterTeams(teams, "tex", "college-football"), [teams[1]]);
  assert.deepEqual(filterTeams(teams, "", "nfl"), [teams[0]]);
  assert.deepEqual(filterTeams(teams, "tex", "nfl"), []);
  assert.deepEqual(filterTeams(teams, "not a team"), []);
});

function element() {
  return { children: [], events: {}, attributes: {},
    append(child) { this.children.push(child); }, replaceChildren() { this.children = []; },
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(name, callback, options = false) {
      const capture = typeof options === "boolean" ? options : options.capture;
      this.events[capture ? `${name}Capture` : name] = callback;
    },
  };
}

test("hold waits 1.5s, suppresses navigation, and cancels on swipes and released pointers", () => {
  const link = element();
  let pending, held = 0, prevented = 0, stopped = 0;
  bindFavoriteHold(link, () => held++, {
    setTimer(callback, delay) { assert.equal(delay, 1500); pending = callback; return 1; },
    clearTimer() { pending = undefined; },
  });
  const down = { button: 0, clientX: 20, clientY: 20 };
  link.events.pointerdown(down);
  assert.equal(held, 0);
  pending();
  assert.equal(held, 1);
  link.events.clickCapture({ preventDefault() { prevented++; }, stopImmediatePropagation() { stopped++; } });
  assert.equal(prevented, 1); assert.equal(stopped, 1);
  for (const name of ["pointerup", "pointercancel", "pointerleave", "blur"]) {
    link.events.pointerdown(down); link.events[name]({}); assert.equal(pending, undefined);
  }
  link.events.pointerdown(down);
  link.events.pointermove({ clientX: 40, clientY: 20 });
  assert.equal(pending, undefined);
  link.events.pointerdown({ ...down, button: 2 });
  assert.equal(pending, undefined);
});

test("touch hold survives Chromium pointer cancellation and small finger jitter", () => {
  const link = element();
  let pending, held = 0, prevented = 0;
  bindFavoriteHold(link, () => held++, {
    setTimer(callback, delay) { assert.equal(delay, 1500); pending = callback; return 1; },
    clearTimer() { pending = undefined; },
  });
  const touch = { identifier: 7, clientX: 100, clientY: 100 };
  link.events.pointerdown({ pointerType: "touch", button: 0, ...touch });
  assert.equal(pending, undefined, "touch lifecycle owns the timer, not duplicate pointer events");
  link.events.touchstart({ touches: [touch] });
  const originalTimer = pending;
  link.events.pointercancel({ pointerType: "touch" });
  link.events.pointerleave({ pointerType: "touch" });
  link.events.touchmove({ touches: [{ ...touch, clientX: 112, clientY: 105 }] });
  link.events.contextmenu({ preventDefault() { prevented++; } });
  link.events.dragstart({ preventDefault() { prevented++; } });
  assert.equal(pending, originalTimer);
  pending();
  assert.equal(held, 1);
  link.events.touchend();
  link.events.clickCapture({ preventDefault() { prevented++; }, stopImmediatePropagation() {} });
  assert.equal(prevented, 3, "native menu, drag and post-hold navigation are prevented");
});

test("touch release, cancellation, a real swipe and multi-touch cancel editing", () => {
  const link = element();
  let pending;
  bindFavoriteHold(link, () => assert.fail("must not enter edit mode"), {
    setTimer(callback) { pending = callback; return 1; }, clearTimer() { pending = undefined; },
  });
  const touch = { identifier: 1, clientX: 30, clientY: 20 };
  for (const end of ["touchend", "touchcancel"]) {
    link.events.touchstart({ touches: [touch] });
    link.events[end]();
    assert.equal(pending, undefined);
  }
  link.events.touchstart({ touches: [touch] });
  link.events.touchmove({ touches: [{ ...touch, clientX: 60 }] });
  assert.equal(pending, undefined);
  link.events.touchstart({ touches: [touch] });
  link.events.touchstart({ touches: [touch, { ...touch, identifier: 2 }] });
  assert.equal(pending, undefined);
});

test("editing can toggle without replacing the pressed link or navigating on release", () => {
  const container = element();
  let editing = false, prevented = false, remembered = false;
  renderTeamPicker(container, { teams: [teams[0]] }, teams[0].key, {
    document: { createElement: element }, onRemove() {}, onEdit() {},
    isEditing: () => editing, remember() { remembered = true; },
  });
  const link = container.children[0].children[0];
  assert.equal(link.draggable, false);
  editing = true;
  link.events.click({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(remembered, false);
  assert.equal(container.children[0].children[0], link);
});

test("team search uses readable display-sized type and a viewport-bounded scroll area", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.team-search\s*\{[^}]*width: min\(960px,[^}]*font-size: clamp\(18px, 1\.35dvw, 26px\)/);
  assert.match(css, /\.team-search\[open\]\s*\{[^}]*display: flex;[^}]*flex-direction: column/);
  assert.match(css, /\.team-search button\s*\{[^}]*min-height: 56px;[^}]*font: inherit/);
  assert.match(css, /\.team-search-results\s*\{[^}]*min-height: 0;[^}]*overflow-y: auto/);
});

test("editable favorites expose labeled X buttons, block navigation and keep a single favorite visible", () => {
  const container = element();
  let removed;
  renderTeamPicker(container, { teams: [teams[0]] }, teams[0].key, {
    document: { createElement: element }, editing: true, onEdit() {}, onRemove(key) { removed = key; },
  });
  assert.equal(container.hidden, false);
  const [link, remove] = container.children[0].children;
  assert.equal(remove.hidden, false);
  assert.equal(remove.attributes["aria-label"], "Remove Dallas Cowboys from favorites");
  remove.events.click(); assert.equal(removed, teams[0].key);
  let prevented = false;
  link.events.click({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(link.attributes["aria-current"], "page");
  renderTeamPicker(container, { teams: [] }, null, { document: { createElement: element }, onRemove() {} });
  assert.equal(container.hidden, true);
});
