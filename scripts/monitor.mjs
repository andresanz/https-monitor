import fs from "node:fs";
import path from "node:path";

const ENDPOINTS_FILE = "endpoints.json";
const STATE_DIR = ".state";
const STATE_FILE = path.join(STATE_DIR, "status.json");
const TIMEOUT_MS = 10_000;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID; skipping notification");
    return;
  }
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "Markdown" }),
  });
  if (!res.ok) {
    console.error(`Telegram API error: ${res.status} ${await res.text()}`);
  }
}

async function checkEndpoint(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const endpoints = loadJson(ENDPOINTS_FILE, []);
  const state = loadJson(STATE_FILE, {});
  const newState = {};

  for (const { name, url } of endpoints) {
    const result = await checkEndpoint(url);
    const wasUp = state[url]?.up;
    const isUp = result.ok;

    newState[url] = { up: isUp, lastChecked: new Date().toISOString() };

    if (!isUp && wasUp !== false) {
      const detail = result.status ? `HTTP ${result.status}` : result.error;
      await sendTelegram(`\u{1F534} *${name}* is DOWN\n${url}\n${detail}`);
    } else if (isUp && wasUp === false) {
      await sendTelegram(`✅ *${name}* is back UP\n${url}`);
    }

    console.log(`${name}: ${isUp ? "UP" : "DOWN"} (${url})`);
  }

  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(newState, null, 2));
}

main();
