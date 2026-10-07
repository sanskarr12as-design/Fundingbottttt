# Toobit Funding Bot

Mobile-first funding-rate scanner and low-latency execution dashboard for Toobit USDT-M futures.

## What it does

- Scans Toobit futures funding rates and ranks candidates.
- Shows funding direction, next funding time, spread, estimated net edge, score, min notional, and leverage limits.
- Lets you select a coin and prepare leverage/margin before the funding window.
- Supports paper mode and guarded live mode.
- Auto mode can select eligible candidates and open a single position.
- Schedules the funding-time close on the server.
- Has a panic-close control.
- Keeps trade history on the server filesystem.
- Uses WebSocket market data for the fast path.
- Uses a browser-session dashboard auth token; Toobit credentials remain server-side.

## Files

- `public/index.html` â€” complete mobile dashboard UI.
- `src/toobit.js` â€” Toobit REST helpers, signing, contract normalization and quantity sizing.
- `src/bot.js` â€” scanner, strategy, preparation, open/close execution and risk guards.
- `server.js` â€” Express API + WebSocket dashboard server.
- `.env.example` â€” server configuration template.
- `render.yaml` â€” Node service deployment template.
- `GITHUB_DEPLOY.md` â€” exact GitHub/server deployment notes.
- `SMOKE_TEST.md` â€” offline checks performed on the source.

## Security

Never commit `.env`, a Toobit secret key, or a live API credential to GitHub. Give the Toobit API key only the permissions required for futures trading; disable withdrawals.

The dashboard's first-open prompt is for `BOT_AUTH_TOKEN`, not the Toobit secret. It is kept in `sessionStorage` for the current browser session.

## Run locally

```bash
cp .env.example .env
npm install
npm run check
npm start
```

Open `http://localhost:3000`.

The first open asks for `BOT_AUTH_TOKEN`. Set the same value in `.env`.

## Live mode

Keep both flags false until paper mode is verified:

```env
ENABLE_LIVE_TRADING=false
ALLOW_LIVE_ORDERS=false
```

For live trading, set both to `true` and provide valid server-side Toobit credentials.

## Important speed note

`CLOSE_DELAY_MS=1` means the application timer targets 1 ms after the stored funding timestamp. It cannot guarantee a 1 ms exchange-side execution/fill because browser, server, network, exchange queue and matching latency are outside the application's control.

## Current Toobit API conventions

The project uses Toobit's documented v1 USDT-M futures order convention: market-style execution is represented by `type=LIMIT` together with `priceType=MARKET`, and signed requests use the `X-BB-APIKEY` header. Toobit also recommends checking per-symbol exchange info for `MIN_NOTIONAL` and `LOT_SIZE` rather than assuming every contract has the same minimum order. 
