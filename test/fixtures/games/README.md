# Complete game fixtures

Five NFL and five NCAAF **complete, unmodified ESPN summary responses**,
gzip-compressed to keep the repository small. Each includes every reported drive
and play, scoring plays, team data, box scores, and all other returned fields.
`manifest.json` records source/game URLs, capture times, SHA-256 hashes of the
uncompressed responses, final scores, drive/play counts, periods, and play types.

## Saved games

NFL (2026):
- Patriots–Bears, October 22 — **401873010**, 180 plays (requested example).
- Giants–Texans, October 25 — **401873016**, 182 plays, overtime.
- Bengals–Ravens, October 25 — **401873012**, 170 plays.
- Packers–Lions, October 25 — **401873020**, 183 plays, blocked field goal and fumbles.
- Chiefs–Seahawks, October 25 — **401873022**, 173 plays.

NCAAF (October 24, 2026):
- Ole Miss–Texas — **401856732**, 215 plays (requested example).
- BYU–UCF — **401856835**, 194 plays, double overtime.
- Indiana–Michigan — **401858496**, 174 plays, overtime and reused play sequences.
- Texas A&M–Alabama — **401856727**, 180 plays, interception-return touchdown.
- Tennessee–South Carolina — **401856731**, 198 plays.

Total: **1,849 unique plays**. The corpus includes holding, false starts,
pass interference, roughing the passer, offsetting penalties, intentional
grounding, nullified plays, sacks, interceptions, own/opponent fumble recoveries,
punts/returns, missed/blocked field goals, touchdowns with bundled XP/two-point
attempts, timeouts, and period/game endings. It does not contain every possible
event; synthetic tests still cover separate extra points, safeties, blocked punts,
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
Some play sequences are duplicated or reset: the Indiana–Michigan overtime end
marker has sequence `42`, while the preceding OT play is `158`. Period and
wallclock ordering keep the recent-play display chronological without modifying
the saved source. End-period entries must not invent a live ball position.

To inspect a complete response:

```sh
gunzip -c test/fixtures/games/nfl/401873010.json.gz
```

To deliberately replace all ten snapshots with fresh provider responses:

```sh
node scripts/capture-game-fixtures.js
```

That maintenance script is network-dependent, validates complete play-by-play,
and rewrites the manifest/hashes. It is not part of the tests or app startup.
These fixtures are test samples, not an open-data license or a production feed;
see [data-source access limitations](../../../docs/data-sources.md).
