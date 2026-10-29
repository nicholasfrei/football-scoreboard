// A blocked kick's end coordinates may describe the loose ball, not the next
// line of scrimmage. Do not apply a universal missed-kick rule to those spots.
// This only gates fallback coordinates: a reported live situation wins upstream.
export function uncertainBlockedFieldGoalSpot(play) {
  const type = play?.type?.text ?? "";
  const text = play?.text ?? "";
  const blocked = /blocked\s*field\s*goal/i.test(type)
    || (/field\s*goal/i.test(`${type} ${text}`) && /\bblocked\b/i.test(text));
  if (!blocked) return false;

  // Enforcement/nullification requires its own validation; the blocked kick
  // guard must not erase a valid enforced spot or a retained pre-play spot.
  if (play.isPenalty || play.penalty || /\b(?:penalty|no play|nullified|offsetting)\b/i.test(text)) return false;

  // Require affirmative possession evidence and a scrimmage down. Merely
  // naming the blocker, an out-of-bounds yard line or "no return" is not enough.
  const possessionResult = !/\b(?:not|never)\s+(?:recovered|returned)\b/i.test(text)
    && (/\brecovered\s+by\b/i.test(text)
    || /\breturn(?:ed)?\s+by\b/i.test(text)
    || /\breturn(?:ed)?\s+(?:for\s+)?\d+\s+yards?\b/i.test(text));
  return !(possessionResult && play.end?.team?.id != null && [1, 2, 3, 4].includes(play.end?.down));
}

// A block can have multiple recoveries and returns. Only the final explicit
// return after the last named recovery can supersede a stale provider end.
export function blockedFieldGoalReturnPosition(play, home, away) {
  if (!/\bblocked\b/i.test(play?.text ?? "") || !/field goal/i.test(`${play?.type?.text ?? ""} ${play?.text ?? ""}`)
      || play.scoringPlay || play.isPenalty || play.penalty
      || /\b(?:penalty|no play|nullified|reversed|overturned)\b/i.test(play.text ?? "")
      || ![1, 2, 3, 4].includes(play.end?.down)) return null;
  const receiver = [home, away].find((team) => team.id === String(play.end.team?.id));
  const recovery = [...(play.text ?? "").matchAll(/\brecovered by\s+([A-Z]+)-/gi)].at(-1);
  if (!receiver || !recovery || recovery[1].toUpperCase() !== receiver.abbreviation.toUpperCase()) return null;
  const afterRecovery = play.text.slice(recovery.index + recovery[0].length);
  const recoveredAt = /\bat\s+([A-Z]+)\s*(\d{1,2})\b/i.exec(afterRecovery);
  if (!recoveredAt) return null;
  const after = afterRecovery.slice(recoveredAt.index + recoveredAt[0].length);
  const returns = [...after.matchAll(/\bto\s+([A-Z]+)\s*(\d{1,2})\s+for\s+(\d+)\s+yards?\b/gi)];
  if (returns.length !== 1) return null;
  const [, side, yards, gain] = returns[0];
  const team = [home, away].find((candidate) => candidate.abbreviation.toUpperCase() === side.toUpperCase());
  if (!team || Number(yards) > 50 || Number(gain) <= 0) return null;
  const label = `${team.abbreviation} ${Number(yards)}`;
  return { teamId: receiver.id, label, percent: team.id === home.id ? 100 - Number(yards) : Number(yards) };
}
