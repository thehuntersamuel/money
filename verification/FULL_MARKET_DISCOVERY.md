# Full-market discovery implementation — 2026-09-05

## Scope

Private Morrow bridge gains a read-only research-query operation: Alpaca supported U.S. equity directory, company search, metadata, daily SIP history and current SIP quote snapshots; Tiingo full ticker directory, ticker search, metadata, raw/adjusted OHLCV history, broad news discovery and ticker/date-filtered news. Existing SEC/BLS/FRED/primary-document adapters are also reachable with their existing requirements. Paid fundamentals, institutional bulk news, non-stock streams and unprovisioned credentials are not claimed available.

Full discovery is independent from live stream capacity. The persistent worker refreshes desired symbols every 30 seconds, combines watchlist + active proposals + open paper exposure, verifies the Alpaca U.S. equity directory and updates subscriptions on one existing socket. Default seed benchmarks remain SPY/QQQ. The 500-symbol runtime capacity is explicit; overflow is not silently truncated. Unsupported legacy crypto watchlist symbols are retained in the Hub and reported outside stock SIP coverage; unsupported open paper exposure fails closed.

A proposal or decision write now also adds its symbol to the reference watchlist, preserving existing notes. Both writes have readbacks. They are not one database transaction: a partial failure returns an error and the identical idempotent retry repairs watchlist synchronization. No history rewrite or financial mutation is added.

## Verification evidence

- Downloaded and parsed the official Tiingo directory: 108,561 listings at verification, including AAPL. Directory includes historical/reserved and non-U.S. entries, so listing does not certify availability or eligibility; query metadata.
- Tests cover broad directory pagination/caching, market-wide news without a ticker filter, credential/permission failure, invalid requests, automatic symbol union, retained notes/readback, same-socket add/remove acknowledgement, and missing acknowledgement failing closed.
- Existing paper lifecycle, entry guards, authentication and UI tests retained.
- Supabase check at 2026-09-05T04:59:24.747Z verified both provider credentials are present, but ALPACA_LICENSE_APPROVED, ALPACA_ARCHIVE_APPROVED, ALPACA_DISPLAY_APPROVED, TIINGO_LICENSE_APPROVED, TIINGO_ARCHIVE_APPROVED, TIINGO_DISPLAY_APPROVED and TIINGO_NEWS_APPROVED are all false/not enabled in that environment. This differs from the existing Render worker configuration. No secret values were returned. Diagnostic endpoint retired to HTTP 410 with JWT verification.

## Deployment gates

1. Enable the previously authorized private provider-use configuration in Supabase (seven exact flags above); this is deployment configuration, not a request for another subscription. The available connected Supabase tools cannot edit project secrets. Current gating is retained, not bypassed.
2. Deploy reviewed main to the existing Render worker. Shared Render browser is signed out. Do not reset its persistent retry budget or turn on additional workers.
3. Install the updated Mac bridge CLI and discovery amendment using the existing reversible installer; preserve six GPT-5.6/high jobs, global fallback and deterministic guard. Mac execution receipts still required.
4. Verify live research-query receipts for directories, metadata, news, history and quotes; observe expanded SIP subscription acknowledgement and per-symbol event freshness on market data arrival. Off-session silence cannot certify current coverage.

Source references: official Alpaca assets, historical stock bars, and streaming-market-data documentation; Tiingo end-of-day directory/metadata and news documentation. No real orders, transfers, new reasoning schedules, or champion/readiness activation.

Rollback: restore the prior bridge bundle and worker commit. Preserve non-destructive watchlist additions and all paper close/entry safeguards. Do not delete research or reset reconnect state.
