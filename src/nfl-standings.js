const caches = new WeakMap();
const CACHE_TTL_MS = 60_000;
const ORDINALS = ["1st", "2nd", "3rd", "4th"];

export async function getNflDivisionStandings(season, fetchImpl = fetch) {
  let cache = caches.get(fetchImpl);
  if (!cache) caches.set(fetchImpl, cache = new Map());
  const previous = cache.get(season);
  if (previous && previous.expiresAt > Date.now()) return previous.standings;
  try {
    const response = await fetchImpl(`https://site.api.espn.com/apis/v2/sports/football/nfl/standings?season=${season}&type=2&level=3`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error("NFL division standings unavailable");
    const data = await response.json();
    if (Number(data.season?.year) !== Number(season) || !Array.isArray(data.children)) {
      throw new Error("Unexpected NFL standings season or groups");
    }
    const standings = new Map();
    for (const conference of data.children) {
      for (const division of conference.children ?? []) {
        if (division.isConference !== false || !/^(?:AFC|NFC) (?:East|North|South|West)$/.test(division.name ?? "")) continue;
        const entries = division.standings?.entries;
        if (!Array.isArray(entries) || entries.length !== 4) continue;
        const ids = entries.map((entry) => String(entry.team?.id ?? ""));
        if (new Set(ids).size !== 4 || ids.some((id) => !/^\d+$/.test(id))) continue;
        // Preserve ESPN's published table order, including its tiebreakers.
        // Never calculate division positions by sorting W-L records ourselves.
        ids.forEach((id, index) => standings.set(id, `${ORDINALS[index]} in ${division.name}`));
      }
    }
    cache.set(season, { standings, expiresAt: Date.now() + CACHE_TTL_MS });
    return standings;
  } catch {
    const standings = previous?.standings ?? new Map();
    cache.set(season, { standings, expiresAt: Date.now() + CACHE_TTL_MS });
    return standings;
  }
}
