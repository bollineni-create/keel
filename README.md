# Daybook

*Formerly Keel. The repository, `data/keel.db`, the `KEEL_*` settings and the key folder keep the old
name, so an existing setup keeps working; the Mac app is now `/Applications/Daybook.app` (rebuilding
replaces the old `Keel.app`).*

Self-hosted personal finance on top of your **Copilot Money** data, or your banks directly — your accounts,
transactions, budgets, recurring charges, holdings and net worth in a PWA that runs on
your Mac and installs on your phone, with a **Claude assistant** built in and an **MCP
endpoint** so Claude Desktop / Claude Code / claude.ai can work with the same data.

Daybook is not affiliated with Copilot Money. It reads your data through the open-source
[`copilot-money-mcp`](https://github.com/ignaciohermosillacornejo/copilot-money-mcp)
server, which parses the Copilot Mac app's local cache (no network) and, optionally,
talks to Copilot's API with your own browser session.

It can also connect to your banks itself, the way Copilot does, through **Plaid** or
**SimpleFIN** (see [Connect your banks directly](#connect-your-banks-directly)).

## Requirements

- macOS with the **Copilot Money** Mac app installed and opened at least once, *or* a
  Plaid / SimpleFIN account for direct bank connections
- Node.js 20+ (`brew install node`)
- An Anthropic API key for the in-app assistant (optional; MCP works without it)

## Setup (5 minutes)

```bash
cd keel
npm install
cp .env.example .env        # add ANTHROPIC_API_KEY, pick a KEEL_TOKEN
npm run sync                # first pull from Copilot's local cache (~10–30 s)
npm start                   # http://localhost:4242
```

Open **http://localhost:4242**. Settings → *Sync now* re-pulls any time; the
server also re-syncs every `KEEL_SYNC_MINUTES` (default 30).

No Copilot cache yet? `npm run demo` seeds sample data so you can explore the UI, and
Settings → *Import Copilot CSV export* loads a CSV from the Copilot app.

### Live data and write-through

By default Daybook reads Copilot's **local cache** (offline, no auth). Two opt-ins in `.env`:

```
COPILOT_MCP_ARGS=-y copilot-money-mcp --live-reads   # fresh reads from Copilot's API
COPILOT_MCP_ARGS=-y copilot-money-mcp --write        # + push edits back (categorize, review, notes, budgets)
```

Both need a browser (Chrome/Safari/Firefox) logged in to app.copilot.money; the
server reuses that session. Without `--write`, edits you make in Daybook apply locally and
are queued (Settings shows the count).

## Connect your banks directly

Copilot doesn't connect to banks itself: it pays aggregators (mostly Plaid, with Finicity, MX and
Akoya as fallbacks). Daybook can use the same kind of service with your own account. Open
**Accounts → Add account** (or **Settings → Bank connections**):

| | Cost | Covers | How you connect |
|---|---|---|---|
| **Plaid** | Free Trial plan: 10 bank logins for the life of the account | Banks, cards, loans, investments (holdings); Chase, BofA, Wells, Capital One, Citi, Amex… | Plaid Link, the same pop-up Copilot shows |
| **SimpleFIN Bridge** | $15/year, up to 25 banks (MX network) | Banks and cards; investment holdings are patchy; ~90 days of history | Link banks on the Bridge site, paste a Setup Token into Daybook |

**Plaid setup.** Sign up at [dashboard.plaid.com](https://dashboard.plaid.com) (a new team created
after April 15, 2026 is eligible for Trial), apply for the Trial plan, then put the keys in `.env`:

```
PLAID_CLIENT_ID=…
PLAID_SECRET=…          # the Sandbox secret first, then Production
PLAID_ENV=sandbox       # fake banks, unlimited: try the whole flow here first
```

Every real link uses one of the 10 Trial slots for good, even if you remove it (and linking the
same bank twice uses two), so test in `sandbox`, then switch to `PLAID_ENV=production`. When a bank
asks you to sign in again, Daybook shows **Verification needed**; use **Fix connection**, which reopens
Link in update mode on the same login instead of creating a new one. Plaid holds two years of
history and refreshes from banks one to four times a day; Daybook polls hourly (no public webhook URL
needed). Link works in a desktop browser and in the Mac app; connect banks from the Mac rather than
the phone.

**SimpleFIN setup.** Sign up at [beta-bridge.simplefin.org](https://beta-bridge.simplefin.org),
connect your banks there, create a Setup Token under *Apps → New connection* and paste it into
Daybook (or `npm run connect -- simplefin <token>`). Daybook claims it once and keeps the resulting
access key. SimpleFIN allows about 24 requests a day, so Daybook syncs each SimpleFIN connection at
most every 4 hours (30 minutes for a manual *Sync*). A bank that needs a new login is fixed on the
Bridge site; then press **Fix connection** in Daybook.

**What Daybook does that Copilot did for you.** Bank feeds don't come with Copilot's categories,
transfer detection or history, so Daybook:
- seeds a starter category tree when you have none, maps Plaid's categories onto yours, and gives a
  new transaction the category you last gave the same merchant;
- marks a card payment and the matching credit as a transfer so it isn't counted as both spend and
  income;
- records a daily balance per account and rebuilds earlier balances from the transactions, so the
  net-worth chart has history from day one.
Uncategorized rows show up under `get_transactions {uncategorized: true}`; the assistant can file
them with `bulk_update_transactions`. Edits you make to bank-connection rows stay in Daybook and
survive every sync.

**Using Copilot and direct connections together.** The same card from both would be counted twice.
When Daybook spots one (same last four digits and type), Settings offers **Use this connection from
today**: from that day the direct connection supplies the account; Copilot keeps the history before
it. Set `KEEL_COPILOT=off` once you no longer use Copilot.

**Security.** Connection secrets (Plaid access tokens, SimpleFIN access URLs) are encrypted with
AES-256-GCM. The key lives outside the repo in `~/Library/Application Support/Keel/secret.key`
(or `KEEL_SECRET_KEY`); back it up with `data/keel.db`, or connections must be linked again. The
database is readable by you only. Once a bank is connected and no `KEEL_TOKEN` is set, Daybook answers
only requests from this Mac (set `KEEL_TOKEN` to use the phone or a tunnel). Adding or removing a
connection is never offered to the assistant or over MCP.

Not available to individuals: MX, Finicity, Akoya and Yodlee sell only under contract; Apple Card
data (FinanceKit) is iPhone-only and needs an App Store finance app, so export its CSV from
card.apple.com instead.

## The Mac app

`app/macos` wraps Daybook in a native window with its own menus and Dock icon, like
Palimpsest's and Gridline's Mac apps. It starts Daybook's server from this folder when you
open it (or uses one that's already running) and stops it when you quit.

**Install on a Mac (simplest).** Paste this into Terminal. It downloads Daybook to `~/keel`,
installs its packages, builds the app, puts it in Applications and opens it (it offers to
install Apple's command-line tools and Node first if you don't have them):

```bash
curl -fsSL https://raw.githubusercontent.com/bollineni-create/keel/main/app/macos/install.sh | zsh
```

Running the same line again updates and reinstalls; your data (`data/`) and settings
(`.env`) are never touched. From a checkout you already have, `npm run app` does the build
and install (`./app/macos/build.sh --no-install` builds only).

After that, open Daybook from Launchpad, Spotlight or the Dock. The red close button hides
the window instead of quitting, so the server keeps serving your phone and the MCP
endpoint; click the Dock icon to bring it back, and quit with ⌘Q (which stops the server
the app started). Edits under `web/` reload the window and edits under `src/` restart the
server. If the folder moves, rebuild. The build is ad-hoc signed, so on another Mac
right-click → **Open** the first time. The server log is at
`~/Library/Logs/Keel/server.log` (Server → Show Server Log). Every PR that touches
`app/macos` is compiled on a Mac runner (`.github/workflows/mac-app.yml`).

To keep the server up even after quitting, run it with launchd (below); the app then
just connects to it.

## Phone

1. Set `HOST=0.0.0.0` (default) and a `KEEL_TOKEN` in `.env`.
2. On the same Wi-Fi: open `http://<your-mac>.local:4242/?token=<KEEL_TOKEN>` in Safari,
   Share → **Add to Home Screen**. The token is remembered in a cookie.
3. Away from home: install [Tailscale](https://tailscale.com) on both devices and use
   `http://<mac-tailnet-name>:4242`, or `tailscale serve 4242` for HTTPS.

Keep the Mac awake (`caffeinate -s npm start`, or a launchd agent — see below).

## Connect Claude (MCP)

Daybook exposes 24 tools over MCP (`get_overview`, `get_transactions`, `get_budgets`,
`find_unusual_transactions`, `update_transaction`, `bulk_update_transactions`,
`split_transaction`, `set_budget`, `sync_now`, `get_connections`, `update_account`, …).

**Claude Code**
```bash
claude mcp add --transport http daybook http://localhost:4242/mcp \
  --header "Authorization: Bearer $KEEL_TOKEN"
```

**Claude Desktop** — `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{ "mcpServers": { "daybook": { "command": "npm", "args": ["--prefix", "/path/to/keel", "run", "-s", "mcp"] } } }
```

**claude.ai custom connector** — expose `/mcp` over HTTPS (`tailscale funnel 4242` or
`ngrok http 4242`), then Settings → Connectors → Add custom connector with the URL and
header `Authorization: Bearer <KEEL_TOKEN>`.

## In-app assistant

Set `ANTHROPIC_API_KEY` (and optionally `KEEL_MODEL`, default `claude-sonnet-5-5`).
The assistant is Daybook's front door: it is the home screen, and `⌘J` docks it beside any
other screen so you can ask about what you're looking at ("why is this one unreviewed?").
Replies stream, every tool call shows as a card that opens the screen holding that data,
and answers link straight into Transactions, Categories and the rest. It uses the same
tool registry as `/mcp`, so anything Claude can do over MCP it can do here, including
categorizing, reviewing, splitting and budgeting. Conversations are stored locally in
SQLite (Settings → Assistant → Clear conversations). Your financial data goes to
Anthropic's API when you use it.

## Run at login (launchd)

`~/Library/LaunchAgents/money.keel.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>money.keel</string>
  <key>ProgramArguments</key><array><string>/opt/homebrew/bin/npm</string><string>start</string></array>
  <key>WorkingDirectory</key><string>/path/to/keel</string>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/keel.log</string><key>StandardErrorPath</key><string>/tmp/keel.err</string>
</dict></plist>
```
`launchctl load ~/Library/LaunchAgents/money.keel.plist`

## Layout

```
src/server.ts      Express: static PWA, /api, /mcp (Streamable HTTP), /api/assistant (SSE)
src/tools.ts       the one tool registry (assistant + MCP + REST share it)
src/queries.ts     read models: budgets, net worth, trends, unusual spend
src/sync/index.ts  syncAll(): Copilot plus every bank connection, one run at a time
src/sync/copilot.ts MCP client → copilot-money-mcp → SQLite; write-through queue
src/sync/plaid.ts  Plaid: Link tokens, token exchange, /transactions/sync, holdings
src/sync/simplefin.ts SimpleFIN Bridge: setup-token claim, windowed /accounts polling
src/sync/enrich.ts categories, transfer pairing, balance history, Copilot → direct switch-over
src/sync/connections.ts + secrets.ts  the connections table; AES-GCM for its secrets
src/sync/csv.ts    Copilot CSV importer
src/assistant.ts   Anthropic tool loop, streamed
src/mcp.ts         Daybook as an MCP server
web/app.js         buildless PWA shell: sidebar, panes, tab bar, ⌘K palette, router
web/transactions.js the Transactions screen (windowed list, filters, bulk bar, detail pane)
web/connections.js bank connections: Settings card, Add account sheet, Plaid Link
web/v1.js          v1 screens not yet migrated to the three-pane specs
web/lib.js         shared helpers (format, API, icons, popover, sheet)
app/macos/         native Mac app (Swift, WKWebView) that runs the server: npm run app
design/            design-system mirror: tokens.json → web/tokens.css, components.css (served as /components.css)
test/              npm test (mocked Plaid and SimpleFIN)
data/keel.db       your data (SQLite). Back this up (with the secret key, if you connect banks); delete it to start over.
```

Amount convention (from Copilot): **positive = money out, negative = money in.**

## Design

Screens follow the *Daybook* design system (`design/`; see CLAUDE.md): light-first with a
full dark theme, figures in IBM Plex Mono, green = income/up, red = over/down, amber =
attention. Build order and per-screen specs are in `docs/screens/`.

Keyboard: `⌘K` search · `⌘J` ask Daybook · `⌘1…9` screens · in Transactions `↑/↓` move, `R` review, `E`
category, `F` filter, `/` search, `⌘A` select all, `Esc` clear/close.
