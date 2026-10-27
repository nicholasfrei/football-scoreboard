export function leaderCellItems(side, { portrait, name, position, attempts, yards, touchdowns, extras }) {
  const away = [portrait, name, position, attempts, yards, touchdowns, extras];
  return side === "home" ? away.reverse() : away;
}

export function showGameLeaders(game, demo = false) {
  return Boolean(game?.state === "live"
    || (game?.state === "final" && game.leaders?.some((category) => category.leaders?.length))
    || (demo && game?.league === "nfl"));
}
