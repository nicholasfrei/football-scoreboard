import { createHighlightTracker, HIGHLIGHT_DURATION_MS, HIGHLIGHT_LABELS } from "./highlights.js";

const POLL_INTERVAL_MS = 30_000;
let timeZone = "America/Chicago";
let selectedTeamId = null;
const highlightTracker = createHighlightTracker();
let highlightTimer;
let activeHighlight = null;
let previewPending = new URLSearchParams(location.search).get("preview");

function hideHighlight() {
  clearTimeout(highlightTimer);
  activeHighlight = null;
  document.querySelector("#highlight").hidden = true;
  document.querySelector(".score-panel").classList.remove("has-highlight");
  for (const selector of [".score-topline", ".matchup", ".game-meta"]) {
    document.querySelector(selector).removeAttribute("aria-hidden");
  }
}

function showHighlight(event, game, demo = false) {
  hideHighlight();
  const team = [game.selectedTeam, game.opponent].find((team) => team.id === event.teamId);
  const overlay = document.querySelector("#highlight");
  document.querySelector("#highlight-context").textContent = demo ? "DEMO · NOT A LIVE PLAY" : "BIG PLAY";
  document.querySelector("#highlight-title").textContent = HIGHLIGHT_LABELS[event.kind];
  document.querySelector("#highlight-team").textContent = team?.location.toUpperCase() ?? "";
  document.querySelector("#highlight-detail").textContent = event.kind === "interception" ? "INTERCEPTED BY"
    : event.kind === "fumble" ? "RECOVERED BY" : event.detail;
  if (!team && ["interception", "fumble"].includes(event.kind)) {
    document.querySelector("#highlight-detail").textContent = "TEAM NOT CONFIRMED";
  }
  const logo = document.querySelector("#highlight-logo");
  logo.replaceChildren();
  if (team) setTeamLogo(logo, team);
  overlay.style.setProperty("--event-color", team?.color ?? "#454545");
  overlay.style.setProperty("--event-duration", `${HIGHLIGHT_DURATION_MS}ms`);
  overlay.hidden = false;
  // Restart the progress animation if a newer play replaces this one.
  const progress = overlay.querySelector(".highlight-progress");
  progress.style.animation = "none";
  void progress.offsetWidth;
  progress.style.animation = "";
  document.querySelector(".score-panel").classList.add("has-highlight");
  for (const selector of [".score-topline", ".matchup", ".game-meta"]) {
    document.querySelector(selector).setAttribute("aria-hidden", "true");
  }
  activeHighlight = { ...event, gameId: game.id, league: game.league, demo };
  highlightTimer = setTimeout(hideHighlight, HIGHLIGHT_DURATION_MS);
}

function updateHighlights(payload) {
  const game = payload.spotlight;
  if (activeHighlight && !activeHighlight.demo) {
    const stillValid = !payload.stale && !payload.gamecastUnavailable && game?.state === "live"
      && game.id === activeHighlight.gameId && game.league === activeHighlight.league && game.highlights?.some((event) =>
        event.id === activeHighlight.id && event.kind === activeHighlight.kind && event.teamId === activeHighlight.teamId);
    if (!stillValid) hideHighlight();
  }
  const event = highlightTracker.observe(payload);
  if (event) showHighlight(event, game);
  if (previewPending && game) {
    const kind = previewPending;
    previewPending = null;
    if (Object.hasOwn(HIGHLIGHT_LABELS, kind)) showHighlight({ kind, teamId: game.selectedTeam.id, detail: "Score returns after 12 seconds" }, game, true);
  }
}

const elements = {
  panel: document.querySelector(".score-panel"),
  gameLabel: document.querySelector("#game-label"),
  gameStatus: document.querySelector("#game-status"),
  gameStatusText: document.querySelector("#game-status-text"),
  gameDetail: document.querySelector("#game-detail"),
  gameVenue: document.querySelector("#game-venue"),
  nextOpponent: document.querySelector("#next-opponent"),
  nextDetail: document.querySelector("#next-detail"),
  feedDot: document.querySelector("#feed-dot"),
  feedLabel: document.querySelector("#feed-label"),
  refreshButton: document.querySelector("#refresh-button"),
};

