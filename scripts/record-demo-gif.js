// Run with the local server started: node scripts/record-demo-gif.js http://localhost:4173
// Optional CHROME_PATH and FFMPEG_PATH select locally installed recording tools.
// Captures every Cowboys–Eagles replay play, then builds the README GIF with ffmpeg.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chromePath = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg";
const url = `${process.argv[2] ?? "http://localhost:4173"}/?demo=drive&game=nfl`;
const output = new URL("../docs/images/cowboys-drive-demo.gif", import.meta.url).pathname;
const tempRoot = process.env.RECORDING_TMPDIR ?? tmpdir();
const temp = await mkdtemp(join(tempRoot, "scoreboard-replay-"));
const chrome = spawn(chromePath, ["--headless=new", "--no-first-run", "--no-default-browser-check",
  "--disable-gpu", `--user-data-dir=${join(temp, "profile")}`, "--window-size=1280,800", "--remote-debugging-pipe"],
{ stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
const pending = new Map();
const chromeReady = once(chrome, "spawn");
let messageId = 0;
let buffer = "";
chrome.stdio[4].on("data", (chunk) => {
  buffer += chunk.toString();
  let end;
  while ((end = buffer.indexOf("\0")) !== -1) {
    const raw = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (!raw) continue;
    const message = JSON.parse(raw);
    if (!pending.has(message.id)) continue;
    const { resolve, reject, timer } = pending.get(message.id);
    clearTimeout(timer);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
  }
});

function send(method, params = {}, sessionId) {
  const id = ++messageId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 30_000);
    pending.set(id, { resolve, reject, timer });
    chrome.stdio[3].write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
  });
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}

try {
  await chromeReady;
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);
  const evaluate = async (expression) => {
    const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  await call("Page.enable");
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  await call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await call("Page.navigate", { url });
  let count;
  for (let tries = 0; tries < 200; tries++) {
    count = await evaluate('Number(document.querySelector("#demo-progress")?.max)');
    if (count > 1 && await evaluate('document.querySelector("#demo-step")?.textContent.startsWith("Play 1 /")')) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (count !== 187) throw new Error(`Expected 187 recorded plays, got ${count}`);
  await evaluate(`document.fonts.ready.then(() => Promise.all([...document.images].map(image => image.decode().catch(() => {}))))`);
  // Seek real CSS animations instead of disabling them: the GIF must include
  // route reveals and the football/blue-line placement after the final leg.
  const seek = (milliseconds) => evaluate(`(async () => {
    for (const animation of document.getAnimations()) {
      const end = animation.effect.getComputedTiming().endTime;
      if (!Number.isFinite(end)) continue;
      animation.pause();
      animation.currentTime = Math.min(${milliseconds}, end);
      if (${milliseconds} >= end) animation.finish();
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
  const frames = join(temp, "frames");
  await mkdir(frames);
  let frame = 0;
  async function capture() {
    const { data } = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(join(frames, `${String(frame++).padStart(4, "0")}.png`), Buffer.from(data, "base64"));
  }
  for (let index = 0; index < count; index++) {
    if (index) await evaluate('document.querySelector("#demo-next").click()');
    const highlight = await evaluate('!document.querySelector("#highlight").hidden');
    if (highlight) {
      await seek(450);
      await capture(); // Keep a brief glimpse of the actual replay highlight.
      await capture();
      await evaluate(`(() => { document.querySelector('#highlight').hidden = true;
        document.querySelector('.score-panel').classList.remove('has-highlight'); })()`);
    }
    const hasRoute = await evaluate(`Boolean(document.querySelector('#drive-illustration .route-reveal'))`);
    if (hasRoute) {
      for (const milliseconds of [0, 300, 600, 900, 1200, 1600]) {
        await seek(milliseconds);
        await capture();
      }
    } else {
      await seek(1600);
      await capture(); // Also show the score and current leader totals for this play.
    }
    if (index % 25 === 0) console.log(`Captured play ${index + 1}/${count}`);
  }
  // Hold the final score and box-score leaders for three seconds.
  const final = await evaluate(`({ away: document.querySelector('#away-score').textContent,
    home: document.querySelector('#home-score').textContent, step: document.querySelector('#demo-step').textContent })`);
  if (final.away !== "38" || final.home !== "21" || !final.step.startsWith(`Play ${count} /`)) {
    throw new Error(`Unexpected final replay state: ${JSON.stringify(final)}`);
  }
  for (let hold = 0; hold < 12; hold++) await capture();
  await run(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-framerate", "4",
    "-i", join(frames, "%04d.png"), "-filter_complex",
    "fps=4,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3",
    "-loop", "0", output]);
  console.log(`Recorded ${count} plays (${frame} frames) to ${output}`);
} finally {
  if (chrome.pid && chrome.exitCode === null) {
    const exited = once(chrome, "exit");
    chrome.kill();
    await exited;
  }
  await rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
