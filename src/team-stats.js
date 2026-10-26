export function normalizeRank(value) {
  const rank = Number(value);
  // ESPN uses 99 for unranked. Never render a sentinel or a missing value.
  return Number.isInteger(rank) && rank >= 1 && rank <= 25 ? rank : null;
}

function recordValue(entry) {
  const value = entry?.summary ?? entry?.displayValue;
  return typeof value === "string" && /^\d+-\d+(?:-\d+)?$/.test(value) ? value : null;
}

function divisionStanding(value) {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/g, " ");
  return /^(?:Tied for )?(?:1st|2nd|3rd|4th) in (?:AFC|NFC) (?:East|North|South|West)$/i.test(text) ? text : null;
}

export function teamStats(competitor, league = "college-football") {
  const rawRank = competitor.curatedRank?.current ?? competitor.rank?.current ?? competitor.rank;
  const record = competitor.record ?? competitor.records ?? competitor.team?.record?.items ?? [];
  const entries = Array.isArray(record) ? record : [];
  const group = competitor.team?.groups;
  const groups = group?.isConference === false ? group.parent : group;
  return {
    rank: league === "nfl" ? null : normalizeRank(rawRank),
    rankSource: league === "nfl" || rawRank === undefined || rawRank === null ? null : "ESPN event ranking",
    divisionStanding: league === "nfl" ? divisionStanding(competitor.standingSummary ?? competitor.team?.standingSummary) : null,
    record: {
      overall: recordValue(entries.find((entry) => entry.type === "total" || entry.name === "overall")),
      conference: recordValue(entries.find((entry) => ["vsconf", "conference"].includes(entry.type) || entry.name === "conference")),
    },
    conferenceId: groups?.id == null ? null : String(groups.id),
    conferenceName: groups?.isConference ? groups.shortName ?? groups.abbreviation ?? null : null,
  };
}
