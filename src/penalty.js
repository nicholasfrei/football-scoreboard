const rejectedPenaltyText = /\b(?:declined|offsetting|offset|possible|potential|questionable|questioned|overturned|discussed|discussing)\b|\bno\s+penalty\b|\?/i;

// Some ESPN feeds classify intentional grounding as a sack and omit penalty
// metadata, despite explicitly naming the penalty in the play description.
export function textIntentionalGrounding(play) {
  const status = play.penalty?.status?.slug;
  if (status && status !== "accepted") return false;
  const text = play.text ?? "";
  return /\bPENALTY\s+(?:\S+\s+)?intentional grounding\b/i.test(text)
    && !rejectedPenaltyText.test(text);
}

// Text-only college feeds report enforcement as PENALTY <abbreviation>
// <infraction> [(player)] <yards> yards from <spot> to <spot>. Require that
// complete statement, not commentary about a possible flag or net play yards.
function reportedEnforcement(play) {
  if (!/^Penalty$/i.test(play.type?.text ?? "")) return null;
  const text = play.text ?? "";
  if (rejectedPenaltyText.test(text)
      || (text.match(/\bPENALTY\s+[A-Z][A-Z&-]*\s+/gi)?.length ?? 0) !== 1) return null;
  const match = /\bPENALTY\s+[A-Z][A-Z&-]*\s+(False Start|Holding|Offensive Holding|Defensive Holding|Offside|Offsides|Delay Of Game|Pass Interference|Defensive Pass Interference|Offensive Pass Interference|Roughing The Passer|Roughing The Kicker|Personal Foul|Illegal Shift|Illegal Formation|Illegal Substitution|Targeting|Intentional Grounding)\s+(?:\([^)]*\)\s+)?(\d+)\s+yards?\s+from\s+[A-Z][A-Z&-]*\s*\d{1,2}\s+to\s+[A-Z][A-Z&-]*\s*\d{1,2}(?=[\s,.]|$)/i.exec(text);
  return match ? { type: match[1], yards: Number(match[2]) } : null;
}

/** Accepted metadata is authoritative; otherwise require explicit enforcement. */
export function acceptedPenalty(play) {
  const status = play.penalty?.status?.slug;
  if (status && status !== "accepted") return null;
  const reported = reportedEnforcement(play);
  const type = (status === "accepted" && play.penalty.type?.text)
    || (textIntentionalGrounding(play) && "Intentional Grounding") || reported?.type;
  if (!type) return null;
  return {
    type,
    yards: Number.isFinite(play.penalty?.yards) ? play.penalty.yards : reported?.yards ?? null,
  };
}
