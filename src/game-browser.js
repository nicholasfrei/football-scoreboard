import { normalizeGame } from "./scoreboard.js";
import { enrichGame } from "./gamecast.js";

const BASE_URL = "https://site.api.espn.com/apis/site/v2/sports/football";
export const isFootballLeague = (league) => ["nfl", "college-football"].includes(league);

export function browseGames(payload, league) {
  return (payload.events ?? []).map((event) => {
    const competition = event.competitions?.[0];
    const home = competition?.competitors?.find((team) => team.homeAway === "home");
    return home ? normalizeGame(event, { league, teamId: String(home.team.id) }) : null;
  }).filter((game) => game && (league === "nfl" || game.selectedTeam.rank || game.opponent.rank))
    .sort((a, b) => (Date.parse(a.kickoffAt) || Infinity) - (Date.parse(b.kickoffAt) || Infinity)
      || a.id.localeCompare(b.id));
}

/** Separate, short-lived feeds: browsing never touches favorite/team selection. */
export function createGameBrowser({ timeZone = "America/Chicago", fetchImpl = fetch, now = Date.now } = {}) {
  const cache = new Map();
  async function cached(key, load) {
    const previous = cache.get(key);
    if (previous?.pending) return previous.pending;
    if (previous?.value && now() < previous.expiresAt) return { ...previous.value, stale: false };
    const entry = previous ?? {};
    // Bound memory when many different games are opened over a season.
    if (!previous && cache.size >= 100) cache.delete(cache.keys().next().value);
    cache.set(key, entry);
    entry.pending = Promise.resolve().then(load).then((value) => {
      entry.value = value;
      entry.expiresAt = now() + 15_000;
      return { ...value, stale: false };
    }).catch((error) => {
      if (entry.value) return { ...entry.value, stale: true };
      cache.delete(key);
      throw error;
    }).finally(() => { entry.pending = null; });
    return entry.pending;
  }
  async function request(path) {
    const response = await fetchImpl(`${BASE_URL}/${path}`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Game feed HTTP ${response.status}`);
    return response.json();
  }
  return {
    list(league) {
      if (!isFootballLeague(league)) throw new Error("Invalid football league");
      return cached(`list:${league}`, async () => {
        // ESPN's default college group is Top 25. The broader FBS group can
        // truncate before the evening slate even with a large limit.
        const payload = await request(`${league}/scoreboard?limit=1000`);
        if (!Array.isArray(payload.events)) throw new Error("Missing game list");
        return { league, games: browseGames(payload, league), timeZone,
          week: payload.week?.number ?? null, season: payload.season?.year ?? null,
          refreshedAt: new Date(now()).toISOString() };
      });
    },
    watch(league, id) {
      if (!isFootballLeague(league) || !/^\d{1,15}$/.test(id ?? "")) throw new Error("Invalid game");
      return cached(`watch:${league}:${id}`, async () => {
        const summary = await request(`${league}/summary?event=${id}`);
        const header = summary.header;
        if (String(header?.id) !== id) throw new Error("Mismatched game");
        const home = header.competitions?.[0]?.competitors?.find((team) => team.homeAway === "home");
        const game = home && normalizeGame({ ...header, date: header.competitions[0].date },
          { league, teamId: String(home.team.id) });
        if (!game) throw new Error("Game unavailable");
        const spotlight = enrichGame(game, summary);
        return { team: spotlight.selectedTeam, league, spotlight, nextGame: null, timeZone,
          season: header.season?.year ?? new Date(now()).getUTCFullYear(),
          refreshedAt: new Date(now()).toISOString(), source: "ESPN game summary" };
      });
    },
  };
}
