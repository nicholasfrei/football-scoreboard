import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getScoreboard } from "./src/espn.js";
import { loadConfig } from "./src/config.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");
const PORT = Number(process.env.PORT ?? 4173);
const CACHE_TTL_MS = 20_000;
const config = await loadConfig(process.env.SCOREBOARD_CONFIG ?? join(ROOT, "config.json"));
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

let cache = null;
let cacheExpiresAt = 0;
let refreshPromise = null;

async function loadScoreboard() {
  if (cache && Date.now() < cacheExpiresAt) return { ...cache, stale: false };

  if (!refreshPromise) {
    refreshPromise = getScoreboard({ config })
      .then((scoreboard) => {
        cache = { ...scoreboard, refreshedAt: new Date().toISOString() };
        cacheExpiresAt = Date.now() + CACHE_TTL_MS;
        return { ...cache, stale: false };
      })
      .catch((error) => {
        if (cache) return { ...cache, stale: true, warning: error.message };
        throw error;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
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
  if (!new Set(["index.html", "app.js", "highlights.js", "styles.css", "assets/arkansas.png", "assets/vanderbilt.png"]).has(asset)) {
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
  const pathname = new URL(request.url, "http://localhost").pathname;

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

  serveStatic(pathname, response);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Football Scoreboard (${config.league}/${config.teamKey}) ready at http://localhost:${PORT}`);
});
