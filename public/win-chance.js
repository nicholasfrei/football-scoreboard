import { fieldBranding } from "./field-branding.js";
import { badgeInk } from "./possession-branding.js";

export function winChanceTeams(game) {
  const model = game?.matchupPredictor;
  if (!model) return null;
  const home = game.homeAway === "home" ? game.selectedTeam : game.opponent;
  const away = game.homeAway === "home" ? game.opponent : game.selectedTeam;
  const winningTeam = model.selectedTeam === model.opponent ? null
    : model.selectedTeam > model.opponent ? game.selectedTeam : game.opponent;
  const color = winningTeam && fieldBranding(winningTeam, winningTeam.id === away.id ? home : null).color;
  const ink = winningTeam ? badgeInk(color) : null;
  return [
    { text: `${game.selectedTeam.abbreviation} ${model.selectedTeam.toFixed(1)}%`, color: winningTeam?.id === game.selectedTeam.id ? color : null, ink: winningTeam?.id === game.selectedTeam.id ? ink : null },
    { text: `${game.opponent.abbreviation} ${model.opponent.toFixed(1)}%`, color: winningTeam?.id === game.opponent.id ? color : null, ink: winningTeam?.id === game.opponent.id ? ink : null },
  ];
}
