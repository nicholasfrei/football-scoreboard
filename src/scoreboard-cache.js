import { needsRapidRefresh, nextRefreshDelay } from "../public/game-timing.js";

export function createScoreboardCache(load, { now = Date.now } = {}) {
  let cache = null;
  let expiresAt = 0;
  let pending = null;
  return async function loadScoreboard() {
    // Never let the between-games cache hide a pregame/live refresh or boundary.
    if (cache && now() < expiresAt && !needsRapidRefresh(cache, now())) return { ...cache, stale: false };
    if (!pending) {
      pending = Promise.resolve().then(load).then((scoreboard) => {
        cache = { ...scoreboard, refreshedAt: new Date(now()).toISOString() };
        expiresAt = now() + Math.min(20_000, nextRefreshDelay(cache, now()));
        return { ...cache, stale: false };
      }).catch((error) => {
        if (cache) return { ...cache, stale: true, warning: error.message };
        throw error;
      }).finally(() => { pending = null; });
    }
    return pending;
  };
}
