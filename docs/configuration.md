# Configuration

[Documentation](README.md) · [Local quick start](../README.md#run-locally)

## Select a team

Edit `config.json` in the project root. Use an ESPN **team page** URL; the app
determines the league and resolves the team's numeric ID.

Dallas Cowboys (NFL):

```json
{
  "teamUrl": "https://www.espn.com/nfl/team/_/name/dal/dallas-cowboys",
  "timeZone": "America/Chicago"
}
```

Arkansas Razorbacks (NCAA alternative):

```json
{
  "teamUrl": "https://www.espn.com/college-football/team/_/id/8/arkansas-razorbacks",
  "timeZone": "America/Chicago"
}
```

Supported ESPN URL paths:

- `college-football/team/_/id/<id>/<slug>`
- `nfl/team/_/name/<abbreviation>/<slug>`
- `nfl/team/_/id/<id>/<slug>`

The descriptive slug is optional. Schedule pages, Gamecast links, and other
sports are not supported configuration inputs.

The selected team controls the header logo, name, color, league, game selection,
predictor percentages, and highlight previews. The field always uses the
**designated home team's** branding; choosing Dallas does not put Cowboys
artwork on an opponent's home field. See [display behavior](display-behavior.md).

## Favorite teams on the touchscreen

The included configuration has three favorites: **Dallas Cowboys**, **Texas
Longhorns**, and **UTSA Roadrunners**. Their logo and mascot buttons appear in
the game-information row between the broadcast listing and game status. Swipe
the row horizontally when more teams are added, or use Tab and Enter with a
keyboard. Tap a button to load that team's scoreboard, including its league,
colors, schedule, scores, field, and players. The active button is highlighted.

Edit the optional `favorites` array in `config.json` to add, remove, or reorder
teams. Each entry only needs `teamUrl`; names, mascot labels, and logos are
looked up automatically from ESPN. Set `timeZone` once for all teams. For example:

```json
{
  "timeZone": "America/Chicago",
  "favorites": [
    {
      "teamUrl": "https://www.espn.com/nfl/team/_/name/dal/dallas-cowboys"
    },
    {
      "teamUrl": "https://www.espn.com/college-football/team/_/id/251/texas-longhorns"
    },
    {
      "teamUrl": "https://www.espn.com/college-football/team/_/id/2636/utsa-roadrunners"
    }
  ]
}
```

The first favorite is the default unless a top-level `teamUrl` is provided.
Optional `name`, `mascot`, and HTTPS `logo` overrides are still supported.
If ESPN metadata is unavailable, buttons fall back to text from the URL.

Favorites share `timeZone`. Only the active team's feed is polled; each team's
cached scores are kept separate. Switching navigates to a fresh scoreboard view
so the previous team's plays or in-flight requests cannot leak into the new
view. No server restart is needed when tapping a favorite.

The browser remembers the last tapped team across reloads and Pi reboots when
local storage is available. A `?team=college-football%3A251` link explicitly
selects Texas; otherwise the remembered team is used, falling back to `teamUrl`
if that favorite was removed. The top-level `teamUrl` remains selectable even
when it is not in the favorites list. Omit `favorites` or use an empty array
for the original single-team display. Favorites are hidden in replay and
countdown previews. Missing logo artwork leaves the text button usable.

Restart the service and reload Chromium after editing the configuration.

## Set the time zone

`timeZone` is optional and defaults to `America/Chicago`. Use an IANA time-zone
name, such as `America/New_York`, `America/Denver`, or `America/Los_Angeles`.
Kickoff times are formatted in that zone, including daylight-saving changes.

## Apply changes

Configuration is read at server startup, not hot-reloaded:

1. Save the file.
2. Stop the running server with Ctrl+C, then run `npm start` again.
3. Reload the browser, or wait for its next refresh (five minutes outside live play).

On a Pi configured with the [systemd service](raspberry-pi.md#start-the-server-at-boot),
run `sudo systemctl restart football-scoreboard` instead.

Invalid JSON, unsupported team URLs, and invalid time zones produce a startup
error rather than silently reverting to Arkansas.

## Use a separate config file or port

The default port is **4173**. On macOS or Linux:

```sh
SCOREBOARD_CONFIG=/absolute/path/to/cowboys.json PORT=4174 npm start
```

The alternate file uses the same JSON structure as `config.json`. Open
`http://localhost:4174` for this example. Either environment variable can be
used independently. The default config path is relative to `server.js`, not
your shell's working directory.

In PowerShell, set environment variables before starting:

```powershell
$env:SCOREBOARD_CONFIG = "C:\path\to\cowboys.json"
$env:PORT = "4174"
npm start
```

For systemd, add `Environment=SCOREBOARD_CONFIG=/absolute/path/to/cowboys.json`
to the service's `[Service]` section. Run `sudo systemctl daemon-reload`, restart
the service, and reload the browser.

## Network access

The server listens on all network interfaces (`0.0.0.0`). Another device on a
trusted LAN can open `http://YOUR_SERVER_IP:4173`, subject to your firewall.
`localhost` always means the device running that browser.

There is no built-in authentication or HTTPS. Do not port-forward this server
or expose it directly to the public internet. Internet access is needed for
the game feed and remote artwork; an API key is not required, but
[provider access terms still apply](data-sources.md).

## Troubleshooting

- **`npm` or `node` is not found:** install Node.js with npm, reopen the terminal,
  and check `node --version`. The project requires Node 20 or newer.
- **`EADDRINUSE`:** another process is using the port. Stop it, or choose a
  different `PORT` and open that port in the browser.
- **The old team is still shown:** restart the server, not just the browser.
  Check whether `SCOREBOARD_CONFIG` points to a different file.
- **The feed is unavailable:** check internet access and
  `http://localhost:4173/api/scoreboard` for the JSON response. An upstream outage
  can prevent loading even when the local page opens.
- **Scores load but plays, predictions, or artwork are missing:** ESPN may not
  provide those fields for that game, or a separate request may have failed.
  The display keeps missing values unavailable rather than inventing them.
