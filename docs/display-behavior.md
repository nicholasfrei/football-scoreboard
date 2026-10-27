# Display behavior

[Documentation](README.md) · [Choose your team](configuration.md)

## Games and updates

The app prioritizes a live game for the selected team. Between games, it shows
the most recent final and previews the next matchup. **24 hours before kickoff**,
the upcoming matchup replaces the final and shows a ticking **HH:MM:SS** countdown
in the score area, beginning at `24:00:00`. It ticks locally every second without
extra feed requests. At zero it waits at `00:00:00` until ESPN confirms play, then
restores the score. Unknown/TBD, postponed, and canceled kickoffs do not get a
countdown. If only an upcoming game is available, it can display that game instead.
The season is fetched
dynamically; no particular matchup is hard-coded.

The browser polls every **five minutes** normally, switching to **15 seconds**
starting **five minutes before kickoff**, including while waiting for ESPN's
live status. It keeps that cadence throughout play, halftime, overtime, and
temporary delays/suspensions, returning to normal after a final. The manual
refresh button still works. Requests never overlap; a slow request can delay
the next poll. Returning to the tab refreshes immediately.
The server caches between-games responses for up to 20 seconds (shorter at timing
boundaries), bypasses that cache during rapid polling, and shares concurrent feed
requests. These are application refresh intervals, not a provider latency
guarantee; the feed may lag TV or radio.

If a refresh fails after a successful load, cached data is marked stale and
the live ball is hidden. If only the game summary fails, scores can still
update without play-by-play. Caches are in memory: restarting while offline
does not preserve the previous game data.

## Teams, records, and the field

- The **away team is always on the left**, and the **home team is on the right**,
  including their scores.
- The header follows your selected team. Midfield displays the designated home
  team's logo. The left end zone uses the away team's color and mascot; the right
  uses the home team's color and mascot. Green
  primary colors remain green in the end zones. White Graduate lettering leaves
  clear margins on all sides. Both end-zone
  names share a uniform scale without stretching the font, with a dark
  outline for bright backgrounds. Neutral-site
  games explicitly identify the designated home team.
- Opponents are resolved dynamically by ESPN team ID, including NFL and college
  FBS/FCS teams. No opponent-specific code change is needed. Team metadata is
  cached for 24 hours for college teams and one minute for NFL teams (whose metadata
  includes current division standings), with schedule/cached fallbacks during outages.
  Team and conference cache keys include the league to keep overlapping IDs separate.
- W–L records appear without the word “Overall.” College teams retain conference
  records when supplied, for example `3-5 (1-4 SEC)`. NFL teams show the provider's
  current division standing, for example `2-4 · 2nd in NFC East`, instead of a
  conference record. When team metadata only reports a conference position, the
  app uses ESPN's published division-table order for that season, cached for one
  minute. Missing/incomplete division standings are omitted, never inferred from wins.
  The NFL record tooltip identifies the standing as current; historical matchup
  records still take precedence over current W–L records. NFL records can include ties.
- College matchup rankings from 1–25 appear before team names when ESPN supplies
  them. These are event rankings, not a separately selected AP/CFP poll. NFL
  teams, missing/unranked values, and ESPN's `99` sentinel have no rank badge.

The field is a **schematic**, not a replica of stadium paint or a video feed.
The fixed diagram direction is away offense → and home offense ←; it does not
guess real stadium direction or switch ends each quarter. The ball moves to
reported play positions, not continuously with players. Completed games show
the last plays with no live ball. The scoreboard identifies the home team and
venue above the field; the field itself has no duplicate heading.

The brown, white-laced football is centered across the field's width, and the
**blue line** marks the reported ball spot. The approaching offense's red zone is
tinted red when the ball is at or inside the opponent's 20-yard line. The field fills its panel;
possession/down/yard-line details sit beneath the score.
Alternating ten-yard grass bands start at the goal line and line up with the
numbered yard lines, stopping before the end zones.
A **yellow line** marks the line to gain when the feed supplies a valid down
and distance. It resets after a first down and stops at the goal line for
goal-to-go situations. Both markers are hidden when the feed is stale or offline.
The caption under the score shows possession, down/distance, and the
yard-line spot (for example, `Arkansas · 4th & 4 · VAN 28`). Only the possessing
team's name has a team-colored background box; fourth-down text stays red on the
plain caption background. A football beside the
possessing team's score appears between its score and team name. The football
icons are 1.5× their original size (33px desktop, 24px tablet, 21px phone).
Possession indicators are hidden when possession is unknown, the game is not live, or the
feed is stale or offline.

