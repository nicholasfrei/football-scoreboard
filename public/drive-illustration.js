import { driveTrack } from "./play-trajectory.js";

const x = (percent) => 104 + percent * 7.92;
const CENTER = 220;

export function lastDriveSnap(plays) {
  // ESPN repeats the preceding snap coordinates on terminal markers. They are
  // not a new snap that can replace its interception, punt, or pass route.
  return plays?.findLast((play) => Number.isFinite(play.snapPercent)
    && !/^(?:End Period|End of Game|End of Half|End of Regulation)$/i.test(play.type ?? ""));
}

export function illustratedDrive(drive) {
  const { motions, start, end } = driveTrack(drive);
  const motion = motions.at(-1);
  const lastSnap = lastDriveSnap(drive.plays);
  const lastPenalty = lastSnap?.penaltyMotion;
  const currentPenalty = lastSnap === drive.plays?.at(-1) ? lastPenalty : null;
  const active = !lastSnap || lastSnap.id === motion?.id
    || motion?.kind === "kickoff" && drive.plays?.at(-1)?.id === motion.id;
  const target = motion?.kind === "incomplete" ? motion.targetPercent : null;
  const schematic = motion?.kind === "incomplete" && target == null && motion.schematicYards != null
    ? Math.max(0, Math.min(100, motion.start + motion.schematicYards * (drive.direction === "left" ? -1 : 1))) : null;
  const loss = motion?.yards < 0 && ["run", "sack", "pass"].includes(motion.kind);
  const from = motion && x(motion.start);
  const to = motion && (loss ? x(motion.end) : motion.kind === "field-goal"
    ? drive.direction === "left" ? 12 : 988
    : motion.kind === "kickoff" && motion.landingLabel === "TOUCHBACK"
      ? motion.landingPercent < motion.start ? 12 : 988
    : x(motion.kind === "kickoff" ? motion.landingPercent : target ?? schematic ?? motion.catchPercent ?? motion.end));
  const finish = motion && (motion.kind === "field-goal" || motion.kind === "kickoff"
    || motion.kind === "interception" && motion.returnYards === null
    ? to : x(motion.end));
  const segment = motion && active ? { ...motion, loss, from, to, finish, y: CENTER, target,
    path: motion.kind === "fumble-return" && motion.catchPercent === null
      || motion.kind === "incomplete" && target === null && schematic === null ? null
      : motion.kind === "fumble-return" ? `M ${from} ${CENTER} L ${to} ${CENTER}`
      : loss || motion.kind === "run" ? `M ${from} ${CENTER} L ${to} ${CENTER}`
        : from === to ? `M ${from} ${CENTER} C ${from - 18} 120 ${from + 18} 120 ${to} ${CENTER}`
          : `M ${from} ${CENTER} Q ${(from + to) / 2} 70 ${to} ${CENTER}`,
    yacPath: !loss && (motion.kind === "pass" && motion.yac !== null
      || motion.kind === "punt" && motion.returnYards !== null) && to !== finish
      ? `M ${to} ${CENTER} L ${finish} ${CENTER}` : null,
    returnPath: motion.kind === "fumble-return" ? `M ${motion.catchPercent === null ? from : to} ${CENTER} L ${finish} ${CENTER}`
      : motion.kind === "interception" && motion.returnYards !== null && to !== finish
        ? `M ${to} ${CENTER} L ${finish} ${CENTER}` : null } : null;
  const progressEnd = segment?.kind === "kickoff" ? start
    : segment?.start ?? (currentPenalty ? lastSnap.snapPercent : lastPenalty?.end ?? lastSnap?.snapPercent);
  return {
    start, end, count: motions.length, segment,
    penaltyPaths: currentPenalty ? [`M ${x(currentPenalty.start)} ${CENTER} L ${x(currentPenalty.end)} ${CENTER}`] : [],
    progressPath: start !== null && progressEnd != null && start !== progressEnd
      ? `M ${x(start)} ${CENTER} L ${x(progressEnd)} ${CENTER}` : null,
  };
}

export function yardageLabel(segment) {
  if (!segment) return "";
  if (segment.kind === "kickoff") return `${segment.label} · ${segment.landingLabel === "TOUCHBACK" ? "" : "TO "}${segment.landingLabel}`;
  if (segment.kind === "punt" || segment.kind === "field-goal") return `${segment.label} · ${segment.kind === "punt" ? "TO " : ""}${segment.landingLabel}`
    + (segment.returnYards == null ? "" : ` · ${segment.returnYards} YD RETURN TO ${segment.returnLabel}`);
  if (segment.kind === "interception") return `${segment.label} · AT ${segment.interceptionLabel}`
    + (segment.returnYards === null ? ` · TOUCHBACK · ${segment.landingLabel}`
      : segment.returnYards === 0 ? "" : ` · ${segment.returnYards} YD RETURN`);
  if (segment.kind === "fumble-return") return segment.label;
  return `${segment.label} · ${segment.yards > 0 ? "+" : ""}${segment.yards} YDS${segment.yac == null ? "" : ` · ${segment.yac} YAC`}${segment.targetLabel == null ? "" : ` · TARGET ${segment.targetLabel}`}`;
}
