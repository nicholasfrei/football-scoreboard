import { getScoreboard, getTeamChoice } from "./espn.js";
import { createScoreboardCache } from "./scoreboard-cache.js";

export function teamSelectionKey(config) {
  return `${config.league}:${config.teamKey}`;
}

/** Only configured teams can be requested; every team has its own feed/cache. */
export function createTeamSelection(config, { load = getScoreboard, lookup = getTeamChoice } = {}) {
  const defaultKey = teamSelectionKey(config);
  const configurations = new Map([[defaultKey, config]]);
  const choices = new Map();
  for (const team of config.favorites ?? []) {
    const key = teamSelectionKey(team);
    configurations.set(key, team);
    const slug = new URL(team.teamUrl).pathname.split("/").filter(Boolean).at(-1);
    const name = slug === team.teamKey ? key : slug.replaceAll("-", " ");
    choices.set(key, { key, name: team.name ?? name, mascot: team.mascot ?? team.name ?? name, logo: team.logo });
  }
  // Preserve access to the original team even when favorites do not include it.
  if (choices.size && !choices.has(defaultKey)) {
    const slug = new URL(config.teamUrl).pathname.split("/").filter(Boolean).at(-1);
    const name = slug.replaceAll("-", " ");
    choices.set(defaultKey, { key: defaultKey, name, mascot: "Default team", logo: null });
  }
  const loaders = new Map([...configurations].map(([key, team]) =>
    [key, createScoreboardCache(() => load({ config: team }))]));
  const metadata = new Map();
  return {
    catalog: { defaultKey, teams: [...choices.values()] },
    async getCatalog() {
      const teams = await Promise.all([...choices.values()].map(async (choice) => {
        const team = configurations.get(choice.key);
        if (team.name && team.mascot && team.logo) return choice;
        if (!metadata.has(choice.key)) {
          metadata.set(choice.key, Promise.resolve().then(() => lookup(team)).catch(() => {
            metadata.delete(choice.key);
            return null;
          }));
        }
        const resolved = await metadata.get(choice.key);
        return resolved ? {
          key: choice.key, name: team.name ?? resolved.name,
          mascot: team.mascot ?? resolved.mascot, logo: team.logo ?? resolved.logo,
        } : choice;
      }));
      return { defaultKey, teams };
    },
    get(key = defaultKey) { return loaders.get(key); },
  };
}