function formatKickoff(value, options) {
  if (!value) return "TIME TBD";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "TIME TBD";
  return new Intl.DateTimeFormat("en-US", { timeZone, ...options }).format(date);
}

function formatDate(value) {
  return formatKickoff(value, { weekday: "short", month: "short", day: "numeric" }).toUpperCase();
}

function formatTime(value) {
  return formatKickoff(value, { hour: "numeric", minute: "2-digit", timeZoneName: "short" }).toUpperCase();
}

function kickoffText(game) {
  // ESPN's TBD timestamps are date placeholders; converting them to Central
  // can incorrectly display the previous calendar day.
  if (game.timeTbd) {
    const day = new Date(`${game.kickoffAt?.slice(0, 10)}T12:00:00Z`);
    return Number.isNaN(day.getTime()) ? "DATE / TIME TBD" : `${formatDate(day)} · TIME TBD`;
  }
  return `${formatDate(game.kickoffAt)} · ${formatTime(game.kickoffAt)}`;
}

function setTeamLogo(container, team) {
  container.replaceChildren();
  if (!team.logo) {
    container.textContent = team.abbreviation;
    return;
  }
  const image = document.createElement("img");
  image.alt = `${team.name} logo`;
  const logos = [...new Set([team.logo, ...(team.logos ?? [])].filter(Boolean))];
  let index = 0;
  image.src = logos[index];
  image.addEventListener("error", () => {
    if (++index < logos.length) image.src = logos[index];
    else container.textContent = team.abbreviation;
  });
  container.append(image);
}

function updateBrand(payload) {
  const team = payload.team;
  timeZone = payload.timeZone ?? "America/Chicago";
  selectedTeamId = team.id;
  const leagueName = payload.league === "nfl" ? "NFL" : "NCAAF";
  document.title = `${team.name} Football Scoreboard`;
  document.querySelector(".mount").setAttribute("aria-label", `${team.name} football scoreboard`);
  document.documentElement.style.setProperty("--team-color", team.color);
  document.querySelector("#brand-location").textContent = team.location;
  document.querySelector("#brand-name").textContent = team.mascot.toUpperCase();
  document.querySelector("#league-name").textContent = leagueName;
  document.querySelector("#team-caption").textContent = payload.league === "college-football" && team.id === "8"
    ? "CALL THE HOGS" : `${team.mascot.toUpperCase()} FOOTBALL`;
  setTeamLogo(document.querySelector("#brand-logo"), team);
}

function updateField(game) {
  const home = game.homeAway === "home" ? game.selectedTeam : game.opponent;
  const field = document.querySelector(".field-wrap");
  field.style.setProperty("--home-color", home.color);
  // White is legible over dark team colors, black over light colors.
  const rgb = home.color.slice(1).match(/../g).map((channel) => parseInt(channel, 16));
  const brightness = rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114;
  field.style.setProperty("--endzone-ink", brightness > 155 ? "#000000" : "#FFFFFF");
  document.querySelector("#field-home").textContent = `${home.location.toUpperCase()} · ${game.neutralSite ? "DESIGNATED HOME" : "HOME"}`;
  document.querySelector("#field-venue").textContent = game.venue ?? "VENUE TBD";
  for (const [selector, text] of [["#endzone-school", home.location], ["#endzone-mascot", home.mascot]]) {
    const label = document.querySelector(selector);
    label.textContent = text.toUpperCase();
    label.setAttribute("font-size", Math.min(25, 290 / (text.length * .8)));
  }
  const logo = document.querySelector("#field-logo");
  const fallback = document.querySelector("#field-logo-fallback");
  fallback.textContent = home.logo ? "" : home.abbreviation;
  const logos = [...new Set([home.logo, ...(home.logos ?? [])].filter(Boolean))];
  let logoIndex = 0;
  logo.onerror = () => {
    if (++logoIndex < logos.length) logo.setAttribute("href", logos[logoIndex]);
    else { fallback.textContent = home.abbreviation; logo.removeAttribute("href"); }
  };
  if (home.logo) logo.setAttribute("href", home.logo);
  else logo.removeAttribute("href");

  const marker = document.querySelector("#ball-marker");
  marker.setAttribute("visibility", game.ball ? "visible" : "hidden");
  if (game.ball) {
    marker.style.transform = `translateX(${104 + game.ball.percent * 7.92}px)`;
    document.querySelector("#ball-detail").textContent = `${game.ball.possession} ${game.ball.direction === "right" ? "→" : "←"} · ${game.ball.downDistance ?? game.ball.label ?? "Ball position"} · ${game.ball.source}`;
  } else {
    document.querySelector("#ball-detail").textContent = game.state === "live"
      ? "Ball position unavailable · waiting for the feed"
       : game.state === "final" ? "FINAL" : "Ball position appears during play";
  }
  document.querySelector("#field-season").textContent = game.neutralSite ? "NEUTRAL SITE" : game.homeAway === "home" ? "HOME" : "AWAY";

  document.querySelector("#plays-heading").textContent = game.state === "final" ? "LAST PLAYS · COMPLETED GAME" : "RECENT PLAYS";
  const list = document.querySelector("#recent-plays");
  list.replaceChildren();
  for (const play of game.plays ?? []) {
    const item = document.createElement("li");
    const time = document.createElement("span");
    time.textContent = `${play.period > 4 ? `OT${play.period - 4}` : `Q${play.period ?? "—"}`} · ${play.clock ?? "—"}`;
    const text = document.createElement("span");
    text.textContent = play.text;
    item.classList.toggle("scoring-play", play.scoring);
    item.append(time, text);
    list.append(item);
  }
  if (!list.children.length) {
    const item = document.createElement("li");
    item.textContent = game.state === "scheduled" ? "Play-by-play begins at kickoff." : "Play-by-play unavailable. Scores will continue updating.";
    list.append(item);
  }
}

