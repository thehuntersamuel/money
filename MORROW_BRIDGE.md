> **2026-09-05 implementation branch:** not deployed. New Morrow openings are deliberately blocked in the patched Edge handler and database trigger. Provider modules are offline-tested scaffolding, not connected feeds. See `verification/IMPLEMENTATION_STATUS.md` for authoritative release gates. Historical operation examples below do not grant activation authority.

# Morrow Finance Bridge

`morrow-bridge` is the narrow paper-only automation boundary for Morrow.

## Scope

- Read the minimized `Robinhood Savings` paper book projection.
- Record every fully reviewed Morrow proposal, including rejected and conditional ideas.
- Add a qualified symbol and note to the Market Board.
- Place at most one new paper trade per day after server-side policy validation.
- Close an existing paper trade with an exit price and outcome note, atomically transitioning any linked Morrow proposal to `closed`.
- Never create or modify real trades, brokerage orders, transfers, payments, account settings, auth, or schema.

The deployed Supabase Edge Function uses the project service role internally because the underlying owner policies require an authenticated owner. Callers must present a dedicated high-entropy bearer credential. Only its SHA-256 digest exists in source. The local credential is stored outside Git in an owner-only `0600` file under the Hermes secret directory.

## Server-side gates

A paper trade is rejected unless:

- it links to a proposal in the `qualified` state;
- the proposal's source review is fresh and no more than six hours old;
- fewer than three paper positions are open;
- no paper trade has already been opened that day;
- planned loss is no more than 0.5% of book equity;
- total open planned risk after insertion is no more than 1% of book equity;
- cost fits current buying power;
- reward-to-risk is at least 1.5:1;
- the complete thesis, catalyst, invalidation, evidence, confidence, review date, target, and stop are present.

Every mutation is read back before a verified receipt is returned.

Hunter's authenticated Trade-tab form remains a separate owner-authorized manual paper-entry path. The Morrow bridge's `proposal_id` and freshness requirements govern automated Morrow execution, not Hunter's deliberate manual simulations. Both paths remain paper-only.

## Local client

```text
python3 scripts/morrow_finance_bridge.py state
python3 scripts/morrow_finance_bridge.py add-scout --payload scout.json
python3 scripts/morrow_finance_bridge.py record-proposal --payload proposal.json
python3 scripts/morrow_finance_bridge.py place-trade --payload trade.json
python3 scripts/morrow_finance_bridge.py close-trade --payload close.json
```

Payload files are local, short-lived task inputs and must not contain credentials.

`morrow_proposal_trigger.py` is a deterministic monitor. A fresh quote crossing a
recorded threshold can wake a new research cycle, but the monitor cannot qualify a
proposal or open a paper trade. The reasoning cycle must refresh current news,
primary sources, catalyst quality, the strongest bear case, source freshness, and
risk before changing proposal state.

## Rollback

1. Disable or delete only the `morrow-bridge` Edge Function in project `fglbxoafbebsryjeqcbu`.
2. Restore the prior Morrow cron prompts from the cron change log.
3. Restore the prior deterministic midday monitor from its dated backup.
4. Remove the local `morrow-bridge-key` secret file.
5. Apply the rollback SQL only when retiring the proposal feature. It removes the callable functions but renames `trade_proposals` to `trade_proposals_rollback_20260830`, revokes runtime access, and preserves the complete decision history.
6. Preserve receipts and paper-trade records. Do not delete or rewrite decision history.
