const BASE_URL = "https://site.api.espn.com/apis/site/v2/sports/football";
export const TEAM_LEAGUES = ["nfl", "college-football"];

/** Cache the ESPN directory, including in-flight requests; failed requests can retry. */
export function createTeamDirectory({ fetchImpl = fetch } = {}) {
  const cache = new Map();
  async function leagueTeams(league) {
    if (!TEAM_LEAGUES.includes(league)) throw new Error("Unknown football league");
    const previous = cache.get(league);
    if (previous && previous.expires > Date.now()) return previous.promise;
    const promise = (async () => {
      const response = await fetchImpl(`${BASE_URL}/${league}/teams?limit=1000`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Team directory HTTP ${response.status}`);
      const payload = await response.json();
      const entries = payload.sports?.[0]?.leagues?.[0]?.teams;
      if (!Array.isArray(entries) || !entries.length) throw new Error("Team directory unavailable");
      return entries.flatMap(({ team }) => {
        if (!/^\d+$/.test(team?.id) || !team.displayName) return [];
        const teamKey = league === "nfl" && /^[a-z]{2,4}$/i.test(team.abbreviation)
          ? team.abbreviation.toLowerCase() : team.id;
        return [{ key: `${league}:${teamKey}`, id: String(team.id), league, teamKey,
          name: team.displayName, mascot: team.name ?? team.displayName,
          abbreviation: team.abbreviation ?? "", logo: team.logos?.[0]?.href ?? null }];
      }).sort((a, b) => a.name.localeCompare(b.name));
    })();
    cache.set(league, { promise, expires: Date.now() + 86_400_000 });
    try { return await promise; }
    catch (error) { cache.delete(league); throw error; }
  }
  return {
    async list(league) {
      return league ? leagueTeams(league) : (await Promise.all(TEAM_LEAGUES.map(leagueTeams))).flat();
    },
    async find(key) {
      const match = /^(nfl|college-football):([a-z0-9]+)$/.exec(key ?? "");
      if (!match) return undefined;
      return (await leagueTeams(match[1])).find((team) => team.key === key || `${team.league}:${team.id}` === key);
    },
  };
}
