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

// Text-only college feeds can attach enforcement to the underlying run, pass
// or kick rather than to a Penalty play. Require a complete, unambiguous
// statement, not merely a flag mentioned in commentary or net play yardage.
const foul = "Offensive Holding|Defensive Holding|Holding|False Start|Offside|Offsides|Delay Of Game|Defensive Pass Interference|Offensive Pass Interference|Pass Interference|Roughing The Passer|Roughing The Kicker|Personal Foul|Illegal Shift|Illegal Formation|Illegal Substitution|Illegal Motion|Illegal Use Of Hands|Illegal Touch-Pass|Running Into The Kicker|Targeting|Intentional Grounding|Face Mask|Illegal Forward Pass|Unnecessary Roughness|Unsportsmanlike Conduct|Illegal Bat|Ineligible Downfield on Pass";
const label = new RegExp(`\\bPENALTY\\s+[A-Z][A-Z&-]*\\s+(?:(?:UNR|UNS):\\s*)?(${foul})\\b`, "gi");
const enforcement = new RegExp([
  `\\bPENALTY\\s+([A-Z][A-Z&-]*)\\s+(?:(?:UNR|UNS):\\s*)?(${foul})\\s+`,
  "(?:\\([^)]*\\)\\s+)?(?:\\1\\s+(?:(?:UNR|UNS):\\s*)?\\2\\s+(?:\\([^)]*\\)\\s+)?)?",
  "(\\d+)\\s+yards?\\s+from\\s+([A-Z][A-Z&-]*)\\s*(\\d{1,2})\\s+to\\s+([A-Z][A-Z&-]*)\\s*(\\d{1,2})(?=[\\s,.]|$)",
].join(""), "gi");
const declinedThenEnforced = new RegExp([
  `\\bPENALTY\\s+([A-Z][A-Z&-]*)\\s+(${foul})\\s+declined\\s+\\1\\s+\\2\\s+`,
  "(?:\\([^)]*\\)\\s+)?(\\d+)\\s+yards?\\s+from\\s+([A-Z][A-Z&-]*)\\s*(\\d{1,2})\\s+to\\s+([A-Z][A-Z&-]*)\\s*(\\d{1,2})(?=[\\s,.]|$)",
].join(""), "gi");

export function reportedEnforcement(play) {
  if (play.scoringPlay || !/^(?:Penalty|Rush|Pass Reception|Pass Incompletion|Sack|Fumble Recovery \(Own\)|Kickoff|Punt(?: Return| Fair Catch| Downed| Out of Bounds| Touchback)?)$/i.test(play.type?.text ?? "")) return null;
  const text = play.text ?? "";
  const mentions = [...text.matchAll(/\bPENALTY\s+[A-Z][A-Z&-]*\s+/gi)];
  if (/\bdeclined\b/i.test(text)) {
    const matches = [...text.matchAll(declinedThenEnforced)];
    if (mentions.length !== 1 || matches.length !== 1 || (text.match(/\bdeclined\b/gi)?.length ?? 0) !== 1
        || rejectedPenaltyText.test(text.replace(/\bdeclined\b/i, ""))) return null;
    const match = matches[0];
    return { type: match[2], yards: Number(match[3]),
      from: { side: match[4], yards: Number(match[5]) },
      to: { side: match[6], yards: Number(match[7]) } };
  }
  if (rejectedPenaltyText.test(text)) return null;
  const labels = [...text.matchAll(label)];
  const matches = [...text.matchAll(enforcement)];
  // Two identical foul labels can share one enforcement. Conflicting fouls or
  // multiple enforced spots cannot be attributed safely to one takeover.
  if (!mentions.length || mentions.length !== labels.length || matches.length !== 1
      || labels.some((item) => item[1].toLowerCase() !== matches[0][2].toLowerCase())) return null;
  const match = matches[0];
  return { type: match[2], yards: Number(match[3]),
    from: { side: match[4], yards: Number(match[5]) },
    to: { side: match[6], yards: Number(match[7]) } };
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
