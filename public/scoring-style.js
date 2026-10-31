import { fieldBranding } from "./field-branding.js";

export function scoringPlayColor(game, play) {
  if (!play.scoring || play.scoringTeamId == null) return null;
  const home = game.homeAway === "home" ? game.selectedTeam : game.opponent;
  const away = game.homeAway === "home" ? game.opponent : game.selectedTeam;
  const teamId = String(play.scoringTeamId);
  if (teamId === String(home.id)) return fieldBranding(home).color;
  if (teamId === String(away.id)) return fieldBranding(away, home).color;
  return null;
}

// Keep this panel color in sync with .play-panel in styles.css.
const PANEL_COLOR = "#1c2128";

function luminance(color) {
  if (!/^#[0-9a-f]{6}$/i.test(color ?? "")) return null;
  const channels = color.slice(1).match(/../g).map((channel) => {
    const value = parseInt(channel, 16) / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}

export function scoringNeedsHighlight(color) {
  const teamLuminance = luminance(color);
  if (teamLuminance === null) return false;
  const panelLuminance = luminance(PANEL_COLOR);
  const contrast = (Math.max(teamLuminance, panelLuminance) + .05)
    / (Math.min(teamLuminance, panelLuminance) + .05);
  return contrast < 4.5;
}
