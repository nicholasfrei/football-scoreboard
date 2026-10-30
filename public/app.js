import { createHighlightTracker, highlightDetail, highlightDuration, HIGHLIGHT_LABELS } from "./highlights.js";
import { endzoneTextLayout, fieldBranding } from "./field-branding.js";
import { possessionBranding } from "./possession-branding.js";
import { teamRecordLabel } from "./team-record.js";
import { kickoffCountdown, createRefreshLoop } from "./game-timing.js";
import { ballPositionFallback, createBallPositionTracker } from "./ball-position.js";
import { DISPLAY_WIDTH, DISPLAY_HEIGHT, displayScale } from "./display-size.js";
import { leaderCardTeams, showGameLeaders } from "./leader-layout.js";
import { illustratedDrive, lastDriveSnap } from "./drive-illustration.js";
import { driveSummaryLabel } from "./drive-summary.js";
import { createBallPlacement, ROUTE_DURATION_MS, RETURN_DELAY_MS, RETURN_DURATION_MS } from "./field-animation.js";
import { startTeamPicker } from "./team-picker.js";

function fitDisplay() {
  const scale = displayScale(window.innerWidth, window.innerHeight);
  const stage = document.querySelector(".stage");
  stage.style.width = `${DISPLAY_WIDTH * scale}px`;
  stage.style.height = `${DISPLAY_HEIGHT * scale}px`;
  document.querySelector(".mount").style.transform = `scale(${scale})`;
}

fitDisplay();
window.addEventListener("resize", fitDisplay);

let lastPayload = null;
let displayedGame = null;
let timeZone = "America/Chicago";
let selectedTeamId = null;
const highlightTracker = createHighlightTracker();
const ballPositionTracker = createBallPositionTracker();
const ballPlacement = createBallPlacement({ render: updateFootballMarker });
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let highlightTimer;
let activeHighlight = null;
let previewPending = new URLSearchParams(location.search).get("preview");
let driveGameId = null;
let selectedDriveId = null; // null follows the newest drive through live updates.
let renderedDriveId = null;
let renderedLastPlayId = null;
let renderedIllustrationKey = null;
let renderedIllustratedPlayId = null;
let renderedIllustrationView = null;
let renderedRouteAnimation = null;
let renderedPenaltyMotionKey = null;
const SVG_NS = "http://www.w3.org/2000/svg";

function svgElement(tag, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  return element;
}

