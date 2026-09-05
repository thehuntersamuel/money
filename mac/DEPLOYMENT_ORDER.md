# Morrow deployment and commissioning order

This is an implementation runbook for Maddox/the implementer. Hunter supplies provider credentials securely and handles necessary consent/licensing decisions. Never paste credentials into this document, GitHub, model context or browser automation.

## Revision and gates

Use the reviewed PR head from `fix/morrow-reliability`. Confirm the latest GitHub `Morrow verification` run is successful, including native PostgreSQL concurrent tests. Native CI uses a minimized synthetic schema; it does not replace rehearsal against exact production DDL, triggers, grants and RLS. Preserve a private exact live backup and obtain independent review before production migration. Do not mark these gates passed from a prompt, intended model pin or configuration flag.

## Additive database deployment

Recheck the live migration history. Do not replay `20260830000000_morrow_trade_proposals.sql`: that historical feature already exists under live migration versions. Rehearse and apply, in order:

1. `20260830020000_morrow_trade_close_lifecycle.sql`
2. `20260905013412_morrow_durable_events_and_guards.sql`
3. `20260905020102_morrow_research_runtime.sql`

The new tables retain immutable close receipts, observations, trigger events, proposal history, research records, provider snapshots and health receipts. Only owner-authenticated users can read research/health. Browser roles cannot read raw provider snapshots or write research; the existing custom-auth bridge performs narrow research operations. New Savings openings remain mechanically blocked. Run security advisors and unauthorized/owner access readbacks after staging/deployment.

## Edge functions

Deploy the updated `morrow-bridge` with its existing custom bearer authentication (`verify_jwt=false` remains intentional). Include `index.ts`, `contract.mjs`, `research.mjs`, and `evaluation.mjs` from its directory. Import version is pinned to Supabase JS 2.57.4.

Deploy `morrow-data` with `verify_jwt=true` and its additional explicit service-role check. Include its `index.ts` and repository-relative `server/data-worker.mjs`, `server/market-data.mjs`, `server/calendar.mjs`, and `server/research-data.mjs`. Preserve relative paths when bundling. It is a service-only ingestion endpoint, never a browser/research credential endpoint. Morrow cannot trigger ingestion through its bridge key.

Before enabling ingestion, verify the installed project/runtime bundler resolves these files and that disabled requests produce `status: disabled`, unauthorized requests return 401, and no external provider requests occur. The source tests mock transport; this actual deployed smoke test remains necessary.

## Configuration owned by the implementer

All of these are SERVER configuration. Only provider key values are supplied by Hunter through secure intake.

| Name | Initial state / purpose |
|---|---|
| `MORROW_INGEST_ENABLED` | Absent/false until deployment and licensing checks pass |
| `ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY` | Supabase secrets; Hunter provisions later |
| `TIINGO_API_KEY` | Supabase secret; Hunter provisions later |
| `ALPACA_LICENSE_APPROVED`, `TIINGO_LICENSE_APPROVED` | False until exact automated use/retention terms are confirmed |
| `ALPACA_DISPLAY_APPROVED`, `TIINGO_DISPLAY_APPROVED` | False until permitted recipients/display scope are confirmed |
| `SEC_USER_AGENT` | Truthful operator identification and contact; no secret required |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Existing built-in server configuration; never send to the Mac research agent |

Adding keys alone is not entitlement proof. The implementer verifies SIP, dataset scope and real responses, then sets the relevant nonsecret approval configuration from actual evidence. Never infer permission from an HTTP 200 or swap SIP for IEX.

## Ingestion execution

`morrow-data` supports bounded `alpaca_sip`, `tiingo_eod`, and `sec_submissions` jobs. SIP replay covers the last five minutes with one page, preserving explicit page-budget gaps; it is not continuous capture. EOD jobs are capped at five symbols and one year. SEC ingestion preserves up to 100 accession/acceptance metadata entries; company-fact point-in-time filtering is a separate tested adapter, not a completed macro/consensus pipeline.

