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
