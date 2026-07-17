# https-monitor

Checks a list of HTTPS endpoints (e.g. GitHub Pages sites) on a schedule and
sends a Telegram message when one goes down, and another when it recovers.

## Setup

1. **Create a Telegram bot**: message [@BotFather](https://t.me/BotFather),
   run `/newbot`, and copy the bot token it gives you.
2. **Get your chat id**: message your new bot, then visit
   `https://api.telegram.org/bot<token>/getUpdates` and read `message.chat.id`
   from the JSON response.
3. **Add repo secrets** (Settings → Secrets and variables → Actions):
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
4. **Edit `endpoints.json`** with the URLs you want to monitor:
   ```json
   [
     { "name": "My site", "url": "https://myuser.github.io/my-repo/" }
   ]
   ```
5. **Enable the status dashboard**: Settings → Pages → Build and deployment
   → Source: **GitHub Actions**. After the workflow next runs, the page
   will be live at `https://<owner>.github.io/https-monitor/`.

## Status dashboard

Every run writes a read-only `site/index.html` showing each endpoint's
current up/down state, detail (HTTP status or error), and last-checked
time, and publishes it to GitHub Pages. It's regenerated from scratch each
run — there's no history/uptime log, just the latest snapshot.

## How it works

`.github/workflows/monitor.yml` runs `scripts/monitor.mjs` every 5 minutes.
Each endpoint is fetched with a 10s timeout; a non-2xx response or a network
error/timeout counts as down. Status from the previous run is cached (via
`actions/cache`, keyed on `.state/status.json`) so a Telegram message is only
sent on a state transition (up → down, or down → up), not on every run.

To test manually, trigger the workflow from the Actions tab
("Run workflow"), or run it locally:

```sh
TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... node scripts/monitor.mjs
```

## Adjusting the check interval

Edit the `cron` schedule in `.github/workflows/monitor.yml`. Note GitHub
Actions schedules are not guaranteed to run exactly on time and won't run
more often than every 5 minutes.