function renderFieldDrive(game, drive) {
  const layer = document.querySelector("#drive-illustration");
  const key = drive ? `${game.league}:${game.id}:${drive.id}:${JSON.stringify([
    drive.result, drive.description, game.state, game.currentDriveId,
    drive.plays.map((play) => [play.id, play.trajectory, play.snapPercent, play.penaltyMotion, play.type]),
  ])}` : null;
  // Repeated polls must not replay the same play or move the route backwards.
  if (key === renderedIllustrationKey) return renderedRouteAnimation;
  const previousIllustratedPlayId = renderedIllustratedPlayId;
  const previousPenaltyMotionKey = renderedPenaltyMotionKey;
  const view = `${game.league}:${game.id}:${game.homeAway}:${selectedDriveId ?? "current"}`;
  const animate = renderedIllustrationKey !== null && key !== null && renderedIllustrationView === view && !reducedMotion.matches;
  renderedIllustrationView = view;
  renderedRouteAnimation = null;
  renderedIllustrationKey = key;
  renderedIllustratedPlayId = null;
  renderedPenaltyMotionKey = null;
  layer.replaceChildren();
  if (!drive) return;
  const home = game.homeAway === "home" ? game.selectedTeam : game.opponent;
  const track = illustratedDrive({ ...drive, direction: drive.teamId === home.id ? "left" : "right" });
  const finalSnap = lastDriveSnap(drive.plays);
  const latest = drive.plays.at(-1);
  const penaltyMotion = latest === finalSnap ? finalSnap?.penaltyMotion : null;
  renderedPenaltyMotionKey = penaltyMotion ? `${game.league}:${game.id}:${drive.id}:${finalSnap.id}:${JSON.stringify(penaltyMotion)}` : null;
  if (!track.segment && !finalSnap) return;
  // If the last offensive snap is a kick or a penalty, do not replay an older
  // pass as if it were the final play. Keep only the net drive line.
  const current = track.segment;
  layer.style.setProperty("--route-duration", `${ROUTE_DURATION_MS}ms`);
  layer.style.setProperty("--return-delay", `${RETURN_DELAY_MS}ms`);
  layer.style.setProperty("--return-duration", `${RETURN_DURATION_MS}ms`);
  const rememberAnimation = (element, durationMs, start = current?.start) => {
    // The final animated leg determines when the ball may be placed.
    renderedRouteAnimation = { element, durationMs, start, playId: finalSnap.id };
  };
  renderedIllustratedPlayId = current?.id ?? null;
  const color = [game.selectedTeam, game.opponent].find((team) => team.id === drive.teamId)?.color ?? "#d6b46a";
  layer.style.setProperty("--drive-color", color);
  const driveStart = track.start ?? finalSnap?.snapPercent;
  if (track.progressPath) layer.append(svgElement("path", { d: track.progressPath, class: "drive-progress", fill: "none" }));
  for (const d of track.penaltyPaths) {
    const path = svgElement("path", { d, class: "drive-penalty", fill: "none" });
    if (animate && renderedPenaltyMotionKey !== previousPenaltyMotionKey) {
      const mask = svgElement("mask", { id: "penalty-reveal", maskUnits: "userSpaceOnUse",
        x: 0, y: 0, width: 1000, height: 440 });
      const reveal = svgElement("path", { d, class: "route-reveal", fill: "none", pathLength: 100 });
      mask.append(reveal);
      layer.append(mask);
      path.setAttribute("mask", "url(#penalty-reveal)");
      rememberAnimation(reveal, ROUTE_DURATION_MS, penaltyMotion.start);
    }
    layer.append(path);
  }
  if (current) {
    const group = svgElement("g", { class: "drive-latest" });
    const path = current.path && svgElement("path", { d: current.path, class: `drive-route is-${current.kind}`, fill: "none" });
    if (path && animate && current.id !== previousIllustratedPlayId) {
      // Reveal a solid or dotted route with the same mask, regardless of direction.
      // Use field coordinates: the default object-bounding-box mask has zero
      // height for a horizontal rush (or pass) and hides its entire route.
      const mask = svgElement("mask", { id: "route-reveal", maskUnits: "userSpaceOnUse",
        x: 0, y: 0, width: 1000, height: 440 });
      const reveal = svgElement("path", { d: current.path, class: "route-reveal", fill: "none", pathLength: 100 });
      mask.append(reveal);
      rememberAnimation(reveal, ROUTE_DURATION_MS);
      group.append(mask);
      path.setAttribute("mask", "url(#route-reveal)");
    }
    if (path) group.append(path);
    if (current.yacPath) {
      const yac = svgElement("path", { d: current.yacPath, class: "drive-yac-route", fill: "none" });
      if (animate && current.id !== previousIllustratedPlayId) {
        yac.setAttribute("pathLength", "100");
        yac.classList.add("is-revealing");
        rememberAnimation(yac, RETURN_DELAY_MS + RETURN_DURATION_MS);
      }
      group.append(yac);
      group.append(svgElement("circle", { cx: current.to, cy: current.y, r: 6, class: "drive-catch" }));
      const label = svgElement("text", { x: (current.to + current.finish) / 2,
        y: current.y + 38, class: "drive-yac-label", "text-anchor": "middle" });
      label.textContent = current.kind === "punt" ? `${current.returnYards} YD RETURN` : `${current.yac} YAC`;
      group.append(label);
    }
    if (current.kind === "interception" || current.kind === "fumble-return") {
      if (current.returnPath) {
        const returning = svgElement("path", { d: current.returnPath, class: "drive-return-route", fill: "none" });
        if (animate && current.id !== previousIllustratedPlayId) {
          returning.setAttribute("pathLength", "100");
          returning.classList.add("is-revealing");
          rememberAnimation(returning, RETURN_DELAY_MS + RETURN_DURATION_MS);
        }
        group.append(returning);
        if (current.kind === "interception") {
          const label = svgElement("text", { x: (current.to + current.finish) / 2,
            y: current.y + 38, class: "drive-return-label", "text-anchor": "middle" });
          label.textContent = `${current.returnYards} YD RETURN`;
          group.append(label);
        }
      }
      if (current.kind === "interception") group.append(svgElement("circle", { cx: current.to, cy: current.y, r: 7, class: "drive-pick" }));
    }
    if (current.kind === "incomplete") {
      const cross = svgElement("g", { class: "drive-miss" });
      const y = current.y;
      cross.append(svgElement("path", { d: `M ${current.to - 10} ${y - 10} L ${current.to + 10} ${y + 10} M ${current.to + 10} ${y - 10} L ${current.to - 10} ${y + 10}` }));
      group.append(cross);
    } else if (current.kind !== "interception" || current.returnPath) group.append(svgElement("circle", {
      cx: current.finish, cy: current.y, r: 8,
      class: current.kind === "interception" || current.kind === "fumble-return" ? "drive-end is-interception" : "drive-end",
    }));
    layer.append(group);
  }
  layer.prepend(svgElement("circle", { cx: 104 + driveStart * 7.92, cy: 220,
    r: 8, class: "drive-start" }));
  if (track.finalMarker) {
    layer.append(svgElement("circle", { cx: track.finalMarker.x, cy: track.finalMarker.y,
      r: 11, class: "drive-final", "aria-label": `Final offensive snap: ${finalSnap.type ?? "play"}` }));
  }
  return renderedRouteAnimation;
}

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
        event.id === activeHighlight.id && event.phase === activeHighlight.phase
        && event.kind === activeHighlight.kind && event.teamId === activeHighlight.teamId);
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
  updateBallMarkers(game);
}

