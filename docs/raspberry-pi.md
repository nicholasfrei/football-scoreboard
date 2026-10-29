# Raspberry Pi scoreboard build

[Documentation](README.md) · [Project overview](../README.md)

Turn a small screen into an always-on shelf or wall scoreboard. Start by
[running the app on your computer](../README.md#run-locally), then bench-test
the Pi and display before building an enclosure. The app renders the whole
scoreboard and field on one screen; it does not control an LED matrix,
decorative lights, or a physical moving ball.

These instructions target a **Raspberry Pi 4** and **Raspberry Pi OS 64-bit
with Desktop**, using the labwc desktop session for browser autostart.
Other Pi models, OS versions, and desktops may need different cables,
power supplies, or startup instructions. This is a build guide, not a
certified enclosure design or a claim that this exact assembly has been
physically validated.

## Parts

| Part | What to choose |
| --- | --- |
| Raspberry Pi | [Pi 4 Model B](https://www.raspberrypi.com/products/raspberry-pi-4-model-b/), 2 GB RAM or more. A compatible Pi already on hand is fine. |
| Power supply | [Official Pi 4 15 W USB-C supply](https://www.raspberrypi.com/products/type-c-power-supply/) or a suitable equivalent for your model. |
| Storage | Genuine 32 GB or larger microSD card, preferably high-endurance, and a card reader. |
| Display | A 1920×1200 landscape display for the intended layout. The [7-inch Touch Display 2](https://www.raspberrypi.com/products/touch-display-2/) is a smaller alternative; its native orientation is 720×1280 portrait. |
| Display connections | Pi 4-compatible DSI ribbon and the display's GPIO power lead. Check bundle contents and the [official connection guide](https://www.raspberrypi.com/documentation/accessories/touch-display-2.html#connect-to-raspberry-pi); Pi 5 uses a different DSI connector/cable. |
| Cooling | Pi-compatible heatsink and a ventilated mounting arrangement; allow space for a fan if needed after thermal testing. |
| Enclosure | Deep shadow box, custom frame, or compact desktop enclosure with a removable back and ventilation. |
| Mounting | Display-compatible brackets, standoffs, screws, a mat/bezel, cable clips, and strain relief. For wall use, add hardware rated for the finished weight and wall type. |

Use official product pages' approved-reseller links for current stock and pricing.
A rough planning allowance for a small framed build is **$180–280 USD**, excluding
tools and decorative lighting; this is not a current shopping quote.

**Buy the display before cutting the frame.** Use the exact model's mechanical
drawing, not just its diagonal or active image area. Allow room for the panel,
Pi, ribbon connector, standoffs, cooling, and cable bends. A nominal 2–3-inch-deep
shadow box is only a starting point, not a verified fit.

### Small HDMI display alternative

A complete IPS HDMI monitor with documented Raspberry Pi/Linux compatibility
and mounting holes is another option. The Pi 4 needs a **micro-HDMI-to-HDMI**
cable. Follow the monitor's own power requirements; do not assume the Pi can
power it over USB. Avoid a bare LCD panel unless you also understand its
controller and power requirements.

A 7-inch screen scales the fixed 1920×1200 layout down to 60% at 1280×720;
check readability before choosing it. A native 1920×1200 screen shows the
intended pixel size. If substituting a Pi 5, choose
its matching supply, cooling, and display cable rather than reusing the Pi 4
list unchanged.

## Install on the bench

1. With power disconnected, connect the Pi and display following the
   [official Touch Display 2 installation guide](https://www.raspberrypi.com/documentation/accessories/touch-display-2.html).
   Use the ribbon and GPIO power connections specified for your Pi model.
2. Use [Raspberry Pi Imager](https://www.raspberrypi.com/software/) to install
   **Raspberry Pi OS 64-bit with Desktop**, not Lite. Choose a username, set
   Wi-Fi, and optionally enable SSH. A hostname such as `scoreboard` is useful.
3. Boot and enable desktop auto-login. Set the display to landscape (1280×720
   for the 7-inch Touch Display 2) using Screen Configuration. Disable screen
   blanking in Raspberry Pi Configuration / `raspi-config`.
4. Install the browser and runtime:

   ```sh
   sudo apt update
   sudo apt install chromium curl nodejs npm
   node --version
   ```

   The project requires **Node 20 or newer**; prefer a currently supported LTS
   release. If the OS package is older, install a supported ARM64 LTS release
   using the [Node.js installation instructions](https://nodejs.org/en/download).
5. Clone this repository onto the Pi:

   ```sh
   mkdir -p ~/repos
   git clone https://github.com/nicholasfrei/football-scoreboard.git ~/repos/football-scoreboard
   ```

   Install Git first with `sudo apt install git` if it is not already available.
   The service example below assumes the project is at
   `/home/YOUR_PI_USER/repos/football-scoreboard`.
   Alternatively, from a macOS/Linux computer with the repository locally:

   ```sh
   ssh YOUR_PI_USER@scoreboard.local 'mkdir -p ~/repos/football-scoreboard'
   rsync -av --exclude=.git --exclude=node_modules \
     ./football-scoreboard/ \
     YOUR_PI_USER@scoreboard.local:~/repos/football-scoreboard/
   ```

   Run those commands from the directory **containing** your local repository.
   Replace `YOUR_PI_USER` and `scoreboard.local` with your Pi's username and
   hostname (or IP address). SSH must be enabled to use this copy method.
6. On the Pi, choose your team and time zone in `config.json`, then run:

   ```sh
   cd ~/repos/football-scoreboard
   npm test
   npm start
   ```

   There are no npm dependencies to install. Open `http://localhost:4173` in
   Chromium **on the Pi**. Check logos, scores, play text, kickoff time, and
   readability at the intended viewing distance.

Review [provider access terms](data-sources.md) before leaving an automated
display running. The server has no authentication or HTTPS; keep it on a
trusted LAN and do not expose it directly to the internet.

## Start the server at boot

On the Pi, run `command -v node` to find the Node executable. Create
`/etc/systemd/system/football-scoreboard.service` using `sudo nano`.
Replace **every** `YOUR_PI_USER`, the home/project path, and `/usr/bin/node`
with the actual values for your installation:

```ini
[Unit]
Description=Football Scoreboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=YOUR_PI_USER
WorkingDirectory=/home/YOUR_PI_USER/repos/football-scoreboard
ExecStart=/usr/bin/node /home/YOUR_PI_USER/repos/football-scoreboard/server.js
Environment=PORT=4173
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Use an absolute executable path, not `~` or a shell alias. If using a Node
version manager, remember that systemd does not load your interactive shell
profile; update the service path if that Node installation moves.

Stop the manually started app with Ctrl+C, then enable the service:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now football-scoreboard
systemctl status football-scoreboard
```

For a separate config file, see [configuration](configuration.md#use-a-separate-config-file-or-port).

## Install published releases and update nightly

The updater follows the latest **published GitHub Release**, not pushes to
`main`. It installs each release into a versioned directory, keeps the Pi's
configuration outside the app files, switches the service to the new version,
and rolls back the switch if the service fails its health check. Previous
release directories are retained for rollback. The timer runs at **2:00 AM in
the Pi's local time zone**; make sure the Pi's clock and time zone are correct.

For a new Pi, install and validate the app first using the steps above. Then
install the updater and its systemd units (adjust `/home/nick` if your Pi user
is different):

```sh
sudo install -D -m 0755 scripts/update-release.sh /usr/local/sbin/football-scoreboard-update
sudo install -D -m 0644 deploy/systemd/football-scoreboard-update.service /etc/systemd/system/football-scoreboard-update.service
sudo install -D -m 0644 deploy/systemd/football-scoreboard-update.timer /etc/systemd/system/football-scoreboard-update.timer
sudo install -D -m 0644 deploy/systemd/football-scoreboard-release.conf /etc/systemd/system/football-scoreboard.service.d/release-updates.conf
mkdir -p ~/.config/football-scoreboard
test -e ~/.config/football-scoreboard/config.json || cp ~/repos/football-scoreboard/config.json ~/.config/football-scoreboard/config.json
chmod 600 ~/.config/football-scoreboard/config.json
mkdir -p ~/apps/football-scoreboard/releases
```

Run one update immediately to install the latest published version and switch
the service, then enable the nightly timer:

```sh
sudo systemctl daemon-reload
sudo /usr/local/sbin/football-scoreboard-update
sudo systemctl enable --now football-scoreboard-update.timer
systemctl list-timers football-scoreboard-update.timer
```

To check updater logs, run
`journalctl -u football-scoreboard-update.service -n 100`. The updater needs
outbound HTTPS access to GitHub and the Pi needs `git`, `curl`, and `python3`.

## Open the browser in kiosk mode

For the **labwc** desktop session, create `~/start-scoreboard-kiosk.sh`:

```sh
#!/bin/sh
# Wait for the local page, not the external sports feed, to be ready.
until curl -fsS http://localhost:4173/ >/dev/null; do sleep 2; done
exec chromium --ozone-platform=wayland --touch-events=enabled \
  --kiosk --noerrdialogs --no-first-run --disable-session-crashed-bubble \
  --user-data-dir="$HOME/.config/chromium-scoreboard" \
  --password-store=basic http://localhost:4173/
```

The dedicated kiosk profile avoids interfering with normal browser windows.
`--password-store=basic` prevents desktop-keyring unlock prompts from blocking
unattended startup, including after an account password change. It does **not**
provide encrypted browser password storage: use this profile only for the
scoreboard and do not save passwords or use it for personal logins.

Make it executable and create the labwc configuration directory if necessary:

```sh
chmod +x ~/start-scoreboard-kiosk.sh
mkdir -p ~/.config/labwc
```

Append this line to `~/.config/labwc/autostart`, preserving any existing entries:

```sh
$HOME/start-scoreboard-kiosk.sh &
```

Reboot and verify that the desktop automatically logs in, Chromium opens,
and the display stays awake without a keyboard attached. Other desktop
sessions have different autostart mechanisms. See Raspberry Pi's
[official kiosk tutorial](https://www.raspberrypi.com/tutorials/how-to-use-a-raspberry-pi-in-kiosk-mode/)
for OS-specific guidance. Exit kiosk mode with **Alt+F4** when a keyboard is attached.

## Mount in a shadow box or compact enclosure

1. Disconnect power. Dry-fit the screen, Pi, connectors, and cables before
   drilling or trimming anything.
2. Support the display using its mounting points and compatible brackets.
   Use standoffs for the Pi and match fasteners to the mechanical drawings;
   do not use the glass, ribbon cable, or ports as structural supports.
3. Fit a mat or bezel around the active image area without pressing on the panel.
   Keep the rear panel removable for storage-card access and maintenance.
4. Leave ventilation openings and cable-bend clearance. Do not bury electronics
   behind foam or turf, or close them inside a sealed box. Secure the power
   cable with strain relief so it cannot pull on a connector.
5. Run the completed enclosure for several hours and check Pi temperature and
   for thermal throttling (`vcgencmd measure_temp` and `vcgencmd get_throttled`).
   Improve airflow/cooling if needed before wall mounting or unattended use.
6. Use a stable desktop stand or wall hardware rated for the finished assembly
   and wall material. Keep the external power supply accessible.

### Optional miniature turf field

For a physical field below the screen, use a rigid backing, model-railroad turf
or felt, painted yard lines, and an optional diffused LED kit with its specified
controller and power supply. Keep lighting power separate from GPIO unless
you design an appropriately rated driver. The app does not control the lights
or a physical moving ball, and a physical field cannot automatically change
team artwork. The on-screen field can.

## Final checks and maintenance

- Compare one real live game against ESPN Gamecast: possession changes, both
  sides of midfield, quarter changes/overtime, scores, takeovers, and final state.
  Feed and polling delays mean it may not match TV timing.
- Disconnect/reconnect Wi-Fi. Old data should be labeled stale and recover
  when connectivity returns. A reboot while offline starts without cached scores.
- Reboot on the network where the display will live. Confirm kiosk startup,
  no screen sleep, legibility, enclosure temperature, and mount stability.
- Keep a note of the hostname, Wi-Fi setup, and restart procedure for whoever
  maintains the display.

Useful commands:

```sh
# View recent server logs.
journalctl -u football-scoreboard -n 100

# Restart after changing config or updating the code.
sudo systemctl restart football-scoreboard

# Stop the server temporarily.
sudo systemctl stop football-scoreboard
```

Reload Chromium after updating browser assets. If the service will not start,
check logs, file ownership, the configured Node path, and the selected Node
version before changing kiosk settings.
