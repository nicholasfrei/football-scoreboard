import test from "node:test";
import assert from "node:assert/strict";
import { parseConfig } from "../src/config.js";
import { readFile } from "node:fs/promises";
import { createTeamSelection } from "../src/team-selection.js";
import { getTeamChoice } from "../src/espn.js";
import { selectedFavorite, renderTeamPicker } from "../public/team-picker.js";

const dallas = "https://www.espn.com/nfl/team/_/name/dal/dallas-cowboys";
const favorites = [
  { teamUrl: dallas, name: "Dallas Cowboys", mascot: "Cowboys", logo: "https://a.espncdn.com/i/teamlogos/nfl/500/dal.png" },
  { teamUrl: "https://www.espn.com/college-football/team/_/id/251/texas-longhorns", name: "Texas Longhorns", mascot: "Longhorns" },
  { teamUrl: "https://www.espn.com/college-football/team/_/id/2636/utsa-roadrunners", name: "UTSA Roadrunners", mascot: "Roadrunners" },
];
const config = parseConfig({ teamUrl: dallas, timeZone: "America/New_York", favorites });

test("URL-only favorites use the first team as default and resolve button metadata once", async () => {
  const simple = parseConfig({ timeZone: "America/Denver", favorites: favorites.map(({ teamUrl }) => ({ teamUrl })) });
  assert.equal(simple.teamKey, "dal");
  assert.ok(simple.favorites.every((team) => team.timeZone === "America/Denver"));
  const calls = [];
  const registry = createTeamSelection(simple, {
    load: () => { throw new Error("Catalog must not load schedules"); },
    lookup: async (team) => {
      calls.push(team.teamKey);
      const original = favorites.find((favorite) => favorite.teamUrl === team.teamUrl);
      return { name: original.name, mascot: original.mascot, logo: `https://example.com/${team.teamKey}.png` };
    },
  });
  const catalog = await registry.getCatalog();
  assert.equal(catalog.defaultKey, "nfl:dal");
  assert.deepEqual(catalog.teams.map((team) => team.mascot), ["Cowboys", "Longhorns", "Roadrunners"]);
  assert.equal(catalog.teams[0].name, "Dallas Cowboys");
  assert.equal(catalog.teams[0].logo, "https://example.com/dal.png");
  assert.deepEqual(await registry.getCatalog(), catalog);
  assert.deepEqual(calls, ["dal", "251", "2636"]);
});

test("metadata failures leave favorites selectable and retry on the next request", async () => {
  let calls = 0;
  const registry = createTeamSelection(parseConfig({ favorites: [{ teamUrl: dallas }] }), {
    lookup: async () => {
      if (++calls === 1) throw new Error("Offline");
      return { name: "Dallas Cowboys", mascot: "Cowboys", logo: null };
    },
  });
  const fallback = await registry.getCatalog();
  assert.equal(fallback.teams[0].key, "nfl:dal");
  assert.equal(fallback.teams[0].name, "dallas cowboys");
  assert.equal((await registry.getCatalog()).teams[0].mascot, "Cowboys");
});

test("favorite metadata comes from ESPN for both abbreviations and numeric IDs", async () => {
  for (const favorite of config.favorites) {
    const choice = await getTeamChoice(favorite, { fetchImpl: async (url) => {
      assert.equal(url, `https://site.api.espn.com/apis/site/v2/sports/football/${favorite.league}/teams/${favorite.teamKey}`);
      return { ok: true, json: async () => ({ team: {
        displayName: favorite.name, name: favorite.mascot, logos: [{ href: "https://example.com/logo.png" }],
      } }) };
    } });
    assert.deepEqual(choice, { name: favorite.name, mascot: favorite.mascot, logo: "https://example.com/logo.png" });
  }
  await assert.rejects(getTeamChoice(config, { fetchImpl: async () => ({ ok: false, status: 503 }) }), /503/);
  await assert.rejects(getTeamChoice(config, { fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }), /Incomplete/);
});

test("favorites accept mixed leagues, inherit the display timezone and reject invalid entries", () => {
  assert.equal(config.favorites.length, 3);
  assert.equal(config.favorites[1].teamKey, "251");
  assert.equal(config.favorites[2].teamKey, "2636");
  assert.ok(config.favorites.every((team) => team.timeZone === "America/New_York"));
  assert.ok(Object.isFrozen(config.favorites));
  for (const invalid of [null, {}, [null], [{ ...favorites[0], name: "" }],
    [{ ...favorites[0], mascot: null }], [{ ...favorites[0], logo: "javascript:alert(1)" }],
    [{ ...favorites[0], logo: "https://" }], [{ ...favorites[0], logo: "https://user:password@example.com/logo.png" }],
    [{ ...favorites[0], teamUrl: "https://example.com/team" }]]) {
    assert.throws(() => parseConfig({ teamUrl: dallas, favorites: invalid }));
  }
});

