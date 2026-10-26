export function teamRecordLabel(team, league) {
  const overall = team.record?.overall ?? "Record unavailable";
  if (league === "nfl") {
    return team.divisionStanding ? `${overall} · ${team.divisionStanding}` : overall;
  }
  const conference = team.record?.conference;
  return conference ? `${overall} (${conference} ${team.conferenceName ?? "Conf."})` : overall;
}
