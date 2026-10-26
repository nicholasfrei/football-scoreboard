export function broadcastNetworks(broadcasts = []) {
  if (!Array.isArray(broadcasts)) return [];
  return [...new Set(broadcasts.flatMap((broadcast) => {
    if (/radio/i.test(broadcast.type?.shortName ?? "")) return [];
    return broadcast.media?.shortName ? [broadcast.media.shortName] : broadcast.names ?? [];
  }).filter((name) => typeof name === "string" && name.trim()))];
}

function probability(value) {
  if (!["number", "string"].includes(typeof value) || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
}

export function matchupPredictor(predictor, game) {
  if (!predictor) return null;
  const teams = [predictor.homeTeam, predictor.awayTeam].filter(Boolean);
  const selectedTeam = probability(teams.find((team) => String(team.id) === game.selectedTeam.id)?.gameProjection);
  const opponent = probability(teams.find((team) => String(team.id) === game.opponent.id)?.gameProjection);
  // Keep ESPN's two reported percentages, rather than inferring a complement.
  // NFL models can reserve probability for a tie. Do not normalize it away.
  if (selectedTeam === null || opponent === null) return null;
  const total = selectedTeam + opponent;
  if (game.league === "nfl" ? total > 100.2 : Math.abs(total - 100) > 1) return null;
  return { selectedTeam, opponent, source: "ESPN Analytics" };
}
