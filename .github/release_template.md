## What's new

- Refreshed the dark theme and field graphics, including clearer drive paths, a team-logo possession pin, and down-and-distance in the play list.
- Added an estimated halftime countdown: 13 minutes for NFL and 20 minutes for college, based on ESPN's end-of-half timestamp. It stops at zero until play resumes and falls back to HALFTIME when the timestamp is unavailable.
- Increased live and near-kickoff refresh frequency from 15 to 10 seconds; idle polling remains every five minutes.

## Fixes and coverage

- Improved punt/return trajectories, penalty enforcement, missed and blocked kick positioning, and fourth-down pass handling.
- Fixed highlight handling when ESPN amends an existing play with an extra point or penalty, and refined scoring, turnover, and tackle-credit behavior.
- Expanded regression coverage and added live-play capture/review scripts, plus Raspberry Pi touchscreen-keyboard guidance.

**Validation:** all 646 tests passed (`npm test`).

## Updating

Configured Raspberry Pi installations pick up this new version tag during their nightly update. To update immediately:

```sh
sudo /usr/local/sbin/football-scoreboard-update
```

Reload the kiosk browser afterward to load the new UI. See the [Raspberry Pi setup guide](https://github.com/nicholasfrei/football-scoreboard/blob/v0.1.2/docs/raspberry-pi.md#install-published-releases-and-update-nightly) for first-time updater setup.

Requires Node.js 20 or newer. No npm dependencies to install.

**Full changelog:** https://github.com/nicholasfrei/football-scoreboard/compare/v0.1.1...v0.1.2
