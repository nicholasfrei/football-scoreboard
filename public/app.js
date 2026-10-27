import { createHighlightTracker, highlightDetail, highlightDuration, HIGHLIGHT_LABELS } from "./highlights.js";
import { endzoneTextLayout, fieldBranding } from "./field-branding.js";
import { possessionBranding } from "./possession-branding.js";
import { teamRecordLabel } from "./team-record.js";
import { kickoffCountdown, createRefreshLoop } from "./game-timing.js";
import { createBallPositionTracker } from "./ball-position.js";

let lastPayload = null;
let displayedGame = null;
let timeZone = "America/Chicago";
let selectedTeamId = null;
const highlightTracker = createHighlightTracker();
const ballPositionTracker = createBallPositionTracker();
let highlightTimer;
let activeHighlight = null;
let previewPending = new URLSearchParams(location.search).get("preview");
let driveGameId = null;
let selectedDriveId = null; // null follows the newest drive through live updates.
let renderedDriveId = null;
let renderedLastPlayId = null;

function hideHighlight() {
  clearTimeout(highlightTimer);
  activeHighlight = null;
  document.querySelector("#highlight").hidden = true;
  document.querySelector(".score-panel").classList.remove("has-highlight");
  for (const selector of [".score-topline", ".matchup", ".game-meta"]) {
    document.querySelector(selector).removeAttribute("aria-hidden");
  }
}

function showHighlight(event, game, demo = false, duration = highlightDuration(event.kind)) {
  hideHighlight();
  const team = [game.selectedTeam, game.opponent].find((team) => team.id === event.teamId);
  const overlay = document.querySelector("#highlight");
  overlay.dataset.kind = event.kind;
  document.querySelector("#highlight-context").textContent = event.kind === "penalty"
    ? demo ? "PENALTY · DEMO" : "PENALTY" : demo ? "DEMO · NOT A LIVE PLAY" : "BIG PLAY";
  document.querySelector("#highlight-title").textContent = event.kind === "penalty"
    ? event.penaltyType ?? event.detail?.split(/\s+·\s+/)[0] ?? "Penalty" : HIGHLIGHT_LABELS[event.kind];
  document.querySelector("#highlight-team").textContent = team?.location.toUpperCase() ?? "";
  document.querySelector("#highlight-detail").textContent = highlightDetail(event, game);
  const logo = document.querySelector("#highlight-logo");
  logo.replaceChildren();
  if (team) setTeamLogo(logo, team);
  overlay.style.setProperty("--event-color", event.kind === "penalty" ? "#efc744" : team?.color ?? "#454545");
  overlay.style.setProperty("--event-duration", `${duration}ms`);
  overlay.hidden = false;
  overlay.classList.remove("is-animating");
  void overlay.offsetWidth;
  overlay.classList.add("is-animating");
  // Restart the progress animation if a newer play replaces this one.
  const progress = overlay.querySelector(".highlight-progress");
  progress.style.animation = "none";
  void progress.offsetWidth;
  progress.style.animation = "";
  document.querySelector(".score-panel").classList.add("has-highlight");
  for (const selector of [".score-topline", ".matchup", ".game-meta"]) {
    document.querySelector(selector).setAttribute("aria-hidden", "true");
  }
  activeHighlight = { ...event, gameId: game.id, league: game.league, demo,
    ballPercent: game.ball?.percent ?? null, possessionTeamId: game.possessionTeamId ?? null };
  highlightTimer = setTimeout(hideHighlight, duration);
}

function updateHighlights(payload) {
  const game = payload.spotlight;
  if (activeHighlight && !activeHighlight.demo) {
    const stillValid = !payload.stale && !payload.gamecastUnavailable && game?.state === "live"
      && game.id === activeHighlight.gameId && game.league === activeHighlight.league && game.highlights?.some((event) =>
        event.id === activeHighlight.id && event.kind === activeHighlight.kind && event.teamId === activeHighlight.teamId);
    const moved = activeHighlight.kind === "touchdown" && game.ball && (
      game.ball.percent !== activeHighlight.ballPercent || game.possessionTeamId !== activeHighlight.possessionTeamId);
    if (!stillValid || moved) hideHighlight();
    else if (activeHighlight.kind === "touchdown") {
      document.querySelector("#highlight-detail").textContent = highlightDetail(activeHighlight, game);
    }
  }
  const event = highlightTracker.observe(payload);
  if (event) showHighlight(event, game);
  if (previewPending && game) {
    const noPenaltyYards = previewPending === "penalty-no-yards";
    const kind = noPenaltyYards ? "penalty" : previewPending;
    previewPending = null;
    if (Object.hasOwn(HIGHLIGHT_LABELS, kind)) {
      const event = kind === "penalty"
        ? { kind, teamId: null, penaltyType: noPenaltyYards ? "False Start" : "Defensive Pass Interference",
          penaltyYards: noPenaltyYards ? null : 15 }
        : { kind, teamId: game.selectedTeam.id, detail: `Score returns after ${highlightDuration(kind) / 1000} seconds` };
      showHighlight(event, game, true);
    }
  }
}

