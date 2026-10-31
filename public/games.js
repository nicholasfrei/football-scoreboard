const league = new URLSearchParams(location.search).get("league") === "nfl" ? "nfl" : "college-football";
const list = document.querySelector("#games-list");
const status = document.querySelector("#games-status");
const refresh = document.querySelector("#games-refresh");
for (const link of document.querySelectorAll("[data-league]")) {
  if (link.dataset.league === league) link.setAttribute("aria-current", "page");
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function render(payload) {
  const fragment = document.createDocumentFragment();
  const zone = payload.timeZone ?? "America/Chicago";
  const dateFormat = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "long", month: "short", day: "numeric" });
  const timeFormat = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  let dateLabel;
  let grid;
  for (const game of payload.games) {
    const date = new Date(game.kickoffAt);
    const validDate = Number.isFinite(date.getTime());
    const label = validDate ? dateFormat.format(date) : "Date to be announced";
    if (dateLabel !== label) {
      dateLabel = label;
      const section = element("section", "games-day");
      section.append(element("h3", "games-date", label));
      grid = element("div", "games-grid");
      section.append(grid);
      fragment.append(section);
    }
    const card = element("a", `game-card is-${game.state}`);
    card.href = `/?league=${league}&game=${encodeURIComponent(game.id)}`;
    card.setAttribute("aria-label", `Watch ${game.name}, ${game.status}`);
    const meta = element("div", "game-card-meta");
    meta.append(element("span", "", game.state === "live" ? `LIVE · ${game.status}` : game.state === "scheduled"
      ? `${validDate && !game.timeTbd ? timeFormat.format(date) : "Time TBD"}${game.broadcasts?.length ? ` · ${game.broadcasts.join(" / ")}` : ""}` : game.status));
    card.append(meta);
    const home = game.homeAway === "home" ? game.selectedTeam : game.opponent;
    const away = game.homeAway === "away" ? game.selectedTeam : game.opponent;
    for (const team of [away, home]) {
      const row = element("div", `game-card-team${team.winner ? " is-winner" : ""}`);
      if (team.logo) {
        const image = document.createElement("img");
        image.src = team.logo; image.alt = ""; image.loading = "lazy";
        image.addEventListener("error", () => { image.hidden = true; });
        row.append(image);
      }
      row.append(element("span", "game-card-name", `${team.rank ? `#${team.rank} ` : ""}${team.shortName}`));
      row.append(element("strong", "game-card-score", game.state === "scheduled" ? "—" : team.score ?? "—"));
      card.append(row);
    }
    grid.append(card);
  }
  list.replaceChildren(fragment);
  document.querySelector("#games-week").textContent = [payload.season, payload.week ? `Week ${payload.week}` : null].filter(Boolean).join(" · ");
  status.textContent = payload.stale ? "Feed delayed · Showing last known scores. Retrying automatically."
    : payload.games.length ? `Updated ${timeFormat.format(new Date(payload.refreshedAt))}`
      : `No ${league === "nfl" ? "NFL" : "Top 25"} games on the current slate. Check back soon.`;
}

let pending = false;
async function load() {
  if (pending) return;
  pending = true;
  refresh.disabled = true;
  list.setAttribute("aria-busy", "true");
  try {
    const response = await fetch(`/api/games?league=${league}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("Scores unavailable");
    render(await response.json());
  } catch {
    status.textContent = "Scores unavailable · Any displayed scores may be outdated. Refresh to retry.";
  } finally {
    pending = false;
    refresh.disabled = false;
    list.setAttribute("aria-busy", "false");
  }
}
refresh.addEventListener("click", load);
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
window.setInterval(() => { if (!document.hidden) load(); }, 20_000);
load();
