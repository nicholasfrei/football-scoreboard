import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { getScoreboard } from "./src/espn.js";
import { loadConfig } from "./src/config.js";
import { createScoreboardCache } from "./src/scoreboard-cache.js";
import { createReplayFrames, REPLAY_GAMES } from "./src/replay.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");
const PORT = Number(process.env.PORT ?? 4173);
const config = await loadConfig(process.env.SCOREBOARD_CONFIG ?? join(ROOT, "config.json"));
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ttf": "font/ttf",
};

const loadScoreboard = createScoreboardCache(() => getScoreboard({ config }));
const replayCache = new Map();

async function loadReplay(key) {
  if (!replayCache.has(key)) {
    const option = REPLAY_GAMES[key];
    const file = join(ROOT, "test/fixtures/games", option.file);
    replayCache.set(key, readFile(file).then((content) =>
      createReplayFrames(JSON.parse(gunzipSync(content)), option)).catch((error) => {
      replayCache.delete(key);
      throw error;
    }));
  }
  return replayCache.get(key);
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

async function serveStatic(pathname, response) {
  const asset = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!new Set(["index.html", "app.js", "display-size.js", "game-timing.js", "ball-position.js", "highlights.js", "field-branding.js", "possession-branding.js", "scoring-style.js", "leader-layout.js", "team-record.js", "play-trajectory.js", "drive-illustration.js", "styles.css", "assets/arkansas.png", "assets/vanderbilt.png", "assets/cowboys.png", "assets/eagles.png", "assets/fonts/Graduate-Regular.ttf"]).has(asset)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  const filePath = join(PUBLIC_DIR, asset);
  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "content-type": MIME_TYPES[extname(filePath)],
      "cache-control": "no-cache",
    });
    response.end(content);
  } catch {
    response.writeHead(404);
    response.end("Asset unavailable");
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  const pathname = url.pathname;

  if (request.method !== "GET") {
    response.writeHead(405, { allow: "GET" });
    response.end("Method not allowed");
    return;
  }

  if (pathname === "/api/scoreboard") {
    try {
      sendJson(response, 200, await loadScoreboard());
    } catch (error) {
      sendJson(response, 503, {
        error: "The game feed is unavailable right now.",
        detail: error.message,
      });
    }
    return;
  }

  if (pathname === "/api/demo") {
    const key = url.searchParams.get("game");
    if (!Object.hasOwn(REPLAY_GAMES, key)) {
      sendJson(response, 400, { error: "Unknown replay game" });
      return;
    }
    try {
      sendJson(response, 200, await loadReplay(key));
    } catch {
      sendJson(response, 503, { error: "Replay game unavailable" });
    }
    return;
  }

  serveStatic(pathname, response);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Football Scoreboard (${config.league}/${config.teamKey}) ready at http://localhost:${PORT}`);
});
