import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../supabase/functions/morrow-bridge/index.ts', import.meta.url), 'utf8');

assert.match(source, /validateProposal/, 'the deployed handler must use the proposal validator');
assert.match(source, /from\('trade_proposals'\)/, 'the bridge must read and persist proposal rows');
assert.match(source, /setup,horizon,benchmark,entry_price,target_price,stop_price,entry_condition,thesis,bear_case,catalyst,invalidation,evidence,source_freshness,last_researched_at/, 're-review state must preserve the full bounded decision context');
assert.match(source, /id,status,book_id,symbol,direction,qty,entry_price,target_price,stop_price,review_on,catalyst,invalidation/, 'open-position monitoring needs its decision and risk levels');
assert.match(source, /operation === 'record_proposal'/, 'the bridge needs an idempotent proposal write operation');
const proposalWriteSource = source.slice(
  source.indexOf("if (operation === 'record_proposal')"),
  source.indexOf("if (operation === 'place_trade')"),
);
assert.doesNotMatch(proposalWriteSource, /\.upsert\(/, 'proposal history must not use unrestricted upsert');
assert.match(proposalWriteSource, /\.maybeSingle\(\)/, 'proposal writes must inspect the current state');
assert.match(proposalWriteSource, /proposalWriteAction\(existing, proposal\)/, 'the explicit transition contract must authorize the write');
assert.match(proposalWriteSource, /\.insert\(proposal\)/, 'an absent proposal may be inserted explicitly');
assert.match(proposalWriteSource, /\.update\(proposal\)[\s\S]*\.eq\('state', existing\.state\)/, 'updates must retain a state compare guard');
assert.match(proposalWriteSource, /\.eq\('id', proposalId\)\.single\(\)/, 'read-back must use the exact proposal id');
assert.match(source, /computeSourceEvidenceHash\(proposal\.evidence\)/, 'the server must compute the normalized evidence hash');
assert.match(source, /suppliedEvidenceHash[\s\S]*computedEvidenceHash/, 'a supplied evidence hash must be compared with the computed hash');
assert.match(source, /source_evidence_hash:\s*verified\.source_evidence_hash/, 'the receipt must return the computed read-back hash');
assert.match(source, /proposal read-back failed/, 'proposal writes require separate read-back');
assert.match(source, /proposal_id/, 'Morrow paper trades must link to a qualified proposal');
assert.match(source, /source_freshness/, 'paper execution must check source freshness');
assert.match(source, /news_checked_at/, 'paper execution must check when news was reviewed');
const placeTradeSource = source.slice(
  source.indexOf("if (operation === 'place_trade')"),
  source.indexOf("if (operation === 'close_trade')"),
);
assert.match(placeTradeSource, /db\.rpc\('place_morrow_paper_trade'/, 'paper execution must use the atomic trade RPC');
assert.doesNotMatch(placeTradeSource, /from\('trades'\)\.insert/, 'the Edge handler must not insert outside the RPC');
assert.doesNotMatch(placeTradeSource, /from\('trade_proposals'\)\.update/, 'the Edge handler must not transition outside the RPC');
assert.doesNotMatch(placeTradeSource, /from\('trades'\)\.delete/, 'the Edge handler must not use a compensating delete');
assert.doesNotMatch(placeTradeSource, /openResult|todayResult/, 'racy preflight reads must be removed');
assert.match(placeTradeSource, /proposal_state !== 'opened'/, 'the RPC result must verify the proposal transition');

const closeTradeSource = source.slice(
  source.indexOf("if (operation === 'close_trade')"),
  source.indexOf("return reply(400, { error: 'unsupported operation' })"),
);
assert.match(closeTradeSource, /db\.rpc\('close_morrow_paper_trade'/, 'paper close must use the atomic close RPC');
assert.doesNotMatch(closeTradeSource, /from\('trades'\)\.update/, 'the Edge handler must not close outside the RPC');
assert.doesNotMatch(closeTradeSource, /from\('trade_proposals'\)\.update/, 'the Edge handler must not transition a linked proposal outside the RPC');
assert.match(closeTradeSource, /rpcError\.message[\s\S]*open paper trade not found[\s\S]*reply\(404/, 'expected missing paper trades must retain the 404 API contract');
assert.match(closeTradeSource, /proposal_state !== null && closed\.proposal_state !== 'closed'/, 'close read-back must accept manual trades but require linked proposals to be closed');
assert.match(closeTradeSource, /Number\(closed\.exit_price\) !== close\.exit_price/, 'close read-back must verify the persisted exit price');
assert.match(closeTradeSource, /closed\.close_note !== close\.close_note/, 'close read-back must verify the persisted close note');
assert.doesNotMatch(closeTradeSource, /closed\.closed_on !== newYorkDate\(\)/, 'an idempotent retry on a later date must retain the original close date');
assert.match(closeTradeSource, /Number\.isFinite\(Date\.parse\(String\(closed\.updated_at/, 'close read-back must verify the update timestamp');
assert.match(closeTradeSource, /closed\.proposal_id !== null[\s\S]*closed\.proposal_decision !== 'closed'/, 'linked proposal read-back must verify its terminal decision');
assert.match(closeTradeSource, /proposal_id:\s*closed\.proposal_id/, 'close receipts must identify a linked proposal when one exists');
assert.match(closeTradeSource, /exit_price:\s*Number\(closed\.exit_price\)/, 'close receipts must include the verified exit price');
assert.match(closeTradeSource, /close_note:\s*closed\.close_note/, 'close receipts must include the verified close note');
assert.match(closeTradeSource, /closed_on:\s*closed\.closed_on/, 'close receipts must include the verified close date');

console.log('morrow bridge proposal endpoint contract passed');
