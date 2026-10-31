export function driveSummaryLabel(drive) {
  if (!drive) return "";
  const count = drive.playCount;
  return [
    Number.isInteger(count) ? `${count} ${count === 1 ? "play" : "plays"}` : "— plays",
    Number.isFinite(drive.yards) ? `${drive.yards} ${Math.abs(drive.yards) === 1 ? "yard" : "yards"}` : "— yards",
    drive.time ?? "—:—",
  ].join(", ");
}

export function playDownDistance(play) {
  return !/^Kickoff/i.test(play.type ?? "") && [1, 2, 3, 4].includes(play.down) && Number.isFinite(play.distance)
    ? ` · ${["", "1st", "2nd", "3rd", "4th"][play.down]} & ${play.distance}` : "";
}
