function clockSeconds(play) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(play.clock?.displayValue ?? "");
  if (!match || Number(match[2]) >= 60) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function orderKey(play) {
  const period = Number(play.period?.number);
  const sequence = /^\d+$/.test(String(play.sequenceNumber ?? "")) ? Number(play.sequenceNumber) : NaN;
  const clock = clockSeconds(play);
  const time = Date.parse(play.wallclock);
  const clockKey = clock === null ? Infinity : -clock;
  const timeKey = Number.isFinite(time) ? time : Infinity;
  const sequenced = Number.isSafeInteger(sequence);
  return [
    Number.isFinite(period) ? period : 0,
    /^(?:End Period|End of Half|End of Regulation|End of Game)$/i.test(play.type?.text ?? "") ? 1 : 0,
    sequenced ? 0 : 1,
    sequenced ? sequence : 0,
    sequenced || period > 4 ? timeKey : clockKey,
    sequenced || period > 4 ? clockKey : timeKey,
    String(play.id ?? ""),
  ];
}

// Within a period, sequence survives both clock corrections and revised
// wallclocks. It is not unique: timeouts often reuse a snap's sequence, so use
// wallclock before clock to break ties (timeouts can also reset the clock).
// Terminal markers sometimes reuse an EARLIER sequence and always belong last.
// Unsequenced entries form a separate fallback group: clock then wallclock in
// regulation, wallclock then clock in OT, where college clocks are untimed.
// Do not switch rules based on the pair being compared: mixing sequence and
// clock comparisons that way can create cycles and input-dependent results.
export function comparePlays(a, b) {
  const aKey = orderKey(a);
  const bKey = orderKey(b);
  for (let index = 0; index < aKey.length; index++) {
    if (aKey[index] < bKey[index]) return -1;
    if (aKey[index] > bKey[index]) return 1;
  }
  return 0;
}
