import { normalizeGame } from "./scoreboard.js";
import { gameHighlights } from "./highlights.js";
import { matchupPredictor } from "./game-details.js";

function recentPlays(summary) {
  const drives = [...(summary.drives?.previous ?? []), summary.drives?.current].filter(Boolean);
  const byId = new Map();
  for (const play of drives.flatMap((drive) => drive.plays ?? [])) {
    if (play.id && play.text) byId.set(play.id, play);
  }
  return [...byId.values()].sort((a, b) => {
    const period = Number(a.period?.number ?? 0) - Number(b.period?.number ?? 0);
    if (period) return period;
    // Full college feeds can reuse/reset sequences (including an OT end marker
    // with a Q2 sequence). Use actual play timestamps when both are available.
    const time = Date.parse(a.wallclock) - Date.parse(b.wallclock);
    return (Number.isFinite(time) && time !== 0 ? time : 0)
      || Number(a.sequenceNumber ?? 0) - Number(b.sequenceNumber ?? 0);
  });
}

function driveSummary(drive, orderedPlays, scoringTeams) {
  const ids = new Set((drive.plays ?? []).map((play) => String(play.id)));
  return {
    id: String(drive.id),
    teamId: drive.team?.id == null ? null : String(drive.team.id),
    team: drive.team?.abbreviation ?? drive.team?.shortDisplayName ?? "—",
    result: drive.displayResult ?? null,
    description: drive.description ?? null,
    yards: Number.isFinite(drive.yards) ? drive.yards : null,
    time: drive.timeElapsed?.displayValue ?? null,
    plays: orderedPlays.filter((play) => ids.has(String(play.id))).map((play) => ({
      id: String(play.id), text: play.text,
      period: play.period?.number ?? null,
      clock: play.clock?.displayValue ?? null,
      scoring: Boolean(play.scoringPlay),
      scoringTeamId: play.scoringPlay ? scoringTeams.get(String(play.id)) ?? null : null,
      penalty: play.penalty?.type?.text ?? (/penalty/i.test(play.type?.text ?? "") ? "Penalty" : null),
    })),
  };
}

function gameLeaders(summary, teamIds) {
  const categories = ["passingYards", "rushingYards", "receivingYards"];
  const playerStat = (teamId, athleteId, category, label) => {
    const team = (summary.boxscore?.players ?? []).find((item) => String(item.team?.id) === teamId);
    const group = team?.statistics?.find((item) => item.name === category);
    const index = group?.labels?.indexOf(label) ?? -1;
    const athlete = group?.athletes?.find((item) => String(item.athlete?.id) === athleteId);
    const value = Number(index < 0 ? NaN : athlete?.stats?.[index]);
    return Number.isFinite(value) ? value : null;
  };
  return categories.map((category) => ({
    category,
    leaders: (summary.leaders ?? []).filter((team) => teamIds.includes(String(team.team?.id)))
      .flatMap((team) => (team.leaders ?? []).filter((item) => item.name === category)
        .flatMap((item) => (item.leaders ?? []).slice(0, 1).map((leader) => {
          const stats = leader.summary ?? leader.displayValue ?? "";
          const attempts = category === "passingYards" ? stats.match(/\b\d+\s*\/\s*\d+\b/)?.[0]?.replace(/\s/g, "")
            : stats.match(category === "rushingYards" ? /\b\d+\s+CAR\b/i : /\b\d+\s+REC\b/i)?.[0] ?? null;
          return {
          teamId: String(team.team.id),
          team: team.team?.abbreviation ?? "—",
          name: leader.athlete?.displayName ?? null,
          value: leader.displayValue ?? null,
          yards: Number.isFinite(leader.value) ? leader.value : null,
          summary: leader.summary ?? null,
          attempts: attempts ?? null,
          touchdowns: stats ? Number(stats.match(/\b(\d+)\s+TD\b/i)?.[1] ?? 0) : null,
          interceptions: playerStat(String(team.team.id), String(leader.athlete?.id), "passing", "INT")
            ?? (category === "passingYards" && stats ? Number(stats.match(/\b(\d+)\s+INT\b/i)?.[1] ?? 0) : null),
          fumbles: playerStat(String(team.team.id), String(leader.athlete?.id), "fumbles", "FUM"),
          shortName: leader.athlete?.shortName ?? leader.athlete?.displayName ?? null,
          position: leader.athlete?.position?.abbreviation ?? null,
          headshot: /^https:\/\//.test(leader.athlete?.headshot?.href ?? "") ? leader.athlete.headshot.href : null,
          };
        })))
      .filter((leader) => leader.name && leader.value),
  }));
}

