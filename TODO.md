# Next after live validation

- Add Hedge Mode only after dedicated integration tests against Binance Demo Trading.
- Add WebSocket incremental account/order cache (`ACCOUNT_UPDATE`, `ORDER_TRADE_UPDATE`, `ALGO_UPDATE`) to reduce REST polling.
- Add PostgreSQL option for multi-instance/high-availability deployment.
- Add Telegram/WhatsApp notification adapter if required.
- Add historical strategy replay/backtesting and performance attribution before enabling FULL_AUTO.
