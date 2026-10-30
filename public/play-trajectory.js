// Field coordinates are always away goal line (0) to home goal line (100).
// Prefer a named spot: ESPN occasionally flips yardsToEndzone on a no-gain play.
export function fieldPercent(spot, home, away) {
  const named = /^(.*?)\s+(\d{1,2})$/.exec(spot?.possessionText ?? "");
  if (spot?.possessionText === "50") return 50;
  if (named && Number(named[2]) <= 50) {
    if (named[1] === away.abbreviation) return Number(named[2]);
    if (named[1] === home.abbreviation) return 100 - Number(named[2]);
  }
  const teamId = spot?.team?.id == null ? null : String(spot.team.id);
  if (Number.isFinite(spot?.yardsToEndzone) && spot.yardsToEndzone >= 0 && spot.yardsToEndzone <= 100) {
    if (teamId === home.id) return spot.yardsToEndzone;
    if (teamId === away.id) return 100 - spot.yardsToEndzone;
  }
  return null;
}

// ESPN's college play prose sometimes uses different team names from its
// structured possessionText. Accept only aliases observed for these team IDs,
// and only when that team participates in the current matchup.
const targetAliases = {
  "251": ["TEXAS", "UT"], "130": ["U-M"], "245": ["TAM", "A&M"], "2633": ["UTK", "TEN"],
  "2579": ["USC"], "238": ["VANDY"], "221": ["PIT"], "2390": ["CANES", "UM"],
  "254": ["UTA"], "68": ["BSU"], "164": ["RU"], "242": ["RIC"],
  "2649": ["TOLEDO"], "239": ["BU"], "2006": ["AKRON"], "193": ["MIAMI"],
  "344": ["STATE"], "33": ["BLT"], "5": ["CLV"], "22": ["ARZ"],
  "14": ["LA"], "34": ["HST"], "28": ["WAS"], "145": ["OM"],
  "2655": ["TLN"], "2636": ["TSA"],
  "84": ["IND"], "275": ["WISC"], "87": ["UND"], "194": ["OHIOST"],
  "120": ["MARYLA"], "26": ["UCL"], "142": ["MIZZOU"],
  "333": ["BAMA"], "344": ["STATE", "MSU"], "2305": ["KAN"],
};

function namedTeam(name, home, away) {
  return [home, away].find((candidate) => [candidate.abbreviation?.toUpperCase(),
    ...(targetAliases[candidate.id] ?? [])].includes(name.toUpperCase()));
}

function textSpot(text, pattern, home, away) {
  const match = pattern.exec(text);
  if (!match) return null;
  const side = match[1].toUpperCase();
  const yards = Number(match[2]);
  if (yards > 50) return null;
  const team = namedTeam(side, home, away);
  if (!team) return null;
  return { percent: yards === 50 ? 50 : team.id === away.id ? yards : 100 - yards,
    label: `${team.abbreviation} ${yards}` };
}

function interceptionTrajectory(play, start, offenseId, home, away, direction) {
  const text = play.text ?? "";
  const defense = offenseId === away.id ? home : away;
  const match = /\bintercepted\b.*?\bat\s+(?:the\s+)?(?:(50)\b|([A-Za-z][A-Za-z&-]*)\s*(-?\d{1,2})\b)/i.exec(text);
  if (!match) return null;
  const team = match[2] ? namedTeam(match[2], home, away) : null;
  const yard = match[3] == null ? null : Number(match[3]);
  if (match[2] && (!team || yard > 50)) return null;
  const touchback = /\btouchback\b/i.test(text);
  const behindGoal = yard !== null && yard < 0;
  if (behindGoal && team.id !== defense.id) return null;
  const pick = match[1] ? 50 : behindGoal ? team.id === home.id ? 100 : 0
    : team.id === home.id ? 100 - yard : yard;
  const pickLabel = behindGoal ? "END ZONE" : match[1] ? "50" : `${team.abbreviation} ${yard}`;
  const endId = play.end?.team?.id == null ? null : String(play.end.team.id);
  if (endId !== null && endId !== defense.id) return null;
  const touchdown = play.scoringPlay && (/^Interception Return Touchdown$/i.test(play.type?.text ?? "")
    || /\bTOUCHDOWN\b/i.test(text));
  let end;
  if (touchback) {
    if (pick !== (defense.id === home.id ? 100 : 0)) return null;
    end = defense.id === home.id ? 80 : 20;
  } else if (touchdown) end = direction === 1 ? 0 : 100;
  else end = fieldPercent({ possessionText: play.end?.possessionText }, home, away);
  // A known pick is still drawable when its return endpoint is absent.
  end ??= pick;
  let returnYards = touchback ? null : (end - pick) * -direction || 0;
  // The receiving team's final spot and its reported return yardage must agree.
  // Keep the pick arc, but suppress a contradictory or unconfirmed runback.
  if (!touchback && (play.statYardage !== returnYards || (touchdown && !returnYards))) {
    end = pick;
    returnYards = 0;
  }
  const landingLabel = touchback ? `${defense.abbreviation} 20` : null;
  return { kind: "interception", start, end, catchPercent: pick, interceptionLabel: pickLabel,
    returnYards, landingLabel, yards: null, yac: null, label: "INTERCEPTION" };
}

