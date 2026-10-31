// Run manually with `node scripts/audit-fbs-yardline-aliases.js` to re-check the
// recorded games against ESPN. Offline tests use the checked-in evidence only.
import { fbsYardlineAliases } from "../public/fbs-yardline-aliases.js";

const base = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=";
const games = new Map();
const ids = [...new Set(fbsYardlineAliases.map(([, , , , game]) => game))];
let next = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (next < ids.length) {
    const id = ids[next++];
    const response = await fetch(base + id, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`ESPN game ${id}: HTTP ${response.status}`);
    games.set(id, await response.json());
  }
}));

const errors = [];
for (const [id, name, abbreviation, label, event] of fbsYardlineAliases) {
  const game = games.get(event);
  const sides = game.header?.competitions?.[0]?.competitors?.map((side) => side.team) ?? [];
  if (!sides.some((team) => String(team.id) === id && team.abbreviation === abbreviation)) {
    errors.push(`${name}: not ${id}/${abbreviation} in ${event}`);
    continue;
  }
  // Corroborate a play-text label with a *same-play*, same-yard structured
  // position. ESPN's numeric distance and possession ID identify which side
  // that position belongs to, even when its abbreviation differs from prose.
  const yardLine = new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(\\d{1,2})\\b`, "gi");
  const plays = [...(game.drives?.previous ?? []), ...(game.drives?.current ? [game.drives.current] : [])]
    .flatMap((drive) => drive.plays ?? []);
  let corroborated = false;
  for (const play of plays) {
    for (const match of (play.text ?? "").matchAll(yardLine)) {
      const yard = Number(match[1]);
      if (yard >= 50) continue; // 50 does not identify a side.
      for (const spot of [play.start, play.end]) {
        const named = /^(.+?) (\d{1,2})$/.exec(spot?.possessionText ?? "");
        if (Number(named?.[2]) !== yard || !sides.some((team) => String(team.id) === String(spot?.team?.id))) continue;
        const owner = Number(spot.yardsToEndzone) === 100 - yard ? String(spot.team.id)
          : Number(spot.yardsToEndzone) === yard ? String(sides.find((team) => String(team.id) !== String(spot.team.id))?.id) : null;
        if (owner === id) corroborated = true;
      }
    }
  }
  if (!corroborated) errors.push(`${name}: ${label} not corroborated by ${event}`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else console.log(`Verified ${fbsYardlineAliases.length} FBS teams in ${games.size} ESPN game summaries.`);
