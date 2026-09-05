# Alpaca continuous stream deployment

Prepared server configuration, not a claim that hosting is provisioned or stream coverage is verified. Tiingo remains deferred.

## Proposed service for owner approval

One Render background worker, native Node24, 0.5 CPU /512MB, Virginia, plus1GB persistent disk. Current published base compute is $7/month and persistent disk $0.25/GB-month: estimated base $7.25/month, excluding taxes, applicable workspace fees, transfer/usage overages and existing Supabase/Alpaca charges. Confirm the actual account checkout before creating anything. No hosting purchase has been performed.

[Render pricing](https://render.com/pricing), [continuous background workers](https://render.com/docs/background-workers), [Blueprint configuration](https://render.com/docs/blueprint-spec), [persistent disks](https://render.com/docs/disks).

`render.yaml` is the concrete configuration. It creates no web endpoint and no scheduler. One instance and persistent disk prevent horizontal duplication. Automatic source deployment is off so a Git commit cannot silently restart/reset the feed. Supabase continues to store observations/events/health; Morrow and the Hub consume their existing authorized projections.

Supabase Edge Functions have finite worker lifetimes (150seconds free/400seconds paid), so their deployment does not provide this always-on socket. [Supabase limits](https://supabase.com/docs/guides/functions/limits).

## Credential and activation procedure — implementer owned

1. Obtain owner approval for the exact host cost and account access. Use an approved server-only secret transfer mechanism. Never expose keys in chat, Git, browser automation, logs or the Mac research user. The Render worker is privileged infrastructure; restrict project access accordingly.
2. Provision the Blueprint at the reviewed Git revision, retaining all false activation flags. Install the three server secrets through secure provider mechanisms. Secrets already in Supabase do not automatically appear on Render.
3. Confirm Node24, attached persistent disk, one instance and a parked disabled process with no provider requests. Verify actual source revision, memory limits, restart settings and shutdown behavior.
4. Check actual Alpaca personal-use/automation/display/archive terms for this private architecture. The successful SIP REST test proves access, not archival permission. Keep archival-dependent storage blocked until rights are established; do not enable for an incompatible finite-retention-only license.
5. After approval, set the server licensing/archive flags and enable only this worker. Keep the bounded HTTP ingestion endpoint disabled unless separately commissioned. Initial SPY/QQQ is a commissioning universe, not full research-universe coverage. Before enabling any trading readiness, reconcile all active proposal/open-position symbols with the bounded configured universe (max30); uncovered symbols remain blocked. Universe expansion is an implementer action and must respect load/storage budgets.
6. Check SIP WebSocket authentication/subscription, official calendar/holiday behavior, event and receive timestamps, stored source IDs, duplicate replay, stale coverage and bounded REST gap repair. Check actual usage before widening the universe. Read back health and durable events separately through Supabase/Hub. No paper opening is enabled by this configuration.
7. With Mac access, finish existing monitor binding and readback through the scoped bridge; keep the seven existing jobs and hosted-model controls unchanged. Observe real market-hours data/review latency before declaring continuous coverage verified.

## Durable restart control

Every connection attempt reserves one of five attempts on the persistent disk before any provider call. Host process restarts reuse that allowance. Corrupt state, abandoned reservation locks and unsafe paths stop before connection. The process parks on terminal failure rather than triggering an unbounded host restart loop. Existing active connection shutdown drains outstanding writes; health remains blocked/stale after failure.

Only after investigating a failure may the operator explicitly set a new `MORROW_STREAM_RUN_ID` and redeploy. Retain old budget files; do not automatically rotate the ID, remove the disk, clear state or use new IDs on every restart. A crashed reservation can leave a lock requiring operator inspection. The allowance intentionally includes planned service restarts, so monitor remaining attempts. A parked process is NOT healthy ingestion; Hub freshness/coverage is the authority, not a host's green process badge.

## Rollback and current boundary

Disable/suspend this worker first; preserve its disk and all Supabase audit/observation/event records. Restore the prior reviewed worker only after verifying restart controls remain intact. Keep safe paper exits and existing Mac monitoring. No whole-ledger delete or whole-cron-store replacement.

Current evidence: Alpaca REST credential/SIP and disabled-ingestion checks passed; local supervisor/persistence tests passed. Render account access and purchase approval are missing. No persistent worker or new provider connection was started by preparing these files. Runtime canaries and licensing/archive approval remain activation gates.
