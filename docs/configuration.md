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

Arkansas Razorbacks (NCAA, the included default):

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

## Set the time zone

`timeZone` is optional and defaults to `America/Chicago`. Use an IANA time-zone
name, such as `America/New_York`, `America/Denver`, or `America/Los_Angeles`.
Kickoff times are formatted in that zone, including daylight-saving changes.

## Apply changes

Configuration is read at server startup, not hot-reloaded:

1. Save the file.
2. Stop the running server with Ctrl+C, then run `npm start` again.
3. Reload the browser, or wait for its next 30-second refresh.

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