function updateBallMarkers(game) {
  const home = game.homeAway === "home" ? game.selectedTeam : game.opponent;
  const away = game.homeAway === "home" ? game.opponent : game.selectedTeam;
  const lineToGain = document.querySelector("#first-down-marker");
  const redzone = document.querySelector("#redzone-tint");
  const inRedzone = Boolean(game.ball && ((game.ball.direction === "left" && game.ball.percent <= 20)
    || (game.ball.direction === "right" && game.ball.percent >= 80)));
  redzone.setAttribute("visibility", inRedzone ? "visible" : "hidden");
  redzone.setAttribute("x", game.ball?.direction === "left" ? "104" : "737.6");
  const hasLineToGain = game.ball && Number.isFinite(game.ball.firstDownPercent);
  lineToGain.setAttribute("visibility", hasLineToGain ? "visible" : "hidden");
  const isFourthDown = /^4th\b/i.test(game.ball?.downDistance ?? "");
  lineToGain.classList.toggle("is-fourth-down", isFourthDown);
  if (hasLineToGain) lineToGain.style.transform = `translateX(${104 + game.ball.firstDownPercent * 7.92}px)`;
  if (game.ball) {
    const possession = document.createElement("span");
    possession.className = "possession-team";
    possession.textContent = game.ball.possession;
    const down = document.createElement("span");
    down.className = "down-distance";
    down.textContent = game.ball.downDistance?.split(/\s+at\s+/i)[0] ?? "Ball position";
    down.classList.toggle("is-fourth-down", isFourthDown);
    const position = game.ball.label ?? (game.ball.percent === 50 ? "50-yard line"
      : game.ball.percent < 50 ? `${away.abbreviation} ${game.ball.percent}` : `${home.abbreviation} ${100 - game.ball.percent}`);
    const pause = game.ballHeld && /timeout/i.test(game.fieldContext?.lastPlayType ?? "") ? "TIMEOUT · " : "";
    document.querySelector("#ball-detail").replaceChildren(pause, possession, " · ", down, ` · ${position}`);
  } else {
    document.querySelector("#ball-detail").textContent = ballPositionFallback(game);
  }

}

