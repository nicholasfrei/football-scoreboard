# Display behavior

[Documentation](README.md) · [Choose your team](configuration.md)

## Games and updates

The app prioritizes a live game for the selected team. Between games, it shows
the most recent final and previews the next matchup. If only an upcoming game
is available, it can display that game instead. The season is fetched
dynamically; no particular matchup is hard-coded.

The browser polls every **30 seconds** and has a manual refresh button. The
server caches scoreboard responses for 20 seconds and shares concurrent feed
requests. These are application refresh intervals, not a provider latency
guarantee; the feed may lag TV or radio.

If a refresh fails after a successful load, cached data is marked stale and
the live ball is hidden. If only the game summary fails, scores can still
update without play-by-play. Caches are in memory: restarting while offline
does not preserve the previous game data.

## Teams, records, and the field

- The **away team is always on the left**, and the **home team is on the right**,
  including their scores.
- The header follows your selected team. Midfield and both end zones use the
  designated home team's logo, primary color, location, and mascot. Neutral-site
  games explicitly identify the designated home team.
- Opponents are resolved dynamically by ESPN team ID, including NFL and college
  FBS/FCS teams. No opponent-specific code change is needed. Team metadata is
  cached for 24 hours, with available schedule/cached fallbacks during outages.
  Team and conference cache keys include the league to keep overlapping IDs separate.
- Overall records appear when supplied; conference records and conference names
  appear only when available. Historical matchup records take precedence over
  current records. NFL records can include ties.
- College matchup rankings from 1–25 appear before team names when ESPN supplies
  them. These are event rankings, not a separately selected AP/CFP poll. NFL
  teams, missing/unranked values, and ESPN's `99` sentinel have no rank badge.

The field is a **schematic**, not a replica of stadium paint or a video feed.
The fixed diagram direction is home offense → and away offense ←; it does not
guess real stadium direction or switch ends each quarter. The ball moves to
reported play positions, not continuously with players. Completed games show
the last plays with no live ball. The footer labels the selected team's
HOME/AWAY status, or NEUTRAL SITE.

See [branding sources](branding.md) for artwork, verified college overrides,
and fallback behavior. The display uses system fonts; no external font
download is required.

## Next matchup and broadcasts

Next Up shows kickoff details, the listed TV/streaming network, and compact
win-chance percentages from **ESPN Analytics' Matchup Predictor**, matched by
team ID. These are **pregame model probabilities**, not betting odds or a
live win-probability graph. Missing or invalid values show as unavailable;
the app does not infer percentages. NFL values may not total 100% because
of a tie probability.

Broadcast listings also appear beside the displayed game's date and venue.
Unannounced networks show `TBD`. Listings may change and do not include local
cable channel numbers.

## Big-play takeovers

New live touchdowns, interceptions, fumbles/recoveries, made field goals,
and safeties briefly replace the main score panel for **12 seconds**. The
event uses the scoring/recovering team's logo and color when attribution is
known. A pick-six produces one touchdown takeover, not two alerts. Scores
continue updating underneath.

Takeovers use structured ESPN play types and IDs/sequences:

- Loading the page, switching games, recovering from an outage, or returning
  after a polling gap establishes a silent baseline. Old plays are not replayed.
- Final games never trigger live takeovers. Repeated polls do not restart a timer.
- If several new events arrive in one poll, only the newest is shown. A newer
  event can replace one already on screen.
- Events with upstream timestamps older than two minutes are skipped.
- A fresh feed that removes/corrects the event, a game ending, or an unavailable
  feed clears the active live takeover.

The 12 seconds start when the app **receives** the new play, not when it happens
on TV. Polling remains every 30 seconds.

### Preview without a live game

With the server running on its default port, open:

- [Touchdown](http://localhost:4173/?preview=touchdown)
- [Interception](http://localhost:4173/?preview=interception)
- [Fumble](http://localhost:4173/?preview=fumble)
- [Field goal](http://localhost:4173/?preview=field-goal)
- [Safety](http://localhost:4173/?preview=safety)

Previews are labeled **DEMO · NOT A LIVE PLAY**, last 12 seconds, and do not
change scores or underlying game data. They need a game to load from the feed;
they are not an offline demo. Reload the URL to play one again.

## Validation limits

Automated tests cover live situation behavior with synthetic data. Completed-game
play-by-play has also been checked against the provider. Those checks do not
replace a real live-game acceptance test. Before installing a permanent display,
verify possession changes, both sides of midfield, quarter changes/overtime,
scoring events, and final-state behavior against ESPN's Gamecast.
