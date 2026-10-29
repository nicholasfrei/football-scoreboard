export function selectedFavorite({ teams, defaultKey }, requested, remembered) {
  const keys = new Set(teams.map((team) => team.key).concat(defaultKey));
  return [requested, remembered, defaultKey].find((key) => keys.has(key));
}

/** A navigation starts a fresh view: no old game's scores, animations or requests. */
export function renderTeamPicker(container, catalog, activeKey, { document, remember = () => {} }) {
  container.replaceChildren();
  container.hidden = catalog.teams.length < 2;
  for (const team of catalog.teams) {
    const link = document.createElement("a");
    link.className = "favorite-team";
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
    link.addEventListener("click", () => remember(team.key));
    container.append(link);
  }
}

export async function startTeamPicker() {
  const requested = new URLSearchParams(location.search).get("team");
  const container = document.querySelector("#team-picker");
  try {
    const response = await fetch("/api/teams", { cache: "no-store", signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error("Favorites unavailable");
    const catalog = await response.json();
    let remembered;
    try { remembered = localStorage.getItem("scoreboard-favorite"); } catch { /* Storage may be disabled. */ }
    const activeKey = selectedFavorite(catalog, requested, remembered);
    const remember = (key) => { try { localStorage.setItem("scoreboard-favorite", key); } catch { /* Still allow navigation. */ } };
    remember(activeKey);
    renderTeamPicker(container, catalog, activeKey, { document, remember });
    return activeKey;
  } catch {
    // A catalog failure must not prevent the original single-team display loading.
    container.hidden = true;
    return requested;
  }
}
