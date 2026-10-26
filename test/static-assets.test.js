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
  await checkModule("/demo.js");
});
