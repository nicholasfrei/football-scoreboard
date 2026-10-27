import { driveTrack } from "./play-trajectory.js";

const x = (percent) => 104 + percent * 7.92;
const CENTER = 220;

export function illustratedDrive(drive) {
  const { motions, start, end } = driveTrack(drive);
  const motion = motions.at(-1);
  const lastSnap = drive.plays?.findLast((play) => Number.isFinite(play.snapPercent));
  const active = !lastSnap || lastSnap.id === motion?.id;
  const target = motion?.kind === "incomplete" ? motion.targetPercent : null;
  const schematic = motion?.kind === "incomplete" && motion.schematicYards != null
    ? Math.max(0, Math.min(100, motion.start + motion.schematicYards * (drive.direction === "left" ? -1 : 1))) : null;
  const from = motion && x(motion.start);
  const to = motion && (motion.kind === "field-goal" ? drive.direction === "left" ? 12 : 988
    : x(target ?? schematic ?? motion.catchPercent ?? motion.end));
  const finish = motion && (motion.kind === "field-goal" || motion.kind === "interception" && motion.returnYards === null
    ? to : x(motion.end));
  const segment = motion && active ? { ...motion, from, to, finish, y: CENTER, target,
    path: motion.kind === "incomplete" && target === null && schematic === null ? null
      : motion.kind === "run" ? `M ${from} ${CENTER} L ${to} ${CENTER}`
        : from === to ? `M ${from} ${CENTER} C ${from - 18} 120 ${from + 18} 120 ${to} ${CENTER}`
          : `M ${from} ${CENTER} Q ${(from + to) / 2} 70 ${to} ${CENTER}`,
    yacPath: motion.kind === "pass" && motion.yac !== null && to !== finish
      ? `M ${to} ${CENTER} L ${finish} ${CENTER}` : null,
    returnPath: motion.kind === "interception" && motion.returnYards !== null && to !== finish
      ? `M ${to} ${CENTER} L ${finish} ${CENTER}` : null } : null;
  return {
    start, end, count: motions.length, segment,
    finalMarker: !segment && lastSnap ? { x: x(lastSnap.snapPercent), y: CENTER } : null,
    progressPath: start !== null && (segment?.start ?? lastSnap?.snapPercent) != null
      && start !== (segment?.start ?? lastSnap?.snapPercent)
      ? `M ${x(start)} ${CENTER} L ${x(segment?.start ?? lastSnap.snapPercent)} ${CENTER}` : null,
  };
}

export function yardageLabel(segment) {
  if (!segment) return "";
  if (segment.kind === "punt" || segment.kind === "field-goal") return `${segment.label} · ${segment.kind === "punt" ? "TO " : ""}${segment.landingLabel}`;
  if (segment.kind === "interception") return `${segment.label} · AT ${segment.interceptionLabel}`
    + (segment.returnYards === null ? ` · TOUCHBACK · ${segment.landingLabel}`
      : segment.returnYards === 0 ? "" : ` · ${segment.returnYards} YD RETURN`);
  return `${segment.label} · ${segment.yards > 0 ? "+" : ""}${segment.yards} YDS${segment.yac == null ? "" : ` · ${segment.yac} YAC`}${segment.targetLabel == null ? "" : ` · TARGET ${segment.targetLabel}`}`;
}
