# Binance Futures Command Center

Single-user production dashboard + persistent Node.js worker for Binance USD-M Futures.

## Goals
- Read account balances and open futures positions.
- Manage manually opened positions with exchange-native hard stops and a TP plan.
- Generate confirmed 5m breakout/breakdown signals with liquidity/volume/taker/15m filters.
- Support approval-first execution and a gated full-auto mode.
- Keep a durable SQLite audit trail.
- Default to dry-run and deny live trading unless two server-side safety gates are enabled.

## Non-goals v1
- Hedge Mode. v1 intentionally requires Binance One-way Mode.
- Portfolio Margin-specific PAPI execution.
- HFT/sub-second strategies.
- Custody, withdrawals, transfers, or wallet operations.
