// OKLab distances account for perceived differences in both hue and lightness.
const CLOSE_COLOR_DISTANCE = 0.12;

function perceptualColor(hex) {
  if (typeof hex !== "string" || !/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const [r, g, b] = hex.slice(1).match(/../g).map((channel) => {
    const value = parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

function colorDistance(a, b) {
  return Math.hypot(...a.map((channel, index) => channel - b[index]));
}

export function fieldBranding(team, homeTeam = null) {
  let color = team.color;
  // Only the away end zone supplies a home team for comparison. Never change
  // either team's shared branding or use an alternate that reduces separation.
  if (homeTeam) {
    const home = perceptualColor(homeTeam.color);
    const primary = perceptualColor(team.color);
    const secondary = perceptualColor(team.alternateColor);
    if (home && primary && secondary) {
      const primaryDistance = colorDistance(primary, home);
      if (primaryDistance < CLOSE_COLOR_DISTANCE && colorDistance(secondary, home) > primaryDistance) {
        color = team.alternateColor;
      }
    }
  }
  return { color, ink: "#FFFFFF" };
}

export function endzoneTextLayout(bounds) {
  const width = Math.max(0, ...bounds.map((box) => box.width));
  const height = Math.max(0, ...bounds.map((box) => box.height));
  if (!width || !height) return bounds.map(() => null);
  // Both names use one uniform scale: shorter names keep their natural length,
  // and a long name reduces both labels instead of distorting either one.
  const scale = Math.min(320 / width, 56 / height);
  return bounds.map((box) => box.width && box.height ? {
    scale,
    x: -(box.x + box.width / 2) * scale,
    y: -(box.y + box.height / 2) * scale,
  } : null);
}
