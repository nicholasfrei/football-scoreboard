import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";

test("server serves every startup module so the dashboard can leave its loading state", { timeout: 10_000 }, async (t) => {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));

  const server = spawn(process.execPath, ["server.js"], {
    cwd: new URL("../", import.meta.url),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    const exited = once(server, "exit");
    server.kill();
    await exited;
  });
  await once(server.stdout, "data");

  const visited = new Set();
  async function checkModule(path) {
    if (visited.has(path)) return;
    visited.add(path);
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    assert.equal(response.status, 200, `${path} must load or the dashboard stays stuck`);
    assert.match(response.headers.get("content-type"), /javascript/);
    const source = await response.text();
    for (const match of source.matchAll(/from\s+["'](\.\/.+?)["']/g)) {
      await checkModule(new URL(match[1], `http://localhost${path}`).pathname);
    }
  }
  await checkModule("/app.js");
  await checkModule("/games.js");
  const gamesPage = await fetch(`http://127.0.0.1:${port}/games`);
  assert.equal(gamesPage.status, 200);
  assert.match(await gamesPage.text(), /Back to favorites/);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/games?league=nba`)).status, 400);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/game?league=nfl&id=invalid`)).status, 400);
  const catalogResponse = await fetch(`http://127.0.0.1:${port}/api/teams`);
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json();
  assert.equal(catalog.defaultKey, "nfl:dal");
  assert.deepEqual(catalog.teams.map((team) => team.name), ["Dallas Cowboys", "Texas Longhorns", "UTSA Roadrunners"]);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/scoreboard?team=nfl:unknown`)).status, 400);
  for (const [game, count] of [["nfl", 187], ["college", 215]]) {
    const response = await fetch(`http://127.0.0.1:${port}/api/demo?game=${game}`);
    assert.equal(response.status, 200);
    const frames = await response.json();
    assert.equal(frames.length, count);
    if (game === "college") {
      const incompletion = frames.find((frame) => frame.spotlight.fieldContext.lastPlayId === "401856732698");
      assert.equal(incompletion.spotlight.ball?.label, "MISS 27", "the served replay must not cache an invalid goal-line spot");
      assert.equal(incompletion.spotlight.ball.downDistance, "3rd & 3 at MISS 27");
      assert.equal(incompletion.spotlight.ball.firstDownPercent, 30);
    }
  }
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/demo?game=unknown`)).status, 400);
  const font = await fetch(`http://127.0.0.1:${port}/assets/fonts/Graduate-Regular.ttf`);
  assert.equal(font.status, 200);
  assert.equal(font.headers.get("content-type"), "font/ttf");
  const bytes = new Uint8Array(await font.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 4)], [0, 1, 0, 0], "end-zone font must be a TrueType file");
  assert.equal((await fetch(`http://127.0.0.1:${port}/assets/fonts/esp_bold.ttf`)).status, 404);
});
