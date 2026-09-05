# Money Hub / Morrow implementation checkpoint

Status: **review branch only; not deployed or activated**.

## Source reconciliation

- Upstream inspected: `97fb070` on `main`. Its recent proposal-price and position-money UI changes were preserved.
- Portable lifecycle source: `0f40c85ec7be48bb7e83c3488cef2365a33241af`.
- Supplied staged close patch applied and then repaired. A PostgreSQL-engine test reproduces its ambiguous-column failure before testing the repair.
- Live project: `fglbxoafbebsryjeqcbu` / `money-hub`.
- Live bridge inspected: version 4, artifact hash `995398e347f967c9805dabc2888bce69eb0dea62e179c70f5c8256773f79cd98`.
- Existing live placement SQL already has the aliased proposal update; portable historical migration was aligned with that fix.
- Live close was a direct trade update, without atomic proposal reconciliation or a canonical close receipt. No deployed `close_morrow_paper_trade` RPC was present.
- Read-only aggregate inspection found zero open positions and one closed paper position. No trade mutations were performed.
- `before/` preserves inspected function source, not account data or credentials.

## Implemented on this branch

- Atomic linked close; book/symbol/real-position checks; exact retries; conflicting retry rejection; immutable receipts; transaction rollback on receipt failure.
- Durable first-touch review events per proposal/thesis version. A receding price does not erase an event. No fabricated replay of the historical SPY incident: only clearly identified synthetic fixtures were available.
- Append-only proposal snapshots and observations with owner-only/minimized reads. Raw SIP observations are not exposed to browser roles.
- New Savings openings fail closed in both patched Edge handler and database trigger. No real order/transfer routes.
- Monitor distinguishes failed fetch, stale quote, unknown/missed coverage and durable due events; review dates use New York time. Mac installation is NOT complete.
- Server-only explicit-SIP HTTP adapter and stream worker; bounded replay/pagination; overlap recovery between REST and socket subscription; duplicate-safe inserts; backpressure/disconnect/persistence failures stop the stream. Worker is not running.
- Calendar client uses read-only paper API calendar; half-day and DST classification tests. Unknown calendar stays unknown.
- Conservative paper-fill contract requires fresh SIP bid/ask, executable side and sufficient displayed size. It is NOT wired to placement while readiness is blocked.
- Optional Tiingo normalization separates raw/adjusted values and missing fields. Tiingo network integration/retention is NOT complete.
- Runtime receipt validator excludes unknown/fallback models from the GPT-5.6 cohort. It is NOT a Hermes routing interceptor. Shared GPT-5.4 fallback and seven Mac jobs were not changed.
- Trade UI: readiness first, search/state filtering, collapsed planner, readable controls, mobile touch targets, bounded tables and progressive disclosure. Current operations/ROI/experiment sections explicitly show unavailable data; they are NOT implemented analytical backends.

## Validation

Run `npm ci` then `npm test` in a suitable development environment. The committed lockfile pins PGlite 0.5.8.

Tests include PostgreSQL-engine execution via PGlite (not regex alone), supplied-defect reproduction, linked/manual close, exact retries, wrong book/symbol/real rejection, transaction rollback, immutable receipts, unauthorized roles, durable transient events, opening guard, rollback-with-exposure refusal, actual Edge-handler dispatch with test-only authentication, provider failures/pagination, streaming storage failures, calendar dates, model receipts, monitor behavior and inline module syntax.

**PGlite is not a native multi-session PostgreSQL server.** Concurrent close-vs-close, open-vs-close and close-vs-proposal-update rehearsals in separate native connections remain mandatory. The test schema is a minimized fixture; it does not replace a rehearsal against the exact live schema/RLS/grants. No independent review or patched-layout browser verification has been claimed. After explicit Chrome approval, the existing live desktop Trade tab was inspected; the isolated preview remained blocked by the browser environment.

## Remaining technical gates

