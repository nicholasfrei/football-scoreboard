export function selectedFavorite({ teams, defaultKey }, requested, remembered) {
  const keys = new Set(teams.map((team) => team.key).concat(defaultKey));
  return [requested, remembered, defaultKey].find((key) => keys.has(key));
}

/** A navigation starts a fresh view: no old game's scores, animations or requests. */
export function renderTeamPicker(container, catalog, activeKey, { document, remember = () => {}, onRemove, onEdit, editing = false, isEditing = () => editing }) {
  container.replaceChildren();
  container.hidden = onRemove ? catalog.teams.length === 0 : catalog.teams.length < 2;
  for (const team of catalog.teams) {
    const link = document.createElement("a");
    link.className = "favorite-team";
    link.draggable = false;
    link.href = `/?team=${encodeURIComponent(team.key)}`;
    link.title = team.name;
    link.setAttribute("aria-label", `Show ${team.name}`);
    if (team.key === activeKey) link.setAttribute("aria-current", "page");
    if (team.logo) {
      const image = document.createElement("img");
      image.src = team.logo;
      image.alt = "";
      image.draggable = false;
      image.addEventListener("error", () => { image.hidden = true; });
      link.append(image);
    }
    const label = document.createElement("span");
    label.textContent = team.mascot;
    link.append(label);
    link.addEventListener("click", (event) => {
      if (isEditing()) { event.preventDefault(); return; }
      remember(team.key);
    });
    if (onRemove) {
      const item = document.createElement("div");
      item.className = "favorite-item";
      item.append(link);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "favorite-remove";
      remove.textContent = "×";
      remove.hidden = !editing;
      remove.setAttribute("aria-label", `Remove ${team.name} from favorites`);
      remove.addEventListener("click", () => onRemove(team.key));
      item.append(remove);
      bindFavoriteHold(link, onEdit);
      container.append(item);
    } else container.append(link);
  }
}

export function bindFavoriteHold(link, onHold, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let timer, origin, held = false, touchId = null;
  const cancel = () => { clearTimer(timer); timer = undefined; };
  const start = (point) => {
    cancel();
    held = false;
    origin = { x: point.clientX, y: point.clientY };
    timer = setTimer(() => { timer = undefined; held = true; onHold(); }, 1500);
  };
  // Chromium may cancel pointer events when its native link long-press menu
  // starts. Track the actual touch lifecycle instead, without blocking swipes.
  link.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1) { touchId = null; cancel(); return; }
    const touch = event.touches[0];
    touchId = touch.identifier;
    start(touch);
  }, { passive: true });
  link.addEventListener("touchmove", (event) => {
    const touch = Array.from(event.touches).find((touch) => touch.identifier === touchId);
    if (!touch || Math.hypot(touch.clientX - origin.x, touch.clientY - origin.y) > 18) cancel();
  }, { passive: true });
  const endTouch = () => { touchId = null; cancel(); };
  link.addEventListener("touchend", endTouch, { passive: true });
  link.addEventListener("touchcancel", endTouch, { passive: true });
  link.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "touch" || touchId !== null) return;
    cancel();
    if (event.button !== 0 || event.isPrimary === false) return;
    start(event);
  });
  link.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch" || touchId !== null) return;
    if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) cancel();
  });
  for (const name of ["pointerup", "pointercancel", "pointerleave"]) link.addEventListener(name, (event) => {
    if (event.pointerType !== "touch" && touchId === null) cancel();
  });
  link.addEventListener("blur", cancel);
  link.addEventListener("dragstart", (event) => { event.preventDefault(); });
  link.addEventListener("contextmenu", (event) => event.preventDefault());
  link.addEventListener("click", (event) => {
    if (held) { event.preventDefault(); event.stopImmediatePropagation(); held = false; }
  }, true);
}