const elements = {
  panel: document.querySelector(".score-panel"),
  gameLabel: document.querySelector("#game-label"),
  gameStatus: document.querySelector("#game-status"),
  gameStatusText: document.querySelector("#game-status-text"),
  gameDetail: document.querySelector("#game-detail"),
  gameClock: document.querySelector("#game-clock"),
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
  setTeamLogo(document.querySelector("#brand-logo"), team);
}

function fitEndzoneLabels() {
  const labels = [...document.querySelectorAll(".endzone-text text")];
  // Measure untransformed glyphs again when the local font finishes loading.
  for (const label of labels) label.removeAttribute("transform");
  const layout = endzoneTextLayout(labels.map((label) => label.getBBox()));
  labels.forEach((label, index) => {
    const fit = layout[index];
    if (fit) label.setAttribute("transform", `matrix(${fit.scale} 0 0 ${fit.scale} ${fit.x} ${fit.y})`);
  });
}

document.fonts.load('400 100px "Graduate"').then(fitEndzoneLabels).catch(() => {});

function updateField(game) {
  const home = game.homeAway === "home" ? game.selectedTeam : game.opponent;
  const away = game.homeAway === "home" ? game.opponent : game.selectedTeam;
  const field = document.querySelector(".field-wrap");
  const homeBranding = fieldBranding(home);
  const awayBranding = fieldBranding(away);
  field.style.setProperty("--home-color", homeBranding.color);
  field.style.setProperty("--away-color", awayBranding.color);
  field.style.setProperty("--home-ink", homeBranding.ink);
  field.style.setProperty("--away-ink", awayBranding.ink);
  for (const [selector, text] of [["#endzone-school", away.mascot], ["#endzone-mascot", home.mascot]]) {
    const label = document.querySelector(selector);
    label.textContent = text.toUpperCase();
  }
  fitEndzoneLabels();
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
  const lineToGain = document.querySelector("#first-down-marker");
  const redzone = document.querySelector("#redzone-tint");
  const inRedzone = Boolean(game.ball && ((game.ball.direction === "left" && game.ball.percent <= 20)
    || (game.ball.direction === "right" && game.ball.percent >= 80)));
  redzone.setAttribute("visibility", inRedzone ? "visible" : "hidden");
  redzone.setAttribute("x", game.ball?.direction === "left" ? "104" : "737.6");
  const hasLineToGain = game.ball && Number.isFinite(game.ball.firstDownPercent);
  lineToGain.setAttribute("visibility", hasLineToGain ? "visible" : "hidden");
  if (hasLineToGain) lineToGain.style.transform = `translateX(${104 + game.ball.firstDownPercent * 7.92}px)`;
  marker.setAttribute("visibility", game.ball ? "visible" : "hidden");
  if (game.ball) {
    marker.style.transform = `translateX(${104 + game.ball.percent * 7.92}px)`;
    const possession = document.createElement("span");
    possession.className = "possession-team";
    possession.textContent = game.ball.possession;
    const down = document.createElement("span");
    down.className = "down-distance";
    down.textContent = game.ball.downDistance?.split(/\s+at\s+/i)[0] ?? "Ball position";
    down.classList.toggle("is-fourth-down", /^4th\b/i.test(down.textContent));
    const position = game.ball.label ?? (game.ball.percent === 50 ? "50-yard line"
      : game.ball.percent < 50 ? `${away.abbreviation} ${game.ball.percent}` : `${home.abbreviation} ${100 - game.ball.percent}`);
    const pause = game.ballHeld && /timeout/i.test(game.fieldContext?.lastPlayType ?? "") ? "TIMEOUT · " : "";
    document.querySelector("#ball-detail").replaceChildren(pause, possession, " · ", down, ` · ${position}`);
  } else {
    document.querySelector("#ball-detail").textContent = game.state === "live"
      ? game.fieldContext?.scoring
        ? `${/touchdown/i.test(game.fieldContext.lastPlayType) ? "TOUCHDOWN" : "SCORING PLAY"} · awaiting next play`
        : "TIMEOUT · awaiting ball position"
       : game.state === "final" ? "FINAL" : "Ball position appears during play";
  }

}

