# SIP capacity recovery — September 10, 2026

## Scope and authority

Hunter requested the full market-open stall fix. No trades, transfers, purchases,
strategy activation, model-route edits, or risk/auth bypasses are part of it.
Keep the existing Render 0.5c/512MB plan and persistent disk. Keep five attempts.

## Source-backed findings

The September 9 worker (96587a6) reported `stream_backpressure_gap` at
13:30:00.827Z with 19,986 pending records, then stopped for operator review at
13:39:26.692Z. Render also sent a memory-limit restart notice; that email did not
supply a timestamp linking a particular kill to an individual health receipt.
The old worker already had bounded queues and 250-record batched POSTs. Claims
that it performed one POST per tick or had no queue bound are incorrect.

Code inspection found two ICU formatter constructions per trade, 200,000-record
accumulated replay results, REST catch-up blocking live persistence, and
heartbeats waiting for the live queue to drain. The entire reference watchlist
also consumed raw-trade write capacity even without an active trigger proposal.

Read-only Alpaca SIP replay of 2026-09-09 13:30–13:31Z returned complete counts:
SPY 7,760; QQQ 6,461; ADBE 979; total 15,200 (about 253/second average, not a peak
rate). A 1,000-row TEST insertion EXPLAIN ANALYZE took 1,212.929 ms in production;
the transaction was rolled back and independently checked to leave zero rows.
This is one SQL sample, not a guarantee of future REST throughput.

## Implementation

- Reuse the NY ICU formatter, bound minute/day caches, deduplicate concurrent
  calendar fetches. Official session, holiday and early-close rules are retained.
- Stream recovery one provider page at a time; persist in batches <=1,000.
  Historical replay stays `gap=true`. Earlier missing history is not certified.
- Catch-up runs independently from the live queue. Live events remain gap-marked
  while coverage is uncertain. Source IDs retain idempotency; no tick coalescing.
- Bound ingress to 20,000 records/4 MB and inspect size before parsing. Stop with
  an explicit gap at 384 MiB process RSS, leaving headroom under the 512 MiB plan.
  Drain accepted records on normal shutdown; a hard kill still cannot guarantee
  in-memory survival. Reconciliation and regular-session verification remain gates.
- Heartbeats no longer await an endlessly busy live drain. Health metrics include
  queue bytes, process RSS, write duration, stored count, event lag, raw/research
  symbol counts, and stale research symbols. Raw health does not certify bars.
- Raw tier: SPY, QQQ, ADBE, configured seeds, all active proposals and open paper
  positions. 30-symbol guard fails the whole refresh rather than omitting a
  required ticker. This is an admission bound, not proof any 30 symbols fit.
- Broad tier: other supported reference-watchlist symbols receive SIP minute
  bars and updated bars on the same socket. Unsupported crypto remains excluded.
  Broad Tiingo directory/news discovery is unchanged and is not confined to these
  stream lists. A saved research decision adds reference coverage; an active
  proposal promotes the symbol to raw coverage on the next ~30-second refresh.
- Store summaries in private, immutable `morrow_research_minute_bars`, never in
  the raw crossing table. Updated bars produce immutable new revisions; absence
  of a bar or missed interval is unknown, not a flat price or zero activity.
- Partial index accelerates watch/wait-for-trigger lookups without changing the
  crossing function or its history. No migration deletes/reclassifies evidence.
- Preserve three clocks: provider `event_at`, worker `received_at`, database
  `persisted_at`. Legacy database insertion times stay NULL, not invented.

## Morrow / Mac consumption

The authenticated bridge keeps `data_read` / `dataset: alpaca_sip` and accepts
up to 30 symbols per request. Response `observations` holds raw evidence;
`bars` holds research-only summaries and revisions, with a separate 100-row cap.
Use ticker-specific reads for coverage, compare event/receipt/persistence times,
and select the latest received revision for a minute. Never use a bar's high/low
as proof of crossing order, a quote, or an executable fill. Bar history coverage
is explicitly unknown. Current auth/licensing/display/archive gates all remain.

Hub research records and reference watchlist continue working. Nothing here
fabricates a Morrow run, enables a strategy, or represents shadow research as a
paper trade. Mac natural run provider/model/reasoning/runtime receipts still need
independent execution evidence. GPT-5.6/high route intent is unchanged.

## Tests and acceptance

The final suite passed (97 JavaScript tests plus 22 Python tests), and GitHub CI
passed for PR #9. Key evidence:

- 200,000 cached calendar calls: ~0.4–0.5 seconds, <30 MB incremental RSS.
- 200,000 paginated replay records consumed without accumulating return records.
- 45,000 live synthetic records, 150 ms writes: all saved, zero duplicates,
  max pending 900, max RSS 86,343,680 bytes.