test("only the selected team's loader runs and team caches never cross leagues", async () => {
  const calls = [];
  const registry = createTeamSelection(config, { load: async ({ config: team }) => {
    calls.push(`${team.league}:${team.teamKey}`);
    return { team: { name: team.name }, league: team.league };
  } });
  assert.equal(calls.length, 0, "catalog does not poll inactive teams");
  assert.deepEqual(registry.catalog.teams.map((team) => team.mascot), ["Cowboys", "Longhorns", "Roadrunners"]);
  assert.equal(registry.get("nfl:2636"), undefined);
  const [cowboys, texas] = await Promise.all([registry.get()(), registry.get("college-football:251")()]);
  assert.equal(cowboys.team.name, "Dallas Cowboys");
  assert.equal(texas.team.name, "Texas Longhorns");
  await registry.get()();
  assert.deepEqual(calls, ["nfl:dal", "college-football:251"]);
  const utsa = await registry.get("college-football:2636")();
  assert.equal(utsa.team.name, "UTSA Roadrunners");
});

test("one team failing does not display another team's cached scores", async () => {
  const registry = createTeamSelection(config, { load: async ({ config: team }) => {
    if (team.league !== "nfl") throw new Error("Feed unavailable");
    return { team: { name: "Dallas Cowboys" } };
  } });
  await registry.get()();
  await assert.rejects(registry.get("college-football:251")(), /Feed unavailable/);
});

test("the same numeric team ID in different leagues uses separate caches", async () => {
  const teams = [
    { teamUrl: "https://www.espn.com/nfl/team/_/id/8/detroit-lions", name: "Detroit Lions", mascot: "Lions" },
    { teamUrl: "https://www.espn.com/college-football/team/_/id/8/arkansas-razorbacks", name: "Arkansas Razorbacks", mascot: "Razorbacks" },
  ];
  const registry = createTeamSelection(parseConfig({ teamUrl: teams[0].teamUrl, favorites: teams }), {
    load: async ({ config: team }) => ({ team: team.name }),
  });
  assert.equal((await registry.get("nfl:8")()).team, "Detroit Lions");
  assert.equal((await registry.get("college-football:8")()).team, "Arkansas Razorbacks");
  assert.equal((await registry.get("nfl:8")()).team, "Detroit Lions");
});

test("the original team stays selectable, duplicate favorites collapse and old configs still work", () => {
  const other = createTeamSelection(parseConfig({ teamUrl: dallas, favorites: [favorites[1], favorites[1]] }));
  assert.deepEqual(other.catalog.teams.map((team) => team.key), ["college-football:251", "nfl:dal"]);
  const single = createTeamSelection(parseConfig({ teamUrl: dallas }));
  assert.deepEqual(single.catalog, { defaultKey: "nfl:dal", teams: [] });
  assert.equal(typeof single.get(), "function");
});

test("explicit links override the saved team; removed favorites fall back safely after reboot", () => {
  const { catalog } = createTeamSelection(config);
  assert.equal(selectedFavorite(catalog, "college-football:251", "nfl:dal"), "college-football:251");
  assert.equal(selectedFavorite(catalog, null, "college-football:2636"), "college-football:2636");
  assert.equal(selectedFavorite(catalog, "nfl:unknown", "removed"), "nfl:dal");
});

function element() {
  return {
    children: [], attributes: {}, events: {}, hidden: false,
    replaceChildren() { this.children = []; },
    append(child) { this.children.push(child); },
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(key, listener) { this.events[key] = listener; },
  };
}

test("picker renders accessible logo/mascot links, saves taps and degrades on image failure", () => {
  const container = element();
  const remembered = [];
  const { catalog } = createTeamSelection(config);
  renderTeamPicker(container, catalog, "college-football:251", {
    document: { createElement: element }, remember: (key) => remembered.push(key),
  });
  assert.equal(container.hidden, false);
  assert.equal(container.children.length, 3);
  const [cowboys, texas, utsa] = container.children;
  assert.equal(cowboys.children[0].alt, "");
  assert.equal(cowboys.children[1].textContent, "Cowboys");
  assert.equal(cowboys.attributes["aria-label"], "Show Dallas Cowboys");
  assert.equal(texas.attributes["aria-current"], "page");
  assert.equal(cowboys.attributes["aria-current"], undefined);
  assert.equal(utsa.href, "/?team=college-football%3A2636");
  utsa.events.click();
  assert.deepEqual(remembered, ["college-football:2636"]);
  cowboys.children[0].events.error();
  assert.equal(cowboys.children[0].hidden, true);
  assert.equal(cowboys.children[1].textContent, "Cowboys");
  renderTeamPicker(container, { teams: [catalog.teams[0]] }, "nfl:dal", { document: { createElement: element } });
  assert.equal(container.hidden, true);
});

test("favorites stay horizontally scrollable with touch targets and native swipes", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /<nav id="team-picker"[^>]*aria-label="Favorite teams"/);
  assert.match(css, /\.team-picker\s*\{[^}]*min-width: 0;[^}]*overflow-x: auto;[^}]*touch-action: pan-x;/);
  assert.match(css, /\.favorite-team\s*\{[^}]*flex: none;[^}]*min-height: 44px;/);
  assert.match(css, /\.favorite-team\[aria-current="page"\]/);
  assert.match(css, /\.favorite-team\[aria-current="page"\]\s*\{[^}]*border-color: var\(--team-color\);/);
  assert.match(css, /\.favorite-team:first-child\s*\{\s*margin-inline-start: auto;/);
});
