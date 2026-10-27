# Complete game fixtures

Twenty-five NFL and twenty-five NCAAF **complete, unmodified ESPN summary responses**,
gzip-compressed to keep the repository small. Each includes every reported drive
and play, scoring plays, team data, box scores, and all other returned fields.
`manifest.json` records source/game URLs, capture times, SHA-256 hashes of the
uncompressed responses, final scores, drive/play counts, periods, and play types.

The Cowboys–Eagles game (`nfl/401873009.json.gz`, 187 plays, Dallas 38–21
Philadelphia) is a separate bundled replay source. It is intentionally not in
the fifty-game test corpus manifest; `test/replay.test.js` validates its replay.

## Saved games

NFL (2026):
- Patriots–Bears, October 22 — **401873010**, 180 plays (requested example).
- Giants–Texans, October 25 — **401873016**, 182 plays, overtime.
- Bengals–Ravens, October 25 — **401873012**, 170 plays.
- Packers–Lions, October 25 — **401873020**, 183 plays, blocked field goal and fumbles.
- Chiefs–Seahawks, October 25 — **401873022**, 173 plays.
- Steelers–Saints, October 25 — **401873011**, 168 plays.
- Browns–Titans, October 25 — **401873013**, 183 plays.
- Colts–Vikings, October 25 — **401873014**, 168 plays.
- Buccaneers–Panthers, October 25 — **401873018**, 165 plays, defensive PAT return and muffed-punt recovery.
- Broncos–Cardinals, October 25 — **401873019**, 197 plays.
- Texans–Jaguars, October 18 — **401872996**, 186 plays.
- Bears–Falcons, October 18 — **401872999**, 182 plays.
- Ravens–Browns, October 18 — **401872997**, 183 plays.
- Titans–Colts, October 18 — **401873003**, 180 plays.
- Jets–Patriots, October 18 — **401873001**, 187 plays.
- Saints–Giants, October 18 — **401873000**, 212 plays.
- Panthers–Eagles, October 18 — **401872998**, 199 plays.
- Steelers–Buccaneers, October 18 — **401873002**, 221 plays.
- Cardinals–Rams, October 18 — **401873004**, 187 plays.
- Chargers–Chiefs, October 18 — **401873006**, 178 plays.
- Bills–Raiders, October 18 — **401873005**, 189 plays.
- Cowboys–Packers, October 18 (local) — **401873007**, 206 plays.
- 49ers–Falcons, October 25 — **401873017**, 179 plays.
- Dolphins–Jets, October 25 — **401873015**, 167 plays.
- Rams–Raiders, October 25 — **401873021**, 192 plays.

NCAAF (October 24, 2026 local time):
- Ole Miss–Texas — **401856732**, 215 plays (requested example).
- BYU–UCF — **401856835**, 194 plays, double overtime.
- Indiana–Michigan — **401858496**, 174 plays, overtime and reused play sequences.
- Texas A&M–Alabama — **401856727**, 180 plays, interception-return touchdown.
- Tennessee–South Carolina — **401856731**, 198 plays.
- Texas Tech–Cincinnati — **401856840**, 198 plays.
- Vanderbilt–Kentucky — **401856729**, 154 plays.
- LSU–Auburn — **401856728**, 194 plays.
- Oregon–Illinois — **401858495**, 176 plays.
- USC–Wisconsin — **401858500**, 165 plays.
- Pittsburgh–Miami — **401858274**, 186 plays, safety.
- Michigan State–UCLA — **401858499**, 175 plays.
- Houston–Utah — **401856837**, 173 plays, interception touchback.
- Iowa–Minnesota — **401858497**, 176 plays.
- Boise State–Washington State — **401860907**, 174 plays.
- California–SMU — **401858270**, 178 plays.
- Rutgers–Northwestern — **401858498**, 171 plays.
- Iowa State–Arizona — **401856838**, 177 plays.
- West Virginia–TCU — **401856841**, 179 plays.
- Rice–Florida Atlantic — **401862809**, 185 plays, safety.
- Western Michigan–Toledo — **401866450**, 194 plays.
- Baylor–Kansas — **401856834**, 200 plays, conversion-only nullification.
- Akron–Kent State — **401866446**, 173 plays.
- Miami (OH)–Central Michigan — **401866476**, 187 plays.
- Oklahoma–Mississippi State — **401856730**, 178 plays.