- 9,000 synthetic records, 1,500 ms writes and ~600/second input: all saved,
  zero duplicates, max pending 1,800, max RSS 52,256,768 bytes.
- Overflow drains accepted records; high RSS fails closed; slow catch-up does not
  block live writes; raw crossing/receding evidence remains; bars cannot trigger.
- Private RLS/grants, immutable bars, additive view migration, legacy NULL clocks,
  auth rejection and new-opening guards tested in isolated Postgres/handler tests.

These are not regular-session release acceptance. At the next regular session,
require sustained SPY/QQQ/ADBE fresh event AND receipt/persistence times, advancing
multi-symbol records, no gaps/queue growth/memory restart, bounded lag, research
bar coverage (quiet symbols distinguished), and unchanged durable attempts.
Verify at the open and through at least 09:45 ET. If the measured admitted raw
workload exceeds capacity, keep gates closed; do not raise queue limits or buy
compute automatically. Review the measured bottleneck and new capacity evidence.

## Ordered deployment and reversible rollback

1. Apply additive `20260910040422_morrow_sip_capacity.sql` (already applied;
   filename reconciles the actual migration ledger, not a second migration).
2. Deploy bridge with exact existing service-key custom authentication and
   existing `verify_jwt=false`; do not alter the separate morrow-data JWT setting.
3. Deploy the tested worker revision with auto-deploy still off. Preserve
   `/var/data/morrow/recovery-20260908-96587a6.json` at its observed five attempts.
4. One operator-authorized new recovery run is `recovery-20260910-capacity-v1`;
   its own durable allowance is five, never automatically renewed/reset. No
   further run IDs should be created to mask failure.
5. Verify deployment SHA, socket acknowledgement, three raw symbols, broad bar
   subscriptions, health receipts, stable memory and old/new counter files.
   Off-hours acknowledgement alone is not live market-data acceptance.

If regression occurs, park with `MORROW_INGEST_ENABLED=false`, retain all counters,
and roll back application code to the known prior revision only after review.
Do not automatically re-enable the known OOM-prone old worker. Restore the prior
bridge bundle if needed. Leave additive tables/columns/index and all receipts;
no destructive schema rollback or evidence deletion is necessary.

## Deployment checkpoint — 2026-09-10 04:14Z

PR #9 merged as `4df80d9cda912a3e2b64bfcd6e87af57dac2b6cd`; Render is running
that exact revision. The first deployment still received the old exhausted run
ID and correctly parked without another provider attempt. After verifying the
non-secret setting in Render, the corrected deployment connected at
04:12:05.786Z (00:12:05 ET). No counter file was removed or reset.

- `recovery-20260908-96587a6`: still 5 attempts.
- `recovery-20260910-capacity-v1`: 1 attempt, limit still 5.
- 3 raw symbols (ADBE, QQQ, SPY) and 69 research-bar symbols acknowledged on one
  socket. Crypto exclusions unchanged. Current active proposals/open positions: 0.
- Heartbeats through 04:14:07.232Z: queue 0 bytes, process RSS 116,027,392 bytes,
  no failure reason. Status remains blocked/unknown-or-stale, correctly, because
  this is outside the US equity session and no fresh market data has arrived.
- The actual Render-to-PostgREST write paths were tested with exactly two retained
  immutable **TEST-only** receipts: `TEST:capacity-release-20260910:trade` and
  `TEST:capacity-release-20260910:bar`. Both have `is_test=true`; the raw receipt
  also has `gap=true`. Database insertion times were 04:13:57.140265Z and
  04:13:57.187574Z. They are excluded from every production acceptance query and
  cannot create a trigger or qualify a trade. These are not live market events.
- Bridge v21 source readback matches the deployed bundle exactly, hash
  `71062f0f8a2c96c93c7d4d8122b5289da2435db308707e1307f9aac13c3f96fa`.
  Custom authentication is unchanged. A no-key request was rejected. The Render
  database credential was also rejected by the bridge's separate pinned-key
  check; it is not proof of a Mac bridge session. An authenticated Mac request
  using its configured bridge credential remains to be verified. No auth gate
  was broadened to make the diagnostic pass.
- Latest naturally recorded Morrow run remains September 8, 14:06:58.220768Z,
  with actual provider/model/reasoning/runtime evidence NULL. This repair did not
  fabricate, schedule, or execute a replacement reasoning job.

**Remaining release gates:** sustained regular-session feed persistence at and
after the September 10 open; actual scheduled Mac execution/synchronization with
runtime attribution. None of the off-hours checks above clears those gates.

References: [Alpaca stream protocol](https://docs.alpaca.markets/us/docs/streaming-market-data),
[SIP bars and revisions](https://docs.alpaca.markets/us/docs/real-time-stock-pricing-data),
[Supabase bulk inserts](https://supabase.com/docs/reference/javascript/insert).
