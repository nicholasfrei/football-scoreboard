function namedSpot(text, home, away) {
  const match = /^(.*?)\s+(\d{1,2})$/.exec(text ?? "");
  if (!match) return null;
  const yards = Number(match[2]);
  if (yards > 50) return null;
  const team = [home, away].find((item) => item.abbreviation === match[1]);
  if (!team) return null;
  return { percent: team.id === home.id ? 100 - yards : yards, label: `${team.abbreviation} ${yards}` };
}

function catchSpot(text, home, away) {
  const match = /\bfair catch\b.*?\bat\s+([a-z]+)\s*(\d{1,2})\b/i.exec(text);
  if (!match) return null;
  const name = match[1].toLowerCase();
  const teams = [home, away].filter((team) => [team.abbreviation, team.location, team.shortName]
    .some((value) => value?.replace(/\s/g, "").toLowerCase() === name));
  return teams.length === 1 ? namedSpot(`${teams[0].abbreviation} ${Number(match[2])}`, home, away) : null;
}

// Only derive a receiving spot from explicit, corroborated kick outcomes.
export function kickPosition(play, league, home, away, season) {
  const type = play?.type?.text ?? "";
  const kickoff = /^kickoff\b/i.test(type);
  const punt = /^punt\b/i.test(type);
  const text = play?.text ?? "";
  const touchback = /\btouchback\b/i.test(`${type} ${text}`);
  const fairCatch = /\bfair catch\b/i.test(`${type} ${text}`);
  const puntPenalty = punt && /\bPENALTY\b/i.test(text) && !play.scoringPlay && !play.isTurnover
    ? /\bPENALTY\b[^]*?(\d+)\s+yards?\s*,?\s*enforced at\s+([A-Z]+)\s*(\d{1,2})\b/i.exec(text) : null;
  const ordinaryReturn = kickoff && /\breturn(?:ed)?\s+\d+\s+yards?\s+to\s+(?:the\s+)?[A-Za-z]+\s*\d{1,2}\b|\bto\s+[A-Za-z]+\s*\d{1,2}\s+for\s+\d+\s+yards?\b/i.test(text);
  if ((!kickoff && !punt) || (!touchback && !fairCatch && !puntPenalty && !ordinaryReturn)
      || play.scoringPlay || play.isTurnover
      || ((play.isPenalty || play.penalty || /\b(?:penalty|no play|nullified|blocked|muff|fumble|out of bounds)\b/i.test(text)) && !puntPenalty)) return null;

  const kicker = String(play.start?.team?.id ?? "");
  const endId = String(play.end?.team?.id ?? "");
  const teams = [home, away];
  const kickingTeam = teams.find((team) => team.id === kicker);
  const receiver = teams.find((team) => team.id === endId)
    ?? (kickingTeam ? teams.find((team) => team.id !== kicker) : null);
  if (!receiver || (kickingTeam && receiver.id === kickingTeam.id)) return null;

  const end = play.end ?? {};
  // An end-zone placeholder is not a succeeding spot. A named end position is
  // preferred because penalties and NFL kickoff rules can alter standard spots.
  let spot = endId === receiver.id ? namedSpot(end.possessionText, home, away) : null;
  if (ordinaryReturn && !touchback && !fairCatch) {
    // A named end alone is not evidence: require the returner's explicit final
    // spot to agree, not the kickoff landing or a later penalty placement.
    const returnSpot = /\breturn(?:ed)?\s+\d+\s+yards?\s+to\s+(?:the\s+)?([A-Za-z]+)\s*(\d{1,2})\b/i.exec(text)
      ?? /\bto\s+([A-Za-z]+)\s*(\d{1,2})\s+for\s+\d+\s+yards?\b/i.exec(text);
    if (!spot || !returnSpot || namedSpot(`${returnSpot[1]} ${returnSpot[2]}`, home, away)?.percent !== spot.percent) return null;
  }
  if (puntPenalty) {
    const enforcement = namedSpot(`${puntPenalty[2]} ${puntPenalty[3]}`, home, away);
    const yards = Number(puntPenalty[1]);
    // The named offender, not the receiver, determines enforcement direction.
    const offender = /\bPENALTY\s+on\s+([A-Z]+)-/i.exec(text)?.[1];
    const penalized = teams.find((team) => team.abbreviation.toUpperCase() === offender?.toUpperCase());
    if (enforcement && Number.isFinite(yards)) {
      const percent = enforcement.percent + (penalized?.id === kickingTeam?.id
        ? receiver.id === home.id ? -yards : yards
        : receiver.id === home.id ? yards : -yards);
      if (percent > 0 && percent < 100) {
        const side = percent > 50 ? home : away;
        spot = { percent, label: `${side.abbreviation} ${percent > 50 ? 100 - percent : percent}` };
      }
    }
  }
  if (spot && (spot.percent === 0 || spot.percent === 100)) spot = null;
  const caught = fairCatch ? catchSpot(text, home, away) : null;
  // A college kickoff fair catch inside the 25 is brought out to the 25 even
  // when ESPN's end spot contains a contradictory non-end-zone placeholder.
  if (kickoff && league === "college-football" && caught) spot = caught;
  if (!spot && !touchback) spot = caught;

  let ownYards = spot ? receiver.id === home.id ? 100 - spot.percent : spot.percent : null;
  if (touchback && !spot) {
    // NFL kickoffs depend on the kick's path and season; do not guess either.
    if (punt) ownYards = 20;
    else if (league === "college-football") ownYards = 25;
    else if (league === "nfl" && Number(season) >= 2025) {
      if (/\b(?:bounces?|bounced|rolls?|rolled)\s+(?:into|through)\s+(?:the\s+)?end zone\b/i.test(text)) ownYards = 20;
      else if (/\b(?:lands?|landed)\s+in\s+(?:the\s+)?end zone\b/i.test(text)) {
        ownYards = Number(season) >= 2026 && play.start?.yardsToEndzone === 50 ? 20 : 35;
      }
    }
  } else if (kickoff && fairCatch && league === "college-football" && ownYards !== null && ownYards < 25) {
    ownYards = 25;
    spot = null;
  }
  if (!spot && Number.isFinite(ownYards)) {
    spot = { percent: receiver.id === home.id ? 100 - ownYards : ownYards, label: `${receiver.abbreviation} ${ownYards}` };
  }
  if (!spot) return null;
  const downDistance = end.downDistanceText?.includes(spot.label) ? end.downDistanceText : null;
  return { ...spot, teamId: receiver.id, down: end.down,
    distance: kickoff && fairCatch || !end.possessionText || end.possessionText === spot.label ? end.distance : null,
    downDistance };
}
