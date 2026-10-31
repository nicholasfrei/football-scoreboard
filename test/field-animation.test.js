import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { createBallPlacement, ROUTE_DURATION_MS, RETURN_DELAY_MS, RETURN_DURATION_MS } from "../public/field-animation.js";

function harness() {
  const renders = [];
  const timers = new Map();
  let id = 0;
  const placement = createBallPlacement({
    render: (game, options) => renders.push({ game, options }),
    schedule: (fn, ms) => { timers.set(++id, { fn, ms }); return id; },
    cancel: (timer) => timers.delete(timer),
  });
  return { placement, renders, timers };
}

const game = (percent) => ({ ball: percent === null ? null : { percent } });
const animation = (durationMs = ROUTE_DURATION_MS) => ({ element: new EventTarget(), durationMs });
const end = (motion, type = "animationend") => motion.element.dispatchEvent(new Event(type));

test("routes hold the snap spot, then place the confirmed ball instantly on animationend", () => {
  const { placement, renders, timers } = harness();
  const motion = animation();
  placement.update({ key: "play", game: game(45), startGame: game(25), animation: motion });
  assert.deepEqual(renders, [{ game: game(25), options: { instant: true } }]);
  assert.equal([...timers.values()][0].ms, 1200);
  end(motion);
  assert.deepEqual(renders.at(-1), { game: game(45), options: { instant: true } });
  assert.equal(timers.size, 0);
  end(motion);
  assert.equal(renders.length, 2, "a completed animation commits only once");
});

test("YAC and interception returns wait for the final leg, not the pass arc", () => {
  assert.equal(RETURN_DELAY_MS + RETURN_DURATION_MS, 1550);
  for (const kind of ["yac", "interception-return"]) {
    const { placement, renders, timers } = harness();
    const motion = animation(RETURN_DELAY_MS + RETURN_DURATION_MS);
    placement.update({ key: kind, game: game(60), startGame: game(30), animation: motion });
    assert.equal([...timers.values()][0].ms, 1650);
    assert.equal(renders.at(-1).game.ball.percent, 30);
    end(motion);
    assert.equal(renders.at(-1).game.ball.percent, 60);
  }
});

test("repeated polls do not restart a route and use the latest corrected destination", () => {
  const { placement, renders, timers } = harness();
  const motion = animation();
  placement.update({ key: "play", game: game(45), startGame: game(25), animation: motion });
  const timer = [...timers.keys()][0];
  placement.update({ key: "play", game: game(46), startGame: game(25), animation: motion });
  assert.equal(renders.length, 1);
  assert.deepEqual([...timers.keys()], [timer]);
  end(motion);
  assert.equal(renders.at(-1).game.ball.percent, 46);
  placement.update({ key: "play", game: game(47), animation: motion });
  assert.equal(renders.at(-1).game.ball.percent, 47);
  assert.equal(timers.size, 0, "a completed route is not delayed again");
});

test("new plays, game switches and drive browsing cancel obsolete completions", () => {
  for (const key of ["next-play", "other-game", "history-drive"]) {
    const { placement, renders, timers } = harness();
    const old = animation();
    placement.update({ key: "play", game: game(45), startGame: game(25), animation: old });
    const abandoned = [...timers.values()][0].fn;
    const motion = animation();
    placement.update({ key, game: game(70), startGame: game(50), animation: motion });
    end(old);
    abandoned();
    assert.equal(renders.at(-1).game.ball.percent, 50);
    assert.equal(timers.size, 1);
    end(motion);
    assert.equal(renders.at(-1).game.ball.percent, 70);
  }
});

test("incompletions stay at scrimmage and kicks use the confirmed spot, not a route endpoint", () => {
  for (const [start, confirmed] of [[40, 40], [35, 80], [65, 20], [90, null]]) {
    const { placement, renders } = harness();
    const motion = animation();
    placement.update({ key: "play", game: game(confirmed), startGame: game(start), animation: motion });
    end(motion);
    assert.deepEqual(renders.at(-1).game, game(confirmed));
  }
});

test("initial loads, missing routes, reduced motion and hidden history update immediately", () => {
  for (const options of [{}, { animation: animation(), reducedMotion: true }, { animation: animation(), visible: false }]) {
    const { placement, renders, timers } = harness();
    placement.update({ key: "play", game: game(45), startGame: game(25), ...options });
    assert.deepEqual(renders.at(-1), { game: game(45), options: { instant: true, hidden: options.visible === false } });
    assert.equal(timers.size, 0);
  }
});

test("motion preference changes and unavailable feeds cancel a pending ball move", () => {
  for (const options of [{ reducedMotion: true, game: game(45) }, { game: game(null), animation: null }]) {
    const { placement, renders, timers } = harness();
    const motion = animation();
    placement.update({ key: "play", game: game(45), startGame: game(25), animation: motion });
    placement.update({ key: "play", game: game(45), animation: motion, ...options });
    assert.deepEqual(renders.at(-1).game, options.game);
    assert.equal(timers.size, 0);
    end(motion);
    assert.equal(renders.length, 2);
  }
});

