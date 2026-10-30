import { acceptedPenalty as interpretPenalty } from "./penalty.js";

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

/** A failed fourth-down snap must give the game's other team a new series. */
function isTurnoverOnDowns(play, teamIds) {
  const { start, end } = play;
  if (start?.down !== 4 || end?.down !== 1 || play.scoringPlay
      || teamIds.length !== 2 || new Set(teamIds).size !== 2
      || !/^(Rush|Pass Reception|Pass Completion|Pass Incompletion|Sack)$/i.test(play.type?.text ?? "")
      || play.penalty?.status?.slug === "accepted"
       || /\b(?:fumble\w*|intercept\w*|touchdown|safety|no play|nullified|overturned)\b/i.test(play.text ?? "")
       || (/\bpenalty\b/i.test(play.text ?? "") && !/\bdeclined\b/i.test(play.text ?? ""))) return false;
  const offense = String(start.team?.id);
  const defense = String(end.team?.id);
  return offense !== defense && teamIds.includes(offense) && teamIds.includes(defense);
}

function playerAtStart(text) {
  const match = /^((?:#\d+\s+)?[a-z][a-z.'-]*(?:\s+(?!(?:at|return|to|for|in|on)\b)[a-z][a-z.'-]*){0,3})/i.exec(text ?? "");
  return match?.[1]?.replace(/\.$/, "") ?? null;
}

function interceptionPlayer(text) {
  return playerAtStart(/\bintercepted by\s+(.+)/i.exec(text ?? "")?.[1]);
}

function blockingPlayer(text) {
  const explicit = /\bblocked by\s+(.+)/i.exec(text ?? "")?.[1];
  const parenthesized = /\bis blocked\s*\(([^)]+)\)/i.exec(text ?? "")?.[1];
  return playerAtStart(explicit ?? parenthesized);
}

function defensiveStopPlayer(text) {
  // NFL reversals append the corrected play; college reviews append the original.
  const result = (text ?? "").split(/\bplay was REVERSED\.\s*/i).at(-1).split(/\(Original Play:/i)[0];
  // Only the credit immediately following yardage/the ending spot is a tackle.
  // Formation, fumble, penalty and injury parentheses are not defender credits.
  const credit = /\bfor\s+(?:(?:a\s+)?loss\s+of\s+)?-?\d+\s+yards?(?:\s+loss)?(?:\s+to\s+(?:the\s+)?[a-z&-]+\s*\d{1,2})?\s*\(([^()]*)\)/i.exec(result)?.[1];
  if (!credit) return null;
  const players = credit.replace(/^sack split by\s+/i, "")
    .split(/;\s*|,(?!\s*(?:Jr|Sr)\.?(?:\s*,|\s*$))\s*|\s+and\s+/i).map((name) => name.trim());
  // ESPN uses initial/surname names here. Validate the entire credit rather than
  // treating arbitrary commentary or a team placeholder as a player's name.
  const name = /^(?:#\d+\s+)?(?:[A-Z][a-zA-Z]{0,2}\.)+[A-Z][a-zA-Z.'’-]*(?:\s+[A-Z][a-zA-Z.'’-]*){0,2}(?:,\s*(?:Jr|Sr)\.?)?$/;
  return players.every((player) => name.test(player)) ? [...new Set(players)].join(" & ") : null;
}

function rushingLoss(play) {
  // Voluntary kneels count as negative rushing yards, but are not defensive stops.
  if (/\b(?:kneel(?:s|ed|ing)?(?:[\s-]*down)?|knelt|(?:takes?|taking|took)\s+a\s+knee)\b/i.test(play.text ?? "")) return false;
  if (Number.isFinite(play.statYardage)) return play.statYardage < 0;
  if (/\bfor\s+(?:no gain|0\s+yards?)\b/i.test(play.text ?? "")) return false;
  if (play.start?.possessionText && play.start.possessionText === play.end?.possessionText) return false;
  return Number.isFinite(play.start?.yardsToEndzone) && Number.isFinite(play.end?.yardsToEndzone)
    && play.end.yardsToEndzone > play.start.yardsToEndzone;
}

/** Classify provider play types and down metadata, with a specific grounding fallback. */
export function gameHighlights(plays, scoringPlays, teamIds) {
  const scoringTeams = new Map((scoringPlays ?? []).map((play) => [String(play.id), play.team?.id]));
  return plays.flatMap((play) => {
    const type = play.type?.text ?? "";
    const acceptedPenalty = interpretPenalty(play);
    const confirmedBundledConversion = play.scoringPlay && play.scoringType?.name === "touchdown"
      && scoringTeams.has(String(play.id))
      && /\bTOUCHDOWN\b[^]*\b(?:kick|pass|rush) attempt\b[^]*\bNO PLAY\b/i.test(play.text ?? "")
      && !/\bTOUCHDOWN\s+nullified\b/i.test(play.text ?? "");
    const nullifiedTouchdown = /\bTOUCHDOWN\s+nullified\b/i.test(play.text ?? "");
    if (nullifiedTouchdown && !acceptedPenalty) return [];
    if (/no play|nullified/i.test(play.text ?? "") && !acceptedPenalty && !confirmedBundledConversion) return [];
    let kind;
    if (!nullifiedTouchdown && play.scoringPlay && (play.scoringType?.name === "touchdown" || /touchdown/i.test(type))) kind = "touchdown";
    else if (acceptedPenalty && /^Fumble Recovery \(Own\)$/i.test(type)
      && (/\bpunt\b/i.test(play.text ?? "")
        || String(play.start?.team?.id) === String(play.end?.team?.id))) kind = "penalty";
    else if (/interception/i.test(type) && !/touchdown/i.test(type)) kind = "interception";
    else if (/(?:fumble recovery|muffed punt recovery)/i.test(type) && !/touchdown/i.test(type)) kind = "fumble";
    else if (/^Kickoff$/i.test(type) && /\b(?:fumble\w*|muff\w*)\b[^]*\brecovered by\b/i.test(play.text ?? "")
      && !/\b(?:reversed|overturned|no play|nullified)\b/i.test(play.text ?? "")
      && play.start?.team?.id != null && String(play.start.team.id) === String(play.end?.team?.id)) kind = "fumble";
    else if (play.scoringPlay && (play.scoringType?.name === "field-goal" || /field goal good/i.test(type))) kind = "field-goal";
    else if (play.scoringPlay && /safety/i.test(type)) kind = "safety";
    else if (play.scoringPlay && (play.scoringType?.name === "extra-point" || /^Extra Point Good$/i.test(type))) kind = "extra-point";
    else if (play.scoringPlay && (play.scoringType?.name === "defensive-two-point-conversion"
      || /^Defensive 2pt Conversion$/i.test(type))) kind = "two-point-conversion";
    else if (acceptedPenalty) kind = "penalty";
    else if (/\b(?:blocked field goal|field goal blocked)\b/i.test(type)
      || (/field goal/i.test(type) && /\bblocked\b/i.test(play.text ?? ""))) kind = "blocked-field-goal";
    else if (/\b(?:blocked punt|punt blocked)\b/i.test(type)
      || (/^Punt(?: Return)?$/i.test(type) && /\bblocked by\b/i.test(play.text ?? ""))) kind = "blocked-punt";
    else if (/^Punt(?: Return| Fair Catch| Downed| Out of Bounds| Touchback)?$/i.test(type)) kind = "punt";
    else if (/^(?:Field Goal Missed|Missed Field Goal)$/i.test(type)) kind = "missed-field-goal";
    else if (isTurnoverOnDowns(play, teamIds)) kind = "turnover-on-downs";
    else if (/^Sack$/i.test(type)) kind = "sack";
    else if (/^Rush$/i.test(type) && !play.scoringPlay && !play.isTurnover
      && play.start?.team?.id != null && play.end?.team?.id != null
      && String(play.start.team.id) === String(play.end.team.id) && rushingLoss(play)) kind = "tackle-for-loss";
    else if (isFirstDown(play)) kind = "first-down";
    if (!kind) return [];

    let teamId = scoringTeams.get(String(play.id));
    if (kind === "turnover-on-downs") {
      teamId = play.end.team.id;
    } else if (kind === "punt") {
      teamId = play.start?.team?.id;
    } else if (kind === "blocked-punt" || kind === "blocked-field-goal") {
      // The blocking team is the opponent of the confirmed kicking team,
      // regardless of which team ultimately recovers the blocked kick.
      const puntingTeam = String(play.start?.team?.id);
      teamId = teamIds.includes(puntingTeam) && teamIds.length === 2
        ? teamIds.find((id) => id !== puntingTeam) : null;
    } else if (kind === "penalty") {
      // The penalty metadata names the infraction, but not the penalized team.
      teamId = null;
    } else if (kind === "sack" || kind === "tackle-for-loss") {
      const offense = String(play.start?.team?.id);
      teamId = teamIds.includes(offense) && teamIds.length === 2 ? teamIds.find((id) => id !== offense) : null;
    } else if (!teamId && kind !== "safety") {
      teamId = play.end?.team?.id;
      // Don't credit an interception to the throwing team when possession
      // metadata is missing or inconsistent. The label can stand alone.
      if (kind === "interception" && String(teamId) === String(play.start?.team?.id)) teamId = null;
    }
    teamId = teamId == null ? null : String(teamId);
    if (!teamIds.includes(teamId)) teamId = null;
    const primary = {
      id: String(play.id),
      ...(kind === "penalty" && !/^Penalty$/i.test(type) ? { phase: "penalty" } : {}),
      sequence: Number(play.sequenceNumber),
      kind,
      teamId,
      detail: kind === "penalty" ? `${acceptedPenalty.type}${acceptedPenalty.yards !== null ? ` · ${acceptedPenalty.yards} YDS` : ""}` : type,
      player: kind === "interception" ? interceptionPlayer(play.text)
        : kind === "sack" || kind === "tackle-for-loss" ? defensiveStopPlayer(play.text)
        : kind === "blocked-field-goal" ? blockingPlayer(play.text) : null,
      penaltyType: kind === "penalty" ? acceptedPenalty.type : null,
      penaltyYards: kind === "penalty" ? acceptedPenalty.yards : null,
      occurredAt: play.wallclock ?? null,
    };
    // ESPN often revises a touchdown's *existing* play after the conversion.
    // Keep the touchdown identity and expose the conversion as a separate phase.
    const conversion = kind === "touchdown" && /\b(?:extra point is|kick attempt)\s+(GOOD|NO GOOD|BLOCKED)\b/i.exec(play.text ?? "");
    const events = conversion ? [primary, {
      id: primary.id, sequence: primary.sequence, phase: "conversion",
      kind: conversion[1].toUpperCase() === "GOOD" ? "extra-point" : "extra-point-missed",
      teamId: primary.teamId, detail: conversion[1].toUpperCase(), occurredAt: primary.occurredAt,
    }] : [primary];
    if (kind !== "penalty" && acceptedPenalty) events.push({
      id: primary.id, sequence: primary.sequence, phase: "penalty", kind: "penalty",
      teamId: null, detail: `${acceptedPenalty.type}${acceptedPenalty.yards === null ? "" : ` · ${acceptedPenalty.yards} YDS`}`,
      penaltyType: acceptedPenalty.type, penaltyYards: acceptedPenalty.yards, occurredAt: primary.occurredAt,
    });
    return events;
  }).filter((event) => Number.isFinite(event.sequence)).slice(-20);
}
