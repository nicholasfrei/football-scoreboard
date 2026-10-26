import { normalizeGame } from "./scoreboard.js";
import { gameHighlights } from "./highlights.js";
import { matchupPredictor } from "./game-details.js";

function recentPlays(summary) {
  const drives = [...(summary.drives?.previous ?? []), summary.drives?.current].filter(Boolean);
  const byId = new Map();
  for (const play of drives.flatMap((drive) => drive.plays ?? [])) {
    if (play.id && play.text) byId.set(play.id, play);
  }
  return [...byId.values()].sort((a, b) => Number(a.sequenceNumber ?? 0) - Number(b.sequenceNumber ?? 0));
}

// Fixed diagram orientation: home attacks right, away attacks left. This is
// independent of the physical direction teams switch each quarter.
function positionFromText(text, home, away) {
  const match = /^(.*?)\s+(\d{1,2})$/.exec(text ?? "");
  if (!match) return null;
  const yards = Number(match[2]);
  if (yards > 50) return null;
  if (match[1] === home.abbreviation) return yards;
  if (match[1] === away.abbreviation) return 100 - yards;
  return null;
}

export function enrichGame(game, summary) {
  const competition = summary.header?.competitions?.[0];
  if (!competition || String(summary.header.id) !== game.id) throw new Error("Unexpected game summary");
  const updated = normalizeGame({
    id: game.id, date: competition.date ?? game.kickoffAt, name: game.name,
    timeValid: !game.timeTbd,
    competitions: [{ ...competition, venue: summary.gameInfo?.venue ?? { fullName: game.venue } }],
  }, { teamId: game.selectedTeam?.id ?? "8", league: game.league ?? "college-football" });
  if (!updated) throw new Error("Summary is missing the matchup");
  for (const key of ["selectedTeam", "opponent"]) {
    const previous = game[key];
    const team = updated[key];
    if (previous?.id !== team.id) continue;
    // Summary often omits curatedRank and some records that the schedule has.
    // Explicit unranked values still take precedence over an earlier rank.
    if (!team.rankSource) {
      team.rank = previous.rank ?? null;
      team.rankSource = previous.rankSource ?? null;
    }
    team.record.overall ??= previous.record?.overall ?? null;
    team.record.conference ??= previous.record?.conference ?? null;
    team.conferenceId ??= previous.conferenceId ?? null;
    team.conferenceName ??= previous.conferenceName ?? null;
    team.divisionStanding ??= previous.divisionStanding ?? null;
  }
  const home = updated.homeAway === "home" ? updated.selectedTeam : updated.opponent;
  const away = updated.homeAway === "home" ? updated.opponent : updated.selectedTeam;
  const plays = recentPlays(summary);
  const situation = summary.situation ?? competition.situation;
  let possessionId = situation?.possession == null ? null : String(situation.possession);
  let position = positionFromText(situation?.possessionText, home, away);
  let downDistance = situation?.downDistanceText ?? situation?.shortDownDistanceText ?? null;
  let down = situation?.down;
  let distance = situation?.distance;
  let positionLabel = situation?.possessionText ?? null;
  let positionSource = "current situation";

  // When no current situation exists, use only the current drive's latest play,
  // explicitly labelled as last reported. Never carry over an earlier drive.
  if (!situation) {
    const last = summary.drives?.current?.plays?.at(-1);
    const end = last?.end;
    possessionId = end?.team?.id == null ? null : String(end.team.id);
    if (Number.isFinite(end?.yardsToEndzone) && end.yardsToEndzone >= 0 && end.yardsToEndzone <= 100
        && !last.scoringPlay && !/End of|Timeout|Kickoff|Extra Point/i.test(last.type?.text ?? "")) {
      position = possessionId === home.id ? 100 - end.yardsToEndzone
        : possessionId === away.id ? end.yardsToEndzone : null;
      downDistance = end.downDistanceText ?? null;
      down = end.down;
      distance = end.distance;
      positionLabel = end.possessionText ?? null;
    }
    positionSource = "last reported play";
  }

  const possessionTeam = [home, away].find((team) => team.id === possessionId);
  const ball = updated.state === "live" && possessionTeam && position !== null ? {
    percent: position,
    possession: possessionTeam.shortName,
    direction: possessionId === home.id ? "right" : "left",
    label: positionLabel,
    downDistance,
    source: positionSource,
    firstDownPercent: [1, 2, 3, 4].includes(down) && Number.isFinite(distance) && distance > 0
      ? Math.max(0, Math.min(100, position + (possessionId === home.id ? distance : -distance))) : null,
  } : null;

  return {
    ...updated,
    broadcasts: updated.broadcasts.length ? updated.broadcasts : game.broadcasts ?? [],
    matchupPredictor: matchupPredictor(summary.predictor, updated),
    ball,
    possessionTeamId: updated.state === "live" && possessionTeam && (situation || ball) ? possessionTeam.id : null,
    highlights: gameHighlights(plays, summary.scoringPlays, [home.id, away.id]),
    latestPlaySequence: Math.max(0, ...plays.map((play) => Number(play.sequenceNumber)).filter(Number.isFinite)),
    plays: plays.slice(-5).reverse().map((play) => ({
      id: String(play.id), text: play.text,
      period: play.period?.number ?? null,
      clock: play.clock?.displayValue ?? null,
      scoring: Boolean(play.scoringPlay),
    })),
  };
}
