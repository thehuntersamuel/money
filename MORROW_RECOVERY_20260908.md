# Morrow recovery — 8 September 2026

## Diagnosis and evidence

Render service `morrow-alpaca-sip` is running source `7f055be1d4ab62e0f4e19629ec0592fe806c3a39`. Its only terminal log on September 8 says the worker stopped at 04:12:27 ET. At 23:50:27.363 UTC, a read-only inspection of `/var/data/morrow/commissioning-1.json` returned `version:1, run_id:commissioning-1, attempts:5`. The service was parked after exhausting its durable connection allowance. A normal restart cannot restore ingestion.

The database's last pre-repair market event was at 08:12:19.037998 UTC, received at 08:12:19.874 UTC. The last SPY event was 08:12:18.473302 UTC. This is an ingestion stoppage, not a browser cache or reversed pagination. The prior worker erased detailed reasons and emitted truncated health JSON, so the exact first failure of each historical attempt is not recoverable from the retained logs. Do not present a reproduced defect as proof of that particular historical trigger.

Reproduced defects: the old 100-frame queue threshold discarded accepted work during bursts; the liveness check compared the moving REST frontier against persisted events and could reconnect for an in-flight event or a quiet peer; replay did not initialize persisted freshness; one malformed/HTTP news URL rejected a whole news page; and one rejected local research record stopped unrelated records from syncing.

## Repair

- Coalesce websocket frames into durable writes of at most 250 observations. Bound accepted input to 20,000 records / 4 MB. Drain accepted work on overflow and preserve an explicit gap reason. Retry ambiguous writes idempotently using the existing unique source ID.
- Compare only stale symbols against REST evidence settled by at least 15 seconds. Wait for accepted writes before comparing. Quiet symbols remain stale and cannot authorize entries.
- Seed freshness from durable replay. Preserve socket/provider/write error categories and last-good event/persistence timestamps in valid health JSON under the existing 200-character limit.
- Validate news per article in both discovery and ingestion; remove query/fragment tracking, deduplicate IDs/URLs, report rejected/duplicate counts and partial coverage. Allow a bounded market-wide news ingestion page. Retain primary-source verification requirements.
- Preserve rejected local records and append immutable sync issues. Continue independent records, defer unsynced dependencies, and retry idempotently. Nonzero CLI exit still signals pending work.
- Show stopped-feed cause and last-good event in the Hub. Missing ingestion receipts do not assert that on-demand provider access is broken.

No real orders, transfers, risk-limit changes, champion activation, scheduler/model changes or new paper openings are included. The existing readiness block remains. The expired NVDA proposal remains rejected.

## Deployment and rollback

Deploy only the reviewed merged revision. Update both `morrow-bridge` and `morrow-data` with their relative server dependencies; preserve custom bearer authentication on the bridge and service-role authentication plus JWT verification on the data worker. Render continues using `node server/sip-worker.mjs` on the existing disk and compute plan.

Preserve the old `commissioning-1.json`; use a separately named operator-approved recovery run ID in Render after code deployment. Do not delete the old counter, reset it automatically, or raise its five-attempt maximum. Read the new run state and logs, then verify event time and receipt time independently in Supabase. A subscription ACK alone is not acceptance.

Rollback source to the prior revision and redeploy the preserved prior function bundles. Keep all observations, immutable research history, sync receipts, sync issues and failure counters. If necessary, disable ingestion and leave the worker parked; do not restore paper openings. No database migration is required by this patch. The additive local SQLite sync-issue table is compatible with the previous script.

## Mac verification task — still requires access to the actual Mac

From the updated repository, run `python3 scripts/morrow_mac_setup.py plan`, then `python3 scripts/morrow_mac_setup.py install`. The installer backs up scripts and writes a rollback manifest without modifying jobs or credentials. Record that manifest path. Run `python3 scripts/morrow_mac_doctor.py` and inspect any drift before changing anything. Use the installed `morrow_runtime.py sync`; preserve rejected canary records and inspect the new issue report. Retry must not duplicate successful records.

Use Morrow's existing private bridge credential for `state`, `data_read`, `research_query`, and `research_state`; never copy provider/service keys to the Mac. Verify a naturally scheduled run consumes current evidence and records actual hosted provider/model/reasoning evidence. Compare jobs against `mac/scheduler-baseline.json`; investigate the reported nine-active-job versus seven-policy discrepancy without silently deleting jobs or changing global routing.

Demonstrate a newly discovered liquid stock reaching an independently sourced watch/reject decision visible in the owner-authenticated Hub. Research needs a mechanism, strongest bear case, benchmark, horizon, invalidation/time exit, source publication and retrieval times, and explicit missing evidence. News pages are discovery inputs, not research qualification. Do not fabricate a Morrow run or force a paper trade.

## Acceptance still needs live evidence

Record deployment SHAs/versions and canary request/readback IDs in a separate release receipt. Regular-session multi-symbol advancement, real consumer access, a naturally scheduled attributed research run, owner-authenticated display, and delivered alert evidence remain pending until actually observed. After-hours replay or an authenticated server probe is not a substitute. Alert stdout is not delivery proof; use the existing approved channel only with its actual delivery receipt.

Exact provider invoices and included rights still need account evidence. Public advertised limits are not account-specific proof. There are no verified paper outcomes establishing net subscription value. Allocate subscription, hosting, storage and inference cost once across the evaluation period; compare matured paper outcomes with exposure-matched passive/mechanical baselines after costs. Keep shadow and rejected ideas separate from executed samples.

References: [Alpaca market data](https://docs.alpaca.markets/us/docs/about-market-data-api), [Alpaca streaming](https://docs.alpaca.markets/us/docs/streaming-market-data), [Tiingo plans](https://www.tiingo.com/about/pricing), [Tiingo API](https://www.tiingo.com/documentation/general/overview), [Supabase deployment](https://supabase.com/docs/guides/functions/deploy).