1. Independent review of the exact commit; native PostgreSQL concurrency/rollback rehearsal with the actual schema and grants; security advisors after staging DDL.
2. Back up exact live schema and minimized paper records through a private approved mechanism before any deployment. Inspect live source again for drift.
3. Apply the additive close migration followed by `20260905013412_morrow_durable_events_and_guards.sql`; DO NOT replay the historical proposal migration already represented in live history. Use supported migration tooling to assign/reconcile the deployment version. Restore `before/` source only under the rollback runbook, retaining opening guards.
4. Provider licensing: validate personal vs commercial use, all viewers, display, caching, derived-data and retention rights. Secure server credentials and real SIP entitlement canaries are absent in this runtime. No subscriptions were purchased.
5. Wire/run deterministic ingestion in the approved server runtime with persistent health/coverage receipts, supervision and reconnect budget. No second Morrow reasoning scheduler.
6. Implement remaining source/strategy/evaluation contracts, point-in-time primary-source ingestion, optional Tiingo request/retention flow, actual operations telemetry and exposure-matched cost/ROI calculations. Placeholder UI must not be reported as completion.
7. Wire Mac monitor to deployed event projection and add supported Morrow-only routing guard or verified fallback-cohort exclusion. Obtain actual scheduler run/readback evidence through the configured handoff path. Mac files are inaccessible from this workspace.
8. Verify owner vs unauthorized reads and inspect mobile/desktop layout in an authorized browser. Hunter explicitly authorized Chrome in the follow-up. The existing authenticated desktop page was inspected. The supported isolated preview server ran, but the browser returned ERR_BLOCKED_BY_CLIENT for its documented address. Patched desktop and mobile visual verification therefore remains incomplete.
9. Run the separately authorized paper-only live-data canary, retaining TEST receipts. Do not enable entries, start the evaluation clock or freeze/promote a champion without the required verified readiness and owner strategy decision.

## Provider references checked

- [Alpaca market data](https://docs.alpaca.markets/us/docs/about-market-data-api): Algo Trader Plus $99/month; Basic IEX is not SIP.
- [Alpaca latest quotes](https://docs.alpaca.markets/us/reference/stocklatestquotes-1), [historical trades](https://docs.alpaca.markets/us/reference/stocktrades-1), [SIP stream](https://docs.alpaca.markets/us/docs/streaming-market-data), [calendar](https://docs.alpaca.markets/us/reference/legacycalendar).
- [Tiingo pricing](https://www.tiingo.com/about/pricing): $30/month individual and $50/month internal commercial; redistribution is separate. Account-specific rights/checkout remain unverified.
- [Tiingo EOD documentation](https://www.tiingo.com/documentation/end-of-day): raw vs adjusted data and corporate-action fields.

## Rollback

Keep new openings disabled first. If any paper exposure exists, preserve the repaired exit capability and reject capability rollback that would disable it. Stop ingestion / revoke ingestion inserts, then restore a reviewed previous function/config if safe. Never delete or rename the decision ledger, close receipts, observations, event IDs or history. Recheck ownership/RLS, exact counts and receipt linkage after rollback. Do not overwrite Mac cron storage or restore local-model permissions.

## Chrome follow-up

- Existing signed-in live desktop page inspected at approximately 1363px viewport width: no page-wide horizontal overflow.
- Existing expanded ticket dominates the initial screen and pushes research below the fold. The patch already moves research ahead of the collapsed planner.
- Live proposal text measured 11.5px; form labels 9px. Patched proposal text is now 14px with 1.65 line-height, labels 12px, and more separation between research fields.
- Isolated preview uses synthetic fixtures with backend calls disabled. Its Vite server started successfully through supported preview tooling, but browser access remained blocked. No phone-width screenshot or patched rendering was certified.
- UI module syntax test passed after these edits. No deployment, trade mutation or provider activation occurred. Hunter subsequently approved public branch publication; this checkpoint is being published for draft review.
