import { fieldPercent } from "../public/play-trajectory.js";
import { fallbackPlayEnd } from "./play-position.js";

const pause = /Timeout|Two-minute warning|End Period|End of|Kickoff|Extra Point|Two.Point|2pt/i;
const kick = /Punt|Field Goal/i;

function clockSeconds(value) {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(value ?? "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function offensivePlay(play, teamId, league) {
  const type = play.type?.text ?? "";
  if (pause.test(type) || /^Penalty$/i.test(type) || /\b(?:no\s*play|nullified)\b/i.test(play.text ?? "")) return false;
  if (play.start?.team?.id != null && String(play.start.team.id) !== teamId) return false;
  if (kick.test(type)) return league === "nfl";
  return /^(?:Rush|Rushing Touchdown|Pass Reception|Passing Touchdown|Pass Incompletion|Pass Interception Return|Interception(?: Return Touchdown)?|Sack(?: Opp Fumble Recovery)?|Fumble(?: Recovery \((?:Own|Opponent)\))?|Safety)$/i.test(type);
}

function elapsedTime(drive, plays, league) {
  const first = drive.start;
  const last = plays.at(-1);
  const start = clockSeconds(first?.clock?.displayValue);
  const end = clockSeconds(last?.clock?.displayValue);
  const from = first?.period?.number;
  const to = last?.period?.number;
  if (start === null || end === null || !Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) return null;
  // College overtime is untimed. Do not invent a duration or guess NFL OT length.
  if (to > 4 && (league !== "nfl" || from !== to)) return null;
  const seconds = (to - from) * 900 + start - end;
  return seconds < 0 ? null : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function netYards(drive, plays, home, away) {
  if (drive.team?.id == null) return null;
  const teamId = String(drive.team?.id);
  const first = plays.find((play) => String(play.start?.team?.id) === teamId && !pause.test(play.type?.text ?? ""));
  const origin = fieldPercent({ possessionText: drive.start?.text }, home, away)
    ?? fieldPercent(first?.start, home, away);
  const last = plays.findLast((play) => String(play.start?.team?.id) === teamId
    && !pause.test(play.type?.text ?? ""));
  if (!last) return 0;
  if (origin === null) return null;
  // Kick distance and defensive return yardage are not offensive drive gains.
  const atSnap = kick.test(last.type?.text ?? "") || /Interception/i.test(last.type?.text ?? "");
  const end = atSnap ? last.start : fallbackPlayEnd(last, plays, home, away);
  if (String(end?.team?.id) !== teamId) return null;
  const position = fieldPercent(end, home, away);
  return position === null ? null : Math.round((position - origin) * (teamId === home.id ? -1 : 1));
}

/** Prefer current provider totals; reconstruct missing progress from visible plays only. */
export function driveStats(drive, plays, home, away, league) {
  const description = /^(\d+) plays?,\s*(-?\d+) yards?,\s*(\d+:\d{2})$/i.exec(drive.description ?? "");
  const playCount = Number.isInteger(drive.offensivePlays) && drive.offensivePlays >= 0 ? drive.offensivePlays
    : description ? Number(description[1]) : plays.filter((play) => offensivePlay(play, String(drive.team?.id), league)).length;
  const yards = Number.isFinite(drive.yards) ? drive.yards
    : description ? Number(description[2]) : netYards(drive, plays, home, away);
  const reportedTime = drive.timeElapsed?.displayValue ?? description?.[3];
  const time = clockSeconds(reportedTime) !== null ? reportedTime : elapsedTime(drive, plays, league);
  return { playCount, yards, time };
}
