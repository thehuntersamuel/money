# Tiingo connection check

Verified 2026-09-05T04:37:07.097Z against the TIINGO_API_KEY stored in the Money Hub Supabase project. No provider key was returned or logged.

- SPY end-of-day prices, August 31 through September 4: HTTP 200, five rows; date, positive OHLC/adjusted close and nonnegative volume checks passed. Latest date September 4, 2026.
- SPY news, limit three: HTTP 200, three records; ID, title, URL and publication/crawl timestamp structure checks passed. This does not independently verify article claims.
- Fixed-route diagnostic used a random bearer credential, hashed in the deployed source, with a five-minute expiry and one-use guard per instance. No provider payload was persisted, no recurring ingestion enabled, and no order/transfer route invoked.
- pg_net request 25866 returned HTTP 200 without timeout.
- Diagnostic morrow-tiingo-check was immediately replaced by an inert HTTP 410 handler, version 2, with JWT verification enabled and no environment/provider access.

This confirms credential and dataset access only. Scheduled ingestion, storage/display terms and end-to-end Hub/Morrow readback remain unverified. The unrelated Alpaca streaming worker configuration was not changed.