function updateFootballMarker(game, { hidden = false } = {}) {
  const visibility = !hidden && game.ball ? "visible" : "hidden";
  for (const selector of ["#football-marker", "#ball-marker"]) {
    const marker = document.querySelector(selector);
    // No hide/show cycle or transform reset when an incompletion keeps the spot.
    if (marker.getAttribute("visibility") !== visibility) marker.setAttribute("visibility", visibility);
    if (game.ball) {
      const transform = `translateX(${104 + game.ball.percent * 7.92}px)`;
      if (marker.style.transform !== transform) marker.style.transform = transform;
    }
  }
}

function renderDrives(game) {
  const key = `${game.league}:${game.id}`;
  if (key !== driveGameId) { driveGameId = key; selectedDriveId = null; }
  const drives = game.drives ?? [];
  if (selectedDriveId && !drives.some((drive) => drive.id === selectedDriveId)) selectedDriveId = null;
  const selected = drives.find((drive) => drive.id === selectedDriveId) ?? drives.at(-1);
  if (selected && selected.id !== drives.at(-1)?.id) {
    for (const selector of ["#ball-marker", "#first-down-marker", "#redzone-tint"]) {
      document.querySelector(selector).setAttribute("visibility", "hidden");
    }
  }
  const animation = renderFieldDrive(game, selected);
  const playId = game.fieldContext?.lastPlayId ?? game.latestPlayOrder?.at(-1);
  const startGame = { ...game, ball: animation ? { percent: animation.start } : null };
  ballPlacement.update({
    key: `${game.league}:${game.id}:${game.homeAway}:${selected?.id}:${playId}`,
    game, startGame,
    animation: animation?.playId === playId ? animation : null,
    visible: (!selected || selected.id === drives.at(-1)?.id)
      && !document.querySelector(".field-wrap").classList.contains("is-feed-delayed"),
    reducedMotion: reducedMotion.matches,
  });
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
    detail.textContent = driveSummaryLabel(drive);
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
  document.querySelector("#drive-summary").textContent = driveSummaryLabel(selected);
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
     const downDistance = [1, 2, 3, 4].includes(play.down) && Number.isFinite(play.distance)
       ? ` · ${["", "1st", "2nd", "3rd", "4th"][play.down]} & ${play.distance}` : "";
     time.textContent = `${play.period > 4 ? `OT${play.period - 4}` : `Q${play.period ?? "—"}`} · ${play.clock ?? "—"}${downDistance}`;
    const text = document.createElement("span");
    const description = document.createElement("span");
    description.className = "play-description";
    description.textContent = /^END QUARTER 2\.?$/i.test(play.text.trim()) ? "HALFTIME" : play.text;
    text.append(description);
    if (play.penalty) {
      const badge = document.createElement("b");
      badge.className = "penalty-badge";
      badge.textContent = `FLAG · ${play.penalty}`;
      text.prepend(badge);
      item.classList.add("penalty-play");
    }
    item.classList.toggle("scoring-play", play.scoring);
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
  if (displayedGame) { updateField(displayedGame); renderDrives(displayedGame); }
});
reducedMotion.addEventListener("change", () => {
  if (displayedGame) renderDrives(displayedGame);
});
document.querySelector("#drive-list").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-drive-id]");
  if (!button || !displayedGame?.drives?.some((drive) => drive.id === button.dataset.driveId)) return;
  selectedDriveId = button.dataset.driveId === displayedGame.drives.at(-1).id ? null : button.dataset.driveId;
  updateField(displayedGame);
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
  name.textContent = league === "nfl" ? team.name ?? rankedName(team) : rankedName(team);
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

