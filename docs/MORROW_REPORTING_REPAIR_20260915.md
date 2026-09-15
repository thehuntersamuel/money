# Morrow reporting repair — September 15, 2026

Base: `0310b73d0d4b9dba00298c07b03c53f82af39baa`. This release changes the dashboard, the existing research-query receipt path, and the installable local research sync. It does not change Render ingestion, trading permissions, model routes, schedules, subscriptions, credentials, or database schema.

## Problem and repair

1. Proposal reviews and immutable research-ledger records are distinct stores. New proposal decisions were visible in the activity list while Research notes and job status stayed old. The UI now combines both for display, preserves their attribution and source links, and chooses the newest research version per stable proposal key. It never inserts synthetic ledger records, backdates an execution receipt, or equates a proposal with a scheduled job.
2. The latest saved job receipt could remain a blocked historical report indefinitely. Operations now dates the actual run finish and separately exposes historical blockers, reported provider/model/reasoning, and the absence of independent runtime verification. Newer research cannot clear those blockers automatically.
3. Successful Tiingo on-demand queries returned data without updating persisted snapshots and integration health. The existing authorized gateway now saves only normalized history/news results, preserves query scope, retrieval time, coverage and a content hash, reads the saved snapshot back, then records health. It performs no additional provider request. Failed persistence remains explicit in the response and never destroys otherwise usable data. Revoked archive/display/news permission prevents saving.
4. Old daily-history/news samples were displayed as saved without an age warning. News older than 24 hours and daily history older than 96 hours now say the sample needs refresh. These are presentation thresholds, not strategy eligibility rules: users must still inspect actual market dates, news dates and requested coverage. Old samples do not establish a provider outage.
5. A bounded local sync batch could repeatedly attempt the same rejected records and starve later ones. The revised installer payload preserves an operational attempt log, skips locally invalid records without consuming network slots, and rotates remote retries within the unchanged 100-attempt budget. Research, original failures and server receipts remain immutable. This requires actual installation on the Mac.

## Verification and remaining boundary

Regression coverage includes cross-book isolation, proposal/ledger deduplication, HTML escaping, historical-versus-current job status, paid-data sample age, successful snapshot/readback, broad-versus-ticker scope, revoked licensing, failed writes/readbacks, invalid canary isolation and fair retry batches. Existing entry/close, source, SIP capacity and authentication tests remain required.

The checked-in synthetic previews use only TEST data and disable backend network access. They demonstrate fresh proposal research beside old execution receipts and old provider samples. They are layout/regression evidence, not real research or live provider evidence.

Deployment completion requires the merged source, GitHub Pages release marker `2026-09-15-r1`, the updated `morrow-bridge` bundle and unchanged authentication settings. A deployed function does not prove a successful authenticated consumer request. The next real Tiingo query must produce a verified `persistence.status=saved` receipt before claiming that production path exercised. No authenticated bridge credential is embedded in this release.

Mac acceptance remains a separate boundary: follow the new opening section of `mac/MORROW_MAC_HANDOFF.md`. Do not fabricate run metadata or remove evidence gates to make the display green. Fresh feed health does not activate a champion or permit new paper entries.

## Rollback

Revert this release through a reviewed Git commit for Pages. For the Edge Function, redeploy the retained previous v21 bundle with its original custom authentication and `verify_jwt=false`; never substitute a broader credential or weaken the body check. No database migration needs reversing; preserve any new immutable snapshots and receipts. Do not restart or redeploy the unrelated Render worker. On Mac, use the installer's private manifest to restore only installed files, preserving ledgers and the operational attempt log. Verify any pre-existing paper exit obligations before altering their tools.

See `docs/MORROW_DASHBOARD_WORKFLOW.md` for the operating workflow.
