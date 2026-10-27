/** Hold a confirmed field spot through fresh-feed gaps, not through new football
 * events or outages. No coordinates are inferred from clocks, scores, or prose. */
function clockSeconds(clock) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock ?? "");
  return match && Number(match[2]) < 60 ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function createBallPositionTracker() {
  let previous = null;
  return {
    reset() { previous = null; },
    observe(payload) {
      const game = payload?.spotlight;
      if (!game || game.state !== "live" || payload.stale || payload.gamecastUnavailable) {
        previous = null;
        return game ? { ...game, ball: null, possessionTeamId: null } : null;
      }
      const key = `${game.league}:${game.id}:${game.homeAway}:${game.selectedTeam.id}:${game.opponent.id}`;
      const context = game.fieldContext ?? {};
      const home = game.homeAway === "home" ? game.selectedTeam : game.opponent;
      const away = game.homeAway === "home" ? game.opponent : game.selectedTeam;
      const possession = game.possessionTeamId ?? context.possessionTeamId;
      const score = `${game.selectedTeam.score}:${game.opponent.score}`;
      const at = Date.parse(context.lastPlayAt);
      const previousAt = Date.parse(previous?.lastPlayAt);
      const sequence = context.lastPlaySequence;
      const period = context.lastPlayPeriod;
      const clock = clockSeconds(context.lastPlayClock);
      const previousClock = clockSeconds(previous?.lastPlayClock);
      const olderPlay = previous?.key === key && (Number.isFinite(period) && Number.isFinite(previous?.lastPlayPeriod) && period !== previous.lastPlayPeriod
        ? period < previous.lastPlayPeriod
        : clock !== null && previousClock !== null && clock !== previousClock
          ? clock > previousClock
          : Number.isFinite(at) && Number.isFinite(previousAt) && at !== previousAt
            ? at < previousAt : Number.isFinite(sequence) && Number.isFinite(previous?.lastPlaySequence) && sequence < previous.lastPlaySequence);
      const newPlay = !olderPlay && context.lastPlayId != null && context.lastPlayId !== previous?.lastPlayId;
      const resetEvent = newPlay && (context.scoring || context.turnover
        || /Touchdown|Safety|Kickoff|Punt|Interception|Fumble|Field Goal|Extra Point|End of Game/i.test(context.lastPlayType ?? ""));
      const canHold = previous?.key === key && previous.ball && !resetEvent
        && previous.score === score
        && !(context.driveId && previous.driveId && context.driveId !== previous.driveId)
        && !(possession && possession !== previous.possessionTeamId);

      // A timeout's spot must not move an already confirmed ball. Otherwise,
      // fresh positions always win, including penalties, punts and turnovers.
      const scored = context.scoring && !olderPlay;
      const held = Boolean(canHold && !scored && (!game.ball || (context.pause && !olderPlay)));
      const ball = scored ? null : held ? { ...previous.ball } : game.ball ?? null;
      const possessionTeamId = scored ? null : held ? previous.possessionTeamId : game.possessionTeamId ?? (ball
        ? ball.direction === "right" ? away.id : ball.direction === "left" ? home.id : null : null);
      previous = {
        key, score, ball: ball ? { ...ball } : null, possessionTeamId,
        driveId: context.driveId ?? (canHold ? previous.driveId : null),
        lastPlayId: olderPlay || context.lastPlayId == null ? previous?.lastPlayId ?? null : context.lastPlayId,
        lastPlayAt: olderPlay || context.lastPlayId == null ? previous?.lastPlayAt ?? null : context.lastPlayAt,
        lastPlaySequence: olderPlay || context.lastPlayId == null ? previous?.lastPlaySequence ?? null : sequence,
        lastPlayPeriod: olderPlay || context.lastPlayId == null ? previous?.lastPlayPeriod ?? null : period,
        lastPlayClock: olderPlay || context.lastPlayId == null ? previous?.lastPlayClock ?? null : context.lastPlayClock,
      };
      return { ...game, ball, possessionTeamId, ballHeld: held };
    },
  };
}
