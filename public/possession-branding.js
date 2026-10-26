export function possessionBranding(game) {
  const team = game?.state === "live"
    ? [game.selectedTeam, game.opponent].find((team) => team?.id === game.possessionTeamId)
    : null;
  const color = team?.color;
  if (!/^#[0-9a-f]{6}$/i.test(color ?? "")) return { color: "#202b23", ink: "#e4e9df" };

  const channels = color.slice(1).match(/../g).map((channel) => {
    const value = parseInt(channel, 16) / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  return { color, ink: luminance > .179 ? "#000000" : "#FFFFFF" };
}
