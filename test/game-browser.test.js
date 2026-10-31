import test from "node:test";
import assert from "node:assert/strict";
import { browseGames, createGameBrowser } from "../src/game-browser.js";
import { startTeamPicker } from "../public/team-picker.js";
import { readFile } from "node:fs/promises";

test("scores navigation has no decorative arrows and uses a compact, single-title header", async () => {
  const [dashboard, page, script, styles] = await Promise.all([
    "../public/index.html", "../public/games.html", "../public/games.js", "../public/styles.css",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  assert.doesNotMatch(dashboard, /id="back-favorites"/);
  assert.match(dashboard, /id="team-picker"/);
  assert.doesNotMatch(page + script, /↗|←|game-card-arrow|AROUND THE LEAGUE/);
  assert.equal((page.match(/id="games-title"/g) ?? []).length, 1);
  assert.match(page, /<h1 id="games-title">/);
  assert.match(styles, /\.games-heading\s*\{[^}]*gap: 12px;/);
  assert.match(styles, /\.games-info p\s*\{\s*margin: 0;/);
});

function event(id, date, ranks = [null, null], state = "pre") {
  return { id, date, name: `Game ${id}`, competitions: [{ date,
    status: { type: { state, detail: state === "pre" ? "Scheduled" : "Live" } },
    competitors: ["home", "away"].map((homeAway, i) => ({ homeAway, score: "7",
      curatedRank: { current: ranks[i] }, team: { id: String(i + 1), displayName: `Team ${i + 1}`, location: "City", name: "Team" } })),
  }] };
}

test("college shows either ranked competitor, excludes sentinels, and sorts all states by kickoff", () => {
  const payload = { events: [event("3", "2026-10-31T23:00Z", [1, 2]),
    event("1", "2026-10-31T16:00Z", [99, 25], "in"),
    event("2", "2026-10-31T19:00Z", [null, 99]), { id: "broken" }] };
  assert.deepEqual(browseGames(payload, "college-football").map((game) => game.id), ["1", "3"]);
  assert.deepEqual(browseGames(payload, "nfl").map((game) => game.id), ["1", "2", "3"]);
});

test("list feeds are league-isolated, deduplicated and fall back to stale scores", async () => {
  let time = 0, calls = [], offline = false;
  const browser = createGameBrowser({ now: () => time, fetchImpl: async (url) => {
    calls.push(url);
    if (offline) throw new Error("Offline");
    return { ok: true, json: async () => ({ events: [event("1", "2026-10-31T16:00Z", [1, null])] }) };
  } });
  const [a, b] = await Promise.all([browser.list("nfl"), browser.list("nfl")]);
  assert.equal(calls.length, 1);
  assert.deepEqual(a, b);
  await browser.list("college-football");
  assert.equal(calls.length, 2);
  assert.ok(calls.every((url) => !url.includes("groups=80")), "do not use the truncated broad FBS slate");
  offline = true;
  time = 16_000;
  const stale = await browser.list("nfl");
  assert.equal(stale.stale, true);
  assert.equal(stale.games[0].id, "1");
  assert.equal(stale.refreshedAt, a.refreshedAt);
});

test("watching fetches the exact event summary, not a team's selected schedule game", async () => {
  const game = event("123", "2026-10-31T16:00Z", [2, null], "in");
  const calls = [];
  const browser = createGameBrowser({ timeZone: "America/New_York", fetchImpl: async (url) => {
    calls.push(url);
    return { ok: true, json: async () => ({ header: { ...game, season: { year: 2026 } } }) };
  } });
  const payload = await browser.watch("college-football", "123");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /college-football\/summary\?event=123$/);
  assert.equal(payload.spotlight.id, "123");
  assert.equal(payload.spotlight.state, "live");
  assert.equal(payload.team.id, "1");
  assert.equal(payload.nextGame, null);
  assert.equal(payload.timeZone, "America/New_York");
  assert.ok(Array.isArray(payload.spotlight.drives));
});

test("a dashboard game includes its own matchup predictor even without a next game", async () => {
  const game = event("401856733", "2026-10-31T16:00Z", [2, null]);
  const browser = createGameBrowser({ fetchImpl: async () => ({ ok: true, json: async () => ({
    header: game, predictor: { homeTeam: { id: "1", gameProjection: "26" },
      awayTeam: { id: "2", gameProjection: "74" } },
  }) }) });
  const payload = await browser.watch("college-football", game.id);
  assert.equal(payload.nextGame, null);
  assert.deepEqual(payload.spotlight.matchupPredictor, {
    selectedTeam: 26, opponent: 74, source: "ESPN Analytics",
  });
});

test("bad leagues, game IDs and mismatched summaries never load an unrelated game", async () => {
  const browser = createGameBrowser({ fetchImpl: async () => ({ ok: true, json: async () => ({ header: { id: "999" } }) }) });
  assert.throws(() => browser.list("nba"));
  assert.throws(() => browser.watch("nfl", "../123"));
  await assert.rejects(browser.watch("nfl", "123"), /Mismatched game/);
});

test("a failed first load retries, and an empty valid slate is not a feed error", async () => {
  let calls = 0;
  const browser = createGameBrowser({ fetchImpl: async () => ({ ok: true,
    json: async () => ++calls === 1 ? {} : { events: [] },
  }) });
  await assert.rejects(browser.list("nfl"), /Missing game list/);
  assert.deepEqual((await browser.list("nfl")).games, []);
  assert.equal(calls, 2);
});

test("temporary watching preserves saved favorites and selection; favorite links still exit normally", async () => {
  const originals = new Map(["document", "location", "localStorage", "fetch"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const writes = [];
  function node() {
    return { children: [], attributes: {}, listeners: {},
      replaceChildren() { this.children = []; }, append(child) { this.children.push(child); },
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(key, listener) { (this.listeners[key] ??= []).push(listener); },
      querySelectorAll() { return []; },
    };
  }
  const nodes = new Map();
  const document = { querySelector: (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, node());
    return nodes.get(selector);
  }, createElement: node, addEventListener() {} };
  const teams = [{ key: "nfl:dal", name: "Dallas Cowboys", mascot: "Cowboys" },
    { key: "college-football:251", name: "Texas Longhorns", mascot: "Longhorns" }];
  try {
    Object.assign(globalThis, { document, location: { search: "?league=nfl&game=123" },
      localStorage: { getItem: (key) => key === "scoreboard-favorite" ? "college-football:251" : JSON.stringify(teams),
        setItem: (...args) => writes.push(args) },
      fetch: async () => ({ ok: true, json: async () => ({ defaultKey: "nfl:dal", teams }) }),
    });
    assert.equal(await startTeamPicker({ temporary: true }), "college-football:251");
    assert.deepEqual(writes, [], "opening a temporary game must never persist selection or favorites");
    const links = nodes.get("#team-picker").children.map((item) => item.children[0]);
    assert.ok(links.every((link) => !link.attributes["aria-current"]));
    assert.equal(links[0].href, "/?team=nfl%3Adal", "favorite navigation must drop the temporary game");
    links[0].listeners.click[0]({});
    assert.deepEqual(writes, [["scoreboard-favorite", "nfl:dal"]]);
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
