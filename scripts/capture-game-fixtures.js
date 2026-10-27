// Explicit maintenance command, never run by npm test. Append complete ESPN
// summaries by league:ID without replacing the existing historical snapshots.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

const root = new URL("../test/fixtures/games/", import.meta.url);
const existing = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
const args = process.argv.slice(2);
const refresh = args.length === 1 && args[0] === "--refresh-all";
if (!args.length) throw new Error("Specify nfl:ID or college-football:ID (or --refresh-all)");
const requested = refresh ? existing.map(({ league, id }) => `${league}:${id}`) : args;
const seen = new Set();
const pending = [];

for (const value of requested) {
  const match = /^(nfl|college-football):(\d+)$/.exec(value);
  if (!match) throw new Error(`Invalid fixture: ${value}`);
  const [, league, id] = match;
  if (seen.has(value) || (!refresh && existing.some((entry) => entry.league === league && entry.id === id))) {
    throw new Error(`Duplicate fixture: ${value}`);
  }
  seen.add(value);
  const source = `https://site.api.espn.com/apis/site/v2/sports/football/${league}/summary?event=${id}`;
  const response = await fetch(source, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${source}: HTTP ${response.status}`);
  const raw = Buffer.from(await response.text());
  const summary = JSON.parse(raw);
  const competition = summary.header?.competitions?.[0];
  const drives = [...(summary.drives?.previous ?? []), summary.drives?.current].filter(Boolean);
  const plays = [...new Map(drives.flatMap((drive) => drive.plays ?? []).map((play) => [play.id, play])).values()];
  const home = competition?.competitors?.find((team) => team.homeAway === "home");
  const away = competition?.competitors?.find((team) => team.homeAway === "away");
  if (String(summary.header?.id) !== id || !competition?.status?.type?.completed
      || competition.playByPlaySource !== "full" || plays.length < 100
      || ![1, 2, 3, 4].every((period) => plays.some((play) => play.period?.number === period))
      || !home?.team?.id || !away?.team?.id || !Number.isFinite(Number(home.score))
      || !Number.isFinite(Number(away.score)) || !summary.boxscore || !summary.gameInfo
      || !summary.scoringPlays?.length || !summary.header.links?.some((link) => link.rel?.includes("summary"))) {
    throw new Error(`${id}: expected a completed game with full play-by-play, teams, scores and box score`);
  }
  const file = `${league}/${id}.json.gz`;
  const entry = {
    id, league, file, name: `${away.team.displayName} at ${home.team.displayName}`,
    source, gameUrl: summary.header.links.find((link) => link.rel.includes("summary"))?.href,
    capturedAt: new Date().toISOString(), sha256: createHash("sha256").update(raw).digest("hex"),
    kickoffAt: competition.date, homeTeamId: home.team.id, awayTeamId: away.team.id,
    homeScore: Number(home.score), awayScore: Number(away.score),
    playCount: plays.length, driveCount: drives.length,
    periods: [...new Set(plays.map((play) => play.period?.number))].sort((a, b) => a - b),
    playTypes: [...new Set(plays.map((play) => play.type?.text).filter(Boolean))].sort(),
  };
  pending.push({ entry, raw });
  console.log(`${league} ${id}: ${entry.name}, ${plays.length} plays, ${raw.length} bytes uncompressed`);
}
for (const { entry, raw } of pending) {
  await mkdir(new URL(`${entry.league}/`, root), { recursive: true });
  await writeFile(new URL(entry.file, root), gzipSync(raw, { level: 9 }));
}
const manifest = refresh ? pending.map(({ entry }) => entry) : [...existing, ...pending.map(({ entry }) => entry)];
await writeFile(new URL("manifest.json", root), `${JSON.stringify(manifest, null, 2)}\n`);
