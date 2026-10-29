import { readFile } from "node:fs/promises";

function parseTeamConfig(value) {
  if (!value || typeof value.teamUrl !== "string") throw new Error("Config requires a teamUrl string.");
  let url;
  try { url = new URL(value.teamUrl); }
  catch { throw new Error("teamUrl must be a complete ESPN team URL."); }
  if (url.protocol !== "https:" || !["espn.com", "www.espn.com"].includes(url.hostname)
      || url.username || url.password || url.port) {
    throw new Error("teamUrl must be an https://www.espn.com/ team URL.");
  }
  const match = /^\/(college-football|nfl)\/team\/_\/(id|name)\/([^/]+)(?:\/[^/]+)?\/?$/.exec(url.pathname);
  if (!match) throw new Error("Use an ESPN college-football or NFL team page, not a game or schedule URL.");
  const [, league, kind, key] = match;
  if ((kind === "id" && !/^\d+$/.test(key))
      || (kind === "name" && (league !== "nfl" || !/^[a-z]{2,4}$/i.test(key)))) {
    throw new Error("College teams require /id/<number>; NFL teams accept /name/<abbreviation> or /id/<number>.");
  }
  const timeZone = value.timeZone ?? "America/Chicago";
  if (typeof timeZone !== "string" || !timeZone.trim()) throw new Error("timeZone must be an IANA time-zone name.");
  try { new Intl.DateTimeFormat("en-US", { timeZone }); }
  catch { throw new Error(`Invalid timeZone: ${timeZone}`); }
  return Object.freeze({ teamUrl: url.href, league, teamKey: key.toLowerCase(), timeZone });
}

export function parseConfig(value) {
  const config = parseTeamConfig({ ...value, teamUrl: value?.teamUrl ?? value?.favorites?.[0]?.teamUrl });
  if (value.favorites === undefined) return config;
  if (!Array.isArray(value.favorites)) throw new Error("favorites must be an array of teams.");
  const favorites = value.favorites.map((favorite) => {
    const team = parseTeamConfig({ ...favorite, timeZone: config.timeZone });
    for (const field of ["name", "mascot"]) {
      if (favorite[field] !== undefined && (typeof favorite[field] !== "string" || !favorite[field].trim())) {
        throw new Error(`Favorite ${field} must be a non-empty string.`);
      }
    }
    if (favorite.logo !== undefined) {
      let logo;
      try { logo = new URL(favorite.logo); } catch { throw new Error("Favorite logos must use HTTPS URLs."); }
      if (logo.protocol !== "https:" || logo.username || logo.password) throw new Error("Favorite logos must use HTTPS URLs.");
    }
    return Object.freeze({ ...team, name: favorite.name?.trim(), mascot: favorite.mascot?.trim(), logo: favorite.logo ?? null });
  });
  return Object.freeze({ ...config, favorites: Object.freeze(favorites) });
}

export const DEFAULT_CONFIG = parseConfig({
  teamUrl: "https://www.espn.com/college-football/team/_/id/8/arkansas-razorbacks",
});

export async function loadConfig(path) {
  try { return parseConfig(JSON.parse(await readFile(path, "utf8"))); }
  catch (error) { throw new Error(`Cannot load scoreboard config ${path}: ${error.message}`); }
}
