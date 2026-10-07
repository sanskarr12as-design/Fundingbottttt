# GitHub + Server Deployment

## Put these exact files in the GitHub repository

```text
index.html                    # move/copy from public/index.html
package.json
render.yaml
server.js
src/bot.js
src/toobit.js
.env.example
.gitignore
README.md
GITHUB_DEPLOY.md
SMOKE_TEST.md
```

Recommended repository structure:

```text
toobit-funding-bot/
â”œâ”€ public/
â”‚  â””â”€ index.html
â”œâ”€ src/
â”‚  â”œâ”€ bot.js
â”‚  â””â”€ toobit.js
â”œâ”€ data/                     # created automatically at runtime
â”œâ”€ .env.example
â”œâ”€ .gitignore
â”œâ”€ GITHUB_DEPLOY.md
â”œâ”€ README.md
â”œâ”€ SMOKE_TEST.md
â”œâ”€ package.json
â”œâ”€ render.yaml
â””â”€ server.js
```

## Important: GitHub alone is not the bot server

GitHub stores the source code. The Node/Express server must run somewhere for the scanner, WebSocket feed, auto mode, and order execution to continue when your phone/browser is closed.

A compatible Node host can deploy this repository using:

```text
Build: npm install
Start: npm start
Health: /api/health
```

## Environment variables

Configure these on the server/host, never inside `public/index.html`:

```text
TOOBIT_API_KEY=your_key
TOOBIT_SECRET_KEY=your_secret
BOT_AUTH_TOKEN=long_random_dashboard_token
ENABLE_LIVE_TRADING=false
ALLOW_LIVE_ORDERS=false
```

Start in paper mode. Only after verifying the scanner/order flow should you consider enabling live orders.

## First-open key screen

On the first dashboard open, `public/index.html` asks for `BOT_AUTH_TOKEN`. The value is kept only in the current browser session (`sessionStorage`) and sent as a Bearer token to the server.

The HTML does NOT ask users to paste the Toobit secret into a public GitHub file and does NOT save the Toobit secret in browser storage.

## Mobile

`public/index.html` is responsive. On small screens it switches from the wide table to compact coin cards. Selecting a coin shows:

- funding rate
- funding receiver side
- next funding countdown
- settlement time
- max leverage
- selected leverage
- spread
- estimated net edge
- minimum notional
- executable price

## Speed

The code uses a persistent market WebSocket and server-side timers/preparation to minimize avoidable latency. `CLOSE_DELAY_MS=1` is the local timer target (1 ms), but network/exchange matching latency is outside the application's control, so a guaranteed 1 ms exchange fill cannot be promised.
