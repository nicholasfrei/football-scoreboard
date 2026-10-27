function clockSeconds(play) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(play.clock?.displayValue ?? "");
  if (!match || Number(match[2]) >= 60) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

// Clock time is more reliable than an occasionally revised wallclock. Keep
// wallclock as a tie-breaker, since several plays can share a game clock.
export function comparePlays(a, b) {
  const period = Number(a.period?.number ?? 0) - Number(b.period?.number ?? 0);
  if (period) return period;
  const aEnd = /^End Period$/i.test(a.type?.text ?? "");
  const bEnd = /^End Period$/i.test(b.type?.text ?? "");
  if (aEnd !== bEnd) return aEnd ? 1 : -1;
  const aClock = clockSeconds(a);
  const bClock = clockSeconds(b);
  if (aClock !== bClock) {
    if (aClock === null) return 1;
    if (bClock === null) return -1;
    return bClock - aClock;
  }
  const aTime = Date.parse(a.wallclock);
  const bTime = Date.parse(b.wallclock);
  if (Number.isFinite(aTime) !== Number.isFinite(bTime)) return Number.isFinite(aTime) ? -1 : 1;
  return (Number.isFinite(aTime) ? aTime - bTime : 0)
    || Number(a.sequenceNumber ?? 0) - Number(b.sequenceNumber ?? 0);
}