test("reset, cancellation events and a timeout fallback cannot leave a stale ball pending", () => {
  for (const action of ["reset", "animationcancel", "timeout"]) {
    const { placement, renders, timers } = harness();
    const motion = animation();
    placement.update({ key: "play", game: game(45), startGame: game(25), animation: motion });
    const timeout = [...timers.values()][0].fn;
    if (action === "reset") placement.reset();
    else if (action === "timeout") timeout();
    else end(motion, action);
    end(motion);
    timeout();
    assert.equal(renders.length, action === "reset" ? 1 : 2);
    assert.equal(timers.size, 0);
  }
});

test("football and blue line wait together without blinking; the yellow line and field details update normally", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(html, /<g id="ball-marker"[^>]*>\s*<line[^>]+\/>[\s\S]*?<\/g>\s*<g id="football-marker"/);
  assert.match(source, /createBallPlacement\(\{ render: updateFootballMarker \}\)/);
  assert.match(css, /#first-down-marker \{ transition: transform \.8s ease; \}/);
  assert.match(css, /#ball-marker, #football-marker \{ transition: none; \}/);
  assert.doesNotMatch(css, /#(?:ball|first-down)-marker\.is-instant/);

  function node() {
    const writes = [];
    return { style: new Proxy({}, { set(target, key, value) { writes.push([key, value]); target[key] = value; return true; } }),
      writes, attributes: {}, classList: { toggle() {} },
      getAttribute(name) { return this.attributes[name]; },
      setAttribute(name, value) { writes.push([name, value]); this.attributes[name] = value; },
      replaceChildren(...children) { this.children = children; }, removeAttribute(name) { delete this.attributes[name]; } };
  }
  const elements = Object.fromEntries(["#ball-marker", "#football-marker", "#first-down-marker", "#redzone-tint", "#ball-detail",
    "#possession-pin", "#possession-pin-logo", "#possession-pin-fallback"]
    .map((selector) => [selector, node()]));
  const document = { querySelector: (selector) => {
    assert.ok(elements[selector], `unexpected selector: ${selector}`);
    return elements[selector];
  }, createElement: node };
  const functions = source.slice(source.indexOf("function updateBallMarkers("), source.indexOf("function renderDrives("));
  const { lines, football } = runInNewContext(`${functions}; ({ lines: updateBallMarkers, football: updateFootballMarker })`, { document });
  const confirmed = { homeAway: "away", selectedTeam: { abbreviation: "AWY" }, opponent: { abbreviation: "HME" },
    ball: { percent: 82, direction: "right", firstDownPercent: 90, downDistance: "2nd & 8 at HME 18", possession: "AWY", label: "HME 18" } };
  lines(confirmed);
  const fieldState = () => JSON.stringify(Object.fromEntries(Object.entries(elements)
    .filter(([key]) => !["#football-marker", "#ball-marker"].includes(key))));
  const originalFieldState = fieldState();
  const motion = animation();
  const placement = createBallPlacement({ render: football, schedule: () => 1, cancel() {} });
  placement.update({ key: "play", game: confirmed, startGame: { ...confirmed, ball: { percent: 75 } }, animation: motion });
  assert.equal(elements["#football-marker"].style.transform, "translateX(698px)");
  assert.equal(elements["#ball-marker"].attributes.visibility, "visible");
  assert.equal(elements["#ball-marker"].style.transform, "translateX(698px)");
  assert.equal(elements["#first-down-marker"].attributes.visibility, "visible");
  assert.equal(elements["#first-down-marker"].style.transform, `translateX(${104 + 90 * 7.92}px)`);
  assert.equal(elements["#redzone-tint"].attributes.visibility, "visible");
  end(motion);
  assert.equal(elements["#football-marker"].style.transform, `translateX(${104 + 82 * 7.92}px)`);
  assert.equal(elements["#ball-marker"].style.transform, elements["#football-marker"].style.transform);
  assert.equal(fieldState(), originalFieldState, "the route must not touch the yellow line or field labels");

  for (const selector of ["#ball-marker", "#football-marker"]) elements[selector].writes.length = 0;
  const incomplete = animation();
  placement.update({ key: "incomplete", game: confirmed, startGame: { ...confirmed, ball: { percent: 82 } }, animation: incomplete });
  end(incomplete);
  for (const selector of ["#ball-marker", "#football-marker"]) {
    assert.equal(elements[selector].attributes.visibility, "visible");
    assert.deepEqual(elements[selector].writes, [], `${selector}: incompletions must not hide, reset or reposition the marker`);
  }
  assert.equal(fieldState(), originalFieldState);
});