function renderDrives(game) {
  const key = `${game.league}:${game.id}`;
  if (key !== driveGameId) { driveGameId = key; selectedDriveId = null; }
  const drives = game.drives ?? [];
  if (selectedDriveId && !drives.some((drive) => drive.id === selectedDriveId)) selectedDriveId = null;
  const selected = drives.find((drive) => drive.id === selectedDriveId) ?? drives.at(-1);
  const index = drives.indexOf(selected);
  const history = document.querySelector("#drive-history");
  const driveList = document.querySelector("#drive-list");
  history.hidden = drives.length === 0;
  driveList.replaceChildren();
  document.querySelector("#drive-count").textContent = drives.length ? `· ${drives.length}` : "";
  for (const [position, drive] of drives.entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.driveId = drive.id;
    button.className = "drive-item";
    button.setAttribute("aria-pressed", String(drive.id === selected?.id));
    const title = document.createElement("strong");
    title.textContent = `${drive.team} · ${drive.result ?? (position === drives.length - 1 && game.state === "live" ? "IN PROGRESS" : "DRIVE")}`;
    const detail = document.createElement("span");
    detail.textContent = drive.description ?? `${drive.plays.length} reported plays`;
    button.append(title, detail);
    driveList.prepend(button);
  }
  document.querySelector("#drive-current").hidden = !selected || index === drives.length - 1;
  document.querySelector("#plays-heading").textContent = selected
    ? index === drives.length - 1 ? (game.state === "live" ? "CURRENT DRIVE" : "LAST DRIVE") : "PREVIOUS DRIVE"
    : game.state === "final" ? "LAST PLAYS · COMPLETED GAME" : "RECENT PLAYS";
  const title = document.querySelector("#drive-title");
  title.hidden = !selected || index === drives.length - 1;
  title.textContent = title.hidden ? "" : `${selected.team} · ${selected.result ?? "DRIVE"}`;
  document.querySelector("#drive-summary").textContent = selected
    ? selected.description ?? [
      `${selected.plays.length} reported plays`,
      selected.yards == null ? null : `${selected.yards} yards`, selected.time,
    ].filter(Boolean).join(" · ") : "";
  const list = document.querySelector("#recent-plays");
  const content = document.querySelector("#drive-content");
  const sameDrive = selected?.id === renderedDriveId;
  const oldScroll = content.scrollTop;
  const browsingHistory = oldScroll > Math.max(0, list.offsetTop + list.offsetHeight - content.clientHeight) + 12;
  const newPlay = selected?.plays.at(-1)?.id !== renderedLastPlayId;
  list.replaceChildren();
  for (const play of selected ? [...selected.plays].reverse() : game.plays ?? []) {
    const item = document.createElement("li");
    item.dataset.playId = play.id;
    const time = document.createElement("span");
    time.textContent = `${play.period > 4 ? `OT${play.period - 4}` : `Q${play.period ?? "—"}`} · ${play.clock ?? "—"}`;
    const text = document.createElement("span");
    text.textContent = /^END QUARTER 2\.?$/i.test(play.text.trim()) ? "HALFTIME" : play.text;
    if (play.penalty) {
      const badge = document.createElement("b");
      badge.className = "penalty-badge";
      badge.textContent = `FLAG · ${play.penalty}`;
      text.prepend(badge);
      item.classList.add("penalty-play");
    }
    item.classList.toggle("scoring-play", play.scoring);
    const scoringTeam = [game.selectedTeam, game.opponent].find((team) => team.id === play.scoringTeamId);
    if (scoringTeam) {
      item.style.setProperty("--scoring-color", scoringTeam.color);
      item.classList.add("has-scoring-team");
    }
    item.append(time, text);
    list.append(item);
  }
  if (!list.children.length) {
    const item = document.createElement("li");
    item.textContent = game.state === "scheduled" ? "Play-by-play begins at kickoff." : "Play-by-play unavailable. Scores will continue updating.";
    list.append(item);
  }
  content.scrollTop = sameDrive && (selectedDriveId || !newPlay || browsingHistory) ? oldScroll : 0;
  renderedDriveId = selected?.id ?? null;
  renderedLastPlayId = selected?.plays.at(-1)?.id ?? null;
}

