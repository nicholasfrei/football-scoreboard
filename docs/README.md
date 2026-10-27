# Football Scoreboard documentation

New here? Start with the [project overview and local quick start](../README.md).
You can run the scoreboard on your computer before buying any display hardware.

## Guides

- **[Configuration](configuration.md):** select an NFL or NCAA team, set the time
  zone and port, use a separate config file, and troubleshoot startup.
- **[Display behavior](display-behavior.md):** understand game selection, home/away
  branding, ball position, feed failures, and big-play previews.
- **[Raspberry Pi build](raspberry-pi.md):** choose parts, install the app, enable
  automatic startup, and mount a compact screen safely.

## References

- **[Data sources and access terms](data-sources.md):** what the unofficial ESPN
  feed provides, its limitations, and the original college-football feed research.
- **[Team branding sources](branding.md):** logo provenance, verified college
  color overrides, and how home-field artwork is selected.
- **[Cowboys drive animation](images/cowboys-drive-demo.gif):** the actual app
  playing a fictional Cowboys–Eagles game at 2× speed, including scoring plays,
  punts, and a blocked punt.

## Code map

There is no frontend build step or third-party runtime dependency.

- `server.js` serves the display and `/api/scoreboard`; `src/scoreboard-cache.js`
  caches between-games responses for up to 20 seconds, bypassing the cache for
  pregame/live polling, with shared in-flight requests.
- `config.json` selects the default team and time zone; `src/config.js` validates it.
- `src/espn.js` fetches league-aware schedules, summaries, and team metadata.
- `src/scoreboard.js` selects and normalizes the displayed and next games.
- `src/gamecast.js` normalizes recent plays and possession-aware field positions.
- `src/game-details.js` normalizes broadcast listings and matchup predictors.
- `src/team-stats.js` normalizes rankings, team records, conference metadata, and NFL division standings.
- `src/nfl-standings.js` provides a cached division-table fallback when NFL metadata only supplies a conference position.
- `src/branding.js` contains verified college-team artwork and color overrides.
- `src/highlights.js` normalizes highlight events; `public/highlights.js` tracks
  which new events should be shown by the browser.
- `public/` contains the HTML, CSS, JavaScript, and bundled artwork.
- `public/game-timing.js` shares countdown windows and adaptive refresh timing
  between the browser, game selector, and server cache.
- `public/ball-position.js` holds confirmed spots through fresh-feed timeout/gaps,
  resetting at scores, drive/possession changes, and unavailable feeds.
- `public/demo.js` supplies the offline Cowboys drive sequence; `public/field-branding.js`
  keeps each team's primary end-zone color, including green teams.
- `test/` contains network-independent tests; run them with `npm test`.
- `test/fixtures/games/` holds ten complete compressed ESPN summaries and their
  provenance manifest; `scripts/capture-game-fixtures.js` explicitly refreshes them.

## Before deploying

Read the [feed access limitations](data-sources.md) and
[artwork attribution](branding.md). An endpoint being reachable without a key
does not establish permission to reuse its data. The built-in server is intended
for a trusted local network, not direct exposure to the public internet.