// Fixed diagram orientation: away attacks right, home attacks left. This is
// independent of the physical direction teams switch each quarter.
function positionFromText(text, home, away) {
  const match = /^(.*?)\s+(\d{1,2})$/.exec(text ?? "");
  if (!match) return null;
  const yards = Number(match[2]);
  if (yards > 50) return null;
  if (match[1] === home.abbreviation) return 100 - yards;
  if (match[1] === away.abbreviation) return yards;
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
  const scoringTeams = new Map((summary.scoringPlays ?? [])
    .filter((play) => [home.id, away.id].includes(String(play.team?.id)))
    .map((play) => [String(play.id), String(play.team.id)]));
  const latestPlay = plays.at(-1);
  const currentDrive = summary.drives?.current;
  const currentIds = new Set((currentDrive?.plays ?? []).map((play) => String(play.id)));
  const currentPlays = plays.filter((play) => currentIds.has(String(play.id)));
  const driveMap = new Map();
  for (const drive of [...(summary.drives?.previous ?? []), currentDrive].filter((drive) => drive?.id != null)) {
    driveMap.set(String(drive.id), driveSummary(drive, plays, scoringTeams));
  }
  const drives = [...driveMap.values()].filter((drive) => drive.plays.length);
  const isPause = (play) => /Timeout|End Period|End of Half|End of Regulation/i.test(play?.type?.text ?? "");
  const situation = summary.situation ?? competition.situation;
  let possessionId = situation?.possession == null ? null : String(situation.possession);
  let position = positionFromText(situation?.possessionText, home, away);
  let downDistance = situation?.downDistanceText ?? situation?.shortDownDistanceText ?? null;
  let down = situation?.down;
  let distance = situation?.distance;
  let positionLabel = situation?.possessionText ?? null;
  let positionSource = "current situation";

  // Timeout/period markers sometimes have placeholder yardage. Ignore them and
  // use the latest actual play in this drive, never a previous drive or a play
  // before a score/kickoff. The source stays in the model, not the field caption.
  if (!situation) {
    const last = currentPlays.findLast((play) => !isPause(play));
    const end = last?.end;
    possessionId = end?.team?.id == null ? null : String(end.team.id);
    // ESPN can flip yardsToEndzone on a no-gain play while its possessionText
    // still names the correct side of the field. Prefer that named yard line.
    const namedPosition = positionFromText(end?.possessionText, home, away);
    if ((namedPosition !== null || (Number.isFinite(end?.yardsToEndzone) && end.yardsToEndzone >= 0 && end.yardsToEndzone <= 100))
        && !last.scoringPlay && !/End Period|End of|Timeout|Kickoff|Extra Point/i.test(last.type?.text ?? "")) {
      position = namedPosition ?? (possessionId === home.id ? end.yardsToEndzone
        : possessionId === away.id ? 100 - end.yardsToEndzone : null);
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
    direction: possessionId === home.id ? "left" : "right",
    label: positionLabel,
    downDistance,
    source: positionSource,
    firstDownPercent: [1, 2, 3, 4].includes(down) && Number.isFinite(distance) && distance > 0
      ? Math.max(0, Math.min(100, position + (possessionId === home.id ? -distance : distance))) : null,
  } : null;

  return {
    ...updated,
    broadcasts: updated.broadcasts.length ? updated.broadcasts : game.broadcasts ?? [],
    matchupPredictor: matchupPredictor(summary.predictor, updated),
    fieldContext: {
      driveId: currentDrive?.id == null ? null : String(currentDrive.id),
      lastPlayId: latestPlay?.id == null ? null : String(latestPlay.id),
      lastPlayAt: latestPlay?.wallclock ?? null,
      lastPlaySequence: latestPlay?.sequenceNumber == null ? null : Number(latestPlay.sequenceNumber),
      lastPlayType: latestPlay?.type?.text ?? "",
      scoring: Boolean(latestPlay?.scoringPlay),
      turnover: Boolean(latestPlay?.isTurnover),
      pause: isPause(latestPlay),
      possessionTeamId: possessionTeam?.id ?? null,
    },
    ball,
    possessionTeamId: updated.state === "live" && possessionTeam && (situation || ball) ? possessionTeam.id : null,
    highlights: gameHighlights(plays, summary.scoringPlays, [home.id, away.id]),
    latestPlaySequence: Math.max(0, ...plays.map((play) => Number(play.sequenceNumber)).filter(Number.isFinite)),
    drives,
    leaders: gameLeaders(summary, [home.id, away.id]),
    currentDriveId: drives.some((drive) => drive.id === String(currentDrive?.id))
      ? String(currentDrive.id) : drives.at(-1)?.id ?? null,
    plays: plays.slice(-5).reverse().map((play) => ({
      id: String(play.id), text: play.text,
      period: play.period?.number ?? null,
      clock: play.clock?.displayValue ?? null,
      scoring: Boolean(play.scoringPlay),
    })),
  };
}
