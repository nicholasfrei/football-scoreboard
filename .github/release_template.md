## What's new

- Added an **All scores** dashboard for the current NCAAF Top 25 slate and all NFL games, ordered by kickoff, with selectable matchups that open temporarily in the scoreboard.
- Improved play-by-play and field visualization, including clearer run/pass/punt trajectories, defensive returns and sacks, confirmed field positions, team-color possession/scoring markers, and win-chance display.
- Added broader support for FBS yard-line aliases and polished the team picker and dashboard navigation.

## Fixes and coverage

- Refined handling of game data and play positions across NFL and college football, with regression coverage for the dashboard and field updates.

**Validation:** all 696 tests passed (`npm test`).

## Updating

Configured Raspberry Pi installations pick up this new version tag during their nightly update. To update immediately:

```sh
sudo /usr/local/sbin/football-scoreboard-update
```

Reload the kiosk browser afterward to load the new UI. See the [Raspberry Pi setup guide](https://github.com/nicholasfrei/football-scoreboard/blob/v0.1.2/docs/raspberry-pi.md#install-published-releases-and-update-nightly) for first-time updater setup.

Requires Node.js 20 or newer. No npm dependencies to install.

**Full changelog:** https://github.com/nicholasfrei/football-scoreboard/compare/v0.1.2...v0.1.3
