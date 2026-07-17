import endpoints from "../endpoints.json";

const TIMEOUT_MS = 10_000;

function formatET(isoString) {
  return (
    new Date(isoString).toLocaleString("en-US", {
      timeZone: "America/New_York",
      dateStyle: "medium",
      timeStyle: "medium",
    }) + " ET"
  );
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function sendTelegram(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID; skipping notification");
    return;
  }
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
  });
  if (!res.ok) {
    console.error(`Telegram API error: ${res.status} ${await res.text()}`);
  }
}

async function checkEndpoint(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "manual" });
    const isRedirect = res.status >= 300 && res.status < 400 && res.headers.has("location");
    return { ok: res.ok || isRedirect, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

function buildDashboardHtml(results, generatedAt) {
  const allUp = results.every((r) => r.up);
  const rows = results
    .map(
      (r) => `      <tr>
        <td>${escapeHtml(r.name)}</td>
        <td><a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.url)}</a></td>
        <td class="${r.up ? "up" : "down"}">${r.up ? "UP" : "DOWN"}</td>
        <td>${escapeHtml(r.detail ?? "")}</td>
        <td>${formatET(r.lastChecked)}</td>
      </tr>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>https-monitor status</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.25rem; }
  .banner { padding: .75rem 1rem; border-radius: .5rem; margin-bottom: 1.5rem; font-weight: 600; }
  .banner.up { background: #16a34a22; color: #16a34a; }
  .banner.down { background: #dc262622; color: #dc2626; }
  table { width: 100%; border-collapse: collapse; font-size: .9rem; }
  th, td { text-align: left; padding: .5rem; border-bottom: 1px solid #8884; }
  .up { color: #16a34a; font-weight: 600; }
  .down { color: #dc2626; font-weight: 600; }
  footer { margin-top: 1.5rem; font-size: .75rem; opacity: .6; }
</style>
</head>
<body>
  <h1>https-monitor status</h1>
  <div class="banner ${allUp ? "up" : "down"}">${allUp ? "All systems operational" : "One or more endpoints are down"}</div>
  <table>
    <thead><tr><th>Name</th><th>URL</th><th>Status</th><th>Detail</th><th>Last checked (ET)</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
  <footer>Generated ${formatET(generatedAt)}</footer>
</body>
</html>
`;
}

async function runChecks(env) {
  const stateRaw = await env.MONITOR_STATE.get("status");
  const state = stateRaw ? JSON.parse(stateRaw) : {};
  const newState = {};
  const results = [];

  for (const { name, url } of endpoints) {
    const result = await checkEndpoint(url);
    const wasUp = state[url]?.up;
    const isUp = result.ok;
    const detail = result.status ? `HTTP ${result.status}` : result.error;
    const lastChecked = new Date().toISOString();

    newState[url] = { up: isUp, lastChecked };
    results.push({ name, url, up: isUp, detail, lastChecked });

    if (!isUp && wasUp !== false) {
      await sendTelegram(env, `${name} is down\n${url}\n${detail}`);
    } else if (isUp && wasUp === false) {
      await sendTelegram(env, `${name} is back up\n${url}`);
    }
  }

  await env.MONITOR_STATE.put("status", JSON.stringify(newState));
  await env.MONITOR_STATE.put(
    "results",
    JSON.stringify({ results, generatedAt: new Date().toISOString() }),
  );
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runChecks(env));
  },

  async fetch(request, env, ctx) {
    const cached = await env.MONITOR_STATE.get("results");
    if (!cached) {
      return new Response("No data yet — waiting for the first scheduled check.", { status: 503 });
    }
    const { results, generatedAt } = JSON.parse(cached);
    return new Response(buildDashboardHtml(results, generatedAt), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
};