function renderLeaders(game, demo = false) {
  const visible = showGameLeaders(game, demo);
  document.querySelector(".next-game").hidden = visible;
  const section = document.querySelector("#game-leaders");
  section.hidden = !visible;
  const list = document.querySelector("#leader-list");
  list.replaceChildren();
  if (!visible) return;
  const [away, home] = leaderCardTeams(game);
  for (const { category, leaders } of game.leaders ?? []) {
    const card = document.createElement("section");
    card.className = "leader-card";
    const label = document.createElement("h3");
    label.className = "leader-category";
    label.textContent = { passingYards: "Passing", rushingYards: "Rushing",
      receivingYards: "Receiving" }[category] ?? category;
    card.setAttribute("aria-label", `${label.textContent} leaders`);
    card.append(label);
    for (const [side, team] of [away, home].entries()) {
      const leader = leaders.find((item) => item.teamId === team.id);
      const cell = document.createElement("div");
      cell.className = "leader-cell";
      cell.dataset.side = side === 0 ? "away" : "home";
      cell.setAttribute("aria-label", `${team.name} · ${side === 0 ? "Away" : "Home"}`);
      const teamIdentity = document.createElement("div");
      teamIdentity.className = "leader-team";
      const teamLogo = document.createElement("span");
      teamLogo.className = "leader-team-logo";
      setTeamLogo(teamLogo, team);
      teamIdentity.append(teamLogo);
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
      const position = document.createElement("span");
      position.className = "leader-position";
      position.textContent = leader?.position ?? "";
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
      yards.classList.add("leader-yards");
      const identity = document.createElement("div");
      identity.className = "leader-identity";
      identity.append(name, position);
      const stats = document.createElement("div");
      stats.className = "leader-stats";
      stats.append(attempts, yards, touchdowns, extras);
      const details = document.createElement("div");
      details.className = "leader-details";
      details.append(identity, stats);
      cell.append(teamIdentity, portrait, details);
      card.append(cell);
    }
    list.append(card);
  }
}

