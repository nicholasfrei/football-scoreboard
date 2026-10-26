import { teamBrand } from "./branding.js";
import { teamStats } from "./team-stats.js";
import { broadcastNetworks } from "./game-details.js";

function scoreValue(competitor) {
  const raw = competitor?.score;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim() !== "") return Number.isFinite(Number(raw)) ? Number(raw) : null;
  const value = competitor?.score?.value;
  if (Number.isFinite(value)) return value;

  const displayValue = competitor?.score?.displayValue;
  if (displayValue !== undefined && displayValue !== null && displayValue !== "") {
    const parsed = Number(displayValue);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeTeam(competitor, league) {
  const team = competitor?.team ?? {};
  return {
    id: String(team.id ?? ""),
    name: team.displayName ?? team.name ?? "Unknown team",
    shortName: team.shortDisplayName ?? team.location ?? team.name ?? "Team",
    abbreviation: team.abbreviation ?? "—",
    ...teamBrand(team, league),
    ...teamStats(competitor, league),
    score: scoreValue(competitor),
    winner: competitor?.winner ?? false,
  };
}

function normalizeGame(event, { teamId = "8", league = "college-football" } = {}) {
  const competition = event?.competitions?.[0];
  if (!competition) return null;

  const competitors = competition.competitors ?? [];
  const selectedTeam = competitors.find((competitor) => String(competitor.team?.id) === teamId);
  const opponent = competitors.find((competitor) => competitor.team?.id != null && String(competitor.team.id) !== teamId);
  if (!selectedTeam || !opponent) return null;

  const status = competition.status ?? {};
  const statusType = status.type ?? {};
  const exceptional = /POSTPONED|CANCELED|CANCELLED|SUSPENDED|DELAYED/.test(statusType.name ?? "");
  const state = exceptional ? "unknown" : statusType.state === "in"
    ? "live"
    : statusType.completed || statusType.state === "post"
      ? "final"
      : statusType.state === "pre"
        ? "scheduled"
        : "unknown";

  return {
    id: String(event.id ?? ""),
    league,
    kickoffAt: event.date ?? null,
    timeTbd: event.timeValid === false || /TBD/i.test(statusType.detail ?? ""),
    neutralSite: competition.neutralSite ?? false,
    name: event.name ?? "Football",
    state,
    status: statusType.detail ?? statusType.shortDetail ?? statusType.description ?? "Status unavailable",
    clock: status.displayClock ?? null,
    period: status.period ?? null,
    venue: competition.venue?.fullName ?? null,
    broadcasts: broadcastNetworks(competition.broadcasts),
    homeAway: selectedTeam.homeAway ?? "home",
    selectedTeam: normalizeTeam(selectedTeam, league),
    opponent: normalizeTeam(opponent, league),
  };
}

function byKickoffAscending(a, b) {
  return new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime();
}

/**
 * Convert the provider payload into the small model the display needs.
 * The spotlight is live first, then the latest completed game, then the
 * next scheduled game. Selection uses the provider's status instead of the
 * device clock so a delayed feed does not mistake an in-progress game.
 */
export function selectScoreboard(payload, now = new Date(), { teamId = "8", league = "college-football" } = {}) {
  const games = (payload?.events ?? [])
    .map((event) => normalizeGame(event, { teamId, league }))
    .filter(Boolean)
    .sort(byKickoffAscending);

  const liveGame = games.find((game) => game.state === "live") ?? null;
  const completedGames = games.filter((game) => game.state === "final");
  const latestFinal = completedGames.at(-1) ?? null;
  const upcomingGames = games.filter((game) => game.state === "scheduled");
  const nextGame = upcomingGames[0] ?? null;
  const spotlight = liveGame ?? latestFinal ?? nextGame;

  return {
    team: {
      id: teamId,
      name: payload?.team?.displayName ?? spotlight?.selectedTeam.name ?? "Football",
      abbreviation: payload?.team?.abbreviation ?? spotlight?.selectedTeam.abbreviation ?? "",
      ...teamBrand({ ...payload?.team, id: teamId }, league),
      record: payload?.team?.recordSummary ?? null,
    },
    league,
    spotlight,
    nextGame: liveGame || latestFinal ? nextGame : upcomingGames[1] ?? null,
    season: payload?.season?.year ?? now.getUTCFullYear(),
    refreshedAt: now.toISOString(),
    source: "ESPN public schedule feed",
  };
}

export { normalizeGame };