function statusLabel(game) {
  if (game.state === "live") return "LIVE";
  if (game.state === "final") return "FINAL";
  if (game.state === "scheduled") return "UPCOMING";
  return game.status.toUpperCase();
}

function setStatus(game) {
  const label = statusLabel(game);
  elements.gameStatusText.textContent = label;
  elements.gameStatus.classList.toggle("is-live", game.state === "live");
  elements.gameStatus.classList.toggle("is-upcoming", game.state === "scheduled");
}

let lastGameState = null;

function rankedName(team) {
  const rank = Number.isInteger(team.rank) && team.rank >= 1 && team.rank <= 25 ? `#${team.rank} ` : "";
  return `${rank}${team.location ?? team.shortName}`;
}

function renderTeam(side, team) {
  document.querySelector(`#${side}-team`).dataset.teamId = team.id;
  document.querySelector(`#${side}-team`).classList.toggle("is-selected", team.id === selectedTeamId);
  const name = document.querySelector(`#${side}-name`);
  name.textContent = rankedName(team);
  name.title = team.rank ? team.rankSource ?? "ESPN event ranking" : "";
  const overall = team.record?.overall ? `${team.record.overall} Overall` : "Record unavailable";
  const conference = team.record?.conference ? ` (${team.record.conference} ${team.conferenceName ?? "Conf."})` : "";
  document.querySelector(`#${side}-record`).textContent = `${overall}${conference}`;
  document.querySelector(`#${side}-score`).textContent = team.score ?? "—";
  setTeamLogo(document.querySelector(`#${side}-seal`), team);
}

function renderNextDetails(game) {
  const predictor = document.querySelector("#next-predictor");
  if (!game?.matchupPredictor) {
    predictor.textContent = game ? "Win chance: unavailable" : "Win chance: no game listed";
    return;
  }
  const model = game.matchupPredictor;
  predictor.textContent = `Win chance: ${game.selectedTeam.abbreviation} ${model.selectedTeam.toFixed(1)}% · ${game.opponent.abbreviation} ${model.opponent.toFixed(1)}% · ${model.source}`;
}

