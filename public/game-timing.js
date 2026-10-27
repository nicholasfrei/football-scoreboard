export const COUNTDOWN_WINDOW_MS = 24 * 60 * 60 * 1000;
export const PREGAME_WINDOW_MS = 5 * 60 * 1000;
export const NORMAL_POLL_MS = 5 * 60_000;
export const LIVE_POLL_MS = 15_000;

function kickoffTime(game) {
  return game && !game.timeTbd && game.kickoffAt ? Date.parse(game.kickoffAt) : NaN;
}

/** Keep zero on screen until the provider confirms kickoff; never invent live state. */
export function kickoffCountdown(game, now = Date.now()) {
  if (game?.state !== "scheduled") return null;
  const remaining = kickoffTime(game) - Number(now);
  if (!Number.isFinite(remaining) || remaining > COUNTDOWN_WINDOW_MS) return null;
  const seconds = Math.max(0, Math.ceil(remaining / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((part) => String(part).padStart(2, "0")).join(":");
}

export function needsRapidRefresh(payload, now = Date.now()) {
  return [payload?.spotlight, payload?.nextGame].some((game) => game && (
    game.state === "live"
    || (game.state === "unknown" && /delay|suspend/i.test(game.status ?? ""))
    || (game.state === "scheduled" && kickoffTime(game) - Number(now) <= PREGAME_WINDOW_MS)
  ));
}

/** Wake at the countdown/pregame boundary, even if the last result is still featured. */
export function nextRefreshDelay(payload, now = Date.now()) {
  let delay = needsRapidRefresh(payload, now) ? LIVE_POLL_MS : NORMAL_POLL_MS;
  for (const game of [payload?.spotlight, payload?.nextGame]) {
    if (game?.state !== "scheduled") continue;
    for (const window of [COUNTDOWN_WINDOW_MS, PREGAME_WINDOW_MS]) {
      const untilBoundary = kickoffTime(game) - Number(now) - window;
      if (untilBoundary > 0) delay = Math.min(delay, untilBoundary);
    }
  }
  return delay;
}

/** Non-overlapping, start-to-start polling. Failed refreshes retain the last cadence. */
export function createRefreshLoop({ refresh, getPayload, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer;
  let running = false;
  let pending = null;
  function refreshNow() {
    if (pending) return pending;
    clearTimer(timer);
    const startedAt = now();
    pending = Promise.resolve().then(refresh).finally(() => {
      pending = null;
      if (running) timer = setTimer(refreshNow, Math.max(0, nextRefreshDelay(getPayload(), startedAt) - (now() - startedAt)));
    });
    return pending;
  }
  return {
    start() { running = true; return refreshNow(); },
    refreshNow,
    stop() { running = false; clearTimer(timer); },
  };
}
