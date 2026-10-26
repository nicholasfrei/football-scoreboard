export const HIGHLIGHT_DURATION_MS = 12_000;
const MAX_EVENT_AGE_MS = 120_000;
const MAX_POLL_GAP_MS = 90_000;

export const HIGHLIGHT_LABELS = {
  touchdown: "TOUCHDOWN",
  interception: "INTERCEPTION",
  fumble: "FUMBLE",
  "field-goal": "FIELD GOAL",
  safety: "SAFETY",
};

/** Track a play-sequence watermark, not score deltas or matching prose.
 * First load, reconnects, and game changes establish a baseline silently.
 * If several big plays arrive together, show the newest rather than a backlog.
 */
export function createHighlightTracker() {
  let gameId = null;
  let sequence = null;
  let lastPollAt = null;
  const seen = new Set();
  return {
    observe(payload, now = Date.now()) {
      const game = payload?.spotlight;
      if (payload?.stale || payload?.gamecastUnavailable || !game || !Array.isArray(game.highlights)
          || !Number.isFinite(game.latestPlaySequence)) {
        sequence = null;
        lastPollAt = null;
        return null;
      }
      const key = `${game.league}:${game.id}`;
      if (key !== gameId) {
        gameId = key;
        sequence = null;
        seen.clear();
      }
      const baseline = sequence === null || lastPollAt === null || now - lastPollAt > MAX_POLL_GAP_MS;
      const previousSequence = sequence;
      sequence = Math.max(sequence ?? 0, game.latestPlaySequence);
      lastPollAt = now;
      const candidates = game.highlights.filter((event) => {
        if (seen.has(event.id)) return false;
        seen.add(event.id);
        const at = Date.parse(event.occurredAt);
        return !baseline && game.state === "live" && event.sequence > previousSequence
          && Object.hasOwn(HIGHLIGHT_LABELS, event.kind)
          && (!Number.isFinite(at) || (now - at <= MAX_EVENT_AGE_MS && at <= now + 30_000));
      });
      return candidates.sort((a, b) => a.sequence - b.sequence).at(-1) ?? null;
    },
  };
}
