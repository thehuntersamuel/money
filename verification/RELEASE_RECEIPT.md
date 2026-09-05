# Money Hub + Morrow release receipt

September 5, 2026 UTC. Backend and Hub implementation released; full Mac/provider commissioning is not complete.

## Released

- [PR1](https://github.com/thehuntersamuel/money/pull/1), merged as `2328892094820dfa60488f629d92716e40c8a606`: atomic close lifecycle, durable crossing events/history, entry guards, owner/server data boundaries, research sync/contracts, provider adapters, responsive research-first Trade UI, Mac installer/doctor and retained-ledger rollback.
- [PR2](https://github.com/thehuntersamuel/money/pull/2), merged as `67d653f01a8d6830c61c9cc93bb8ac517c3e4c0b`: historical proposal reconciliation and honest realized-result/close-evidence display.
- Four additive Supabase migrations and exact-source `morrow-bridge` v5 / `morrow-data` v1 deployed. Full IDs, migration mapping, source comparison and access evidence are in [DEPLOYMENT_RECEIPT.md](DEPLOYMENT_RECEIPT.md).
- No real orders, transfers, purchases, new paper positions or extra Mac reasoning jobs. Existing hosted GPT-5.6/high job configuration and hosted GPT-5.4 fallback are preserved in the installation contract. No actual Mac run is falsely attested.

## Verification

[Backend CI33939988762](https://github.com/thehuntersamuel/money/actions/runs/33939988762), [UI release CI33940278720](https://github.com/thehuntersamuel/money/actions/runs/33940278720) and [historical repair CI33940515790](https://github.com/thehuntersamuel/money/actions/runs/33940515790) passed. The final repair suite adds three PostgreSQL tests to the prior77 Node/Python entries. Native PostgreSQL separately verifies captured affected production schema/RLS/grants, service-role races, permission boundaries, retained-ledger rollback and historical reconciliation. Independent exact-source review approved both releases.

Live no-auth/invalid-auth requests are rejected. Database owner/nonowner/anonymous role readbacks passed. Downloaded function source matched every reviewed input file. Chrome inspected synthetic desktop/390px layouts, filtering and disclosure; mobile width equaled scroll width, with no horizontal overflow. Owner-authenticated live Trade rendering and data-health wait states were also checked. The final UI labels source assessments as recorded at review and distinguishes unavailable health queries from unactivated providers.

## Historical repair readback

One pre-existing closed paper trade had an opened proposal and no canonical close receipt. The operator DML in `supabase/repairs/reconcile_legacy_closes.sql` was reviewed/tested, then executed against the reconfirmed single candidate. Afterward:

- No closed-trade/open-proposal mismatch remains.
- The original trade snapshot hash is unchanged; no fill, price, date or quantity changed.
- Seven proposals remain; the affected proposal is terminal and its thesis version is unchanged.
- One immutable server-hashed audit and two before/after proposal snapshots are retained.
- No canonical execution receipt was fabricated. Historical results remain outside verified execution-outcome accounting.

The private predeployment recovery snapshot remains available. No production rollback was required.

## What remains and who handles it

| Gate | Implementer responsibility | Unavoidable owner input |
|---|---|---|
| Mac/Hermes connection | Install the reviewed files into existing directories, amend only existing six prompts, bind/verify monitor, read back seven jobs, observe actual model/timezone/run receipts and sync | Access to the actual Mac environment; it is not connected to this session |
| Secure ingestion commissioning | Verify live disabled/authenticated endpoint behavior without exposing secrets, then provision approved deterministic ingestion | Existing secure server/bridge credential channel where absent |
| Continuous SIP host | Provision an approved persistent server runtime, scoped server secrets, bounded restart budget, monitoring and calendar-aware canaries | Host choice or business approval if it requires a purchase/access grant |
| Alpaca/Tiingo | Configure exact SIP/history/news/adjustments, validate retention/display/automation rights and real entitlement/freshness/reconnect tests | Secure provider keys and any required subscription/licensing consent, deferred by Hunter |
| Other structured data | Complete approved FRED/BEA/FINRA access and verify dated/vintage-aware contracts | Missing free registration credentials or account/terms consent |
| Evaluation readiness | Verify matched baselines/costs/equity marks, outcome maturity, latency/coverage and paper-only end-to-end canary | Champion/risk/business approval when evidence is ready |

The Mac needs only its existing scoped bridge credential; provider and Supabase service-role secrets stay on the server. GitHub main is source/UI publishing, not an API-key store or an always-on Mac runtime.

Adding provider keys does not by itself finish these gates. Ingestion defaults disabled, new Savings entries are mechanically blocked, the champion is unactivated and the evaluation clock is not started. Missing consensus and borrow inputs keep dependent strategies blocked.

## Resume path

Maddox/the Mac-side implementer uses the reviewed main source with [MORROW_MAC_HANDOFF.md](../mac/MORROW_MAC_HANDOFF.md) and [DEPLOYMENT_ORDER.md](../mac/DEPLOYMENT_ORDER.md). Do not overwrite the old staged worktree, duplicate schedules, change shared fallback, expose secrets or treat a configuration flag as a runtime receipt. Technical work remains with the implementer; Hunter supplies only unavoidable access, secure credentials and business consent.
