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
  designated home team's logo, primary color, location, and mascot. If the home
  primary color is green (including dark green/green-teal), end zones use its
  alternate color to stand out from the turf, with contrasting lettering. Neutral-site
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
the last plays with no live ball. The field heading identifies the home team
(or designated home team for a neutral-site game).

The brown, white-laced football is centered across the field's width, and the
**blue line** marks the reported ball spot. The field fills its panel beneath
the venue heading; possession/down/yard-line details sit beneath the score.
A **yellow line** marks the line to gain when the feed supplies a valid down
and distance. It resets after a first down and stops at the goal line for
goal-to-go situations. Both markers are hidden when the feed is stale or offline.
The 11px caption under the score shows possession, down/distance, and the
yard-line spot (for example, `Arkansas · 4th & 4 · VAN 28`); fourth-down text is red. A football beside the
possessing team's score appears between its score and team name. Possession
indicators are hidden when possession is unknown, the game is not live, or the
feed is stale or offline.

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
and safeties briefly replace the main score panel for **12 seconds**.
**First downs** show a celebration for **4 seconds**; **made extra points**
show a kick through the uprights for **6 seconds**. Made field goals use the
same kick animation. **Punts** show a football flight for **4 seconds**;
**blocked punts** show a deflected football for **12 seconds**. The
event uses the scoring/recovering team's logo and color when attribution is
known. A pick-six produces one touchdown takeover, not two alerts. Scores
continue updating underneath.

Takeovers use structured ESPN play types and IDs/sequences:

- First downs require a confirmed new series on the same possession using
  start/end down metadata for a rush, completed pass, or penalty. Kickoffs,
  possession changes, and nullified plays do not trigger a first-down alert.
- Extra points require a separate confirmed made-XP play. Some ESPN feeds bundle
  the kick into the touchdown entry; those produce only the touchdown alert.
  The app does not infer an XP from a score change or touchdown commentary.
- Punts identify the punting team from the play's starting possession, while
  the scoreboard football follows the receiving team's possession. Blocked
  punts identify the blocking team as the opponent of the confirmed punting
  team, independently of which team recovers. Missing attribution stays unknown.
  A punt return or blocked punt scored as a touchdown produces one TD takeover.

- Loading the page, switching games, recovering from an outage, or returning
  after a polling gap establishes a silent baseline. Old plays are not replayed.
- Final games never trigger live takeovers. Repeated polls do not restart a timer.
- If several new events arrive in one poll, only the newest is shown. A newer
  event can replace one already on screen.
- Events with upstream timestamps older than two minutes are skipped.
- A fresh feed that removes/corrects the event, a game ending, or an unavailable
  feed clears the active live takeover.

The animation timer starts when the app **receives** the new play, not when it happens
on TV. Polling remains every 30 seconds.

### Watch a complete drive demo

Open [Drive demo](http://localhost:4173/?demo=drive) with the server running.
This is an **offline, fictional Cowboys–Eagles NFL game**, independent
of your configured team and the ESPN feed. It uses the actual scoreboard,
field, and highlight renderer with simulated scores and plays.

The 31-step sequence shows a 75-yard touchdown drive, first downs, a separate
extra-point attempt from the NFL 15-yard line, kickoff returns/possession changes,
and Philadelphia's drive ending in a 45-yard field goal. Dallas then punts, and
later blocks an Eagles punt and recovers it at PHI 28. Scores advance from
0–0 to 6–0, 7–0, then 7–3 (Dallas first).

- **Pause / Play** stops or resumes advancing through plays.
- **Next play** pauses playback and advances one step.
- **Replay** resets the scores and starts the sequence again.
- **Speed** selects 1× (five seconds per step) or 2× playback.
- **Live scoreboard** returns to your configured team and normal polling.

Demo celebrations are shortened to leave the updated score visible between
plays. Pausing holds the play; an active celebration still finishes its timer.
The sequence stops at the end. Reduced-motion preferences disable movement
while retaining the event labels and score changes.

### Preview without a live game

With the server running on its default port, open:

- [Touchdown](http://localhost:4173/?preview=touchdown)
- [Interception](http://localhost:4173/?preview=interception)
- [Fumble](http://localhost:4173/?preview=fumble)
- [Field goal](http://localhost:4173/?preview=field-goal)
- [Safety](http://localhost:4173/?preview=safety)
- [First down](http://localhost:4173/?preview=first-down)
- [Extra point](http://localhost:4173/?preview=extra-point)
- [Punt](http://localhost:4173/?preview=punt)
- [Blocked punt](http://localhost:4173/?preview=blocked-punt)

Previews are labeled **DEMO · NOT A LIVE PLAY**, use the live event durations above, and do not
change scores or underlying game data. They need a game to load from the feed;
they are not an offline demo. Reload the URL to play one again.

## Validation limits

Automated tests cover live situation behavior with synthetic data. Completed-game
play-by-play has also been checked against the provider. Those checks do not
replace a real live-game acceptance test. Before installing a permanent display,
verify possession changes, both sides of midfield, quarter changes/overtime,
scoring events, and final-state behavior against ESPN's Gamecast.