The field caption omits the “last reported play” suffix; source metadata remains
in the data model. During a fresh-feed timeout or temporary position gap, the
display holds the last confirmed ball spot, possession, and line to gain rather
than hiding them or jumping to a timeout marker's placeholder yardage. A timeout
shows **TIMEOUT** beside the retained position. If there is no confirmed
spot yet, the waiting caption is **TIMEOUT · awaiting ball position**;
this is a display waiting state, not confirmation of a TV commercial break.
New confirmed spots still update immediately, including penalty enforcement.
Scores, new drives, confirmed possession changes, and kick/turnover events
prevent an old spot from carrying forward across a football-state change.
Scoring plays clear the markers until the next confirmed spot. Stale/offline
feeds and unavailable game summaries discard held positions; returning online
without a new spot does not resurrect the old one. A game/league switch, final,
or reload also clears this browser-only memory. Within a current drive, the
adapter can recover a real spot before timeout/period markers, but never from
an earlier drive or across a scoring play/kickoff.

During live games and the drive demo, the quarter and game clock are centered
**above the score**. Kickoff date/time, venue and broadcast share a single row at
the top left in the same font. Halftime replaces `Q2 · 0:00`. Overtime
uses `OT1`, `OT2`, and so on. The upper clock is hidden for scheduled/final games
and when the feed is stale or offline.

See [branding sources](branding.md) for artwork, verified college overrides,
and fallback behavior, including Graduate's open font license. The end-zone
font is bundled locally; the rest of the display uses system fonts. No external
font download is required at runtime.

## Next matchup and broadcasts

Outside live play, Next Up shows kickoff details, the listed TV/streaming network, and compact
win-chance percentages from **ESPN Analytics' Matchup Predictor**, matched by
team ID. These are **pregame model probabilities**, not betting odds or a
live win-probability graph. Missing or invalid values show as unavailable;
the app does not infer percentages. NFL values may not total 100% because
of a tie probability.
During a live game, this space instead compares passing, rushing, and receiving
yardage leaders side by side: away on the left, home on the right, with team
logos and one line per leader: headshot, name and position, completions/attempts
or carries or receptions, yards, touchdowns, plus confirmed interceptions and
fumbles when present in the box score.
Headshots sit at the outside edges; each team's numbers sit beside its name.

The gamecast shows every reported play in the current drive, newest first, its
provider drive summary, and drive history at the bottom of the same scrolling play panel. Select
a drive in that history to read its plays; a left-side Current drive button appears
only while browsing an older drive and restores automatic following. Only older
drives display a small team/result title above the plays/yards/possession-time summary.
Penalty plays use gold text and a flag. Scoring plays use the scorer's primary
team color on a light background so dark team colors remain legible; attribution
comes from ESPN's scoring-play team rather than the drive's offense.

Broadcast listings also appear beside the displayed game's date and venue.
Unannounced networks show `TBD`. Listings may change and do not include local
cable channel numbers.

## Big-play takeovers

New live interceptions, fumble recoveries, sacks, tackles for loss, accepted
penalties, made field goals, and safeties briefly replace the main score panel
for **12 seconds**. Penalties use the same dark fade as other takeovers, tinted
yellow, with the infraction as the headline and enforced yardage below only
when reported. The app does not guess the penalized team;
declined and offsetting penalties do not alert.
Touchdowns remain for up to **five minutes**, ending earlier when the confirmed
ball position changes. **First downs** show for **25 seconds**; **made extra points**
show a kick through the uprights for **6 seconds**. Made field goals use the
same kick animation. **Punts** show a football flight for **4 seconds**;
**blocked punts** show a deflected football for **12 seconds**. The
event uses the scoring/recovering team's logo and color when attribution is
known. The event and team share a headline (for example, `TOUCHDOWN DALLAS`),
wrapping when needed on narrow screens or for long team names.
A pick-six produces one touchdown takeover, not two alerts. Scores
continue updating underneath. Touchdowns show the current game score instead of
“+6” (for example, `DAL 20-17 PHI`, selected team first). An active live touchdown
takeover also updates that score on refresh without restarting its timer.

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
on TV. Live polling remains every 15 seconds.

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

Automated tests cover live situation behavior with synthetic data and replay
**five full NFL and five full NCAAF games**, with 1,849 saved plays and both
teams' perspectives. They exercise penalties, nullified plays, turnovers,
missed/blocked field goals, bundled conversions, period changes, and overtime.
The [complete fixtures](../test/fixtures/games/README.md) are historical summary
responses, not recordings of the live API or every possible football event.
Replays reconstruct current-drive prefixes and scores; they cannot validate
upstream live situations, corrections, or delivery latency. Those checks do not
replace a real live-game acceptance test. Before installing a permanent display,
verify possession changes, both sides of midfield, quarter changes/overtime,
scoring events, and final-state behavior against ESPN's Gamecast.
