import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  buildStateProjection,
  computeSourceEvidenceHash,
  proposalWriteAction,
  serializeNormalizedEvidence,
  validateScout,
  validateTrade,
  validateClose,
  validateProposal,
  validateProposalExecution,
} from '../supabase/functions/morrow-bridge/contract.mjs';

const book = {
  book_id: 'book-1',
  label: 'Robinhood Savings',
  equity: 10000,
  buying_power: 8000,
  cash: 8000,
  securities: 2000,
  realized_pnl: 100,
  unrealized_pnl: -25,
  n_open: 1,
  n_closed: 2,
};

{
  const state = buildStateProjection(
    book,
    [{
      id: 't1', status: 'open', symbol: 'SPY', direction: 'long', qty: 10,
      entry_price: 100, target_price: 110, stop_price: 96, review_on: '2026-08-29',
      catalyst: 'Current inflation release.', invalidation: 'Close below $96.',
    }],
    [{ symbol: 'SPY' }, { symbol: 'QQQ' }],
    [{
      id: 'p1', proposal_key: 'run:SPY:v1', symbol: 'SPY', state: 'watch', thesis_version: 3,
      decision: 'wait_for_trigger', trigger_direction: 'above', trigger_price: 101,
      trigger_status: 'watching', review_on: '2026-08-29', news_checked_at: '2026-08-28T16:30:00Z',
      setup: 'swing', horizon: 'short', benchmark: 'SPY', entry_price: 101,
      target_price: 110, stop_price: 97, entry_condition: 'Reclaim $101 after fresh review.',
      thesis: 'Breadth improves.', bear_case: 'Inflation reaccelerates.',
      catalyst: 'Current inflation release.', invalidation: 'Close below $97.',
      evidence: [{ url: 'https://example.com/release', source_type: 'primary' }],
      source_freshness: 'fresh', last_researched_at: '2026-08-28T16:30:00Z',
    }],
    [{ symbol: 'SPY', price: 100.5, fetched_at: '2026-08-28T16:39:00Z', error: null }],
    '2026-08-28T16:40:00Z',
  );
  assert.equal(state.schema, 2);
  assert.equal(state.proposals[0].thesis_version,3);
  assert.equal(state.authentication_verified, true);
  assert.equal(state.book.label, 'Robinhood Savings');
  assert.equal(state.open_paper_positions, 1);
  assert.equal(state.closed_paper_positions, 2);
  assert.deepEqual(state.open_positions, [{
    id: 't1', symbol: 'SPY', direction: 'long', qty: 10, entry_price: 100,
    target_price: 110, stop_price: 96, review_on: '2026-08-29',
    catalyst: 'Current inflation release.', invalidation: 'Close below $96.',
  }]);
  assert.equal(state.market_board_items, 2);
  assert.deepEqual(state.market_board, [{ symbol: 'SPY', note: null }, { symbol: 'QQQ', note: null }]);
  assert.equal(state.proposal_count, 1);
  assert.deepEqual(state.proposals[0], {
    id: 'p1', proposal_key: 'run:SPY:v1', symbol: 'SPY', state: 'watch', thesis_version: 3,
    decision: 'wait_for_trigger', trigger_direction: 'above', trigger_price: 101,
    trigger_status: 'watching', review_on: '2026-08-29', news_checked_at: '2026-08-28T16:30:00Z',
    setup: 'swing', horizon: 'short', benchmark: 'SPY', entry_price: 101,
    target_price: 110, stop_price: 97, entry_condition: 'Reclaim $101 after fresh review.',
    thesis: 'Breadth improves.', bear_case: 'Inflation reaccelerates.',
    catalyst: 'Current inflation release.', invalidation: 'Close below $97.',
    evidence: [{ url: 'https://example.com/release', source_type: 'primary' }],
    source_freshness: 'fresh', last_researched_at: '2026-08-28T16:30:00Z',
    trigger_event_id: null, trigger_event_at: null, coverage_gap: true,
    quote_price: 100.5, quote_fetched_at: '2026-08-28T16:39:00Z', quote_error: null,
  });
  assert.equal(state.verified_at, '2026-08-28T16:40:00Z');
  assert.equal('account_id' in state.book, false);
}

assert.deepEqual(validateScout({ symbol: 'spy', note: 'Qualified pullback scout' }), {
  symbol: 'SPY', note: 'Qualified pullback scout',
});
assert.throws(() => validateScout({ symbol: 'bad symbol', note: 'x' }), /symbol/i);

