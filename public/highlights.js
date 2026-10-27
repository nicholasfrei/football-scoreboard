export const HIGHLIGHT_DURATION_MS = 15_000;
const MAX_EVENT_AGE_MS = 120_000;
const MAX_POLL_GAP_MS = 90_000;

export const HIGHLIGHT_LABELS = {
  touchdown: "TOUCHDOWN",
  interception: "INTERCEPTION",
  fumble: "FUMBLE RECOVERY",
  "turnover-on-downs": "TURNOVER ON DOWNS",
  sack: "SACK",
  "tackle-for-loss": "TACKLE FOR LOSS",
  penalty: "PENALTY",
  "field-goal": "FIELD GOAL",
  safety: "SAFETY",
  "first-down": "FIRST DOWN",
  "extra-point": "EXTRA POINT",
  "two-point-conversion": "DEFENSIVE 2-POINT CONVERSION",
  punt: "PUNT",
  "blocked-punt": "BLOCKED PUNT",
  "blocked-field-goal": "BLOCKED FIELD GOAL",
};

export function highlightDuration(kind) {
  if (["touchdown", "field-goal", "safety"].includes(kind)) return 150_000;
  return kind === "punt" ? 10_000 : kind === "extra-point" ? 6_000 : HIGHLIGHT_DURATION_MS;
}

export function highlightDetail(event, game) {
  if (event.kind === "penalty") return Number.isFinite(event.penaltyYards) ? `${event.penaltyYards} YDS` : "";
  if (event.kind === "interception") return event.player ? `INTERCEPTED BY ${event.player}` : "";
  if (event.kind === "blocked-field-goal" && event.player) return `BLOCKED BY ${event.player}`;
  if (event.kind === "touchdown") {
    const { selectedTeam, opponent } = game;
    return `${selectedTeam.abbreviation} ${selectedTeam.score ?? "—"}-${opponent.score ?? "—"} ${opponent.abbreviation}`;
  }
  const labels = { fumble: "RECOVERED BY", "turnover-on-downs": "TAKEOVER BY", sack: "SACK BY",
    "tackle-for-loss": "STOPPED BY", punt: "PUNTING TEAM", "blocked-punt": "BLOCKED BY", "blocked-field-goal": "BLOCKED BY" };
  if (Object.hasOwn(labels, event.kind)) {
    return [game.selectedTeam, game.opponent].some((team) => team.id === event.teamId)
      ? labels[event.kind] : "TEAM NOT CONFIRMED";
  }
  return event.detail;
}

/** Track stable play IDs in football order, not score deltas or matching prose.
 * First load, reconnects, and game changes establish a baseline silently.
 * If several big plays arrive together, show the newest rather than a backlog.
 */
export function createHighlightTracker() {
  let gameId = null;
  let sequence = null;
  let playOrder = null;
  let lastPollAt = null;
  const seen = new Set();
  return {
    observe(payload, now = Date.now()) {
      const game = payload?.spotlight;
      if (payload?.stale || payload?.gamecastUnavailable || !game || !Array.isArray(game.highlights)
          || (!Array.isArray(game.latestPlayOrder) && !Number.isFinite(game.latestPlaySequence))) {
        sequence = null;
        playOrder = null;
        lastPollAt = null;
        return null;
      }
      const key = `${game.league}:${game.id}`;
      if (key !== gameId) {
        gameId = key;
        sequence = null;
        playOrder = null;
        seen.clear();
      }
      const baseline = sequence === null || lastPollAt === null || now - lastPollAt > MAX_POLL_GAP_MS;
      const previousSequence = sequence;
      const previousOrder = playOrder;
      playOrder = Array.isArray(game.latestPlayOrder) ? game.latestPlayOrder : null;
      const positions = new Map((playOrder ?? []).map((id, index) => [id, index]));
      const previousIds = new Set(previousOrder ?? []);
      // The preceding poll's last play is an anchor, even when it wasn't a
      // highlight. Historical insertions before it must never become alerts.
      // Without a shared anchor (or on a metadata transition), rebaseline.
      const anchor = previousOrder?.length ? positions.get(previousOrder.at(-1)) : -1;
      const orderedContinuation = previousOrder !== null && anchor !== undefined;
      sequence = Math.max(sequence ?? 0, Number.isFinite(game.latestPlaySequence) ? game.latestPlaySequence : 0);
      lastPollAt = now;
      const candidates = game.highlights.filter((event) => {
        if (seen.has(event.id)) return false;
        seen.add(event.id);
        const at = Date.parse(event.occurredAt);
        // Keep sequence compatibility only for older responses lacking ID order.
        const appended = playOrder !== null
          ? orderedContinuation && !previousIds.has(event.id) && positions.get(event.id) > anchor
          : previousOrder === null && event.sequence > previousSequence;
        return !baseline && game.state === "live" && appended
          && Object.hasOwn(HIGHLIGHT_LABELS, event.kind)
          && (!Number.isFinite(at) || (now - at <= MAX_EVENT_AGE_MS && at <= now + 30_000));
      });
      return candidates.sort((a, b) => playOrder !== null
        ? positions.get(a.id) - positions.get(b.id) : a.sequence - b.sequence).at(-1) ?? null;
    },
  };
}
