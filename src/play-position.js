import { reportedEnforcement } from "./penalty.js";

function scrimmageSpot(spot, home, away, strict = false) {
  const teamId = spot?.team?.id == null ? null : String(spot.team.id);
  if (![home.id, away.id].includes(teamId) || !(strict ? [1, 2, 3, 4] : [0, 1, 2, 3, 4]).includes(spot.down)) return null;
  const match = /^(.*?)\s+(\d{1,2})$/.exec(spot.possessionText ?? "");
  const yards = match ? Number(match[2]) : null;
  const named = yards > 0 && yards <= 50
    ? match[1] === home.abbreviation ? 100 - yards : match[1] === away.abbreviation ? yards : null : null;
  const numeric = Number.isFinite(spot.yardsToEndzone) && spot.yardsToEndzone > 0 && spot.yardsToEndzone < 100
    ? teamId === home.id ? spot.yardsToEndzone : 100 - spot.yardsToEndzone : null;
  // For a restored start, contradictory coordinates are not confirmation. For
  // enforced ends retain the adapter's named-yard-line preference (ESPN flips
  // numeric yardage on some otherwise valid penalty entries).
  if (strict && ((Number.isFinite(spot.yardsToEndzone) && numeric === null)
      || (spot.possessionText && named === null && spot.possessionText !== "50")
      || (named !== null && numeric !== null && named !== numeric))) return null;
  return named !== null || numeric !== null ? spot : null;
}

function enforcedPlayEnd(play, home, away) {
  // Structured penalty data and a reported live situation remain authoritative.
  // Only repair a text-only, fully reported enforcement in the play fallback.
  if (play?.penalty || ![0, 1, 2, 3, 4].includes(play?.end?.down)) return null;
  const report = reportedEnforcement(play);
  if (!report || report.to.yards < 1 || report.to.yards > 50
      || ![home.id, away.id].includes(String(play.end.team?.id))) return null;

  const sideName = report.to.side.toUpperCase();
  const matching = [home, away].filter((team) => [team.abbreviation, team.location, team.shortName]
    .some((name) => name?.replace(/\s/g, "").toUpperCase() === sideName)
    || (team.id === "2636" && sideName === "TSA"));
  let side = matching.length === 1 ? matching[0] : null;
  if (!side && report.from.side.toUpperCase() === sideName
      && String(play.start?.team?.id) === String(play.end.team.id)) {
    // College play prose can say USC/UTK where the normalized teams say
    // SC/TENN. Use the same named side in BOTH provider spots as evidence,
    // never an arbitrary alias or the recovering/kicking team's identity.
    const namedTeam = (spot) => [home, away].find((team) =>
      new RegExp(`^${team.abbreviation}\\s+-?\\d{1,2}$`, "i").test(spot?.possessionText ?? ""));
    const startSide = namedTeam(play.start);
    const beforePenalty = play.text.split(/\bPENALTY\b/i)[0];
    if (startSide && namedTeam(play.end)?.id === startSide.id
        && new RegExp(`\\b${sideName}\\s*\\d{1,2}\\b`, "i").test(beforePenalty)) side = startSide;
  }
  if (!side) return null;
  const label = `${side.abbreviation} ${report.to.yards}`;
  if (play.end.possessionText === label) return null;
  const percent = side.id === home.id ? 100 - report.to.yards : report.to.yards;
  const yardsToEndzone = String(play.end.team.id) === home.id ? percent : 100 - percent;
  // A contradictory provider end also has an untrustworthy down/distance and
  // line-to-gain. Keep the confirmed possession and spot, but not those fields.
  return { ...play.end, possessionText: label, yardsToEndzone,
    downDistanceText: null, shortDownDistanceText: null, distance: null };
}

function incompletePassEnd(play, home, away) {
  const end = scrimmageSpot(play.end, home, away, true);
  if (end) return end;
  const start = scrimmageSpot(play.start, home, away, true);
  if (!start || ![1, 2, 3].includes(start.down) || !Number.isFinite(start.distance)
      || start.distance <= 0 || start.distance > 100
      || (play.end?.team?.id != null && String(play.end.team.id) !== String(start.team.id))) return null;
  // An ordinary incompletion leaves the line of scrimmage and distance intact.
  // Provider placeholders can corrupt both the spot and the end distance, so
  // restore the validated start and advance only the down, never the ball.
  const down = start.down + 1;
  const ordinal = ["1st", "2nd", "3rd", "4th"][down - 1];
  const goal = /\bGoal\b/i.test(`${start.downDistanceText ?? ""} ${start.shortDownDistanceText ?? ""}`);
  const shortDownDistanceText = `${ordinal} & ${goal ? "Goal" : start.distance}`;
  return { ...start, down, shortDownDistanceText,
    downDistanceText: `${shortDownDistanceText}${start.possessionText ? ` at ${start.possessionText}` : ""}` };
}

