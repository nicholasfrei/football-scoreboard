import { normalizeGame } from "./scoreboard.js";
import { enrichGame } from "./gamecast.js";
import { gameHighlights } from "./highlights.js";
import { comparePlays } from "./play-order.js";

export const REPLAY_GAMES = {
  nfl: { id: "401873009", league: "nfl", teamId: "6", file: "nfl/401873009.json.gz", label: "Cowboys vs Eagles" },
  college: { id: "401856732", league: "college-football", teamId: "251", file: "college-football/401856732.json.gz", label: "Texas vs Ole Miss" },
};

// Completed summaries contain the entire game, not historical live snapshots.
// Build a prefix for each play so no future score, drive or highlight leaks in.
export function createReplayFrames(summary, option) {
  const competition = summary.header?.competitions?.[0];
  if (!competition || String(summary.header.id) !== option.id || competition.playByPlaySource !== "full") {
    throw new Error("Replay requires the complete game summary");
  }
  const base = normalizeGame({ id: option.id, date: competition.date, competitions: [competition] }, option);
  if (!base) throw new Error("Replay team is missing from the game");
  const drives = [...(summary.drives?.previous ?? []), summary.drives?.current].filter(Boolean);
  const byId = new Map();
  for (const drive of drives) for (const play of drive.plays ?? []) {
    if (play.id && play.text) byId.set(String(play.id), { play, drive });
  }
  const ordered = [...byId.values()].sort((a, b) => comparePlays(a.play, b.play));
  const teamIds = competition.competitors.map((team) => String(team.team.id));
  const visible = new Set();
  return ordered.map(({ play, drive }, index) => {
    const before = ordered[index - 1]?.play;
    const after = ordered[index + 1]?.play;
    // A provider revision can attach a later wallclock and score to an earlier
    // non-scoring play. Correct only an isolated outlier surrounded by the same
    // score within the same period; never expose the later score in the replay.
    const staleScore = !play.scoringPlay && before && after
      && before.period?.number === play.period?.number && after.period?.number === play.period?.number
      && Number.isFinite(Date.parse(play.wallclock)) && Number.isFinite(Date.parse(after.wallclock))
      && Date.parse(play.wallclock) > Date.parse(after.wallclock)
      && Number.isFinite(before.homeScore) && Number.isFinite(before.awayScore)
      && before.homeScore === after.homeScore && before.awayScore === after.awayScore;
    const homeScore = staleScore ? before.homeScore : play.homeScore;
    const awayScore = staleScore ? before.awayScore : play.awayScore;
    visible.add(String(play.id));
    const prefix = (item, completed) => ({ ...item,
      plays: (item.plays ?? []).filter((entry) => visible.has(String(entry.id))),
      displayResult: completed ? item.displayResult : null,
      description: completed ? item.description : null,
      yards: completed ? item.yards : null,
      timeElapsed: completed ? item.timeElapsed : null,
    });
    const previous = drives.filter((item) => item !== drive).map((item) => prefix(item, true)).filter((item) => item.plays.length);
    const snapshot = {
      header: { ...summary.header, competitions: [{
        ...competition,
        competitors: competition.competitors.map((team) => ({ ...team,
          score: String(team.homeAway === "home" ? homeScore : awayScore) })),
        status: { period: play.period.number, displayClock: play.clock.displayValue,
          type: { state: index === ordered.length - 1 ? "post" : "in", completed: index === ordered.length - 1, detail: "Replay" } },
      }] },
      gameInfo: summary.gameInfo,
      scoringPlays: (summary.scoringPlays ?? []).filter((entry) => visible.has(String(entry.id))),
      drives: { current: prefix(drive, String(play.id) === String(drive.plays?.at(-1)?.id)), previous },
    };
    const game = enrichGame(base, snapshot);
    let event = gameHighlights([play], snapshot.scoringPlays, teamIds)[0] ?? null;
    // College summaries may label a play Penalty but omit structured penalty
    // metadata. Only use the explicitly reported penalty play as a fallback.
    if (!event && play.type?.text === "Penalty" && !play.penalty) {
      const description = play.text.match(/\bPENALTY\s+\S+\s+(.+?)(?:\s*\([^)]*\))?\s+(\d+)\s+yards\b/i);
      event = { id: String(play.id), kind: "penalty", teamId: null,
        penaltyType: description?.[1] ?? "Penalty", penaltyYards: description ? Number(description[2]) : null };
    }
    return {
      team: game.selectedTeam, league: option.league, season: summary.header.season?.year ?? "REPLAY",
      timeZone: "America/Chicago", caption: play.text, spotlight: game,
      event,
    };
  });
}
