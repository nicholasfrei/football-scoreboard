# Data sources and access terms

[Documentation](README.md) · [Display behavior](display-behavior.md)

## What the app uses

Football Scoreboard uses ESPN's publicly reachable, **unofficial** JSON endpoints
for NFL and NCAA schedules, team metadata, game summaries, and matchup details.
No API key is required. Endpoint paths follow this pattern:

```text
https://site.api.espn.com/apis/site/v2/sports/football/{league}/teams/{teamId}
https://site.api.espn.com/apis/site/v2/sports/football/{league}/teams/{teamId}/schedule
https://site.api.espn.com/apis/site/v2/sports/football/{league}/summary?event={eventId}
```

`{league}` is `nfl` or `college-football`. The app discovers game IDs from the
selected team's schedule rather than hard-coding a matchup. Returned fields
vary by game: play-by-play, field position, predictions, broadcasts, and artwork
may be missing. These endpoints have no established support contract, schema
guarantee, or verified live-latency guarantee for this project. The app's
10-second pregame/live (five-minute otherwise) browser polling interval is not a
provider freshness or access guarantee.

### FBS yard-line aliases

`public/fbs-yardline-aliases.js` records a 2026 ESPN game ID, header
abbreviation, and *observed play-text yard-line label* for each of 138 FBS
teams. Labels are not always the header abbreviation: Arizona has `ARIZ` in
event `401856838` and `ARI` in event `401856842`; other feeds use names such
as `Jax St` or `State`. `public/play-trajectory.js` resolves these only for
participants in the current matchup, and rejects labels shared by both teams.
To check the 138 representative observations against ESPN's live summaries,
run `node scripts/audit-fbs-yardline-aliases.js` (90 event requests). The
ordinary test suite uses the recorded evidence and does not make API requests.

## Access and reuse limitations

**A publicly reachable endpoint is not an open-data license.** The original
research below did not establish an openly licensed, supported API for this
custom display. ESPN's linked terms restrict automated access; personal or
noncommercial intent does not itself establish permission. Obtain appropriate
permission or choose an explicitly licensed feed before ongoing custom use.
For ordinary personal viewing, use the provider's own public interface. [3][7][8]

Team artwork also has separate ownership and reuse considerations; see
[branding sources](branding.md). This project is not endorsed by the providers
or teams it displays.

## Background: ESPN and StatBroadcast research

The following college-football comparison was researched **October 26, 2026**,
using provider pages, terms, and first-party responses. It preserves the
Arkansas-based evidence behind the feed selection, not a statement that this
project supports only Arkansas or a fresh verification of every NFL field.
Endpoint observations are snapshots, not an API contract or live latency measurement.

**ESPN's summary response was the stronger technical fit:** structured plays,
possession-team IDs, down/distance, and field position can drive a schematic
football field. This is a technical comparison, not an access/reuse recommendation. [5]

### StatBroadcast and StatMonitr

