export function fieldBranding(team) {
  return { color: team.color, ink: "#FFFFFF" };
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
