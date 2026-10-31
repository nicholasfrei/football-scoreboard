import { fieldBranding } from "./field-branding.js";

export function badgeInk(color) {
  if (!/^#[0-9a-f]{6}$/i.test(color ?? "")) return "#FFFFFF";
  const channels = color.slice(1).match(/../g).map((channel) => {
    const value = parseInt(channel, 16) / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  return luminance > .179 ? "#000000" : "#FFFFFF";
}

export function possessionBranding(game) {
  const team = game?.state === "live"
    ? [game.selectedTeam, game.opponent].find((team) => team?.id === game.possessionTeamId)
    : null;
  const home = game?.homeAway === "home" ? game.selectedTeam : game?.opponent;
  const away = game?.homeAway === "home" ? game.opponent : game?.selectedTeam;
  const color = team && fieldBranding(team, team.id === away?.id ? home : null).color;
  if (!/^#[0-9a-f]{6}$/i.test(color ?? "")) return { color: "#373e47", ink: "#cdd9e5" };
  return { color, ink: badgeInk(color) };
}
