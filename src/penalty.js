// Some ESPN feeds classify intentional grounding as a sack and omit penalty
// metadata, despite explicitly naming the penalty in the play description.
export function textIntentionalGrounding(play) {
  const status = play.penalty?.status?.slug;
  if (status && status !== "accepted") return false;
  const text = play.text ?? "";
  return /\bPENALTY\s+(?:\S+\s+)?intentional grounding\b/i.test(text)
    && !/\b(?:declined|offsetting|offset)\b/i.test(text);
}