For continuous SIP, run `node server/sip-worker.mjs` only in an approved persistent SERVER runtime with Node 24+, server-secret provisioning and a bounded symbol universe (`MORROW_SYMBOLS`, maximum 30). It exits disabled before reading provider values unless enabled; it has a five-attempt reconnect budget and stops on persistence failure. An external host must not defeat that budget with unbounded immediate restarts. It writes no credentials to output. Persist health receipts; stale heartbeats/coverage must remain visibly unknown.

Do not install this privileged worker as a Morrow reasoning job or hand its service-role/provider secrets to the Mac research agent. Supabase Edge Functions have finite worker lifetimes; deploying `morrow-data` does not create an always-on stream host. A persistent host and the deterministic job invocation configuration still require actual provisioning and verification. No new hosting purchase is authorized by this runbook.

## Mac and Hub

Install the reviewed Mac files using `MORROW_MAC_HANDOFF.md`. Verify all seven existing jobs, actual route metadata and New York times. Amend existing prompts only, adding end-of-run server sync. Observe actual receipts and separate bridge readbacks.

Merge the UI to main only after review and browser verification; confirm the existing GitHub Pages URL serves the expected revision. The new panels read real server research/health records and computed evaluation records; missing tables/data remain unavailable. Raw paid data is not exposed directly to browser roles.

## After secure key intake

The implementer performs entitlement/freshness/coverage canaries, unknown/stale/error/reconnect cases, canonical source IDs, exact ledger reconciliation, and paper-only end-to-end verification. Preserve TEST identities and receipts. Do not start the 45-day evaluation or open new positions before champion/risk decisions and readiness pass. No real orders or capital transfers.

## Rollback

Disable ingestion first and revoke new research/provider insert capability with the corresponding rollback. Preserve all ledgers/history. Retain safe exit capability if paper exposure exists. Restore only the reviewed prior function/config and verify state/access. Mac rollback is per installer manifest and per-job supported edits, never an entire cron-store replacement.

## What is still not implemented or certified

The SEC client covers submissions/company-fact availability, not a complete automatic issuer/BLS/BEA/FRED/ALFRED/FINRA/news pipeline. Tiingo EOD requests are implemented; Tiingo news and license-specific retention enforcement are not. Evaluation accounting is implemented, but verified baseline ingestion, portfolio marked equity histories, full regime/sector analysis and calibration need their real input contracts and data. These are not solved by entering provider keys. Do not present the whole original handoff as complete from this checkpoint.

## Source pipeline extension

Apply `20260905023729_morrow_source_pipelines.sql` after the research migration. It extends source snapshots/health and adds a latest-per-dataset owner projection. The service-only ingestion endpoint accepts `sec_company_map`, `sec_facts`, `tiingo_news`, `bls_series`, `fred_vintage`, and `primary_document`, in addition to the existing three datasets. All source requests are bounded; publication time/point-in-time coverage stays unknown where unsupported. No extracted transcript or headline is promoted to primary verification automatically.

Paid ingestion/read now also requires `ALPACA_ARCHIVE_APPROVED` / `TIINGO_ARCHIVE_APPROVED`: explicit confirmation that the exact license permits this durable archive and retained derived evidence. Do not enable for a finite-retention-only license; stop that integration pending a compatible storage policy. Tiingo news additionally requires `TIINGO_NEWS_APPROVED`. FRED vintages use `FRED_API_KEY` (free registration, absent here); same-day vintages are rejected because their daily precision does not prove intraday availability. BLS v1 needs no registration but provides current revisions, which cannot certify historical decision inputs. `MORROW_ISSUER_HOSTS` is a server-approved exact host list, never a caller-provided fetch allowlist. Official SEC/BLS/BEA/Federal Reserve/Treasury/FINRA documents can be fingerprinted; no publication date or excerpt is fabricated.

BEA structured API registration and FINRA API access/terms remain unprovisioned. Public official-document fingerprinting covers provenance only, not a full structured economic/short-interest feed. FINRA reports are delayed/revised and cannot establish current borrow. These access gates and consensus/borrow remain explicit blockers for dependent playbooks.
