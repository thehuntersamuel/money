# Alpaca connection check — 2026-09-05 03:39 UTC

Result: credentials and explicit SIP snapshot access verified from Supabase.

- Required Alpaca key and secret were present in server environment; values were never returned or logged.
- GET data.alpaca.markets/v2/stocks/snapshots?symbols=SPY&feed=sip returned HTTP200 with valid quote/trade structures and timestamps.
- GET paper-api.alpaca.markets/v2/clock returned HTTP200; market was closed.
- An internal authenticated request to morrow-data returned HTTP200 / status disabled. MORROW_INGEST_ENABLED was false.
- No order, transfer, data ingestion or provider snapshot storage occurred. Prices and raw provider response bodies were not retained in the test report.
- Test transport request25807 completed HTTP200 without timeout.

The temporary diagnostic used an unguessable, short-lived custom bearer gate and fixed request routes. After the check it was replaced with an inert HTTP410 handler, with gateway JWT verification enabled. It no longer reads any credentials or calls providers. The temporary bearer was discarded.

The check helper and two synthetic tests are retained for reproducibility. This verifies REST credential/SIP access and the disabled ingestion gate, not continuous WebSocket coverage, archival/display licensing, Mac integration, or completed market-hours canaries. Continuous ingestion remains disabled pending those gates.
