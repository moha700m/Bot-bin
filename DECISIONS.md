# Decisions

- Persistent Docker runtime over Vercel-only execution: position management needs a continuously running worker and stable egress IP for Binance API whitelisting.
- Raw Binance REST client over an SDK: smaller dependency surface and easier adaptation to Binance's 2026 Algo endpoint migration.
- SQLite for v1: single-user, one-process deployment; WAL mode provides adequate durability without adding an external database.
- One-way Mode only in v1: prevents ambiguous reduce-only/close-position behavior. The server checks Binance position mode before an automated entry.
- Exchange-native hard stop + TP3, worker-managed TP1/TP2: hard protection survives worker downtime while avoiding conflicting multiple reduce-only conditional quantities.
- Dry-run is the default and cannot be bypassed from the UI alone.