const validProposal = {
  proposal_key: '2026-08-31-morning:NVDA:v1',
  symbol: 'NVDA', asset_name: 'NVIDIA', asset_type: 'equity',
  state: 'watch', direction: 'long', setup: 'catalyst', horizon: 'short', benchmark: 'QQQ',
  observed_at: '2026-08-31T14:05:00Z', observed_price: 218.33,
  entry_price: 220, target_price: 230.47, stop_price: 215,
  entry_condition: 'Sustained reclaim of $220 after a fresh news review.',
  trigger_direction: 'above', trigger_price: 220,
  review_on: '2026-09-01', confidence: 52,
  thesis: 'Earnings growth remains strong if price confirms demand.',
  bull_case: 'Guidance and demand remain stronger than consensus.',
  bear_case: 'The post-earnings selloff may be informed distribution.',
  catalyst: 'Post-earnings price discovery and updated issuer guidance.',
  invalidation: 'Fresh issuer evidence weakens or price closes below $215.',
  evidence: [
    { url: 'https://example.com/issuer', title: 'Issuer release', retrieved_at: '2026-08-31T14:00:00Z', source_type: 'primary' },
    { url: 'https://example.com/filing', title: 'SEC filing', retrieved_at: '2026-08-31T14:01:00Z', source_type: 'primary' },
  ],
  source_freshness: 'fresh', news_checked_at: '2026-08-31T14:02:00Z',
  decision: 'wait_for_trigger', rejection_reason: null,
  source_evidence_hash: 'a'.repeat(64), thesis_version: 1,
};
{
  const row = validateProposal(validProposal);
  assert.equal(row.symbol, 'NVDA');
  assert.equal(row.state, 'watch');
  assert.equal(row.trigger_status, 'watching');
  assert.equal(row.confidence, 52);
  assert.equal(row.evidence.length, 2);
  assert.equal(row.source_evidence_hash, undefined, 'the validator must not trust a caller-supplied evidence hash');
  const canonicalEvidence = '[{"url":"https://example.com/issuer","title":"Issuer release","retrieved_at":"2026-08-31T14:00:00.000Z","source_type":"primary"},{"url":"https://example.com/filing","title":"SEC filing","retrieved_at":"2026-08-31T14:01:00.000Z","source_type":"primary"}]';
  assert.equal(serializeNormalizedEvidence(row.evidence), canonicalEvidence);
  assert.equal(
    await computeSourceEvidenceHash(row.evidence),
    createHash('sha256').update(canonicalEvidence, 'utf8').digest('hex'),
  );
}
assert.throws(
  () => validateProposal({ ...validProposal, evidence: [{
    url: 'https://example.com/issuer', title: 'Issuer release',
    retrieved_at: '2026-08-31T14:00:00Z', source_type: 'primary',
  }] }),
  /two primary sources/i,
);
assert.throws(
  () => validateProposal({ ...validProposal, news_checked_at: null }),
  /news checked/i,
);
assert.throws(
  () => validateProposal({ ...validProposal, news_checked_at: 'recently' }),
  /news checked time/i,
);
assert.throws(
  () => validateProposal({ ...validProposal, evidence: validProposal.evidence.map((source, index) => index ? source : { ...source, retrieved_at: 'yesterdayish' }) }),
  /retrieval time/i,
);
for (const malformedUrl of ['https://', 'https://user:pass@example.com/private']) {
  assert.throws(
    () => validateProposal({
      ...validProposal,
      evidence: validProposal.evidence.map((source, index) => index ? source : { ...source, url: malformedUrl }),
    }),
    /evidence URL/i,
  );
}
assert.throws(
  () => validateProposal({ ...validProposal, decision: 'paper_executed' }),
  /proposal decision/i,
);
assert.throws(
  () => validateProposal({ ...validProposal, source_freshness: 'probably' }),
  /source freshness/i,
);
assert.throws(
  () => validateProposal({ ...validProposal, target_price: 210 }),
  /geometry/i,
);
assert.throws(
  () => validateProposal({ ...validProposal, state: 'rejected', decision: 'rejected', rejection_reason: null, trigger_direction: 'none' }),
  /rejection reason/i,
);
assert.equal(
  validateProposal({ ...validProposal, state: 'qualified', decision: 'qualified' }).trigger_status,
  'reviewed',
);

