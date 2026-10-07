# Smoke test

Before live trading:

1. Run `npm install`.
2. Run `npm run check` â€” Node syntax checks should pass.
3. Run with live flags OFF.
4. Open the dashboard on a phone and confirm the mobile coin cards render.
5. Select a coin and confirm funding, countdown, settlement time, max leverage, spread, net edge and minimum notional are shown.
6. In paper mode, click **PREPARE** and confirm it reports that live setup is skipped.
7. Confirm `START BOT`, `STOP`, `AUTO ON/OFF`, and `PANIC CLOSE` are protected by `BOT_AUTH_TOKEN`.
8. In paper mode, opening a position should schedule an automatic paper close at the stored funding timestamp.
9. For live trading, create a dedicated Toobit API key with trading permissions only; do not enable withdrawals.
10. Enable live flags only after the above checks and after verifying current Toobit API rules.

## Latency check

The code schedules the funding-close trigger with a 1 ms local delay when `CLOSE_DELAY_MS=1`. This is **not** a 1 ms exchange execution guarantee. Measure real order acknowledgement and fill latency from the deployed server, not from the browser.
