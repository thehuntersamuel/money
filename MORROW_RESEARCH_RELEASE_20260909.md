# Research display and service-credential reconciliation

Prepared change; not deployed. Existing Render recovery remains separately pinned to `96587a6ed9e3e8800c34c7a9deb8878c4c65f532`, run `recovery-20260908-96587a6`, five attempts, existing disk/compute. Automatic approval review rejected starting that production deployment because approval quoted in an attachment was not accepted as a direct user reply. Do not retry until Hunter directly approves.

## Concrete issue and repair

At 2026-09-09 01:22:12.895Z, Render's existing service-role JWT reached `morrow-data` but received HTTP 401 `{error:unauthorized}` (request `01a083c2-2090-7e76-a58b-f4de23b2b258`). Including both `apikey` and `Authorization` made no difference. The same credential reads the project's REST tables successfully. This response matches the function's literal built-in-secret comparison, not Tiingo entitlement rejection. Why the built-in and supplied credentials differ is not established.

`service-auth.mjs` keeps the current service-secret path and additionally recognizes only the SHA-256 fingerprint of that exact existing Render service-role JWT. It rejects non-service roles and wrong projects even if pinned. Claims alone never authorize. Keep gateway `verify_jwt=true`; no provider keys, credential rotation, new roles, migrations or public access. Deploy `morrow-data` with this module and the same seven existing bundle files after approval. A copied or altered token cannot match the fingerprint. If the credential rotates, this pin must be explicitly reviewed and replaced or removed. This is a scoped identity reconciliation, not a generic JWT-role allowlist.

The Trade tab currently loads research ledger rows but displays only order-shaped proposals. A valid research watch cannot meet the proposal contract without inventing order prices and a trigger. The UI change shows research notes from the existing owner-only ledger, with thesis, bear case, catalyst, review date, assumptions, missing data, source links/timestamps and record ID. It adds no writes or trading controls. Missing linked sources and truncated history are explicit. Existing proposals and positions remain separate.

## Actual saved research

Research decision `76b4afa8-4d5c-44e8-9eb9-e621f59162dd`, ADBE, watch, saved at `2026-09-09T01:27:22.734230Z`. Hash `eb421c8184ac6bb83047d1c717ee612141de8e337cea2cf6b56870c5de3b0ee3` independently recomputed. Three linked source records and reference-watchlist membership verified (75 symbols afterward). Created through the existing service-role append RPC after existing contract validation. No trade proposal, position, trigger, model run or sync receipt fabricated. Attribution explicitly says manual assistant-supported research.

Alpaca's active US-equity directory returned 14,286 assets; a bounded five-company screen outside the existing watchlist checked ADBE, FDX, INTU, ADSK and ACN. One full company review followed. SIP daily history succeeded at `01:22:36.046Z` with no pagination remainder. This establishes useful paid end-of-day access, not continuous persistence or exhaustive market ranking. Tiingo remains unavailable until authentication is repaired and its own canaries pass.

## Validation and rollout

Local targeted tests cover current-secret compatibility, missing configuration, altered credentials, unpinned service tokens, anonymous/user/wrong-project rejection, research display without price fields, missing sources, cross-book source isolation and HTML/URL injection. Inline UI scripts parse. Owner-authenticated browser rendering remains a post-deployment check; local tests do not certify it.

After explicit approval: merge this reviewed patch for GitHub Pages, deploy its `morrow-data` bundle with JWT verification enabled, and deploy the separately approved exact Render recovery revision. Do not change Render's five-attempt budget or delete `commissioning-1.json`.

Canaries: unauthorized caller still 401; current authorized caller passes authentication; one bounded Tiingo EOD call for ADBE and QQQ, one market-wide news page, one ADBE news page. Inspect provider quality/partial flags and independently read persisted receipts. Use the existing Mac private bridge credential for consumer reads. If provider licensing/retention gates block a request, retain the block and report the exact gate; do not set approval flags automatically. Append a new research decision version after successful Tiingo evidence; do not rewrite the saved manual decision.

Verify the saved note in owner-authenticated Trade on desktop and mobile. Observe advancing multi-symbol persisted event and receipt times during the next regular session, September 9, 2026, 09:30–10:00 ET (13:30–14:00Z). Execution owners: ChatGPT for accessible infrastructure, Maddox for the Mac and its naturally scheduled run. A scheduled-run receipt must contain actual provider/model/reasoning evidence; unknown remains unknown. No duplicated schedules or alerts without an approved delivery path.

## Rollback

Restore `morrow-data` v14's seven-file bundle (without `service-auth.mjs`) and keep `verify_jwt=true`. Restore the prior `index.html` from `96587a6`. This removes the added credential binding and research display while retaining all immutable sources, decisions, receipts and watchlist entries. For failed worker recovery, park safely with the same run counter; never reset attempts to hide failure. No new paper openings or champion activation are part of this release.

Reference: https://supabase.com/docs/guides/functions/auth
