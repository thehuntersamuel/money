# Maddox: install the Morrow research runtime

Owner: Hunter. Implementation owner on Mac: Maddox. Research user: Morrow.
Status: installable research preparation; NOT live provider integration or trading readiness.
Hunter explicitly deferred adding Alpaca and Tiingo until the infrastructure is ready.

## Correct data path

Provider subscriptions and keys belong to the server integration. Store provider credentials in approved Supabase server-side secrets, never on GitHub Pages, in this repo, in Morrow prompts or in the Mac research workspace. The Mac keeps only its existing scoped `morrow-bridge-key` through the established secure intake.

Alpaca / Tiingo → server ingestion → Supabase observations, events and bounded projections → authenticated `morrow-bridge` → Mac Morrow and owner-authenticated Money Hub.

GitHub `main` is source, not the running database or an API credential store. Merge and Supabase deployment are separate unless a verified deployment workflow links them. The current draft PR has not deployed the backend. This branch adds `research_state`, `record_research` and `data_read`; the existing live bridge still lacks these undeployed operations. Do not invent operation names or treat HTTP 200 on an old bridge as integration readiness.

A persistent SIP socket requires a supervised server worker; a short-lived Supabase Edge request is not an always-on stream host. The worker needs server-side access to credentials through its approved secret mechanism. Never distribute Supabase service-role access to research jobs. Where streaming runtime is not available, leave coverage unknown; do not call polling continuous coverage. Tiingo HTTP ingestion can use bounded server jobs after entitlement is approved.

## Install on the Mac — Maddox performs these steps

1. Read local project instructions and the operating contract. Fetch `fix/morrow-reliability` from the existing money repository into a separate worktree. Do not reset the stale Mac checkout, discard the staged lifecycle worktree, or merge without backend acceptance gates. Record the remote SHA and inspect the diff. Use the exact reviewed revision, not an unpinned download.
2. Inspect `~/.hermes/cron/jobs.json` read-only and `hermes cron list`. Preserve a private snapshot of the seven Morrow jobs, their current prompts, monitor references, and timezone/run metadata. Do not include unrelated jobs or credentials in a public artifact. Compare against `mac/scheduler-baseline.json`.
3. Run from the reviewed checkout:

```bash
python3 scripts/morrow_mac_setup.py plan
python3 scripts/morrow_mac_setup.py install
python3 ~/.hermes/scripts/morrow_mac_doctor.py
python3 ~/.hermes/scripts/morrow_runtime.py status
```

`plan` makes no changes. `install` requires macOS and existing Hermes/project directories. It backs up each changed file privately, rejects symlink targets and changed destinations, installs four scripts and four documents, and prints a rollback manifest. It does not create/edit jobs, read/write credentials, start a service, install dependencies, call a provider or deploy Supabase. Python 3.9+ standard library only. Custom existing directories can be supplied with `--hermes-home` and `--project`; bridge/runtime CLI paths must then be supplied explicitly where applicable. Default paths match the handoff.

4. Read the doctor output. `research_installation_ok` is only a local script/scheduler configuration check. It is never permission to open trades. Missing secret metadata, unknown timezone/calendar, unverified runtime route and backend deployment remain separate blockers. Unknown scheduler schema fails closed and needs local source inspection; do not relax the check to get green.
5. Run a read-only authenticated bridge check using the existing approved credential:

```bash
python3 ~/.hermes/scripts/morrow_finance_bridge.py state
python3 ~/.hermes/scripts/morrow_proposal_trigger.py
```

Save the generated bridge receipt privately. Check current verified time, Robinhood Savings identity, zero mutations and explicit readiness blockers. A successful read does not certify the pending close migration or SIP coverage. The local client blocks `place_trade` even if the old live server would accept it. No real-order operation exists.
6. Amend only the existing six job prompts using `JOB_AMENDMENTS.md`, after inspecting the installed `hermes cron edit --help` or supported `cronjob update` tool. Append the common instruction and corresponding job delta to existing prompts; preserve existing risk/source constraints. Do not replace prompts wholesale, change cadence/delivery, create jobs, alter global fallback or overwrite jobs storage. Keep the deterministic guard intact. Inspect actual installed monitor semantics before changing its binding; the package retains the existing stable JSON-output monitor contract.
7. Read back all seven jobs and rerun doctor. Verify America/New_York timing from actual runtime configuration/next-run timestamps, including DST; the doctor does not certify timezone. Observe naturally scheduled runs, inspect actual model metadata through supported Hermes tooling and preserve minimized evidence. A configured route is not an actual model receipt. Do not trigger jobs that send externally without current delivery authorization.
8. Return a private installation receipt: reviewed Git SHA, installer manifest, file hashes, doctor report, bridge state receipt ID/time, seven-job readback, actual run IDs/models, monitor no-change/durable-event evidence, and remaining blockers. Exclude provider secrets, bridge bearer, private prompts and account records from public Git.