function defensiveFumbleReturn(play, start, offenseId, home, away, direction) {
  const defense = offenseId === away.id ? home : away;
  const text = play.text ?? "";
  if (!/\bfumble(?:s|d)?\b.*\brecovered by\b/i.test(text)
      || String(play.teamParticipants?.[0]?.id) !== defense.id
      || play.teamParticipants[0].type !== "defense"
      || String(play.end?.team?.id) !== defense.id) return null;
  const touchdown = play.scoringPlay && play.scoringType?.name === "touchdown" && /\bTOUCHDOWN\b/i.test(text);
  const end = touchdown ? direction === 1 ? 0 : 100
    : fieldPercent({ possessionText: play.end?.possessionText }, home, away);
  if (end === null) return null;
  const recovered = /\brecovered by\b.*?\bat\s+(?:the\s+)?([A-Za-z][A-Za-z&-]*)\s*(-?\d{1,2})\b/i.exec(text);
  const recovery = recovered && Number(recovered[2]) >= 0
    ? textSpot(`at ${recovered[1]}${recovered[2]}`, /\bat\s+([A-Za-z][A-Za-z&-]*)\s*(\d{1,2})\b/i, home, away)?.percent : null;
  if (!touchdown) {
    const college = /\breturn\s+(\d+)\s+yards?\s+to\s+(?:the\s+)?([A-Za-z][A-Za-z&-]*)\s*(\d{1,2})\b/i.exec(text);
    const nfl = /\bto\s+([A-Za-z][A-Za-z&-]*)\s*(\d{1,2})\s+for\s+(\d+)\s+yards?\b/i.exec(text.slice(recovered?.index ?? 0));
    const reported = Number(college?.[1] ?? nfl?.[3]);
    const destination = college ? textSpot(`to ${college[2]}${college[3]}`,
      /\bto\s+([A-Za-z][A-Za-z&-]*)\s*(\d{1,2})\b/i, home, away)
      : nfl && textSpot(`to ${nfl[1]}${nfl[2]}`,
        /\bto\s+([A-Za-z][A-Za-z&-]*)\s*(\d{1,2})\b/i, home, away);
    if (recovery === null || destination?.percent !== end || reported !== play.statYardage
        || (recovery - end) * direction !== reported || reported <= 0) return null;
  }
  // When recovery is on the goal line, there is no separate runback to draw;
  // the red line instead follows the confirmed snap-to-score movement.
  if (start === end) return null;
  return { kind: "fumble-return", start, end, yards: null, yac: null,
    catchPercent: recovery !== null && recovery !== end ? recovery : null,
    returnYards: recovery !== null && recovery !== end ? Math.abs(end - recovery) : null,
    label: "FUMBLE RETURN" };
}

