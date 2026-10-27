# Display behavior

[Documentation](README.md) · [Choose your team](configuration.md)

## Games and updates

The display is laid out at a fixed **1920 × 1200 pixels (landscape)**.
It does not grow to fill a larger window or change layout at browser breakpoints.
In a smaller window, the entire canvas scales down uniformly to fit for preview;
its internal spacing and typography remain based on the 1920 × 1200 design.

The app prioritizes a live game for the selected team. Between games, it shows
the most recent final and previews the next matchup. **24 hours before kickoff**,
the upcoming matchup replaces the final and shows a ticking **HH:MM:SS** countdown
in the score area, beginning at `24:00:00`. It ticks locally every second without
extra feed requests. At zero it waits at `00:00:00` until ESPN confirms play, then
restores the score. Unknown/TBD, postponed, and canceled kickoffs do not get a
countdown. If only an upcoming game is available, it can display that game instead.
Game Leaders remain beneath the last completed game when its player stats are
available; the Next Up panel returns when the upcoming matchup takes over for
the countdown. The season is fetched dynamically; no particular matchup is hard-coded.

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
  uses the home team's color and mascot. End zones always use each team's primary
  color, including green teams. White Graduate lettering leaves
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
an earlier drive or across a scoring play. For a touchback or fair catch on
the latest kickoff or punt, it can also use the receiving team's reported end
spot, or derive a spot when the outcome and team are unambiguous. College
kickoff touchbacks and fair catches inside the 25 use the 25; punt touchbacks
use the 20 in both leagues. NFL kickoff touchbacks depend on the season and
how the kick lands; the adapter does not guess when that information is missing.
The explicit college fair-catch spot takes precedence over a contradictory
endpoint. Interception touchbacks start at the receiving team's 20 in either
league when the outcome and team are confirmed.
Punt fair catches remain at the catch spot. A reported live situation takes
priority, including penalty enforcement; ambiguous or penalized kicks do not
get a rule-derived spot.
For a straightforward, unreturned field-goal miss, ESPN sometimes repeats the
line of scrimmage as a placeholder. College uses the previous spot; the NFL
uses the kick spot when the reported kick distance establishes it. Both use a
minimum of the receiving team's 20. The app does not infer a spot for a blocked
kick, a short kick or an ambiguous return; a different reported end spot or a
live situation takes precedence. See NCAA rule 8-4-2 in the
[2026 NCAA rulebook](https://ncaaorg.s3.amazonaws.com/championships/sports/football/rules/PRMFB_RulesBook.pdf).

A nullified play's invalid result coordinates cannot move the ball into the end
zone. A confirmed penalty enforcement can still change the spot; otherwise the
display uses a defensible unchanged spot or waits for confirmation. On blocked
field goals, the kick's ending location is not automatically the next scrimmage
spot. Ambiguous results leave the ball hidden until the feed supplies a reliable
succeeding spot, rather than inventing a blocked-kick placement rule.
When a complete text-only penalty enforcement disagrees with the play's end
coordinates, the fallback uses its reported spot if the field side can be
identified. Conflicting down/distance data is hidden; a valid live situation
still takes priority.

For an ordinary incomplete pass with an invalid or missing result spot, a valid
reported start can establish the unchanged line of scrimmage and distance with
the down advanced. This does not override live situations, penalty enforcement,
or a confirmed change of possession on fourth down.

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
only while browsing an older drive and restores automatic following. Browsing an
older drive hides the current ball, line to gain, and red-zone tint so they do
not look like part of the selected history. Only older
drives display a small team/result title above the plays/yards/possession-time summary.
The 2D field also traces the selected drive from its first confirmed offensive
scrimmage spot. Earlier plays collapse into one static, straight line through
the center of the field up to the latest snap; only that play has its own route.
A run follows a centered dotted line; passes take a centered dotted arc of the
same height regardless of distance or left/right description. Even a catch at
the snap uses a small arc instead of a flat or zero-length flight.
NFL summaries usually supply structured yards after catch. When the reported
gain matches the confirmed start/end spots, the arc ends at the derived catch
yard line and a solid segment shows YAC. College play text usually supplies a
`caught at` spot instead; that spot establishes the catch line and YAC when the
reported gain agrees with the endpoints. Without a reliable split, the arc goes
to the final spot without claiming a catch point.
An incomplete pass uses the reported `thrown to` yard line (including college
team-name aliases) for its centered dotted route and red X. When no reliable
target spot is reported, depth-only `short`/`deep` descriptions (common in NFL)
draw a schematic arc (15/30 yards, clamped to the goal line), not a measured
landing spot; the caption never calls it a reported target or shows `(EST.)`.
Spikes and other passes with no useful depth keep only the X at the snap. The
caption shows a reported target when available and zero gain. It otherwise
identifies the drive start, provider drive summary when available, and latest
tracked play and yards. An interception uses the same fixed-height pass arc
to the reported pick spot and, when its final spot and return yardage agree,
a solid red line back to the defender's final spot. A pick with no return ends
at the catch; a touchback shows the pick in the end zone but no fictitious
runback to the 20. Nullified, overturned, and ambiguous picks do not get an
invented return. An ordinary punt arcs from the snap to ESPN's named
receiving spot after the return, fair catch, or touchback; it does not treat the
first catch as the next possession spot. An ordinary made or missed field goal
arcs to the back of the attacking end zone, not to the subsequent possession.
Blocked, short, nullified and enforced-penalty kicks have no invented full
flight. Kickoffs, timeouts, other turnovers, nullified and penalized results
are not drawn as offensive gains; an unillustrated scrimmage play gets a dashed snap
marker at its reported starting spot. Feed outages hide the illustration.
Opening a replay or completed game draws the selected drive without replaying
old movement. New plays reveal their route once; repeated polls do not restart
the animation, and reduced-motion preferences show the whole route immediately.
Penalty plays use gold text and a flag. Scoring play text uses the scorer's
primary team color; when its contrast against the dark panel is below 4.5:1,
the text gets a white background. Attribution comes from ESPN's scoring-play
team rather than the drive's offense.

Broadcast listings also appear beside the displayed game's date and venue.
Unannounced networks show `TBD`. Listings may change and do not include local
cable channel numbers.

## Big-play takeovers

New live interceptions, fumble recoveries (including recovered muffed punts),
turnovers on downs, sacks, tackles for loss, accepted penalties, separately
recorded defensive two-point conversions, blocked field goals, and blocked punts replace the main score panel
for **15 seconds**. Penalties use the same dark fade as other takeovers, tinted
yellow, with the infraction as the headline and enforced yardage below only
when reported. The app does not guess the penalized team;
declined and offsetting penalties do not alert.
College feeds sometimes omit structured penalty metadata. A complete, unambiguous
enforcement statement on a penalty play or an underlying run, pass, or kick can
still produce the same alert in live mode and replay; ambiguous commentary does
not establish an accepted penalty.
If ESPN explicitly reports intentional grounding in play text without penalty
status, the app treats it as a penalty unless the text says it was declined or
offsetting, even when ESPN labels it a sack. It does not infer penalty yardage.
Touchdowns remain for up to **2 minutes 30 seconds**, ending earlier when the confirmed
ball position changes. **Made field goals and safeties** also show for **2 minutes 30 seconds**.
**First downs** show for **15 seconds**; **made extra points** show a kick through the uprights
for **6 seconds**. Made field goals use the same kick animation. **Punts** show a football
flight for **10 seconds**; blocked punts and field goals show a deflected football. The
event uses the scoring/recovering team's logo and color when attribution is
known. The event and team share a headline (for example, `TOUCHDOWN DALLAS`),
wrapping when needed on narrow screens or for long team names.
A pick-six produces one touchdown takeover, not two alerts. Scores
continue updating underneath. Touchdowns show the current game score instead of
“+6” (for example, `DAL 20-17 PHI`, selected team first). An active live touchdown
takeover also updates that score on refresh without restarting its timer.

Takeovers use structured ESPN play types, stable play IDs, and ordered play history:

- First downs require a confirmed new series on the same possession using
  start/end down metadata for a rush, completed pass, or penalty. Kickoffs,
  possession changes, and nullified plays do not trigger a first-down alert.
- Extra points require a separate confirmed made-XP play. Some ESPN feeds bundle
  the kick into the touchdown entry; those produce only the touchdown alert.
  The app does not infer an XP from a score change or touchdown commentary.
  A separate confirmed defensive PAT return produces its own defensive two-point
  takeover, credited to the scoring defense even if the play has no wallclock.
- Interceptions show the player when explicitly named in the play description;
  if the player is unknown, the app does not invent a name. Tackles for loss
  require a negative rushing gain, preferring reported rushing yardage over
  potentially inconsistent end-zone coordinates.
  Explicit kneel-downs do not trigger defensive tackle-for-loss celebrations.
- Turnovers on downs require a confirmed fourth-down scrimmage play and a change
  to the other team's possession. They show one **TURNOVER ON DOWNS** takeover for
  the gaining team, including when the failed fourth-down play was a sack.
  Kicks, interceptions, fumbles, scores, and nullified plays keep their own rules;
  an absent provider turnover flag does not hide a confirmed change on downs.
- Punts identify the punting team from the play's starting possession, while
  the scoreboard football follows the receiving team's possession. Blocked
  punts identify the blocking team as the opponent of the confirmed punting
  team, independently of which team recovers. Missing attribution stays unknown.
  A punt return or blocked punt scored as a touchdown produces one TD takeover.
  Blocked field goals similarly credit the blocking team, independently of
  recovery, and show the blocker when explicitly reported.

- Loading the page, switching games, recovering from an outage, or returning
  after a polling gap establishes a silent baseline. Old plays are not replayed.
- Final games never trigger live takeovers. Repeated polls do not restart a timer.
- Distinct new plays can alert even when the provider reuses or resets numeric
  sequence values. Play identity and ordering still prevent historical backfills
  from replaying as new events.
- If several new events arrive in one poll, only the newest is shown. A newer
  event can replace one already on screen.
- Events with upstream timestamps older than two minutes are skipped.
- A fresh feed that removes/corrects the event, a game ending, or an unavailable
  feed clears the active live takeover.

The animation timer starts when the app **receives** the new play, not when it happens
on TV. Live polling remains every 15 seconds.

### Watch a complete game replay

Open [Full game replay](http://localhost:4173/?demo=drive) with the server running.
Choose Cowboys–Eagles (187 recorded plays) or Texas–Ole Miss (215 plays).
The saved ESPN summaries play locally without polling the live feed. The field
position is inferred from each play, not a saved historical live situation.
Cowboys–Eagles also reconstructs every player's passing, rushing, and receiving
totals as each play occurs. The displayed leaders change with the game, and
the final totals are checked against the saved box score. These are calculated
replay totals, not archived live-stat snapshots. Home-side stats are ordered
as a mirror image of away-side stats.

- **Pause / Play** stops or resumes advancing through plays.
- **Next play** pauses playback and advances one step.
- **Start over** resets the replay to the first recorded play.
- **Speed** selects 1× (five seconds per step) or 2× playback.
- **Live scoreboard** returns to your configured team and normal polling.

Replay celebrations are shortened to leave the updated score visible between
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
**25 full NFL and 25 full NCAAF games**, with 9,171 saved plays and both
teams' perspectives. They exercise penalties, nullified plays, turnovers,
missed/blocked field goals, bundled conversions, period changes, and overtime.
The [complete fixtures](../test/fixtures/games/README.md) are historical summary
responses, not recordings of the live API or every possible football event.
Replays reconstruct current-drive prefixes and scores; they cannot validate
upstream live situations, corrections, or delivery latency. Those checks do not
replace a real live-game acceptance test. Before installing a permanent display,
verify possession changes, both sides of midfield, quarter changes/overtime,
scoring events, and final-state behavior against ESPN's Gamecast.