## Research records now available

`morrow_runtime.py` stores local append-only SQLite sidecars under `capital/morrow/`. These are local research records, NOT Hub-synced entities or authoritative server evidence hashes. No automatic champion activation, evaluation clock, promotion, order execution or remote mutation exists. SQLite protects against accidental updates/deletes and serializes concurrent writes; it is not tamper-proof against the Mac account owner.

```bash
python3 ~/.hermes/scripts/morrow_runtime.py record source --key source-example-v1 --payload /private/path/source.json
python3 ~/.hermes/scripts/morrow_runtime.py record decision --key decision-example-v1 --payload /private/path/decision.json
python3 ~/.hermes/scripts/morrow_runtime.py record run --key run-example-v1 --payload /private/path/run.json
python3 ~/.hermes/scripts/morrow_runtime.py export
```

Export writes private JSONL to stdout; redirect only into the approved private project. Never commit exports to public money source. Template files in `mac/templates/` explain required fields. Use new keys for revisions: same key/same payload returns the existing record, different payload rejects. Source/strategy/decision references must exist locally. Keep pending fields as sidecars until the deployed bridge explicitly supports them. A submitted runtime model field is a claim awaiting comparison with trusted runtime evidence, not self-attestation.

Server evaluation records compute descriptive dollar accounting from submitted matched opportunities and canonical close references; this does not independently certify the submitted baseline data or establish investment edge. Missing returns/costs are null with reasons. Shadow/rejected outcomes stay separate from paper receipts. Champion remains absent until a separately reviewed activation implementation and owner decision exist.

## Rollback

Run `python3 scripts/morrow_mac_setup.py rollback --manifest <printed-manifest>` from the reviewed checkout. Rollback first verifies every installed hash and backup; any drift stops it for review. It restores only the installed scripts/docs, retains backups, and leaves all research ledgers, state, receipts and scheduler storage untouched. Do not roll back a monitor relied on for open exposure without preserving exit monitoring. For separately amended prompts use the private Morrow-only before snapshot through supported per-job edits. Never restore an entire jobs store or local-model permissions.

## Still owned by the implementer

Native PostgreSQL concurrency and independent review, private backups, additive migrations/RLS, server deployment and readback; approved persistent ingest runtime; data/source/experiment/ROI projections in the Hub; browser verification; provider entitlement canaries once Hunter provisions subscriptions; and actual Mac acceptance. Installing this package does not complete those gates.

Hermes references checked: [cron management](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron), [cron internals](https://hermes-agent.nousresearch.com/docs/developer-guide/cron-internals). Verify compatibility with the installed Mac version before any scheduler edit.

## Server sync added after initial Mac setup

After the additive research migration and updated bridge are deployed and read back, Maddox runs:

```bash
python3 ~/.hermes/scripts/morrow_runtime.py sync
python3 ~/.hermes/scripts/morrow_finance_bridge.py research-state
```

Sync checks the deployed operation first, translates local source/decision/strategy references to server IDs, retries using stable idempotency keys, and stores immutable server receipts locally. Interrupted sync preserves the original record. Call sync at the end of the existing reasoning runs; do not create a new scheduler. The server authenticates through the existing bridge key. No provider keys are requested from Morrow.

For permitted provider snapshots, use `data-read --payload <private-json-file>` with `{"dataset":"alpaca_sip","symbols":["SPY"]}`, `{"dataset":"tiingo_eod"}`, or `{"dataset":"sec_submissions"}`. A missing snapshot is unavailable; a returned snapshot must still pass timestamp, coverage and strategy-specific freshness checks. `alpaca_sip` includes at most 100 recent non-TEST observations; request bounded symbols rather than assuming every symbol appears in the page. Source metadata and evaluation inputs remain subject to independent verification.

Native PostgreSQL CI now runs in GitHub Actions, including separate-session close retries/races. The exact live-schema rehearsal, independent review, production deployment and actual Mac installation remain separate acceptance gates. See `mac/DEPLOYMENT_ORDER.md` in the reviewed checkout.
