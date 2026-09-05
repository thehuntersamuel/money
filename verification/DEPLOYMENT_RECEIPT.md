# Morrow deployment receipt — September 5, 2026 UTC

Status: backend reliability and research infrastructure deployed; provider activation, Mac commissioning and complete handoff acceptance remain blocked. No real orders, capital transfers, provider purchases or new paper entries were performed.

## Reviewed source and tests

Backend source: local `1181ef5`, public review head `bda57b19478030bacd9f6a9b1007da4823fbe0ad`, identical tree `0bb241fcff2cdea07060f08a2d429894c59337e1`.
Independent reviewer approved this exact source for disabled deployment after CI and readback gates. [Final backend CI 33939988762](https://github.com/thehuntersamuel/money/actions/runs/33939988762) passed. Local suite: 56 Node entries and 21 Python tests, exit 0.
Native PostgreSQL CI reconstructs the captured affected production DDL/defaults/constraints/indexes/RLS/grants with synthetic rows and identity/external-table stubs. It exercises concurrent service-role close/retry/conflict and proposal races, owner/nonowner/anonymous permissions, append-only research/events, entry guards and capability rollback preserving records. This is a scoped rehearsal, not a full copy of production Auth/Storage.

## Recovery

A private recovery snapshot was saved before deployment: `Morrow-Predeployment-Recovery-20260905.json`, captured 2026-09-05T02:33:35.25087Z. It contains public schema metadata, scoped function definitions, live bridge v4 source/metadata, migration history and minimized affected paper records. It is not a complete Auth/Storage/database backup. Private contents are not published in this repository.

## Applied migrations

Supabase applies its own version at execution. Do not replay the historical proposal migration or these already-applied files.

| Source file prefix | Live migration version | Name |
|---|---|---|
| 20260830020000 | 20260905024759 | morrow_trade_close_lifecycle |
| 20260905013412 | 20260905024805 | morrow_durable_events_and_guards |
| 20260905020102 | 20260905024812 | morrow_research_runtime |
| 20260905023729 | 20260905024820 | morrow_source_pipelines |

All four apply calls succeeded. Catalog readback confirms all new base tables have RLS and both owner projections use `security_invoker=true`. New private RPCs deny anonymous/browser execution and permit only service role. Browser TRUNCATE on `app_owner` is revoked. Atomic close and new-entry guards are installed; the legacy paper-opening RPC remains mechanically blocked by the database guard.

## Edge deployments

| Function | Version | ID | verify_jwt | Deployment bundle SHA-256 |
|---|---:|---|---|---|
| morrow-bridge | 5 | 0e5e83b2-a5ed-4b5b-8900-c128b2991153 | false, existing custom bearer validation | db29a8c1b52d3a9c403c8e805584e7c1d82760208973b4ebda1d3b7f9ed556c8 |
| morrow-data | 1 | b185471b-6bdb-494a-aada-dc4974f488f3 | true plus exact service credential check | d55db2ebdfaf0189ce274400ff12acc7067af59d557505553ad9b618c859d362 |

Every returned source file was downloaded and compared byte-for-byte with the reviewed deployment input: all four bridge files and all six data files match. Runtime dependency bundling succeeded. No provider credential or enabling flag was set by this implementation.

Live POST smoke checks through server HTTP transport returned 401 for both endpoints without authorization (request IDs25755/25756). Database transaction-scoped checks verified that the existing owner can read proposals/research/current-event/latest-health projections, nonowners cannot see private rows, browsers cannot read raw provider snapshots/observations or invoke research writes, and anonymous users cannot access private research/receipts/close RPC. Transactions rolled back; no synthetic rows were written to production.

Positive authenticated bridge and disabled-ingestion response smoke tests remain pending. The scoped bridge credential exists on the inaccessible Mac; no approved server invocation credential is available to this session. Do not expose or extract credentials to remove this gate. Source-default disabled behavior and tests are verified; actual secret-state/readiness configuration is not independently attested by the deployment tool.

Readback after deployment: original affected paper records retained; no new research, close receipts, observations or data snapshots. Exact ledger close behavior was tested in isolated PostgreSQL, not by modifying an actual production trade.

## UI verification

The reviewed dashboard was rendered on existing GitHub Pages with synthetic TEST fixtures and `connect-src 'none'`. Chrome desktop and a390px iframe preview were inspected. The rendered mobile content width and scroll width both measured375px (remaining iframe width is its scrollbar); no horizontal overflow. Proposal search matches and empty-state behavior were exercised. Follow-up UI polish removes the offscreen drawer shadow, stacks phone card headings, and corrects the empty-position copy while entries are paused.

Live owner browser verification and the final UI source/Pages deployment revision are recorded in the subsequent release receipt.

## Security advisor comparison

No new security warning was introduced by this deployment. Two new informational notices flag RLS without policies on intentionally service-only raw data tables. Their browser grants are revoked; do not add public policies to make this notice disappear. [RLS notice explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
Pre-existing unrelated warnings remain: mutable function search paths, pg_net in public, public execution grants on existing auth helper functions, and leaked-password protection disabled. They were recorded before deployment and not silently described as resolved. [Search paths](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [extension placement](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public), [anonymous function grants](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated function grants](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Remaining commissioning gates

- Actual Mac installation, existing seven-job prompt amendments, deterministic monitor binding, New York/DST runtime verification, actual hosted model/fallback receipts and end-to-end server sync. The Mac is not connected to this execution environment. The prepared installer does not claim an installation it cannot observe.
- Persistent server runtime for SIP with secure server credentials and bounded restarts. An Edge deployment does not create a continuous stream host. No new hosting purchase was approved.
- Alpaca/Tiingo secure key intake, exact SIP/news/adjustment entitlements, archival/display/automated-use permissions and real freshness/reconnect/429 canaries. Hunter deferred keys. Keys alone do not approve licensing.
- FRED credential, BEA structured API registration, FINRA structured access/terms; dated licensed consensus and actual borrow data remain missing. Public-document fingerprinting is not a full structured feed.
- Authenticated deployed endpoint positive/disabled canaries, real observation-to-durable-event-to-Mac-review latency, first full research sync and separate readback.
- Canonically verified matched baseline/cost/capital inputs, marked-equity drawdown and full sector/regime analysis. Current ROI is explicitly unverified reported accounting with missing metrics unavailable.
- Champion/risk activation is an owner business decision after readiness. No evaluation clock or new opening is enabled by this release.

## Rollback

Disable ingestion first. Use reviewed capability rollback scripts; retain all receipts, research, observations and histories. Preserve safe exits whenever paper exposure exists. Restore reviewed prior function/config only after checking this exit constraint. Recheck record counts and authorization. Mac rollback is manifest/per-job based, never a wholesale cron-store replacement. Rollback was rehearsed in isolated PostgreSQL; no production rollback was needed.
