# Current deployment status

The backend is now deployed. Read [DEPLOYMENT_RECEIPT.md](DEPLOYMENT_RECEIPT.md) for reviewed source, migrations, function identities, live checks and remaining commissioning gates. Entries below are historical checkpoints; their statements that nothing was deployed are superseded by that receipt. Full handoff acceptance is not complete.

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

## Mac research setup follow-up

Hunter authorized preparing the Mac/Morrow integration and deferred adding Alpaca/Tiingo. Provider keys remain server-side; the Mac uses its existing narrow bridge credential. Main-branch source and deployed Supabase capabilities are distinct.

Added a macOS-gated installer with preflight, private before-file backups, drift checks and rollback; read-only seven-job configuration doctor; append-only local research/strategy/outcome/run sidecars with idempotency and concurrent-write tests; templates; and exact Maddox installation/job amendment instructions in `mac/MORROW_MAC_HANDOFF.md`. No jobs are created or edited by the installer. No credentials are read by the doctor. No provider, scheduler service, server worker or Supabase deployment is started by this setup.

The Mac bridge client now blocks new paper openings before loading credentials/network, uses the current user's home paths, rejects unsafe credential ownership/symlinks, refuses HTTP redirects, and omits server error bodies from logs. Local records are explicitly not Hub-synced and cannot certify actual model routes or activate a champion. Providers remain disabled, calendar unknown, evaluation not started.

Validation after this change: `npm test` exit 0, 30 Node test entries and 20 Python tests; `git diff --check` exit 0. Installer tests exercise temporary fixture directories, not an actual Mac installation. Mac access remains unavailable here, so installation, supported per-job prompt updates, actual run telemetry and readback remain Maddox's local acceptance work. Backend/provider/UI deployment gates above remain unchanged.

## Server research and ingestion follow-up

Native PostgreSQL fixture concurrency now passes in GitHub Actions: [run 33938168685](https://github.com/thehuntersamuel/money/actions/runs/33938168685), commit `add70ee519f062de1a7e5306508b7221dcc1f56d`, PostgreSQL 17.11. Separate sessions verified identical retries, conflicting closes, proposal-edit/close ordering and opening-guard/close races. This replaces the earlier statement that no native concurrency run exists; it does not certify the exact live schema/grants or independent review.

New source adds an append-only server research ledger/RLS and idempotent append RPC; bridge `research_state`, `record_research` and licensed `data_read`; Mac idempotent sync with immutable server receipts; Hub panels reading server research/health/evaluation records; descriptive exposure-matched dollar accounting; Tiingo EOD HTTP requests; SEC submissions/company-fact availability filtering; a disabled-by-default service-only ingestion Edge endpoint; and a bounded persistent SIP supervisor. The new research migration is `20260905020102_morrow_research_runtime.sql` and includes server-only provider snapshots and owner-readable health receipts. It remains undeployed.

Bounded SIP jobs preserve coverage gaps and never claim continuous capture. The continuous supervisor needs an approved persistent server host and server-secret provisioning; neither has been performed. No Mac connection tool exists in this workspace, so actual installation and scheduler readback are still inaccessible here. Provider keys/licenses, real canaries, exact live-schema rehearsal, independent review, deployment, patched browser verification and the remaining primary-source/news/retention and full evaluation pipelines remain open. See `mac/DEPLOYMENT_ORDER.md`; do not claim only keys remain.

Latest local validation for the server ingestion/supervisor follow-up: `npm test` exit 0, 41 Node entries and 21 Python tests. The suite caught a disconnect-report scheduling regression, which was repaired and retested. `verification/completion-test-results.txt` contains the passing output. The persistent worker exits disabled with no provider requests in its default configuration. No production migration, function deployment, main merge or actual Mac installation has occurred.

A further read-boundary check now enforces current server licensing/display approval on every paid `data_read`, so old snapshots cannot remain readable after approval is revoked. Latest local suite: 43 Node entries and 21 Python tests, all passing. The prior ingestion/supervisor head `08ef7f77c029cf6895f387ac0b3ee32a696abbc7` also passed full CI including native PostgreSQL in [run 33938573541](https://github.com/thehuntersamuel/money/actions/runs/33938573541). Independent review is still required before deployment.

## Independent review corrections

The independent review of local `49c65cc` (remote `e8557aafdd7b11d4de919e6052d48bf52c6d9377`) requested changes before deployment. Corrections block UPDATE-based Savings exposure, preserve book identity and history, revoke browser TRUNCATE/TRIGGER, query active proposals/current-version events with explicit overflow failure, separate continuous SIP reads from snapshots, and detect stale persisted events by market session. Review edits require the next thesis version and a newer research timestamp. Duplicate canonical receipts are rejected in evaluation; unreconciled accounting is explicitly labeled unverified reported accounting. Native concurrency fixture edits now obey the version contract.

These corrections require follow-up independent review and CI before any deployment. Current local suite: 48 Node entries and 21 Python tests passing. Live catalog read confirmed owner_all policies on trades/paper_books and owner_select on trade_proposals; no live changes were made.

Follow-up review confirmed the original five defects were addressed for disabled isolated rehearsal and identified a missing thesis-version projection. State, write receipts and Mac projection now preserve that version, with a read/revise/read test. Quiet-symbol handling now uses bounded REST reconciliation before declaring a silent socket dead; quiet symbols remain stale and cannot certify readiness. Local suite: 50 Node entries and 21 Python tests. Corrective remote `4680ddc2f88e54264c2c869df5bade83255e2e66` passed full native CI in run `33938996644`; the final version/quiet-symbol changes still require their own CI and review.
