# Architecture

## Runtime
A single Node.js 22 process serves the Fastify API, compiled React UI, position manager, and market scanner. This is deliberate: the worker must stay alive, so a persistent Docker/VPS runtime is the primary deployment target rather than serverless-only hosting.

## Components
- `src/server/binance/client.ts`: signed/public Binance REST client using native `fetch` + HMAC SHA-256.
- `src/server/risk.ts`: account/day-loss/open-position/leverage/notional sizing gates.
- `src/server/strategy.ts`: liquidity-first 5m breakout scanner with completed-candle confirmation, volume expansion, taker ratio, 15m trend, ATR, and anti-chase logic.
- `src/server/execution.ts`: normal market orders, Binance Algo STOP/TP3 protection, manual/external position protection.
- `src/server/manager.ts`: background TP1/TP2 partial close and stop advancement.
- `src/server/db.ts`: SQLite settings, signals, plans, audit.
- `src/server/routes.ts`: authenticated dashboard API and emergency controls.
- `src/client/*`: RTL, mobile-first control dashboard.

## Binance compatibility
Regular USD-M Futures endpoints are used (`/fapi/*`). Account/position reads use v3 endpoints. Conditional STOP/TAKE_PROFIT orders use `/fapi/v1/algoOrder`, because Binance migrated conditional orders away from `/fapi/v1/order` and returns `-4120` there for these types after the migration.
