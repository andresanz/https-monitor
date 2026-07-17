# https-monitor

Checks a list of HTTPS endpoints (e.g. GitHub Pages sites) on a schedule and
sends a Telegram message when one goes down, and another when it recovers.

There are two ways this runs, sharing the same check/alert logic:

- **Cloudflare Worker** (`worker/index.mjs`) — recommended. Cloudflare's
  Cron Triggers actually fire on schedule; GitHub Actions' `schedule` event
  does not (see below).
- **GitHub Actions** (`scripts/monitor.mjs` / `.github/workflows/monitor.yml`)
  — kept as a fallback / for the GitHub Pages dashboard, but its schedule
  trigger has proven unreliable (see "Known limitation" below).

## Setup

1. **Create a Telegram bot**: message [@BotFather](https://t.me/BotFather),
   run `/newbot`, and copy the bot token it gives you.
2. **Get your chat id**: message your new bot, then visit
   `https://api.telegram.org/bot<token>/getUpdates` and read `message.chat.id`
   from the JSON response.
3. **Edit `endpoints.json`** with the URLs you want to monitor (shared by
   both the Worker and the GitHub Actions script):
   ```json
   [
     { "name": "My site", "url": "https://myuser.github.io/my-repo/" }
   ]
   ```

### Cloudflare Worker (recommended)

1. **Add repo secrets** (Settings → Secrets and variables → Actions):
   - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (same bot as above)
   - `CLOUDFLARE_API_TOKEN` — create at My Profile → API Tokens → Create
     Token → "Edit Cloudflare Workers" template
   - `CLOUDFLARE_ACCOUNT_ID` — found on the right sidebar of the Cloudflare
     dashboard's Workers & Pages overview page
2. Push to `worker/**`, `endpoints.json`, or `wrangler.toml` (or run
   `.github/workflows/deploy-worker.yml` manually) — this deploys the
   Worker and sets its Telegram secrets via `wrangler`.
3. The dashboard is served directly by the Worker at its `workers.dev` URL
   (shown in the Cloudflare dashboard, or in the deploy step's logs) —
   there's no separate static page to publish.

The Worker's `MONITOR_STATE` KV namespace (bound in `wrangler.toml`) holds
both the last known up/down state per endpoint (for detecting transitions)
and the latest check results (for rendering the dashboard on request).

### GitHub Actions (fallback / dashboard)

1. **Add repo secrets**: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
2. **Enable the status dashboard**: Settings → Pages → Build and deployment
   → Source: **GitHub Actions**. After the workflow next runs, the page
   will be live at `https://<owner>.github.io/https-monitor/`.

## How the checks work

Both the Worker and `scripts/monitor.mjs` share the same logic: each
endpoint is fetched with a 10s timeout, without following redirects — a 2xx
response, or a 3xx with a `Location` header, counts as up; anything else
(4xx/5xx or a network error/timeout) counts as down. Redirects are not
followed because some redirect targets (e.g. LinkedIn) block automated
clients with their own non-2xx status, which would otherwise cause false
DOWN alerts for an endpoint that's actually fine.

A Telegram message — a plain `<name> is down` / `<name> is back up`,
followed by the URL and detail — is only sent on a state transition (up →
down, or down → up), not on every check.

To test the GitHub Actions script manually, run it locally:

```sh
TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... node scripts/monitor.mjs
```

Or trigger it on GitHub: Actions tab → **Monitor Endpoints** (in the left
sidebar) → **Run workflow** dropdown → Run workflow. This creates a new run
against the latest commit. Re-running an existing run instead ("Re-run
jobs" on a past run's page) replays that run's original commit, so it won't
pick up endpoint or code changes made since.

## Known limitation: GitHub Actions `schedule` is unreliable

In testing, `.github/workflows/monitor.yml`'s cron (currently every 10
minutes) fired only a handful of times over several hours — actual gaps
were 1.5-2+ hours, not 10 minutes. This isn't a config mistake: GitHub
deprioritizes `schedule`-triggered runs versus other event types, and on
free-tier public repos it can silently skip or heavily delay them,
especially at busy round-number times. `push`-triggered workflows (like
`deploy-worker.yml`) don't have this problem — only `schedule` does. This
is why the Cloudflare Worker (with a real Cron Trigger) is the recommended
path for actually reliable checking; GitHub Actions is kept mainly for the
Pages dashboard and as a manual-trigger fallback.

## Adjusting the check interval

- **Worker**: edit `crons` in `wrangler.toml` (currently `*/5 * * * *`).
  Cloudflare Cron Triggers are reliable down to 1-minute resolution.
- **GitHub Actions**: edit the `cron` schedule in
  `.github/workflows/monitor.yml`. It runs at `:07`, `:22`, `:37`, `:52`
  past the hour rather than on round 5-minute marks, since those are the
  busiest slots — but per the limitation above, don't rely on this being
  timely.
