export function leaderCardTeams(game) {
  return game.homeAway === "home" ? [game.opponent, game.selectedTeam] : [game.selectedTeam, game.opponent];
}

export function showGameLeaders(game, demo = false) {
  return Boolean(game?.state === "live"
    || (game?.state === "final" && game.leaders?.some((category) => category.leaders?.length))
    || (demo && game?.league === "nfl"));
}
