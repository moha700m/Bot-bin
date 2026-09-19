# Trading & Safety Rules

1. Live orders require all three: Binance credentials, `ALLOW_LIVE_TRADING=true`, and `DRY_RUN=false`.
2. New automated trades are blocked in OFF and MANAGE_ONLY modes.
3. FULL_AUTO is blocked unless the environment explicitly permits live trading.
4. Every automated entry requires a valid stop and quantity produced by the risk engine.
5. Default risk per trade: 0.5% of margin equity. Default daily realized-loss kill limit: 3%.
6. Default automatic leverage ceiling: 8x. Existing manually opened higher-leverage positions can still be observed/protected.
7. New entries are rejected when max open positions is reached or the same symbol is already open.
8. Withdrawal permissions are never needed and must remain disabled on the Binance API key.
9. Exchange-native STOP_MARKET and final TAKE_PROFIT_MARKET use Binance Algo endpoints introduced for conditional orders.
10. TP1 and TP2 partial management is performed by the persistent worker. TP3 also has exchange-native close-all protection when live.
11. All execution decisions and failures are written to the audit table.
