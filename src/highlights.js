/** A new series on the same possession, not a kickoff or a change of possession. */
function isFirstDown(play) {
  const { start, end } = play;
  if (play.scoringPlay || play.isTurnover || !start?.team?.id || !end?.team?.id
      || String(start.team.id) !== String(end.team.id) || end.down !== 1
      || ![1, 2, 3, 4].includes(start.down)
      || !/^(Rush|Pass Reception|Pass Completion|Penalty)$/i.test(play.type?.text ?? "")) return false;
  return start.down > 1 || (Number.isFinite(start.distance) && start.distance > 0
    && Number.isFinite(start.yardsToEndzone) && Number.isFinite(end.yardsToEndzone)
    && start.yardsToEndzone - end.yardsToEndzone >= start.distance);
}

/** Classify confirmed provider play types and down metadata, not commentary. */
export function gameHighlights(plays, scoringPlays, teamIds) {
  const scoringTeams = new Map((scoringPlays ?? []).map((play) => [String(play.id), play.team?.id]));
  return plays.flatMap((play) => {
    const type = play.type?.text ?? "";
    if (/no play|nullified/i.test(play.text ?? "")) return [];
    let kind;
    if (play.scoringPlay && (play.scoringType?.name === "touchdown" || /touchdown/i.test(type))) kind = "touchdown";
    else if (/interception/i.test(type) && !/touchdown/i.test(type)) kind = "interception";
    else if (/fumble/i.test(type) && !/touchdown/i.test(type)) kind = "fumble";
    else if (play.scoringPlay && (play.scoringType?.name === "field-goal" || /field goal good/i.test(type))) kind = "field-goal";
    else if (play.scoringPlay && /safety/i.test(type)) kind = "safety";
    else if (play.scoringPlay && (play.scoringType?.name === "extra-point" || /^Extra Point Good$/i.test(type))) kind = "extra-point";
    else if (/\b(?:blocked punt|punt blocked)\b/i.test(type)) kind = "blocked-punt";
    else if (/^Punt(?: Return| Fair Catch| Downed| Out of Bounds| Touchback)?$/i.test(type)) kind = "punt";
    else if (isFirstDown(play)) kind = "first-down";
    if (!kind) return [];

    let teamId = scoringTeams.get(String(play.id));
    if (kind === "punt") {
      teamId = play.start?.team?.id;
    } else if (kind === "blocked-punt") {
      // The blocking team is the opponent of the confirmed punting team,
      // regardless of which team ultimately recovers the blocked kick.
      const puntingTeam = String(play.start?.team?.id);
      teamId = teamIds.includes(puntingTeam) && teamIds.length === 2
        ? teamIds.find((id) => id !== puntingTeam) : null;
    } else if (!teamId && kind !== "safety") {
      teamId = play.end?.team?.id;
      // Don't credit an interception to the throwing team when possession
      // metadata is missing or inconsistent. The label can stand alone.
      if (kind === "interception" && String(teamId) === String(play.start?.team?.id)) teamId = null;
    }
    teamId = teamId == null ? null : String(teamId);
    if (!teamIds.includes(teamId)) teamId = null;
    return [{
      id: String(play.id),
      sequence: Number(play.sequenceNumber),
      kind,
      teamId,
      detail: type,
      occurredAt: play.wallclock ?? null,
    }];
  }).filter((event) => Number.isFinite(event.sequence)).slice(-20);
}
