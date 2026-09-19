# Binance Futures Command Center

Private Arabic/RTL dashboard and execution bot for Binance USD-M Futures. It supports manual position management, approval-first signals, gated full automation, exchange-native stop protection, partial take profit management, risk sizing, an emergency kill switch, and a durable audit trail.

## Safety default
Fresh installations **cannot trade live**. `DRY_RUN=true` and `ALLOW_LIVE_TRADING=false` are the defaults. The dashboard cannot override those environment gates.

## Quick start

```bash
cp .env.example .env
# Set ADMIN_PASSWORD and SESSION_SECRET first.
npm install
npm run check
npm run dev
```

Open `http://localhost:5173` in development. The API runs on port 3001.

## Required Binance API permissions
Create a dedicated Binance API key with Futures trading permission and read access. Keep withdrawals disabled. Restrict the key to the public IP of the server before enabling live trading.

Set:

```env
BINANCE_API_KEY=...
BINANCE_API_SECRET=...
BINANCE_BASE_URL=https://fapi.binance.com
```

Start in simulation:

```env
DRY_RUN=true
ALLOW_LIVE_TRADING=false
```

After demo/dry-run validation, live execution requires **both**:

```env
DRY_RUN=false
ALLOW_LIVE_TRADING=true
```

The UI still controls `OFF`, `MANAGE_ONLY`, `APPROVAL`, or `FULL_AUTO`; `FULL_AUTO` is rejected by the backend when the environment gate is closed.

Optional Telegram alerts are enabled when both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set. The bot sends only actionable signal/TP events.

## Production deployment
Use a small Linux VPS with a stable public IP so the Binance API key can be IP-whitelisted.

```bash
cp .env.example .env
# fill secrets
sudo docker compose up -d --build
```

Persist `./data` and back it up. Put Caddy/Nginx/Cloudflare in front for HTTPS. Do not expose port 3001 directly to the internet without TLS/firewall controls.

## Modes
- `OFF`: scanner and manager do nothing.
- `MANAGE_ONLY`: manage existing saved protection plans; no new signals/entries.
- `APPROVAL`: scan and queue confirmed signals; user approves execution.
- `FULL_AUTO`: scan and execute the best confirmed signal, but only within risk limits and only when environment live gates are open.

## Position management
For an existing manually opened Binance position, use `اقتراح حماية` to calculate an ATR-based stop/targets, review them, then install the plan. In live mode the server places an exchange-native STOP_MARKET and TP3 close-all Algo order. TP1/TP2 are handled by the worker, which advances the stop to breakeven after TP1 and to TP1 after TP2.

## Binance 2026 API note
Binance migrated USD-M conditional order types to the Algo service. This code uses `/fapi/v1/algoOrder` for STOP/TAKE_PROFIT protection instead of sending conditional types through `/fapi/v1/order`.

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
# or all at once
npm run check
```
