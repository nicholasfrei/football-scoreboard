export function driveSummaryLabel(drive) {
  if (!drive) return "";
  const count = drive.playCount;
  return [
    Number.isInteger(count) ? `${count} ${count === 1 ? "play" : "plays"}` : "— plays",
    Number.isFinite(drive.yards) ? `${drive.yards} ${Math.abs(drive.yards) === 1 ? "yard" : "yards"}` : "— yards",
    drive.time ?? "—:—",
  ].join(", ");
}
