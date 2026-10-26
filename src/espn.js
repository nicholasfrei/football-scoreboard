import { selectScoreboard } from "./scoreboard.js";
import { enrichGame } from "./gamecast.js";
import { teamBrand } from "./branding.js";
import { teamStats } from "./team-stats.js";
import { DEFAULT_CONFIG } from "./config.js";

const BASE_URL = "https://site.api.espn.com/apis/site/v2/sports/football";
const REQUEST_TIMEOUT_MS = 10_000;
const TEAM_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// Separate caches for injected fetch implementations keep tests isolated.
const teamCaches = new WeakMap();
const conferenceCaches = new WeakMap();

async function getConference(id, league, fetchImpl) {
  if (!/^\d+$/.test(id ?? "")) return null;
  let cache = conferenceCaches.get(fetchImpl);
  if (!cache) conferenceCaches.set(fetchImpl, cache = new Map());
  const key = `${league}:${id}`;
  const previous = cache.get(key);
  if (previous && previous.expiresAt > Date.now()) return previous.name;
  try {
    const response = await fetchImpl(`https://sports.core.api.espn.com/v2/sports/football/leagues/${league}/groups/${id}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error("Conference lookup unavailable");
    const group = await response.json();
    if (String(group.id) !== id || !group.isConference) return null;
    const name = group.shortName ?? group.abbreviation ?? group.name ?? null;
    cache.set(key, { name, expiresAt: Date.now() + TEAM_CACHE_TTL_MS });
    return name;
  } catch {
    const name = previous?.name ?? null;
    cache.set(key, { name, expiresAt: Date.now() + 60_000 });
    return name;
  }
}

async function getTeam(id, league, fetchImpl) {
  if (!/^\d+$/.test(id)) return null;
  let cache = teamCaches.get(fetchImpl);
  if (!cache) teamCaches.set(fetchImpl, cache = new Map());
  const key = `${league}:${id}`;
  const previous = cache.get(key);
  if (previous && previous.expiresAt > Date.now()) return previous.team;
  try {
    const response = await fetchImpl(`${BASE_URL}/${league}/teams/${id}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Team metadata HTTP ${response.status}`);
    const { team } = await response.json();
    if (String(team?.id) !== id || !team.displayName || !team.location || !team.name) {
      throw new Error("Incomplete or mismatched team metadata");
    }
    cache.set(key, { team, expiresAt: Date.now() + TEAM_CACHE_TTL_MS });
    return team;
  } catch {
    // Keep previous metadata during an outage; retry after a short backoff.
    const team = previous?.team ?? null;
    cache.set(key, { team, expiresAt: Date.now() + 60_000 });
    return team;
  }
}

function applyTeamMetadata(team, metadata, state, league) {
  if (!metadata) return team;
  const stats = teamStats({ team: metadata }, league);
  return {
    ...team,
    name: metadata.displayName,
    shortName: metadata.shortDisplayName ?? metadata.location,
    abbreviation: metadata.abbreviation ?? team.abbreviation,
    conferenceId: team.conferenceId ?? stats.conferenceId,
    conferenceName: team.conferenceName ?? stats.conferenceName,
    record: {
      // A current team record is not a historical game's record.
      overall: team.record.overall ?? (state === "final" ? null : stats.record.overall),
      conference: team.record.conference ?? (state === "final" ? null : stats.record.conference),
    },
    ...teamBrand({
      color: team.color, alternateColor: team.alternateColor,
      ...metadata,
      logos: metadata.logos?.length ? metadata.logos : team.logos?.map((href) => ({ href })),
    }, league),
  };
}

export async function getScoreboard({ config = DEFAULT_CONFIG, now = new Date(), fetchImpl = fetch } = {}) {
  const { league, teamKey } = config;
  const season = now.getUTCFullYear() - (now.getUTCMonth() < 7 ? 1 : 0);
  const url = `${BASE_URL}/${league}/teams/${teamKey}/schedule?season=${season}`;
  const response = await fetchImpl(url, {
    headers: { "user-agent": "FootballScoreboard/0.3 (personal display)" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`ESPN schedule request failed with HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload?.events)) {
    throw new Error("ESPN schedule response did not include an events list");
  }

  const teamId = String(payload.team?.id ?? (/^\d+$/.test(teamKey) ? teamKey : ""));
  if (!/^\d+$/.test(teamId)) throw new Error("ESPN schedule did not resolve the configured team's ID");
  const scoreboard = selectScoreboard(payload, now, { teamId, league });
  scoreboard.timeZone = config.timeZone;
  const ids = [...new Set([scoreboard.spotlight, scoreboard.nextGame].filter(Boolean)
    .flatMap((game) => [game.selectedTeam.id, game.opponent.id]).concat(teamId))];
  // Look up actual competitors, without FBS/FCS conference or season allowlists.
  // Run in parallel with summary loading so a cold cache adds no serial delay.
  const metadataPromise = Promise.all(ids.map(async (id) => [id, await getTeam(id, league, fetchImpl)]));
  await Promise.all(["spotlight", "nextGame"].map(async (key) => {
    const game = scoreboard[key];
    if (!game) return;
    try {
      const summaryResponse = await fetchImpl(`${BASE_URL}/${league}/summary?event=${game.id}`, {
        headers: { "user-agent": "FootballScoreboard/0.3 (personal display)" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!summaryResponse.ok) throw new Error(`Summary HTTP ${summaryResponse.status}`);
      scoreboard[key] = enrichGame(game, await summaryResponse.json());
    } catch {
      if (key === "spotlight") scoreboard.gamecastUnavailable = true;
      else scoreboard.nextGameDetailsUnavailable = true;
    }
  }));
  const metadata = new Map(await metadataPromise);
  for (const game of [scoreboard.spotlight, scoreboard.nextGame].filter(Boolean)) {
    game.selectedTeam = applyTeamMetadata(game.selectedTeam, metadata.get(game.selectedTeam.id), game.state, league);
    game.opponent = applyTeamMetadata(game.opponent, metadata.get(game.opponent.id), game.state, league);
  }
  const teams = [scoreboard.spotlight, scoreboard.nextGame].filter(Boolean)
    .flatMap((game) => [game.selectedTeam, game.opponent]);
  const conferenceIds = [...new Set(teams.filter((team) => !team.conferenceName && team.conferenceId).map((team) => team.conferenceId))];
  const conferences = new Map(await Promise.all(conferenceIds.map(async (id) => [id, await getConference(id, league, fetchImpl)])));
  for (const team of teams) team.conferenceName ??= conferences.get(team.conferenceId) ?? null;
  const selectedMetadata = metadata.get(teamId);
  if (selectedMetadata) {
    scoreboard.team = {
      ...scoreboard.team,
      name: selectedMetadata.displayName,
      abbreviation: selectedMetadata.abbreviation ?? scoreboard.team.abbreviation,
      ...teamBrand(selectedMetadata, league),
    };
  }
  scoreboard.source = "ESPN schedule + game summary";
  return scoreboard;
}