Total: **9,171 unique plays**. The corpus includes holding, false starts,
pass interference, roughing the passer, offsetting penalties, intentional
grounding, nullified plays, sacks, interceptions, own/opponent fumble recoveries,
punts/returns, missed/blocked field goals, touchdowns with bundled XP/two-point
attempts, a separate defensive two-point conversion, safeties, blocked-punt
touchdowns, timeouts, and period/game endings. It does not contain every possible
event; synthetic tests still cover separate extra points and non-scoring blocked punts,
current live situations, and missing/corrected data.

## Tests and limitations

`npm test` reads these files locally and **never fetches ESPN**. The full-game
tests check file integrity, all four quarters, known final scores through the
API adapter, then every play from both teams' perspectives: recent-play text,
scores, clock/period, ball/line-to-gain bounds, possession, and highlight safety.
Every confirmed spot is also tested with the current drive temporarily omitted
to verify that a feed gap retains the spot without treating older scoring
entries from previous drives as new touchdowns. Timeout and period markers
use the latest real play within the current drive, not placeholder coordinates.

Historical summaries are not archived live polls. The replay builds current-drive
prefixes and header scores from real play data; it cannot prove live situation
availability, polling latency, delivery order, or later provider corrections.
USC–Wisconsin includes revised, untimed duplicate-sequence entries around the
first quarter break; several saved play endpoints also differ from the following
snap by a yard. A separate next-snap spot audit also finds larger discrepancies
on some penalty and punt entries (for example, Iowa–Minnesota `401858497731`
and Rice–FAU `401862809242`). A historical replay cannot use a future snap
to correct a live display; these are source limits and potential fallback work,
not evidence of live-feed timing.
Pittsburgh–Miami incompletion `401858274811` has a named MIA 5 start but numeric
goal-line coordinates that contradict it. Without a trustworthy live situation
the fallback deliberately leaves its ball unavailable rather than guessing.
Some play sequences are duplicated or reset: the Indiana–Michigan overtime end
marker has sequence `42`, while the preceding OT play is `158`. In Texas–Ole
Miss, the Q3 14:58 incompletion has a wallclock timestamp from after the quarter.
The adapter and replay order by period, terminal-marker status, and valid play
sequence, using wallclock and game clock to break reused-sequence ties without
modifying the saved source. Entries without valid sequences use a separate
deterministic fallback group: clock first in regulation and wallclock first in
overtime. This preserves clock corrections and untimed college overtime, while
keeping reused-sequence terminal markers last. End-period entries must not invent a
live ball position. The replay corrects an isolated stale score on a revised
non-scoring play when both adjacent plays confirm the same score.

Independent regression checks record expected play IDs, succeeding spots, and
penalty types/yardage instead of deriving all expectations from the production
sorter or provider endpoints. They cover reused-sequence alerts, 93 individually
transcribed text-only college Penalty plays and 36 enforced fouls attached to
actual plays with live/replay parity. Expanded corpus checks cover all 68
reported kneels (without defensive loss alerts) and 75 confirmed turnovers on
downs. Invalid nullified results and ambiguous blocked-kick endpoints do not
establish ball spots. A timeout misattached to an old drive
cannot revive its earlier possession's endpoint. Controlled adjacent fresh polls
also verify that every newly classified event actually reaches the browser
tracker, separately from historical delivery timing and event-age suppression.
All 1,110 ordinary incompletions with trustworthy starts are independently
checked against their starting scrimmage spot. Texas–Ole Miss play
`401856732698` has a bad goal-line endpoint
and a spurious 70-yard end distance; its valid start confirms MISS 27, and the
replay must show third-and-three there rather than MISS 0.

To inspect a complete response:

```sh
gunzip -c test/fixtures/games/nfl/401873010.json.gz
```

To append a completed game without replacing the existing snapshots:

```sh
node scripts/capture-game-fixtures.js college-football:401856726
```

The example ID is not in this corpus; duplicate IDs are rejected. Supply
multiple `league:ID` arguments to add several games at once.
`--refresh-all` deliberately recaptures every existing game instead. The script
is network-dependent, validates complete play-by-play, and records the source,
capture time, and hash. It is not part of the tests or app startup.
These fixtures are test samples, not an open-data license or a production feed;
see [data-source access limitations](../../../docs/data-sources.md).