The [Arkansas calendar](https://www.statbroadcast.com/events/schedule.php?live=0&gid=ark)
belongs to **StatBroadcast**. **StatMonitr** is its media product;
**StatBroadcast Live** is its fan-facing product. The calendar is an event-listing
page, not documented API access. Arkansas's StatMonitr page says feeds are for
working media/event staff and “not meant to be shared with the public viewing
audience”; some require a passcode from on-site media relations. StatBroadcast
requires written consent for custom clients. It is not integrated into this app. [1][2][3]

## Comparison

| Question | StatBroadcast / StatMonitr | ESPN college-football summary / Gamecast |
| --- | --- | --- |
| Public API access | No self-service public developer API documentation or general-purpose API license located in the reviewed first-party pages. The product advertises third-party partner distribution and scoreboard outputs; those are integration offerings, not permission to scrape. [2][3] | Schedule and summary JSON were fetched locally with `curl`, without credentials/API key. No current first-party support contract, schema guarantee, or rate-limit allowance was established for these endpoints. [4][5] |
| Play-by-play | Official football demo showed recent plays with down/distance, drive start/end positions, and drive statistics. This verifies viewer features, not a reusable API schema. [6] | Verified `drives.previous[].plays[]`, including play text, quarter, clock, scores, start/end state, penalties, and turnovers; `scoringPlays[]` is a separate scoring-only list. [5] |
| Field graphic inputs | Demo includes locations such as `UND25` and `UND40`; a supported numeric field-position API was not verified. [6] | Plays expose `start`/`end` objects containing `down`, `distance`, `yardLine`, `yardsToEndzone`, `possessionText`, and `team.id`. These support a schematic ball marker and first-down line when valid. [5] |
| Access terms | Terms updated September 24, 2026 limit ordinary personal use to the standard interface; automated collection, caching/harvesting, custom/API clients, and embedding require consent as specified. Personal/noncommercial intent is not an exemption for custom clients. [3] | ESPN's Play-by-Play footer links Disney terms. Section 2.A grants limited personal/noncommercial use; §2.B.x prohibits automated access/monitoring/copying/extraction without express written permission. No endpoint-specific exception was established. [7][8] |
| Freshness | Product page states public StatBroadcast Live feeds have an intentional **5–10 second delay**, distinguishing media feeds. This is the provider's stated intentional delay, not measured total delivery latency or a guarantee. Terms disclaim timely/uninterrupted service. [2][3] | No verified public end-to-end latency guarantee or polling allowance for the tested endpoints. A completed game response cannot establish live freshness. [5][7] |

## Reproducible ESPN evidence

The [2026 Arkansas schedule][4] identified **401856726**, Arkansas at Vanderbilt on October 17, as the latest completed game at research time. Its [summary][5] reports Arkansas 31–21 Vanderbilt. This is a historical sample, not the current matchup; use schedule-discovered event IDs when inspecting other games.

Observed paths in that summary:

- `header.competitions[0]`: final status, competitors and scores, plus `playByPlaySource: "full"`.
- `drives.previous[].plays[]`: detailed plays, with `id`, `sequenceNumber`, `text`, `period.number`, and `clock.displayValue`.
- Play `40185672612`: starts at `VAN 25` with `down: 1`, `distance: 10`, `yardLine: 25`, `yardsToEndzone: 75`, `team.id: "238"`; ends at `VAN 39` with `yardLine: 39` and `yardsToEndzone: 61`.
- The response's `header.links` supplies both Gamecast and Play-by-Play URLs; ESPN's rendered Play-by-Play page independently shows the matching 14-yard run. [5][8]

**Implementation implications:** treat positions as possession-aware football state, not a literal camera direction or player-tracking coordinate. Validate orientation against both teams and turnovers. Prefer a verified live situation when available; this final-game sample had no top-level `situation` or `drives.current`, so their live presence/shape remains unverified. Historical play endpoints can support replay or a clearly labeled last-play view, but must not silently become “current possession” after a final. Treat absent fields as unknown. Any refresh interval is an application choice, not proof of provider freshness or permission to poll.

## Primary sources

1. [Arkansas StatMonitr page](https://www.statbroadcast.com/events/statmonitr.php?gid=ark) — audience/access notice and calendar link.
2. [StatBroadcast platform overview](https://www.statbroadcast.com/stats.php) — product names, integrations, scoreboard outputs, public-feed delay footnote.
3. [StatBroadcast terms](https://www.statbroadcast.com/terms.php) — access restrictions and availability disclaimer.
4. [ESPN Arkansas 2026 schedule][4] — observed event discovery.
5. [ESPN summary, event 401856726][5] — observed JSON fields.
6. [Official StatBroadcast demos](https://www.statbroadcast.com/demos.php) → [football fan demo](https://stats.statbroadcast.com/broadcast/?id=1), which redirected in the research browser to the [mobile demo](https://stats.statbroadcast.com/mobile/?id=1); displayed Ohio State 34–23 Notre Dame, final.
7. [Disney/ESPN US terms](https://disneytermsofuse.com/english/) — §§2.A, 2.B.x, 3.A, and 6.
8. [ESPN Arkansas–Vanderbilt Play-by-Play](https://www.espn.com/college-football/playbyplay/_/gameId/401856726) — human-readable play evidence and terms link.

[4]: https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/8/schedule?season=2026
[5]: https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=401856726