function updateGame(game, nextGame) {
  lastGameState = game?.state ?? null;
  renderNextDetails(nextGame);
  if (!game) {
    elements.gameLabel.textContent = "SEASON SCHEDULE";
    elements.gameDetail.textContent = "No game is currently available.";
    elements.gameVenue.textContent = "Schedule feed is empty";
    return;
  }

  const upcoming = game.state === "scheduled";
  const isHome = game.homeAway === "home";

  elements.gameLabel.textContent = upcoming ? "NEXT GAME" : game.state === "live" ? "GAME IN PROGRESS" : "MOST RECENT GAME";
  renderTeam("away", isHome ? game.opponent : game.selectedTeam);
  renderTeam("home", isHome ? game.selectedTeam : game.opponent);
  updateField(game);
  elements.gameVenue.textContent = game.venue ?? "VENUE TBD";
  document.querySelector("#game-broadcast").textContent = game.broadcasts?.join(" / ") || "TBD";

  if (game.state === "live") {
    const quarter = game.period > 4 ? `OT${game.period - 4}` : game.period ? `Q${game.period}` : "LIVE";
    elements.gameDetail.textContent = `${quarter}${game.clock ? ` · ${game.clock}` : ""} · ${formatDate(game.kickoffAt)}`;
  } else if (upcoming) {
    elements.gameDetail.textContent = kickoffText(game);
  } else {
    elements.gameDetail.textContent = `${formatDate(game.kickoffAt)} · ${game.status.toUpperCase()}`;
  }

  setStatus(game);

  if (nextGame) {
    const direction = nextGame.neutralSite ? "NEUTRAL" : nextGame.homeAway === "home" ? "HOME" : "AWAY";
    elements.nextOpponent.textContent = `${direction} VS. ${rankedName(nextGame.opponent).toUpperCase()}`;
    elements.nextDetail.textContent = `${kickoffText(nextGame)} · ${nextGame.broadcasts?.join(" / ") || "TBD"}`;
  } else if (upcoming) {
    elements.nextOpponent.textContent = "SCHEDULE LOADING";
    elements.nextDetail.textContent = "Check back for the next matchup";
  } else {
    elements.nextOpponent.textContent = "NO NEXT GAME LISTED";
    elements.nextDetail.textContent = "Waiting for schedule updates";
  }
}

function setFeedState(state, refreshedAt) {
  elements.feedDot.classList.toggle("is-stale", state === "stale");
  elements.feedDot.classList.toggle("is-error", state === "error");

  if (state === "fresh") {
    const time = formatKickoff(refreshedAt, { hour: "numeric", minute: "2-digit" });
    elements.feedLabel.textContent = `ESPN DATA · UPDATED ${time}`;
  } else if (state === "stale") {
    elements.feedLabel.textContent = "SHOWING LAST KNOWN SCORE";
  } else {
    elements.feedLabel.textContent = "SCORE FEED UNAVAILABLE";
  }
}

let refreshing = false;
async function refreshScoreboard() {
  if (refreshing) return;
  refreshing = true;
  elements.refreshButton.classList.add("is-spinning");
  try {
    const response = await fetch("/api/scoreboard", { cache: "no-store", signal: AbortSignal.timeout(35_000) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Score feed request failed");

    updateBrand(payload);
    updateGame(payload.spotlight, payload.nextGame);
    updateHighlights(payload);
    document.querySelector("#season-year").textContent = payload.season ?? "";
    setFeedState(payload.stale ? "stale" : "fresh", payload.refreshedAt);
    if (payload.gamecastUnavailable) elements.feedLabel.textContent += " · GAMECAST UNAVAILABLE";
    if (payload.stale) {
      document.querySelector("#ball-marker").setAttribute("visibility", "hidden");
      document.querySelector("#ball-detail").textContent = lastGameState === "final" ? "FINAL" : "Feed delayed · last known score and plays";
      elements.gameStatusText.textContent = "FEED DELAYED";
      elements.gameStatus.classList.remove("is-live");
    }
  } catch {
    hideHighlight();
    highlightTracker.observe(null);
    setFeedState("error");
    elements.gameStatusText.textContent = "OFFLINE";
    elements.gameStatus.classList.remove("is-live", "is-upcoming");
    elements.gameDetail.textContent = "Can’t reach the score feed. Retrying automatically.";
    document.querySelector("#ball-marker").setAttribute("visibility", "hidden");
    document.querySelector("#ball-detail").textContent = lastGameState === "final" ? "FINAL" : "Offline · last known score and plays";
  } finally {
    elements.panel.setAttribute("aria-busy", "false");
    elements.refreshButton.classList.remove("is-spinning");
    refreshing = false;
  }
}

elements.refreshButton.addEventListener("click", refreshScoreboard);
refreshScoreboard();
window.setInterval(refreshScoreboard, POLL_INTERVAL_MS);
