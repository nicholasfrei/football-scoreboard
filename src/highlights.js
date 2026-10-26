/** Classify confirmed provider play types, rather than matching commentary. */
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
    if (!kind) return [];

    let teamId = scoringTeams.get(String(play.id));
    if (!teamId && kind !== "safety") {
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