export function playTrajectory(play, offenseId, home, away) {
  const type = play.type?.text ?? "";
  const text = play.text ?? "";
  const startId = play.start?.team?.id == null ? null : String(play.start.team.id);
  if (startId !== offenseId || ![1, 2, 3, 4].includes(play.start?.down)) return null;
  // A voluntary clock-killing kneel is not a rushing lane to animate.
  if (/\b(?:kneel(?:s|ed|ing)?(?:[\s-]*down)?|knelt|(?:takes?|taking|took)\s+a\s+knee)\b/i.test(text)) return null;
  const start = fieldPercent(play.start, home, away);
  if (start === null) return null;
  // A declined-only foul leaves the underlying play intact, including runs,
  // completions and fourth-down failures. Mixed/enforced fouls remain unknown.
  const penalties = text.match(/\bpenalty\b/gi)?.length ?? 0;
  const declined = text.match(/\bdeclined\b/gi)?.length ?? 0;
  // A post-play penalty on the receiving team does not nullify the punt arc.
  // ESPN leaves isPenalty/penalty unset on these plays; only text-level penalty
  // detection would otherwise block them. Allow the arc when ESPN's structured
  // flags confirm the play itself was valid.
  const puntKeepsArc = /^(?:Punt|Punt Return)$/i.test(type) && !play.isPenalty && !play.penalty;
  if (/\b(?:no\s*play|nullified|overturned|reversed)\b/i.test(text)
      || (play.penalty?.status?.slug !== "declined" && (play.penalty || play.isPenalty))
      || (penalties && !(penalties === declined && !/\b(?:enforced|offsetting)\b/i.test(text))
           && !puntKeepsArc)) return null;
  const direction = offenseId === away.id ? 1 : offenseId === home.id ? -1 : 0;
  if (!direction) return null;
  const defensiveScore = defensiveFumbleReturn(play, start, offenseId, home, away, direction);
  if (defensiveScore) return defensiveScore;
  const kind = /^(?:Pass Reception|Passing Touchdown)$/i.test(type) ? "pass"
    : /^Pass Incompletion$/i.test(type) ? "incomplete"
    : /^(?:Rush|Rushing Touchdown)$/i.test(type) ? "run"
    : /^(?:Punt|Punt Return)$/i.test(type) ? "punt"
    : /^Field Goal (?:Good|Missed)$/i.test(type) ? "field-goal"
    : /^(?:Pass Interception Return|Interception|Interception Return|Interception Return Touchdown)$/i.test(type) ? "interception" : null;
  if (!kind || (play.isTurnover && kind !== "interception")) return null;
  const kickText = text.split(/\bInjury Update:/i)[0];
  // A muffed punt recovered by the kicking team still shows the kick arc; the
  // end spot (where the kicker's team recovered) is the arc's destination.
  const muffKickerRecovered = kind === "punt" && /\bmuff\b/i.test(text)
    && String(play.end?.team?.id ?? "") === offenseId;
  if ((kind === "punt" && /\bblocked\b/i.test(text))
      || (kind === "punt" && /\b(?:muff|fumble)\b/i.test(text) && !muffKickerRecovered)
      || (kind === "field-goal" && (/\b(?:blocked|short)\b/i.test(kickText)
        || /\breturn(?:ed)? (?:by|for|to)\b|\brecovered by\b/i.test(kickText)))) return null;
  if (kind === "interception") return interceptionTrajectory(play, start, offenseId, home, away, direction);
  if (kind === "punt" || kind === "field-goal") {
    // On NFL punts ESPN sometimes leaves the punter's team on the end object.
    // Require a named yard line, which represents the receiving team's spot
    // after any return or touchback; numeric yardsToEndzone alone is ambiguous.
    // College post-punt enforcement can contradict (or omit) ESPN's raw end.
    // Use only a single explicitly reported succeeding spot, never the punt's
    // landing or an inferred penalty distance.
    const enforcement = kind === "punt" && !play.penalty && !play.isPenalty
      && (text.match(/\bPENALTY\b/gi)?.length ?? 0) === 1
      && !/\b(?:declined|offsetting|no play|nullified)\b/i.test(text)
      ? /\bPENALTY\b[^]*?\b\d+\s+yards?\s+from\s+[A-Za-z][A-Za-z&-]*\s*\d{1,2}\s+to\s+([A-Za-z][A-Za-z&-]*)\s*(\d{1,2})\b/i.exec(text) : null;
    const enforcedSpot = enforcement && textSpot(`to ${enforcement[1]}${enforcement[2]}`,
      /\bto\s+([A-Za-z][A-Za-z&-]*)\s*(\d{1,2})\b/i, home, away);
    const end = kind === "punt" ? enforcedSpot?.percent
      ?? fieldPercent({ possessionText: play.end?.possessionText }, home, away)
      : direction === 1 ? 100 : 0;
    if (end === null || (kind === "punt" && (end === 0 || end === 100))) return null;
    // A confirmed punt return has two legs: the kick to the catch spot, then
    // the receiving team's return to the final possession spot. Keep the old
    // end-only arc when any reported spot or yardage disagrees.
    const landingMatch = kind === "punt" ? /\bpunt(?:s|ed)?\b.*?\bto\s+(?:the\s+)?([A-Za-z][A-Za-z&-]*)\s*(\d{1,2})\b/i.exec(text) : null;
    const landing = landingMatch && textSpot(landingMatch[0],
      /\bto\s+(?:the\s+)?([A-Za-z][A-Za-z&-]*)\s*(\d{1,2})\b/i, home, away);
    const afterLanding = landingMatch ? text.slice(landingMatch.index + landingMatch[0].length).split(/\bInjury Update:/i)[0] : "";
    const collegeReturn = /\breturn(?:ed|s)?\s+(?:for\s+loss\s+of\s+(-\d{1,3}|\d{1,3})|(-?\d{1,3}))\s+yards?\s+to\s+(?:the\s+)?([A-Za-z][A-Za-z&-]*)\s*(\d{1,2})\b/i.exec(afterLanding);
    // NFL prose instead says "Returner to NE 26 for 19 yards" or
    // "Returner pushed ob at NE 26 for 19 yards".
    const nflReturn = !collegeReturn && /\b(?:to|pushed ob at)\s+([A-Za-z][A-Za-z&-]*)\s*(\d{1,2})\s+for\s+(-?\d{1,3})\s+yards?\b/i.exec(afterLanding);
    const returnSpot = collegeReturn ? textSpot(`to ${collegeReturn[3]}${collegeReturn[4]}`,
      /\bto\s+([A-Za-z][A-Za-z&-]*)\s*(\d{1,2})\b/i, home, away)
      : nflReturn && textSpot(`to ${nflReturn[1]}${nflReturn[2]}`,
        /\bto\s+([A-Za-z][A-Za-z&-]*)\s*(\d{1,2})\b/i, home, away);
    const reportedReturn = collegeReturn ? collegeReturn[1] ? -Math.abs(Number(collegeReturn[1]))
      : Number(collegeReturn[2]) : Number(nflReturn?.[3]);
    const returnYards = landing && returnSpot?.percent === end
      && (reportedReturn === play.statYardage || (reportedReturn < 0 && collegeReturn))
      && (end - landing.percent) * -direction === reportedReturn
      && reportedReturn !== 0 ? reportedReturn : null;
    return { kind, start, end, yards: null, yac: null,
      catchPercent: returnYards === null ? null : landing.percent,
      returnYards,
      label: kind === "punt" ? "PUNT" : "FIELD GOAL",
       landingLabel: kind === "punt" ? returnYards === null ? enforcedSpot?.label ?? play.end.possessionText : landing.label
        : /^Field Goal Good$/i.test(type) ? "GOOD" : "MISSED",
      ...(returnYards !== null ? { returnLabel: play.end.possessionText } : {}) };
  }
  // College bundled TD + kick entries may retain the catch spot as their
  // numeric end even though both the play prose and gain confirm the end zone.
  const touchdown = kind === "pass" && play.scoringPlay && play.scoringType?.name === "touchdown"
    && /\bTOUCHDOWN\b/i.test(text) && String(play.end?.team?.id) === offenseId
    && /\b(?:to the )?[A-Za-z][A-Za-z&-]*\s*00\b/i.test(text)
    && play.statYardage === (direction === 1 ? 100 - start : start);
   const reportedLoss = kind === "pass" && /\bfor\s+(\d+)\s+yards?\s+loss\s+to\s+(?:the\s+)?([A-Za-z][A-Za-z&-]*)\s*(\d{1,2})\b/i.exec(text);
   const lossSpot = reportedLoss && textSpot(`to ${reportedLoss[2]}${reportedLoss[3]}`,
     /\bto\s+([A-Za-z][A-Za-z&-]*)\s*(\d{1,2})\b/i, home, away);
   const verifiedLoss = lossSpot && play.statYardage === -Number(reportedLoss[1])
     && (lossSpot.percent - start) * direction === play.statYardage;
   const end = kind === "incomplete" ? start : touchdown ? direction === 1 ? 100 : 0
     : verifiedLoss ? lossSpot.percent : fieldPercent(play.end, home, away);
   if (kind === "pass" && Number.isFinite(play.statYardage) && end !== null
       && (end - start) * direction !== play.statYardage
       && /\bfor\s+\d+\s+yards?\b/i.test(text)
       && !/\b(?:lateral|penalty)\b/i.test(text)) return null;
   // A completed fourth-down pass can finish short of the sticks. ESPN then
   // assigns the endpoint to the defense; the confirmed gain is still a pass.
   const fourthDownPass = kind === "pass" && play.start.down === 4 && play.end?.down === 1
     && Number.isFinite(play.start.distance) && Number.isFinite(play.statYardage)
     && play.statYardage < play.start.distance && end !== null
     && (end - start) * direction === play.statYardage
     && fieldPercent({ possessionText: play.end?.possessionText }, home, away) === end
     && !/\b(?:fumble\w*|intercept\w*|safety)\b/i.test(text);
   if (end === null || (kind !== "incomplete" && play.end?.team?.id != null
       && String(play.end.team.id) !== offenseId && !fourthDownPass)) return null;
  const yards = kind === "incomplete" ? 0 : (end - start) * direction;
  // NFL supplies structured YAC; college play text usually names the catch spot.
  // Only draw the split when the reported gain agrees with the field endpoints.
  const reportedCatch = kind === "pass" ? textSpot(text,
    /\bcaught at\s+([A-Za-z][A-Za-z&-]*)\s*(\d{1,2})\b/i, home, away) : null;
  const structuredYac = kind === "pass" && Number.isInteger(play.yardsAfterCatch)
    && play.statYardage === yards && end - play.yardsAfterCatch * direction >= 0
    && end - play.yardsAfterCatch * direction <= 100 ? play.yardsAfterCatch : null;
  const catchPercent = structuredYac !== null ? end - structuredYac * direction
    : reportedCatch && play.statYardage === yards ? reportedCatch.percent : null;
  const yac = catchPercent === null ? null : (end - catchPercent) * direction || 0;
  const target = kind === "incomplete" ? textSpot(text,
    /\bthrown to\s+([A-Za-z][A-Za-z&-]*)\s*(\d{1,2})\b/i, home, away) : null;
  // NFL incompletions report depth but not a yard line. A depth-only flight is
  // schematic; keep it separate from a reported target and out of the caption.
  const depth = kind === "incomplete" && !target
    ? /\bpass incomplete (short|deep)\b/i.exec(text)?.[1]?.toLowerCase() : null;
  return { kind, start, end, yards, yac,
    ...(kind === "incomplete" ? { targetPercent: target?.percent ?? null, targetLabel: target?.label ?? null,
      schematicYards: depth === "short" ? 10 : depth === "deep" ? 30 : null } : {}),
    catchPercent,
    label: kind === "run" ? "RUN" : kind === "pass" ? "PASS" : "INCOMPLETE" };
}

export function driveTrack(drive) {
  const motions = (drive?.plays ?? []).filter((play) => play.trajectory).map((play) => ({ id: play.id, ...play.trajectory }));
  // A kickoff can begin the provider drive, but the offensive drive begins at
  // the receiving spot (the first scrimmage play's start), not at the kick spot.
  return { motions, start: drive?.plays?.find((play) => Number.isFinite(play.snapPercent))?.snapPercent
    ?? motions[0]?.start ?? null, end: motions.at(-1)?.end ?? null };
}