/** A fresh zero-yard rush/sack can carry a goal-line placeholder in its end
 * coordinates (or in the live situation). Restore the snap only when the play
 * text independently confirms that exact named spot and possession. */
export function confirmedNoGainEnd(play, home, away) {
  if (!/^(?:Rush|Sack)$/i.test(play?.type?.text ?? "") || play.statYardage !== 0
      || play.scoringPlay || play.isTurnover || play.isPenalty || play.penalty
      || /\b(?:penalty|no\s*play|nullified|overturned|fumble|safety)\b/i.test(play.text ?? "")) return null;
  const start = scrimmageSpot(play.start, home, away, true);
  if (!start || ![1, 2, 3].includes(start.down) || !Number.isFinite(start.distance)
      || start.distance <= 0 || String(play.end?.team?.id) !== String(start.team.id)) return null;
  const spot = /\bfor\s+(?:(?:a\s+)?loss\s+of\s+)?0\s+yards?\s+(?:gain\s+)?to\s+(?:the\s+)?([A-Za-z][A-Za-z&-]*)\s*(\d{1,2})\b/i.exec(play.text ?? "");
  const named = /^(.*?)\s+(\d{1,2})$/.exec(start.possessionText ?? "");
  if (!spot || !named || spot[1].toUpperCase() !== named[1].toUpperCase()
      || Number(spot[2]) !== Number(named[2])) return null;
  const down = start.down + 1;
  const shortDownDistanceText = `${["1st", "2nd", "3rd", "4th"][down - 1]} & ${start.distance}`;
  return { ...start, down, shortDownDistanceText,
    downDistanceText: `${shortDownDistanceText} at ${start.possessionText}` };
}

/** Validate special fallback outcomes without rewriting the saved provider data.
 * Accepted penalties may still establish a new scrimmage spot on a No Play.
 * Ordinary results and scores remain the caller's responsibility. */
export function fallbackPlayEnd(play, plays, home, away) {
  const enforced = enforcedPlayEnd(play, home, away);
  if (enforced) return enforced;
  const noGain = confirmedNoGainEnd(play, home, away);
  if (noGain) return noGain;
  if (/^Pass Incompletion$/i.test(play?.type?.text ?? "") && !play.scoringPlay && !play.isTurnover
      && !play.isPenalty && !play.penalty
      && !/\b(?:penalty|no\s*play|nullified|overturned|intercept\w*|fumble\w*|safety)\b/i.test(play.text ?? "")) {
    return incompletePassEnd(play, home, away);
  }
  if (!play || play.scoringPlay || !/\b(?:no\s*play|nullified)\b/i.test(play.text ?? "")) return play?.end;
  const text = play.text ?? "";
  const status = play.penalty?.status?.slug;
  // Structured acceptance can describe one enforced foul alongside another
  // declined foul in the same description. Do not lose that enforcement.
  const reported = status ? null : reportedEnforcement(play);
  const unenforced = status ? status !== "accepted" : !reported && /\b(?:declined|offsetting|offset)\b/i.test(text);
  const textEnforcement = /\bpenalty\b/i.test(text) && (/penalty/i.test(play.type?.text ?? "")
    || /\bpenalty\b[^]*\b(?:\d+\s+yards?|enforced|half\s+(?:the\s+)?distance)\b/i.test(text));
  const enforcement = !unenforced && (status === "accepted" || reported || textEnforcement);
  // An accepted penalty with an invalid/missing end has an unknown succeeding
  // spot. Reusing the pre-enforcement start would be just another guess.
  if (enforcement) return scrimmageSpot(play.end, home, away);
  const start = scrimmageSpot(play.start, home, away, true);
  if (start) return start;

  // Only the immediately preceding football event in this drive can confirm
  // the retained spot. Never reach through a score, kick or unknown result.
  const index = plays.indexOf(play);
  const previous = plays.slice(0, index).findLast((item) => !/Timeout|Two-minute warning|End Period|End of Half|End of Regulation/i.test(item.type?.text ?? ""));
  if (!previous || previous.scoringPlay || /Kick|Punt|Field Goal|Extra Point|End of Game/i.test(previous.type?.text ?? "")
      || /\b(?:no\s*play|nullified)\b/i.test(previous.text ?? "")
      || (previous.period?.number != null && play.period?.number != null && previous.period.number !== play.period.number)) return null;
  const prior = scrimmageSpot(previous.end, home, away, true);
  const startTeam = play.start?.team?.id;
  return prior && (startTeam == null || String(startTeam) === String(prior.team.id)) ? prior : null;
}
