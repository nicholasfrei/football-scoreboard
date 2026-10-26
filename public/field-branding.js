// Include dark forest greens and green-teals, which also blend into the turf.
function isGreen(color) {
  const [r, g, b] = color.slice(1).match(/../g).map((channel) => parseInt(channel, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const range = max - min;
  if (range === 0) return false;
  const saturation = range / (1 - Math.abs(max + min - 1));
  const hue = ((max === r ? (g - b) / range : max === g ? (b - r) / range + 2 : (r - g) / range + 4) * 60 + 360) % 360;
  return saturation >= .2 && hue >= 75 && hue <= 190;
}

export function fieldBranding(team) {
  const color = isGreen(team.color) && /^#[0-9a-f]{6}$/i.test(team.alternateColor ?? "")
    ? team.alternateColor : team.color;
  const [r, g, b] = color.slice(1).match(/../g).map((channel) => parseInt(channel, 16));
  return { color, ink: r * .299 + g * .587 + b * .114 > 155 ? "#000000" : "#FFFFFF" };
}
