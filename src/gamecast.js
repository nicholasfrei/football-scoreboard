import { normalizeGame } from "./scoreboard.js";
import { gameHighlights } from "./highlights.js";
import { matchupPredictor } from "./game-details.js";
import { acceptedPenalty, textIntentionalGrounding } from "./penalty.js";
import { kickPosition } from "./kick-position.js";
import { comparePlays } from "./play-order.js";
import { fallbackPlayEnd } from "./play-position.js";
import { blockedFieldGoalReturnPosition, uncertainBlockedFieldGoalSpot } from "./blocked-kick-position.js";
import { driveStats } from "./drive-stats.js";
import { fieldPercent, playTrajectory } from "../public/play-trajectory.js";

function recentPlays(summary) {
  const drives = [...(summary.drives?.previous ?? []), summary.drives?.current].filter(Boolean);
  const byId = new Map();
  for (const play of drives.flatMap((drive) => drive.plays ?? [])) {
    if (play.id && play.text) byId.set(play.id, play);
  }
  return [...byId.values()].sort(comparePlays);
}

function driveSummary(drive, orderedPlays, scoringTeams, home, away, league) {
  const ids = new Set((drive.plays ?? []).map((play) => String(play.id)));
  const offenseId = drive.team?.id == null ? null : String(drive.team.id);
  const plays = orderedPlays.filter((play) => ids.has(String(play.id)));
  return {
    id: String(drive.id),
    teamId: offenseId,
    team: drive.team?.abbreviation ?? drive.team?.shortDisplayName ?? "—",
    result: drive.displayResult ?? null,
    description: drive.description ?? null,
    ...driveStats(drive, plays, home, away, league),
    plays: plays.map((play) => {
      const amendment = bundledPenalty(play, offenseId, home, away);
      return {
      id: String(play.id), text: play.text,
       period: play.period?.number ?? null,
       clock: play.clock?.displayValue ?? null,
       down: [1, 2, 3, 4].includes(play.start?.down) ? play.start.down : null,
       distance: Number.isFinite(play.start?.distance) ? play.start.distance : null,
      scoring: Boolean(play.scoringPlay),
      scoringTeamId: play.scoringPlay ? scoringTeams.get(String(play.id)) ?? null : null,
      trajectory: amendment?.trajectory ?? playTrajectory(play, offenseId, home, away),
      snapPercent: String(play.start?.team?.id) === offenseId && [1, 2, 3, 4].includes(play.start?.down)
        ? fieldPercent(play.start, home, away) : null,
      penaltyMotion: amendment?.motion ?? penaltyMotion(play, offenseId, home, away),
      type: play.type?.text ?? null,
      penalty: play.penalty?.type?.text ?? (textIntentionalGrounding(play) ? "Intentional Grounding"
        : /penalty/i.test(play.type?.text ?? "") ? "Penalty" : null),
      }; }),
  };
}

function bundledPenalty(play, offenseId, home, away) {
  const penalty = acceptedPenalty(play);
  if (!penalty || /^Penalty$/i.test(play.type?.text ?? "")
      || /\b(?:no play|nullified|reversed|overturned)\b/i.test(play.text ?? "")
      || String(play.start?.team?.id) !== offenseId || String(play.end?.team?.id) !== offenseId) return null;
  const [original, ...foul] = (play.text ?? "").split(/\bPENALTY\b/i);
  if (!foul.length || /\bPENALTY\b/i.test(original)) return null;
  // NFL: "to CAR 7 ... PENALTY ..., 4 yards, enforced at CAR 7".
  // Only connect the actual pre-foul endpoint to ESPN's confirmed end spot.
  const enforced = /\benforced at\s+([A-Za-z][A-Za-z&-]*)\s*(\d{1,2})\b/i.exec(foul[0]);
  const named = enforced && `${enforced[1].toUpperCase()} ${Number(enforced[2])}`;
  if (!named || !new RegExp(`\\bto\\s+(?:the\\s+)?${enforced[1]}\\s*${Number(enforced[2])}\\b`, "i").test(original)) return null;
  const start = fieldPercent({ possessionText: named }, home, away);
  const end = fieldPercent(play.end, home, away);
  if (start === null || end === null || start === end
      || (penalty.yards !== null && Math.abs(end - start) > penalty.yards)) return null;
  const underlying = { ...play, text: original, isPenalty: false, penalty: null,
    end: { ...play.end, possessionText: named, yardsToEndzone: undefined } };
  const trajectory = playTrajectory(underlying, offenseId, home, away);
  return { motion: { start, end, fromPlay: true },
    trajectory: trajectory?.end === start ? trajectory : null };
}