document.querySelector("#drive-current").addEventListener("click", () => {
  selectedDriveId = null;
  if (displayedGame) renderDrives(displayedGame);
});
document.querySelector("#drive-list").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-drive-id]");
  if (!button || !displayedGame?.drives?.some((drive) => drive.id === button.dataset.driveId)) return;
  selectedDriveId = button.dataset.driveId === displayedGame.drives.at(-1).id ? null : button.dataset.driveId;
  renderDrives(displayedGame);
});

function updatePossession(game) {
  const branding = possessionBranding(game);
  const detail = document.querySelector("#ball-detail");
  detail.style.setProperty("--possession-color", branding.color);
  detail.style.setProperty("--possession-ink", branding.ink);
  const home = game?.homeAway === "home" ? game.selectedTeam : game?.opponent;
  const away = game?.homeAway === "home" ? game.opponent : game?.selectedTeam;
  for (const [side, team] of [["home", home], ["away", away]]) {
    const football = document.querySelector(`#${side}-possession`);
    football.toggleAttribute("hidden", !team || game?.state !== "live" || game.possessionTeamId !== team.id);
    football.setAttribute("aria-label", `${team?.location ?? side} has possession`);
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

function renderTeam(side, team, league) {
  document.querySelector(`#${side}-team`).dataset.teamId = team.id;
  document.querySelector(`#${side}-team`).classList.toggle("is-selected", team.id === selectedTeamId);
  const name = document.querySelector(`#${side}-name`);
  name.textContent = rankedName(team);
  name.title = team.rank ? team.rankSource ?? "ESPN event ranking" : "";
  const record = document.querySelector(`#${side}-record`);
  record.textContent = teamRecordLabel(team, league);
  record.title = league === "nfl" && team.divisionStanding
    ? "Current division standing from ESPN; matchup record shown when available" : "";
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

function renderLeaders(game) {
  const live = game?.state === "live";
  document.querySelector(".next-game").hidden = live;
  const section = document.querySelector("#game-leaders");
  section.hidden = !live;
  const list = document.querySelector("#leader-list");
  list.replaceChildren();
  if (!live) return;
  const away = game.homeAway === "home" ? game.opponent : game.selectedTeam;
  const home = game.homeAway === "home" ? game.selectedTeam : game.opponent;
  const teams = document.createElement("div");
  teams.className = "leader-teams";
  for (const [index, team] of [away, home].entries()) {
    const side = document.createElement("div");
    side.className = "leader-team";
    const name = document.createElement("strong");
    name.textContent = team.abbreviation;
    const logo = document.createElement("span");
    logo.className = "leader-team-logo";
    setTeamLogo(logo, team);
    if (index === 0) side.append(logo, name);
    else side.append(name, logo);
    teams.append(side);
  }
  list.append(teams);
  for (const { category, leaders } of game.leaders ?? []) {
    const row = document.createElement("div");
    row.className = "leader-row";
    const label = document.createElement("strong");
    label.className = "leader-category";
    label.textContent = { passingYards: "Passing Yards", rushingYards: "Rushing Yards",
      receivingYards: "Receiving Yards" }[category] ?? category;
    for (const [side, team] of [away, home].entries()) {
      const leader = leaders.find((item) => item.teamId === team.id);
      const cell = document.createElement("div");
      cell.className = "leader-cell";
      const portrait = document.createElement("span");
      portrait.className = "leader-portrait";
      portrait.textContent = leader?.name?.[0] ?? "—";
      if (leader?.headshot) {
        const image = document.createElement("img");
        image.alt = "";
        image.src = leader.headshot;
        image.onerror = () => image.remove();
        portrait.append(image);
      }
      const name = document.createElement("div");
      name.className = "leader-name";
      name.textContent = leader?.shortName ?? "Stats unavailable";
      if (leader?.position) {
        const position = document.createElement("span");
        position.textContent = ` ${leader.position}`;
        name.append(position);
      }
      const attempts = document.createElement("span");
      attempts.className = "leader-metric";
      attempts.textContent = leader?.attempts ?? "—";
      const yards = document.createElement("span");
      yards.className = "leader-metric";
      yards.textContent = `${leader?.yards ?? leader?.value?.match(/\b(\d+)\s+YDS?\b/i)?.[1] ?? "—"} YDS`;
      const touchdowns = document.createElement("span");
      touchdowns.className = "leader-metric";
      touchdowns.textContent = `${leader?.touchdowns ?? "—"} TD`;
      const extras = document.createElement("span");
      extras.className = "leader-extras";
      extras.textContent = [leader?.interceptions > 0 ? `${leader.interceptions} INT` : null,
        leader?.fumbles > 0 ? `${leader.fumbles} FUM` : null].filter(Boolean).join(" · ");
      if (side === 0) cell.append(portrait, name, attempts, yards, touchdowns, extras);
      else cell.append(extras, attempts, yards, touchdowns, name, portrait);
      row.append(cell);
    }
    row.insertBefore(label, row.children[1]);
    list.append(row);
  }
}

function updateGame(game, nextGame) {
  displayedGame = game;
  updateCountdown();
  lastGameState = game?.state ?? null;
  elements.gameClock.hidden = true;
  elements.gameClock.textContent = "";
  updatePossession(game);
  renderNextDetails(nextGame);
  renderLeaders(game);
  if (!game) {
    elements.gameDetail.hidden = true;
    driveGameId = null;
    selectedDriveId = null;
    renderedDriveId = null;
    renderedLastPlayId = null;
    document.querySelector("#drive-history").hidden = true;
    document.querySelector("#recent-plays").replaceChildren();
    elements.gameLabel.textContent = "SEASON SCHEDULE";
    elements.gameVenue.textContent = "No game is currently available";
    return;
  }

  const upcoming = game.state === "scheduled";
  elements.gameDetail.hidden = true;
  const isHome = game.homeAway === "home";

  elements.gameLabel.textContent = kickoffText(game);
  renderTeam("away", isHome ? game.opponent : game.selectedTeam, game.league);
  renderTeam("home", isHome ? game.selectedTeam : game.opponent, game.league);
  updateField(game);
  renderDrives(game);
  elements.gameVenue.textContent = game.venue ?? "VENUE TBD";
  document.querySelector("#game-broadcast").textContent = game.broadcasts?.join(" / ") || "TBD";

  if (game.state === "live") {
    const quarter = game.period === 2 && /end (?:of )?(?:quarter )?2|halftime|end of (?:the )?(?:2nd|second) quarter|end of half/i.test(game.status)
      ? "HALFTIME" : game.period > 4 ? `OT${game.period - 4}` : game.period ? `Q${game.period}` : "LIVE";
    elements.gameClock.textContent = `${quarter}${quarter !== "HALFTIME" && game.clock ? ` · ${game.clock}` : ""}`;
    elements.gameClock.hidden = false;
    elements.gameDetail.textContent = "";
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

function updateCountdown() {
  const countdown = kickoffCountdown(displayedGame);
  const container = document.querySelector("#kickoff-countdown");
  container.hidden = countdown === null;
  document.querySelector(".score-readout").hidden = countdown !== null;
  // The surrounding score panel is a live region; do not announce every second.
  if (countdown !== null) document.querySelector("#kickoff-countdown-value").textContent = countdown;
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

    lastPayload = payload;
    updateBrand(payload);
    updateGame(ballPositionTracker.observe(payload), payload.nextGame);
    updateHighlights(payload);
    document.querySelector("#season-year").textContent = payload.season ?? "";
    setFeedState(payload.stale ? "stale" : "fresh", payload.refreshedAt);
    if (payload.gamecastUnavailable) elements.feedLabel.textContent += " · GAMECAST UNAVAILABLE";
    if (payload.stale) {
      elements.gameClock.hidden = true;
      document.querySelector("#ball-marker").setAttribute("visibility", "hidden");
      document.querySelector("#first-down-marker").setAttribute("visibility", "hidden");
      updatePossession(null);
      document.querySelector("#ball-detail").textContent = lastGameState === "final" ? "FINAL" : "Feed delayed · last known score and plays";
      elements.gameStatusText.textContent = "FEED DELAYED";
      elements.gameStatus.classList.remove("is-live");
    }
  } catch {
    ballPositionTracker.reset();
    elements.gameClock.hidden = true;
    hideHighlight();
    highlightTracker.observe(null);
    setFeedState("error");
    elements.gameStatusText.textContent = "OFFLINE";
    elements.gameStatus.classList.remove("is-live", "is-upcoming");
    elements.gameDetail.textContent = "Can’t reach the score feed. Retrying automatically.";
    document.querySelector("#ball-marker").setAttribute("visibility", "hidden");
    document.querySelector("#first-down-marker").setAttribute("visibility", "hidden");
    updatePossession(null);
    document.querySelector("#ball-detail").textContent = lastGameState === "final" ? "FINAL" : "Offline · last known score and plays";
  } finally {
    elements.panel.setAttribute("aria-busy", "false");
    elements.refreshButton.classList.remove("is-spinning");
    refreshing = false;
  }
}

async function startDriveDemo() {
  const { createDemoFrames } = await import("./demo.js");
  const frames = createDemoFrames();
  let index = 0;
  let paused = false;
  let timer;
  const controls = document.querySelector("#demo-controls");
  const toggle = document.querySelector("#demo-toggle");
  const next = document.querySelector("#demo-next");
  const speed = document.querySelector("#demo-speed");
  controls.hidden = false;
  elements.refreshButton.hidden = true;
  updateBrand(frames[0]);
  document.title = `Drive Demo · ${frames[0].team.name} Football Scoreboard`;
  document.querySelector("#season-year").textContent = "DEMO";
  elements.panel.setAttribute("aria-busy", "false");
  let tracker = createHighlightTracker();

  function schedule() {
    clearTimeout(timer);
    if (!paused && index < frames.length - 1) timer = setTimeout(() => { index++; render(); }, 5_000 / Number(speed.value));
  }

  function render() {
    hideHighlight();
    const frame = frames[index];
    updateGame(frame.spotlight, null);
    // Replays and manual stepping must still establish a fresh tracker baseline.
    if (index === 0) tracker = createHighlightTracker();
    const event = tracker.observe(frame, index * 5_000);
    if (event) showHighlight(event, frame.spotlight, true, 3_200 / Number(speed.value));
    document.querySelectorAll(".team-record").forEach((record) => { record.textContent = "SIMULATED GAME"; });
    elements.gameLabel.textContent = "DRIVE DEMO";
    elements.gameStatusText.textContent = "DEMO";
    elements.gameStatus.classList.remove("is-live");
    elements.gameDetail.textContent = "SIMULATED GAME";
    elements.feedLabel.textContent = "OFFLINE DEMO · FICTIONAL PLAYS";
    elements.nextOpponent.textContent = "TD + XP · FIELD GOAL · PUNT · BLOCKED PUNT";
    elements.nextDetail.textContent = "Accelerated playback · 5 seconds per step at 1×";
    document.querySelector("#next-predictor").textContent = "Home offense moves left · Away offense moves right";
    if (!frame.spotlight.ball) document.querySelector("#ball-detail").textContent = "Between plays · simulated game";
    document.querySelector("#demo-step").textContent = `${index + 1} / ${frames.length} · ${frame.caption}`;
    document.querySelector("#demo-progress").max = frames.length;
    document.querySelector("#demo-progress").value = index + 1;
    if (index === frames.length - 1) paused = true;
    toggle.textContent = paused ? "Play" : "Pause";
    toggle.disabled = next.disabled = index === frames.length - 1;
    schedule();
  }

  toggle.addEventListener("click", () => {
    paused = !paused;
    toggle.textContent = paused ? "Play" : "Pause";
    schedule();
  });
  next.addEventListener("click", () => {
    paused = true;
    index = Math.min(index + 1, frames.length - 1);
    render();
  });
  document.querySelector("#demo-restart").addEventListener("click", () => { index = 0; paused = false; render(); });
  speed.addEventListener("change", schedule);
  render();
}

if (new URLSearchParams(location.search).get("demo") === "drive") {
  startDriveDemo();
} else {
  const polling = createRefreshLoop({ refresh: refreshScoreboard, getPayload: () => lastPayload });
  elements.refreshButton.addEventListener("click", polling.refreshNow);
  polling.start();
  window.setInterval(updateCountdown, 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { updateCountdown(); polling.refreshNow(); }
  });
}