export function restoreFavorites(saved, catalog) {
  try {
    const teams = JSON.parse(saved);
    if (Array.isArray(teams) && teams.every((team) => team && /^(nfl|college-football):[a-z0-9]+$/.test(team.key)
      && typeof team.name === "string" && typeof team.mascot === "string"
      && (!team.logo || /^https:\/\//.test(team.logo)))) {
      return [...new Map(teams.map((team) => [team.key, team])).values()];
    }
  } catch { /* Fall back to configured favorites if storage is damaged. */ }
  return catalog.teams;
}

export function filterTeams(teams, query, league = "") {
  const words = query.trim().toLowerCase().split(/\s+/);
  return teams.filter((team) => (!league || team.key.startsWith(`${league}:`))
    && words.every((word) => `${team.name} ${team.mascot} ${team.abbreviation ?? ""}`.toLowerCase().includes(word)));
}

export async function startTeamPicker({ temporary = false } = {}) {
  const requested = new URLSearchParams(location.search).get("team");
  const container = document.querySelector("#team-picker");
  try {
    const response = await fetch("/api/teams", { cache: "no-store", signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error("Favorites unavailable");
    const catalog = await response.json();
    let remembered, saved;
    try {
      remembered = localStorage.getItem("scoreboard-favorite");
      saved = localStorage.getItem("scoreboard-favorites");
    } catch { /* Storage may be disabled. */ }
    let teams = restoreFavorites(saved, catalog);
    const activeKey = selectedFavorite({ teams, defaultKey: teams[0]?.key ?? catalog.defaultKey }, requested, remembered);
    const remember = (key) => { try { localStorage.setItem("scoreboard-favorite", key); } catch { /* Still allow navigation. */ } };
    if (!temporary) remember(activeKey);
    const dialog = document.querySelector("#team-search");
    const input = document.querySelector("#team-search-input");
    const leagueButtons = dialog.querySelectorAll("[data-league]");
    const results = document.querySelector("#team-search-results");
    const status = document.querySelector("#team-search-status");
    const done = document.querySelector("#favorites-done");
    let editing = false;
    let activeLeague = activeKey?.startsWith("college-football:") ? "college-football" : "nfl";
    const directories = new Map();
    const pending = new Map();
    const setEditing = (value) => {
      editing = value;
      done.hidden = !editing;
      // Keep the pressed link mounted until release. Replacing it mid-touch
      // can cancel the gesture or deliver the release to the newly shown X.
      for (const remove of container.querySelectorAll(".favorite-remove")) remove.hidden = !editing;
    };
    const save = () => {
      try { localStorage.setItem("scoreboard-favorites", JSON.stringify(teams)); }
      catch { return " This browser cannot save favorites after reload."; }
      return "";
    };
    const render = () => {
      done.hidden = !editing;
      renderTeamPicker(container, { teams }, temporary ? null : activeKey, { document, remember, editing, isEditing: () => editing,
        onEdit: () => setEditing(true),
        onRemove: (key) => {
          teams = teams.filter((team) => team.key !== key);
          save();
          render();
          done.focus();
          // Removing the current favorite does not interrupt its game feed.
          showResults();
        },
      });
    };
    const showResults = () => {
      const directory = directories.get(activeLeague);
      if (!directory) return;
      results.replaceChildren();
      const matches = filterTeams(directory, input.value, activeLeague);
      status.textContent = matches.length ? `${matches.length} ${matches.length === 1 ? "team" : "teams"}` : "No teams found. Try another name.";
      for (const team of matches) {
        const row = document.createElement("div");
        row.className = "team-search-result";
        if (team.logo) {
          const image = document.createElement("img");
          image.src = team.logo; image.alt = ""; image.loading = "lazy";
          image.addEventListener("error", () => { image.hidden = true; });
          row.append(image);
        }
        const label = document.createElement("span");
        label.textContent = `${team.name} · ${team.league === "nfl" ? "NFL" : "NCAAF"}`;
        row.append(label);
        const add = document.createElement("button");
        const added = teams.some((favorite) => favorite.key === team.key);
        add.type = "button"; add.textContent = added ? "Added ✓" : "+ Add"; add.disabled = added;
        add.setAttribute("aria-label", `${added ? "Added" : "Add"} ${team.name} to favorites`);
        add.addEventListener("click", () => {
          if (!teams.some((favorite) => favorite.key === team.key)) teams.push(team);
          const warning = save(); render();
          add.disabled = true; add.textContent = "Added ✓";
          add.setAttribute("aria-label", `Added ${team.name} to favorites`);
          status.textContent = `${team.name} added to favorites.${warning}`;
        });
        row.append(add); results.append(row);
      }
    };
    const loadLeague = async () => {
      const league = activeLeague;
      for (const button of leagueButtons) button.setAttribute("aria-pressed", String(button.dataset.league === league));
      results.replaceChildren();
      if (directories.has(league)) { showResults(); return; }
      status.textContent = `Loading ${league === "nfl" ? "NFL" : "NCAAF"} teams…`;
      try {
        if (!pending.has(league)) {
          pending.set(league, (async () => {
            const response = await fetch(`/api/teams/search?league=${league}`, { signal: AbortSignal.timeout(15_000) });
            if (!response.ok) throw new Error("Search unavailable");
            directories.set(league, (await response.json()).teams);
          })().finally(() => pending.delete(league)));
        }
        await pending.get(league);
        if (activeLeague === league) showResults();
      } catch {
        if (activeLeague === league) status.textContent = "Team search is unavailable. Select the league again to retry.";
      }
    };
    for (const button of leagueButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.league === activeLeague));
      button.addEventListener("click", () => { activeLeague = button.dataset.league; loadLeague(); });
    }
    document.querySelector("#team-search-open").addEventListener("click", () => {
      dialog.showModal(); input.focus(); loadLeague();
    });
    document.querySelector("#team-search-close").addEventListener("click", () => dialog.close());
    document.querySelector("#favorites-edit").addEventListener("click", () => {
      dialog.close(); setEditing(true);
      (container.querySelector(".favorite-remove") ?? done).focus();
    });
    done.addEventListener("click", () => { setEditing(false); document.querySelector("#team-search-open").focus(); });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && editing) setEditing(false);
    });
    input.addEventListener("input", showResults);
    render();
    return activeKey;
  } catch {
    // A catalog failure must not prevent the original single-team display loading.
    container.hidden = true;
    return requested;
  }
}