function penaltyMotion(play, offenseId, home, away) {
  // A bundled run/pass may contain both play yardage and enforcement. Its net
  // end spot is not the penalty distance, so only use a standalone/no-play foul.
  if (!acceptedPenalty(play) || !(/penalty/i.test(play.type?.text ?? "")
      || /\b(?:no play|nullified)\b/i.test(play.text ?? ""))) return null;
  if (String(play.start?.team?.id) !== offenseId || String(play.end?.team?.id) !== offenseId
      || ![1, 2, 3, 4].includes(play.start?.down) || ![0, 1, 2, 3, 4].includes(play.end?.down)) return null;
  const start = fieldPercent(play.start, home, away);
  const end = fieldPercent(fallbackPlayEnd(play, [play], home, away), home, away);
  return start !== null && end !== null && start !== end ? { start, end } : null;
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

// ESPN can copy the line of scrimmage into the end spot of an unreturned miss.
// Only correct an obvious placeholder (or missing spot) with sufficient data.
function missedFieldGoalPosition(play, league, home, away) {
  if (!/^Field Goal Missed$/i.test(play?.type?.text ?? "") || play.scoringPlay || play.isPenalty || play.penalty
      || /\b(?:blocked|return(?:ed)?|touchback|penalty|no play|nullified)\b/i.test(play.text ?? "")
      || !/\b(?:no good|wide (?:right|left)|(?:hit|hits) (?:the )?(?:(?:right|left) )?upright)\b/i.test(play.text ?? "")
      || /\bshort\b/i.test(play.text ?? "")) return null;
  const teams = [home, away];
  const kicker = teams.find((team) => team.id === String(play.start?.team?.id));
  const receiver = kicker && teams.find((team) => team.id !== kicker.id);
  const endId = play.end?.team?.id;
  if (!receiver || (endId != null && String(endId) !== receiver.id)) return null;
  const start = positionFromText(play.start?.possessionText, home, away);
  if (start === null) return null;
  let percent;
  if (league === "college-football") {
    percent = receiver.id === home.id ? Math.min(start, 80) : Math.max(start, 20);
  } else if (league === "nfl") {
    const distance = /\b(\d{1,3})\s+yard field goal\b/i.exec(play.text ?? "");
    if (!distance) return null;
    const kickYards = Number(distance[1]) - 10;
    if (kickYards < 0 || kickYards > 100) return null;
    const raw = receiver.id === home.id ? 100 - kickYards : kickYards;
    const offset = receiver.id === home.id ? start - raw : raw - start;
    if (offset < 6 || offset > 9) return null;
    percent = receiver.id === home.id ? Math.min(raw, 80) : Math.max(raw, 20);
  } else return null;
  const side = percent > 50 ? home : away;
  return { teamId: receiver.id, percent, start,
    label: `${side.abbreviation} ${percent > 50 ? 100 - percent : percent}` };
}

function interceptionTouchbackPosition(play, home, away) {
  if (!/interception/i.test(play?.type?.text ?? "") || !/\btouchback\b/i.test(play.text ?? "")
      || play.scoringPlay || play.isPenalty || play.penalty
      || /\b(?:no play|nullified|penalty)\b/i.test(play.text ?? "")) return null;
  const receiver = [home, away].find((team) => team.id === String(play.end?.team?.id));
  if (!receiver || String(play.start?.team?.id) === receiver.id) return null;
  return { teamId: receiver.id, percent: receiver.id === home.id ? 80 : 20,
    label: `${receiver.abbreviation} 20`, down: 1, distance: 10,
    downDistance: `1st & 10 at ${receiver.abbreviation} 20` };
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
    driveMap.set(String(drive.id), driveSummary(drive, plays, scoringTeams, home, away, updated.league));
  }
  const drives = [...driveMap.values()].filter((drive) => drive.plays.length);
  const isPause = (play) => /Timeout|Two-minute warning|End Period|End of Half|End of Regulation/i.test(play?.type?.text ?? "");
  // A provider can attach a new timeout to an old drive. Only recover a spot
  // when this drive contains the latest actual football event across the feed;
  // otherwise its old endpoint predates intervening scores or possessions.
  const lastFootballPlay = plays.findLast((play) => !isPause(play));
  const lastCurrentPlay = currentIds.has(String(lastFootballPlay?.id)) ? lastFootballPlay : null;
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
    const last = lastCurrentPlay;
    const end = fallbackPlayEnd(last, currentPlays, home, away);
    possessionId = end?.team?.id == null ? null : String(end.team.id);
    // ESPN can flip yardsToEndzone on a no-gain play while its possessionText
    // still names the correct side of the field. Prefer that named yard line.
    const namedPosition = positionFromText(end?.possessionText, home, away);
    if ((namedPosition !== null || (Number.isFinite(end?.yardsToEndzone) && end.yardsToEndzone >= 0 && end.yardsToEndzone <= 100))
        && !last.scoringPlay && !uncertainBlockedFieldGoalSpot(last)
        && !/End Period|End of|Timeout|Kickoff|Extra Point/i.test(last.type?.text ?? "")) {
      position = namedPosition ?? (possessionId === home.id ? end.yardsToEndzone
        : possessionId === away.id ? 100 - end.yardsToEndzone : null);
      downDistance = end.downDistanceText ?? null;
      down = end.down;
      distance = end.distance;
      positionLabel = end.possessionText ?? null;
    }
    positionSource = "last reported play";
  }

  // A kick's end spot belongs to the receiver, not the kicking team's drive.
  // Prefer a complete live situation, which can include penalty enforcement.
  const kick = currentIds.has(String(latestPlay?.id))
    ? kickPosition(lastCurrentPlay, updated.league, home, away, summary.header?.season?.year) : null;
  if (kick && (!situation || position === null) && (!situation?.possession || possessionId === kick.teamId)) {
    possessionId = kick.teamId;
    position = kick.percent;
    positionLabel = kick.label;
    downDistance = kick.downDistance;
    down = kick.down;
    distance = kick.distance;
    positionSource = "last reported play";
  }
  const blockedReturn = lastCurrentPlay?.id === latestPlay?.id
    ? blockedFieldGoalReturnPosition(lastCurrentPlay, home, away) : null;
  if (blockedReturn && (!situation || position === null)
      && (!situation?.possession || possessionId === blockedReturn.teamId)) {
    possessionId = blockedReturn.teamId;
    position = blockedReturn.percent;
    positionLabel = blockedReturn.label;
    downDistance = null; // The provider's caption refers to its stale endpoint.
    down = lastCurrentPlay.end.down;
    distance = lastCurrentPlay.end.distance;
    positionSource = "last reported play";
  }
  const miss = currentIds.has(String(latestPlay?.id))
    ? missedFieldGoalPosition(lastCurrentPlay, updated.league, home, away) : null;
  if (miss && (!situation || position === null) && (position === null || position === miss.start
      || !positionLabel || /\s0$/.test(positionLabel))
      && (!situation?.possession || possessionId === miss.teamId)) {
    possessionId = miss.teamId;
    position = miss.percent;
    positionLabel = miss.label;
    const end = lastCurrentPlay.end;
    downDistance = end?.shortDownDistanceText ?? null;
    down = end?.down;
    distance = end?.distance;
    positionSource = "kick rule";
  }
  const touchback = lastCurrentPlay?.id === latestPlay?.id
    ? interceptionTouchbackPosition(lastCurrentPlay, home, away) : null;
  if (touchback && (!situation || position === null)
      && (!situation?.possession || possessionId === touchback.teamId)) {
    possessionId = touchback.teamId;
    position = touchback.percent;
    positionLabel = touchback.label;
    downDistance = touchback.downDistance;
    down = touchback.down;
    distance = touchback.distance;
    positionSource = "touchback rule";
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
      lastPlayPeriod: latestPlay?.period?.number ?? null,
      lastPlayClock: latestPlay?.clock?.displayValue ?? null,
      lastPlayType: latestPlay?.type?.text ?? "",
      scoringType: latestPlay?.scoringType?.name ?? null,
      scoring: Boolean(latestPlay?.scoringPlay),
      turnover: Boolean(latestPlay?.isTurnover),
      pause: isPause(latestPlay),
      possessionTeamId: possessionTeam?.id ?? null,
    },
    ball,
    possessionTeamId: updated.state === "live" && possessionTeam && (situation || ball) ? possessionTeam.id : null,
    highlights: gameHighlights(plays, summary.scoringPlays, [home.id, away.id]),
    latestPlaySequence: Math.max(0, ...plays.map((play) => Number(play.sequenceNumber)).filter(Number.isFinite)),
    // Include non-highlights as anchors so clients can reject backfilled events.
    latestPlayOrder: plays.map((play) => String(play.id)),
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
