import { readFile } from "node:fs/promises";

export function parseConfig(value) {
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

export const DEFAULT_CONFIG = parseConfig({
  teamUrl: "https://www.espn.com/college-football/team/_/id/8/arkansas-razorbacks",
});

export async function loadConfig(path) {
  try { return parseConfig(JSON.parse(await readFile(path, "utf8"))); }
  catch (error) { throw new Error(`Cannot load scoreboard config ${path}: ${error.message}`); }
}
