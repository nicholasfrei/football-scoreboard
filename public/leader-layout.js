export function leaderCellItems(side, { portrait, name, position, attempts, yards, touchdowns, extras }) {
  const away = [portrait, name, position, attempts, yards, touchdowns, extras];
  return side === "home" ? away.reverse() : away;
}
