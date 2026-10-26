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
  return { color, ink: "#FFFFFF" };
}

export function endzoneTextLayout(bounds) {
  const width = Math.max(0, ...bounds.map((box) => box.width));
  const height = Math.max(0, ...bounds.map((box) => box.height));
  if (!width || !height) return bounds.map(() => null);
  // Both names use one uniform scale: shorter names keep their natural length,
  // and a long name reduces both labels instead of distorting either one.
  const scale = Math.min(320 / width, 50 / height);
  return bounds.map((box) => box.width && box.height ? {
    scale,
    x: -(box.x + box.width / 2) * scale,
    y: -(box.y + box.height / 2) * scale,
  } : null);
}
