// Explicit maintenance command, never run by npm test. Preserves complete ESPN
// summary responses, including every drive/play, box score, and scoring entry.
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

const games = {
  nfl: ["401873010", "401873016", "401873012", "401873020", "401873022"],
  "college-football": ["401856732", "401856835", "401858496", "401856727", "401856731"],
};
const root = new URL("../test/fixtures/games/", import.meta.url);
const manifest = [];
for (const [league, ids] of Object.entries(games)) {
  await mkdir(new URL(`${league}/`, root), { recursive: true });
  for (const id of ids) {
    const source = `https://site.api.espn.com/apis/site/v2/sports/football/${league}/summary?event=${id}`;
    const response = await fetch(source, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`${source}: HTTP ${response.status}`);
    const raw = Buffer.from(await response.text());
    const summary = JSON.parse(raw);
    const competition = summary.header?.competitions?.[0];
    const drives = [...(summary.drives?.previous ?? []), summary.drives?.current].filter(Boolean);
    const plays = [...new Map(drives.flatMap((drive) => drive.plays ?? []).map((play) => [play.id, play])).values()];
    if (String(summary.header?.id) !== id || !competition?.status?.type?.completed
        || competition.playByPlaySource !== "full" || plays.length < 100
        || ![1, 2, 3, 4].every((period) => plays.some((play) => play.period?.number === period))) {
      throw new Error(`${id}: expected a completed game with full four-quarter play-by-play`);
    }
    const file = `${league}/${id}.json.gz`;
    await writeFile(new URL(file, root), gzipSync(raw, { level: 9 }));
    const home = competition.competitors.find((team) => team.homeAway === "home");
    const away = competition.competitors.find((team) => team.homeAway === "away");
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
    manifest.push(entry);
    console.log(`${league} ${id}: ${entry.name}, ${plays.length} plays, ${raw.length} bytes uncompressed`);
  }
}
await writeFile(new URL("manifest.json", root), `${JSON.stringify(manifest, null, 2)}\n`);
