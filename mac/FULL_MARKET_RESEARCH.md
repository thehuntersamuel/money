# Full-market research interface

Install the reviewed main revision using the existing Mac installer, then append the discovery amendment in JOB_AMENDMENTS.md to the existing reasoning jobs. Do not alter model pins, cadence, guard, or fallback. Installation and natural job execution need independent readback on the Mac.

Use the existing private bridge credential; never copy provider keys onto the Mac or into prompts. Save a request JSON locally and run:

```sh
python3 ~/.hermes/scripts/morrow_finance_bridge.py research-query --payload request.json
```

Request examples (the CLI adds `operation: research_query`):

```json
{"provider":"alpaca","action":"universe","limit":100,"offset":0}
```
```json
{"provider":"tiingo","action":"universe","limit":100,"offset":0}
```
```json
{"provider":"alpaca","action":"search","query":"semiconductor"}
```
```json
{"provider":"tiingo","action":"metadata","symbol":"NVDA"}
```
```json
{"provider":"tiingo","action":"news","limit":100}
```
```json
{"provider":"tiingo","action":"news","symbols":["NVDA"],"start":"2026-09-01","end":"2026-09-05"}
```
```json
{"provider":"tiingo","action":"history","symbol":"NVDA","start":"2025-09-05","end":"2026-09-04"}
```
```json
{"provider":"alpaca","action":"history","symbol":"NVDA","start":"2025-09-05","end":"2026-09-04"}
```
```json
{"provider":"alpaca","action":"quotes","symbols":["NVDA","AAPL"]}
```
```json
{"action":"source","dataset":"sec_company_map","symbols":["NVDA"]}
```

Dates above are examples, not a fixed recurring window. Follow `next_offset` for directory pagination. Tiingo search matches ticker strings (the directory has no company names); obtain company names/descriptions through metadata. Tiingo's entire directory includes reserved symbols and non-U.S. listings; current research/paper symbol validation remains U.S. stock/ETF oriented. Read the returned coverage and verify API metadata for a candidate.

Private responses include source URLs, retrieval times, coverage and result status. `ok:true` is a successfully handled request, not proof of provider availability: require `result.status === "ok"`. A blocked response identifies missing approved-use configuration. No request authorizes orders or transfers.

Deployment: update the existing Render worker to the reviewed main commit. MORROW_SYMBOLS are seed benchmarks, not the discovery universe. The live stream has a 500-symbol server capacity; overflow fails explicitly instead of silently omitting symbols. Read-only directories can be paged across the entire provider list independently of that capacity. Unsupported stock-stream symbols (such as legacy crypto watchlist rows) are logged and retained in the Hub; unsupported open paper exposure stops the worker for review.

Required approved-use flags in Supabase for the private gateway: ALPACA_LICENSE_APPROVED, ALPACA_ARCHIVE_APPROVED, ALPACA_DISPLAY_APPROVED; TIINGO_LICENSE_APPROVED, TIINGO_ARCHIVE_APPROVED, TIINGO_DISPLAY_APPROVED, TIINGO_NEWS_APPROVED. Preserve existing secrets and entry readiness. These are operator configuration gates, not additional purchases. Do not bypass gates or claim they're enabled before readback.

Rollback: restore the prior bridge bundle and worker commit; existing research/watchlist additions are non-destructive and should be preserved. Do not reset the durable reconnect budget to hide failed connections. Existing position exits and entry guards remain unchanged.