function updateGame(game, nextGame, demo = false) {
  displayedGame = game;
  updateCountdown();
  lastGameState = game?.state ?? null;
  elements.gameClock.hidden = true;
  elements.gameClock.textContent = "";
  updatePossession(game);
  renderNextDetails(nextGame);
  renderLeaders(game, demo);
  if (!game) {
    ballPlacement.reset();
    document.querySelector("#football-marker").setAttribute("visibility", "hidden");
    renderFieldDrive({ league: "", id: "" }, null);
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
  document.querySelector("#away-side").textContent = game.neutralSite ? "DESIGNATED AWAY" : "AWAY";
  document.querySelector("#home-side").textContent = game.neutralSite ? "DESIGNATED HOME" : "HOME";
  updateField(game);
  renderDrives(game);
  elements.gameVenue.textContent = game.venue ?? "VENUE TBD";
  document.querySelector("#game-broadcast").textContent = game.broadcasts?.join(" / ") || "TBD";

  if (game.state === "live") {
    const quarter = game.period === 2 && /end (?:of )?(?:quarter )?2|halftime|end of (?:the )?(?:2nd|second) quarter|end of half/i.test(game.status)
      ? "HALFTIME" : game.period > 4 ? `OT${game.period - 4}` : game.period ? `Q${game.period}` : "LIVE";
    const period = document.createElement("span");
    period.className = "clock-period";
    period.textContent = quarter;
    elements.gameClock.replaceChildren(period);
    if (quarter !== "HALFTIME" && game.clock) {
      const clock = document.createElement("strong");
      clock.className = "clock-time";
      clock.textContent = game.clock;
      elements.gameClock.append(clock);
    }
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
let activeTeamKey = null;
async function refreshScoreboard() {
  if (refreshing) return;
  refreshing = true;
  elements.refreshButton.classList.add("is-spinning");
  try {
    const query = activeTeamKey ? `?team=${encodeURIComponent(activeTeamKey)}` : "";
    const response = await fetch(`/api/scoreboard${query}`, { cache: "no-store", signal: AbortSignal.timeout(35_000) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Score feed request failed");

    lastPayload = payload;
    document.querySelector(".field-wrap").classList.toggle("is-feed-delayed", Boolean(payload.stale || payload.gamecastUnavailable));
    updateBrand(payload);
    updateGame(ballPositionTracker.observe(payload), payload.nextGame);
    updateHighlights(payload);
    document.querySelector("#season-year").textContent = payload.season ?? "";
    setFeedState(payload.stale ? "stale" : "fresh", payload.refreshedAt);
    if (payload.gamecastUnavailable) elements.feedLabel.textContent += " · GAMECAST UNAVAILABLE";
    if (payload.stale) {
      elements.gameClock.hidden = true;
      document.querySelector("#ball-marker").setAttribute("visibility", "hidden");
      document.querySelector("#football-marker").setAttribute("visibility", "hidden");
      document.querySelector("#first-down-marker").setAttribute("visibility", "hidden");
      updatePossession(null);
      document.querySelector("#ball-detail").textContent = lastGameState === "final" ? "FINAL" : "Feed delayed · last known score and plays";
      elements.gameStatusText.textContent = "FEED DELAYED";
      elements.gameStatus.classList.remove("is-live");
    }
  } catch {
    document.querySelector(".field-wrap").classList.add("is-feed-delayed");
    ballPositionTracker.reset();
    ballPlacement.reset();
    elements.gameClock.hidden = true;
    hideHighlight();
    highlightTracker.observe(null);
    setFeedState("error");
    elements.gameStatusText.textContent = "OFFLINE";
    elements.gameStatus.classList.remove("is-live", "is-upcoming");
    elements.gameDetail.textContent = "Can’t reach the score feed. Retrying automatically.";
    document.querySelector("#ball-marker").setAttribute("visibility", "hidden");
    document.querySelector("#football-marker").setAttribute("visibility", "hidden");
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
  let frames = [];
  let index = 0;
  let paused = true;
  let timer;
  let loadId = 0;
  const controls = document.querySelector("#demo-controls");
  const toggle = document.querySelector("#demo-toggle");
  const next = document.querySelector("#demo-next");
  const previous = document.querySelector("#demo-previous");
  const gameSelect = document.querySelector("#demo-game");
  const speed = document.querySelector("#demo-speed");
  controls.hidden = false;
  elements.refreshButton.hidden = true;
  elements.panel.setAttribute("aria-busy", "false");

  function schedule() {
    clearTimeout(timer);
    if (!paused && index < frames.length - 1) timer = setTimeout(() => { index++; render(); }, 5_000 / Number(speed.value));
  }

  function render() {
    hideHighlight();
    document.querySelector(".field-wrap").classList.remove("is-feed-delayed");
    const frame = frames[index];
    updateGame(frame.spotlight, null, true);
    if (frame.event) showHighlight(frame.event, frame.spotlight, true, 3_200 / Number(speed.value));
    elements.gameStatusText.textContent = "REPLAY";
    elements.gameStatus.classList.remove("is-live");
    elements.feedLabel.textContent = "RECORDED GAME · NOT LIVE";
    if (frame.league !== "nfl") {
      elements.nextOpponent.textContent = gameSelect.selectedOptions[0].textContent;
      elements.nextDetail.textContent = "Historical play-by-play · 5 seconds per play at 1×";
      document.querySelector("#next-predictor").textContent = "Field position is inferred from each recorded play, not a saved live feed";
    }
    document.querySelector("#demo-step").textContent = `Play ${index + 1} / ${frames.length} · ${frame.caption}`;
    document.querySelector("#demo-step").title = frame.caption;
    document.querySelector("#demo-progress").max = frames.length;
    document.querySelector("#demo-progress").value = index + 1;
    if (index === frames.length - 1) paused = true;
    toggle.textContent = paused ? "Play" : "Pause";
    toggle.disabled = next.disabled = index === frames.length - 1;
    previous.disabled = index === 0;
    schedule();
  }

  async function loadGame() {
    const requestId = ++loadId;
    clearTimeout(timer);
    ballPlacement.reset();
    paused = true;
    hideHighlight();
    toggle.disabled = next.disabled = previous.disabled = true;
    document.querySelector("#demo-step").textContent = "Loading recorded game…";
    const key = gameSelect.value;
    try {
      const response = await fetch(`/api/demo?game=${key}`);
      if (!response.ok) throw new Error("Replay unavailable");
      const loaded = await response.json();
      if (requestId !== loadId) return;
      frames = loaded;
      index = 0;
      driveGameId = null;
      selectedDriveId = null;
      renderedDriveId = null;
      renderedIllustrationKey = null;
      renderedIllustratedPlayId = null;
      updateBrand(frames[0]);
      document.title = `Game Replay · ${frames[0].team.name} Football Scoreboard`;
      document.querySelector("#season-year").textContent = frames[0].season;
      render();
    } catch {
      if (requestId !== loadId) return;
      document.querySelector("#demo-step").textContent = "Replay unavailable. Choose a game to retry.";
      elements.feedLabel.textContent = "RECORDED GAME UNAVAILABLE";
    }
  }

  toggle.addEventListener("click", () => {
    paused = !paused;
    toggle.textContent = paused ? "Play" : "Pause";
    schedule();
  });
  previous.addEventListener("click", () => {
    paused = true;
    index = Math.max(0, index - 1);
    selectedDriveId = null;
    render();
  });
  next.addEventListener("click", () => {
    paused = true;
    index = Math.min(index + 1, frames.length - 1);
    selectedDriveId = null;
    render();
  });
  document.querySelector("#demo-restart").addEventListener("click", () => { if (!frames.length) return; index = 0; paused = true; selectedDriveId = null; render(); });
  speed.addEventListener("change", schedule);
  gameSelect.addEventListener("change", () => {
    const url = new URL(location.href);
    url.searchParams.set("game", gameSelect.value);
    history.replaceState(null, "", url);
    loadGame();
  });
  gameSelect.value = new URLSearchParams(location.search).get("game") === "college" ? "college" : "nfl";
  loadGame();
}

async function startCountdownDemo() {
  const banner = document.querySelector("#countdown-demo");
  banner.hidden = false;
  elements.refreshButton.hidden = true;
  try {
    // Reuse the bundled Cowboys–Eagles matchup, but never show its recorded
    // result or plays as if they were part of an upcoming game.
    const response = await fetch("/api/demo?game=nfl");
    if (!response.ok) throw new Error("Sample game unavailable");
    const [frame] = await response.json();
    if (!frame) throw new Error("Sample game unavailable");
    const game = { ...frame.spotlight,
      state: "scheduled", status: "Scheduled", kickoffAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      timeTbd: false, period: null, clock: null, possessionTeamId: null,
      ball: null, ballHeld: false, fieldContext: null, drives: [], plays: [], highlights: [], leaders: [],
      matchupPredictor: null,
      selectedTeam: { ...frame.spotlight.selectedTeam, score: null },
      opponent: { ...frame.spotlight.opponent, score: null },
    };
    updateBrand(frame);
    document.title = `Countdown Preview · ${frame.team.name} Football Scoreboard`;
    document.querySelector("#season-year").textContent = frame.season;
    updateGame(game, game);
    elements.feedLabel.textContent = "SAMPLE MATCHUP · NOT LIVE";
    window.setInterval(updateCountdown, 1000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) updateCountdown(); });
  } catch {
    elements.feedLabel.textContent = "SAMPLE GAME UNAVAILABLE";
    banner.querySelector("span").textContent = "Could not load the bundled sample game. Try reloading.";
  } finally {
    elements.panel.setAttribute("aria-busy", "false");
  }
}

const demo = new URLSearchParams(location.search).get("demo");
if (demo === "drive") {
  startDriveDemo();
} else if (demo === "countdown") {
  startCountdownDemo();
} else {
  activeTeamKey = await startTeamPicker();
  const polling = createRefreshLoop({ refresh: refreshScoreboard, getPayload: () => lastPayload });
  elements.refreshButton.addEventListener("click", polling.refreshNow);
  polling.start();
  window.setInterval(updateCountdown, 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { updateCountdown(); polling.refreshNow(); }
  });
}