for (const state of ['watch', 'qualified', 'rejected']) {
  assert.equal(proposalWriteAction(null, { state, source_evidence_hash: '1'.repeat(64) }), 'insert');
  assert.equal(
    proposalWriteAction(
      { id: 'proposal-watch', state: 'watch', source_evidence_hash: '0'.repeat(64) },
      { state, source_evidence_hash: '1'.repeat(64) },
    ),
    'update',
  );
}
assert.equal(
  proposalWriteAction(
    { id: 'proposal-qualified', state: 'qualified', source_evidence_hash: '0'.repeat(64) },
    { state: 'qualified', source_evidence_hash: '1'.repeat(64) },
  ),
  'update',
);
assert.throws(
  () => proposalWriteAction(
    { id: 'proposal-qualified', state: 'qualified', source_evidence_hash: '0'.repeat(64) },
    { state: 'watch', source_evidence_hash: '1'.repeat(64) },
  ),
  /transition/i,
);
assert.equal(
  proposalWriteAction(
    { id: 'proposal-rejected', state: 'rejected', source_evidence_hash: '1'.repeat(64) },
    { state: 'rejected', source_evidence_hash: '1'.repeat(64) },
  ),
  'replay',
);
assert.throws(
  () => proposalWriteAction(
    { id: 'proposal-rejected', state: 'rejected', source_evidence_hash: '0'.repeat(64) },
    { state: 'rejected', source_evidence_hash: '1'.repeat(64) },
  ),
  /transition/i,
);
assert.throws(
  () => proposalWriteAction(
    { id: 'proposal-opened', state: 'opened', source_evidence_hash: '0'.repeat(64) },
    { state: 'qualified', source_evidence_hash: '1'.repeat(64) },
  ),
  /transition/i,
);

const qualifiedProposal = {
  id: 'proposal-1', symbol: 'NVDA', state: 'qualified', source_freshness: 'fresh',
  news_checked_at: '2026-08-31T14:00:00Z',
};
assert.equal(
  validateProposalExecution(qualifiedProposal, 'NVDA', Date.parse('2026-08-31T15:00:00Z')).id,
  'proposal-1',
);
assert.throws(
  () => validateProposalExecution({ ...qualifiedProposal, state: 'watch' }, 'NVDA', Date.parse('2026-08-31T15:00:00Z')),
  /not qualified/i,
);
assert.throws(
  () => validateProposalExecution(qualifiedProposal, 'NVDA', Date.parse('2026-08-31T21:00:01Z')),
  /stale/i,
);
assert.throws(
  () => validateProposalExecution(qualifiedProposal, 'QQQ', Date.parse('2026-08-31T15:00:00Z')),
  /symbol/i,
);

const validTrade = {
  symbol: 'SPY', direction: 'long', horizon: 'short', setup: 'swing', qty: 10,
  entry_price: 100, target_price: 110, stop_price: 96, confidence: 70,
  stated_upside_pct: 10, stated_downside_pct: 4, max_book_risk_pct: 0.5,
  review_on: '2026-09-04', thesis: 'Breadth improves after a controlled pullback.',
  catalyst: 'Next inflation print confirms disinflation.',
  invalidation: 'Close below the recorded stop.',
  evidence: 'https://example.com/primary-source',
};
{
  const checked = validateTrade(validTrade, { equity: 10000, buying_power: 8000 }, { openCount: 0, todayCount: 0, existingRisk: 0 });
  assert.equal(checked.rewardRisk, 2.5);
  assert.equal(checked.plannedLoss, 40);
  assert.equal(checked.cost, 1000);
}
assert.throws(() => validateTrade({ ...validTrade, target_price: 104 }, book, { openCount: 0, todayCount: 0, existingRisk: 0 }), /reward-to-risk/i);
assert.throws(() => validateTrade({ ...validTrade, qty: 20 }, { equity: 10000, buying_power: 8000 }, { openCount: 0, todayCount: 0, existingRisk: 0 }), /0.5%/i);
assert.throws(() => validateTrade(validTrade, book, { openCount: 3, todayCount: 0, existingRisk: 0 }), /three open/i);
assert.throws(() => validateTrade(validTrade, book, { openCount: 0, todayCount: 1, existingRisk: 0 }), /one new trade/i);
assert.throws(() => validateTrade(validTrade, book, { openCount: 0, todayCount: 0, existingRisk: 80 }), /total open risk/i);
assert.equal(
  validateTrade({ ...validTrade, setup: 'legacy-discretionary' }, book, { openCount: 0, todayCount: 0, existingRisk: 0 }).row.setup,
  'legacy-discretionary',
);

assert.deepEqual(validateClose({ trade_id: 'abc', exit_price: 105, close_note: 'Target reached.' }), {
  trade_id: 'abc', exit_price: 105, close_note: 'Target reached.',
});
assert.throws(() => validateClose({ trade_id: '', exit_price: 0, close_note: '' }), /trade/i);

console.log('morrow bridge contract: state, scout, trade, close gates passed');
