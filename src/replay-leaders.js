// Completed ESPN summaries have final box scores, not historical player stats.
// Reconstruct the three displayed categories from each recorded NFL play.
const CATEGORIES = {
  passing: "passingYards",
  rushing: "rushingYards",
  receiving: "receivingYards",
};

// The box score omits positions, and the final leader list covers only six
// athletes. These other recorded Cowboys–Eagles leaders need a local fallback.
const REPLAY_POSITIONS = new Map([
  ["4360967", "TE"], // Brevyn Spann-Ford
  ["5083754", "WR"], // Ryan Flournoy
  ["4241372", "WR"], // Hollywood Brown
]);

function roster(summary) {
  return new Map((summary.boxscore?.players ?? []).map((team) => [String(team.team.id),
    Object.fromEntries(Object.keys(CATEGORIES).map((category) => [category,
      (team.statistics?.find((group) => group.name === category)?.athletes ?? []).map(({ athlete }) => athlete),
    ])),
  ]));
}

function playerFor(players, abbreviation) {
  if (!abbreviation) return null;
  const [, initial, surname] = /^([A-Z])\.([\w-]+)$/.exec(abbreviation) ?? [];
  if (!surname) return null;
  const matches = players.filter((athlete) => athlete.displayName?.split(" ").at(-1)?.toLowerCase() === surname.toLowerCase());
  return matches.find((athlete) => athlete.displayName[0] === initial) ?? (matches.length === 1 ? matches[0] : null);
}

function leader(athlete, teamId, category, stats, positions) {
  if (!athlete || !stats) return null;
  const attempts = category === "passing" ? `${stats.completions}/${stats.attempts}`
    : `${stats.attempts} ${category === "rushing" ? "CAR" : "REC"}`;
  return {
    teamId, name: athlete.displayName, shortName: athlete.shortName ?? athlete.displayName,
    position: athlete.position?.abbreviation ?? positions.get(String(athlete.id)) ?? null,
    headshot: /^https:\/\//.test(athlete.headshot?.href ?? "") ? athlete.headshot.href : null,
    value: `${stats.yards} YDS`, yards: stats.yards, attempts,
    touchdowns: stats.touchdowns, interceptions: category === "passing" ? stats.interceptions : null,
    fumbles: null,
  };
}

export function createReplayLeaderTracker(summary) {
  const teams = roster(summary);
  const positions = new Map([...REPLAY_POSITIONS, ...(summary.leaders ?? []).flatMap((team) =>
    (team.leaders ?? []).flatMap((group) => (group.leaders ?? []).map(({ athlete }) =>
      [String(athlete.id), athlete.position?.abbreviation ?? null])))]);
  const totals = new Map();
  const get = (teamId, category, athlete) => {
    const key = `${teamId}:${category}:${athlete.id}`;
    if (!totals.has(key)) totals.set(key, { yards: 0, attempts: 0, completions: 0, touchdowns: 0, interceptions: 0 });
    return totals.get(key);
  };

  function observe(play) {
    const teamId = String(play.start?.team?.id ?? play.teamParticipants?.find((item) => item.type === "offense")?.id);
    const team = teams.get(teamId);
    const type = play.type?.text ?? "";
    const text = play.text ?? "";
    // A penalty can be attached to a valid play; only disregard explicitly nullified plays.
    if (team && !/\bNo Play\b|\bTOUCHDOWN NULLIFIED\b/i.test(text) && !/\bPenalty\b/i.test(type)) {
      const passer = playerFor(team.passing, text.match(/\b([A-Z]\.[\w-]+) pass\b/i)?.[1]);
      const completed = /Pass Reception|Passing Touchdown/i.test(type);
      const intercepted = /Pass Interception/i.test(type);
      const incomplete = /Pass Incompletion/i.test(type);
      if (passer && (completed || intercepted || incomplete)) {
        const stats = get(teamId, "passing", passer);
        stats.attempts++;
        if (completed) {
          stats.completions++;
          stats.yards += play.statYardage;
          if (play.scoringPlay) stats.touchdowns++;
        }
        if (intercepted) stats.interceptions++;
      }
      if (completed) {
        const receiver = playerFor(team.receiving, text.match(/\bpass\b[^.]*?\bto ([A-Z]\.[\w-]+)\b/i)?.[1]);
        if (receiver) {
          const stats = get(teamId, "receiving", receiver);
          stats.attempts++;
          stats.yards += play.statYardage;
          if (play.scoringPlay) stats.touchdowns++;
        }
      }
      if (/\bRush\b|Rushing Touchdown/i.test(type)) {
        const runner = playerFor(team.rushing, text.match(/\b([A-Z]\.[\w-]+) (?:scrambles?|rushes?|(?:up the middle|left |right ))/i)?.[1]);
        if (runner) {
          const stats = get(teamId, "rushing", runner);
          stats.attempts++;
          stats.yards += play.statYardage;
          if (play.scoringPlay) stats.touchdowns++;
        }
      }
    }
    return Object.entries(CATEGORIES).map(([category, name]) => ({
      category: name,
      leaders: [...teams].flatMap(([id, roster]) => {
        const athletes = roster[category];
        const ranked = athletes.map((athlete) => ({ athlete, stats: totals.get(`${id}:${category}:${athlete.id}`) }))
          .filter(({ stats }) => stats?.attempts)
          .sort((a, b) => b.stats.yards - a.stats.yards);
        return ranked.length ? [leader(ranked[0].athlete, id, category, ranked[0].stats, positions)] : [];
      }),
    }));
  }
  return { observe, statsFor: (teamId, category, athleteId) => totals.get(`${teamId}:${category}:${athleteId}`) ?? null };
}
